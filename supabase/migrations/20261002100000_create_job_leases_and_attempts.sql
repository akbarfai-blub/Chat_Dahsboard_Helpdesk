-- Migration: 20261002100000_create_job_leases_and_attempts.sql
-- Description: Expand processing_jobs with lease tokens, expiration, attempt tracking, backoff schedule,
-- and create processing_job_attempts for execution audit history.

begin;

-- 1. Alter processing_jobs
-- Drop old status and completed_at check constraints
alter table public.processing_jobs
  drop constraint if exists processing_jobs_status_check,
  drop constraint if exists processing_jobs_check;

-- Add new columns for leases, attempts, scheduling, and error tracking
alter table public.processing_jobs
  add column if not exists lease_token text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists max_attempts integer not null default 3,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists last_error text;

-- Add updated check constraints
alter table public.processing_jobs
  add constraint processing_jobs_status_check
    check (status in ('pending', 'in_progress', 'done', 'failed')),
  add constraint processing_jobs_completed_check
    check (((status in ('done', 'failed')) = (completed_at is not null))),
  add constraint processing_jobs_attempt_count_check
    check (attempt_count >= 0),
  add constraint processing_jobs_max_attempts_check
    check (max_attempts >= 1);

-- Create partial index for worker eligibility polling and claiming
create index if not exists processing_jobs_eligibility
  on public.processing_jobs (status, next_attempt_at, lease_expires_at)
  where status in ('pending', 'in_progress');

-- 2. Create processing_job_attempts table
create table if not exists public.processing_job_attempts (
  id uuid primary key default gen_random_uuid(),
  ingress_id uuid not null references public.processing_jobs(ingress_id) on delete cascade,
  attempt_number integer not null check (attempt_number >= 1),
  lease_token text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  outcome text not null check (outcome in ('in_progress', 'success', 'retryable_failure', 'terminal_failure', 'lease_expired')),
  error_message text,
  created_at timestamptz not null default now(),
  unique (ingress_id, attempt_number)
);

create index if not exists processing_job_attempts_ingress
  on public.processing_job_attempts(ingress_id, attempt_number);

-- 3. Security, RLS, and Grants
-- Protect mutations from browser (anon, authenticated)
revoke all on public.processing_job_attempts from anon, authenticated;
grant select on public.processing_job_attempts to authenticated;
grant select, insert, update, delete on public.processing_job_attempts to service_role;

alter table public.processing_job_attempts enable row level security;

create policy attempts_staff_read
  on public.processing_job_attempts
  for select
  to authenticated
  using (true);

commit;
