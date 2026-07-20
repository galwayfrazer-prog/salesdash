\set ON_ERROR_STOP on

-- An approved verified work email can create its own exact membership.
delete from public.sales_os_members where email = 'rep8@wildvision.io';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000008', false);
select * from public.claim_sales_os_membership();
reset role;

do $$
begin
  if not exists (
    select 1 from public.sales_os_members
    where email = 'rep8@wildvision.io'
      and user_id = '00000000-0000-0000-0000-000000000008'
      and role = 'rep'
      and active = true
  ) then
    raise exception 'Approved work email could not claim its membership';
  end if;
end;
$$;

insert into auth.users (
  instance_id, id, aud, role, email, email_confirmed_at, last_sign_in_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000010', 'authenticated', 'authenticated', 'not-approved@wildvision.io', now(), now(), '{}', '{}', now(), now(), false, false),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000011', 'authenticated', 'authenticated', 'personal@gmail.com', now(), now(), '{}', '{}', now(), now(), false, false),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000012', 'authenticated', 'authenticated', 'unconfirmed@wildvision.io', null, now(), '{}', '{}', now(), now(), false, false);

insert into public.sales_os_approved_emails (email, role, display_name, active)
values ('unconfirmed@wildvision.io', 'rep', 'Unconfirmed', true);

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000010', false);
do $$
begin
  begin
    perform * from public.claim_sales_os_membership();
    raise exception 'Unapproved work email claimed a membership';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', false);
do $$
begin
  begin
    perform * from public.claim_sales_os_membership();
    raise exception 'Personal email claimed a membership';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000012', false);
do $$
begin
  begin
    perform * from public.claim_sales_os_membership();
    raise exception 'Unconfirmed email claimed a membership';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000009', false);
do $$
begin
  begin
    perform * from public.claim_sales_os_membership();
    raise exception 'Inactive approved email claimed a membership';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;

do $$
begin
  begin
    insert into public.sales_os_members (email, user_id, role, display_name, active)
    values ('personal@gmail.com', '00000000-0000-0000-0000-000000000011', 'rep', 'Personal', true);
    raise exception 'A personal email bypassed the membership domain constraint';
  exception when check_violation then
    null;
  end;
end;
$$;

delete from public.sales_os_approved_emails where email = 'unconfirmed@wildvision.io';
delete from auth.users where id in (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000012'
);

select 'Sales OS Google allowlist database test passed.' as result;
