-- HISTORICAL SNAPSHOT: Mass Outage v1.x only; incomplete for unified PRD v2.0.
-- Active requirements: docs/PRD.md section 10. Do not apply this file directly.
-- Future executable schema source: supabase/migrations/.

-- ============================================================================
-- Chat Automation Upaznet Helpdesk — Database Schema (Prototype)
-- Basis: PRD v1.1 (§4.3, §8) + Addendum Incident Lifecycle (§2.3, §5)
--        + PRD_v1.2_Tech_Stack_Addendum.md (D37-D42)
-- Target: Supabase (PostgreSQL)
-- Status: Prototype schema — representasi teknis final (mis. estimated_recovery,
--         transition reason format) masih open item per PRD §16
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Enum types
-- ----------------------------------------------------------------------------

create type incident_type as enum ('GENERAL', 'AREA_SPECIFIC');
create type incident_state as enum ('ACTIVE', 'RESOLVED', 'CLOSED');
create type conversation_status as enum ('OPEN', 'CLOSED');
create type message_direction as enum ('inbound', 'outbound');
create type channel_type as enum ('telegram', 'whatsapp'); -- D38: abstraksi channel

-- ----------------------------------------------------------------------------
-- Table: incidents
-- Ref: PRD §4.3, §4.2 (state machine), Addendum §2.2-2.3
-- ----------------------------------------------------------------------------

create table incidents (
    incident_id         uuid primary key default gen_random_uuid(),
    type                incident_type not null,
    state               incident_state not null default 'ACTIVE',
    description         text,
    affected_areas      jsonb not null default '{"odp_ids": [], "odc_ids": []}'::jsonb,
    estimated_recovery  text, -- ASSUMPTION: text bebas ("sedang diidentifikasi" / timestamp string).
                               -- Representasi final belum diputuskan (PRD §16).

    activated_by        text not null,
    activated_at        timestamptz not null default now(),
    resolved_by         text,
    resolved_at         timestamptz,
    closed_by            text,
    closed_at           timestamptz,

    force_close_reason  text,
    reopen_count        integer not null default 0,

    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),

    -- H-001 (PRD §4.2): force_close_reason wajib trimmed non-empty
    -- HANYA saat force-close (ACTIVE -> CLOSED langsung, bukan RESOLVED -> CLOSED normal).
    -- Ditegakkan di application layer (D42) karena butuh tahu transition path,
    -- bukan cuma state akhir. Constraint di bawah cuma guard dasar tipe data:
    constraint force_close_reason_not_blank
        check (force_close_reason is null or btrim(force_close_reason) <> '')
);

-- Guard rail PRD §4.2: maksimal 1 incident ACTIVE pada satu waktu.
-- Partial unique index — hanya berlaku untuk baris berstatus ACTIVE.
create unique index one_active_incident_only
    on incidents ((state))
    where state = 'ACTIVE';

create index idx_incidents_state on incidents (state);

-- ----------------------------------------------------------------------------
-- Table: customers
-- Ref: PRD §8.1, Addendum §5.2, §4.3 (area cache)
-- ----------------------------------------------------------------------------

create table customers (
    id                   uuid primary key default gen_random_uuid(),

    -- D38: identitas primer digeneralisasi dari "wa_number" jadi channel-agnostic,
    -- supaya prototype (Telegram) dan production (WhatsApp) pakai struktur sama.
    channel              channel_type not null,
    channel_user_id      text not null, -- wa_number utk WA, telegram chat_id utk prototype

    custpanel_customer_id text, -- nullable, hasil lookup Custpanel (PRD §8.1: customer_id)

    last_known_odp_id    text,
    last_known_odc_id    text,
    area_cached_at       timestamptz, -- D40: dasar perhitungan TTL 24 jam, bukan Redis

    first_seen_at        timestamptz not null default now(),
    last_seen_at         timestamptz not null default now(),

    unique (channel, channel_user_id)
);

create index idx_customers_custpanel_id on customers (custpanel_customer_id);

-- ----------------------------------------------------------------------------
-- Table: conversations
-- Ref: PRD §8.2, Addendum §5.3 (window inactivity 24 jam = D25)
-- ----------------------------------------------------------------------------

create table conversations (
    conversation_id      uuid primary key default gen_random_uuid(),
    customer_id          uuid not null references customers (id),

    started_at           timestamptz not null default now(),
    last_message_at      timestamptz not null default now(),
    status                conversation_status not null default 'OPEN',

    incident_id          uuid references incidents (incident_id), -- nullable, D24
    escalated            boolean not null default false
);

create index idx_conversations_customer on conversations (customer_id);
create index idx_conversations_incident on conversations (incident_id);
create index idx_conversations_status on conversations (status);

-- ----------------------------------------------------------------------------
-- Table: response_templates
-- Ref: PRD §14 (template management), §3.1 (edit template per-incident)
-- Didefinisikan sebelum `messages` karena messages.reply_template_used
-- mereferensikan tabel ini.
-- ----------------------------------------------------------------------------

