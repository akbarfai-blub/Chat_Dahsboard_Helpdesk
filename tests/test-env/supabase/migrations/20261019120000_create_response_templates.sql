begin;

-- 1. Add description and estimated_recovery to public.incidents
alter table public.incidents
  add column if not exists description text,
  add column if not exists estimated_recovery text;

-- 2. Create public.response_templates
create table public.response_templates (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('default', 'incident')),
  incident_id uuid references public.incidents(id) on delete cascade,
  template_key text not null check (template_key in ('MASS_GENERAL', 'MASS_AREA', 'NETWORK_DISRUPTION', 'LOS_AREA', 'LOS_INDIVIDUAL', 'ONLINE_CHECK', 'GENERIC')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope = 'default' and incident_id is null) or
    (scope = 'incident' and incident_id is not null)
  )
);

create unique index response_templates_default_key
  on public.response_templates(template_key)
  where scope = 'default';

create unique index response_templates_incident_key
  on public.response_templates(incident_id, template_key)
  where scope = 'incident';

-- 3. Create public.template_versions
create table public.template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.response_templates(id) on delete cascade,
  version integer not null check (version > 0),
  body text not null check (btrim(body) <> '' and length(body) <= 4096),
  is_active boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (template_id, version)
);

create unique index template_versions_one_active
  on public.template_versions(template_id)
  where is_active = true;

-- 4. Permissions & RLS
revoke all on public.response_templates, public.template_versions from anon, authenticated;
grant select on public.response_templates, public.template_versions to authenticated;
grant select, insert, update, delete on public.response_templates, public.template_versions to service_role;

alter table public.response_templates enable row level security;
alter table public.template_versions enable row level security;

create policy response_templates_staff_read
  on public.response_templates for select to authenticated using (true);

create policy template_versions_staff_read
  on public.template_versions for select to authenticated using (true);

-- 5. Seed the 7 default response templates and versions (idempotent)
insert into public.response_templates (id, scope, incident_id, template_key)
values
  ('70000000-0000-4000-8000-000000000001', 'default', null, 'MASS_GENERAL'),
  ('70000000-0000-4000-8000-000000000002', 'default', null, 'MASS_AREA'),
  ('70000000-0000-4000-8000-000000000003', 'default', null, 'NETWORK_DISRUPTION'),
  ('70000000-0000-4000-8000-000000000004', 'default', null, 'LOS_AREA'),
  ('70000000-0000-4000-8000-000000000005', 'default', null, 'LOS_INDIVIDUAL'),
  ('70000000-0000-4000-8000-000000000006', 'default', null, 'ONLINE_CHECK'),
  ('70000000-0000-4000-8000-000000000007', 'default', null, 'GENERIC')
on conflict (id) do nothing;

insert into public.template_versions (id, template_id, version, body, is_active)
values
  ('71000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 1, 'Saat ini terdapat gangguan jaringan yang berdampak luas. Laporan Anda sudah masuk antrean helpdesk. Estimasi pemulihan: {{estimated_recovery}}.', true),
  ('71000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000002', 1, 'Saat ini terdapat gangguan jaringan di area layanan Anda. Laporan Anda sudah masuk antrean helpdesk. Estimasi pemulihan: {{estimated_recovery}}.', true),
  ('71000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000003', 1, 'Terdeteksi indikasi gangguan jaringan yang memengaruhi layanan Anda. Laporan Anda sudah masuk antrean helpdesk.', true),
  ('71000000-0000-4000-8000-000000000004', '70000000-0000-4000-8000-000000000004', 1, 'Terdeteksi indikasi gangguan sinyal yang juga terlihat pada beberapa koneksi di area Anda. Laporan Anda sudah masuk antrean helpdesk.', true),
  ('71000000-0000-4000-8000-000000000005', '70000000-0000-4000-8000-000000000005', 1, 'Terdeteksi indikasi gangguan sinyal pada koneksi Anda. Laporan Anda sudah masuk antrean helpdesk untuk diperiksa.', true),
  ('71000000-0000-4000-8000-000000000006', '70000000-0000-4000-8000-000000000006', 1, 'Perangkat koneksi Anda terdeteksi online saat pengecekan. Keluhan Anda tetap kami teruskan ke helpdesk untuk pemeriksaan lebih lanjut.', true),
  ('71000000-0000-4000-8000-000000000007', '70000000-0000-4000-8000-000000000007', 1, 'Mohon maaf atas kendalanya. Kondisi koneksi Anda belum dapat kami pastikan. Laporan Anda sudah masuk antrean helpdesk untuk pemeriksaan manual.', true)
on conflict (id) do nothing;

-- 6. Extend public.outbound_intents with snapshot columns and relaxed body check
alter table public.outbound_intents
  add column if not exists template_version_id uuid references public.template_versions(id),
  add column if not exists template_key text,
  add column if not exists template_version integer check (template_version is null or template_version > 0),
  add column if not exists template_scope text check (template_scope is null or template_scope in ('default', 'incident')),
  add column if not exists template_error text;

-- Drop previous anonymous/named check constraint on origin/fields in public.outbound_intents and add updated constraint
alter table public.outbound_intents drop constraint if exists outbound_intents_check;
alter table public.outbound_intents drop constraint if exists outbound_intents_origin_fields_check;

alter table public.outbound_intents add constraint outbound_intents_origin_fields_check check (
  (origin = 'automatic'
    and owner_id is not null
    and message_id is not null
    and decision is not null
    and staff_id is null
    and client_request_id is null
    and (body is null or (btrim(body) <> '' and length(body) <= 10000)))
  or
  (origin = 'staff'
    and owner_id is null
    and message_id is null
    and decision is null
    and staff_id is not null
    and client_request_id is not null
    and body is not null
    and btrim(body) <> ''
    and length(body) <= 10000)
);

commit;
