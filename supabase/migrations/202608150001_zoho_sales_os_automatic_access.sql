begin;

-- Preserve only memberships already approved at cutover (user decision Sep 15).
-- A repeat of this migration must not grandfather subsequently auto-added reps.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sales_os_members'
      and column_name = 'legacy_access_approved'
  ) then
    alter table public.sales_os_members
      add column legacy_access_approved boolean not null default false;
    update public.sales_os_members set legacy_access_approved = true where active = true;
  end if;
end;
$$;

comment on column public.sales_os_members.legacy_access_approved is
  'Approved before automatic-access cutover. Still requires verified Wild Vision Google identity and active Zoho account. Never set for automatic Sales provisioning.';

alter table public.sales_os_members
  add column if not exists zoho_user_id text,
  add column if not exists zoho_email text;

comment on column public.sales_os_members.zoho_user_id is
  'Stable Zoho CRM user identity used for server-side access verification; never supplied by the browser.';
comment on column public.sales_os_members.zoho_email is
  'Latest canonical email returned by Zoho CRM. The login email remains unchanged so existing Google identities keep working.';

-- Bind the two known legacy aliases to their current live Zoho identities.
-- Exact user-id and email predicates avoid touching similarly named people.
update public.sales_os_members
set zoho_user_id = '456269000039392197',
    zoho_email = 'jolyon.binstead@wildvision.io'
where user_id = '7a758082-7df7-430f-8fd6-81b7fc2f263f'
  and lower(email) = 'jolyon@wildvision.io';

update public.sales_os_members
set zoho_user_id = '456269000042489001',
    zoho_email = 'william@wildvision.io'
where user_id = 'e9608a49-8edd-42ff-bffb-b257ba99980b'
  and lower(email) = 'will@wildvision.io';

create unique index if not exists sales_os_members_zoho_user_id_key
  on public.sales_os_members (zoho_user_id)
  where zoho_user_id is not null;

-- First-time access is now decided by the server-side Zoho verifier. Keep the
-- historical allowlist and all existing members intact, but close the old RPC
-- path so an authenticated browser cannot provision or reactivate itself.
revoke execute on function public.claim_sales_os_membership() from public, anon, authenticated;

comment on function public.claim_sales_os_membership() is
  'Legacy provisioning function. Browser execution is revoked; authorize-sales-os verifies Google and Zoho server-side.';
comment on table public.sales_os_members is
  'Sales OS members. Existing rows are preserved; new rows are provisioned only after server-side Google and Zoho Sales verification.';

commit;
