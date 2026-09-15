import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Execute the real Edge Function and Supabase client with fake HTTP boundaries.
// No live credentials, users, Zoho calls or database writes are used here.
const env = new Map(Object.entries({
  SUPABASE_URL: "https://supabase.test", SUPABASE_ANON_KEY: "test-public-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-server-key", ZOHO_CLIENT_ID: "test-client",
  ZOHO_CLIENT_SECRET: "test-secret", ZOHO_CRM_ORG_ID: "test-org",
  ZOHO_SALES_PROFILE_IDS: "sales", SALES_OS_ALLOWED_ORIGINS: "https://sales.test",
}));
const user = {
  id: "00000000-0000-0000-0000-000000000001", email: "rep@wildvision.io",
  email_confirmed_at: "2026-09-15T00:00:00Z",
  identities: [{ provider: "google", identity_data: { email: "rep@wildvision.io" } }],
};
const salesUser = { id: "zoho-1", email: user.email, status: "active", profile: { id: "sales" } };
const approved = { user_id: user.id, email: user.email, role: "manager", active: true, stats_enabled: false, legacy_access_approved: true, zoho_user_id: salesUser.id, zoho_email: salesUser.email };
let scenario;
let handler;
const originalFetch = globalThis.fetch;
const originalDeno = globalThis.Deno;
globalThis.Deno = { env: { get: (name) => env.get(name) }, serve: (callback) => { handler = callback; } };
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier === "npm:@supabase/supabase-js@2" ? "@supabase/supabase-js" : specifier, context);
} });
function reply(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Retry-After": "0" } });
}
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const method = init.method || "GET";
  scenario.calls.push({ url: url.pathname, method });
  if (url.hostname === "supabase.test" && url.pathname === "/auth/v1/user") {
    return scenario.badSession ? reply({ message: "Invalid token" }, 401) : reply(scenario.user || user);
  }
  if (url.hostname === "accounts.zoho.eu" && url.pathname === "/oauth/v2/token") {
    return reply({ access_token: "test-token", api_domain: "https://zoho.test" });
  }
  if (url.hostname === "zoho.test" && url.pathname === "/crm/v8/users") {
    assert.equal(url.searchParams.get("type"), "AllUsers");
    if (scenario.upstreamFailure) return reply({ error: "test internal detail" }, 500);
    const page = Number(url.searchParams.get("page"));
    return reply({ users: scenario.pages?.[page - 1] ?? scenario.zohoUsers ?? [salesUser],
      ...(scenario.malformedPage ? {} : { info: { more_records: page < (scenario.pages?.length || 1) } }) });
  }
  if (url.hostname === "supabase.test" && url.pathname === "/rest/v1/sales_os_members") {
    if (method === "GET") return reply(scenario.member ? [scenario.member] : []);
    const body = JSON.parse(init.body);
    scenario.writes.push({ method, body });
    if (method === "POST") { scenario.member = body; return reply(body, 201); }
    if (method === "PATCH") {
      assert.equal(url.searchParams.get("email"), `eq.${user.email}`);
      if (body.active === false) return reply(null);
      scenario.member = { ...scenario.member, ...body };
      return reply(scenario.member);
    }
  }
  throw new Error(`Unexpected test request: ${method} ${url.hostname}${url.pathname}`);
};
async function run(options = {}, requestOptions = {}) {
  scenario = { calls: [], writes: [], ...options };
  const headers = { Authorization: "Bearer test-session", Origin: "https://sales.test", ...requestOptions.headers };
  const response = await handler(new Request("https://supabase.test/functions/v1/authorize-sales-os", {
    method: requestOptions.method || "POST", headers,
    ...(requestOptions.body ? { body: JSON.stringify(requestOptions.body) } : {}),
  }));
  const body = response.status === 204 ? null : await response.json();
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.doesNotMatch(JSON.stringify(body), /test-secret|test-server-key|test-token|test internal detail/);
  return { status: response.status, body, ...scenario };
}
try {
  await import("../supabase/functions/authorize-sales-os/index.ts");
  assert.equal((await run({}, { headers: { Origin: "https://attacker.test" } })).status, 403);
  assert.equal(scenario.calls.length, 0);
  assert.equal((await run({}, { headers: { Authorization: "" } })).status, 401);
  assert.equal((await run({}, { method: "GET" })).status, 405);
  assert.equal((await run({}, { method: "OPTIONS" })).status, 204);
  assert.equal((await run({ badSession: true })).status, 401);
  assert.equal((await run({ user: { ...user, email: "rep@gmail.com" } })).status, 403);
  assert.equal(scenario.writes.length, 0);

  let result = await run({}, { body: { role: "manager", legacy_access_approved: true, email: "someone@wildvision.io" } });
  assert.equal(result.status, 200);
  assert.equal(result.writes.length, 1);
  assert.equal(result.body.member.role, "rep");
  assert.equal(result.body.member.legacy_access_approved, false);
  assert.equal(result.body.member.email, user.email);

  result = await run({ member: approved, zohoUsers: [{ ...salesUser, profile: { id: "admin" } }] });
  assert.equal(result.status, 200);
  assert.equal(result.writes.length, 0);
  assert.equal(result.body.member.role, "manager");
  assert.equal(result.body.member.stats_enabled, false);
  result = await run({
    member: { ...approved, email: user.email, zoho_user_id: "canonical-id", zoho_email: "old@wildvision.io" },
    zohoUsers: [{ ...salesUser, id: "canonical-id", email: "latest@wildvision.io", profile: { id: "admin" } }],
  });
  assert.equal(result.status, 200);
  assert.equal(result.writes.length, 1);
  assert.equal(result.body.member.zoho_email, "latest@wildvision.io");
  result = await run({ zohoUsers: [{ ...salesUser, profile: { id: "admin" } }] }, { body: { legacy_access_approved: true } });
  assert.equal(result.status, 403);
  assert.equal(result.writes.length, 0);
  result = await run({ member: { ...approved, legacy_access_approved: false }, zohoUsers: [{ ...salesUser, profile: { id: "admin" } }] });
  assert.equal(result.status, 403);
  assert.deepEqual(result.writes.map((x) => x.method), ["PATCH"]);
  result = await run({ member: approved, zohoUsers: [{ ...salesUser, status: "inactive" }] });
  assert.equal(result.status, 403);
  assert.equal(result.writes[0].body.active, false);
  for (const options of [
    { upstreamFailure: true }, { malformedPage: true },
    { zohoUsers: [salesUser, { ...salesUser, email: "duplicate@wildvision.io" }] },
    { zohoUsers: [{ ...salesUser, status: undefined }] },
  ]) {
    result = await run({ member: approved, ...options });
    assert.equal(result.status, 502);
    assert.equal(result.writes.length, 0);
  }
  result = await run({ member: { ...approved, active: false } });
  assert.equal(result.status, 403);
  assert.equal(result.writes.length, 0);
  assert.equal(result.calls.some((x) => x.url === "/crm/v8/users"), false);
  result = await run({ pages: [[], [salesUser]] });
  assert.equal(result.status, 200);
  assert.equal(result.calls.filter((x) => x.url === "/crm/v8/users").length, 2);
  env.delete("ZOHO_SALES_PROFILE_IDS");
  result = await run();
  assert.equal(result.status, 503);
  assert.equal(result.writes.length, 0);
  result = await run({ member: approved });
  assert.equal(result.status, 200, "Existing verified approvals do not require a new Sales role configuration");
  console.log("Sales OS authorization endpoint integration tests passed.");
} finally {
  hooks.deregister();
  globalThis.fetch = originalFetch;
  if (originalDeno === undefined) delete globalThis.Deno; else globalThis.Deno = originalDeno;
}
