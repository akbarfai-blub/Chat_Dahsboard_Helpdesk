# Panduan Konfigurasi dan Deployment Prototype SHADOW (P2.10)

Dokumen ini mendokumentasikan spesifikasi konfigurasi, target deployment, inventarisasi environment variable, prosedur migrasi, pengaturan webhook Telegram, dan langkah smoke test untuk Upaznet Helpdesk Automation.

---

## 1. Target Deployment dan Arsitektur Lingkungan

| Komponen | Target Prototype | Keterangan |
|---|---|---|
| **Hosting & Runtime** | Vercel (Next.js App Router, Node.js runtime) | Deployment HTTPS terisolasi dengan Serverless Functions dan `after()` job worker |
| **Database & Auth** | Supabase PostgreSQL + Supabase Auth | Database transaksional (`pg` driver) + Auth sesi staf (`@supabase/ssr`) |
| **Channel Adapter** | Telegram Bot API | Inbound webhook via HTTPS; allowlist tester ketat |
| **Mode Otomasi** | `SHADOW` | Evaluasi inbound penuh; tidak ada outbound otomatis atau klaim debounce |
| **Network Provider** | `mock` | MockProvider internal berversi; tanpa akses OLT/NMS nyata |

---

## 2. Inventarisasi Environment Variable

Berdasarkan audit kode aktual (`lib/supabase/auth-config.ts`, `lib/supabase/server.ts`, `lib/postgres/server.ts`, `lib/application/telegram-inbound-service.ts`, dan `lib/application/origin-validator.ts`):

| Nama Variabel | Cakupan / Visibilitas | Nilai Prototype / Format | Fungsi & Lokasi Pengaturan |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Publik (Browser & Server) | `https://<project-ref>.supabase.co` | URL endpoint API Supabase untuk klien browser dan auth session. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publik (Browser & Server) | String anon key Supabase | Kunci anon/publik untuk inisialisasi Supabase client browser. |
| `SUPABASE_URL` | Server-side saja (Private) | `https://<project-ref>.supabase.co` | Endpoint Supabase untuk Server Component (prioritas Tier 1 runtime). |
| `SUPABASE_ANON_KEY` | Server-side saja (Private) | String anon key Supabase | Kunci anon Supabase untuk runtime server SSR. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side saja (**Secret**) | String service-role key Supabase | Kunci admin untuk background job worker (`drainProcessingJobs`) dan background task. DILARANG menggunakan prefix `NEXT_PUBLIC_`. |
| `HELPDESK_DATABASE_URL` | Server-side saja (**Secret**) | `postgresql://postgres:[PASSWORD]@[HOST]:[PORT]/postgres?sslmode=verify-full` | Connection string PostgreSQL langsung/pooler untuk transaksi `inHelpdeskTransaction` (`pg`). Remote wajib TLS `sslmode=verify-full`. DILARANG menggunakan prefix `NEXT_PUBLIC_`. |
| `NETWORK_PROVIDER` | Server-side | `mock` | Mengarahkan provider jaringan ke MockProvider internal. |
| `TELEGRAM_BOT_ACCOUNT_ID` | Server-side | `upaznet_helpdesk_bot` | Identitas akun bot untuk partisi channel di database. |
| `TELEGRAM_TESTER_ALLOWLIST` | Server-side | `6727338166` (ID Telegram tester) | Daftar ID pengirim numerik Telegram yang diizinkan berinteraksi dengan prototype. |
| `TELEGRAM_WEBHOOK_SECRET` | Server-side (**Secret**) | String acak token (1–256 karakter) | Dicocokkan dengan header `X-Telegram-Bot-Api-Secret-Token` saat Telegram mengirimkan webhook update. |
| `TELEGRAM_BOT_TOKEN` | Eksternal / CLI (**Secret**) | Token Bot API Telegram (`8892832714:...`) | Digunakan untuk mengelola webhook (`setWebhook`, `getWebhookInfo`). Tidak dipanggil langsung oleh runtime inbound web server. |
| `ENABLE_TEST_RUNTIME_DIAGNOSTICS` | Server-side | *Tidak diset* atau `false` | Diagnostik pengujian unit/integrasi. Dilarang aktif pada deployment prototype. |

---

## 3. Skema Database dan Migrasi

