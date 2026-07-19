# Sales OS Supabase Auth migration

## What changes

Sales OS will stop treating browser storage as a login. Supabase Auth will verify the password and session, while `sales_os_members.user_id` will hold the exact approved Auth user ID and role.

The existing dashboard profiles and activity data can stay in `kv_store`, but passwords, password hashes, roles, and invite codes are removed from that table during the final cutover.

## Why existing passwords are not copied

The old accounts use browser-created SHA-256 hashes, and one legacy record contains a plaintext password. These must not be imported into the new authentication system. Each of the eight approved users receives a Supabase invitation and chooses a new password.

## Safe order

1. Keep the current live site unchanged.
2. Rotate the previously exposed Supabase service-role key.
3. Apply migrations `202607170001` and `202607170002`. They create the protected cache, empty UID-bound membership table, and Auth-only Preview reader. They do not change `kv_store` data, grants, policies, or the old live login.
4. Set the one-time migration environment variables locally. Do not paste their values into chat or GitHub.
5. Prepare separate, human-approved allowlists for all two managers and all six reps. The legacy table is currently public, so it is not trusted to choose who receives access.
6. Run the migration script without `--apply`. It requires an exact match between all eight legacy profiles and those two approved allowlists.
7. Configure the exact usable Preview redirect URL in Supabase Auth and disable public email sign-up. Access is invitation-only.
8. After the team approves sending eight emails, run with `--apply`. It sends Supabase invitations and pre-binds each returned Auth ID to the separately approved role.
9. All eight people must accept, choose a password, and sign in at least once. Test at least one rep and one manager in Preview, then verify the other six accounts too.
10. Run `npm run test:auth-db`. It proves an early cutover rolls back, anonymous access is denied, rep/manager rules work, private deal notes are hidden from other reps, and deleted Auth users cannot reclaim roles.
11. During a short maintenance window, promote the already-tested Auth Preview to production first. Confirm one rep and one manager can open it. If promotion fails, stop and leave the database unchanged.
12. Immediately apply `supabase/cutover/202607_sales_os_auth_lockdown.sql`. The SQL refuses to proceed unless all eight exact accounts are confirmed and have signed in. If it fails, its transaction rolls back and the prepared Auth reader still works while the problem is corrected.
13. Confirm anonymous, rep, manager, and deactivated-member access. Then record the successful standalone cutover in Supabase migration history so future environments reproduce it.

## Dry-run command

Set these values only in the current PowerShell session or an ignored server-side environment file:

```powershell
$env:SUPABASE_URL="https://PROJECT.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="ROTATED_VALUE"
$env:SALES_OS_EXPECTED_USER_COUNT="8"
$env:SALES_OS_EXPECTED_MANAGERS="approved.manager.one@wildvision.io,approved.manager.two@wildvision.io"
$env:SALES_OS_EXPECTED_REPS="approved.rep.one@wildvision.io,approved.rep.two@wildvision.io,approved.rep.three@wildvision.io,approved.rep.four@wildvision.io,approved.rep.five@wildvision.io,approved.rep.six@wildvision.io"
node scripts/migrate-sales-os-auth.mjs
```

The dry run prints counts only and changes nothing.

## Email-sending command

Run this only after the exact preview URL is allowed in Supabase Auth and the team approves the eight invitation emails:

```powershell
$env:SALES_OS_INVITE_REDIRECT="https://EXACT-PREVIEW-URL"
$env:SALES_OS_AUTH_MIGRATION_CONFIRM="INVITE_EXISTING_SALES_OS_USERS"
node scripts/migrate-sales-os-auth.mjs --apply
```

The service-role key must never use a `VITE_` prefix and must never be placed in GitHub, frontend code, screenshots, or chat.

If an approved email already exists in Supabase Auth, the script stops before sending anything. Review that Auth user first. Only an exact user ID that the team has separately verified may be placed in the temporary `SALES_OS_APPROVED_EXISTING_AUTH_USER_IDS` environment variable. A correctly linked rerun is allowed; an unconfirmed or expired invitation is reported instead of silently skipped. Resend it from the Supabase Auth user screen, or remove only that reviewed unconfirmed user and rerun the invitation step.

## Cutover and recovery

- Keep the current live site unchanged until the Preview, all eight accounts, and the local database test pass.
- The current Vercel Preview requires a Vercel login. Frazer must make it usable by all eight invitees, or provide another protected Preview URL, before any invitations are sent.
- Take a managed Supabase backup immediately before cutover. Never export the legacy credential rows into GitHub or chat.
- The cutover uses one transaction and a write-blocking table lock. If any preflight or cleanup check fails, it rolls back and the old live site keeps working.
- After a successful cutover, do not restore anonymous access or legacy passwords. If the frontend has a problem, roll forward with a corrected deployment while an administrator can deactivate memberships from Supabase as the break-glass control.

Run the reviewed cutover from the Supabase SQL Editor, or with a database URL kept only in the current terminal session:

```powershell
psql $env:SUPABASE_DB_URL -v ON_ERROR_STOP=1 -f supabase/cutover/202607_sales_os_auth_lockdown.sql
```

After it succeeds, add that exact cutover file as the next normal migration and mark the matching version applied. This keeps later `db reset` and new environments reproducible without running the destructive step early.

## Account recovery

Users request a Supabase recovery email from the login page. Sales OS no longer creates temporary passwords. After changing a password, the app revokes the user's other refresh sessions. If immediate access removal is needed, an administrator first sets the membership to inactive so RLS and the Zoho readers reject that user immediately.

## Acceptance criteria

- No browser-stored object can choose the signed-in identity or role.
- Every active member is matched by exact Auth user ID and verified email.
- A deleted Auth user automatically deletes the attached membership; a later same-email account receives no role.
- Anonymous `kv_store` reads and writes fail after cutover.
- A rep cannot write manager-owned keys or another user's profile.
- A rep sees safe team signing facts for leaderboard calculations, but not another rep's deal name or notes.
- No legacy password, hash, role, or invite code remains in `kv_store` after cutover.
- All eight accounts work; a rep and manager can use Hit List, My Stats, and permitted Team Stats as expected.
