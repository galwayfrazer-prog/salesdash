\set ON_ERROR_STOP on

-- The historical claim function and allowlist remain intact for migration
-- history, but browsers can no longer use that path to create or reactivate a
-- membership. Provisioning now belongs to authorize-sales-os after Zoho checks.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000008', false);
do $$
begin
  begin
    perform * from public.claim_sales_os_membership();
    raise exception 'Authenticated browser retained legacy membership provisioning access';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;

insert into auth.users (
  instance_id, id, aud, role, email, email_confirmed_at, last_sign_in_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000010', 'authenticated', 'authenticated', 'not-approved@wildvision.io', now(), now(), '{}', '{}', now(), now(), false, false),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000011', 'authenticated', 'authenticated', 'personal@gmail.com', now(), now(), '{}', '{}', now(), now(), false, false),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000012', 'authenticated', 'authenticated', 'unconfirmed@wildvision.io', null, now(), '{}', '{}', now(), now(), false, false);

insert into public.sales_os_approved_emails (email, role, display_name, active)
values ('unconfirmed@wildvision.io', 'rep', 'Unconfirmed', true);

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
