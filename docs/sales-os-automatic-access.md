# Automatic Sales OS access

After Google authentication, the browser calls the `authorize-sales-os` Supabase Edge Function. The function verifies the Supabase session, the exact `@wildvision.io` email, and a matching Google identity. It then uses server-only Zoho credentials to fetch CRM users and requires exactly one matching user with `status: active`. New members must also have a Zoho role or profile in the configured Sales allowlist.

Eligible first-time users are inserted into `sales_os_members` as reps. At migration cutover, existing active approved memberships receive a server-only `legacy_access_approved` marker: those members retain access regardless of Sales role/profile, but still require the domain, Google identity, and active Zoho checks. Future automatic members never receive this exception, including when the migration is replayed. Existing roles and stats settings are preserved. An inactive Sales OS membership is never reactivated automatically. If a member no longer meets their applicable Zoho requirements, only that exact membership is deactivated; no user or membership row is deleted. A Zoho or configuration failure returns a temporary error and does not deactivate anyone.

## Server configuration

Keep these values only in Supabase function secrets; never use a `VITE_` prefix:

```text
ZOHO_CLIENT_ID=
ZOHO_CLIENT_SECRET=
ZOHO_REFRESH_TOKEN=
ZOHO_CRM_ORG_ID=
ZOHO_ACCOUNTS_DOMAIN=https://accounts.zoho.eu
ZOHO_API_DOMAIN=https://www.zohoapis.eu
ZOHO_SALES_ACCESS_SCOPE=ZohoCRM.users.READ
ZOHO_SALES_ROLE_IDS=
ZOHO_SALES_ROLE_NAMES=
ZOHO_SALES_PROFILE_IDS=
ZOHO_SALES_PROFILE_NAMES=
```

Configure at least one role/profile allowlist. IDs are preferred because names can be renamed in Zoho. Comma-separated exact names are supported when IDs are not available. With refresh-token authentication, the existing grant must include `ZohoCRM.users.READ`. With client credentials, `ZOHO_SALES_ACCESS_SCOPE` defaults to that scope.

The function also uses the existing `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SALES_OS_SUPABASE_SECRET_KEY` (preferred) or `SUPABASE_SERVICE_ROLE_KEY`, and `SALES_OS_ALLOWED_ORIGINS` secrets.

Deploy the database migration before the function so the legacy browser-callable claim RPC is closed, then deploy `authorize-sales-os`. Do not remove the historical approved-email table or existing membership rows.

## Verification

Run:

The endpoint integration test uses Node 24's TypeScript loading and module hooks (tested with Node 24.13.1). It executes the real handler against mocked HTTP services, never live users or credentials.

```powershell
node server/salesOsAutomaticAccess.test.mjs
npm test
npm run build
npm run test:auth-db
```

Before production rollout, verify an active Sales user, a new active non-Sales Wild Vision user, an existing approved active non-Sales member, an inactive Zoho user, and a non-Wild-Vision Google account. Only the active Sales user may receive a new membership; the existing approved active non-Sales member retains access. No client may set the legacy exception or reactivate a disabled member.

## September 15 rollout hold

The live database has ten active approved members and has not received this migration. Two approved Google login addresses differ from the apparent Zoho primary addresses. Their identity mapping is not confirmed; do not guess aliases, merge accounts, or deploy a cutover that disables their current access. The user requested preserving existing approved members and automatic Sales-only additions. Verify exact account ownership (or a trusted, administrator-approved Zoho user-ID mapping) before live activation. No alias exception is implemented.

The Zoho UI confirms the Sales Staff profile ID `456269000003358077` and WV Sales role ID `456269000003440268`. These are configuration identifiers, not credentials. The production server grant still needs an authenticated live verification of `ZohoCRM.users.READ`. Neither a browser login nor a mocked endpoint test proves that grant works.

Do not run a broad database push: a separate, unfinished Fathom migration is also present locally. Coordinate the migration/RPC revocation with the frontend cutover so the old login flow is not left calling a revoked RPC. Keep PR #4 unmerged until these checks pass.
