# P2.2 — Webhook Telegram dengan Secret dan ACK Persisten (Review & Penutupan Bukti)

**Tanggal:** 29 September 2026 · **Status:** ✅ Selesai (Done)  
**Acuan:** [docs/PRD.md](PRD.md) §10, §11 · [docs/decision-log.md](decision-log.md) D68, D77, D82, D83, D84 · [docs/TRACKER.md](TRACKER.md)  
**File Terkait:**  
- [`app/api/webhooks/telegram/route.ts`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/app/api/webhooks/telegram/route.ts)
- [`lib/application/telegram-inbound-service.ts`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/lib/application/telegram-inbound-service.ts)
- [`lib/application/persistence-contracts.ts`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/lib/application/persistence-contracts.ts)
- [`lib/application/helpdesk-persistence.ts`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/lib/application/helpdesk-persistence.ts)
- [`lib/adapters/telegram/telegram-adapter.ts`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/lib/adapters/telegram/telegram-adapter.ts)
- [`supabase/migrations/20260929100000_add_ingress_metadata.sql`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/supabase/migrations/20260929100000_add_ingress_metadata.sql)
- [`tests/application/telegram-inbound-service.test.ts`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/tests/application/telegram-inbound-service.test.ts)
- [`tests/integration/telegram-webhook.test.ts`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/tests/integration/telegram-webhook.test.ts)
- [`.env.example`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/.env.example)

---

## 1. Ringkasan Implementasi

Task P2.2 mengimplementasikan endpoint penerima webhook Telegram resmi (`POST /api/webhooks/telegram`) dengan alur pemrosesan aman dan persisten:
1. **Verifikasi Secret Token Terlebih Dahulu (*Fail-Closed*):**
   - Header `X-Telegram-Bot-Api-Secret-Token` diverifikasi terhadap variabel environment server `TELEGRAM_WEBHOOK_SECRET` menggunakan fungsi perbandingan waktu konstan (`crypto.timingSafeEqual`).
   - Secret yang hilang, salah, atau konfigurasi server yang kosong langsung digagalkan tertutup dengan HTTP 401 Unauthorized sebelum pembacaan body atau pemanggilan factory database.
   - Endpoint menggunakan autentikasi webhook terisolasi; sesi staf tidak dilibatkan dan proteksi sesi login staf tidak dilemahkan.
2. **Proteksi Memori & Pembacaan Body Berbatas Keras (*Streaming Body Limit*):**
   - Fungsi `readLimitedRequestBody` membaca body stream secara bertahap dan langsung membatalkan stream (*early abort*) jika total akumulasi byte melebihi batas (default 64 KB / 65.536 byte).
   - Perlindungan ini bekerja bahkan jika header `Content-Length` tidak disertakan klien atau dipalsukan, menghasilkan HTTP 413 Payload Too Large.
3. **Inisialisasi Persistence Lazy & Penanganan Error Terstruktur:**
   - Inisialisasi pool database `getHelpdeskPool()` dibungkus dalam lazy factory (`defaultPersistenceFactory`) yang hanya dipanggil setelah secret token dan ukuran payload valid.
   - Kesalahan konfigurasi database (misal `HELPDESK_DATABASE_URL` kosong atau connection string invalid) ditangani terstruktur menghasilkan HTTP 500 dengan kode `DATABASE_UNAVAILABLE` tanpa mengekspos connection string, kredensial, atau stack trace.
4. **Delegasi Adapter & Resolusi Metadata D82:**
   - Payload diproses melalui `TelegramChannelAdapter` (P2.1).
   - Menjawab kebutuhan D82, migrasi `20260929100000_add_ingress_metadata.sql` dan perluasan `HelpdeskPersistence.receive()` menyimpan metadata normalisasi kaya (`message_type`, `has_media`, `is_forwarded`, `caption`, `sent_at`, dan `sender_info`) secara atomik ke tabel `ingress_events`.
5. **Persistensi Atomik, Idempotensi, & Semantik ACK:**
   - Ingress event, metadata, dan processing job (`status = 'pending'`) di-commit secara atomik di dalam satu transaksi database (`inHelpdeskTransaction`).
   - Respons sukses diterima (`HTTP 200 { success: true, data: { status: "accepted" } }`) hanya diberikan jika commit berhasil.
   - Duplikat sekuensial maupun paralel (race condition) dicegah oleh unique constraint `(channel, account_id, chat_id, provider_message_id)`. Duplikat mengembalikan HTTP 200 dengan `duplicate: true` tanpa menambah job atau menimpa metadata asli.
   - Update tak didukung (`edited_message`) dan penolakan kebijakan tester (non-tester, grup, allowlist kosong) menghasilkan HTTP 200 dengan `{ success: true, data: { status: "ignored" | "rejected", reason } }` tanpa mutasi database, guna mencegah Telegram melakukan pengiriman ulang tanpa batas.
   - Kegagalan transaksi/database mengembalikan HTTP 500 `PERSISTENCE_FAILED` sehingga Telegram Bot API akan menjadwalkan retry secara berkala.
