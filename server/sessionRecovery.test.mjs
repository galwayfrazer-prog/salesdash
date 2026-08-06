import assert from "node:assert/strict";
import {
  AUTH_REQUIRED_CODE,
  SESSION_UNAVAILABLE_CODE,
  createAuthorizedFunctionRequester,
  getVerifiedAuthUser,
  readSession,
} from "../src/sessionRecovery.js";

function session(token, user = { id: "user-1", email: "rep@wildvision.io" }) {
  return { access_token: token, user };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

{
  const calls = [];
  const auth = {
    async getSession() { return { data: { session: session("valid-token") }, error: null }; },
    async refreshSession() { throw new Error("Refresh should not run."); },
  };
  const request = createAuthorizedFunctionRequester({
    auth,
    baseUrl: "https://project.example/functions/v1/",
    apiKey: "public-key",
    retryDelayMs: 0,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(200, { ok: true });
    },
  });
  assert.deepEqual(await request("get-zoho-sales-deals?scope=team"), { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.Authorization, "Bearer valid-token");
  assert.equal(calls[0].options.headers.apikey, "public-key");
  assert.equal(calls[0].url, "https://project.example/functions/v1/get-zoho-sales-deals?scope=team");
}

{
  const calls = [];
  const auth = {
    async getSession() { return { data: { session: session("valid-token") }, error: null }; },
  };
  const request = createAuthorizedFunctionRequester({
    auth,
    baseUrl: "https://project.example/functions/v1/",
    apiKey: "public-key",
    retryDelayMs: 0,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(200, { ok: true });
    },
  });
  assert.deepEqual(await request("update-hit-list-dismissal", {
    method: "POST",
    body: { rowKey: "creator-1:spotify", completed: true },
  }), { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");
  assert.equal(calls[0].options.body, JSON.stringify({
    rowKey: "creator-1:spotify",
    completed: true,
  }));
}

{
  let refreshes = 0;
  let requests = 0;
  const auth = {
    async getSession() { return { data: { session: session("expired-token") }, error: null }; },
    async refreshSession() {
      refreshes += 1;
      return { data: { session: session("fresh-token") }, error: null };
    },
  };
  const request = createAuthorizedFunctionRequester({
    auth,
    baseUrl: "https://project.example/functions/v1/",
    apiKey: "public-key",
    retryDelayMs: 0,
    fetchImpl: async (_url, options) => {
      requests += 1;
      return options.headers.Authorization === "Bearer expired-token"
        ? jsonResponse(401, { error: "Invalid session" })
        : jsonResponse(200, { recovered: true });
    },
  });
  assert.deepEqual(await request("get-zoho-hit-list"), { recovered: true });
  assert.equal(refreshes, 1);
  assert.equal(requests, 2);
}

{
  let refreshes = 0;
  const auth = {
    async getSession() { return { data: { session: null }, error: null }; },
    async refreshSession() {
      refreshes += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { data: { session: session("shared-token") }, error: null };
    },
  };
  const request = createAuthorizedFunctionRequester({
    auth,
    baseUrl: "https://project.example/functions/v1/",
    apiKey: "public-key",
    retryDelayMs: 0,
    fetchImpl: async () => jsonResponse(200, { ok: true }),
  });
  await Promise.all([request("get-zoho-hit-list"), request("get-zoho-sales-deals")]);
  assert.equal(refreshes, 1, "Concurrent requests must share one token refresh.");
}

{
  let currentToken = "expired-token";
  let refreshes = 0;
  let expiredRequests = 0;
  const auth = {
    async getSession() { return { data: { session: session(currentToken) }, error: null }; },
    async refreshSession() {
      refreshes += 1;
      currentToken = "fresh-token";
      return { data: { session: session(currentToken) }, error: null };
    },
  };
  const request = createAuthorizedFunctionRequester({
    auth,
    baseUrl: "https://project.example/functions/v1/",
    apiKey: "public-key",
    retryDelayMs: 0,
    fetchImpl: async (_url, options) => {
      if (options.headers.Authorization === "Bearer fresh-token") {
        return jsonResponse(200, { ok: true });
      }
      expiredRequests += 1;
      if (expiredRequests === 2) await new Promise((resolve) => setTimeout(resolve, 5));
      return jsonResponse(401, { error: "Invalid session" });
    },
  });
  await Promise.all([request("get-zoho-hit-list"), request("get-zoho-sales-deals")]);
  assert.equal(refreshes, 1, "A request must reuse a token refreshed by another request.");
}

{
  const auth = {
    async getSession() { return { data: { session: null }, error: null }; },
    async refreshSession() {
      const error = new Error("Auth session missing");
      error.name = "AuthSessionMissingError";
      return { data: { session: null }, error };
    },
  };
  const request = createAuthorizedFunctionRequester({
    auth,
    baseUrl: "https://project.example/functions/v1/",
    apiKey: "public-key",
    retryDelayMs: 0,
    fetchImpl: async () => { throw new Error("Fetch must not run."); },
  });
  await assert.rejects(request("get-zoho-hit-list"), (error) => error.code === AUTH_REQUIRED_CODE);
}

{
  let requests = 0;
  const auth = {
    async getSession() { return { data: { session: session("valid-token") }, error: null }; },
  };
  const request = createAuthorizedFunctionRequester({
    auth,
    baseUrl: "https://project.example/functions/v1/",
    apiKey: "public-key",
    retryDelayMs: 0,
    fetchImpl: async () => {
      requests += 1;
      return requests === 1
        ? jsonResponse(503, { error: "temporary" })
        : jsonResponse(200, { recovered: true });
    },
  });
  assert.deepEqual(await request("get-zoho-sales-deals"), { recovered: true });
  assert.equal(requests, 2);
}

{
  let refreshes = 0;
  const auth = {
    async getSession() { return { data: { session: session("valid-token") }, error: null }; },
    async refreshSession() { refreshes += 1; },
  };
  const request = createAuthorizedFunctionRequester({
    auth,
    baseUrl: "https://project.example/functions/v1/",
    apiKey: "public-key",
    retryDelayMs: 0,
    fetchImpl: async () => jsonResponse(403, { error: "Approved membership required" }),
  });
  await assert.rejects(request("get-zoho-sales-deals"), /Approved membership required/);
  assert.equal(refreshes, 0, "A membership denial must not be treated as an expired token.");
}

{
  let requests = 0;
  const auth = {
    async getSession() { return { data: { session: session("valid-token") }, error: null }; },
  };
  const request = createAuthorizedFunctionRequester({
    auth,
    baseUrl: "https://project.example/functions/v1/",
    apiKey: "public-key",
    retryDelayMs: 0,
    fetchImpl: async () => {
      requests += 1;
      if (requests === 1) throw new TypeError("temporary network failure");
      return jsonResponse(200, { recovered: true });
    },
  });
  assert.deepEqual(await request("get-zoho-sales-deals"), { recovered: true });
  assert.equal(requests, 2);
}

{
  let refreshes = 0;
  const auth = {
    async getSession() { return { data: { session: session("expired-token") }, error: null }; },
    async refreshSession() {
      refreshes += 1;
      return { data: { session: session("still-invalid") }, error: null };
    },
  };
  const request = createAuthorizedFunctionRequester({
    auth,
    baseUrl: "https://project.example/functions/v1/",
    apiKey: "public-key",
    retryDelayMs: 0,
    fetchImpl: async () => jsonResponse(401, { error: "Invalid session" }),
  });
  await assert.rejects(request("get-zoho-sales-deals"), (error) => error.code === AUTH_REQUIRED_CODE);
  assert.equal(refreshes, 1);
}

{
  const auth = {
    async getSession() { return { data: { session: null }, error: null }; },
  };
  assert.equal(await getVerifiedAuthUser(auth), null);
}

{
  let tokenChecks = 0;
  const user = { id: "user-1", email: "rep@wildvision.io" };
  const auth = {
    async getSession() { return { data: { session: session("expired-token", user) }, error: null }; },
    async getUser(token) {
      tokenChecks += 1;
      return token === "fresh-token"
        ? { data: { user }, error: null }
        : { data: { user: null }, error: Object.assign(new Error("invalid token"), { status: 401 }) };
    },
    async refreshSession() { return { data: { session: session("fresh-token", user) }, error: null }; },
  };
  assert.deepEqual(await getVerifiedAuthUser(auth), user);
  assert.equal(tokenChecks, 2);
}

{
  const auth = { getSession() { return new Promise(() => {}); } };
  await assert.rejects(
    readSession(auth, { timeoutMs: 5 }),
    (error) => error.code === SESSION_UNAVAILABLE_CODE,
  );
}

console.log("Sales OS session recovery tests passed.");
