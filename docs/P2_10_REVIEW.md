# Review P2.10 — Konfigurasi dan Deployment Prototype SHADOW

**Task:** P2.10 (Dependency: P0.2, P0.4, P0.5, P2.2, P2.5, P2.6 ✅) · **Acuan keputusan:** D50, D67, D68, D143, D144, D145, D146, D147, D148

---

## 1. Ringkasan Status

Status P2.10: 🟡 **In Progress** (Seluruh tooling deployment telah diperbaiki, bukti transport/CLI Telegram lokal terkontrol telah diterima pada D147, dan pengaman endpoint URL telah ditegakkan serta diverifikasi pada D148; deployment remote nyata dan smoke test remote nyata masih merupakan pekerjaan terbuka).

Sesuai aturan AGENTS.md dan PRD §13, P2.10 **hanya boleh Done** apabila deployment live memiliki bukti konkret pada lingkungan deployment nyata.
- **Penerimaan Bukti Transport/CLI Telegram Lokal (D147)**: Pengujian transport lokal terkontrol (penanganan HTTP non-200 termasuk `ok: true`, JSON rusak, timeout transport, exit code CLI nonzero, dan verifikasi URL via `getWebhookInfo`) telah selesai dan diterima penuh tanpa menyentuh webhook live.
- **Pengamanan Validasi Endpoint URL (D148)**: Titik injeksi pengujian telah diamankan dengan validasi ketat: HTTPS wajib untuk host nonlokal, HTTP hanya diizinkan untuk loopback fixture (`localhost`, `127.0.0.1`, `::1`), penolakan hostname penipu, penolakan kredensial dalam URL, penolakan protokol non-HTTP/HTTPS, dan penolakan pre-flight dengan nol pemanggilan transport.
- **Pekerjaan Terbuka yang Tersisa**: Menghubungkan target remote Supabase & Vercel pengguna, melakukan deployment, mengarahkan webhook bot publik ke domain live, dan menjalankan smoke test terhadap deployment remote nyata.

---

## 2. Inventarisasi Kesiapan dan Target

### A. Working Tree dan Sumber Kode
- **Git Branch**: `main`
- **Git Commit Baseline**: `2e1321b`
- **Working Tree Additions**: Memuat implementasi P2.7 (Context/evidence panel) dan P2.8 (Staff message classification) yang telah berstatus Done.
- **Next.js Production Build**:
  - Command: `npm run build`
  - Hasil: Sukses (Exit code 0)
  - `BUILD_ID`: `uCRy779fnf8FFKoi4n9bz`
  - Validasi Manifest: 26 tracked files valid tanpa mutasi in-flight (`STATUS: VALID`).

### B. Bot Telegram Prototype
- **Status Akun**: Terverifikasi live melalui Telegram Bot API.
- **Bot ID**: `8892832714`
- **Username**: `@upaznet_helpdesk_proto_bot`
- **First Name**: `upaznet_helpdesk_proto_bot`
- **Account ID**: `upaznet_helpdesk_bot`
- **Allowlist Tester ID**: `6727338166`
- **Webhook Status**: Konfigurasi webhook pada bot publik dipertahankan tanpa perubahan pada sesi perbaikan tooling ini. Pengujian transport dan endpoint dieksekusi secara lokal tanpa mengubah bot live.

### C. Lingkungan Supabase Prototype & Vercel
- **Supabase CLI**: Belum terhubung ke remote Supabase project (`supabase login` / `SUPABASE_ACCESS_TOKEN` belum tersedia).
- **Vercel CLI**: Berstatus `Logged out`.
- **Database Skema**: 13 berkas migrasi siap diaplikasikan melalui runner idempoten tanpa reset data.

---

## 3. Tooling Otomasi Deployment yang Diperbaiki dan Diverifikasi (D144, D145, D146, D147, D148)