6. **Non-interferensi Jalur ACK:**
   - Jalur webhook murni bertugas menerima dan mencatat (*store & acknowledge*). Tidak ada pemanggilan provider jaringan, penentuan keputusan triage, eksekusi worker, maupun pengiriman pesan outbound pada jalur ini.

---

## 2. Pemetaan Status Respons HTTP

Endpoint mengikuti amplop standar aplikasi:
- Sukses: `{ "success": true, "data": { ... }, "error": null }`
- Gagal: `{ "success": false, "data": null, "error": { "code": "...", "message": "..." } }`

| Kondisi Request | HTTP Status | Error Code / Data Status | Mutasi DB | Alasan & Semantik Telegram |
|---|---|---|---|---|
| Secret token hilang, salah, atau secret server kosong | **401 Unauthorized** | `error.code: "UNAUTHORIZED"` | **Tidak** | Menolak pengirim tak berwenang seketika sebelum membaca body atau memanggil factory database. |
| Ukuran body melebihi batas 64 KB (dengan/tanpa header `Content-Length`) | **413 Payload Too Large** | `error.code: "PAYLOAD_TOO_LARGE"` | **Tidak** | Melindungi memori runtime dari serangan DoS / buffer exhaustion. |
| Sintaks JSON rusak atau struktur payload Telegram invalid | **400 Bad Request** | `error.code: "INVALID_JSON"` / `INVALID_PAYLOAD_STRUCTURE` | **Tidak** | Payload malformed yang tidak dapat di-parse secara sintaksis. |
| Update protokol valid tetapi belum didukung (mis. `edited_message`) | **200 OK** | `data: { status: "ignored", reason: "edited_message_ignored" }` | **Tidak** | ACK sukses ke Telegram agar Telegram menghentikan retry loop untuk event yang sengaja diabaikan prototype. |
| Pelanggaran kebijakan tester (bukan tester, chat grup, allowlist kosong) | **200 OK** | `data: { status: "rejected", reason: "not_in_tester_allowlist" }` | **Tidak** | ACK sukses ke Telegram agar pesan non-tester tidak terus di-retry, tanpa mengotori database. |
| Inisialisasi database gagal (misal config DB hilang/rusak saat startup) | **500 Internal Server Error** | `error.code: "DATABASE_UNAVAILABLE"` | **Tidak** | Menangani kegagalan inisialisasi secara aman tanpa mengekspos connection string atau detail server. |
| Pesan valid dari tester berwenang pertama kali diterima | **200 OK** | `data: { status: "accepted", ingressId: "...", duplicate: false }` | **Ya** (Ingress + Job atomik) | Pesan, metadata lengkap, dan antrean job telah committed ke database. |
| Pesan duplikat (message ID, chat ID, account ID, channel sama) | **200 OK** | `data: { status: "accepted", ingressId: "...", duplicate: true }` | **Tidak** (Idempoten) | Mengembalikan ID ingress yang sudah ada tanpa menduplikasi job atau menimpa data asli. |
| Database error atau kegagalan transaksi persisten | **500 Internal Server Error** | `error.code: "PERSISTENCE_FAILED"` | **Rollback pada kegagalan pra-commit; belum tentu rollback jika putus saat commit** | Memberi sinyal kegagalan sementara (*transient*) agar Telegram Bot API melakukan retry berkala. Kegagalan sebelum commit terbukti rollback penuh; jika koneksi terputus saat commit sehingga status akhir belum diketahui (*indeterminate*), respons non-success dan constraint unik memungkinkan retry secara idempoten tanpa duplikasi data. |

---

## 3. Resolusi Metadata D82 dan Skema Database

