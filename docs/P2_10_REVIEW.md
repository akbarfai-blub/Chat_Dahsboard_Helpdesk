# Review P2.10 — Konfigurasi dan Deployment Prototype SHADOW

**Task:** P2.10 (Dependency: P0.2, P0.4, P0.5, P2.2, P2.5, P2.6 ✅) · **Acuan keputusan:** D50, D67, D68, D143

---

## 1. Ringkasan Status

Status P2.10: 🟡 **In Progress** (Persiapan dan tooling deployment selesai; menunggu linking target remote Supabase & Vercel pengguna).

Sesuai aturan AGENTS.md dan PRD §13, P2.10 **hanya boleh Done** apabila deployment live, konfigurasi webhook HTTPS, dan smoke test memiliki bukti konkret pada lingkungan deployment nyata. Seluruh kesiapan yang dapat diselesaikan tanpa membeberkan secret telah diselesaikan secara penuh dan teruji.

---

## 2. Inventarisasi Kesiapan dan Target

### A. Working Tree dan Sumber Kode
- **Git Branch**: `main`
- **Git Commit HEAD**: `44dfac524c4f5ce8eba8188bcf797e4eca56e9e8`
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
- **Webhook Status Saat Ini**: Terarah ke `https://speech-acceptance-incentive-modes.trycloudflare.com/api/webhooks/telegram` dengan `pending_update_count: 0`.

### C. Lingkungan Supabase Prototype & Vercel
- **Supabase CLI**: Belum terhubung ke remote Supabase project (`supabase login` / `SUPABASE_ACCESS_TOKEN` belum tersedia).
- **Vercel CLI**: Berstatus `Logged out`.
- **Database Skema**: 13 berkas migrasi siap diaplikasikan melalui runner idempoten tanpa reset data.

---

## 3. Tooling Otomasi Deployment yang Dibuat dan Diverifikasi

1. **`scripts/apply-prototype-migrations.mjs`**:
   - Menghubungkan ke database PostgreSQL target (`pg`).
   - Memeriksa tabel `supabase_migrations.schema_migrations`.
   - Mengaplikasikan hanya migrasi yang belum terdaftar secara atomik (`BEGIN...COMMIT`).
   - Mendukung SSL `sslmode=verify-full`.
   - Menangani strip UTF-8 BOM pada berkas SQL.
   - Terverifikasi pada database lokal: mengaplikasikan 6 migrasi tertunda (migrasi 8–13) tanpa galat, dan eksekusi ulang menghasilkan no-op (100% idempoten).

2. **`scripts/apply-prototype-seed.mjs`**:
   - Menerapkan `supabase/seed.sql` dan `supabase/fixtures/network.sql` dengan klausa `ON CONFLICT DO NOTHING`.
   - Memastikan baris singleton `automation_settings` aktif dengan `mode = 'SHADOW'`, `emergency_stop = false`.
   - Memastikan identitas channel untuk ID tester (`6727338166`) tersedia pada `channel_identities`.
   - Terverifikasi pada database lokal tanpa menghapus data atau akun yang ada.

3. **`scripts/manage-telegram-webhook.mjs`**:
   - Memeriksa status webhook bot saat ini (`status`).
   - Memasang webhook HTTPS dengan secret token dan `drop_pending_updates: false` (`set`).
   - Menyediakan kemampuan pemulihan ke URL sebelumnya (`restore`).
   - Tidak mencatat atau membocorkan bot token / secret ke log atau konsol.
   - Terverifikasi live berinteraksi dengan API Telegram.

4. **`scripts/smoke-test-deployment.mjs`**:
   - Memvalidasi 6 kriteria smoke test acceptance criteria:
     1. Aksesibilitas HTTPS.
     2. Proteksi endpoint bagi staf tanpa autentikasi (redirect 307/302 ke `/login`, 401 pada API).
     3. Penolakan request webhook dengan secret hilang atau salah (401 Unauthorized) dan verifikasi zero database mutation.
     4. Penerimaan pesan dummy tester via webhook (HTTP 200 Accepted).
     5. Verifikasi database: ingress tercatat, job dijalankan, mode tetap `SHADOW`.
     6. Verifikasi preservasi guard: **tidak ada** outbound intent yang dibuat atau terkirim, dan **tidak ada** klaim debounce (`reply_claims`).

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

Setelah langkah ini berhasil dieksekusi dan bukti aktual dicatat, status P2.10 dapat ditandai sebagai ✅ **Done**.