1. **`scripts/apply-prototype-migrations.mjs`**:
   - Menghubungkan ke database PostgreSQL target (`pg`).
   - Memvalidasi protokol (`postgres:`, `postgresql:`) dan menerapkan validasi TLS dengan paritas runtime aplikasi: remote database wajib `sslmode=verify-full`, menolak `rejectUnauthorized: false` dan `sslmode=disable`.
   - Menggunakan `stripOuterTransactionWrapper` untuk menghapus pembungkus `BEGIN/COMMIT` terluar dari berkas SQL.
   - Menjalankan perubahan skema DDL dan pencatatan nomor versi ke `supabase_migrations.schema_migrations` dalam **satu transaksi PostgreSQL atomik**.
   - Membuktikan rollback serentak skema DDL dan version record bila terjadi kegagalan sebelum commit.

2. **`scripts/apply-prototype-seed.mjs`**:
   - Menerapkan `supabase/seed.sql` dan `supabase/fixtures/network.sql` dengan klausa `ON CONFLICT DO NOTHING`.
   - Memvalidasi koneksi dengan paritas TLS runtime (`sslmode=verify-full` untuk remote host).
   - Memverifikasi mode `SHADOW` aktual pada baris singleton `automation_settings`. Hanya mengonfirmasi jaminan SHADOW jika mode benar-benar `SHADOW` (`shadowGuaranteed: true`), dan mendukung flag fail-closed `requireShadow: true`.
   - Mendaftarkan identitas channel untuk ID tester (`6727338166`) pada `channel_identities`.

3. **`scripts/manage-telegram-webhook.mjs`**:
   - Memeriksa status webhook bot saat ini (`status`).
   - Memasang webhook HTTPS dengan secret token dan `drop_pending_updates: false` (`set`).
   - Menangani respons Telegram `ok: false`, status HTTP non-200, timeout, dan network error dengan kegagalan eksplisit dan exit nonzero (exit code 1).
   - Memverifikasi kesesuaian URL aktual melalui `getWebhookInfo` pasca-eksekusi set/restore sebelum menyatakan sukses.
   - **Validasi URL Endpoint Presisi (`validateTelegramApiBaseUrl`)**:
     - Default URL tetap `https://api.telegram.org`.
     - Hanya protokol `http:` dan `https:` yang diterima.
     - HTTP secara ketat hanya diizinkan untuk loopback fixture pengujian (`localhost`, `127.0.0.1`, `::1` setelah normalisasi bracket IPv6).
     - Menolak pencocokan substring/prefix (misal `localhost.example.com` atau `127.0.0.1.example.com`).
     - Host nonlokal wajib HTTPS.
     - Menolak URL yang mengandung kredensial (`username:password`) atau URL invalid/kosong.
     - Penolakan terjadi sebelum pemanggilan transport `http.request` maupun `https.request` (pre-flight zero-transport).
     - CLI menghasilkan exit code 1 dengan pesan validasi bersih tanpa membocorkan bot token atau secret.
     - Mempertahankan verifikasi TLS bawaan tanpa pelemahan atau `rejectUnauthorized: false`.

4. **`scripts/smoke-test-deployment.mjs`**:
   - Menghilangkan seluruh stub/placeholder `pass: true`. Ketiadaan kredensial staf atau koneksi DB menghasilkan FAIL eksplisit.
   - Menegakkan fungsi `isValidLoginRedirect(status, locationHeader, baseUrl)` dengan verifikasi origin presisi (D146): mem-parse URL tujuan dengan target URL sebagai base, selalu membandingkan `parsed.origin === parsedBase.origin` tanpa bergantung pada awalan teks (`http://`/`https://`), status wajib 307 atau 302, dan pathname strictly `/login` (menolak status 200 dengan header Location, tujuan non-login seperti `/dashboard` atau `/maintenance`, serta off-origin baik URL absolut, protocol-relative `//other.example/login`, maupun skema uppercase `HTTPS://other.example/login`).
   - Memeriksa nilai kembalian `{ error: signOutError }` dari `staffClient.auth.signOut()`. Jika logout mengembalikan error, pengujian `staffAuth` dan `allPassed` secara tegas menghasilkan status FAIL, meskipun cookie lokal telah terhapus dan akses berikutnya tertolak.
   - Menguji 7 kriteria smoke test secara konkret:
     1. Aksesibilitas HTTPS (`httpsReachable`).
     2. Proteksi endpoint bagi pengunjung tanpa autentikasi (`unauthenticatedProtected`: status 307/302 ke `/login`, API 401).
     3. Validasi koneksi database dan TLS (`dbConnection`).
     4. Keamanan webhook & **zero database mutation** riil via perbandingan hitungan baris DB sebelum dan sesudah penolakan (`webhookSecurity`).
     5. Pre-Ingestion Guard: verifikasi database memastikan mode `SHADOW` dan `emergency_stop` tidak aktif sebelum pesan uji disuntikkan (`preIngestionShadow`).
     6. Ingestion webhook dummy tester (`6727338166`), verifikasi envelope respons (`status === 'accepted'`, `duplicate === false`, string `ingressId`), bounded polling penyelesaian worker (`processing_jobs.status === 'done'`), kueri skema presisi (`ingress_events`, `messages`, `triage_assessments`), dan preservasi guard SHADOW (0 outbound intents, 0 reply claims) (`webhookIngestionAndShadow`).
     7. Autentikasi staf nyata via `@supabase/ssr`: login valid, akses `/dashboard` (200), akses `/api/inbox/conversations` (200), logout dengan verifikasi `signOutError == null`, dan penolakan sesi pasca-logout (redirect valid ke `/login` dan API 401) (`staffAuth`).

