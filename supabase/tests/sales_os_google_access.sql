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

do $$
begin
  if exists (select 1 from public.sales_os_members where active and not legacy_access_approved) then
    raise exception 'An existing approved active member lost the cutover exception';
  end if;
  if exists (select 1 from public.sales_os_members where not active and legacy_access_approved) then
    raise exception 'An inactive member received the cutover exception';
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

insert into public.sales_os_members (email, user_id, role, display_name, active)
values ('not-approved@wildvision.io', '00000000-0000-0000-0000-000000000010', 'rep', 'New Sales Rep', true);

-- Replay the actual migration copied into this disposable test container.
\i /tmp/sales-os-automatic-access.sql

do $$
begin
  if (select legacy_access_approved from public.sales_os_members where email='not-approved@wildvision.io') then
    raise exception 'A migration replay grandfathered an automatic member';
  end if;
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000010', false);
do $$
begin
  begin
    update public.sales_os_members set legacy_access_approved=true where email='not-approved@wildvision.io';
    raise exception 'An authenticated client could grant itself the legacy exception';
  exception when insufficient_privilege then null;
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
delete from public.sales_os_members where email = 'not-approved@wildvision.io';
delete from auth.users where id in (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000012'
);

select 'Sales OS Google allowlist database test passed.' as result;
