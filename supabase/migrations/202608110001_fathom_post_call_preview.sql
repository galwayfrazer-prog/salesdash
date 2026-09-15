begin;

create table if not exists public.fathom_post_call_events (
  id uuid primary key default gen_random_uuid(),
  recording_id text not null unique,
  payload_sha256 text not null,
  meeting_title text not null default '',
  meeting_url text not null default '',
  share_url text not null default '',
  scheduled_start_at timestamptz,
  recorded_by_name text not null default '',
  recorded_by_email text not null default '',
  summary_preview text not null default '',
  action_items jsonb not null default '[]'::jsonb,
  proposed_note text not null default '',
  status text not null default 'received',
  reason_code text not null default '',
  schema_snapshot jsonb not null default '{}'::jsonb,
  attendee_count integer not null default 0 check (attendee_count >= 0),
  candidate_count integer not null default 0 check (candidate_count >= 0),
  error_code text,
  processing_token uuid,
  processing_started_at timestamptz,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (recording_id <> ''),
  check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  check (jsonb_typeof(action_items) = 'array'),
  check (jsonb_typeof(schema_snapshot) = 'object'),
  check (char_length(meeting_title) <= 500),
  check (char_length(meeting_url) <= 2000),
  check (char_length(share_url) <= 2000),
  check (char_length(recorded_by_name) <= 200),
  check (char_length(recorded_by_email) <= 320),
  check (char_length(summary_preview) <= 12000),
  check (char_length(proposed_note) <= 20000),
  check ((processing_token is null) = (processing_started_at is null)),
  check (status in (
    'received',
    'processing',
    'ready_for_review',
    'no_external_attendees',
    'no_match',
    'partial_match',
    'ambiguous',
    'schema_configuration_required',
    'failed'
  ))
);

create table if not exists public.fathom_webhook_deliveries (
  webhook_id text primary key,
  event_id uuid not null references public.fathom_post_call_events(id) on delete cascade,
  recording_id text not null,
  payload_sha256 text not null,
  delivery_count integer not null default 1 check (delivery_count > 0),
  first_received_at timestamptz not null default now(),
  last_received_at timestamptz not null default now(),
  check (webhook_id <> ''),
  check (payload_sha256 ~ '^[0-9a-f]{64}$')
);

create table if not exists public.fathom_post_call_attendees (
  event_id uuid not null references public.fathom_post_call_events(id) on delete cascade,
  normalized_email text not null,
  display_name text not null default '',
  email_domain text not null default '',
  source_labels text[] not null default '{}',
  fathom_marked_external boolean not null default false,
  shared_mailbox boolean not null default false,
  resolution_status text not null default 'pending',
  reason_code text not null default '',
  primary key (event_id, normalized_email),
  check (normalized_email = lower(normalized_email)),
  check (position('@' in normalized_email) > 1)
);

create table if not exists public.fathom_post_call_candidates (
  event_id uuid not null,
  attendee_email text not null,
  candidate_key text not null,
  contact_id text not null default '',
  contact_name text not null default '',
  creator_id text not null default '',
  creator_name text not null default '',
  deal_id text not null default '',
  deal_name text not null default '',
  deal_stage text not null default '',
  platform text not null default '',
  owner_name text not null default '',
  eligible boolean not null default false,
  reason_code text not null default '',
  evidence jsonb not null default '{}'::jsonb,
  primary key (event_id, candidate_key),
  foreign key (event_id, attendee_email)
    references public.fathom_post_call_attendees(event_id, normalized_email)
    on delete cascade,
  check (candidate_key <> ''),
  check (jsonb_typeof(evidence) = 'object')
);

create index if not exists fathom_post_call_events_status_idx
  on public.fathom_post_call_events (status, received_at desc);
create index if not exists fathom_webhook_deliveries_event_idx
  on public.fathom_webhook_deliveries (event_id);
create index if not exists fathom_post_call_candidates_event_idx
  on public.fathom_post_call_candidates (event_id, attendee_email);

create or replace function public.purge_fathom_post_call_previews(retention_days integer default 90)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  deleted_rows bigint;
begin
  if retention_days < 1 or retention_days > 3650 then
    raise exception 'retention_days must be between 1 and 3650';
  end if;
  delete from public.fathom_post_call_events
  where received_at < clock_timestamp() - make_interval(days => retention_days);
  get diagnostics deleted_rows = row_count;
  return deleted_rows;
end;
$$;

alter table public.fathom_post_call_events enable row level security;
alter table public.fathom_webhook_deliveries enable row level security;
alter table public.fathom_post_call_attendees enable row level security;
alter table public.fathom_post_call_candidates enable row level security;

revoke all on table public.fathom_post_call_events from public, anon, authenticated;
revoke all on table public.fathom_webhook_deliveries from public, anon, authenticated;
revoke all on table public.fathom_post_call_attendees from public, anon, authenticated;
revoke all on table public.fathom_post_call_candidates from public, anon, authenticated;

grant select, insert, update, delete on table public.fathom_post_call_events to service_role;
grant select, insert, update, delete on table public.fathom_webhook_deliveries to service_role;
grant select, insert, update, delete on table public.fathom_post_call_attendees to service_role;
grant select, insert, update, delete on table public.fathom_post_call_candidates to service_role;

revoke all on function public.purge_fathom_post_call_previews(integer) from public, anon, authenticated;
grant execute on function public.purge_fathom_post_call_previews(integer) to service_role;

comment on table public.fathom_post_call_events is
  'Server-only Fathom meeting previews. No raw transcript is retained and no Zoho write is performed.';
comment on table public.fathom_webhook_deliveries is
  'Idempotency ledger for verified Fathom webhook deliveries.';
comment on table public.fathom_post_call_candidates is
  'Read-only Contact, Creator and Deal candidates found for human review.';
comment on function public.purge_fathom_post_call_previews(integer) is
  'Service-only retention cleanup. Deleting an event cascades to deliveries, attendees and candidates.';

commit;
