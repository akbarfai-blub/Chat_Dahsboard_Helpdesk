# P1.4 — Persistence dan claim

Implementasi awal 22 September 2026. **Diverifikasi pada cakupan persistence lokal pada 25 September 2026** di lingkungan Supabase PostgreSQL lokal (`127.0.0.1:54322/postgres`, Auth v2.196.0). Pengujian integrasi persistence, typecheck, lint, dan build berhasil dijalankan dengan 0 kegagalan.

## Hasil dan Verifikasi Aktual

- **Status Migration:** Migration `supabase/migrations/20260922090000_create_episode_persistence.sql` terkonfirmasi telah diterapkan pada Supabase lokal sebelum pengujian verifikasi dijalankan (`npx supabase migration list --local`).
- **Suite Pengujian Integrasi (`tests/integration/persistence.test.ts`):** **11 skenario integrasi lulus (12 checks PASS termasuk satu pengujian induk), 0 FAIL, 0 CANCELLED, 0 SKIPPED**.
- **Ingress + Job Atomik:** 8 request paralel identik terbukti hanya menghasilkan 1 ingress event dan 1 processing job; dedup membedakan `chat_id` dan `channel_account_id`; pemrosesan paralel menghasilkan assessment dan reservasi yang konsisten; serta pesan dari dua pengirim Telegram berbeda untuk satu layanan yang sama hanya membuat 1 primary episode dan 1 reservasi claim.
- **Reservasi Claim Atomik:** Claim episode dan incident/event direservasi bersama via savepoint transaksi; konflik incident claim membatalkan seluruh reservasi tanpa meninggalkan claim parsial, namun tetap menyimpan message dan assessment serta menandai job selesai.
- **Guard Mode SHADOW & Emergency Stop:** Inbound pada mode SHADOW dan status emergency stop tidak pernah memperoleh claim pengiriman (`dispatchAuthorized=false`, alasan `shadow_mode` dan `automation_blocked`).
- **Aksi Staf, Versi, dan Audit:** Aksi staf memvalidasi `expectedVersion`; versi basi ditolak (`version_mismatch`); request ID identik mengembalikan replay idempoten; konflik request ID ditolak (`request_id_conflict`); pending auto-reply dibatalkan saat staf mengambil alih.
- **Balasan Manual Idempoten:** Balasan manual staf tersimpan pada antrean `outbound_intents` (origin `'staff'`); noop tidak merusak antrean; auto-reply pending dibatalkan.
- **Rollback Transaksi:** Kegagalan audit log (misal ID staf tidak valid) melakukan rollback penuh terhadap status episode, version, dan pembatalan intent; mutasi di dalam `inHelpdeskTransaction` terbukti atomik.
- **Linking Identity:** Menggabungkan ledger claim tanpa menghapus histori lama, mempertahankan primary episode, membatalkan intent pending, mempertahankan intent `in_flight`, dan menonaktifkan automation pada episode terkait (`automation_suppressed=true`).
- **Split Episode:** Aksi split bersifat idempoten, menaikkan versi episode sumber (`version = v + 1`), mendukung penunjukan primary eksplisit, dan menonaktifkan otomatisasi episode hasil split.
- **Pembatasan Peran Browser:** Peran `anon` dan `authenticated` ditolak saat mencoba update `complaints`, delete `reply_claims` / `complaint_audit_log`, atau membaca `ingress_events.body` (error privilege `42501`).

Kode utama: `lib/application/helpdesk-persistence.ts`, `lib/application/link-identity.ts`, `lib/repositories/episode-store.ts`, dan `lib/postgres/`. Pengujian persistence memanggil layanan internal `HelpdeskPersistence.staffAction(staffId, ...)` dengan ID staf langsung untuk membuktikan atomisitas transaksi DB dan locking; wrapper `staff-episodes.server.ts` mengikat aktor staf dari sesi server Next.js, tetapi pengujian autentikasi sesi browser/cookie end-to-end tidak dicakup oleh suite persistence ini.

Detail laporan terarah dan bukti eksekusi tersimpan di [bukti P1.4](evidence/P1_4/p14-verification-evidence.md).

## Batas dan konfigurasi

Driver pg menggunakan satu koneksi per transaksi, READ COMMITTED dan satu advisory lock untuk seluruh mutasi prototype. Ini membatasi throughput; belum merupakan jaminan kapasitas produksi. Tidak ada retry transaksi otomatis atau HTTP provider di dalam transaksi.

Server memerlukan `HELPDESK_DATABASE_URL` (bukan NEXT_PUBLIC). Lokal memakai URL PostgreSQL Supabase lokal (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`); remote wajib TLS sslmode=verify-full.

**Reservasi bukan izin kirim:** `dispatchAuthorized=false`. Webhook/allowlist, conversation 24 jam, worker/recovery, UI, renderer/prefix simulasi, pemeriksaan terakhir sebelum dispatch dan hasil provider tetap P2/P3. Incident/event ID adalah referensi bukti; tabel lifecycle incident/event belum dibangun.

Input provider dan target episode berasal dari application layer terpercaya. Linking hanya setelah staf memverifikasi kepemilikan. Semua mutasi berikutnya harus memakai transaksi/lock yang sama.

## Ringkasan Eksekusi Verifikasi

Dijalankan pada 25 September 2026:

1. `npx supabase migration list --local`: 3/3 migrations applied.
2. `npm test`: 105 domain unit tests pass (0 fail).
3. `npm run test:identity:local`: 8/8 integration tests pass.
4. `npm run test:network:local`: 10/10 integration tests pass.
5. `npm run test:triage:local`: 18/18 integration tests pass.
6. `npm run test:persistence:local`: 12/12 integration tests pass.
7. `npx tsc --noEmit`: typecheck pass (0 error).
8. `npm run lint`: linter pass (0 error/warning).
9. `npm run build`: Next.js production build pass (0 error).
10. Verifikasi cleanup database: 0 sisa fixture `p14-%` dan `automation_settings` dipulihkan ke status awal.

Seluruh acceptance criteria untuk P1.4.1 hingga P1.4.5 telah terbukti terpenuhi pada lingkungan lokal.
