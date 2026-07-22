-- Non-destructive Auth preview support.
-- This creates the protected dashboard reader without changing kv_store data,
-- grants, policies, or the existing live browser login.

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
revoke all on function private.sales_os_safe_team_signings(text) from public, anon, authenticated;
revoke all on function private.sales_os_safe_profile(text) from public, anon, authenticated;
revoke all on function public.sales_os_dashboard_snapshot() from public, anon, authenticated;
grant execute on function public.sales_os_dashboard_snapshot() to authenticated;

comment on function public.sales_os_dashboard_snapshot() is
  'Auth-only dashboard snapshot. Other reps signing names and notes are sanitized.';
