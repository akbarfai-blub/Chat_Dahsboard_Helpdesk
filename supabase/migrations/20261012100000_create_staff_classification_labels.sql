begin;

-- Table to store current/active staff classification label per message.
-- Explicitly bound to public.messages(id) and public.conversations(id).
-- Original rule result, rule version, and matched keywords are preserved as immutable snapshots.
create table if not exists public.staff_message_classifications (
  message_id uuid primary key references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  staff_id uuid not null references auth.users(id),
  labeled_category text not null check (labeled_category in ('connection_complaint', 'other', 'review')),
  status text not null check (status in ('confirmed', 'corrected')),
  notes text check (notes is null or (btrim(notes) <> '' and length(notes) <= 1000)),
  original_category text not null check (btrim(original_category) <> ''),
  rule_version text not null check (btrim(rule_version) <> ''),
  matched_keywords jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists staff_message_classifications_conv
  on public.staff_message_classifications(conversation_id, message_id);

create index if not exists staff_message_classifications_staff
  on public.staff_message_classifications(staff_id, created_at);

comment on table public.staff_message_classifications is
  'P2.8 active staff classification label and evaluation annotations for inbound messages.';

-- Append-only historical log of all staff labeling and correction actions for traceability.
create table if not exists public.staff_message_classification_history (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  staff_id uuid not null references auth.users(id),
  labeled_category text not null check (labeled_category in ('connection_complaint', 'other', 'review')),
  status text not null check (status in ('confirmed', 'corrected')),
  notes text check (notes is null or (btrim(notes) <> '' and length(notes) <= 1000)),
  previous_category text check (previous_category is null or previous_category in ('connection_complaint', 'other', 'review')),
  original_category text not null check (btrim(original_category) <> ''),
  rule_version text not null check (btrim(rule_version) <> ''),
  matched_keywords jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists staff_message_classification_hist_msg
  on public.staff_message_classification_history(message_id, created_at desc);

create index if not exists staff_message_classification_hist_staff
  on public.staff_message_classification_history(staff_id, created_at desc);

comment on table public.staff_message_classification_history is
  'P2.8 append-only audit log of staff classification labeling and correction actions.';

-- Security and Permissions (aligned with D41, D66, D70):
-- Revoke all direct mutations from anon and authenticated.
-- Mutations must proceed strictly via validated backend application service.
-- Authenticated staff can SELECT for inbox review and evaluation metrics.
revoke all on public.staff_message_classifications, public.staff_message_classification_history from anon, authenticated;
grant select on public.staff_message_classifications, public.staff_message_classification_history to authenticated;

grant select, insert, update, delete on public.staff_message_classifications to service_role;
grant select, insert on public.staff_message_classification_history to service_role;
revoke update, delete on public.staff_message_classification_history from service_role;

alter table public.staff_message_classifications enable row level security;
alter table public.staff_message_classification_history enable row level security;

create policy staff_message_classifications_select on public.staff_message_classifications
  for select to authenticated using (true);

create policy staff_message_classification_history_select on public.staff_message_classification_history
  for select to authenticated using (true);

commit;
