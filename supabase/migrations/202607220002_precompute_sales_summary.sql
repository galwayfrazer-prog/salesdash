alter table public.zoho_hit_list_syncs
  add column if not exists team_sales_summary jsonb not null default '[]'::jsonb;

comment on column public.zoho_hit_list_syncs.team_sales_summary is
  'Compact per-owner sales totals computed during the read-only Zoho sync.';
