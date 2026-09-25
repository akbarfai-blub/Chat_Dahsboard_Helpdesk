# Bukti Verifikasi P1.4 — Persistence, Transaksi, dan Claim Atomik

**Tanggal verifikasi:** 25 September 2026  
**Target:** Supabase PostgreSQL lokal (`127.0.0.1:54322/postgres`, Auth v2.196.0)  
**Lingkungan:** Node.js v24.13.1, TypeScript 5, pg v8.23.0, Next.js v16.3.5 (Turbopack)  
**Kredensial:** Seluruh connection string dan secret server diterima hanya via variabel lingkungan runtime (`HELPDESK_TEST_DATABASE_URL`), tanpa dicatat atau dicetak pada dokumen ini.

---

## 1. Status Migration Lokal

Pemeriksaan status migration lokal dilakukan via `npx supabase migration list --local`:

| Migration File | Versi / ID | Status Lokal | Tanggal / Waktu | Deskripsi Isi |
| :--- | :--- | :---: | :--- | :--- |
| `20260919115958_create_customer_identity_topology.sql` | `20260919115958` | **Applied** | 2026-09-19 11:59:58 | 6 tabel awal identitas & topologi, relasi, index, RLS staf. |
| `20260920090000_create_mock_network_status.sql` | `20260920090000` | **Applied** | 2026-09-20 09:00:00 | Tabel mock status jaringan, observasi ONU/upstream, scenario fixtures. |
| `20260922090000_create_episode_persistence.sql` | `20260922090000` | **Applied** | 2026-09-22 09:00:00 | Tabel episode (`complaints`), `ingress_events`, `processing_jobs`, `messages`, `triage_assessments`, `reply_owners`, `outbound_intents`, `reply_claims`, `complaint_evidence_links`, `complaint_audit_log`, `staff_commands`, dan `automation_settings`. |

Migration P1.4 (`20260922090000`) telah diterapkan sebelumnya pada database lokal dan tidak memerlukan migrasi ulang atau database reset.

---

## 2. Eksekusi Pengujian Integrasi Persistence (`tests/integration/persistence.test.ts`)

Perintah:
```powershell
$env:HELPDESK_TEST_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
npm run test:persistence:local
$env:HELPDESK_TEST_DATABASE_URL = $null
```

### Hasil Skenario Uji

| # | Skenario Uji | Asersi Perilaku Aktual | Durasi | Hasil |
| :---: | :--- | :--- | :---: | :---: |
| 1 | **Parallel duplicate receipt** | 8 request receipt identik hanya menghasilkan 1 ingress event dan 1 processing job; dedup membedakan `chat_id` dan `channel_account_id`; pemrosesan paralel menghasilkan assessment dan reservasi yang idempoten. | 181 ms | **PASS** |
| 2 | **Different inbound messages for one service** | Inbound dari dua pengirim Telegram berbeda (`parallel-a` dan `parallel-b`) untuk satu layanan yang sama hanya membuat 1 primary episode dan 1 reservasi claim; duplikasi dicegah oleh unique index `complaints_primary_service` (error `23505`). Pengujian ini memvalidasi multi-sender pada layanan yang sama, bukan pengujian integrasi antar jenis channel/protokol berbeda. | 88 ms | **PASS** |
| 3 | **Event conflict rollback** | Konflik claim pada event yang sama membatalkan episode claim dan intent via savepoint, namun tetap menyimpan message, assessment, dan menandai job selesai (`status='done'`). | 110 ms | **PASS** |
| 4 | **Late event evidence guard** | Bukti incident/event baru yang datang setelah GENERIC menambahkan guard claim incident tanpa membuat reservasi episode kedua. Mode SHADOW diverifikasi tidak mengambil claim. | 120 ms | **PASS** |
| 5 | **SHADOW & emergency stop** | Inbound pada mode SHADOW dan status emergency-stop tidak pernah memperoleh claim pengiriman (`dispatchAuthorized=false`, alasan `shadow_mode` / `automation_blocked`). | 109 ms | **PASS** |
| 6 | **Concurrent staff changes** | Perubahan status oleh staf (diuji melalui pemanggilan service internal dengan UUID staf langsung) menguji `expectedVersion`; request kedua dengan versi basi ditolak (`version_mismatch`); request dengan ID dan parameter sama mengembalikan replay idempoten; request ID bentrok dengan payload beda ditolak (`request_id_conflict`); pending automation dibatalkan (`status='cancelled'`). | 56 ms | **PASS** |
| 7 | **Idempotent manual replies** | Balasan manual staf tersimpan secara idempoten pada antrean `outbound_intents` (origin `'staff'`); pemanggilan kedua bersifat noop tetapi menghasilkan intent baru tanpa merusak antrean; auto-reply pending dibatalkan. | 61 ms | **PASS** |
| 8 | **Audit failure rollback** | Kegagalan audit log (misal staf ID tidak valid) melakukan rollback penuh terhadap status episode, version, dan pembatalan intent; simulasi kegagalan dalam `inHelpdeskTransaction` membatalkan mutasi internal secara atomik. | 43 ms | **PASS** |
| 9 | **Identity linking** | Menggabungkan ledger claim tanpa menghapus histori lama; mempertahankan primary episode; membatalkan intent pending; mempertahankan intent yang sudah `in_flight`; menonaktifkan automation pada episode terkait (`automation_suppressed=true`). | 136 ms | **PASS** |
| 10 | **Split episode** | Aksi split bersifat idempoten; menaikkan versi episode sumber (`version = v + 1`); episode hasil split dapat dipilih sebagai primary secara eksplisit; episode split dinonaktifkan otomatisasinya. | 66 ms | **PASS** |
| 11 | **Browser roles restrictions** | Peran database browser (`anon` dan `authenticated`) tidak dapat mengupdate `complaints`, tidak dapat menghapus `reply_claims` atau `complaint_audit_log`, serta tidak dapat membaca payload `ingress_events.body` (seluruhnya ditolak dengan error privilege `42501`). | 21 ms | **PASS** |

