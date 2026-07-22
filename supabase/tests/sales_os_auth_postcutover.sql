\set ON_ERROR_STOP on

do $$
begin
  if exists (select 1 from public.kv_store where key like 'invite:%') then
    raise exception 'Invite rows survived cutover';
  end if;
  if exists (
    select 1 from public.kv_store
    where key like 'user:%'
      and value::jsonb ?| array['password', 'passwordHash', 'mustChangePassword', 'role', 'authUserId', 'userId', 'user_id', 'needsPasswordSetup', 'localTestOnly']
  ) then
    raise exception 'Legacy auth fields survived cutover';
  end if;
end;
$$;

set role anon;
do $$
begin
  begin
    perform count(*) from public.kv_store;
    raise exception 'Anonymous users can still read dashboard data';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.kv_store (key, value) values ('anon-write', '{}');
    raise exception 'Anonymous users can still write dashboard data';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform * from public.sales_os_dashboard_snapshot();
    raise exception 'Anonymous users can call dashboard snapshot';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
do $$
declare
  affected integer;
  safe_other text;
begin
  if (select count(*) from public.kv_store where key = 'signings:rep3@wildvision.io') <> 1 then
    raise exception 'Rep cannot read their own raw signings';
  end if;
  if (select count(*) from public.kv_store where key = 'signings:rep4@wildvision.io') <> 0 then
    raise exception 'Rep can read another rep raw signings';
  end if;

  select value into safe_other
  from public.sales_os_dashboard_snapshot()
  where key = 'signings:rep4@wildvision.io';
  if safe_other is null
    or safe_other like '%Other Private Deal%'
    or safe_other like '%Other private note%'
    or safe_other like '%must not leak%'
    or safe_other not like '%Team signing%'
  then
    raise exception 'Team snapshot did not sanitize another rep signing';
  end if;

  update public.kv_store
  set value = '{"email":"rep3@wildvision.io","displayName":"Updated Rep"}'
  where key = 'user:rep3@wildvision.io';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Rep cannot update their own safe profile'; end if;

  begin
    update public.kv_store
    set value = '{"email":"rep3@wildvision.io","displayName":"Bad","role":"manager"}'
    where key = 'user:rep3@wildvision.io';
    raise exception 'Rep inserted a role into their profile';
  exception when insufficient_privilege then
    null;
  end;

  update public.kv_store set value = '{}' where key = 'targets:current';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Rep can update manager targets'; end if;

  update public.kv_store set value = '{"hideWeakFlag":true}' where key = 'mgr-settings:rep3@wildvision.io';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Rep cannot update their own view setting'; end if;
end;
$$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000009', false);
do $$
begin
  if (select count(*) from public.kv_store) <> 0 then
    raise exception 'Inactive member can read dashboard data';
  end if;
  begin
    perform * from public.sales_os_dashboard_snapshot();
    raise exception 'Inactive member can call dashboard snapshot';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
do $$
declare
  affected integer;
begin
  if (select count(*) from public.kv_store where key like 'signings:%') <> 2 then
    raise exception 'Manager cannot read team raw signings';
  end if;
  update public.kv_store set value = '{"updated":true}' where key = 'targets:current';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Manager cannot update team targets'; end if;

  delete from public.kv_store where key = 'user:rep4@wildvision.io';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Manager can delete a user profile'; end if;
  delete from public.kv_store where key = 'signings:rep4@wildvision.io';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Manager can delete signing history'; end if;
  delete from public.kv_store where key = 'announcement:current';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Manager cannot remove an announcement'; end if;
end;
$$;
reset role;

delete from auth.users where id = '00000000-0000-0000-0000-000000000008';
do $$
begin
  if exists (select 1 from public.sales_os_members where email = 'rep8@wildvision.io') then
    raise exception 'Deleted Auth user left a reclaimable membership';
  end if;
end;
$$;

insert into auth.users (
  instance_id, id, aud, role, email, email_confirmed_at, last_sign_in_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000',
  '10000000-0000-0000-0000-000000000008',
  'authenticated', 'authenticated', 'rep8@wildvision.io', now(), now(),
  '{}', '{}', now(), now(), false, false
);
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000008', false);
select * from public.claim_sales_os_membership();
reset role;

do $$
begin
  if not exists (
    select 1 from public.sales_os_members
    where user_id = '10000000-0000-0000-0000-000000000008'
      and email = 'rep8@wildvision.io'
      and role = 'rep'
      and active = true
  ) then
    raise exception 'An approved recreated Google account could not rejoin';
  end if;
end;
$$;

update public.sales_os_approved_emails
set active = false
where email = 'rep8@wildvision.io';
delete from auth.users where id = '10000000-0000-0000-0000-000000000008';

insert into auth.users (
  instance_id, id, aud, role, email, email_confirmed_at, last_sign_in_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000',
  '20000000-0000-0000-0000-000000000008',
  'authenticated', 'authenticated', 'rep8@wildvision.io', now(), now(),
  '{}', '{}', now(), now(), false, false
);

set role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000008', false);
do $$
begin
  begin
    perform * from public.claim_sales_os_membership();
    raise exception 'A deactivated approved email reclaimed a role';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;

do $$
begin
  if exists (
    select 1 from public.sales_os_members
    where user_id = '20000000-0000-0000-0000-000000000008'
  ) then
    raise exception 'A deactivated email still received membership';
  end if;
end;
$$;

select 'Sales OS Auth database integration test passed.' as result;
