# Security and release note for Frazer

Released on 22 July 2026.

- The hardcoded Sales OS login is gone. Staff now sign in with an approved `@wildvision.io` Google account.
- The old database password and invite fields were removed, and anonymous database access is blocked.
- Zoho and Supabase server credentials are stored only in server-side settings, not in GitHub or browser code.
- Zoho access is read-only. Sales OS cannot edit a Deal, send an email, or contact a creator.
- The Dashboard, Leaderboard, My Stats, Targets progress, Manager view, and Hit List now read the saved Zoho snapshot.
- Supabase refreshes that snapshot every ten minutes. Two scheduled refreshes were verified after release.

The other approved staff members only need to open Sales OS and sign in with their own Wild Vision Google account once. Their access and role are then claimed automatically.

One follow-up remains: the public Git history contains the old, now-disabled dashboard password and the approved staff email/role list. The current app does not accept that password, but the repository should still be made private or have its history cleaned for privacy.
