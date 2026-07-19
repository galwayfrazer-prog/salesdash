-- Run this only during the coordinated Supabase Auth cutover, after every
-- existing Sales OS user has an accepted Auth account and a pre-bound
-- sales_os_members row. It intentionally stops the legacy browser login.

begin;

-- Stop anonymous legacy writes from racing the validation/scrub transaction.
lock table public.kv_store in share row exclusive mode;

do $$
begin
  if (select count(*) from public.kv_store where key like 'user:%') <> 8 then
    raise exception 'Expected exactly eight legacy Sales OS user profiles';
  end if;

  if exists (
    select 1
    from public.kv_store
    where key like 'user:%'
      and (
        value is null
        or not pg_input_is_valid(value, 'jsonb')
        or jsonb_typeof(value::jsonb) <> 'object'
        or lower(btrim(coalesce(value::jsonb ->> 'email', ''))) <> substring(key from 6)
      )
  ) then
    raise exception 'Sales OS user profiles must be valid JSON with an email matching their key';
  end if;

  if exists (
    select 1
    from public.kv_store profile
    left join public.sales_os_members member
      on member.email = substring(profile.key from 6)
    left join auth.users auth_user
      on auth_user.id = member.user_id
    where profile.key like 'user:%'
      and (
        member.user_id is null
        or member.active is not true
        or member.role not in ('rep', 'manager')
        or (
          profile.value::jsonb ? 'role'
          and member.role <> coalesce(profile.value::jsonb ->> 'role', '')
        )
        or (
          not (profile.value::jsonb ? 'role')
          and (
            has_table_privilege('anon', 'public.kv_store', 'INSERT,UPDATE,DELETE')
            or exists (
              select 1
              from pg_policies
              where schemaname = 'public'
                and tablename = 'kv_store'
                and roles @> array['public']::name[]
            )
          )
        )
        or lower(coalesce(auth_user.email, '')) <> member.email
        or auth_user.email_confirmed_at is null
        or auth_user.last_sign_in_at is null
        or auth_user.deleted_at is not null
      )
  ) then
    raise exception 'Every legacy Sales OS user must have an active, confirmed, exact Auth membership with the same approved role';
  end if;

  if (
    select count(*)
    from public.sales_os_members
    where active = true
  ) <> 8 then
    raise exception 'Expected exactly eight active Sales OS memberships';
  end if;

  if exists (
    select 1
    from public.sales_os_members member
    where member.active = true
      and not exists (
        select 1
        from public.kv_store profile
        where profile.key = ('user:' || member.email)
      )
  ) then
    raise exception 'Active Sales OS memberships must exactly match the eight legacy user profiles';
  end if;

  if (select count(*) from public.sales_os_members where active = true and role = 'manager') <> 2 then
    raise exception 'Expected exactly two active Sales OS managers';
  end if;
end;
$$;

delete from public.kv_store where key like 'invite:%';

update public.kv_store
set value = (
  value::jsonb
  - 'password'
  - 'passwordHash'
  - 'mustChangePassword'
  - 'role'
  - 'authUserId'
  - 'userId'
  - 'user_id'
  - 'needsPasswordSetup'
  - 'localTestOnly'
)::text
where key like 'user:%';

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.sales_os_member_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select email
  from public.sales_os_members
  where user_id = (select auth.uid())
    and active = true
  limit 1;
$$;

create or replace function private.sales_os_is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sales_os_members
    where user_id = (select auth.uid())
      and active = true
      and role = 'manager'
  );
$$;

