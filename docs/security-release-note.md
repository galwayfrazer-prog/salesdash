# Security and release note for Frazer

I removed the hardcoded manager login and the unsafe browser-side email and AI requests. Zoho credentials and the Supabase service-role key now belong only in server-side environment settings, never in GitHub or a `VITE_` variable. The new Zoho connection is read-only and cannot change a Deal, send an email, or contact a creator.

Before this is merged into the live site, we still need to rotate the previously exposed Zoho and Supabase credentials, move the existing eight Sales OS accounts to Supabase Auth, add their roles to `sales_os_members`, and replace the public `kv_store` policy. One legacy user record currently contains a plaintext password, so the live database policy must not be left as it is. The account/RLS cutover has to be coordinated so nobody is locked out.

The current hosted login does not yet create a Supabase Auth session, so the new production CRM readers deliberately reject it. This is a release blocker, not a hidden fallback. The local version works for testing, but the branch must stay as a draft until the account migration is complete.

The final security review also found three medium issues in the old login: browser session data can be trusted during a forced password change, a password reset does not close an already-open session, and a deleted Auth user could leave a same-email role available for rebinding. The Supabase Auth migration must bind access to the user's verified Auth ID and revoke old sessions before this is merged.

## Release route

1. Push this branch and open a draft pull request.
2. Check the Vercel Preview URL. Do not merge yet.
3. Apply the new isolated Zoho cache tables and deploy the three Edge Functions.
4. Add the exact Vercel Preview origin to `SALES_OS_ALLOWED_ORIGINS`, then test unauthenticated, rep, and manager access.
5. Migrate Sales OS accounts and lock down `kv_store`.
6. Store the scheduler values in Supabase Vault and enable the ten-minute Cron job.
7. Merge only after the preview, account, first-sync, and Cron tests pass.

GitHub is connected to Vercel. A branch push should create a preview; merging into `main` will trigger the production deployment automatically.