### 3.1 Migration Database (`supabase/migrations/20260929100000_add_ingress_metadata.sql`)
Migration baru dibuat tanpa merusak data lama atau menyentuh migrasi historis:
```sql
begin;

alter table public.ingress_events
  add column if not exists message_type text not null default 'text' check (message_type in ('text','photo','document','voice','video','audio','sticker','location','contact','other')),
  add column if not exists has_media boolean not null default false,
  add column if not exists is_forwarded boolean not null default false,
  add column if not exists caption text check (caption is null or length(caption) <= 1024),
  add column if not exists sent_at timestamptz,
  add column if not exists sender_info jsonb not null default '{}'::jsonb;

comment on column public.ingress_events.message_type is 'Normalized channel-agnostic message type classification.';
comment on column public.ingress_events.has_media is 'Boolean flag indicating whether the message includes media attachments.';
comment on column public.ingress_events.is_forwarded is 'Boolean flag indicating whether the message was forwarded.';
comment on column public.ingress_events.caption is 'Optional media caption provided with the message (up to 1024 chars).';
comment on column public.ingress_events.sent_at is 'Sender transmission timestamp from provider message; distinct from received_at server timestamp.';
comment on column public.ingress_events.sender_info is 'Informational sender profile details (e.g. first_name, username) not used as identity keys.';

commit;
```

### 3.2 Pemisahan Waktu dan Integritas Metadata
1. **`sent_at` vs `received_at`:**
   - `sent_at`: timestamp ketika pengguna menekan kirim di aplikasi Telegram (dikonversi dari Unix timestamp `message.date` ke ISO 8601 UTC).
   - `received_at`: timestamp `now()` ketika record ingress di-insert ke PostgreSQL server.
   - Keduanya terbukti bernilai berbeda pada verifikasi integrasi.
2. **Pesan Nonteks & Media:**
   - Foto/dokumen tanpa caption: `body` disimpan sebagai string kosong `""` (memenuhi constraint database `body text not null` tanpa mengarang teks keluhan pelanggan), `message_type = 'photo'`, `has_media = true`, `caption = null`.
   - Foto dengan caption: `body` diisi teks caption, `message_type = 'photo'`, `has_media = true`, `caption` diisi teks caption.
   - Pesan forwarded: mencatat `is_forwarded = true` tanpa mengubah identitas `sender` (pengirim langsung tetap tester yang berkomunikasi dengan bot).
   - File media asli tidak diunduh dan raw payload JSON lengkap tidak disimpan mentah ke basis data untuk menghemat penyimpanan dan mematuhi batas scope.

---

## 4. Idempotensi, Isolasi Dedup, dan Bukti Rollback

### 4.1 Unique Constraint DB
- Tabel `ingress_events` memiliki constraint unik `unique(channel, account_id, chat_id, provider_message_id)`.
- Query insert menggunakan klausa `ON CONFLICT (channel, account_id, chat_id, provider_message_id) DO NOTHING`.
- Jika record sudah ada, `HelpdeskPersistence.receive()` mengambil `id` yang sudah tersimpan dan menetapkan `duplicate = true`.

### 4.2 Perlindungan Terhadap Race Condition
- Pengujian 5 pemanggilan handler paralel menggunakan objek Request simulasi bersamaan dengan payload identik membuktikan:
  - 1 request berhasil mencatat ingress pertama kali (`duplicate: false`).
  - 4 request lainnya mendeteksi duplikat (`duplicate: true`).
  - Seluruh 5 request mengembalikan ingress ID yang persis sama.
  - Tepat 1 baris tersimpan di `ingress_events` dan tepat 1 baris di `processing_jobs`.

### 4.3 Isolasi Multi-Tenant / Multi-Chat
- Pengujian membuktikan bahwa `provider_message_id` yang sama dari chat ID yang berbeda atau dari bot account ID yang berbeda menghasilkan record ingress yang berbeda dan tidak saling memblokir.

### 4.4 Bukti Rollback Transaksi Nyata & Batas Ketidakpastian Commit
1. **Skenario Rollback yang Teruji:**
   - Pengujian integrasi `tests/integration/telegram-webhook.test.ts` menyuntikkan controlled fault injection pada tahap query `insert into public.processing_jobs` (setelah insert `ingress_events` dan metadata dieksekusi pada koneksi client aktif di dalam transaksi `receive()`).
   - Kesalahan memicu blok `ROLLBACK;` pada `inHelpdeskTransaction`.
   - Endpoint mengembalikan respons HTTP 500 `PERSISTENCE_FAILED`.
   - Melalui query di luar transaksi yang telah selesai (menggunakan `pool.query()`, yang tidak menjamin koneksi fisik berbeda tetapi membaca snapshot committed database setelah transaksi selesai), dibuktikan bahwa **0 baris** parsial yang committed di `ingress_events` untuk pesan tersebut (message ID `70`).
   - Setelah fault injection dilepaskan dan pesan yang sama (message ID `70`) dikirim ulang, pengujian membuktikan transaksi berhasil committed penuh dengan tepat 1 baris `ingress_events` dan 1 baris `processing_jobs`.
   - Pengiriman duplikat berikutnya untuk pesan yang sama mengembalikan `duplicate: true` dan dibuktikan melalui query di luar transaksi tidak menambah baris baru (tetap tepat 1 ingress dan 1 job).
