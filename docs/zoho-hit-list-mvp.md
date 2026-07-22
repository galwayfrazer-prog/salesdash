# Zoho Hit List Report MVP

## Purpose

Give the sales team a short, read-only list of proven creators who have a clear Microsoft Start or Spotify cross-sell opportunity.

## First pilot rule

A creator appears on the Hit List when either condition is true:

1. The creator has a Zoho Deal at `Stage = Live` for Microsoft Start, and has no Spotify Deal at any stage.
2. The creator has a Zoho Deal at `Stage = Live` for Spotify, and has no Microsoft Start Deal at any stage.

For this MVP, any existing Deal for the target platform counts as "already pitched", including lost or rejected Deals. Retry opportunities will be handled in a separate list later.

## Read-only Zoho fields

- `Deals.Creator`
- `Deals.Associated_Platform`
- `Deals.Stage`
- `Deals.Owner`
- `Deals.Last_Activity_Time`
- `Creators.Name`

## Dashboard output

Show one row per creator and missing platform:

- Creator
- Current live platform
- Missing platform
- Deal owner
- Last activity
- Link to the relevant Zoho record

Filters:

- Missing Microsoft Start
- Missing Spotify
- Deal owner
- Last activity

## Safety rules

- Read Zoho only.
- Do not create or update Deals.
- Do not change Deal stages.
- Do not send alerts or messages in the MVP.
- Any future CRM-changing action must require user approval.
- Keep Zoho credentials and tokens server-side only.

## Discovery snapshot

Read-only scan on 2026-07-13:

- 9,140 Deals
- 7,025 available Creators
- 663 Creators with at least one Live Deal
- 350 Live on Microsoft Start with no Spotify Deal
- 33 Live on Spotify with no Microsoft Start Deal
- 31 Live elsewhere with no Deal for either pilot platform

CRM hygiene findings are separate from the Hit List MVP:

- 862 Deals missing a Creator
- 101 Deals missing an Associated Platform
- 281 Creator/platform pairs with multiple Deals
- 5,541 Deals with no activity in more than 90 days

## Acceptance criteria

- The list uses live Zoho data through a server-side endpoint.
- The two pilot rules produce the expected categories.
- No Zoho record is created, updated, or deleted.
- Secrets do not appear in frontend code, Git, logs, or API responses.
- Empty, loading, and Zoho error states are clear to the user.
- Counts and sample rows are manually checked against Zoho before release.

## Current local implementation

- `src/HitList.jsx` keeps the existing Sales OS layout and styling.
- `vite.config.js` exposes a local, GET-only `/api/zoho-hit-list` route while `npm run dev` is running.
- `server/zohoHitList.mjs` obtains a short-lived Zoho token, reads Deals, and applies the two pilot rules.
- Local credentials come from server-only environment variables or `%USERPROFILE%\.wildvision-sales-os\zohoapisales.md`.
- `server/localHitListCache.mjs` stores completed results in `%USERPROFILE%\.wildvision-sales-os\data\zoho-hit-list.sqlite`.
- Private files are outside the Vite website folder, and the dev server explicitly blocks credential and SQLite URLs.
- The dev server refreshes that cache at startup and every ten minutes while it is running.
- If Zoho briefly fails, the page can show the last completed snapshot instead of an empty table.
- Zoho requests have a timeout and retry temporary rate-limit or server failures.

## Prepared Supabase implementation

- `supabase/migrations/202607170001_zoho_hit_list_cache.sql` creates four isolated, server-only tables. It does not modify `kv_store`.
- `supabase/functions/sync-zoho-hit-list/index.ts` reads Zoho, writes a complete immutable snapshot, and never changes CRM data.
- `supabase/functions/get-zoho-hit-list/index.ts` returns the latest completed snapshot only after validating a real Supabase Auth user.
- `supabase/config.toml` configures the three Edge Functions. The ten-minute Cron schedule is a separate manual deployment step.
- The function is intended to run from Supabase Cron every ten minutes after one manual hosted test succeeds.
- Completed snapshots are retained in a short history, and abandoned failed/running snapshots are cleaned up after 24 hours.
- Zoho and Supabase service credentials remain Edge Function secrets and never reach React.

## Local verification on 2026-07-17

- Production build completed successfully.
- The fake-record rule test passed.
- A read-only Zoho scan checked 9,212 Deals.
- The current result is 379 opportunities: 346 missing Spotify and 33 missing Microsoft Start.
- The browser filter returned the expected missing-platform rows with no browser errors.
- The temporary visual-test login bypass was removed after testing.

## Production release gate

Do not expose live CRM rows through a public Vercel function until the prepared Supabase Auth branch and database rules are cut over together. The current live `main` site still uses the legacy browser login and cannot securely protect an API route.

Before production:

1. Finish the prepared Supabase Auth migration for all eight approved users.
2. Rotate the exposed Supabase service-role key before using the hosted cache.
3. Apply the dedicated cache migration and deploy the sync Edge Function.
4. Store all `ZOHO_*`, `SUPABASE_SERVICE_ROLE_KEY`, and `HIT_LIST_SYNC_SECRET` values as server-only secrets.
5. Run one manual hosted sync and inspect its completed snapshot before enabling Cron.
6. Deploy the prepared React Auth login and protected cache reader with the coordinated RLS cutover.
7. Test a Vercel Preview deployment and confirm an unauthenticated request is rejected.
8. Only then merge the feature branch into the production branch.

## Not included yet

- All-platform opportunity matching
- Retry recommendations for rejected or lost Deals
- Automatic CRM updates
- Email, Slack, or Zoho alerts
- AI scoring
- Research automation