**Total:** 11 skenario integrasi; 12 checks PASS termasuk satu pengujian induk | **12 PASS, 0 FAIL, 0 CANCELLED, 0 SKIPPED** (Durasi: 1602 ms).

---

## 3. Bukti Cleanup dan Pemulihan Pengaturan

Setelah suite selesai (baik sukses maupun gagal), blok `finally` pada `tests/integration/persistence.test.ts` mengeksekusi penghapusan fixture dan pemulihan `automation_settings` di dalam `inHelpdeskTransaction`.

Verifikasi independen pasca-eksekusi terhadap database lokal (`127.0.0.1:54322`):
- `automation_settings`: `{"mode":"SHADOW","emergency_stop":false,"version":1}` (kembali ke snapshot awal).
- Sisa fixture `p14-%` pada `public.channel_identities`: **0**
- Sisa user `p14-%` pada `auth.users`: **0**
- Sisa customer `p14-%` pada `public.customers`: **0**
- Sisa complaint/episode `p14-%` pada `public.complaints`: **0**

Tidak ada residu data pengujian dan tidak ada akun staf yang terganggu.

---

## 4. Regresi Terkait dan Pemeriksaan Proyek

| Pemeriksaan | Cakupan | Hasil | Bukti |
| :--- | :--- | :---: | :--- |
| `npm test` (`test:unit`) | 105 domain unit tests (lifecycle, triage decision, classification, provider) | **PASS** | 105 pass, 0 fail, 244 ms |
| `npm run test:identity:local` | 8 skenario resolusi identitas sender nyata di DB lokal | **PASS** | 8 pass, 0 fail, 2827 ms |
| `npm run test:network:local` | 10 skenario mock network status, constraint & privileges di DB lokal | **PASS** | 10 pass, 0 fail, 5402 ms |
| `npm run test:triage:local` | 18 skenario triage decision engine terhadap DB lokal | **PASS** | 18 pass, 0 fail, 4339 ms |
| `npm run test:persistence:local` | 11 skenario integrasi; 12 checks PASS termasuk satu pengujian induk | **PASS** | 12 pass, 0 fail, 1602 ms |
| `npx tsc --noEmit` | Validasi tipe TypeScript seluruh project | **PASS** | Exit code 0, 0 error |
| `npm run lint` | ESLint seluruh project | **PASS** | Exit code 0, 0 error / warning |
| `npm run build` | Next.js production build (Turbopack) | **PASS** | Exit code 0, build sukses |

---

## 5. Batas Verifikasi dan Pernyataan Scope

1. **Reservasi bukan Izin Kirim:** Sesuai PRD §8 dan Decision Log D77, `outbound_intents` hanya mencatat reservasi draft dengan `dispatchAuthorized=false`. Tidak ada integrasi webhook pengiriman Telegram atau WhatsApp pada tahap ini.
2. **Kapasitas Transaksi:** Penggunaan single connection per transaksi dengan advisory lock pada driver `pg` memadai dan terbukti stabil untuk concurrency prototype. Skalabilitas multiserver/high-concurrency di luar scope prototype P1.4.
3. **Isolasi Lingkungan:** Seluruh tes dijalankan terhadap Supabase lokal. Tidak ada panggilan remote atau ketergantungan pada konfigurasi eksternal.
4. **Pengujian Layanan Staf Internal vs Sesi Browser:** Suite persistence menguji layer transaksi dan concurrency PostgreSQL secara langsung melalui `HelpdeskPersistence.staffAction()` dengan UUID staf valid. Pengujian ini membuktikan integritas atomisitas database dan version lock, bukan pengujian flow autentikasi/cookie sesi browser end-to-end (yang telah dicakup pada P0.4–P0.6).
5. **Status Penerapan Migration:** Migration `20260922090000_create_episode_persistence.sql` terkonfirmasi telah diterapkan pada database lokal sebelum pengujian verifikasi dijalankan (dikonfirmasi via `npx supabase migration list --local`), bukan diterapkan oleh agent pada saat eksekusi tes ini.
6. **Batasan Pengujian Reopen Database:** Skenario 4 membuktikan penambahan guard event claim setelah komplain GENERIC tanpa membuat reservasi episode ganda. Suite persistence P1.4 tidak menguji alur inbound reopen pada database; verifikasi transisi dan preservasi suppression inbound reopen dilakukan pada suite unit domain P1.3.
