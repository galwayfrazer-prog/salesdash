begin;

create table if not exists public.zoho_deal_notes_cache (
  deal_id text primary key,
  notes jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now(),
  source text not null default 'zoho',
  check (deal_id ~ '^[0-9]+$'),
  check (jsonb_typeof(notes) = 'array')
);

create index if not exists zoho_deal_notes_cache_fetched_at_idx
  on public.zoho_deal_notes_cache (fetched_at);

alter table public.zoho_deal_notes_cache enable row level security;

revoke all on table public.zoho_deal_notes_cache from public, anon, authenticated;
grant select, insert, update, delete on table public.zoho_deal_notes_cache to service_role;

comment on table public.zoho_deal_notes_cache is
  'Private server-only cache of sanitized Zoho Deal notes fetched when an approved Sales OS user opens a Deal.';
comment on column public.zoho_deal_notes_cache.fetched_at is
  'Cache timestamp. The Deal notes endpoint refreshes entries after ten minutes.';

commit;
