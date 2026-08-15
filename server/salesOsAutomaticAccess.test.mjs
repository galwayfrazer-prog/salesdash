import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  displayNameForMember,
  evaluateZohoSalesAccess,
  parseAccessList,
  planSalesOsMembership,
  validateGoogleAuthUser,
} from "../supabase/functions/_shared/zohoSalesAccess.mjs";

const authUser = {
  id: "auth-user-1",
  email: "REP@WILDVISION.IO",
  email_confirmed_at: "2026-08-15T00:00:00Z",
  identities: [{ provider: "google", identity_data: { email: "rep@wildvision.io" } }],
  user_metadata: { full_name: "Google Rep" },
};
const zohoSalesUser = {
  id: "zoho-user-1",
  email: "rep@wildvision.io",
  status: "active",
  full_name: "Zoho Rep",
  role: { id: "sales-role-id", name: "Sales Representative" },
  profile: { id: "standard-profile-id", name: "Standard" },
};
const access = {
  roleIds: parseAccessList(" SALES-ROLE-ID "),
  roleNames: [],
  profileIds: [],
  profileNames: [],
};

assert.deepEqual(validateGoogleAuthUser(authUser), { allowed: true, email: "rep@wildvision.io" });
for (const invalid of [
  [{ ...authUser, email: "rep@gmail.com", identities: [{ provider: "google", identity_data: { email: "rep@gmail.com" } }] }, "DOMAIN_NOT_ALLOWED"],
  [{ ...authUser, email_confirmed_at: null }, "EMAIL_NOT_VERIFIED"],
  [{ ...authUser, identities: [{ provider: "email", identity_data: { email: "rep@wildvision.io" } }] }, "GOOGLE_IDENTITY_REQUIRED"],
  [{ ...authUser, identities: [{ provider: "google", identity_data: { email: "other@wildvision.io" } }] }, "GOOGLE_IDENTITY_REQUIRED"],
]) {
  assert.equal(validateGoogleAuthUser(invalid[0]).code, invalid[1]);
}

const allowed = evaluateZohoSalesAccess({ authUser, zohoUsers: [zohoSalesUser], access });
assert.equal(allowed.allowed, true);
assert.equal(allowed.email, "rep@wildvision.io");
assert.equal(displayNameForMember(allowed.zohoUser, authUser, allowed.email), "Zoho Rep");

assert.equal(evaluateZohoSalesAccess({
  authUser,
  zohoUsers: [{ ...zohoSalesUser, status: "inactive" }],
  access,
}).code, "ZOHO_USER_INACTIVE");
assert.equal(evaluateZohoSalesAccess({
  authUser,
  zohoUsers: [{ ...zohoSalesUser, role: { id: "support-role", name: "Support" } }],
  access,
}).code, "ZOHO_SALES_MEMBERSHIP_REQUIRED");
assert.equal(evaluateZohoSalesAccess({ authUser, zohoUsers: [], access }).code, "ZOHO_USER_NOT_FOUND");
assert.equal(evaluateZohoSalesAccess({
  authUser,
  zohoUsers: [zohoSalesUser, { ...zohoSalesUser, id: "duplicate" }],
  access,
}).code, "ZOHO_USER_NOT_FOUND");
assert.equal(evaluateZohoSalesAccess({ authUser, zohoUsers: [zohoSalesUser], access: {} }).code, "SALES_TEAM_NOT_CONFIGURED");
assert.equal(evaluateZohoSalesAccess({
  authUser,
  zohoUsers: [{ ...zohoSalesUser, role: {}, profile: { id: "sales-profile", name: "Sales" } }],
  access: { profileIds: ["sales-profile"] },
}).allowed, true);

const existingMember = {
  user_id: authUser.id,
  email: "rep@wildvision.io",
  role: "manager",
  active: true,
  stats_enabled: false,
};
const keep = planSalesOsMembership({
  authUser,
  email: "rep@wildvision.io",
  memberByUserId: existingMember,
  memberByEmail: existingMember,
});
assert.equal(keep.action, "keep");
assert.equal(keep.member.role, "manager", "Existing privileges must not be overwritten.");
assert.equal(keep.member.stats_enabled, false, "Existing stats settings must not be overwritten.");

const insert = planSalesOsMembership({ authUser, email: "rep@wildvision.io" });
assert.equal(insert.action, "insert");
assert.equal(insert.member.role, "rep", "Automatic access must use least privilege.");
assert.equal(insert.member.active, true);
assert.equal(planSalesOsMembership({
  authUser,
  email: "rep@wildvision.io",
  memberByEmail: { ...existingMember, user_id: "another-auth-user" },
}).code, "MEMBERSHIP_CONFLICT");
assert.equal(planSalesOsMembership({
  authUser,
  email: "rep@wildvision.io",
  memberByUserId: { ...existingMember, active: false },
}).code, "MEMBERSHIP_DISABLED");

const root = path.resolve(import.meta.dirname, "..");
const appSource = await readFile(path.join(root, "src", "App.jsx"), "utf8");
assert.match(appSource, /functions\.invoke\(["']authorize-sales-os["']/);
assert.doesNotMatch(appSource, /rpc\(["']claim_sales_os_membership["']/);

const edgeSource = await readFile(path.join(root, "supabase", "functions", "authorize-sales-os", "index.ts"), "utf8");
for (const required of [
  /userClient\.auth\.getUser\(\)/,
  /type["),\s]+AllUsers/,
  /ZOHO_SALES_ROLE_IDS/,
  /ZOHO_SALES_PROFILE_IDS/,
  /\.insert\(newMember\)/,
  /\.update\(\{ active: false/,
]) assert.match(edgeSource, required);
assert.doesNotMatch(edgeSource, /\.delete\(/);
assert.doesNotMatch(edgeSource, /VITE_.*(?:SECRET|TOKEN|ROLE_IDS|PROFILE_IDS)/);

const policySource = await readFile(
  path.join(root, "supabase", "functions", "_shared", "zohoSalesAccess.mjs"),
  "utf8",
);
assert.match(policySource, /role:\s*["']rep["']/);

const migrationSource = await readFile(
  path.join(root, "supabase", "migrations", "202608150001_zoho_sales_os_automatic_access.sql"),
  "utf8",
);
assert.match(migrationSource, /revoke execute on function public\.claim_sales_os_membership\(\) from public, anon, authenticated/i);
assert.doesNotMatch(migrationSource, /delete\s+from\s+public\.sales_os_members/i);

console.log("Automatic Sales OS access tests passed.");