create or replace function private.sales_os_profile_write_allowed(
  profile_key text,
  profile_value text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  payload jsonb;
  payload_email text;
  member_email text;
begin
  if profile_value is null or not pg_input_is_valid(profile_value, 'jsonb') then
    return false;
  end if;
  payload := profile_value::jsonb;
  if jsonb_typeof(payload) <> 'object' then return false; end if;

  payload_email := lower(btrim(coalesce(payload ->> 'email', '')));
  member_email := private.sales_os_member_email();
  if payload_email = '' or profile_key <> ('user:' || payload_email) then return false; end if;
  if payload ?| array[
    'password', 'passwordHash', 'mustChangePassword', 'role',
    'authUserId', 'userId', 'user_id', 'needsPasswordSetup', 'localTestOnly'
  ] then
    return false;
  end if;

  return (select private.sales_os_is_manager()) or payload_email = member_email;
exception when others then
  return false;
end;
$$;

create or replace function private.sales_os_kv_write_allowed(
  row_key text,
  row_value text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  member_email text;
begin
  if not (select private.sales_os_is_active_member()) then return false; end if;
  if row_key like 'invite:%' then return false; end if;
  if row_key like 'user:%' then
    return private.sales_os_profile_write_allowed(row_key, row_value);
  end if;
  if (select private.sales_os_is_manager()) then return true; end if;

  member_email := private.sales_os_member_email();
  return row_key = 'signings:' || member_email
    or row_key = 'mgr-settings:' || member_email
    or row_key = 'snakesladders:state';
end;
$$;

create or replace function private.sales_os_safe_team_signings(raw_value text)
returns text
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  payload jsonb;
  sanitized jsonb;
begin
  if raw_value is null or not pg_input_is_valid(raw_value, 'jsonb') then
    return '[]';
  end if;
  payload := raw_value::jsonb;
  if jsonb_typeof(payload) <> 'array' then return '[]'; end if;
  select coalesce(
    jsonb_agg(
      case
        when jsonb_typeof(item) = 'object'
          then jsonb_strip_nulls(jsonb_build_object(
            'id', item -> 'id',
            'dealName', 'Team signing',
            'platform', item -> 'platform',
            'split', item -> 'split',
            'contractDate', item -> 'contractDate',
            'status', item -> 'status',
            'submittedAt', item -> 'submittedAt',
            'submittedBy', item -> 'submittedBy',
            'submittedByName', item -> 'submittedByName',
            'approvedAt', item -> 'approvedAt',
            'approvedBy', item -> 'approvedBy',
            'rejectedAt', item -> 'rejectedAt'
          ))
        else '{}'::jsonb
      end
    ),
    '[]'::jsonb
  )
  into sanitized
  from jsonb_array_elements(payload) item;
  return sanitized::text;
exception when others then
  return '[]';
end;
$$;

create or replace function private.sales_os_safe_profile(raw_value text)
returns text
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  payload jsonb;
begin
  if raw_value is null or not pg_input_is_valid(raw_value, 'jsonb') then return '{}'; end if;
  payload := raw_value::jsonb;
  if jsonb_typeof(payload) <> 'object' then return '{}'; end if;
  return (
    payload
    - 'password'
    - 'passwordHash'
    - 'mustChangePassword'
    - 'role'
    - 'authUserId'
    - 'userId'
    - 'user_id'
    - 'needsPasswordSetup'
    - 'localTestOnly'
  )::text;
exception when others then
  return '{}';
end;
$$;

create or replace function public.sales_os_dashboard_snapshot()
returns table(key text, value text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  member_email text;
  manager_access boolean;
begin
  member_email := private.sales_os_member_email();
  if member_email is null then
    raise insufficient_privilege using message = 'Approved Sales OS membership required';
  end if;
  manager_access := private.sales_os_is_manager();

  return query
  select
    row.key,
    case
      when row.key like 'user:%'
      then private.sales_os_safe_profile(row.value)
      when not manager_access
        and row.key like 'signings:%'
        and row.key <> ('signings:' || member_email)
      then private.sales_os_safe_team_signings(row.value)
      else row.value
    end
  from public.kv_store row
  where manager_access
    or row.key like 'user:%'
    or row.key like 'signings:%'
    or row.key = ('mgr-settings:' || member_email)
    or row.key in (
      'targets:current',
      'incentive:current',
      'badges:all',
      'announcement:current',
      'meeting:recap',
      'snakesladders:state'
    );
end;
$$;

revoke all on function private.sales_os_member_email() from public, anon, authenticated;
revoke all on function private.sales_os_is_manager() from public, anon, authenticated;
revoke all on function private.sales_os_profile_write_allowed(text, text) from public, anon, authenticated;
revoke all on function private.sales_os_kv_write_allowed(text, text) from public, anon, authenticated;
revoke all on function private.sales_os_safe_team_signings(text) from public, anon, authenticated;
revoke all on function private.sales_os_safe_profile(text) from public, anon, authenticated;
revoke all on function public.sales_os_dashboard_snapshot() from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.sales_os_member_email() to authenticated;
grant execute on function private.sales_os_is_manager() to authenticated;
grant execute on function private.sales_os_profile_write_allowed(text, text) to authenticated;
grant execute on function private.sales_os_kv_write_allowed(text, text) to authenticated;
grant execute on function public.sales_os_dashboard_snapshot() to authenticated;

alter table public.kv_store enable row level security;
do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'kv_store'
  loop
    execute format('drop policy %I on public.kv_store', policy_record.policyname);
  end loop;
end;
$$;

revoke all on table public.kv_store from public, anon, authenticated;
grant select, insert, update, delete on table public.kv_store to authenticated;

create policy "active members can read dashboard data"
  on public.kv_store
  for select
  to authenticated
  using (
    (select private.sales_os_is_manager())
    or (
      (select private.sales_os_is_active_member())
      and (
        key like 'user:%'
        or key = ('signings:' || (select private.sales_os_member_email()))
        or key = ('mgr-settings:' || (select private.sales_os_member_email()))
        or key in (
          'targets:current',
          'incentive:current',
          'badges:all',
          'announcement:current',
          'meeting:recap',
          'snakesladders:state'
        )
      )
    )
  );

create policy "approved dashboard inserts"
  on public.kv_store
  for insert
  to authenticated
  with check ((select private.sales_os_kv_write_allowed(key, value)));

create policy "approved dashboard updates"
  on public.kv_store
  for update
  to authenticated
  using ((select private.sales_os_kv_write_allowed(key, value)))
  with check ((select private.sales_os_kv_write_allowed(key, value)));

create policy "managers can delete dashboard data"
  on public.kv_store
  for delete
  to authenticated
  using (
    (select private.sales_os_is_manager())
    and key in ('announcement:current', 'meeting:recap')
  );

comment on table public.kv_store is
  'Legacy Sales OS dashboard data. Authentication and roles live in Supabase Auth and sales_os_members.';

do $$
begin
  if exists (
    select 1
    from public.kv_store
    where key like 'invite:%'
      or (
        key like 'user:%'
        and value::jsonb ?| array[
          'password', 'passwordHash', 'mustChangePassword', 'role',
          'authUserId', 'userId', 'user_id', 'needsPasswordSetup', 'localTestOnly'
        ]
      )
  ) then
    raise exception 'Sales OS credential cleanup did not finish safely';
  end if;
end;
$$;

commit;