2. **Batas Ketidakpastian Commit (*Uncertainty Boundary*):**
   - Bukti rollback di atas berlaku spesifik untuk kegagalan sebelum fase commit (*pre-commit failure*).
   - Jika kegagalan terjadi akibat koneksi jaringan terputus tepat saat perintah `COMMIT` dikirimkan ke server PostgreSQL, status akhir transaksi pada database dapat belum diketahui oleh aplikasi/klien (*indeterminate*).
   - Oleh karena itu, tidak semua kegagalan berstatus `PERSISTENCE_FAILED` dapat diklaim pasti rollback penuh. Namun, kombinasi pengembalian respons HTTP non-success (yang memicu retry oleh Telegram) dan unique constraint `(channel, account_id, chat_id, provider_message_id)` memastikan retry pengiriman dapat dilakukan secara aman dan idempoten tanpa duplikasi data.

---

## 5. Konfigurasi Lingkungan

File [`.env.example`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/.env.example) telah diperbarui dengan variabel konfigurasi yang relevan:
```bash
# Telegram Integration (Server-side only)
# Webhook secret token sent in X-Telegram-Bot-Api-Secret-Token header
TELEGRAM_WEBHOOK_SECRET=your_telegram_webhook_secret_here
# Internal identifier for this bot instance
TELEGRAM_BOT_ACCOUNT_ID=upaznet_helpdesk_bot
# Comma-separated list of authorized Telegram User IDs for prototype testing
TELEGRAM_TESTER_ALLOWLIST=123456789,987654321
```

*Catatan Keamanan:*
- `TELEGRAM_WEBHOOK_SECRET` adalah secret acak (1-256 karakter alphanumeric dan `_`, `-`) yang didaftarkan ke Telegram saat memanggil `setWebhook`.
- Bot token Telegram dan webhook secret adalah konfigurasi terpisah; token bot tidak diperlukan dan tidak dipakai pada endpoint inbound ini.
- Tidak ada variabel yang menggunakan prefix `NEXT_PUBLIC_`.

---

## 6. Bukti Pengujian dan Verifikasi

### 6.1 Unit Test & Route Entry Point (`tests/application/telegram-inbound-service.test.ts`)
Perintah:
```bash
node --conditions=react-server --test .test-build/tests/application/telegram-inbound-service.test.js
```
Hasil:
```text
✔ verifyTelegramWebhookSecret validates secrets safely and fails closed (0.6294ms)
✔ readLimitedRequestBody enforces hard byte limit on body streams (15.1763ms)
✔ TelegramInboundService rejects invalid/missing secret without calling persistence (0.5269ms)
✔ TelegramInboundService rejects oversized payload pre-parse without calling persistence (0.1672ms)
✔ TelegramInboundService returns unsupported/rejected for non-tester or service messages without mutation (0.4908ms)
✔ TelegramInboundService persists accepted messages with rich metadata atomically (1.1313ms)
✔ handleTelegramWebhook HTTP pipeline maps status codes and envelope accurately (3.1155ms)
✔ Route POST entry point rejects invalid secret without calling database factory even if DB config is broken (1.0419ms)
✔ Route POST entry point handles database initialization failure safely when secret is valid (0.42ms)
✔ handleTelegramWebhook lazily resolves persistence factory and avoids factory execution on invalid secret or oversized body (0.4139ms)
ℹ tests 10 | pass 10 | fail 0 | exit code 0
```

