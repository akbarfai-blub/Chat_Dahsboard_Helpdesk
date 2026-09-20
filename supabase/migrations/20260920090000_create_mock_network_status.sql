begin;

create table public.mock_network_scenarios (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{0,63}$'),
  description text not null check (btrim(description) <> ''),
  onu_failure text not null default 'none' check (onu_failure in ('none','error','timeout')),
  upstream_failure text not null default 'none' check (upstream_failure in ('none','error','timeout')),
  created_at timestamptz not null default now()
);
create table public.mock_onu_status (
  scenario_id text not null references public.mock_network_scenarios(id) on delete restrict,
  service_id uuid not null references public.services(id) on delete restrict,
  status text not null check (status in ('LOS','online','unknown')),
  source text not null default 'MOCK' check (source = 'MOCK'),
  observed_at timestamptz,
  event_id uuid,
  primary key (scenario_id, service_id)
);
create table public.mock_upstream_status (
  scenario_id text not null references public.mock_network_scenarios(id) on delete restrict,
  link_id text not null check (btrim(link_id) <> ''),
  status text not null check (status in ('up','down','unknown')),
  source text not null default 'MOCK' check (source = 'MOCK'),
  observed_at timestamptz,
  event_id uuid,
  primary key (scenario_id, link_id),
  constraint mock_down_requires_event check (status <> 'down' or event_id is not null)
);
create table public.mock_upstream_impacts (
  scenario_id text not null,
  link_id text not null,
  service_id uuid not null,
  mapping_version integer not null,
  primary key (scenario_id, link_id, service_id),
  foreign key (scenario_id, link_id)
    references public.mock_upstream_status(scenario_id, link_id) on delete restrict,
  foreign key (service_id, mapping_version)
    references public.service_topology(service_id, mapping_version) on delete restrict
);
create index mock_upstream_impacts_service_idx
  on public.mock_upstream_impacts(service_id, scenario_id);

comment on table public.mock_network_scenarios is
  'Isolated prototype fixtures. Faults simulate monitoring failures, never physical outages.';
comment on table public.mock_onu_status is
  'Dummy observations; timestamps are persisted and never refreshed by reading.';
comment on table public.mock_upstream_impacts is
  'Explicit affected services tied to a topology version; no inference from ONU LOS.';

revoke all on public.mock_network_scenarios, public.mock_onu_status,
  public.mock_upstream_status, public.mock_upstream_impacts from anon, authenticated;
grant select on public.mock_network_scenarios, public.mock_onu_status,
  public.mock_upstream_status, public.mock_upstream_impacts to authenticated;
grant select, insert, update, delete on public.mock_network_scenarios, public.mock_onu_status,
  public.mock_upstream_status, public.mock_upstream_impacts to service_role;

alter table public.mock_network_scenarios enable row level security;
alter table public.mock_onu_status enable row level security;
alter table public.mock_upstream_status enable row level security;
alter table public.mock_upstream_impacts enable row level security;
create policy mock_scenarios_staff_read on public.mock_network_scenarios
  for select to authenticated using (true);
create policy mock_onu_staff_read on public.mock_onu_status
  for select to authenticated using (true);
create policy mock_upstream_staff_read on public.mock_upstream_status
  for select to authenticated using (true);
create policy mock_impacts_staff_read on public.mock_upstream_impacts
  for select to authenticated using (true);
commit;

