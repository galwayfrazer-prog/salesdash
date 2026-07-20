import assert from "node:assert/strict";
import {
  isWildVisionEmail,
  makeLocalTestUser,
  mergeAuthenticatedUser,
  profileForRemoteStorage,
  sanitizeLegacyProfile,
} from "../src/authModel.js";
import {
  requireSalesOsMember,
  SalesOsAuthError,
} from "../supabase/functions/_shared/salesOsAuth.mjs";

assert.equal(isWildVisionEmail("FILIP.STANIC@WILDVISION.IO"), true);
assert.equal(isWildVisionEmail("filip@wildvision.io.attacker.test"), false);
assert.equal(isWildVisionEmail("filip@gmail.com"), false);

const dirtyProfile = {
  email: "REP@WILDVISION.IO",
  displayName: "Example Rep",
  role: "manager",
  password: "legacy",
  passwordHash: "legacy-hash",
  mustChangePassword: true,
  authUserId: "forged-id",
};
const cleanProfile = sanitizeLegacyProfile(dirtyProfile);
assert.deepEqual(cleanProfile, {
  email: "rep@wildvision.io",
  displayName: "Example Rep",
});
assert.deepEqual(profileForRemoteStorage(dirtyProfile), cleanProfile);

const authUser = {
  id: "auth-user-1",
  email: "rep@wildvision.io",
  email_confirmed_at: "2026-07-19T00:00:00Z",
  user_metadata: {},
};
const member = {
  user_id: "auth-user-1",
  email: "rep@wildvision.io",
  role: "rep",
  display_name: "Example Rep",
  active: true,
};
const merged = mergeAuthenticatedUser(authUser, member, dirtyProfile);
assert.equal(merged.role, "rep", "The server membership must override a forged profile role.");
assert.equal(merged.authUserId, authUser.id);
assert.equal("passwordHash" in merged, false);
assert.throws(
  () => mergeAuthenticatedUser(authUser, { ...member, user_id: "another-user" }, dirtyProfile),
  /not linked/,
);
assert.throws(
  () => mergeAuthenticatedUser({ ...authUser, email: "personal@gmail.com" }, { ...member, email: "personal@gmail.com" }, dirtyProfile),
  /verified Wild Vision email/,
);
assert.throws(
  () => mergeAuthenticatedUser({ ...authUser, email_confirmed_at: null }, member, dirtyProfile),
  /verified Wild Vision email/,
);

const local = makeLocalTestUser("local@wildvision.io", "manager", dirtyProfile);
assert.equal(local.localTestOnly, true);
assert.equal(local.role, "manager");
assert.equal("password" in local, false);
const namedLocal = makeLocalTestUser("filip.stanic@wildvision.io", "rep");
assert.equal(namedLocal.displayName, "Filip Stanic");

function queryResult(result, calls) {
  const chain = {
    select() { return chain; },
    eq(field, value) { calls.push([field, value]); return chain; },
    async maybeSingle() { return result; },
  };
  return chain;
}

const calls = [];
const authorised = await requireSalesOsMember({
  userClient: { auth: { async getUser() { return { data: { user: authUser }, error: null }; } } },
  admin: {
    from(table) {
      assert.equal(table, "sales_os_members");
      return queryResult({ data: member, error: null }, calls);
    },
  },
});
assert.equal(authorised.member.role, "rep");
assert.deepEqual(calls, [["user_id", authUser.id], ["active", true]]);

await assert.rejects(
  requireSalesOsMember({
    userClient: { auth: { async getUser() { return { data: { user: authUser }, error: null }; } } },
    admin: { from() { return queryResult({ data: null, error: null }, []); } },
  }),
  (error) => error instanceof SalesOsAuthError && error.status === 403,
);

await assert.rejects(
  requireSalesOsMember({
    userClient: { auth: { async getUser() { return { data: { user: { ...authUser, email: "personal@gmail.com" } }, error: null }; } } },
    admin: { from() { throw new Error("Membership query must not run for a personal email."); } },
  }),
  (error) => error instanceof SalesOsAuthError && error.status === 403,
);

await assert.rejects(
  requireSalesOsMember({
    userClient: { auth: { async getUser() { return { data: { user: null }, error: new Error("invalid") }; } } },
    admin: { from() { throw new Error("Membership query must not run for an invalid session."); } },
  }),
  (error) => error instanceof SalesOsAuthError && error.status === 401,
);

await assert.rejects(
  requireSalesOsMember({
    userClient: { auth: { async getUser() { return { data: { user: { ...authUser, email_confirmed_at: null } }, error: null }; } } },
    admin: { from() { throw new Error("Membership query must not run for an unconfirmed user."); } },
  }),
  (error) => error instanceof SalesOsAuthError && error.status === 403,
);

await assert.rejects(
  requireSalesOsMember({
    userClient: { auth: { async getUser() { return { data: { user: authUser }, error: null }; } } },
    admin: { from() { return queryResult({ data: null, error: new Error("database") }, []); } },
  }),
  (error) => error instanceof SalesOsAuthError && error.status === 503,
);

await assert.rejects(
  requireSalesOsMember({
    userClient: { auth: { async getUser() { return { data: { user: authUser }, error: null }; } } },
    admin: { from() { return queryResult({ data: { ...member, email: "other@wildvision.io" }, error: null }, []); } },
  }),
  (error) => error instanceof SalesOsAuthError && error.status === 403,
);

console.log("Sales OS Auth boundary test passed.");
