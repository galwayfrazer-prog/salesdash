import { normalizeEmail, sanitizeLegacyProfile } from "../src/authModel.js";

export function buildLegacyAuthPlan(rows) {
  const accounts = [];
  const seen = new Set();

  for (const row of rows || []) {
    if (!row?.key?.startsWith("user:")) continue;
    const keyEmail = normalizeEmail(row.key.slice(5));
    let raw;
    try { raw = typeof row.value === "string" ? JSON.parse(row.value) : row.value; }
    catch { throw new Error("A legacy user profile is not valid JSON."); }

    const profile = sanitizeLegacyProfile(raw);
    const email = normalizeEmail(profile.email);
    if (!email || email !== keyEmail) throw new Error("A legacy user email does not match its storage key.");
    if (raw?.role !== "manager" && raw?.role !== "rep") {
      throw new Error("A legacy user role must be exactly rep or manager.");
    }
    if (seen.has(email)) throw new Error("A legacy user email appears more than once.");
    seen.add(email);

    accounts.push({
      email,
      role: raw.role,
      displayName: profile.displayName || profile.nickname || email.split("@")[0],
      profile,
    });
  }

  return accounts.sort((left, right) => left.email.localeCompare(right.email));
}

export function validateMigrationInventory(
  accounts,
  expectedCount,
  expectedManagerEmails,
  expectedRepEmails,
) {
  if (accounts.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} legacy accounts but found ${accounts.length}.`);
  }
  const expectedManagers = [...expectedManagerEmails].map(normalizeEmail).filter(Boolean).sort();
  const expectedReps = [...expectedRepEmails].map(normalizeEmail).filter(Boolean).sort();
  const approvedRoles = new Map();
  for (const email of expectedManagers) {
    if (approvedRoles.has(email)) throw new Error("The approved account allowlists contain a duplicate email.");
    approvedRoles.set(email, "manager");
  }
  for (const email of expectedReps) {
    if (approvedRoles.has(email)) throw new Error("The approved account allowlists contain a duplicate email.");
    approvedRoles.set(email, "rep");
  }
  if (approvedRoles.size !== expectedCount) {
    throw new Error("The approved manager and rep allowlists must contain every expected account exactly once.");
  }

  const validated = accounts.map((account) => {
    const approvedRole = approvedRoles.get(account.email);
    if (!approvedRole) {
      throw new Error("A legacy account is not in the separately approved account allowlist.");
    }
    if (account.role !== approvedRole) {
      throw new Error("A legacy account role does not match the separately approved account allowlist.");
    }
    return { ...account, role: approvedRole };
  });
  if (validated.some((account) => !approvedRoles.has(account.email))) {
    throw new Error("The legacy account list does not match the separately approved account allowlist.");
  }
  return validated;
}
