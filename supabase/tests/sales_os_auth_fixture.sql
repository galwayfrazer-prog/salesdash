\set ON_ERROR_STOP on

drop table if exists public.kv_store cascade;
create table public.kv_store (
  key text primary key,
  value text
);
alter table public.kv_store enable row level security;
grant all on table public.kv_store to public, anon, authenticated, service_role;
create policy "allow all" on public.kv_store
  for all
  using (true)
  with check (true);

delete from public.sales_os_approved_emails;
insert into public.sales_os_approved_emails (email, role, display_name, active)
values
  ('manager1@wildvision.io', 'manager', 'Manager One', true),
  ('manager2@wildvision.io', 'manager', 'Manager Two', true),
  ('rep3@wildvision.io', 'rep', 'Rep Three', true),
  ('rep4@wildvision.io', 'rep', 'Rep Four', true),
  ('rep5@wildvision.io', 'rep', 'Rep Five', true),
  ('rep6@wildvision.io', 'rep', 'Rep Six', true),
  ('rep7@wildvision.io', 'rep', 'Rep Seven', true),
  ('rep8@wildvision.io', 'rep', 'Rep Eight', true),
  ('inactive@wildvision.io', 'rep', 'Inactive User', false);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  last_sign_in_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  is_sso_user,
  is_anonymous
)
select
  '00000000-0000-0000-0000-000000000000'::uuid,
  account.id,
  'authenticated',
  'authenticated',
  account.email,
  crypt('Local-test-password-only', gen_salt('bf')),
  now(),
  case when account.email = 'rep8@wildvision.io' then null else now() end,
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  false,
  false
from (values
  ('00000000-0000-0000-0000-000000000001'::uuid, 'manager1@wildvision.io'),
  ('00000000-0000-0000-0000-000000000002'::uuid, 'manager2@wildvision.io'),
  ('00000000-0000-0000-0000-000000000003'::uuid, 'rep3@wildvision.io'),
  ('00000000-0000-0000-0000-000000000004'::uuid, 'rep4@wildvision.io'),
  ('00000000-0000-0000-0000-000000000005'::uuid, 'rep5@wildvision.io'),
  ('00000000-0000-0000-0000-000000000006'::uuid, 'rep6@wildvision.io'),
  ('00000000-0000-0000-0000-000000000007'::uuid, 'rep7@wildvision.io'),
  ('00000000-0000-0000-0000-000000000008'::uuid, 'rep8@wildvision.io'),
  ('00000000-0000-0000-0000-000000000009'::uuid, 'inactive@wildvision.io')
) as account(id, email);

insert into public.sales_os_members (email, user_id, role, display_name, active)
select
  account.email,
  account.id,
  account.role,
  account.display_name,
  account.active
from (values
  ('manager1@wildvision.io', '00000000-0000-0000-0000-000000000001'::uuid, 'manager', 'Manager One', true),
  ('manager2@wildvision.io', '00000000-0000-0000-0000-000000000002'::uuid, 'manager', 'Manager Two', true),
  ('rep3@wildvision.io', '00000000-0000-0000-0000-000000000003'::uuid, 'rep', 'Rep Three', true),
  ('rep4@wildvision.io', '00000000-0000-0000-0000-000000000004'::uuid, 'rep', 'Rep Four', true),
  ('rep5@wildvision.io', '00000000-0000-0000-0000-000000000005'::uuid, 'rep', 'Rep Five', true),
  ('rep6@wildvision.io', '00000000-0000-0000-0000-000000000006'::uuid, 'rep', 'Rep Six', true),
  ('rep7@wildvision.io', '00000000-0000-0000-0000-000000000007'::uuid, 'rep', 'Rep Seven', true),
  ('rep8@wildvision.io', '00000000-0000-0000-0000-000000000008'::uuid, 'rep', 'Rep Eight', true),
  ('inactive@wildvision.io', '00000000-0000-0000-0000-000000000009'::uuid, 'rep', 'Inactive User', false)
) as account(email, id, role, display_name, active);

insert into public.kv_store (key, value)
select
  'user:' || account.email,
  jsonb_build_object(
    'email', account.email,
    'displayName', account.display_name,
    'role', account.role,
    'passwordHash', 'legacy-local-test-hash',
    'setupComplete', true
  )::text
from (values
  ('manager1@wildvision.io', 'manager', 'Manager One'),
  ('manager2@wildvision.io', 'manager', 'Manager Two'),
  ('rep3@wildvision.io', 'rep', 'Rep Three'),
  ('rep4@wildvision.io', 'rep', 'Rep Four'),
  ('rep5@wildvision.io', 'rep', 'Rep Five'),
  ('rep6@wildvision.io', 'rep', 'Rep Six'),
  ('rep7@wildvision.io', 'rep', 'Rep Seven'),
  ('rep8@wildvision.io', 'rep', 'Rep Eight')
) as account(email, role, display_name);

insert into public.kv_store (key, value) values
  ('invite:OLD-LOCAL-CODE', '{"email":"attacker@example.invalid","role":"manager"}'),
  ('signings:rep3@wildvision.io', '[{"id":"own","dealName":"Own Private Deal","notes":"Own private note","platform":"Spotify","status":"approved"}]'),
  ('signings:rep4@wildvision.io', '[{"id":"other","dealName":"Other Private Deal","notes":"Other private note","futureSecret":"must not leak","platform":"MSN","status":"pending"}]'),
  ('mgr-settings:rep3@wildvision.io', '{"hideWeakFlag":false}'),
  ('targets:current', '{}'),
  ('incentive:current', '{}'),
  ('badges:all', '[]'),
  ('announcement:current', '{"text":"Local test"}'),
  ('meeting:recap', '{"summary":"Local test"}'),
  ('snakesladders:state', '{}');