### 6.2 Integrasi Database Lokal PostgreSQL (`tests/integration/telegram-webhook.test.ts`)
Perintah:
```bash
$env:HELPDESK_TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"; npm run test:telegram:local
```
Hasil:
```text
▶ P2.2 Telegram webhook endpoint and persistent ACK integration
  ✔ rejects invalid or missing secret with 401 without side effects (32.4851ms)
  ✔ rejects oversized body with 413 without side effects (0.8019ms)
  ✔ persists accepted message with rich metadata and pending job atomically (17.776ms)
  ✔ sequential duplicate returns 200 with duplicate=true without modifying records (23.0415ms)
  ✔ concurrent parallel requests produce exactly one ingress and one job (50.6496ms)
  ✔ same message_id on different chat or bot account are isolated (27.2936ms)
  ✔ photo without caption stores empty text and media metadata (10.2147ms)
  ✔ photo with caption stores caption as text and in caption column (9.7602ms)
  ✔ unsupported updates and non-tester rejections return 200 without DB mutations (2.0262ms)
  ✔ controlled fault injection rolls back ingress+metadata before commit, allowing retry (28.6387ms)
✔ P2.2 Telegram webhook endpoint and persistent ACK integration (214.5903ms)
ℹ tests 11 | pass 11 | fail 0 | exit code 0
```

### 6.3 Verifikasi Regresi Suite Proyek
1. **Unit Test Suite Lengkap (`npm run test:unit`):**
   - 130/130 tests pass (exit code 0).
2. **Persistence Integrasi P1.4 (`npm run test:persistence:local`):**
   - 12/12 tests pass (exit code 0). Membuktikan kompatibilitas penuh skema baru dengan operasi episode, klaim, dan audit log lama.
3. **Pemeriksaan Linter (`npm run lint`):**
   - Exit code 0, 0 error.
4. **Pemeriksaan Build Produksi Next.js (`npm run build`):**
   - Keberhasilan build berasal dari sesi implementasi sebelumnya (exit code 0; route dinamis `ƒ /api/webhooks/telegram` terkompilasi sukses dengan Turbopack).
   - Build produksi setelah koreksi terakhir belum ditunjukkan dalam bukti eksekutor yang tersedia dan tidak dijalankan ulang pada sinkronisasi dokumentasi ini (sesuai kebijakan penutupan berbasis risiko).

---

## 7. Batas Bukti & Penegasan Ruang Lingkup

- **Metode Pengujian yang Digunakan:**
  - Verifikasi dilakukan menggunakan handler route / service yang dipanggil dengan objek `Request` simulasi Web Standard dan terhubung ke instance database PostgreSQL lokal Supabase (`127.0.0.1:54322`).
  - Pengujian ini **belum** mencakup pengujian jaringan HTTP terhadap live server Next.js (`next start`) yang menerima request TCP eksternal, dan **belum** mencakup interaksi dengan Telegram Bot API nyata di internet.
- **Outbound & Worker:** Endpoint P2.2 tidak mengirim balasan apapun ke Telegram dan tidak mengeksekusi worker pemrosesan. Job yang masuk berstatus `pending` di `processing_jobs` dan menunggu implementasi worker (P2.5) dan orkestrasi assessment (P2.4).
- **Automation Settings:** Default otomasi tetap `SHADOW` tanpa mutasi pengaturan.

---

## 8. Langkah Persiapan Pendaftaran Webhook Telegram

Ketika pengguna siap menghubungkan bot Telegram riil ke lingkungan server yang memiliki domain HTTPS publik, langkah pendaftarannya adalah:

1. Pastikan server aplikasi telah berjalan dan dapat diakses dari internet via HTTPS publik (misal domain staging/production atau tunneling dev HTTPS).
2. Siapkan webhook secret token acak yang aman (misal 32 karakter hexadecimal) dan simpan ke environment variable server:
   ```bash
   TELEGRAM_WEBHOOK_SECRET=<SECRET_TOKEN_ANDA>
   ```
3. Panggil API `setWebhook` Telegram menggunakan URL publik endpoint helpdesk beserta secret token tersebut:
   ```bash
   curl -F "url=https://<DOMAIN_PUBLIK_ANDA>/api/webhooks/telegram" \
        -F "secret_token=<SECRET_TOKEN_ANDA>" \
        -F 'allowed_updates=["message","edited_message"]' \
        "https://api.telegram.org/bot<BOT_TOKEN_ANDA>/setWebhook"
   ```
4. Verifikasi bahwa respons Telegram menghasilkan:
   ```json
   { "ok": true, "result": true, "description": "Webhook was set" }
   ```
5. Untuk memeriksa status webhook di kemudian hari:
   ```bash
   curl "https://api.telegram.org/bot<BOT_TOKEN_ANDA>/getWebhookInfo"
   ```
*(Catatan: Jangan pernah membagikan atau mencatat `<BOT_TOKEN_ANDA>` atau `<SECRET_TOKEN_ANDA>` ke chat, log publik, atau commit git).*