create table response_templates (
    id                   uuid primary key default gen_random_uuid(),
    incident_id          uuid references incidents (incident_id), -- nullable = template default
    type                 incident_type not null,
    content              text not null,

    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now()
);

create index idx_templates_incident on response_templates (incident_id);

-- ----------------------------------------------------------------------------
-- Table: messages
-- Ref: PRD §8.3, D20 (dedup by message_id)
-- ----------------------------------------------------------------------------

create table messages (
    id                   uuid primary key default gen_random_uuid(),
    conversation_id      uuid not null references conversations (conversation_id),

    channel              channel_type not null,
    external_message_id  text not null, -- message_id asli dari Telegram/WhatsApp

    direction            message_direction not null,
    message_text         text,

    auto_replied         boolean not null default false,
    reply_template_used  uuid references response_templates (id),

    received_at          timestamptz not null default now(),

    -- D39 / D20: dedup inbound webhook ditegakkan di level DB, bukan check-then-insert.
    -- Kombinasi (channel, external_message_id) harus unik.
    unique (channel, external_message_id)
);

create index idx_messages_conversation on messages (conversation_id);

-- ----------------------------------------------------------------------------
-- Table: auto_reply_debounce
-- Ref: PRD §3.1 (D10: 1x per nomor WA per incident), §13.3 (concurrency)
-- Tabel terpisah (bukan kolom di conversations) supaya constraint unik
-- bisa langsung mencegah race condition saat dua inbound message simultan.
-- ----------------------------------------------------------------------------

create table auto_reply_debounce (
    id                   uuid primary key default gen_random_uuid(),
    customer_id          uuid not null references customers (id),
    incident_id          uuid not null references incidents (incident_id),
    replied_at           timestamptz not null default now(),

    -- D39: INSERT ke tabel ini yang menentukan "sudah dibalas atau belum".
    -- Kalau INSERT gagal karena unique violation -> berarti sudah pernah dibalas,
    -- app logic treat sebagai "skip, no reply" tanpa perlu SELECT-then-INSERT.
    unique (customer_id, incident_id)
);

-- Catatan: Addendum §2.2 (D35) — debounce TIDAK direset saat incident reopen,
-- artinya row di tabel ini TIDAK dihapus saat RESOLVED -> ACTIVE (reopen).
-- incident_id yang sama dipertahankan saat reopen (lihat kolom reopen_count
-- di tabel incidents, bukan bikin incident_id baru).

-- ----------------------------------------------------------------------------
-- Table: incident_activity_log
-- Ref: PRD §3.3 (update tracking), §3.5 (force-close flag), Addendum §3.3
-- ----------------------------------------------------------------------------

create table incident_activity_log (
    id                   uuid primary key default gen_random_uuid(),
    incident_id          uuid not null references incidents (incident_id),

    actor_id             text not null,
    action               text not null, -- mis. 'CREATE', 'RESOLVE', 'REOPEN', 'CLOSE', 'FORCE_CLOSE', 'UPDATE_FIELD'
    field_changed         text,          -- nullable, diisi kalau action = 'UPDATE_FIELD'
    old_value            text,
    new_value            text,
    flag                 text,          -- mis. 'force_close' untuk review khusus (§3.5)

    created_at           timestamptz not null default now()
);

create index idx_activity_log_incident on incident_activity_log (incident_id);

-- ----------------------------------------------------------------------------
-- Row Level Security (D41)
-- Prototype: authenticated user = akses penuh, tidak ada policy granular per row
-- (selaras D18 — semua agen setara). Service-role key (dipakai webhook handler,
-- jalan tanpa user login) bypass RLS secara default di Supabase — JANGAN pernah
-- expose service-role key ke frontend/client-side code.
-- ----------------------------------------------------------------------------

alter table incidents enable row level security;
alter table customers enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table auto_reply_debounce enable row level security;
alter table response_templates enable row level security;
alter table incident_activity_log enable row level security;

create policy "authenticated_full_access" on incidents
    for all using (auth.role() = 'authenticated');
create policy "authenticated_full_access" on customers
    for all using (auth.role() = 'authenticated');
create policy "authenticated_full_access" on conversations
    for all using (auth.role() = 'authenticated');
create policy "authenticated_full_access" on messages
    for all using (auth.role() = 'authenticated');
create policy "authenticated_full_access" on auto_reply_debounce
    for all using (auth.role() = 'authenticated');
create policy "authenticated_full_access" on response_templates
    for all using (auth.role() = 'authenticated');
create policy "authenticated_full_access" on incident_activity_log
    for all using (auth.role() = 'authenticated');

-- ============================================================================
-- Open Items / Belum Diputuskan (jangan dianggap final):
-- - estimated_recovery masih text bebas, format final belum dikunci (PRD §16)
-- - Format transition reason untuk resolve/reopen belum ada kolom khusus
-- - Retention policy (Message Log 90 hari, Activity Log 1 tahun — PRD §13.2)
--   belum diimplementasikan sebagai scheduled job/cron di schema ini
-- - Index performance tuning untuk volume besar belum dipertimbangkan
--   (skala saat ini 1-100 chat/hari, belum perlu)
-- ============================================================================

