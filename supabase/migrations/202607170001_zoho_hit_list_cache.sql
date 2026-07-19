begin;

create table if not exists public.zoho_hit_list_syncs (
  id uuid primary key,
  status text not null check (status in ('running', 'completed', 'failed')),
  source text not null default 'zoho',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  generated_at timestamptz,
  deals_scanned integer not null default 0 check (deals_scanned >= 0),
  opportunities integer not null default 0 check (opportunities >= 0),
  missing_spotify integer not null default 0 check (missing_spotify >= 0),
  missing_microsoft_start integer not null default 0 check (missing_microsoft_start >= 0),
  error_code text
);

create table if not exists public.zoho_hit_list_rows (
  sync_id uuid not null references public.zoho_hit_list_syncs(id) on delete cascade,
  row_key text not null,
  creator_name text not null,
  live_platform text not null check (live_platform in ('Microsoft Start', 'Spotify')),
  missing_platform text not null check (missing_platform in ('Microsoft Start', 'Spotify')),
  owner_name text not null,
  last_activity_at timestamptz,
  deal_id text not null,
  zoho_record_url text not null,
  primary key (sync_id, row_key)
);

create table if not exists public.zoho_deal_facts (
  sync_id uuid not null references public.zoho_hit_list_syncs(id) on delete cascade,
  deal_id text not null,
  deal_name text not null,
  stage text not null,
  associated_platform text not null default '',
  wv_percentage numeric,
  closing_date date,
  created_time timestamptz,
  modified_time timestamptz,
  last_activity_at timestamptz,
  owner_id text not null default '',
  owner_name text not null default '',
  owner_email text not null default '',
  pipeline text not null default '',
  layout_id text not null default '',
  layout_name text not null default '',
  primary key (sync_id, deal_id)
);

create table if not exists public.sales_os_members (
  email text primary key check (email = lower(email)),
  user_id uuid unique references auth.users(id) on delete set null,
  role text not null check (role in ('rep', 'manager')),
  display_name text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists zoho_hit_list_syncs_completed_idx
  on public.zoho_hit_list_syncs (completed_at desc)
  where status = 'completed';

create unique index if not exists zoho_hit_list_one_running_idx
  on public.zoho_hit_list_syncs (status)
  where status = 'running';

create index if not exists zoho_hit_list_rows_sync_idx
  on public.zoho_hit_list_rows (sync_id);

create index if not exists zoho_deal_facts_sync_idx
  on public.zoho_deal_facts (sync_id);

create index if not exists zoho_deal_facts_owner_idx
  on public.zoho_deal_facts (sync_id, owner_email);

create index if not exists sales_os_members_user_idx
  on public.sales_os_members (user_id)
  where active = true;

alter table public.zoho_hit_list_syncs enable row level security;
alter table public.zoho_hit_list_rows enable row level security;
alter table public.zoho_deal_facts enable row level security;
alter table public.sales_os_members enable row level security;

revoke all on table public.zoho_hit_list_syncs from anon, authenticated;
revoke all on table public.zoho_hit_list_rows from anon, authenticated;
revoke all on table public.zoho_deal_facts from anon, authenticated;
revoke all on table public.sales_os_members from anon, authenticated;

grant select, insert, update, delete on table public.zoho_hit_list_syncs to service_role;
grant select, insert, update, delete on table public.zoho_hit_list_rows to service_role;
grant select, insert, update, delete on table public.zoho_deal_facts to service_role;
grant select, insert, update, delete on table public.sales_os_members to service_role;

comment on table public.zoho_hit_list_syncs is
  'Server-written metadata for immutable Zoho Hit List snapshots.';
comment on table public.zoho_hit_list_rows is
  'Read-only CRM cross-sell rows belonging to completed Hit List snapshots.';
comment on table public.zoho_deal_facts is
  'Server-written, sanitized Deal facts used by My Stats and manager Team Stats.';
comment on table public.sales_os_members is
  'Server-managed allowlist binding approved Wild Vision staff to Supabase Auth users.';

commit;
