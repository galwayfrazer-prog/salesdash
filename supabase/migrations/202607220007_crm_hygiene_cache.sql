begin;

alter table public.zoho_deal_facts
  add column if not exists creator_id text not null default '',
  add column if not exists creator_name text not null default '';

create table if not exists public.zoho_crm_hygiene_rows (
  sync_id uuid not null references public.zoho_hit_list_syncs(id) on delete cascade,
  row_key text not null,
  deal_id text not null,
  deal_name text not null,
  creator_name text not null,
  platform text not null default '',
  stage text not null,
  owner_name text not null,
  owner_email text not null default '',
  last_activity_at timestamptz,
  days_inactive integer check (days_inactive is null or days_inactive >= 0),
  inactive_7_days boolean not null default false,
  neglected_90_days boolean not null default false,
  missing_fields text[] not null default '{}',
  zoho_record_url text not null,
  primary key (sync_id, row_key),
  check (inactive_7_days or neglected_90_days or cardinality(missing_fields) > 0),
  check (not (inactive_7_days and neglected_90_days))
);

create index if not exists zoho_crm_hygiene_rows_sync_idx
  on public.zoho_crm_hygiene_rows (sync_id);

create index if not exists zoho_crm_hygiene_rows_owner_idx
  on public.zoho_crm_hygiene_rows (sync_id, owner_email);

alter table public.zoho_crm_hygiene_rows enable row level security;

revoke all on table public.zoho_crm_hygiene_rows from anon, authenticated;
grant select, insert, update, delete on table public.zoho_crm_hygiene_rows to service_role;

comment on table public.zoho_crm_hygiene_rows is
  'Server-written, read-only CRM hygiene alerts calculated from each completed Zoho snapshot.';
comment on column public.zoho_crm_hygiene_rows.neglected_90_days is
  'True when an open Deal has no recorded Zoho activity for 90 or more days.';

commit;
