# Zoho Hit List and Sales Stats deployment notes

## Local test

The local test does not change the hosted Supabase project or Vercel app.

```powershell
npm.cmd install
npm.cmd run test
npm.cmd run dev
```

The local SQLite test needs Node 22.5 or newer. Node may show an experimental SQLite warning; the hosted Supabase version does not use Node SQLite.

Open the local URL printed by Vite, sign in to the test dashboard, and open **Hit List Report** or **My Stats**.

The first load reads Zoho once and saves a sanitized snapshot to `%USERPROFILE%\.wildvision-sales-os\data\zoho-hit-list.sqlite`. The optional local credential file lives beside it at `%USERPROFILE%\.wildvision-sales-os\zohoapisales.md`. Both are outside the website folder, and Vite explicitly blocks private file URLs. The same ten-minute snapshot powers Hit List Report, My Stats, and manager Team Stats.

Keep the local Vite address on `127.0.0.1`. Do not add `--host` to expose the local CRM endpoint to another device.

## Hosted cache order

Do these steps only after the local page is approved:

1. Rotate the exposed Supabase service-role key and the Zoho client secret that was previously placed in a local note.
2. Sign in and link the project:

   ```powershell
   npx supabase login
   npx supabase link --project-ref jiprcwsdcqdjtkzddiku
   ```

3. Apply `supabase/migrations/202607170001_zoho_hit_list_cache.sql`.
4. Add the Zoho, service-role, and `HIT_LIST_SYNC_SECRET` values through Supabase Edge Function Secrets. Keep them outside the repo and never use a `VITE_` prefix.
5. Deploy `sync-zoho-hit-list`.
6. Invoke it manually once and verify a completed sync plus expected row counts.
7. Store the function URL and the separate sync secret in Supabase Vault.
8. Schedule the function with `*/10 * * * *`.
9. Enable email confirmation, invite approved staff through Supabase Auth, and add those lowercase emails to `sales_os_members` with the correct `rep` or `manager` role. The first verified login binds the allowlist row to that Auth user ID.
10. Deploy `get-zoho-hit-list` and `get-zoho-sales-deals`.
11. Confirm unauthenticated and non-member requests are rejected before connecting the live React page.
12. Only then enable the hosted readers in Sales OS and merge the GitHub pull request.

At the current CRM size, one full refresh uses roughly 47 paged Deal reads. Watch Zoho API usage during the PoC. If this is too expensive, change the hosted sync to an incremental strategy before keeping the ten-minute schedule long term.

For the Vercel Preview test, add that preview's exact origin to `SALES_OS_ALLOWED_ORIGINS`. Do not use a broad `*.vercel.app` allowlist.

The official references are:

- https://supabase.com/docs/guides/functions/secrets
- https://supabase.com/docs/guides/functions/schedule-functions
- https://supabase.com/docs/guides/cron
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://www.zoho.com/crm/developer/docs/api/v8/refresh.html
- https://www.zoho.com/crm/developer/docs/api/v8/multi-dc.html

## Safety boundary

- Zoho scope is Deals read-only.
- No Deal, stage, note, email, message, or creator is changed.
- The new migration does not change `kv_store` or existing dashboard records.
- A rep can receive only Deals whose Zoho Owner email matches their signed-in email.
- Only an approved manager can request Team Stats.
- No GitHub push, Vercel deployment, Supabase migration, or Cron job happens during the local test.

## What becomes automatic now

- Hit List Report: creators missing a Spotify or MSN cross-sell opportunity.
- My Stats: the existing close-rate, cycle, platform, and Live Deal cards now use read-only Zoho Deal facts instead of demo data.
- Team Stats: the existing manager comparison groups the same facts by Zoho Owner email.

Targets, badges, announcements, incentive rules, games, Gmail reply rates, and Fathom call data do not come from Zoho, so this change deliberately leaves them alone.

The stage list used as a sales handoff is still Frazer's existing list. The team must confirm that list before treating these figures as official management reporting.
