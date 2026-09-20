-- ============================================================
  -- Customers
  -- Pelanggan ISP. Tidak berhubungan dengan akun login staf.
  -- ============================================================

  create table public.customers (
    id uuid primary key default gen_random_uuid(),

    customer_code text not null,
    display_name text not null,
    status text not null default 'active',

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint customers_customer_code_not_blank
      check (btrim(customer_code) <> ''),

    constraint customers_display_name_not_blank
      check (btrim(display_name) <> ''),

    constraint customers_status_valid
      check (status in ('active', 'inactive')),

    constraint customers_customer_code_unique
      unique (customer_code)
  );

  comment on table public.customers is
    'ISP customers. Separate from staff accounts stored in auth.users.';


  -- ============================================================
  -- Services
  -- Satu customer dapat memiliki lebih dari satu layanan.
  -- ============================================================

  create table public.services (
    id uuid primary key default gen_random_uuid(),

    customer_id uuid not null,
    service_code text not null,
    display_name text,
    status text not null default 'active',

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint services_customer_fk
      foreign key (customer_id)
      references public.customers (id)
      on delete restrict,

    constraint services_service_code_not_blank
      check (btrim(service_code) <> ''),

    constraint services_display_name_not_blank
      check (
        display_name is null
        or btrim(display_name) <> ''
      ),

    constraint services_status_valid
      check (status in ('active', 'inactive')),

    constraint services_service_code_unique
      unique (service_code)
  );

  create index services_customer_id_idx
    on public.services (customer_id);

  comment on table public.services is
    'Customer internet services. Prototype fixtures may use one service per customer.';


  -- ============================================================
  -- ODCs
  -- Topologi internal dummy. Belum merepresentasikan perangkat nyata.
  -- ============================================================

  create table public.odcs (
    id uuid primary key default gen_random_uuid(),

    odc_code text not null,
    display_name text,
    status text not null default 'active',

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint odcs_odc_code_not_blank
      check (btrim(odc_code) <> ''),

    constraint odcs_display_name_not_blank
      check (
        display_name is null
        or btrim(display_name) <> ''
      ),

    constraint odcs_status_valid
      check (status in ('active', 'inactive')),

    constraint odcs_odc_code_unique
      unique (odc_code)
  );

  comment on table public.odcs is
    'Dummy ODC topology used by the prototype.';


  -- ============================================================
  -- ODPs
  -- Setiap ODP dummy mempunyai satu ODC induk.
  -- ============================================================

  create table public.odps (
    id uuid primary key default gen_random_uuid(),

    odc_id uuid not null,
    odp_code text not null,
    display_name text,
    status text not null default 'active',

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint odps_odc_fk
      foreign key (odc_id)
      references public.odcs (id)
      on delete restrict,

    constraint odps_odp_code_not_blank
      check (btrim(odp_code) <> ''),

    constraint odps_display_name_not_blank
      check (
        display_name is null
        or btrim(display_name) <> ''
      ),

    constraint odps_status_valid
      check (status in ('active', 'inactive')),

    constraint odps_odp_code_unique
      unique (odp_code)
  );

  create index odps_odc_id_idx
    on public.odps (odc_id);

  comment on table public.odps is
    'Dummy ODP topology. Each ODP belongs to one ODC.';


  -- ============================================================
  -- Service topology
  -- Menyimpan versi dan riwayat mapping layanan ke ODP.
  -- valid_to null berarti mapping masih aktif.
  -- ============================================================

  create table public.service_topology (
    id uuid primary key default gen_random_uuid(),

    service_id uuid not null,
    odp_id uuid not null,

    mapping_version integer not null,
    source text not null default 'MOCK',

    valid_from timestamptz not null default now(),
    valid_to timestamptz,

    created_at timestamptz not null default now(),

    constraint service_topology_service_fk
      foreign key (service_id)
      references public.services (id)
      on delete restrict,

    constraint service_topology_odp_fk
      foreign key (odp_id)
      references public.odps (id)
      on delete restrict,

    constraint service_topology_mapping_version_positive
      check (mapping_version > 0),

    constraint service_topology_source_not_blank
      check (btrim(source) <> ''),

    constraint service_topology_valid_period
      check (
        valid_to is null
        or valid_to > valid_from
      ),

    constraint service_topology_service_version_unique
      unique (service_id, mapping_version)
  );

  -- Satu layanan hanya boleh mempunyai satu mapping aktif.
  create unique index service_topology_one_active_mapping_idx
    on public.service_topology (service_id)
    where valid_to is null;

  -- Mendukung pencarian semua layanan aktif pada satu ODP.
  create index service_topology_active_odp_idx
    on public.service_topology (odp_id)
    where valid_to is null;

  comment on table public.service_topology is
    'Versioned mapping between a service and its dummy ODP topology.';


  -- ============================================================
  -- Channel identities
  -- Identitas pengirim eksternal, bukan akun Supabase Auth.
  -- customer_id nullable agar pengirim tak dikenal tetap tersimpan.
  -- ============================================================

  create table public.channel_identities (
    id uuid primary key default gen_random_uuid(),

    channel text not null,
    channel_account_id text not null,
    sender_external_id text not null,
    display_name_snapshot text,

    customer_id uuid,
    verification_status text not null default 'unverified',
    verified_at timestamptz,
    verified_by uuid,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint channel_identities_customer_fk
      foreign key (customer_id)
      references public.customers (id)
      on delete restrict,

    constraint channel_identities_verified_by_fk
      foreign key (verified_by)
      references auth.users (id)
      on delete set null,

    constraint channel_identities_channel_not_blank
      check (
        btrim(channel) <> ''
        and channel = lower(channel)
      ),

    constraint channel_identities_account_not_blank
      check (btrim(channel_account_id) <> ''),

    constraint channel_identities_sender_not_blank
      check (btrim(sender_external_id) <> ''),

    constraint channel_identities_display_name_not_blank
      check (
        display_name_snapshot is null
        or btrim(display_name_snapshot) <> ''
      ),

    constraint channel_identities_verification_status_valid
      check (
        verification_status in ('unverified', 'verified')
      ),

    constraint channel_identities_verification_consistent
      check (
        (
          verification_status = 'unverified'
          and customer_id is null
          and verified_at is null
          and verified_by is null
        )
        or
        (
          verification_status = 'verified'
          and customer_id is not null
          and verified_at is not null
        )
      ),

    constraint channel_identities_channel_sender_unique
      unique (
        channel,
        channel_account_id,
        sender_external_id
      )
  );

  create index channel_identities_customer_id_idx
    on public.channel_identities (customer_id)
    where customer_id is not null;

  comment on table public.channel_identities is
    'External sender identities. A typed customer ID is not proof of ownership.';

  comment on column public.channel_identities.customer_id is
    'Nullable until the external sender has been verified and linked.';

  comment on column public.channel_identities.verified_by is
    'Optional staff actor from auth.users; null is allowed for seeded fixtures.';


  -- ============================================================
  -- Privileges
  -- Browser anon tidak boleh membaca atau menulis.
  -- Browser authenticated hanya boleh membaca.
  -- Mutasi dilakukan oleh backend tervalidasi menggunakan service_role.
  -- ============================================================

  revoke all privileges on table
    public.customers,
    public.services,
    public.channel_identities,
    public.odcs,
    public.odps,
    public.service_topology
  from anon, authenticated;

  grant select on table
    public.customers,
    public.services,
    public.channel_identities,
    public.odcs,
    public.odps,
    public.service_topology
  to authenticated;

  grant select, insert, update, delete on table
    public.customers,
    public.services,
    public.channel_identities,
    public.odcs,
    public.odps,
    public.service_topology
  to service_role;


  -- ============================================================
  -- Row Level Security
  -- Tidak ada policy INSERT/UPDATE/DELETE untuk authenticated.
  -- ============================================================

  alter table public.customers enable row level security;
  alter table public.services enable row level security;
  alter table public.channel_identities enable row level security;
  alter table public.odcs enable row level security;
  alter table public.odps enable row level security;
  alter table public.service_topology enable row level security;

  create policy customers_authenticated_read
    on public.customers
    for select
    to authenticated
    using (true);

  create policy services_authenticated_read
    on public.services
    for select
    to authenticated
    using (true);

  create policy channel_identities_authenticated_read
    on public.channel_identities
    for select
    to authenticated
    using (true);

  create policy odcs_authenticated_read
    on public.odcs
    for select
    to authenticated
    using (true);

  create policy odps_authenticated_read
    on public.odps
    for select
    to authenticated
    using (true);

  create policy service_topology_authenticated_read
    on public.service_topology
    for select
    to authenticated
    using (true);

  commit;