Target database prototype wajib menjalankan 13 migrasi resmi dari `supabase/migrations/`:

1. `20260919115958_create_customer_identity_topology.sql`
2. `20260920090000_create_mock_network_status.sql`
3. `20260922090000_create_episode_persistence.sql`
4. `20260929100000_add_ingress_metadata.sql`
5. `20260929200000_create_conversation_persistence.sql`
6. `20260929200001_adjust_conversation_foreign_keys.sql`
7. `20260930100000_create_manual_incidents.sql`
8. `20261002100000_create_job_leases_and_attempts.sql`
9. `20261004100000_create_staff_conversation_reads.sql`
10. `20261004110000_revoke_direct_staff_conversation_reads_mutation.sql`
11. `20261004120000_create_staff_message_reads.sql`
12. `20261004130000_correct_legacy_message_read_backfill.sql`
13. `20261012100000_create_staff_classification_labels.sql`

### Menjalankan Migrasi ke Database Target
Gunakan script migrasi idempoten yang tersedia:
```bash
node scripts/apply-prototype-migrations.mjs "<TARGET_HELPDESK_DATABASE_URL>"
```
*Script ini mengecek tabel `supabase_migrations.schema_migrations`, mengabaikan migrasi yang sudah ada, dan menjalankan migrasi yang tersisa dalam transaksi terpisah tanpa reset data.*

### Menjalankan Seed Data Dummy dan Tester
Gunakan script seeder idempoten:
```bash
node scripts/apply-prototype-seed.mjs "<TARGET_HELPDESK_DATABASE_URL>"
```
*Script ini menerapkan `seed.sql` dan `fixtures/network.sql` (`ON CONFLICT DO NOTHING`), memastikan akun singleton `automation_settings` berada pada mode `SHADOW`, serta mendaftarkan tester Telegram (`6727338166`) pada `public.channel_identities`.*

---

## 4. Pengaturan Webhook Telegram

Bot Prototype: `@upaznet_helpdesk_proto_bot` (ID: `8892832714`).

### Pengecekan Status Webhook
```bash
node scripts/manage-telegram-webhook.mjs status
```

### Pemasangan Webhook ke Deployment HTTPS
```bash
node scripts/manage-telegram-webhook.mjs set "https://<VERCEL_DOMAIN>/api/webhooks/telegram" "<TELEGRAM_WEBHOOK_SECRET>"
```
*Script menyetel `drop_pending_updates: false` dan `allowed_updates: ["message", "edited_message"]` secara aman.*

### Pemulihan (Rollback) Webhook
Jika deployment dihentikan atau perlu dialihkan kembali ke URL sebelumnya:
```bash
node scripts/manage-telegram-webhook.mjs restore "<PREVIOUS_WEBHOOK_URL>" "<TELEGRAM_WEBHOOK_SECRET>"
```

---

## 5. Smoke Test Deployment

Gunakan script automated smoke test:
```bash
node scripts/smoke-test-deployment.mjs "https://<VERCEL_DOMAIN>" "<TARGET_HELPDESK_DATABASE_URL>"
```

Suite menguji secara konkret:
1. **HTTPS Reachability**: Memastikan server dapat dijangkau melalui protokol HTTPS aman.
2. **Proteksi Autentikasi**: Memastikan `/dashboard` melakukan redirect (307/302) ke `/login` bagi request tanpa sesi staf, dan `/api/inbox/conversations` menolak dengan HTTP 401.
3. **Keamanan Webhook**: Menguji bahwa request tanpa token secret atau dengan secret yang salah ditolak (HTTP 401 Unauthorized) dan membuktikan zero data mutation pada tabel `ingress_events`.
4. **Ingestion & SHADOW**: Mengirimkan update dummy dari ID tester allowlist (`6727338166`) dengan secret valid, memverifikasi HTTP 200 accepted, dan membuktikan:
   - Event tersimpan di `ingress_events`.
   - Job tersimpan di `processing_jobs` dan diproses.
   - Pesan tersimpan di `messages`.
   - Mode operasional tetap `SHADOW`.
   - **TIDAK ada** `outbound_intents` yang dibuat atau terkirim.
   - **TIDAK ada** `reply_claims` yang terkunci (preservasi guard debounce).
