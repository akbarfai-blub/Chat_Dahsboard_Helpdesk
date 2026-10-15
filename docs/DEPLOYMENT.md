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
| `HELPDESK_DB_CA` / `SUPABASE_DB_CA` | Server-side saja (Opsional) | PEM Certificate string | Override sertifikat CA root PostgreSQL jika diperlukan (default runtime otomatis membaca `certs/prod-ca-2021.crt` dan fallback ke konstanta terikat Supabase Root 2021 CA). |
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
*Script ini:*
- Memvalidasi protokol (`postgres:`, `postgresql:`) dan mewajibkan `sslmode=verify-full` untuk remote database host (menolak `sslmode=disable` dan menghapus fallback `rejectUnauthorized: false`).
- Memeriksa tabel `supabase_migrations.schema_migrations`, mengabaikan migrasi yang sudah tercatat.
- Menggunakan `stripOuterTransactionWrapper` untuk menghapus pembungkus `BEGIN/COMMIT` terluar dari berkas SQL migrasi.
- Menjalankan perubahan skema DDL dan pencatatan nomor versi ke `supabase_migrations.schema_migrations` dalam **satu transaksi PostgreSQL atomik tunggal per berkas migrasi**, menjamin rollback penuh bila terjadi kegagalan sebelum commit.

### Menjalankan Seed Data Dummy dan Tester
Gunakan script seeder idempoten:
```bash
node scripts/apply-prototype-seed.mjs "<TARGET_HELPDESK_DATABASE_URL>"
```
*Script ini:*
- Memvalidasi koneksi dengan paritas TLS runtime (`sslmode=verify-full` untuk remote host).
- Menerapkan `seed.sql` dan `fixtures/network.sql` (`ON CONFLICT DO NOTHING`).
- Memeriksa baris singleton `automation_settings`. Hanya mengonfirmasi jaminan SHADOW jika mode aktual adalah `SHADOW` (`shadowGuaranteed: true`). Jika mode berbeda, memberikan peringatan eksplisit dan mendukung opsi fail-closed `requireShadow: true`.
- Mendaftarkan tester Telegram (`6727338166`) pada `public.channel_identities`.

---

## 4. Pengaturan Webhook Telegram

Bot Prototype: `@upaznet_helpdesk_proto_bot` (ID: `8892832714`).

### Pengecekan Status Webhook
```bash
node scripts/manage-telegram-webhook.mjs status
```

### Aturan Validasi Endpoint Telegram API
Script menerapkan validasi ketat terhadap URL API Telegram (`options.apiBaseUrl` / `TELEGRAM_API_BASE_URL`):
- **Default**: `https://api.telegram.org`.
- **Protokol yang Didukung**: Hanya `http:` dan `https:`. Protokol lain (`ftp:`, `ws:`, `file:`, dll.) ditolak secara *fail-closed*.
- **HTTP Loopback Only**: Protokol `http:` secara ketat hanya diizinkan untuk loopback fixture pengujian lokal (`localhost`, `127.0.0.1`, dan `::1` setelah normalisasi bracket IPv6).
- **Anti-Bypass Hostname**: Pencocokan substring atau prefix yang menyerupai loopback (misalnya `localhost.example.com` atau `127.0.0.1.example.com`) ditolak secara presisi.
- **Wajib HTTPS untuk Nonlokal**: Seluruh host nonlokal wajib menggunakan HTTPS dengan verifikasi sertifikat TLS bawaan (tanpa `rejectUnauthorized: false` atau pelemahan TLS).
- **Sanitasi Kredensial & Pre-Flight Rejection**: URL tidak valid, URL yang memuat kredensial (`user:pass`), atau HTTP nonlokal ditolak seketika sebelum memanggil `http.request` maupun `https.request` (zero-transport invocation), dengan pesan error bersih tanpa membocorkan bot token atau webhook secret.
- **CLI Exit Code**: Jika `TELEGRAM_API_BASE_URL` tidak valid, CLI langsung keluar dengan exit code 1.

### Pemasangan Webhook ke Deployment HTTPS
```bash
node scripts/manage-telegram-webhook.mjs set "https://<VERCEL_DOMAIN>/api/webhooks/telegram" "<TELEGRAM_WEBHOOK_SECRET>"
```
*Script menyetel `drop_pending_updates: false`, menangani penolakan API (`ok: false`) atau HTTP status non-200 dengan exit nonzero, serta memverifikasi kesesuaian URL aktual melalui `getWebhookInfo` sebelum menyatakan pemasangan sukses.*

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

> **Batas Bukti & Status**: Runner ini dan seluruh tooling deployment telah diverifikasi perilakunya secara komprehensif pada basis data terisolasi, spy transport, dan fixture loopback (`tests/tooling/deployment-tooling.test.mjs`, 42/42 checks PASS, D144–D148). Bukti pengujian transport/CLI Telegram lokal terkontrol (penanganan HTTP non-200, JSON rusak, timeout transport, exit code CLI) dan pengamanan validasi endpoint URL telah ditutup secara konkret, terpisah dari kebutuhan deployment dan smoke test remote nyata. Pelaksanaan smoke test pada deployment remote nyata tetap merupakan pekerjaan terbuka berikutnya yang menunggu linking target Vercel/Supabase oleh pengguna.

### Konvensi Parameter & Variabel Environment Runner

Runner `scripts/smoke-test-deployment.mjs` membaca konfigurasi dengan aturan dan prioritas berikut:

1. **Argumen CLI Posisional**:
   - Argumen 1 (`argv[2]`): Target Base URL (contoh: `"https://<VERCEL_DOMAIN>"`).
   - Argumen 2 (`argv[3]`): Connection string target database PostgreSQL (contoh: `"<TARGET_HELPDESK_DATABASE_URL>"`).

