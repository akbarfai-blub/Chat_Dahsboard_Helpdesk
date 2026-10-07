begin;

-- Table to store per-staff read cursor position for each conversation.
-- Supports idempotent monotonic advancement; reading up to a rendered message
-- does not mark concurrently arriving newer messages as read.
create table public.staff_conversation_reads (
  staff_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  last_read_message_id uuid not null references public.messages(id) on delete cascade,
  last_read_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (staff_id, conversation_id)
);

create index staff_conversation_reads_conv on public.staff_conversation_reads(conversation_id);

comment on table public.staff_conversation_reads is
  'P2.6 per-staff persistent unread tracking for helpdesk inbox. Isolated per staff session.';
comment on column public.staff_conversation_reads.last_read_message_id is
  'ID of the specific message rendered and marked read by the staff member.';
comment on column public.staff_conversation_reads.last_read_at is
  'Timestamp of the last_read_message_id at the time of reading (used for monotonic advancement).';

revoke all on public.staff_conversation_reads from anon, authenticated;
grant select, insert, update on public.staff_conversation_reads to authenticated;
grant select, insert, update, delete on public.staff_conversation_reads to service_role;

alter table public.staff_conversation_reads enable row level security;

create policy staff_reads_owner_select on public.staff_conversation_reads
  for select to authenticated using (auth.uid() = staff_id);

create policy staff_reads_owner_insert on public.staff_conversation_reads
  for insert to authenticated with check (auth.uid() = staff_id);

create policy staff_reads_owner_update on public.staff_conversation_reads
  for update to authenticated using (auth.uid() = staff_id) with check (auth.uid() = staff_id);

commit;
