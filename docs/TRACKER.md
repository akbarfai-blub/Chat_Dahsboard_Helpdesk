# Project Tracker — Upaznet Helpdesk

Acuan: [PRD v2.1](PRD.md) · [Decision log sampai D77](decision-log.md). D43–D48 tidak tersedia.

> Tabel setiap phase berisi task, status, dependency, dan keputusan terkait. Klik Task ID untuk menuju detail, lalu buka bagian task tersebut untuk membaca acceptance criteria, bukti, dan catatan.

<a id="navigasi"></a>

**Navigasi:** [P0 · Foundation](#p0) · [P1 · Domain & Data](#p1) · [P2 · Vertical Slice Shadow](#p2) · [P3 · Balas & Penanganan](#p3) · [P4 · Outage & Controls](#p4) · [P5 · Pilot Lengkap](#p5)

**Status:** ✅ Done · 🟡 In Progress · ⬜ Not Started · ⛔ Blocked

`Done` berarti acceptance criteria terpenuhi dan ada bukti verifikasi. Kode yang belum diverifikasi tetap `In Progress`.

**Update manual:** ubah status pada tabel phase; perbarui acceptance criteria, bukti, atau catatan di bagian detail task yang sama. Setiap informasi disimpan satu kali.

---

<a id="p0"></a>

## P0 — Foundation

| Task ID              | Nama Task                                        | Status         | Dependency  | Decision ID Terkait |
| -------------------- | ------------------------------------------------ | -------------- | ----------- | ------------------- |
| [P0.1](#task-p0-1)   | Scaffold Next.js App Router + TypeScript         | ✅ Done        | —           | D50                 |
| [P0.2](#task-p0-2)   | Konfigurasi environment lokal                    | ✅ Done        | P0.1        | D50, D66            |
| [P0.3](#task-p0-3)   | Setup Supabase lokal dan Auth staf               | ✅ Done        | P0.2        | D50                 |
| [P0.4](#task-p0-4)   | Form dan aksi login staf                         | ✅ Done        | P0.3        | D50                 |
| [P0.5](#task-p0-5)   | Logout dan penanganan kegagalan logout           | ✅ Done        | P0.4        | D50                 |
| [P0.6](#task-p0-6)   | Proteksi halaman dashboard dengan sesi staf      | ✅ Done        | P0.3        | D50, D66            |
| [P0.7](#task-p0-7)   | Migrasi schema awal identitas dan topologi       | ✅ Done        | P0.3        | D67, D70            |
| [P0.8](#task-p0-8)   | Pembatasan akses database foundation             | ✅ Done        | P0.7        | D66, D70            |
| [P0.9](#task-p0-9)   | Seed dummy identitas dan topologi yang idempoten | ✅ Done        | P0.7        | D70                 |
| [P0.10](#task-p0-10) | Token UI terpusat                                | ⬜ Not Started | P0.1        | D69, D78            |
| [P0.11](#task-p0-11) | Layout dasar aplikasi dan dashboard              | 🟡 In Progress | P0.1, P0.10 | D69                 |

### Detail task

<a id="task-p0-1"></a>

<details>
<summary>P0.1 — Scaffold Next.js App Router + TypeScript</summary>

**Acceptance Criteria**

Struktur aplikasi dan konfigurasi TypeScript tersedia; aplikasi dapat dibangun dan lint lulus.

**Bukti/Verifikasi**

`package.json`, `tsconfig.json`, `app/layout.tsx`; `README.md` bagian “Pemeriksaan lokal 20 September 2026” mencatat build/lint lulus. Catatan ini selanjutnya disebut V20.

**Catatan/Blocker**

Bukti berlaku untuk baseline foundation yang diuji; belum membuktikan build seluruh perubahan terbaru.

</details>

<a id="task-p0-2"></a>

<details>
<summary>P0.2 — Konfigurasi environment lokal</summary>

**Acceptance Criteria**

Variabel memakai `UPPER_SNAKE_CASE`; contoh konfigurasi tersedia; env lokal diabaikan Git; koneksi aplikasi memakai URL dan publishable key, tanpa secret server pada variabel publik.

**Bukti/Verifikasi**

`.env.example`, `.gitignore`, `lib/supabase/server.ts`; review statis sesuai; V20 membuktikan koneksi dengan sesi staf berfungsi.

**Catatan/Blocker**

Scope konfigurasi lokal foundation; environment deployment belum diverifikasi.

</details>

<a id="task-p0-3"></a>

<details>
<summary>P0.3 — Setup Supabase lokal dan Auth staf</summary>

**Acceptance Criteria**

Supabase lokal menyediakan PostgreSQL dan Auth; URL aplikasi dikonfigurasi; akun staf dapat memperoleh sesi Auth.

**Bukti/Verifikasi**

`supabase/config.toml`; `tests/integration/network.test.ts` mencakup sign-in akun sementara; `README.md` mencatat integrasi database dan endpoint terautentikasi lulus pada 20 September.

**Catatan/Blocker**

Bukti untuk lingkungan lokal, bukan provisioning Supabase cloud.

</details>

<a id="task-p0-4"></a>

<details>
<summary>P0.4 — Form dan aksi login staf</summary>

**Acceptance Criteria**

Kredensial valid mengarahkan ke dashboard; input kosong atau kredensial salah menampilkan pesan yang sesuai; staf yang sudah login diarahkan ke dashboard.

**Bukti/Verifikasi**

`app/login/page.tsx`, `app/login/actions.ts`; `docs/P0_4_REVIEW.md` mencatat 13 skenario terverifikasi (AC1–AC9) via Playwright headless pada Supabase lokal: form berlabel Indonesia, submit kredensial valid mengarahkan ke dashboard, input kosong/spasi ditolak Server Action (`error=required`), kredensial salah menampilkan alert generik tanpa leak kredensial, staf login diarahkan kembali ke dashboard, navigasi keyboard Tab/Enter, build dan lint lulus pada 23 September 2026.

**Catatan/Blocker**

Guard validasi spasi pada password di Server Action telah diperbaiki. Seluruh acceptance criteria terpenuhi.

</details>

<a id="task-p0-5"></a>

<details>
<summary>P0.5 — Logout dan penanganan kegagalan logout</summary>

**Acceptance Criteria**

Logout mengakhiri sesi dan mengarahkan ke login; sesi lama tidak dapat membuka dashboard; kegagalan logout terlihat.

**Bukti/Verifikasi**

`app/login/actions.ts`, `app/login/page.tsx`, `app/dashboard/page.tsx`; `docs/P0_5_REVIEW.md` dan rangkaian artefak `docs/evidence/P0_5/`:
- Bukti fungsional browser E2E historis (23 Sept 2026, 37 PASS + 1 INFO, 0 FAIL, 0 NOT RUN; tetap valid, browser tidak dijalankan ulang karena tidak ada perubahan kode aplikasi):
  - Alur normal (`results-main.json`, 24 baris: 23 PASS + 1 INFO): logout via mouse dan keyboard (Tab+Enter, Tab+Space diawait tuntas), Server Action redirect terbukti via header `x-action-redirect`, cookie sesi hilang, penolakan akses ulang `/dashboard` & `/dashboard/customers`, penanganan Back/tab2/logout ganda, tanpa leak secret/password di HTML/console.
  - Alur kegagalan (`results-failure.json`, 9 baris: 9 PASS): simulasi HTTP 500 via proksi lokal pada `POST /auth/v1/logout`, pesan generik tampil di `/login?error=logout` (sesi hilang) dan `/dashboard?error=logout` (sesi valid), tombol coba lagi tersedia, retry sukses setelah pulih.
  - Mock terisolasi (`results-ac6d.json`, 5 baris: 5 PASS): verifikasi cabang Server Action asli `logout()` dan redirect Next.js.
- Verifikasi alat uji (`p05-harness-proof.mjs`, 25 Sept 2026):
  - Mode sintetis offline default: **20 checks PASS, 0 FAIL, 1 NOT RUN** (Group 10 integrasi akun GoTrue dilaporkan NOT RUN tanpa DB/key, exit code 0).
  - Mode integrasi akun lokal GoTrue (`--with-account`): **28 checks PASS, 0 FAIL, 0 NOT RUN** (diuji dengan kredensial via env lokal, exit code 0).
  - Pembuktian terhadap kode modul bersama yang aktual (`p05-harness-utils.mjs`) pada kedua harness, deteksi kebocoran memori asli sebelum sanitasi (password, JWT, Bearer token), output/artefak bebas secret mentah, kegagalan skenario menghasilkan exit code 1, kegagalan simpan hasil/cleanup menghasilkan exit code 1 dengan safe summary ke stderr dan cleanup tetap diupayakan, preservasi error utama saat screenshot/cleanup gagal, seluruh lulus menghasilkan exit code 0, penanganan Promise keyboard, penghapusan fallback service-role key tertanam dalam kode, penolakan target remote sebelum request, kegagalan prasyarat aman dengan exit code 1 saat integrasi diminta tanpa key, serta helper akun GoTrue paginasi penuh, get-by-id, dan safeguard anti-salah hapus akun non-uji.

**Catatan/Blocker**

Tidak ada pekerjaan tersisa dalam lingkup P0.5. Seluruh acceptance criteria dan temuan terbuka alat uji tertutup penuh dengan bukti empiris. Selesai (Done).

</details>

<a id="task-p0-6"></a>

<details>
<summary>P0.6 — Proteksi halaman dashboard dengan sesi staf</summary>

**Acceptance Criteria**

Dashboard dan direktori pelanggan dapat dibuka dengan sesi sah; pengunjung tanpa sesi diarahkan ke login.

**Bukti/Verifikasi**

`proxy.ts`, `app/dashboard/page.tsx`, `app/dashboard/customers/page.tsx`; V20 mencatat akses HTTP dengan sesi uji dan redirect tanpa sesi.

**Catatan/Blocker**

—

</details>

<a id="task-p0-7"></a>

<details>
<summary>P0.7 — Migrasi schema awal identitas dan topologi</summary>

**Acceptance Criteria**

Enam tabel awal tersedia: customers, services, odcs, odps, service_topology, channel_identities; relasi dan constraint dasar terdefinisi; data foundation dapat disimpan dan dibaca.

**Bukti/Verifikasi**

`supabase/migrations/20260919115958_create_customer_identity_topology.sql`; V20 mencatat seed serta pembacaan direktori berhasil.

**Catatan/Blocker**

Scope hanya schema awal P0. `docs/database_schema.sql` adalah snapshot historis, bukan acuan migrasi aktif.

</details>

<a id="task-p0-8"></a>

<details>
<summary>P0.8 — Pembatasan akses database foundation</summary>

**Acceptance Criteria**

RLS aktif pada enam tabel awal; anonim tidak mendapat akses; authenticated hanya memiliki akses baca langsung.

**Bukti/Verifikasi**

Policy dan grant pada migrasi awal telah diperiksa; V20 mencatat penolakan baca anonim dan insert langsung staf, serta pembacaan dengan sesi staf.

**Catatan/Blocker**

—

</details>

<a id="task-p0-9"></a>

<details>
<summary>P0.9 — Seed dummy identitas dan topologi yang idempoten</summary>

**Acceptance Criteria**

Seed menyediakan pelanggan, layanan, topologi, dan identitas dummy; pengulangan tidak menduplikasi atau menimpa data; akun Auth tidak berubah.

**Bukti/Verifikasi**

`supabase/seed.sql`; V20 mencatat seed dijalankan dua kali dengan checksum tetap, termasuk akun Auth.

**Catatan/Blocker**

—

</details>

<a id="task-p0-10"></a>

<details>
<summary>P0.10 — Token UI terpusat</summary>

**Acceptance Criteria**

Token warna dua lapisan (palet dasar primitives dan pemetaan semantik), tipografi Geist Sans dan Geist Mono dengan hierarki terdefinisi (display 24px sampai micro 10px), spacing scale, radius, batas kontrol, dan fokus ring mengikuti [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) v2.0; tersedia terpusat sebagai variabel CSS untuk dipakai konsisten oleh seluruh halaman dan komponen. Font Geist benar-benar dimuat dengan fallback terkonfigurasi.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

[DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) v2.0 (§3–§7) telah diselaraskan dengan identitas navy (`#003C71`), tombol aksi terkalibrasi (`#007A3D`), pemetaan semantik, tipografi Geist, pemakaian komponen, dan validasi kontras WCAG AA (D78). Implementasi token di kode belum dimulai (status tetap Not Started). Pekerjaan implementasi yang masih diperlukan di P0.10: pembuatan file token terpusat (`styles/tokens.css` atau variabel CSS di `app/globals.css`), pemuatan font Geist Sans dan Geist Mono di `app/layout.tsx`, serta pengujian bahwa variabel CSS aktif dan dapat dikonsumsi oleh P0.11 dan komponen UI lainnya.

</details>

<a id="task-p0-11"></a>

<details>
<summary>P0.11 — Layout dasar aplikasi dan dashboard</summary>

**Acceptance Criteria**

Layout menggunakan bahasa Indonesia, identitas prototype/data dummy, dan fondasi shell sesuai design system; tampilan dasar serta fokus keyboard diverifikasi.

**Bukti/Verifikasi**

`app/layout.tsx`, halaman login dan dashboard tersedia; V20 membuktikan halaman dapat diakses melalui HTTP.

**Catatan/Blocker**

Dashboard masih berupa panel sederhana; shell dasar dan penerapan token belum lengkap. Belum ada bukti review visual/keyboard yang menutup acceptance criteria.

</details>

[Kembali ke navigasi](#navigasi)

---

<a id="p1"></a>

## P1 — Domain & Data

| Task ID                | Nama Task                                                         | Status         | Dependency                         | Decision ID Terkait |
| ---------------------- | ----------------------------------------------------------------- | -------------- | ---------------------------------- | ------------------- |
| [P1.1.1](#task-p1-1-1) | Resolusi identitas sender dan layanan                             | ✅ Done        | P0.7, P0.8, P0.9                   | D73                 |
| [P1.1.2](#task-p1-1-2) | Klasifikasi keyword dan hasil analisis berversi                   | ✅ Done        | P0.1                               | D73                 |
| [P1.2](#task-p1-2)     | Decision engine kandidat template                                 | ✅ Done        | P1.1.1, P1.1.2, P1.5.2             | D65, D66, D67, D74  |
| [P1.3](#task-p1-3)     | Lifecycle episode, asosiasi pesan, dan suppression                | ✅ Done        | P1.1.1, P1.1.2, P1.2               | D65, D76            |
| [P1.4.1](#task-p1-4-1) | Schema persistence dan koneksi transaksi PostgreSQL               | ✅ Done        | P0.7, P0.8, P1.3                   | D66, D77            |
| [P1.4.2](#task-p1-4-2) | Penyimpanan ingress, identity baru, episode, dan assessment       | ✅ Done        | P1.4.1, P1.1.1, P1.1.2, P1.2, P1.3 | D68, D76, D77       |
| [P1.4.3](#task-p1-4-3) | Reservasi claim episode dan incident/event atomik                 | ✅ Done        | P1.4.2                             | D66, D67, D77       |
| [P1.4.4](#task-p1-4-4) | Rekonsiliasi identity dan ledger claim                            | ✅ Done        | P1.4.3                             | D66, D76, D77       |
| [P1.4.5](#task-p1-4-5) | Mutasi lifecycle staf dengan versi, audit, dan request ID         | ✅ Done        | P1.3, P1.4.2                       | D66, D76, D77       |
| [P1.5.1](#task-p1-5-1) | Schema dan fixture jaringan mock                                  | ✅ Done        | P0.7, P0.9                         | D67, D72            |
| [P1.5.2](#task-p1-5-2) | NetworkStatusProvider, MockProvider, freshness, dan agregasi area | ✅ Done        | P1.5.1                             | D60, D67, D72       |
| [P1.5.3](#task-p1-5-3) | API pemeriksaan mock khusus staf                                  | ✅ Done        | P1.5.2, P0.6                       | D66, D72            |

### Detail task

<a id="task-p1-1-1"></a>

<details>
<summary>P1.1.1 — Resolusi identitas sender dan layanan</summary>

**Acceptance Criteria**

Identitas dicocokkan berdasarkan channel/account/sender; hanya customer dan layanan valid yang di-resolve; no-match, unverified, konflik, inactive, timeout, dan lookup error menghasilkan alasan aman; isi chat tidak menjadi bukti identitas.

**Bukti/Verifikasi**

`lib/domain/sender-identity.ts`, `lib/providers/stored-identity-lookup.ts`, `lib/repositories/sender-identities.ts`; `README.md` merujuk `docs/P1_1_REVIEW.md`: 7 skenario integrasi P1.1 lulus pada 21 September 2026, termasuk isolasi channel/account, ambiguitas layanan, RLS, dan unique constraint.

**Catatan/Blocker**

Scope read-only; pembuatan identity sender baru dan penautan terverifikasi ditangani pada task persistence/integrasi.

</details>

<a id="task-p1-1-2"></a>

<details>
<summary>P1.1.2 — Klasifikasi keyword dan hasil analisis berversi</summary>

**Acceptance Criteria**

Lima keyword PRD dicocokkan setelah normalisasi dengan batas kata; pesan ambigu/non-teks masuk review; hasil menyertakan category, reason, ruleVersion, dan matchedKeywords tanpa LLM.

**Bukti/Verifikasi**

`lib/domain/message-classification.ts`, `lib/application/analyze-inbound-message.ts`, `tests/domain/message-classification.test.ts`; `docs/P1_1_REVIEW.md` yang dirujuk README mencatat 48 unit test lulus: 28 pengujian baru P1.1 dan 20 regresi jaringan; lint/build lulus pada 21 September.

**Catatan/Blocker**

Matching literal belum membuktikan target precision/recall pada dataset pilot. Penyimpanan label dan koreksi staf mengikuti P2.8.

</details>

<a id="task-p1-2"></a>

<details>
<summary>P1.2 — Decision engine kandidat template</summary>

**Acceptance Criteria**

Satu kandidat dipilih sesuai prioritas; GENERAL tanpa lookup/keyword; bukti dan freshness divalidasi; mode SHADOW/LOS_AND_GENERIC/FULL serta emergency stop diterapkan; `dispatchAuthorized=false`.

**Bukti/Verifikasi**

`lib/domain/triage-contracts.ts`, `lib/domain/triage-decision.ts`, `tests/domain/triage-decision.test.ts`, `tests/integration/triage.test.ts`; `docs/P1_2_REVIEW.md` yang dirujuk README mencatat 76 unit test dan 17 skenario integrasi lulus, lint/build lulus pada 21 September 2026.

**Catatan/Blocker**

Bukti hanya untuk pemilihan kandidat; belum mencakup renderer, CRUD incident, atau pengiriman.

</details>

<a id="task-p1-3"></a>

<details>
<summary>P1.3 — Lifecycle episode, asosiasi pesan, dan suppression</summary>

**Acceptance Criteria**

NEW/IN_PROGRESS/RESOLVED/CLOSED mengikuti kontrak; CLOSED final; versi request diperiksa; primary/target menentukan asosiasi; pesan non-komplain/ambigu tidak memicu reopen; GENERAL eligible dapat mengizinkan pembuatan atau asosiasi episode tanpa reopen; reopen tidak mereset debounce; takeover/split menghentikan first response; audit membedakan aktor staf dan inbound; fungsi deterministik dan tidak memutasi snapshot.

**Bukti/Verifikasi**

`lib/domain/episode-contracts.ts`, `lib/domain/episode-lifecycle.ts`, `tests/domain/episode-lifecycle.test.ts`; `docs/P1_3_REVIEW.md`, `docs/EPISODE_LIFECYCLE.md`, dan `docs/evidence/P1_3/p13-verification-evidence.md`:
- Suite pengujian unit lifecycle (`tests/domain/episode-lifecycle.test.ts`): **26/26 checks PASS, 0 FAIL** pada review independen terdahulu (25 September 2026).
- Suite regresi domain/provider (`npm test`): **105/105 PASS, 0 FAIL** mencakup 8 file (26 episode-lifecycle, 10 message-classification, 9 network-status, 3 reply-claim, 11 sender-identity, 28 triage-decision, 7 identity-lookup, 11 mock-provider).
- Matriks acceptance criteria mencakup seluruh 11 poin terpetakan ke fungsi domain murni dan terverifikasi secara empiris.

**Catatan/Blocker**

Selesai (Done). Seluruh 11 poin acceptance criteria terpenuhi secara deterministik tanpa I/O. Domain memisahkan posisi pesan (`isFollowUp`), suppression status (`suppressionApplies`), dan kelayakan respons pertama (`firstResponseCandidate`); seluruh hasil tetap `dispatchAuthorized=false`.

</details>

<a id="task-p1-4-1"></a>

<details>
<summary>P1.4.1 — Schema persistence dan koneksi transaksi PostgreSQL</summary>

**Acceptance Criteria**

Migration menyediakan episode, ingress/job, messages/assessment, claim, outbound intent, audit, dan dedup aksi staf; FK/check/unique/RLS sesuai; mutasi menggunakan satu koneksi dan transaksi/lock bersama.

**Bukti/Verifikasi**

`supabase/migrations/20260922090000_create_episode_persistence.sql`, `lib/postgres/server.ts`, `lib/postgres/transaction.ts`; `docs/evidence/P1_4/p14-verification-evidence.md` dan `docs/P1_4_REVIEW.md` mencatat migration telah terkonfirmasi diterapkan di database lokal sebelum pengujian verifikasi dijalankan (`npx supabase migration list --local`), dan suite integrasi `tests/integration/persistence.test.ts` mencatat 11 skenario integrasi lulus (12 PASS termasuk satu pengujian induk) membuktikan RLS, penolakan privilege peran anon/authenticated (error 42501), single connection per transaksi, serta advisory lock prototype pada 25 September 2026.

**Catatan/Blocker**

Selesai (Done). Seluruh skenario transaksi dan proteksi schema terbukti pada database Supabase lokal.

</details>

<a id="task-p1-4-2"></a>

<details>
<summary>P1.4.2 — Penyimpanan ingress, identity baru, episode, dan assessment</summary>

**Acceptance Criteria**

Identity sender tersedia; ingress+job tersimpan atomik; dedup mencakup channel/account/chat/message; episode, pesan, assessment, dan audit konsisten; pemrosesan ulang mengembalikan hasil tersimpan.

**Bukti/Verifikasi**

`HelpdeskPersistence.receive()` dan `process()` pada `lib/application/helpdesk-persistence.ts`, `lib/repositories/episode-store.ts`, `tests/integration/persistence.test.ts`; `docs/evidence/P1_4/p14-verification-evidence.md` membuktikan bahwa 8 request paralel identik hanya menghasilkan 1 ingress event dan 1 processing job; dedup membedakan `chat_id` dan `channel_account_id`; pemrosesan ulang mengembalikan hasil yang idempoten; serta pesan dari pengirim Telegram berbeda pada satu layanan yang sama menghasilkan 1 primary episode dan 1 reservasi.

**Catatan/Blocker**

Selesai (Done). Atomisitas ingress + job dan idempotensi processing terbukti secara empiris. Skenario 2 membuktikan dua pengirim Telegram berbeda pada satu layanan; bukan pengujian multi-channel (misal Telegram + WhatsApp).

</details>

<a id="task-p1-4-3"></a>

<details>
<summary>P1.4.3 — Reservasi claim episode dan incident/event atomik</summary>

**Acceptance Criteria**

Claim episode dan incident/event diperoleh bersama; konflik tidak meninggalkan claim parsial; SHADOW tidak mengambil claim; follow-up/suppression tidak mendapat jatah baru; reservasi tidak mengotorisasi dispatch.

**Bukti/Verifikasi**

`lib/domain/reply-claim.ts`, `EpisodeStore.reserve()` pada `lib/repositories/episode-store.ts`, `tests/domain/reply-claim.test.ts`, `tests/integration/persistence.test.ts`; `docs/evidence/P1_4/p14-verification-evidence.md` membuktikan reservasi atomik episode + incident claim via savepoint; konflik incident claim membatalkan seluruh reservasi tanpa meninggalkan claim parsial; mode SHADOW dan status emergency stop terbukti tidak mengambil claim pengiriman (`dispatchAuthorized=false`).

**Catatan/Blocker**

Selesai (Done). Reservasi bukan izin kirim; tidak ada dispatch yang diotorisasi.

</details>

<a id="task-p1-4-4"></a>

<details>
<summary>P1.4.4 — Rekonsiliasi identity dan ledger claim</summary>

**Acceptance Criteria**

Linking terverifikasi mempertahankan episode/claim lama; tidak memberi jatah balasan baru; primary dipilih konsisten; pending otomatis dibatalkan dan in-flight dilaporkan.

**Bukti/Verifikasi**

`lib/application/link-identity.ts`, wrapper `verifyAndLinkIdentity()` pada `lib/application/staff-episodes.server.ts`, `tests/integration/persistence.test.ts`; `docs/evidence/P1_4/p14-verification-evidence.md` membuktikan linking identity menggabungkan ledger claim tanpa menghapus claim lama, mempertahankan primary episode, membatalkan outbound intent pending, mempertahankan intent `in_flight`, dan menonaktifkan automation pada episode terkait (`automation_suppressed=true`).

**Catatan/Blocker**

Selesai (Done). Logika rekonsiliasi dan ledger claim terverifikasi runtime pada database lokal.

</details>

<a id="task-p1-4-5"></a>

<details>
<summary>P1.4.5 — Mutasi lifecycle staf dengan versi, audit, dan request ID</summary>

**Acceptance Criteria**

Aktor berasal dari sesi server; versi stale ditolak; request berulang idempoten; perubahan lifecycle/split/primary dan audit atomik; pending automation dihentikan saat takeover.

**Bukti/Verifikasi**

`HelpdeskPersistence.staffAction()` pada `lib/application/helpdesk-persistence.ts`, `lib/application/staff-episodes.server.ts`, `tests/integration/persistence.test.ts`; `docs/evidence/P1_4/p14-verification-evidence.md` membuktikan validasi `expectedVersion`; penolakan versi stale (`version_mismatch`); replay request ID identik yang idempoten; penolakan konflik request ID (`request_id_conflict`); penyimpanan balasan manual yang idempoten; pembatalan auto-reply pending saat takeover; serta aksi split yang menaikkan versi episode sumber (`version = v + 1`) dan penunjukan primary eksplisit.

**Catatan/Blocker**

Selesai (Done). Layanan transaksi staf internal terverifikasi atomik dan idempoten menggunakan ID staf langsung. Pengujian ini membuktikan transaksi DB dan concurrency guard, bukan pengujian autentikasi end-to-end sesi browser/cookie yang ditangani pada P0.6.

</details>

<a id="task-p1-5-1"></a>

<details>
<summary>P1.5.1 — Schema dan fixture jaringan mock</summary>

**Acceptance Criteria**

Tabel skenario, ONU, upstream, dan dampak layanan tersedia; fixture terisolasi dan idempoten; event ID stabil; pembacaan/seed ulang tidak menyegarkan observasi.

**Bukti/Verifikasi**

`supabase/migrations/20260920090000_create_mock_network_status.sql`, `supabase/fixtures/network.sql`, `supabase/fixtures/refresh-network-observations.sql`; README bagian “Validasi fondasi provider (20 September 2026)” mencatat skenario, constraint, RLS, dan seed idempoten lulus.

**Catatan/Blocker**

Scope data simulasi; tidak membuktikan integrasi OLT/NMS nyata.

</details>

<a id="task-p1-5-2"></a>

<details>
<summary>P1.5.2 — NetworkStatusProvider, MockProvider, freshness, dan agregasi area</summary>

**Acceptance Criteria**

Provider membedakan LOS/online/unknown dan kegagalan; freshness 5 menit serta threshold ≥3 LOS, rasio ≥50%, coverage ≥80% diterapkan; bukti upstream dan ONU terpisah; deadline 2 detik.

**Bukti/Verifikasi**

`lib/providers/network-status-provider.ts`, `lib/providers/mock-provider.ts`, `lib/domain/network-status.ts`; README mencatat 20 unit test serta integrasi database lulus pada 20 September 2026; kontrak pada `docs/NETWORK_PROVIDER.md`.

**Catatan/Blocker**

Threshold berlaku untuk fixture prototype; status online bukan bukti kualitas internet normal.

</details>

<a id="task-p1-5-3"></a>

<details>
<summary>P1.5.3 — API pemeriksaan mock khusus staf</summary>

**Acceptance Criteria**

Endpoint read-only mensyaratkan sesi staf dan `NETWORK_PROVIDER=mock`; input divalidasi; response memakai envelope/no-cache; not-found, provider error, dan timeout dibedakan.

**Bukti/Verifikasi**

`app/api/network-status/route.ts`, `lib/application/inspect-network.ts`, `tests/integration/network.test.ts`; README mencatat pengujian endpoint terautentikasi, envelope/no-cache, lint/build lulus pada 20 September.

**Catatan/Blocker**

Hasil tersedia melalui API; panel evidence dashboard mengikuti P2.7.

</details>

[Kembali ke navigasi](#navigasi)

---

<a id="p2"></a>

## P2 — Vertical Slice Shadow

| Task ID              | Nama Task                                             | Status         | Dependency                         | Decision ID Terkait |
| -------------------- | ----------------------------------------------------- | -------------- | ---------------------------------- | ------------------- |
| [P2.1](#task-p2-1)   | ChannelAdapter inbound Telegram dan pembatasan tester | ⬜ Not Started | P1.4.2                             | D50, D67, D68       |
| [P2.2](#task-p2-2)   | Webhook Telegram dengan secret dan ACK persisten      | ⬜ Not Started | P2.1, P1.4.2                       | D68, D77            |
| [P2.3](#task-p2-3)   | Conversation 24 jam dan pengaitan riwayat pesan       | ⬜ Not Started | P1.4.2                             | D65, D69            |
| [P2.4](#task-p2-4)   | Orkestrasi inbound ke assessment SHADOW               | 🟡 In Progress | P2.2, P2.3, P1.4.2, P1.5.2         | D65, D67, D68, D77  |
| [P2.5](#task-p2-5)   | Worker pemrosesan job dengan lease dan attempt        | ⬜ Not Started | P2.4                               | D68                 |
| [P2.6](#task-p2-6)   | Inbox/antrean sebagai landing dashboard               | ⬜ Not Started | P0.11, P0.6, P2.3, P2.4            | D65, D69, D71       |
| [P2.7](#task-p2-7)   | Panel konteks identitas dan evidence jaringan         | ⬜ Not Started | P2.6, P1.5.3                       | D69, D71, D72       |
| [P2.8](#task-p2-8)   | Label dan koreksi klasifikasi oleh staf               | ⬜ Not Started | P2.6, P1.1.2                       | D65, D66, D69       |
| [P2.9](#task-p2-9)   | Direktori pelanggan pendukung yang read-only          | ✅ Done        | P0.6, P0.8, P0.9                   | D70, D71            |
| [P2.10](#task-p2-10) | Konfigurasi dan deployment prototype SHADOW           | ⬜ Not Started | P0.2, P0.4, P0.5, P2.2, P2.5, P2.6 | D50, D67, D68       |
| [P2.11](#task-p2-11) | Verifikasi vertical slice SHADOW end-to-end           | ⬜ Not Started | P2.7, P2.8, P2.10                  | D65, D67, D68       |

### Detail task

<a id="task-p2-1"></a>

<details>
<summary>P2.1 — ChannelAdapter inbound Telegram dan pembatasan tester</summary>

**Acceptance Criteria**

Payload Telegram dinormalisasi tanpa rule domain di adapter; account/chat/message tetap terpisah; private chat dan tester allowlist divalidasi; input invalid/terlalu besar ditangani sesuai PRD.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Adapter dan validasi tester/private chat belum tersedia; identity lookup bukan pengganti validasi channel.

</details>

<a id="task-p2-2"></a>

<details>
<summary>P2.2 — Webhook Telegram dengan secret dan ACK persisten</summary>

**Acceptance Criteria**

Secret diperiksa sebelum efek samping; ingress+job committed sebelum ACK; DB gagal menghasilkan non-success; duplicate diterima idempoten tanpa membuat pekerjaan ganda.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Persistence internal sudah ditulis pada P1.4.2, tetapi route webhook dan verifikasi protokol belum tersedia.

</details>

<a id="task-p2-3"></a>

<details>
<summary>P2.3 — Conversation 24 jam dan pengaitan riwayat pesan</summary>

**Acceptance Criteria**

Conversation dikelompokkan berdasarkan inactivity 24 jam; pesan menyimpan identitas channel dan waktu penerimaan; pergantian conversation tidak mereset episode/debounce; pesan non-komplain tetap terlihat.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Tabel/kontrak conversation dan pengaitannya ke messages belum tersedia; persistence pesan P1.4 belum menutup scope ini.

</details>

<a id="task-p2-4"></a>

<details>
<summary>P2.4 — Orkestrasi inbound ke assessment SHADOW</summary>

**Acceptance Criteria**

Inbound menjalankan identitas, klasifikasi, pengambilan bukti, keputusan, dan asosiasi episode; assessment/handoff tersimpan; SHADOW tanpa claim atau outbound otomatis; I/O provider di luar transaksi.

**Bukti/Verifikasi**

`HelpdeskPersistence.process()` pada `lib/application/helpdesk-persistence.ts`, `lib/application/inspect-network.ts`; `docs/P1_4_REVIEW.md` mencatat proses persistence tersedia tetapi belum diuji dan belum terhubung ke webhook/worker.

**Catatan/Blocker**

Orkestrasi provider, conversation, webhook, dan worker belum tersambung end-to-end.

</details>

<a id="task-p2-5"></a>

<details>
<summary>P2.5 — Worker pemrosesan job dengan lease dan attempt</summary>

**Acceptance Criteria**

Job di-claim atomik dengan lease/attempt; pemicu paralel tidak memproses job yang sama; pekerjaan setelah ACK tercatat dan ditunggu runtime; crash sebelum selesai dapat dilanjutkan.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Penyimpanan `processing_jobs` tersedia sebagai fondasi P1.4; worker, lease, dan pengelolaan attempt runtime belum dibuat.

</details>

<a id="task-p2-6"></a>

<details>
<summary>P2.6 — Inbox/antrean sebagai landing dashboard</summary>

**Acceptance Criteria**

Inbox menampilkan percakapan dan episode, unread/status, filter, serta detail riwayat; non-komplain masuk review; data hanya tersedia bagi staf; polling baca 5 detik dan state loading/empty/error tersedia.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

README menyatakan inbox/antrean belum tersedia; landing saat ini masih dashboard sederhana.

</details>

<a id="task-p2-7"></a>

<details>
<summary>P2.7 — Panel konteks identitas dan evidence jaringan</summary>

**Acceptance Criteria**

Staf melihat layanan/topologi, source, observed_at, checked_at, freshness, coverage, alasan keputusan, dan unknown/stale; waktu tampil WIB; detail internal tidak masuk teks pelanggan.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

API pemeriksaan mock sudah tersedia; README menyatakan UI evidence belum dibuat.

</details>

<a id="task-p2-8"></a>

<details>
<summary>P2.8 — Label dan koreksi klasifikasi oleh staf</summary>

**Acceptance Criteria**

Staf dapat menyimpan label/koreksi bersama aktor dan waktu; hasil rule asli dan versinya tetap tersimpan; data dapat digunakan untuk evaluasi klasifikasi PRD §13.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Hasil klasifikasi berversi sudah ada, tetapi penyimpanan label koreksi dan UI belum tersedia.

</details>

<a id="task-p2-9"></a>

<details>
<summary>P2.9 — Direktori pelanggan pendukung yang read-only</summary>

**Acceptance Criteria**

Direktori menyediakan pencarian nama/kode, filter status administrasi, pagination 25, relasi layanan–ODP–ODC, dan identitas channel; status administrasi tidak disajikan sebagai status jaringan.

**Bukti/Verifikasi**

`app/dashboard/customers/page.tsx`, `app/dashboard/customers/loading.tsx`, `lib/repositories/customers.ts`; V20 mencatat HTTP dengan sesi staf, pencarian/filter literal, empty state, dan pembatasan akses berhasil; README merinci fitur direktori.

**Catatan/Blocker**

Scope fungsi direktori pendukung; review visual menyeluruh mengikuti P5.2.

</details>

<a id="task-p2-10"></a>

<details>
<summary>P2.10 — Konfigurasi dan deployment prototype SHADOW</summary>

**Acceptance Criteria**

Supabase prototype, Vercel env, bot token/secret, dan tester IDs terkonfigurasi; webhook HTTPS dapat dipakai; secret tetap server-side; default SHADOW; smoke test deployment tercatat.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

README menyatakan deployment belum diverifikasi; belum ditemukan konfigurasi/hasil deployment yang membuktikan task ini telah dikerjakan.

</details>

<a id="task-p2-11"></a>

<details>
<summary>P2.11 — Verifikasi vertical slice SHADOW end-to-end</summary>

**Acceptance Criteria**

Komplain dummy Telegram muncul di inbox beserta episode/assessment; duplicate tidak menggandakan data; unknown/non-komplain tetap terlihat; tidak ada outbound otomatis atau claim debounce di SHADOW.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Belum ada catatan uji Telegram → webhook → worker → dashboard; hasil unit/integrasi domain bukan bukti end-to-end.

</details>

[Kembali ke navigasi](#navigasi)

---

<a id="p3"></a>

## P3 — Balas & Penanganan

| Task ID            | Nama Task                                               | Status         | Dependency                          | Decision ID Terkait |
| ------------------ | ------------------------------------------------------- | -------------- | ----------------------------------- | ------------------- |
| [P3.1](#task-p3-1) | Renderer template tetap dan snapshot teks               | ⬜ Not Started | P1.2, P1.4.1                        | D65, D66, D69       |
| [P3.2](#task-p3-2) | Pemeriksaan terakhir sebelum dispatch                   | ⬜ Not Started | P1.4.3, P2.1, P2.5, P3.1            | D66, D67, D68, D77  |
| [P3.3](#task-p3-3) | Pengiriman Telegram melalui ChannelAdapter              | ⬜ Not Started | P2.1, P3.2                          | D50, D65, D67       |
| [P3.4](#task-p3-4) | Worker outbound, delivery attempt, dan retry aman       | ⬜ Not Started | P3.3                                | D68                 |
| [P3.5](#task-p3-5) | Composer balasan staf dan takeover automation           | 🟡 In Progress | P2.6, P1.4.5, P3.4                  | D65, D66, D68, D77  |
| [P3.6](#task-p3-6) | Catatan internal pada percakapan                        | ⬜ Not Started | P2.6                                | D65, D69            |
| [P3.7](#task-p3-7) | Kontrol lifecycle dan verifikasi identitas di dashboard | ⬜ Not Started | P2.6, P1.4.4, P1.4.5                | D65, D66, D76, D77  |
| [P3.8](#task-p3-8) | Recovery melalui inbound dan dashboard                  | ⬜ Not Started | P2.5, P2.6, P3.4                    | D68                 |
| [P3.9](#task-p3-9) | Verifikasi dan rollout tester LOS_AND_GENERIC           | ⬜ Not Started | P2.11, P3.4, P3.5, P3.6, P3.7, P3.8 | D65, D66, D67, D68  |

### Detail task

<a id="task-p3-1"></a>

<details>
<summary>P3.1 — Renderer template tetap dan snapshot teks</summary>

**Acceptance Criteria**

Key/placeholder divalidasi; template kosong/invalid memblokir dispatch; estimasi kosong memakai fallback PRD; teks aktual dan versi tersimpan; semua outbound memakai prefix simulasi; tidak ada konten generatif.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

README menyatakan renderer belum tersedia; pengelolaan versi melalui UI mengikuti P4.3.

</details>

<a id="task-p3-2"></a>

<details>
<summary>P3.2 — Pemeriksaan terakhir sebelum dispatch</summary>

**Acceptance Criteria**

Sebelum send, periksa handoff tersimpan, tester/private chat, follow-up/takeover, claim, template, mode penerimaan/terbaru, emergency stop, serta incident yang relevan; perubahan mode tidak memutar backlog SHADOW.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Decision engine dan reservasi tetap `dispatchAuthorized=false`; belum ada jalur otorisasi akhir pengiriman.

</details>

<a id="task-p3-3"></a>

<details>
<summary>P3.3 — Pengiriman Telegram melalui ChannelAdapter</summary>

**Acceptance Criteria**

Balasan otomatis dan staf memakai jalur adapter yang sama; tujuan hanya tester allowlist; prefix simulasi wajib; provider ID dan hasil pasti/ambigu dikembalikan tanpa mengklaim pesan telah dibaca.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

README menyatakan pengiriman balasan belum tersedia; tidak ada bukti pesan sampai tester.

</details>

<a id="task-p3-4"></a>

<details>
<summary>P3.4 — Worker outbound, delivery attempt, dan retry aman</summary>

**Acceptance Criteria**

Attempt disimpan sebelum HTTP; accepted menyimpan provider ID; timeout/crash setelah dispatch menjadi unknown tanpa retry buta; kegagalan pasti retryable mengikuti backoff/Retry-After maksimal 3 total attempt; permanen menjadi failed.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Antrean `outbound_intents` P1.4 belum merupakan implementasi worker/attempt pengiriman; belum ada hasil uji crash atau provider.

</details>

<a id="task-p3-5"></a>

<details>
<summary>P3.5 — Composer balasan staf dan takeover automation</summary>

**Acceptance Criteria**

Staf menulis dan mengirim dari dashboard; request ID mencegah klik ganda; balasan tersimpan dan tampil di riwayat; pending first response dihentikan atomik; in-flight/unknown ditampilkan; draft bertahan saat gagal.

**Bukti/Verifikasi**

Aksi `manual_reply` pada `lib/application/helpdesk-persistence.ts` menyimpan outbound intent dan membatalkan pending; `tests/integration/persistence.test.ts` memuat skenario idempotensi; `docs/P1_4_REVIEW.md` menyatakan test belum dijalankan dan belum ada send.

**Catatan/Blocker**

Composer, endpoint/Server Action publik, integrasi dispatch, delivery UI, dan verifikasi klik ganda belum tersedia.

</details>

<a id="task-p3-6"></a>

<details>
<summary>P3.6 — Catatan internal pada percakapan</summary>

**Acceptance Criteria**

Catatan internal menyimpan aktor/waktu, terlihat berbeda dari balasan pelanggan, dan tidak pernah masuk antrean pengiriman channel; AC-09 lulus untuk isolasi catatan.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Belum ditemukan penyimpanan atau UI catatan internal.

</details>

<a id="task-p3-7"></a>

<details>
<summary>P3.7 — Kontrol lifecycle dan verifikasi identitas di dashboard</summary>

**Acceptance Criteria**

Staf dapat mulai menangani, resolve dengan catatan, reopen, close, split/pilih primary, serta menautkan identitas setelah verifikasi; konflik versi terlihat; tidak ada transisi otomatis hanya karena jaringan online.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Layanan domain/persistence tersedia sebagai fondasi; UI dan endpoint publik untuk aksi staf belum dibuat.

</details>

<a id="task-p3-8"></a>

<details>
<summary>P3.8 — Recovery melalui inbound dan dashboard</summary>

**Acceptance Criteria**

Inbound memicu drain terbatas; dashboard memicu recovery terautentikasi setiap 30 detik dan menyediakan tombol proses ulang; lease mencegah duplikasi; unknown send tidak di-retry buta.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Worker/recovery belum tersedia; tanpa inbound/dashboard aktif, prototype belum menjanjikan recovery selalu berjalan.

</details>

<a id="task-p3-9"></a>

<details>
<summary>P3.9 — Verifikasi dan rollout tester LOS_AND_GENERIC</summary>

**Acceptance Criteria**

Skenario keselamatan tahap kirim lulus; Akbar memilih tahap kirim awal; balasan sampai tester; ONLINE_CHECK menjadi GENERIC; klik ganda, takeover, duplicate, crash, dan unknown diuji; hasil tercatat.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Kelulusan decision engine belum membuktikan keselamatan pengiriman nyata; aktivasi mode kirim belum memiliki bukti.

</details>

[Kembali ke navigasi](#navigasi)

---

<a id="p4"></a>

## P4 — Outage & Controls

| Task ID            | Nama Task                                       | Status         | Dependency                               | Decision ID Terkait         |
| ------------------ | ----------------------------------------------- | -------------- | ---------------------------------------- | --------------------------- |
| [P4.1](#task-p4-1) | Lifecycle dan UI incident manual                | ⬜ Not Started | P1.4.1, P2.6                             | D2, D34, D35, D36, D65, D66 |
| [P4.2](#task-p4-2) | Network event dan relasi lintas episode         | 🟡 In Progress | P1.5.1, P1.4.3, P2.7                     | D65, D66, D67, D77          |
| [P4.3](#task-p4-3) | Pengelolaan template dan versi aktif            | ⬜ Not Started | P3.1, P4.1                               | D65, D69                    |
| [P4.4](#task-p4-4) | Pengaturan mode, emergency stop, dan allowlist  | 🟡 In Progress | P1.4.1, P2.1, P3.2, P2.6                 | D66, D67, D68, D77          |
| [P4.5](#task-p4-5) | Log keputusan, audit, dan kesehatan pekerjaan   | ⬜ Not Started | P2.6, P3.4, P3.8, P4.1                   | D68, D69                    |
| [P4.6](#task-p4-6) | Simulator skenario jaringan pada dashboard      | ⬜ Not Started | P1.5.1, P1.5.3, P2.7, P4.4               | D67, D69, D72               |
| [P4.7](#task-p4-7) | Retensi data tanpa mereset debounce             | ⬜ Not Started | P1.4.3, P3.4, P4.1                       | D68                         |
| [P4.8](#task-p4-8) | Verifikasi prioritas dan debounce lintas sumber | ⬜ Not Started | P3.9, P4.1, P4.2, P4.3, P4.4, P4.5, P4.7 | D65, D66, D67, D68          |

### Detail task

<a id="task-p4-1"></a>

<details>
<summary>P4.1 — Lifecycle dan UI incident manual</summary>

**Acceptance Criteria**

Create langsung ACTIVE; maksimal satu manual ACTIVE ditegakkan DB; AREA wajib affected ID; reopen memakai ID sama; close normal manual; force-close wajib alasan; update versi dan audit atomik; edit tidak mengirim ulang.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Snapshot incident pada decision engine bukan CRUD/lifecycle incident; tabel incident dan UI belum tersedia.

</details>

<a id="task-p4-2"></a>

<details>
<summary>P4.2 — Network event dan relasi lintas episode</summary>

**Acceptance Criteria**

Event dummy memiliki ID stabil dan dapat menautkan banyak episode; perubahan bukti setelah respons pertama tidak mengirim ulang; event pulih tidak menutup episode otomatis; kejadian baru memakai ID baru.

**Bukti/Verifikasi**

Fixture event pada `supabase/fixtures/network.sql`; `complaint_evidence_links` pada migration P1.4 dan `EpisodeStore.evidence()` pada `lib/repositories/episode-store.ts`; README mencatat fixture terverifikasi, tetapi P1.4 belum diuji.

**Catatan/Blocker**

Registry/lifecycle `network_events`, hubungan terpadu, dan tampilan gangguan otomatis belum lengkap; korelasi produksi/hysteresis tetap OPEN.

</details>

<a id="task-p4-3"></a>

<details>
<summary>P4.3 — Pengelolaan template dan versi aktif</summary>

**Acceptance Criteria**

Staf mengelola default/per-incident; tepat satu versi aktif per scope/key; override incident didahulukan; preview dummy dan validasi placeholder tersedia; edit tidak mengubah snapshot riwayat atau mengirim ulang.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Tabel versi template dan UI pengelolaannya belum tersedia; kontrak key pada P1.2 bukan implementasi fitur ini.

</details>

<a id="task-p4-4"></a>

<details>
<summary>P4.4 — Pengaturan mode, emergency stop, dan allowlist</summary>

**Acceptance Criteria**

Pengaturan tervalidasi dan diaudit dengan versi; SHADOW default; mode tidak melonggarkan pesan lama; emergency stop menghentikan otomatis tetapi menjaga antrean/balasan staf; allowlist berlaku pada semua outbound.

**Bukti/Verifikasi**

Tabel `automation_settings` pada migration P1.4; pembacaan mode dan pembatasan receipt pada `lib/application/helpdesk-persistence.ts`; mode domain diuji pada P1.2, tetapi persistence P1.4 belum diuji.

**Catatan/Blocker**

Mutasi pengaturan, audit perubahan mode, pengelolaan allowlist, dan UI kontrol belum tersedia; belum ada bukti guard runtime end-to-end.

</details>

<a id="task-p4-5"></a>

<details>
<summary>P4.5 — Log keputusan, audit, dan kesehatan pekerjaan</summary>

**Acceptance Criteria**

Staf dapat melihat alasan keputusan, versi/bukti, aktivitas staf, failed/unknown/pending, attempt, dan umur job; waktu tampil WIB; data sensitif tidak bocor ke pelanggan.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Assessment dan audit persistence merupakan fondasi; halaman log/kesehatan dan query agregasinya belum tersedia.

</details>

<a id="task-p4-6"></a>

<details>
<summary>P4.6 — Simulator skenario jaringan pada dashboard</summary>

**Acceptance Criteria**

Staf dapat memilih skenario fixture untuk pemeriksaan prototype; pemilihan tidak mengubah mode global, tidak mengaktifkan incident manual, dan tidak memicu broadcast; source/waktu simulasi terlihat.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Fixture SQL dan parameter skenario API tersedia sebagai fondasi; UI simulator belum dibuat.

</details>

<a id="task-p4-7"></a>

<details>
<summary>P4.7 — Retensi data tanpa mereset debounce</summary>

**Acceptance Criteria**

Message/complaint/assessment dibersihkan 90 hari setelah episode final; inbound non-episode 90 hari dari penerimaan; audit incident 1 tahun; technical log 30 hari; claim yang masih diperlukan tetap dipertahankan.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Belum ditemukan mekanisme cleanup atau hasil uji retensi; wajib membuktikan AC-11 sebelum dinyatakan selesai.

</details>

<a id="task-p4-8"></a>

<details>
<summary>P4.8 — Verifikasi prioritas dan debounce lintas sumber</summary>

**Acceptance Criteria**

Manual GENERAL/AREA dan bukti otomatis menghasilkan satu jalur send; satu ACTIVE, reopen, perubahan template/mode, identity linking, dan event sama tidak memberi balasan kedua; race resolve-versus-send tercatat; AC-05/06/07/10/11 lulus.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Test domain prioritas P1.2 sudah ada, tetapi belum ada bukti uji terpadu incident/UI/dispatch/retensi.

</details>

[Kembali ke navigasi](#navigasi)

---

<a id="p5"></a>

## P5 — Pilot Lengkap

| Task ID            | Nama Task                                             | Status         | Dependency                                                         | Decision ID Terkait     |
| ------------------ | ----------------------------------------------------- | -------------- | ------------------------------------------------------------------ | ----------------------- |
| [P5.1](#task-p5-1) | Dataset berlabel dan evaluasi klasifikasi/template    | ⬜ Not Started | P2.8, P3.9                                                         | D65, D69, D73           |
| [P5.2](#task-p5-2) | Validasi UX, responsive, dan aksesibilitas alur utama | ⬜ Not Started | P0.4, P0.5, P0.10, P0.11, P2.7, P3.5, P3.6, P3.7, P4.3, P4.4, P4.5 | D69, D71                |
| [P5.3](#task-p5-3) | Acceptance suite terpadu AC-01–AC-12                  | ⬜ Not Started | P4.8, P5.2                                                         | D65, D66, D67, D68, D69 |
| [P5.4](#task-p5-4) | Uji burst, latency, dan metrik operasional            | ⬜ Not Started | P2.10, P3.8, P4.5                                                  | D68, D69                |
| [P5.5](#task-p5-5) | Rollout tester FULL setelah evaluasi                  | ⬜ Not Started | P4.4, P5.1, P5.3, P5.4                                             | D67                     |
| [P5.6](#task-p5-6) | Laporan pilot dan demo penerimaan Akbar               | ⬜ Not Started | P5.5                                                               | D65, D69, D71           |

### Detail task

<a id="task-p5-1"></a>

<details>
<summary>P5.1 — Dataset berlabel dan evaluasi klasifikasi/template</summary>

**Acceptance Criteria**

≥100 pesan berlabel dengan kelas terwakili; precision dan recall masing-masing ≥90%; koreksi template ≤5%; dataset, metode perhitungan, kesalahan, dan hasil tercatat sesuai PRD §13.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Unit test keyword tidak menggantikan evaluasi dataset; belum ditemukan laporan metrik pilot.

</details>

<a id="task-p5-2"></a>

<details>
<summary>P5.2 — Validasi UX, responsive, dan aksesibilitas alur utama</summary>

**Acceptance Criteria**

AC-12 lulus: keyboard/fokus, laptop/mobile, label/status, loading/empty/error, konflik versi, dan draft saat gagal dapat ditangani; hasil review dicatat untuk alur utama.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Beberapa kontrol dasar sudah memakai label/focus style, tetapi belum ada bukti review visual/keyboard/mobile menyeluruh.

</details>

<a id="task-p5-3"></a>

<details>
<summary>P5.3 — Acceptance suite terpadu AC-01–AC-12</summary>

**Acceptance Criteria**

Seluruh skenario acceptance PRD diuji end-to-end; 0 duplicate reply dan kebocoran data; kegagalan provider, identitas, concurrency, reopen, takeover, dan retensi memiliki hasil tercatat.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Kelulusan suite domain/foundation terdahulu tidak menutup acceptance produk terpadu.

</details>

<a id="task-p5-4"></a>

<details>
<summary>P5.4 — Uji burst, latency, dan metrik operasional</summary>

**Acceptance Criteria**

Burst 20 inbound simultan diuji; ACK p95 ≤2 detik dan first response p95 ≤10 detik pada operasi normal; coverage/no-match/stale/error/debounce/takeover, hasil provider, dan umur pending dilaporkan; recovery diukur terpisah.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Angka PRD adalah target, bukan hasil terukur; belum ada laporan beban atau latency prototype.

</details>

<a id="task-p5-5"></a>

<details>
<summary>P5.5 — Rollout tester FULL setelah evaluasi</summary>

**Acceptance Criteria**

Setelah evaluasi tahap awal dan pemilihan rollout oleh Akbar, FULL mengaktifkan ONLINE_CHECK sesuai bukti; allowlist, prefix simulasi, emergency stop, dan tanpa backlog replay tetap berlaku; hasil pengiriman tercatat.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Mode FULL sudah dikenali domain, tetapi belum ada bukti rollout tester atau pengiriman pada mode tersebut.

</details>

<a id="task-p5-6"></a>

<details>
<summary>P5.6 — Laporan pilot dan demo penerimaan Akbar</summary>

**Acceptance Criteria**

Demo menunjukkan komplain tester masuk, assessment dapat dijelaskan, satu respons otomatis yang layak, balasan staf, dan kegagalan yang terlihat; laporan menyertakan acceptance/metrik/batas prototype; tiket tetap manual di Custpanel.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Belum ada catatan demo atau penerimaan pilot; WhatsApp, OLT/NMS/Custpanel nyata, dan kesiapan produksi tetap di luar P0–P5 prototype ini.

</details>

[Kembali ke navigasi](#navigasi)
