insert into public.sales_os_approved_emails (
  email,
  role,
  display_name,
  active,
  updated_at
)
values (
  'filip.stojanovic@wildvision.io',
  'rep',
  'Filip Stojanovic',
  true,
  now()
)
on conflict (email) do update
set role = excluded.role,
    display_name = excluded.display_name,
    active = true,
    updated_at = now();
