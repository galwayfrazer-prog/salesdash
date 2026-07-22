begin;

-- Server-owned allowlist. Signing in with Google is not enough by itself: the
-- verified work email must also appear here and be active.
create table if not exists public.sales_os_approved_emails (
  email text primary key check (
    email = lower(btrim(email))
    and email ~ '^[^@[:space:]]+@wildvision\.io$'
  ),
  role text not null check (role in ('rep', 'manager')),
  display_name text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sales_os_approved_emails enable row level security;
revoke all on table public.sales_os_approved_emails from public, anon, authenticated;
grant select, insert, update, delete on table public.sales_os_approved_emails to service_role;

insert into public.sales_os_approved_emails (email, role, display_name, active)
values
  ('abbey@wildvision.io', 'rep', 'Abbey', true),
  ('beth@wildvision.io', 'rep', 'Beth', true),
  ('charlie@wildvision.io', 'rep', 'Charlie', true),
  ('filip.stanic@wildvision.io', 'manager', 'Filip Stanic', true),
  ('frazer@wildvision.io', 'manager', 'Frazer Galway', true),
  ('jolyon@wildvision.io', 'rep', 'Jolyon', true),
  ('katie@wildvision.io', 'rep', 'Katie', true),
  ('will@wildvision.io', 'rep', 'Will', true)
on conflict (email) do nothing;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sales_os_members_wildvision_email_check'
      and conrelid = 'public.sales_os_members'::regclass
  ) then
    alter table public.sales_os_members
      add constraint sales_os_members_wildvision_email_check
      check (
        email = lower(btrim(email))
        and email ~ '^[^@[:space:]]+@wildvision\.io$'
      );
  end if;
end;
$$;

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
    email, user_id, role, display_name, active, updated_at
  ) values (
    approval.email,
    caller_id,
    approval.role,
    approval.display_name,
    true,
    now()
  )
  on conflict on constraint sales_os_members_pkey do update
  set role = excluded.role,
      display_name = excluded.display_name,
      active = true,
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

comment on table public.sales_os_approved_emails is
  'Server-managed exact work-email allowlist used for first Google sign-in.';
comment on function public.claim_sales_os_membership() is
  'Binds a verified, exact, approved Wild Vision Auth user to their server-owned role.';

commit;