2. **Hierarki Variabel Environment**:
   - **`baseUrl` (URL Target Deployment)**:
     - Prioritas 1: Argumen CLI `argv[2]`
     - Prioritas 2: `process.env.DEPLOYMENT_URL` (hanya dari environment proses shell)
     - Default: `'http://localhost:3000'`
     - *Catatan penting*: Runner **sengaja tidak membaca URL target dari `.env.local`** agar pengujian lokal tidak secara tidak sengaja tertukar dengan deployment remote atau sebaliknya. URL target harus diberikan secara eksplisit melalui argumen CLI atau `DEPLOYMENT_URL`.
   - **`dbUrl` (Database URL)**:
     - Prioritas 1: Argumen CLI `argv[3]`
     - Prioritas 2: `process.env.HELPDESK_DATABASE_URL`
     - Prioritas 3: `HELPDESK_DATABASE_URL` dari berkas `.env.local`
     - Wajib tersedia (jika kosong, Check 3 / koneksi database langsung gagal).
   - **`supabaseUrl`**:
     - Urutan prioritas: `process.env.SUPABASE_URL` → `.env.local: SUPABASE_URL` → `process.env.NEXT_PUBLIC_SUPABASE_URL` → `.env.local: NEXT_PUBLIC_SUPABASE_URL`.
   - **`supabaseAnonKey`**:
     - Urutan prioritas: `process.env.SUPABASE_ANON_KEY` → `.env.local: SUPABASE_ANON_KEY` → `process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` → `.env.local: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
   - **`staffEmail`**:
     - Urutan prioritas: `process.env.STAFF_EMAIL` → `.env.local: STAFF_EMAIL`.
   - **`staffPassword`**:
     - Urutan prioritas: `process.env.STAFF_PASSWORD` → `.env.local: STAFF_PASSWORD`.
   - **`webhookSecret`**:
     - Urutan prioritas: `process.env.TELEGRAM_WEBHOOK_SECRET` → `.env.local: TELEGRAM_WEBHOOK_SECRET`.
   - **`testerId`**:
     - Urutan prioritas: `process.env.TELEGRAM_TESTER_ALLOWLIST` → `.env.local: TELEGRAM_TESTER_ALLOWLIST`.
     - Default: `'6727338166'`.

Suite menguji secara konkret tanpa placeholder:
1. **HTTPS Reachability**: Memastikan server dapat dijangkau melalui protokol HTTPS aman.
2. **Proteksi Autentikasi Publik**: Memastikan `/dashboard` melakukan redirect (307/302) strictly ke `/login` pada target origin yang sama via `isValidLoginRedirect` (menolak respons 200 dengan Location, tujuan non-login, serta off-origin baik URL absolut, protocol-relative `//other.example/login`, maupun skema uppercase `HTTPS://other.example/login`), dan `/api/inbox/conversations` menolak dengan HTTP 401.
3. **Koneksi Database & TLS**: Memvalidasi koneksi ke PostgreSQL target dengan paritas TLS runtime (`sslmode=verify-full`). Ketiadaan koneksi DB menggagalkan pengujian secara eksplisit.
4. **Keamanan Webhook & Zero Mutation**: Menguji penolakan request tanpa secret token dan request dengan secret salah (HTTP 401), serta memverifikasi **zero database mutation** melalui perbandingan hitungan riil baris `public.ingress_events` sebelum dan sesudah probe penolakan.
5. **Pre-Ingestion Guard**: Memeriksa `public.automation_settings` di database sebelum mengirim pesan uji. Jika mode bukan `SHADOW` atau `emergency_stop` aktif, injeksi pesan uji dihentikan seketika untuk melindungi operasi live.
6. **Ingestion Webhook, Envelope & Skema Presisi**: Mengirimkan update dummy dari ID tester allowlist (`6727338166`) dengan secret valid. Memverifikasi envelope respons HTTP 200 (`status === 'accepted'`, `duplicate === false`, string `ingressId`).
7. **Bounded Polling & Verifikasi Database**:
   - Memantau penyelesaian worker via polling berbatas waktu (`public.processing_jobs.status === 'done'`) hingga selesai atau timeout/gagal eksplisit.
   - Memverifikasi entri tersimpan di `ingress_events` (`chat_id`, `provider_message_id`, mode `SHADOW`).
   - Memverifikasi entri pesan di `messages` (`classification`, `conversation_id`).
   - Memverifikasi entri `triage_assessments`.
   - Memverifikasi preservasi guard: **0 baris** `outbound_intents` (tidak ada outbound otomatis) dan **0 baris** `reply_claims` (tidak ada klaim debounce) akibat pesan uji tersebut.
8. **Autentikasi Staf Nyata & Siklus Sesi**:
   - Melakukan login staf nyata melalui `@supabase/ssr` (`signInWithPassword`). Ketiadaan kredensial staf atau URL/key Supabase menggagalkan pengujian secara eksplisit.
   - Mengakses `/dashboard` dengan cookie sesi aktif (harus HTTP 200).
   - Mengakses `/api/inbox/conversations` dengan cookie sesi aktif (harus HTTP 200).
   - Melakukan logout nyata (`signOut`) dengan evaluasi nilai error (kegagalan signOut menggagalkan pengujian).
   - Memverifikasi penolakan akses pasca-logout (redirect strictly ke `/login` pada dashboard dan HTTP 401 pada endpoint API).
9. **Hasil Keseluruhan**: Status `allPassed: true` hanya diberikan jika seluruh 7 pemeriksaan wajib dijalankan dan bernilai lulus (`pass: true`).

