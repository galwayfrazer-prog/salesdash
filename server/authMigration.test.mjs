import assert from "node:assert/strict";
import { buildLegacyAuthPlan, validateMigrationInventory } from "./authMigration.mjs";

const fixture = Array.from({ length: 8 }, (_, index) => {
  const manager = index < 2;
  const email = `${manager ? "manager" : "rep"}${index + 1}@wildvision.io`;
  return {
    key: `user:${email}`,
    value: JSON.stringify({
      email,
      role: manager ? "manager" : "rep",
      displayName: `User ${index + 1}`,
      ...(index === 0 ? { password: "legacy-plaintext" } : { passwordHash: `legacy-hash-${index}` }),
      mustChangePassword: index === 1,
    }),
  };
});

const plan = buildLegacyAuthPlan(fixture);
assert.equal(plan.length, 8);
assert.equal(plan.filter((account) => account.role === "manager").length, 2);
assert.equal(plan.filter((account) => account.role === "rep").length, 6);
for (const account of plan) {
  assert.equal("password" in account.profile, false);
  assert.equal("passwordHash" in account.profile, false);
  assert.equal("mustChangePassword" in account.profile, false);
  assert.equal("role" in account.profile, false);
}
const validated = validateMigrationInventory(
  plan,
  8,
  ["manager1@wildvision.io", "manager2@wildvision.io"],
  [
    "rep3@wildvision.io",
    "rep4@wildvision.io",
    "rep5@wildvision.io",
    "rep6@wildvision.io",
    "rep7@wildvision.io",
    "rep8@wildvision.io",
  ],
);
assert.equal(validated.length, 8);
assert.throws(
  () => validateMigrationInventory(
    plan,
    8,
    ["manager1@wildvision.io", "manager2@wildvision.io"],
    ["attacker@wildvision.io", "rep4@wildvision.io", "rep5@wildvision.io", "rep6@wildvision.io", "rep7@wildvision.io", "rep8@wildvision.io"],
  ),
  /not in the separately approved account allowlist/,
);
assert.throws(
  () => validateMigrationInventory(
    plan,
    8,
    ["manager1@wildvision.io", "manager2@wildvision.io"],
    ["manager1@wildvision.io", "rep4@wildvision.io", "rep5@wildvision.io", "rep6@wildvision.io", "rep7@wildvision.io", "rep8@wildvision.io"],
  ),
  /duplicate email/,
);
const roleTampered = plan.map((account) => (
  account.email === "rep3@wildvision.io" ? { ...account, role: "manager" } : account
));
assert.throws(
  () => validateMigrationInventory(
    roleTampered,
    8,
    ["manager1@wildvision.io", "manager2@wildvision.io"],
    ["rep3@wildvision.io", "rep4@wildvision.io", "rep5@wildvision.io", "rep6@wildvision.io", "rep7@wildvision.io", "rep8@wildvision.io"],
  ),
  /role does not match/,
);
assert.throws(
  () => buildLegacyAuthPlan([
    {
      key: "user:broken@wildvision.io",
      value: JSON.stringify({ email: "broken@wildvision.io", role: "sales-admin" }),
    },
  ]),
  /role must be exactly/,
);

console.log("Sales OS legacy-account migration test passed.");
