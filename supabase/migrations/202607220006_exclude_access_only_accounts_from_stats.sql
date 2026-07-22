begin;

alter table public.sales_os_approved_emails
  add column if not exists stats_enabled boolean not null default true;

alter table public.sales_os_members
  add column if not exists stats_enabled boolean not null default true;

update public.sales_os_approved_emails
set stats_enabled = false,
    updated_at = now()
where email = 'filip.stanic@wildvision.io';

update public.sales_os_members
set stats_enabled = false,
    updated_at = now()
where email = 'filip.stanic@wildvision.io';

create or replace function public.claim_sales_os_membership()
returns table (
  email text,
  user_id uuid,
  role text,
  display_name text,
  active boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  caller_email text;
  approval public.sales_os_approved_emails%rowtype;
  member public.sales_os_members%rowtype;
begin
  if caller_id is null then
    raise insufficient_privilege using message = 'Authentication required';
  end if;

  select lower(btrim(auth_user.email))
  into caller_email
  from auth.users auth_user
  where auth_user.id = caller_id
    and auth_user.email_confirmed_at is not null
    and auth_user.deleted_at is null;

  if caller_email is null
    or caller_email !~ '^[^@[:space:]]+@wildvision\.io$'
  then
    raise insufficient_privilege using message = 'Verified Wild Vision email required';
  end if;

  select approved.*
  into approval
  from public.sales_os_approved_emails approved
  where approved.email = caller_email
    and approved.active = true;

  if not found then
    raise insufficient_privilege using message = 'Approved Sales OS email required';
  end if;

  select existing.*
  into member
  from public.sales_os_members existing
  where existing.email = caller_email
     or existing.user_id = caller_id
  limit 1;

  if found and (member.email <> caller_email or member.user_id <> caller_id) then
    raise insufficient_privilege using message = 'Membership is already linked to another account';
  end if;

  insert into public.sales_os_members (
    email, user_id, role, display_name, active, stats_enabled, updated_at
  ) values (
    approval.email,
    caller_id,
    approval.role,
    approval.display_name,
    true,
    approval.stats_enabled,
    now()
  )
  on conflict on constraint sales_os_members_pkey do update
  set role = excluded.role,
      display_name = excluded.display_name,
      active = true,
      stats_enabled = excluded.stats_enabled,
      updated_at = now()
  where public.sales_os_members.user_id = excluded.user_id;

  return query
  select joined.email, joined.user_id, joined.role, joined.display_name, joined.active
  from public.sales_os_members joined
  where joined.user_id = caller_id
    and joined.email = caller_email
    and joined.active = true;
end;
$$;

revoke all on function public.claim_sales_os_membership() from public, anon, authenticated;
grant execute on function public.claim_sales_os_membership() to authenticated;

comment on column public.sales_os_members.stats_enabled is
  'When false, the account can access Sales OS but is excluded from sales rankings and totals.';

commit;
