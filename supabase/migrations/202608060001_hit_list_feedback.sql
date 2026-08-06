begin;

alter table public.zoho_hit_list_rows
  add column if not exists current_platforms text[] not null default '{}';

create table if not exists public.hit_list_dismissals (
  row_key text primary key,
  dismissed_at timestamptz not null default now(),
  dismissed_by uuid not null references auth.users(id) on delete restrict,
  dismissed_by_email text not null check (dismissed_by_email = lower(dismissed_by_email))
);

create index if not exists hit_list_dismissals_dismissed_at_idx
  on public.hit_list_dismissals (dismissed_at desc);

alter table public.hit_list_dismissals enable row level security;

revoke all on table public.hit_list_dismissals from anon, authenticated;
grant select, insert, update, delete on table public.hit_list_dismissals to service_role;

comment on column public.zoho_hit_list_rows.current_platforms is
  'All platforms where the creator currently has a Deal in the Live stage.';
comment on table public.hit_list_dismissals is
  'Team-wide Sales OS completion records. Completing a Hit List row never changes Zoho CRM.';

commit;
