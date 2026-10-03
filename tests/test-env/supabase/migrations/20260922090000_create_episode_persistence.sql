begin;

create table public.automation_settings (
  singleton boolean primary key default true check (singleton),
  mode text not null default 'SHADOW' check (mode in ('SHADOW','LOS_AND_GENERIC','FULL')),
  emergency_stop boolean not null default false,
  version integer not null default 1 check (version > 0)
);
insert into public.automation_settings (singleton) values (true);

create table public.complaints (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references public.channel_identities(id),
  service_id uuid references public.services(id),
  status text not null default 'NEW' check (status in ('NEW','IN_PROGRESS','RESOLVED','CLOSED')),
  category text not null check (category in ('connection_complaint','other','review')),
  version integer not null default 1 check (version > 0),
  is_primary boolean not null default true,
  automation_suppressed boolean not null default false,
  resolution_note text check (resolution_note is null or btrim(resolution_note) <> ''),
  split_from_episode_id uuid references public.complaints(id),
  previous_episode_id uuid references public.complaints(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  check ((status = 'CLOSED') = (closed_at is not null)),
  check (status not in ('RESOLVED','CLOSED') or resolution_note is not null),
  check (split_from_episode_id is distinct from id),
  check (previous_episode_id is distinct from id)
);
create unique index complaints_primary_service on public.complaints(service_id)
  where service_id is not null and is_primary and status <> 'CLOSED';
create unique index complaints_primary_identity on public.complaints(identity_id)
  where service_id is null and is_primary and status <> 'CLOSED';
create index complaints_identity on public.complaints(identity_id);
create index complaints_service on public.complaints(service_id);

create table public.ingress_events (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references public.channel_identities(id),
  channel text not null check (btrim(channel) <> ''),
  account_id text not null check (btrim(account_id) <> ''),
  chat_id text not null check (btrim(chat_id) <> ''),
  provider_message_id text not null check (btrim(provider_message_id) <> ''),
  body text not null check (length(body) <= 10000),
  received_at timestamptz not null default now(),
  mode text not null check (mode in ('SHADOW','LOS_AND_GENERIC','FULL')),
  settings_version integer not null check (settings_version > 0),
  emergency_stop boolean not null,
  unique(channel, account_id, chat_id, provider_message_id)
);
create table public.processing_jobs (
  ingress_id uuid primary key references public.ingress_events(id),
  status text not null default 'pending' check (status in ('pending','done')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((status = 'done') = (completed_at is not null))
);
create index processing_jobs_pending on public.processing_jobs(created_at) where status = 'pending';

create table public.messages (
  id uuid primary key references public.ingress_events(id),
  identity_id uuid not null references public.channel_identities(id),
  complaint_id uuid references public.complaints(id),
  classification jsonb not null,
  review_reason text,
  created_at timestamptz not null default now()
);
create index messages_complaint on public.messages(complaint_id, created_at, id);
create table public.triage_assessments (
  message_id uuid primary key references public.messages(id),
  decision jsonb not null,
  processing_result jsonb not null,
  created_at timestamptz not null default now()
);

create table public.reply_owners (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid unique references public.channel_identities(id),
  customer_id uuid unique references public.customers(id),
  merged_into uuid references public.reply_owners(id),
  check ((identity_id is not null)::integer + (customer_id is not null)::integer = 1),
  check (merged_into is distinct from id)
);
create table public.outbound_intents (
  id uuid primary key default gen_random_uuid(),
  origin text not null default 'automatic' check (origin in ('automatic','staff')),
  owner_id uuid references public.reply_owners(id),
  complaint_id uuid not null references public.complaints(id),
  message_id uuid unique references public.messages(id),
  decision jsonb,
  staff_id uuid references auth.users(id),
  client_request_id uuid,
  body text check (body is null or (btrim(body) <> '' and length(body) <= 10000)),
  status text not null default 'pending'
    check (status in ('pending','cancelled','in_flight','sent','failed','unknown')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(staff_id, client_request_id),
  check (
    (origin='automatic' and owner_id is not null and message_id is not null and decision is not null
      and staff_id is null and client_request_id is null and body is null)
    or (origin='staff' and owner_id is null and message_id is null and decision is null
      and staff_id is not null and client_request_id is not null and body is not null)
  )
);
create index outbound_intents_complaint on public.outbound_intents(complaint_id);
create table public.reply_claims (
  owner_id uuid not null references public.reply_owners(id),
  scope_kind text not null check (scope_kind in ('episode','incident','event')),
  scope_id text not null check (btrim(scope_id) <> ''),
  complaint_id uuid references public.complaints(id),
  outbound_intent_id uuid not null references public.outbound_intents(id),
  created_at timestamptz not null default now(),
  primary key(owner_id, scope_kind, scope_id),
  check ((scope_kind = 'episode' and complaint_id is not null and scope_id = complaint_id::text)
    or (scope_kind <> 'episode' and complaint_id is null))
);
create table public.complaint_evidence_links (
  complaint_id uuid not null references public.complaints(id),
  scope_kind text not null check (scope_kind in ('incident','event')),
  scope_id text not null check (btrim(scope_id) <> ''),
  primary key(complaint_id, scope_kind, scope_id)
);

create table public.complaint_audit_log (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid references public.complaints(id),
  staff_id uuid references auth.users(id),
  message_id uuid references public.messages(id),
  action text not null check (btrim(action) <> ''),
  detail jsonb not null,
  created_at timestamptz not null default now(),
  check ((staff_id is not null)::integer + (message_id is not null)::integer = 1)
);
create index complaint_audit_episode on public.complaint_audit_log(complaint_id, created_at);
create table public.staff_commands (
  staff_id uuid not null references auth.users(id),
  request_id uuid not null,
  fingerprint text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(staff_id, request_id)
);

revoke all on public.automation_settings, public.complaints, public.ingress_events,
  public.processing_jobs, public.messages, public.triage_assessments, public.reply_owners,
  public.outbound_intents, public.reply_claims, public.complaint_evidence_links,
  public.complaint_audit_log, public.staff_commands from anon, authenticated;
grant select on public.automation_settings, public.complaints, public.messages,
  public.triage_assessments, public.outbound_intents, public.complaint_evidence_links,
  public.complaint_audit_log to authenticated;
grant select, insert, update, delete on public.automation_settings, public.complaints,
  public.ingress_events, public.processing_jobs, public.messages, public.triage_assessments,
  public.reply_owners, public.outbound_intents, public.reply_claims,
  public.complaint_evidence_links, public.staff_commands to service_role;
revoke all on public.complaint_audit_log from service_role;
grant select, insert on public.complaint_audit_log to service_role;

alter table public.automation_settings enable row level security;
alter table public.complaints enable row level security;
alter table public.ingress_events enable row level security;
alter table public.processing_jobs enable row level security;
alter table public.messages enable row level security;
alter table public.triage_assessments enable row level security;
alter table public.reply_owners enable row level security;
alter table public.outbound_intents enable row level security;
alter table public.reply_claims enable row level security;
alter table public.complaint_evidence_links enable row level security;
alter table public.complaint_audit_log enable row level security;
alter table public.staff_commands enable row level security;

create policy settings_staff_read on public.automation_settings for select to authenticated using (true);
create policy complaints_staff_read on public.complaints for select to authenticated using (true);
create policy messages_staff_read on public.messages for select to authenticated using (true);
create policy assessments_staff_read on public.triage_assessments for select to authenticated using (true);
create policy intents_staff_read on public.outbound_intents for select to authenticated using (true);
create policy evidence_staff_read on public.complaint_evidence_links for select to authenticated using (true);
create policy audit_staff_read on public.complaint_audit_log for select to authenticated using (true);

comment on table public.outbound_intents is
  'Reservations only. Not provider attempts or authorization to send; dispatch guards belong to P3.';
comment on table public.messages is
  'P1.4 inbound association. Text and receipt metadata live in ingress_events; conversation/outbound UI follows P2/P3.';
commit;
