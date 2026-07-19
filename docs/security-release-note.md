# Security and release note for Frazer

I removed the hardcoded manager login and the unsafe browser-side email and AI requests. Zoho credentials and the Supabase service-role key now belong only in server-side environment settings, never in GitHub or a `VITE_` variable. The new Zoho connection is read-only and cannot change a Deal, send an email, or contact a creator.

Before this is merged into the live site, we still need to rotate the previously exposed Zoho and Supabase credentials, move the existing eight Sales OS accounts to Supabase Auth, add their roles to `sales_os_members`, and replace the public `kv_store` policy. One legacy user record currently contains a plaintext password, so the live database policy must not be left as it is. The account/RLS cutover has to be coordinated so nobody is locked out.

The feature branch now creates a real Supabase Auth session and derives each role from an exact active Auth membership. The current live `main` site still uses the old login, so the branch must stay a draft until all eight accounts and the coordinated database cutover are complete.

The feature branch removes the three old-login paths found in the final review: browser data no longer chooses identity or role, password changes revoke other refresh sessions, and deleting an Auth user cascades its membership so a later same-email account gets no role. Local database tests now exercise these boundaries. They are not protections for the live site until the Auth/RLS cutover is completed.

## Release route

1. Push this branch and open a draft pull request.
2. Check the Vercel Preview URL. Do not merge yet.
3. Apply the new isolated Zoho cache tables and deploy the three Edge Functions.
4. Add the exact Vercel Preview origin to `SALES_OS_ALLOWED_ORIGINS`, then test unauthenticated, rep, and manager access.
5. Migrate Sales OS accounts and lock down `kv_store`.
6. Store the scheduler values in Supabase Vault and enable the ten-minute Cron job.
7. Merge only after the preview, account, first-sync, and Cron tests pass.

GitHub is connected to Vercel. A branch push should create a preview; merging into `main` will trigger the production deployment automatically.
