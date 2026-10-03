begin;

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('GENERAL', 'AREA_SPECIFIC')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'RESOLVED', 'CLOSED')),
  odp_ids text[] not null default '{}',
  odc_ids text[] not null default '{}',
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  check ((status = 'CLOSED') = (closed_at is not null)),
  check ((type = 'AREA_SPECIFIC' and (cardinality(odp_ids) > 0 or cardinality(odc_ids) > 0)) or type = 'GENERAL')
);

create unique index incidents_one_active on public.incidents((true)) where status = 'ACTIVE';

create table public.incident_activity_log (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id),
  actor_id uuid references auth.users(id),
  action text not null check (btrim(action) <> ''),
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

revoke all on public.incidents, public.incident_activity_log from anon, authenticated;
grant select on public.incidents, public.incident_activity_log to authenticated;
grant select, insert, update on public.incidents to service_role;
grant select, insert on public.incident_activity_log to service_role;

alter table public.incidents enable row level security;
alter table public.incident_activity_log enable row level security;

create policy incidents_staff_read on public.incidents for select to authenticated using (true);
create policy incident_activity_staff_read on public.incident_activity_log for select to authenticated using (true);

commit;
