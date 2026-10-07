begin;

-- Table to store per-staff explicit message read tracking for helpdesk inbox.
-- Messages not present in the staff's detail snapshot remain unread, even if delayed,
-- committed out-of-order, or sharing identical timestamps.
create table if not exists public.staff_message_reads (
  staff_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (staff_id, message_id)
);

create index if not exists staff_message_reads_conv_staff
  on public.staff_message_reads(conversation_id, staff_id);

comment on table public.staff_message_reads is
  'P2.6 per-staff per-message read tracking for helpdesk inbox. Prevents delayed or out-of-order uncommitted messages from being falsely marked read.';
comment on column public.staff_message_reads.message_id is
  'ID of the specific message explicitly acknowledged by the staff member.';
comment on column public.staff_message_reads.read_at is
  'Timestamp when the staff member acknowledged reading the message.';

-- Backfill existing staff_conversation_reads into staff_message_reads:
-- Messages received at or before last_read_at (or equal timestamp and id <= last_read_message_id)
-- are recorded as read under the same staff session.
insert into public.staff_message_reads (staff_id, conversation_id, message_id, read_at)
select
  scr.staff_id,
  scr.conversation_id,
  m.id,
  scr.last_read_at
from public.staff_conversation_reads scr
join public.messages m on m.conversation_id = scr.conversation_id
join public.ingress_events ie on ie.id = m.id
where ie.received_at < scr.last_read_at
   or (ie.received_at = scr.last_read_at and m.id <= scr.last_read_message_id)
on conflict (staff_id, message_id) do nothing;

-- Security and Permissions:
-- Strictly revoke direct mutations from anon and authenticated.
-- Marking read must proceed through validated backend application service.
-- Authenticated role retains SELECT on own rows via RLS.
revoke all on public.staff_message_reads from anon, authenticated;
grant select on public.staff_message_reads to authenticated;
grant select, insert, update, delete on public.staff_message_reads to service_role;

alter table public.staff_message_reads enable row level security;

create policy staff_message_reads_owner_select on public.staff_message_reads
  for select to authenticated using (auth.uid() = staff_id);

commit;
