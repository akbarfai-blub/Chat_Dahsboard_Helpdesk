begin;

-- Add is_confirmed column to staff_message_reads to distinguish explicit staff snapshot
-- acknowledgements (true) from unconfirmed legacy range backfills (false).
alter table public.staff_message_reads
  add column if not exists is_confirmed boolean not null default true;

comment on column public.staff_message_reads.is_confirmed is
  'True if confirmed by an explicit staff snapshot acknowledgement; false for unconfirmed legacy backfilled rows.';

-- Mark existing rows backfilled by migration 20261004120000 as unconfirmed:
update public.staff_message_reads
set is_confirmed = false;

-- Add is_confirmed column to staff_conversation_reads to prevent unconfirmed legacy cursors
-- from being returned as valid effective read cursors.
alter table public.staff_conversation_reads
  add column if not exists is_confirmed boolean not null default true;

comment on column public.staff_conversation_reads.is_confirmed is
  'True if the conversation cursor was established by an explicit staff acknowledgement; false for unconfirmed legacy cursors.';

-- Mark existing legacy cursors as unconfirmed:
update public.staff_conversation_reads
set is_confirmed = false;

commit;
