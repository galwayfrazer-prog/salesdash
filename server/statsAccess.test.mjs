import assert from "node:assert/strict";
import {
  isSalesStatsUser,
  makeLocalTestUser,
  mergeAuthenticatedUser,
  sanitizeLegacyProfile,
} from "../src/authModel.js";

const authUser = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "filip.stanic@wildvision.io",
  email_confirmed_at: "2026-07-22T00:00:00.000Z",
  user_metadata: {},
};

const accessOnlyUser = mergeAuthenticatedUser(authUser, {
  email: authUser.email,
  user_id: authUser.id,
  role: "manager",
  display_name: "Filip Stanic",
  active: true,
  stats_enabled: false,
}, {
  setupComplete: true,
  statsEnabled: true,
});

assert.equal(accessOnlyUser.role, "manager");
assert.equal(accessOnlyUser.statsEnabled, false);
assert.equal(isSalesStatsUser(accessOnlyUser), false);
assert.equal("statsEnabled" in sanitizeLegacyProfile({ statsEnabled: false }), false);
assert.equal(isSalesStatsUser(makeLocalTestUser("tester@wildvision.io", "manager")), true);

console.log("Sales stats access separation test passed.");
