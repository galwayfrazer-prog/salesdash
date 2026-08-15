# Automatic Sales OS access

After Google authentication, the browser calls the `authorize-sales-os` Supabase Edge Function. The function verifies the Supabase session, the exact `@wildvision.io` email, and a matching Google identity. It then uses server-only Zoho credentials to fetch CRM users and requires exactly one matching user with `status: active` whose Zoho role or profile is in the configured Sales allowlist.

Eligible first-time users are inserted into `sales_os_members` as reps. Existing roles, stats settings, and active memberships are preserved. An inactive Sales OS membership is never reactivated automatically. If an active member is definitively no longer an active Sales user in Zoho, only that exact membership is deactivated; no user or membership row is deleted. A Zoho or configuration failure returns a temporary error and does not deactivate anyone.

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

```powershell
node server/salesOsAutomaticAccess.test.mjs
npm test
npm run build
npm run test:auth-db
```

Before production rollout, verify one active Sales user, one active non-Sales Wild Vision user, one inactive Zoho user, and one non-Wild-Vision Google account. Only the first should enter Sales OS or receive a new membership.
