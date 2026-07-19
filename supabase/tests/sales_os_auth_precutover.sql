\set ON_ERROR_STOP on

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
do $$
declare
  safe_profile text;
begin
  select value into safe_profile
  from public.sales_os_dashboard_snapshot()
  where key = 'user:manager1@wildvision.io';
  if safe_profile is null
    or safe_profile like '%passwordHash%'
    or safe_profile like '%legacy-local-test-hash%'
    or safe_profile::jsonb ? 'role'
  then
    raise exception 'The Preview RPC exposed a legacy credential or role';
  end if;
end;
$$;
reset role;

do $$
begin
  if not exists (
    select 1 from public.kv_store
    where key = 'user:manager1@wildvision.io'
      and value::jsonb ? 'passwordHash'
  ) then
    raise exception 'The non-destructive Preview test unexpectedly changed legacy data';
  end if;
end;
$$;
