import { createClient } from "@supabase/supabase-js";
import { buildLegacyAuthPlan, validateMigrationInventory } from "../server/authMigration.mjs";

function env(name) {
  return String(process.env[name] || "").trim();
}

const apply = process.argv.includes("--apply");
const supabaseUrl = env("SUPABASE_URL");
const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
const redirectTo = env("SALES_OS_INVITE_REDIRECT");
const expectedCount = Number(env("SALES_OS_EXPECTED_USER_COUNT") || "8");
const expectedManagers = env("SALES_OS_EXPECTED_MANAGERS").split(",").map((value) => value.trim()).filter(Boolean);
const expectedReps = env("SALES_OS_EXPECTED_REPS").split(",").map((value) => value.trim()).filter(Boolean);
const approvedExistingAuthUserIds = new Set(
  env("SALES_OS_APPROVED_EXISTING_AUTH_USER_IDS").split(",").map((value) => value.trim()).filter(Boolean),
);

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}
if (!Number.isInteger(expectedCount) || expectedCount < 1) {
  throw new Error("SALES_OS_EXPECTED_USER_COUNT must be a positive integer.");
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const { data: rows, error: rowsError } = await admin
  .from("kv_store")
  .select("key,value")
  .like("key", "user:%");
if (rowsError) throw new Error("Legacy account inventory could not be read.");

const accounts = validateMigrationInventory(
  buildLegacyAuthPlan(rows),
  expectedCount,
  expectedManagers,
  expectedReps,
);
console.log(`Validated ${accounts.length} legacy accounts: ${accounts.filter((item) => item.role === "manager").length} managers and ${accounts.filter((item) => item.role === "rep").length} reps.`);

if (!apply) {
  console.log("Dry run only. No Auth user, email, membership, or database row was changed.");
  process.exit(0);
}
if (env("SALES_OS_AUTH_MIGRATION_CONFIRM") !== "INVITE_EXISTING_SALES_OS_USERS") {
  throw new Error("Set SALES_OS_AUTH_MIGRATION_CONFIRM=INVITE_EXISTING_SALES_OS_USERS before --apply.");
}
if (!redirectTo) throw new Error("SALES_OS_INVITE_REDIRECT is required before invitations are sent.");

const usersByEmail = new Map();
for (let page = 1; page <= 10; page += 1) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw new Error("Existing Auth users could not be listed.");
  for (const user of data.users || []) usersByEmail.set(String(user.email || "").toLowerCase(), user);
  if ((data.users || []).length < 1000) break;
}

const { data: existingMemberships, error: membershipsError } = await admin
  .from("sales_os_members")
  .select("email,user_id,role,active");
if (membershipsError) throw new Error("Existing Sales OS memberships could not be checked.");
const membershipsByEmail = new Map(
  (existingMemberships || []).map((member) => [String(member.email || "").toLowerCase(), member]),
);

for (const account of accounts) {
  const authUser = usersByEmail.get(account.email);
  const existingMembership = membershipsByEmail.get(account.email);
  if (!authUser && existingMembership?.user_id) {
    throw new Error(
      "A Sales OS membership is linked to an Auth account with a different email. Review it before invitations are sent.",
    );
  }
  if (!authUser) continue;
  if (!authUser.email_confirmed_at) {
    throw new Error(
      "An approved email has a pending or expired Auth invitation. Review or resend it before rerunning the migration.",
    );
  }
  const safeRerun = existingMembership
    && existingMembership.user_id === authUser.id
    && existingMembership.role === account.role
    && existingMembership.active === true;
  if (!safeRerun && !approvedExistingAuthUserIds.has(authUser.id)) {
    throw new Error(
      "An unlinked Auth account already uses an approved email. Review it in Supabase and explicitly approve its user ID before continuing.",
    );
  }
}

let invited = 0;
let linked = 0;
for (const account of accounts) {
  let authUser = usersByEmail.get(account.email);
  if (!authUser) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(account.email, {
      redirectTo,
      data: { needs_password_setup: true },
    });
    if (error || !data.user) throw new Error("An approved Auth invitation could not be created.");
    authUser = data.user;
    if (String(authUser.email || "").toLowerCase() !== account.email) {
      throw new Error("The Auth invitation did not return the exact approved email.");
    }
    usersByEmail.set(account.email, authUser);
    invited += 1;
  }

  const { error: memberError } = await admin.from("sales_os_members").upsert({
    email: account.email,
    user_id: authUser.id,
    role: account.role,
    display_name: account.displayName,
    active: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: "email" });
  if (memberError) throw new Error("An Auth user could not be bound to Sales OS membership.");
  linked += 1;
}

const { data: linkedMemberships, error: linkedMembershipsError } = await admin
  .from("sales_os_members")
  .select("email,user_id,role,active")
  .in("email", accounts.map((account) => account.email));
if (linkedMembershipsError) throw new Error("The completed Sales OS memberships could not be verified.");
const linkedByEmail = new Map(
  (linkedMemberships || []).map((member) => [String(member.email || "").toLowerCase(), member]),
);
for (const account of accounts) {
  const authUser = usersByEmail.get(account.email);
  const member = linkedByEmail.get(account.email);
  const expectedUserId = authUser?.id;
  if (!member || !expectedUserId || member.user_id !== expectedUserId || member.role !== account.role || member.active !== true) {
    throw new Error("The Sales OS Auth membership read-back did not match the approved migration plan.");
  }
}

console.log(`Migration step complete: ${invited} invitations sent and ${linked} memberships pre-bound.`);
console.log("The legacy kv_store login remains available. Do not run cutover until all eight users have accepted, signed in, and passed the database preflight.");
