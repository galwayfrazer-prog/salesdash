import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const appSource = await readFile(path.join(root, "src", "App.jsx"), "utf8");

for (const forbidden of [
  /api\.anthropic\.com/i,
  /anthropic-dangerous-direct-browser-access/i,
  /api\.resend\.com\/emails/i,
  /function\s+switchUser\b/,
  /password\s*:\s*["'][^"']{6,}["']/i,
  /wv_dash_user/,
  /sessionStorage/,
  /passwordHash/,
  /function\s+verifyPassword\b/,
  /function\s+secureReadableCode\b/,
  /auth\.admin/,
  /LS\.set\(["']invite:/,
  /auth\.signInWithPassword/,
  /auth\.resetPasswordForEmail/,
  /auth\.updateUser\(\{\s*password/,
  /type=["']password["']/,
]) {
  assert.doesNotMatch(appSource, forbidden);
}
for (const required of [
  /auth\.signInWithOAuth/,
  /provider:\s*["']google["']/,
  /functions\.invoke\(["']authorize-sales-os["']/,
  /getVerifiedAuthUser/,
  /auth\.onAuthStateChange/,
]) {
  assert.match(appSource, required);
}

const sessionRecoverySource = await readFile(
  path.join(root, "src", "sessionRecovery.js"),
  "utf8",
);
assert.match(sessionRecoverySource, /auth\.getSession\(\)/);
assert.match(sessionRecoverySource, /auth\.refreshSession\(\)/);
assert.match(sessionRecoverySource, /auth\.getUser\(accessToken\)/);
assert.match(sessionRecoverySource, /Authorization:\s*`Bearer \$\{accessToken\}`/);
assert.doesNotMatch(sessionRecoverySource, /service[_-]?role/i);

const sharedAuthSource = await readFile(
  path.join(root, "supabase", "functions", "_shared", "salesOsAuth.mjs"),
  "utf8",
);
assert.match(sharedAuthSource, /\.eq\("user_id", user\.id\)/);
assert.match(sharedAuthSource, /wildvision\\\.io/);
assert.doesNotMatch(sharedAuthSource, /\.update\(/);
assert.doesNotMatch(sharedAuthSource, /\.eq\("email"/);

const dealNotesFunctionSource = await readFile(
  path.join(root, "supabase", "functions", "get-zoho-deal-notes", "index.ts"),
  "utf8",
);
assert.match(dealNotesFunctionSource, /requireSalesOsMember/);
assert.match(dealNotesFunctionSource, /canReadDealNotes/);
assert.match(dealNotesFunctionSource, /request\.method !== "GET"/);
assert.match(dealNotesFunctionSource, /\.eq\("deal_id", dealId\)/);
assert.match(dealNotesFunctionSource, /\.from\("zoho_deal_notes_cache"\)/);
assert.match(dealNotesFunctionSource, /isFreshDealNotesCache/);
assert.doesNotMatch(dealNotesFunctionSource, /console\.(?:log|error)\([^)]*Note_Content/i);

const dealNotesCacheMigrationSource = await readFile(
  path.join(root, "supabase", "migrations", "202607230001_zoho_deal_notes_cache.sql"),
  "utf8",
);
assert.match(dealNotesCacheMigrationSource, /enable row level security/i);
assert.match(dealNotesCacheMigrationSource, /revoke all.*anon, authenticated/i);
assert.match(dealNotesCacheMigrationSource, /grant select, insert, update, delete.*service_role/i);

const migrationSource = await readFile(
  path.join(root, "supabase", "migrations", "202607170001_zoho_hit_list_cache.sql"),
  "utf8",
);
assert.match(migrationSource, /user_id uuid not null unique references auth\.users\(id\) on delete cascade/i);

const previewMigrationSource = await readFile(
  path.join(root, "supabase", "migrations", "202607170002_sales_os_auth_preview.sql"),
  "utf8",
);
assert.match(previewMigrationSource, /sales_os_dashboard_snapshot/i);
assert.match(previewMigrationSource, /sales_os_safe_profile/i);
assert.match(previewMigrationSource, /- 'passwordHash'/i);
assert.doesNotMatch(previewMigrationSource, /delete from public\.kv_store/i);
assert.doesNotMatch(previewMigrationSource, /revoke all on table public\.kv_store/i);

const googleAccessMigrationSource = await readFile(
  path.join(root, "supabase", "migrations", "202607200001_sales_os_google_access.sql"),
  "utf8",
);
assert.match(googleAccessMigrationSource, /sales_os_approved_emails/i);
assert.match(googleAccessMigrationSource, /claim_sales_os_membership/i);
assert.match(googleAccessMigrationSource, /email_confirmed_at is not null/i);
assert.match(googleAccessMigrationSource, /grant execute on function public\.claim_sales_os_membership\(\) to authenticated/i);
assert.doesNotMatch(googleAccessMigrationSource, /grant select.*sales_os_approved_emails.*authenticated/i);

const automaticAccessMigrationSource = await readFile(
  path.join(root, "supabase", "migrations", "202608150001_zoho_sales_os_automatic_access.sql"),
  "utf8",
);
assert.match(automaticAccessMigrationSource, /revoke execute on function public\.claim_sales_os_membership\(\) from public, anon, authenticated/i);
assert.doesNotMatch(automaticAccessMigrationSource, /delete\s+from\s+public\.sales_os_members/i);

const automaticAccessFunctionSource = await readFile(
  path.join(root, "supabase", "functions", "authorize-sales-os", "index.ts"),
  "utf8",
);
assert.match(automaticAccessFunctionSource, /userClient\.auth\.getUser\(\)/);
assert.match(automaticAccessFunctionSource, /ZOHO_SALES_ROLE_IDS/);
assert.match(automaticAccessFunctionSource, /ZOHO_SALES_PROFILE_IDS/);
assert.doesNotMatch(automaticAccessFunctionSource, /\.delete\(/);

const cutoverSource = await readFile(
  path.join(root, "supabase", "cutover", "202607_sales_os_auth_lockdown.sql"),
  "utf8",
);
assert.match(cutoverSource, /lock table public\.kv_store in share row exclusive mode/i);
assert.match(cutoverSource, /from pg_policies/i);
assert.match(cutoverSource, /revoke all on table public\.kv_store from public, anon, authenticated/i);
assert.match(cutoverSource, /- 'passwordHash'/);
assert.match(cutoverSource, /last_sign_in_at is not null/i);
assert.match(cutoverSource, /sales_os_approved_emails/i);
assert.match(cutoverSource, /sales_os_dashboard_snapshot/i);
assert.match(cutoverSource, /sales_os_safe_team_signings/i);
assert.match(cutoverSource, /key in \('announcement:current', 'meeting:recap'\)/i);

const authMigrationSource = await readFile(
  path.join(root, "scripts", "migrate-sales-os-auth.mjs"),
  "utf8",
);
assert.match(authMigrationSource, /SALES_OS_EXPECTED_MANAGERS/);
assert.match(authMigrationSource, /SALES_OS_EXPECTED_REPS/);
assert.match(authMigrationSource, /SALES_OS_APPROVED_EXISTING_AUTH_USER_IDS/);

const envExample = await readFile(path.join(root, ".env.example"), "utf8");
for (const line of envExample.split(/\r?\n/)) {
  if (!/^(ZOHO_CLIENT_SECRET|ZOHO_REFRESH_TOKEN|SUPABASE_SERVICE_ROLE_KEY|SALES_OS_SUPABASE_SECRET_KEY|HIT_LIST_SYNC_SECRET)=/.test(line)) continue;
  assert.equal(line.split("=", 2)[1], "", "Secret examples must remain blank.");
}

const distDirectory = path.join(root, "dist", "assets");
try {
  for (const name of await readdir(distDirectory)) {
    if (!name.endsWith(".js")) continue;
    const bundledSource = await readFile(path.join(distDirectory, name), "utf8");
    assert.doesNotMatch(bundledSource, /ZOHO_CLIENT_SECRET|SUPABASE_SERVICE_ROLE_KEY|SALES_OS_SUPABASE_SECRET_KEY|HIT_LIST_SYNC_SECRET/);
    assert.doesNotMatch(bundledSource, /api\.anthropic\.com|api\.resend\.com\/emails/i);
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

console.log("Secret and browser-integration regression test passed.");