### D. Bukti Pengujian Terarah Tooling (`tests/tooling/deployment-tooling.test.mjs`)
- Dieksekusi pada database terisolasi `p210_tooling_test`:
  - Suite 1 (TLS Validation & Paritas Runtime): 7/7 PASS
  - Suite 2 (Atomisitas Transaksi Migrasi & Rollback): 4/4 PASS
  - Suite 3 (Telegram Webhook Management, Error Handling, Transport, CLI & Endpoint Validation): 13/13 PASS
    - 3.1: Rejection saat Telegram API mengembalikan `ok: false`
    - 3.2: Rejection saat `setWebhook` sukses tetapi verifikasi `getWebhookInfo` melaporkan URL berbeda
    - 3.3: Konfigurasi dan verifikasi webhook sukses saat konfigurasi cocok (`drop_pending_updates: false`)
    - 3.4: Penolakan kegagalan network/timeout dengan pesan bersih tanpa membocorkan token
    - 3.5: HTTP non-200 (500) dengan body JSON `{"ok": true}` terbukti ditolak dengan error `[500] HTTP 500`
    - 3.6: JSON rusak (respons HTML pada HTTP 200) terbukti menghasilkan rejection terkontrol tanpa menggantung
    - 3.7: Transport timeout pada fixture loopback terbukti menghentikan request (`req.destroy()`) dan reject dalam batas waktu (< 2s, aktual ~158ms)
    - 3.8: CLI Subprocess menghasilkan exit code 1 pada HTTP non-200, JSON rusak, dan timeout tanpa pesan sukses palsu
    - 3.9: CLI Subprocess menghasilkan exit code 0 pada `status` dan `set`, memverifikasi kesesuaian URL via `getWebhookInfo`, dan menegakkan `drop_pending_updates: false` pada fixture
    - 3.10: `validateTelegramApiBaseUrl` memvalidasi protokol HTTPS untuk nonlokal dan loopback strictly untuk HTTP across 13 URL variants
    - 3.11: `telegramApiRequest` menolak insecure / invalid base URL dengan zero transport invocations (spy `httpCalls === 0`, `httpsCalls === 0`)
    - 3.12: HTTPS ke host nonlokal lolos validasi konfigurasi tanpa request jaringan eksternal (spy https dengan rejectUnauthorized bawaan)
    - 3.13: CLI Subprocess keluar dengan exit code 1 dan pesan validasi spesifik pada endpoint insecure/invalid via `TELEGRAM_API_BASE_URL`
  - Suite 4 (Enforcement SHADOW Seeder & Pre-Ingestion Guard): 4/4 PASS
  - Suite 5 (Integritas Smoke Test, Bounded Polling, Skema Presisi, Validasi Redirect Presisi & Origin Hardening, & SignOut Error Handling): 9/9 PASS
    - 5.1: Missing DB URL / credentials menghasilkan FAIL
    - 5.2: Bounded polling worker failure / timeout
    - 5.3: Webhook response envelope validation
    - 5.4: Schema accuracy tanpa kolom fiktif
    - 5.5: Full smoke test execution allPassed === true
    - 5.6: `isValidLoginRedirect` unit tests (307/302, relative/absolute, query params, origin hardening: menerima `//deploy.example.com/login` & `HTTPS://deploy.example.com/login`, menolak `//other.example/login` & `HTTPS://other.example/login`, penolakan status 200, destination non-login)
    - 5.7: Check 2 penolakan redirect destination non-login dan status 200
    - 5.8: Check 5 penolakan ketika signOut mengembalikan error meskipun cookie dibersihkan
    - 5.9: Check 5 penolakan ketika post-logout redirect bukan ke `/login`
  - **Hasil**: 42/42 assertions PASS (exit code 0, durasi ~2.1s).
