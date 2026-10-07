-- Migration: 20261004110000_revoke_direct_staff_conversation_reads_mutation.sql
-- Description: Revoke direct mutation rights (INSERT, UPDATE, DELETE) from authenticated and anon
-- on public.staff_conversation_reads. Marking conversations as read must strictly proceed through
-- the validated backend application service. Authenticated role retains SELECT on own rows.

begin;

-- 1. Drop existing write policies for authenticated role
drop policy if exists staff_reads_owner_insert on public.staff_conversation_reads;
drop policy if exists staff_reads_owner_update on public.staff_conversation_reads;

-- 2. Revoke all direct mutation permissions from anon and authenticated
revoke insert, update, delete on public.staff_conversation_reads from anon, authenticated;

-- 3. Explicitly confirm select permission for authenticated (under owner_select policy)
grant select on public.staff_conversation_reads to authenticated;

-- 4. Retain full permissions for service_role (used by backend application service)
grant select, insert, update, delete on public.staff_conversation_reads to service_role;

commit;
