begin;

-- First-time access is now decided by the server-side Zoho verifier. Keep the
-- historical allowlist and all existing members intact, but close the old RPC
-- path so an authenticated browser cannot provision or reactivate itself.
revoke execute on function public.claim_sales_os_membership() from public, anon, authenticated;

comment on function public.claim_sales_os_membership() is
  'Legacy provisioning function. Browser execution is revoked; authorize-sales-os verifies Google and Zoho server-side.';
comment on table public.sales_os_members is
  'Sales OS members. Existing rows are preserved; new rows are provisioned only after server-side Google and Zoho Sales verification.';

commit;