- **Regresi Unit Test**: 305/305 unit test aplikasi lulus (`npm test`, exit code 0).
- **Catatan Batas Bukti**: Kekurangan bukti transport dan CLI Telegram lokal terkontrol (penanganan HTTP non-200, JSON rusak, timeout transport, exit code CLI) telah ditutup penuh secara empiris melalui loopback HTTP fixture dan subprocess CLI terisolasi (D147). Pengamanan validasi URL endpoint telah ditutup secara empiris dengan nol pemanggilan transport (D148). Seluruh bukti ini berasal dari lingkungan lokal terkontrol, bukan interaksi bot live atau deployment remote. Pekerjaan yang masih terbuka hanyalah deployment remote nyata (menghubungkan Vercel & Supabase remote pengguna) dan eksekusi smoke test pada deployment remote nyata. Sesuai AGENTS.md, status P2.10 tetap In Progress sampai deployment dan smoke test remote nyata terverifikasi.

---

## 4. Prosedur Tindakan Minimum Pengguna untuk Menyelesaikan Deployment

Agar deployment ke lingkungan live dapat diselesaikan tanpa meminta secret dituliskan di chat, pengguna dapat menjalankan tindakan minimum berikut:

### Langkah 1: Hubungkan Vercel
Jalankan di terminal proyek:
```powershell
npx vercel link
```
Atau deploy preview/production:
```powershell
npx vercel
```

### Langkah 2: Konfigurasi Environment Variables di Vercel
Tambahkan variabel berikut pada Vercel Project Settings (Environment Variables):
- `NEXT_PUBLIC_SUPABASE_URL`: URL project Supabase prototype (misal `https://xxxx.supabase.co`).
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Anon key project Supabase.
- `SUPABASE_URL`: URL project Supabase prototype.
- `SUPABASE_ANON_KEY`: Anon key project Supabase.
- `SUPABASE_SERVICE_ROLE_KEY`: Service role key project Supabase (**Secret**, server-only).
- `HELPDESK_DATABASE_URL`: Connection string PostgreSQL pooler Supabase dengan `sslmode=verify-full` (**Secret**, server-only).
- `NETWORK_PROVIDER`: `mock`.
- `TELEGRAM_BOT_ACCOUNT_ID`: `upaznet_helpdesk_bot`.
- `TELEGRAM_TESTER_ALLOWLIST`: `6727338166`.
- `TELEGRAM_WEBHOOK_SECRET`: Secret token webhook Telegram.

### Langkah 3: Terapkan Migrasi dan Seed ke Database Target
Jalankan secara lokal menggunakan connection string database target:
```powershell
node scripts/apply-prototype-migrations.mjs "<TARGET_HELPDESK_DATABASE_URL>"
node scripts/apply-prototype-seed.mjs "<TARGET_HELPDESK_DATABASE_URL>"
```

### Langkah 4: Arahkan Webhook Telegram ke Deployment Vercel
```powershell
node scripts/manage-telegram-webhook.mjs set "https://<VERCEL_DOMAIN>/api/webhooks/telegram" "<TELEGRAM_WEBHOOK_SECRET>"
```

### Langkah 5: Jalankan Smoke Test Deployment
```powershell
node scripts/smoke-test-deployment.mjs "https://<VERCEL_DOMAIN>" "<TARGET_HELPDESK_DATABASE_URL>"
```

Setelah seluruh kekurangan bukti lokal transport/CLI terselesaikan serta langkah deployment live ini berhasil dieksekusi dan bukti aktual dicatat, status P2.10 baru dapat ditandai sebagai ✅ **Done**.
