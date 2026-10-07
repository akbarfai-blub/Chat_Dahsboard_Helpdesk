# P2.6 Tahap 2 — UI Inbox Review & Verification Report

**Tanggal:** 2026-10-07  
**Status:** ✅ **Done (Diselaraskan Berdasarkan Implementasi, Bukti Normal Terbaru, Bukti Negatif Historis, dan Penutupan D123)**  
**Keputusan Terkait:** [D78](decision-log.md#baseline-visual-layout-kontras-dan-interaksi-dasar-prototype-terpadu--d78), [D113](decision-log.md#d113), [D114](decision-log.md#d114), [D115](decision-log.md#d115), [D116](decision-log.md#baseline-desain-ui-inbox-penanda-non-warna-viewport-read-acknowledgment-dan-polling-5-detik--d116), [D117](decision-log.md#koreksi-p26-tahap-2--ui-inbox-isolasi-state--runner-browser-interaktif--d117), [D118](decision-log.md#d118), [D119](decision-log.md#d119), [D120](decision-log.md#d120), [D121](decision-log.md#d121), [D122](decision-log.md#d122), [D123](decision-log.md#d123)  
**Dokumen Acuan:** [docs/P2_6_STAGE2_HANDOFF.md](P2_6_STAGE2_HANDOFF.md), [docs/PRD.md](PRD.md), [docs/DESIGN_SYSTEM.md](DESIGN_SYSTEM.md), [docs/TRACKER.md](TRACKER.md)  
**Artefak Bukti:** `docs/evidence/P2_6/` (dengan indeks `docs/evidence/P2_6/latest-manifest.json`, manifest build `docs/evidence/P2_6/build-source-manifest.json`, dan direktori unik per-run)  

---

## 1. Ringkasan Eksekutif

Tahap 2 dari P2.6 mengimplementasikan antarmuka pengguna (UI) Inbox Helpdesk sebagai *landing dashboard* utama pada rute `/dashboard`. Melanjutkan konsolidasi D119, D120, dan D121, serangkaian koreksi akhir terarah dilakukan pada D122 untuk mengatasi celah metodologi pengikatan build-source, menambahkan validasi metadata terarah, dan menyelaraskan laporan dengan artefak sebenarnya:

1. **Pengikatan Hash Source dengan Build Sebenarnya (`scripts/build-source-manifest.mjs`)**:
   - Hash SHA-256 direkam secara langsung sebagai bagian dari proses kompilasi (`npm run build`), bukan saat runner pengujian dimulai.
   - Mengambil snapshot sebelum build (`preHashes`) dan membandingkannya dengan snapshot setelah build (`postHashes`). Jika terjadi mutasi berkas selama proses kompilasi, status dinyatakan `MUTATED_DURING_BUILD` dan manifest valid tidak diterbitkan.
   - Menyatakan cakupan berkas terarah secara eksplisit: `TRACKED_FILE_SCOPE = "p26_inbox_and_auth"` yang mencakup 18 berkas kunci (komponen UI Inbox, layout shell, routing dashboard, auth configuration, format helper, server service, kontrak data, dan validator origin).
   - Setelah kompilasi berhasil (`BUILD_ID: F-DKJqKQFwVIN2WjYeN-h`), manifest disimpan mengikat `buildId`, `sourceHashes`, `createdAt`, `scope`, dan `trackedFiles` ke `.next/build-source-manifest.json` dan `docs/evidence/P2_6/build-source-manifest.json`.
2. **Validasi Metadata Terarah & Pengujian Mandiri 6 Kasus (`tests/interactive/verify-build-metadata.test.mjs`)**:
   - Logika evaluasi murni `validateBuildMetadata()` membedakan secara jujur:
     - `sourceHashesAtBuild`: hash saat build yang tercatat di manifest build;
     - `sourceHashesAtLaunch`: hash aktual saat runner mulai sebelum server dan browser aktif;
     - `sourceHashesAtFinalize`: hash aktual saat evaluasi penutupan (teardown).
   - Suite pengujian mandiri `tests/interactive/verify-build-metadata.test.mjs` membuktikan seluruh 6 kasus tanpa browser atau database:
     1. Cocok -> `SYNCHRONIZED`, `isValid: true`, PASS, exit code 0;
     2. Manifest build tidak tersedia -> `MISSING_OR_INVALID_MANIFEST`, `isValid: false`, FAIL, exit code 1;
     3. BUILD_ID berbeda -> `BUILD_ID_MISMATCH`, `isValid: false`, FAIL, exit code 1;
     4. Source berubah sebelum runner diluncurkan -> `SOURCE_CHANGED_BEFORE_LAUNCH`, `isValid: false`, FAIL, exit code 1;
     5. Source berubah selama runner berjalan -> `SOURCE_CHANGED_DURING_RUN`, `isValid: false`, FAIL, exit code 1;
     6. Mode non-aplikasi -> Kasus keenam menguji `guard_rejection` secara langsung (`NOT_APPLICABLE`, `isValid: true`, `isApplicable: false`, exit code 0); fungsi implementasi juga mendukung `setup_failure` sebagai `NOT_APPLICABLE` secara logika tanpa klaim pengujian langsung pada kasus tersebut.
   - Hasil pengujian: **6 / 6 kasus PASS (exit code 0)**.
3. **Integrasi Runner & Live Normal Browser Run (`run-7fc817aa`)**:
   - Runner memverifikasi manifest pada Step 2.5 sebelum peluncuran server Next.js dan Chrome.
   - Assertion wajib `build_source_binding_verification` ditambahkan ke `NORMAL_BROWSER_REGISTRY` (total 24 assertion).
   - Live browser normal run membuktikan: `BUILD_ID: F-DKJqKQFwVIN2WjYeN-h`, status `SYNCHRONIZED`, 24 / 24 assertion PASS (exit code 0), runner revision hash `981bed57424824f3c5fd000301eda833efef56eaecea9a3a9645c45471393525`, 7 tangkapan layar PNG, dan 0 residu database tersisa.
4. **Penyelarasan Pelaporan & Pemisahan Exit Code yang Jujur**:
   - Membedakan secara presisi:
     - `expectedExitCode`: ekspektasi skenario (0 untuk normal & guard; 1 untuk mode kegagalan);
     - `calculatedExitCode`: hasil evaluasi runner yang dihitung di `summary.exitCode`;
     - `processExitCode`: hasil proses yang diamati langsung oleh shell/pemanggil dari proses eksekutor (bukan field yang tersimpan dalam JSON bukti).
   - Mengoreksi tabel alur cleanup: setup failure dan mid-run failure mengeksekusi rollback di blok `finally` (bukan fallback cleanup pipeline). Fallback cleanup pipeline (`fallbackCleanupFn`) hanya dijalankan saat primary cleanup melempar error (`--test-cleanup-failure`).
   - Seluruh daftar hash SHA-256 diselaraskan dan disalin langsung dari berkas manifest aktual tanpa perkiraan.

Seluruh perbaikan telah diverifikasi secara empiris melalui 24 assertion interaktif browser Chrome CDP native (seluruhnya PASS, exit code 0), suite unit test proyek (253 passed), suite integrasi inbox lokal (33 passed), suite pengujian mandiri metadata build (6/6 passed), suite pengujian mandiri finalizer (5/5 passed), pengujian 4 mode harness kegagalan/guard terencana (seluruhnya sesuai ekspektasi), serta pembersihan database tanpa residu.

---

## 2. Pemetaan Temuan Review, Perbaikan Kode, Assertion, dan Bukti

| No | Temuan Review & Integritas Runner (D121/D122) | Akar Masalah & Risiko | Solusi & Perbaikan Kode | Skenario / Assertion ID | Hasil Verifikasi Empiris | Artefak Bukti |
|:--:|---|---|---|---|---|---|
| **1** | **Pengikatan Hash Source dengan Build Sebenarnya** | Hash source sebelumnya dihitung saat runner mulai dan dinamai `sourceHashesAtBuild`, hanya membuktikan source tidak termutasi selama run, bukan kecocokan source dengan build sebenarnya. | Mekanisme `scripts/build-source-manifest.mjs` menghitung SHA256 pre vs post build, memvalidasi ketiadaan mutasi selama kompilasi, mengikat `BUILD_ID` ke manifest berstatus `VALID`, dan runner membandingkan `BUILD_ID` serta source launch terhadap manifest pada Step 2.5. | Assertion 1: `build_source_binding_verification`<br>`tests/interactive/verify-build-metadata.test.mjs` | **PASS (100% Sinkron & Tervalidasi)**<br>- `BUILD_ID`: `F-DKJqKQFwVIN2WjYeN-h`<br>- Status binding: `SYNCHRONIZED`<br>- 6/6 unit test metadata lulus (exit 0)<br>- 24/24 assertion live browser lulus (exit 0) | `docs/evidence/P2_6/build-source-manifest.json`<br>`docs/evidence/P2_6/run-7fc817aa/evidence.json` |
| **2** | **Isolasi Interceptor Stale & Sekuens Event Lengkap** | Interceptor stale respons berisiko bocor ke skenario berikutnya jika tidak dibersihkan di `finally`; event `B_rendered` belum tercatat eksplisit; skenario detail failure berisiko balapan jika Percakapan A belum tuntas terbuka. | Interceptor dijadikan single-use (`__staleInterceptedOnce`), dipulihkan di `finally`. Rekam event lengkap `["A_requested", "B_rendered", "A_released", "A_resolved", "B_remains_active"]`. Skenario detail failure B melakukan polling DOM aktif hingga Percakapan A terbukti terbuka sebelum fault B diinjeksi via run fixture ID. | Assertion 17: `stale_response_rejection`<br>Assertion 18: `detail_failure_isolation_after_open` | **PASS (100% Terisolasi)**<br>- Urutan barrier 5-tahap tervalidasi<br>- Interceptor dibersihkan di `finally`<br>- Percakapan A terbukti aktif sebelum injeksi B<br>- 0 kebocoran state | `docs/evidence/P2_6/run-7fc817aa/evidence.json` (assertion 17, 18) |
| **3** | **Diferensiasi Alur Cleanup: Rollback Finally vs Pipeline Fallback** | Setup failure dan mid-run failure dilaporkan seolah mengeksekusi fallback cleanup pipeline, padahal keduanya menjalankan rollback di blok `finally`. | Laporan dikoreksi: setup failure dan mid-run failure menjalankan rollback di blok `finally` (membunuh proses, menghapus user staf, membersihkan fixture); pipeline fallback cleanup (`primaryCleanupFn -> catch -> fallbackCleanupFn`) khusus menangani kegagalan operasional primary cleanup pada `--test-cleanup-failure`. Keduanya membuktikan 0 residu DB. | Assertion 24: `runner_cleanup_and_teardown`<br>CLI Mode: `--test-cleanup-failure`<br>CLI Mode: `--test-setup-failure`<br>CLI Mode: `--test-midrun-failure` | **FAIL Sesuai Ekspektasi (Exit 1)**<br>- Setup & Midrun: Rollback di `finally`<br>- Cleanup failure: Fallback dieksekusi<br>- Seluruh mode membuktikan 0 residu database (`conv=0, msg=0, id=0`) | `docs/evidence/P2_6/cleanup-fail-fc83f2bc/evidence.json`<br>`docs/evidence/P2_6/setup-fail-f8581666/evidence.json`<br>`docs/evidence/P2_6/midrun-fail-a783dbf9/evidence.json` |
| **4** | **Penyimpanan Artefak Unik Per-Run, Manifest Index & Pemisahan Exit Code Jujur** | Laporan sebelumnya mengklaim `processExitCode` tersimpan dalam JSON bukti; daftar hash pada laporan berbeda dari file aktual. | Artefak disimpan dalam direktori unik `docs/evidence/P2_6/<runId>/`. File indeks `latest-manifest.json` memetakan run per mode. Membedakan `expectedExitCode` dan `calculatedExitCode` (yang ada di JSON) dari `processExitCode` (yang diamati dari shell eksekutor). Seluruh 18 hash SHA256 disalin langsung dari berkas manifest. | `docs/evidence/P2_6/latest-manifest.json`<br>`docs/evidence/P2_6/<runId>/` | **PASS (100% Konsisten & Jujur)**<br>- JSON memuat expectedExitCode & calculatedExitCode<br>- Process exit code dikutip dari log eksekutor<br>- Seluruh 18 hash SHA256 cocok identik | `docs/evidence/P2_6/latest-manifest.json`<br>`docs/evidence/P2_6/run-7fc817aa/evidence.json` |
| **5** | **Pengujian Negatif Mandiri Logika Finalizer** | Logika finalizer melekat di runner browser; pengujian skenario registri inkomplit atau duplikat sulit diuji tanpa membuka browser/DB. | Ekstraksi logika evaluasi ke fungsi murni `evaluateFinalizeResults()` di `verify-p26-inbox.mjs`. Buat suite unit test terpisah `tests/interactive/verify-finalizer.test.mjs` yang menguji 5 kasus tanpa browser: (1) PASS normal; (2) INCOMPLETE missing ID; (3) FAIL duplicate ID; (4) Mode registry compliance; (5) Cleanup error forcing FAIL. | `tests/interactive/verify-finalizer.test.mjs` | **PASS (5/5 Kasus Lulus, Exit 0)**<br>- 1. Complete PASS -> exit 0<br>- 2. Missing ID -> exit 1<br>- 3. Duplicate ID -> exit 1<br>- 4. Mode registries -> exit 0<br>- 5. Cleanup error -> exit 1 | Output terminal & suite test mandiri |

---

## 3. Rincian Seluruh Berkas yang Dibuat dan Diubah

### A. Berkas Baru yang Dibuat
1. `scripts/build-source-manifest.mjs`:
   - *Tujuan:* Generator manifest pengikatan build-source. Merekam SHA-256 berkas sebelum dan sesudah `next build`, memvalidasi ketiadaan mutasi selama kompilasi, mengikat `BUILD_ID`, dan menerbitkan manifest `status: VALID`. Menyediakan fungsi murni `validateBuildMetadata()`.
2. `tests/interactive/verify-build-metadata.test.mjs`:
   - *Tujuan:* Suite unit test untuk logika validasi metadata build-source tanpa browser/DB, mencakup 6 kasus terarah (matching SYNCHRONIZED exit 0, missing manifest FAIL exit 1, build ID mismatch FAIL exit 1, pre-launch mutation FAIL exit 1, runtime mutation FAIL exit 1, non-app mode NOT_APPLICABLE exit 0).
3. `docs/evidence/P2_6/build-source-manifest.json`:
   - *Tujuan:* Artefak manifest persisten pengikatan build-source (`BUILD_ID: F-DKJqKQFwVIN2WjYeN-h`, status: VALID, 18 berkas).
4. `lib/supabase/auth-config.ts`:
   - *Tujuan:* Helper fungsi murni untuk meresolusi pasangan kredensial Supabase (`url` dan `clientKey`) secara atomik dan deterministik. Menerapkan 3 tier pasangan yang sah (`runtime_server` -> `test_override` -> `public_client`), menolak konfigurasi parsial dengan error deskriptif, menegakkan anti-bypass fail-closed, melarang peminjaman kunci lintas-sumber (*cross-source borrowing*), dan melarang keras penggunaan service-role key pada client/session publik staf.
5. `tests/utils/auth-config.test.ts`:
   - *Tujuan:* Suite pengujian unit untuk `auth-config.ts` yang mencakup 13 pengujian skenario komprehensif.
6. `lib/utils/format-date.ts`:
   - *Tujuan:* Formatter waktu berbasis standar Indonesia (`Asia/Jakarta`, WIB, 24-jam format).
7. `components/inbox/inbox-types.ts`:
   - *Tujuan:* Tipe data internal UI Inbox (`InboxFilterState`, `INITIAL_INBOX_FILTERS`).
8. `components/inbox/inbox-status-badge.tsx`:
   - *Tujuan:* Presentasi badge status episode, unread count, dan status verifikasi dengan kontras WCAG AA.
9. `components/inbox/inbox-filter-bar.tsx`:
   - *Tujuan:* Baris input pencarian dan filter status/episode/unread/needs-review.
10. `components/inbox/inbox-pagination.tsx`:
    - *Tujuan:* Kontrol paginasi daftar percakapan antrean (target sentuh >= 40px).
11. `components/inbox/inbox-conversation-list.tsx`:
    - *Tujuan:* Panel antrean percakapan masuk dengan role aksesibel, indikator seleksi visual ganda non-warna (border 4px + teks badge "Dipilih" dengan atribut `data-selected="true"`), dan pagination baris status.
12. `components/inbox/inbox-conversation-panel.tsx`:
    - *Tujuan:* Panel riwayat pesan percakapan aktif dengan layout header terpoles rapi untuk viewport sempit/mobile (`flex-col sm:flex-row`, badge wrapping), `IntersectionObserver` untuk tracking pesan di viewport, supresi saat tab hidden, tombol kembali mobile, dan kartu informasi Fase P3.
13. `components/inbox/inbox-status-banner.tsx`:
    - *Tujuan:* Banner peringatan polling terhenti dengan timestamp WIB dan tombol interaktif "Coba lagi".
14. `tests/domain/inbox-ui.test.ts`:
    - *Tujuan:* Suite pengujian unit untuk formatter tanggal dan pagination logic (7 checks).
15. `tests/interactive/verify-finalizer.test.mjs`:
    - *Tujuan:* Suite pengujian mandiri untuk logika evaluasi finalizer (`evaluateFinalizeResults`), mencakup 5 skenario komprehensif tanpa memerlukan browser, DB, atau Next.js.
16. `docs/evidence/P2_6/latest-manifest.json`:
    - *Tujuan:* Berkas indeks metadata yang memetakan eksekusi run terbaru per mode beserta `expectedExitCode`, `calculatedExitCode`, `buildId`, `runnerRevisionSha256`, dan path bukti.
17. `app/dashboard/complaints/page.tsx`:
    - *Tujuan:* Route redirect legacy dari complaints ke `/dashboard`.

### B. Berkas yang Dimodifikasi
1. `package.json`:
   - *Perubahan:* Memperbarui script `"build": "node scripts/build-source-manifest.mjs"` agar build manifest diterbitkan secara otomatis pada setiap kompilasi produksi.
2. `tests/interactive/verify-p26-inbox.mjs`:
   - *Perubahan:*
     - Mengimpor `computeSourceHashes`, `readBuildManifest`, `validateBuildMetadata`, `TRACKED_SOURCE_FILES`, `TRACKED_FILE_SCOPE`.
     - Menambahkan assertion `build_source_binding_verification` ke `DEPENDENT_TEST_SCENARIOS` dan `NORMAL_BROWSER_REGISTRY` (total 24 assertion).
     - Menjalankan validasi Step 2.5 sebelum peluncuran server Next.js dan Chrome.
     - Memperbarui `evaluateFinalizeResults` untuk memvalidasi `extraMetadata.buildValidation` dan menolak status PASS jika metadata tidak cocok.
     - Memperbarui `finalize()` untuk membedakan secara jujur `sourceHashesAtBuild`, `sourceHashesAtLaunch`, dan `sourceHashesAtFinalize`.
3. `lib/supabase/server.ts` & `proxy.ts`:
   - *Perubahan:* Menggunakan `resolveSupabaseAuthConfig` untuk inisialisasi server client dan proxy client.
4. `components/inbox/inbox-dashboard.tsx`:
   - *Perubahan:* Request ID tracking untuk anti-deadlock loading overlap, standarisasi tombol "Coba lagi", dekopling error polling list vs detail, snapshot isolation pada retry mark-read.
5. `docs/decision-log.md`:
   - *Perubahan:* Menambahkan entri append-only **D122** yang mencatat keputusan teknis pengikatan build-source eksplisit, validasi metadata terarah, pemisahan exit code jujur, dan penyelarasan bukti.
6. `docs/TRACKER.md`:
   - *Perubahan:* Memperbarui status P2.6 pada tabel dan detail task menjadi `🟡 In Progress (Koreksi Pengikatan Build–Source, Validasi Metadata, dan Keterlacakan Bukti Selesai Penuh — Siap Direview Akhir Penutupan)`.

### C. Daftar 18 Berkas Cakupan Eksplisit (`p26_inbox_and_auth`) dan Hash SHA-256 Aktual
*Diambil langsung dari `docs/evidence/P2_6/build-source-manifest.json` dan `docs/evidence/P2_6/run-7fc817aa/evidence.json`:*

| No | Path Berkas Sumber | SHA-256 Hash Aktual (Build & Launch) |
|:--:|---|---|
| 1 | `components/inbox/inbox-conversation-panel.tsx` | `85d47b36a2918c74339b2f6bc45a5896dd5c4dbc346ce52945b8a03b4808fefb` |
| 2 | `components/inbox/inbox-dashboard.tsx` | `308417cfb315def6f02974a934f189221a0cd8c371630ab31cd239b360da5d10` |
| 3 | `components/inbox/inbox-conversation-list.tsx` | `37ef98a5530afdeada7ebac486e384c3f0c002659cd852e71984ee884534a3a5` |
| 4 | `components/inbox/inbox-filter-bar.tsx` | `a04ffd161867dca515fce0ec29385cbe8dc2cbdcb58d3c015445244434ecb6fb` |
| 5 | `components/inbox/inbox-pagination.tsx` | `8c21fc06243d63d938a1240f7e4f02ff6273ce8a940e15c5a267747bb3c8be4f` |
| 6 | `components/inbox/inbox-status-badge.tsx` | `cae837e2e7916275674f1c56c4ca5175984646a4783759fd784e13e4fbc3a494` |
| 7 | `components/inbox/inbox-status-banner.tsx` | `ea86dc334dfa173d6eae6740dd2955afba051d6ac43b2639f2ff3ae187912fa6` |
| 8 | `components/inbox/inbox-types.ts` | `ec1766f0e9d1b34e893db083f3b525518e58faf036972d18621cb8dd19bbb813` |
| 9 | `components/layout/dashboard-shell.tsx` | `e6834cf374d8c315b6fb2c439bfe28d0fe020f32d0e5e8dffcf0d64bc6e245ac` |
| 10 | `app/dashboard/page.tsx` | `fafe3fb0e885294f256e1d717be27c7f64d0e5ef45b4ea9c83e700fe263e6d72` |
| 11 | `app/dashboard/complaints/page.tsx` | `aed660a75c1cad40c85f7ee61a06fa39c818200b175b0c68d2022fc366536de7` |
| 12 | `lib/supabase/auth-config.ts` | `7ba80cf0a5bc0a16d473257c0e8a996151bdd35bf3c62b3c5ed8153312b4080d` |
| 13 | `lib/supabase/server.ts` | `1a34658a36d1c89c772d92236943ccc6667517cc57d19d72cfe57ce29d01607b` |
| 14 | `lib/application/inbox-contracts.ts` | `f5db1e3fc528d0aafa7d9ab2f2aef2f8f41fa5f38382942a8742999435757b3e` |
| 15 | `lib/application/inbox-service.server.ts` | `2a3ba888fcebb66f6720e768177381c88111eaa569c183a15e88663571d8aed3` |
| 16 | `lib/application/inbox-service.ts` | `e7dd3b77b5857406f5d540aaa784b4077857312baa7fbe20695e2d37e819398e` |
| 17 | `lib/application/origin-validator.ts` | `d86014ec774013e5060a3a81137919071bbd134b2a04c7a56c7905cead6a1cb5` |
| 18 | `lib/utils/format-date.ts` | `d9570454184cdd3edc7d56a9a3d140b188aa87be61fd81484fe3ad6397c92bb3` |

---

## 4. Hasil Eksekusi Validasi Empiris

### A. Kompilasi TypeScript & Linting
```bash
npx tsc -p tsconfig.test.json
npx tsc --noEmit
npx eslint lib/supabase/auth-config.ts lib/supabase/server.ts proxy.ts tests/utils/auth-config.test.ts components/inbox/inbox-dashboard.tsx components/inbox/inbox-conversation-panel.tsx tests/interactive/verify-p26-inbox.mjs
```
- **Exit Code:** `0`
- **Hasil:** 0 error, 0 warning. Kompilasi tipe bersih.

### B. Suite Pengujian Unit Proyek
```bash
npm run test:unit
```
- **Exit Code:** `0`
- **Durasi:** ~440ms
- **Hasil:** **253 / 253 checks passed (0 failed)**.
- **Rincian:** Termasuk 13 checks pada `tests/utils/auth-config.test.ts`, 7 checks pada `tests/domain/inbox-ui.test.ts`, dan suite unit guard/domain lainnya.

### C. Pengujian Integrasi Lokal Inbox
```bash
npm run test:inbox:local
```
- **Exit Code:** `0`
- **Durasi:** ~3.30s
- **Hasil:** **33 / 33 tests passed (0 failed)** pada lingkungan PostgreSQL terisolasi (port 54332).

### D. Pengujian Mandiri Logika Finalizer (Unit Negative Tests)
```bash
node tests/interactive/verify-finalizer.test.mjs
```
- **Exit Code:** `0`
- **Hasil:** **5 / 5 Cases Passed (0 failed)**:
  1. Complete registry with all valid results -> Evaluates to PASS (exitCode: 0) (PASS).
  2. Missing required scenario ID in registry -> Evaluates to INCOMPLETE (exitCode: 1) (PASS).
  3. Duplicate scenario ID in results -> Evaluates to FAIL (exitCode: 1) (PASS).
  4. Mode registry compliance (GUARD & SETUP modes succeed with mode-specific subsets) -> Evaluates to PASS (exitCode: 0) (PASS).
  5. Cleanup error forces status to FAIL despite all scenario assertions passing -> Evaluates to FAIL (exitCode: 1) (PASS).

### E. Pengujian Mandiri Validasi Metadata Build–Source (Unit Negative & Positive Tests)
```bash
node tests/interactive/verify-build-metadata.test.mjs
```
- **Exit Code:** `0`
- **Hasil:** **6 / 6 Cases Passed (0 failed)**:
  1. Kasus 1: BUILD_ID dan source hashes cocok -> diterima (SYNCHRONIZED, PASS, exitCode: 0).
  2. Kasus 2: Manifest build tidak tersedia -> ditolak untuk mode browser (MISSING_OR_INVALID_MANIFEST, FAIL, exitCode: 1).
  3. Kasus 3: BUILD_ID berbeda -> ditolak (BUILD_ID_MISMATCH, FAIL, exitCode: 1).
  4. Kasus 4: Source berubah setelah build, sebelum runner dimulai -> ditolak (SOURCE_CHANGED_BEFORE_LAUNCH, FAIL, exitCode: 1).
  5. Kasus 5: Source berubah selama runner berjalan -> hasil akhir non-PASS dan exit nonzero (SOURCE_CHANGED_DURING_RUN, FAIL, exitCode: 1).
  6. Kasus Tambahan: Mode non-aplikasi -> menguji langsung mode `guard_rejection` berstatus NOT_APPLICABLE tanpa mengisi sinkronisasi semu (exitCode: 0); fungsi implementasi juga mendukung `setup_failure` sebagai NOT_APPLICABLE secara logika tanpa klaim pengujian langsung pada kasus tersebut.

### F. Harness Pengujian Kegagalan Terencana & Guard Runner (Negative Tests)
*Catatan:* Bukti mode negatif dan guard di bawah ini bersumber dari eksekusi run terdahulu yang telah diterima secara historis (direktori unik masing-masing tersimpan di `docs/evidence/P2_6/`), bukan berasal dari run normal terbaru `run-7fc817aa`. Sesuai aturan pelaporan, nilai `expectedExitCode` dan `calculatedExitCode` tercatat di dalam JSON bukti; nilai `processExitCode` diamati langsung dari log eksekusi proses shell eksekutor (bukan field JSON).

1. **Penolakan Guard Lingkungan Uji**:
   ```bash
   node tests/interactive/verify-p26-inbox.mjs --test-guard-rejection
   ```
   - **Expected Exit Code:** `0` | **Calculated Exit Code:** `0` | **Process Exit Code (Shell):** `0`
   - **Direktori Run:** `docs/evidence/P2_6/guard-316b9a84/`
   - **Artefak:** `docs/evidence/P2_6/guard-316b9a84/evidence.json`
   - **Hasil:**
     - Penolakan database workspace aktif (54322, 5432, postgres) -> `guard_active_db_rejection` (PASS).
     - Penolakan Supabase API aktif (54321) -> `guard_active_api_rejection` (PASS).
     - Penolakan marker token mismatch -> `guard_marker_mismatch_rejection` (PASS).

2. **Injeksi Kegagalan Setup Fixture**:
   ```bash
   node tests/interactive/verify-p26-inbox.mjs --test-setup-failure
   ```
   - **Expected Exit Code:** `1` | **Calculated Exit Code:** `1` | **Process Exit Code (Shell):** `1`
   - **Direktori Run:** `docs/evidence/P2_6/setup-fail-f8581666/`
   - **Artefak:** `docs/evidence/P2_6/setup-fail-f8581666/evidence.json`
   - **Hasil:** Error setup terinjeksi fail-closed, proses rollback di blok `finally` mengeksekusi penghapusan user uji, 0 residu database terverifikasi.

3. **Injeksi Kegagalan Mid-Run (Rollback di Finally)**:
   ```bash
   node tests/interactive/verify-p26-inbox.mjs --test-midrun-failure
   ```
   - **Expected Exit Code:** `1` | **Calculated Exit Code:** `1` | **Process Exit Code (Shell):** `1`
   - **Direktori Run:** `docs/evidence/P2_6/midrun-fail-a783dbf9/`
   - **Artefak:** `docs/evidence/P2_6/midrun-fail-a783dbf9/evidence.json`
   - **Hasil:** Kegagalan setelah pembuatan fixture memicu rollback di blok `finally`: proses Chrome/Next.js dihentikan (`taskkill`), user staf dihapus, fixture run dibersihkan, 0 residu database terverifikasi (`conv=0, msg=0, id=0`), dan skenario UI yang belum jalan tidak diklaim PASS.

4. **Injeksi Kegagalan Cleanup Teardown & Pipeline Fallback Cleanup**:
   ```bash
   node tests/interactive/verify-p26-inbox.mjs --test-cleanup-failure
   ```
   - **Expected Exit Code:** `1` | **Calculated Exit Code:** `1` | **Process Exit Code (Shell):** `1`
   - **Direktori Run:** `docs/evidence/P2_6/cleanup-fail-fc83f2bc/`
   - **Artefak:** `docs/evidence/P2_6/cleanup-fail-fc83f2bc/evidence.json`
   - **Hasil:**
     - Seluruh skenario UI dijalankan, lalu kegagalan operasional diinjeksikan pada batas pemanggilan `primaryCleanupFn` di dalam pipeline `primary -> catch -> fallback`.
     - Error primary dicatat pada `cleanupErrors` dan assertion `runner_cleanup_and_teardown` bernilai FAIL (`overallStatus: FAIL`).
     - Upaya pembersihan lanjutan (*fallback cleanup*) dieksekusi secara otomatis dan membuktikan 0 residu database tersisa (`conv=0, msg=0, id=0`).

### G. Kompilasi Produksi Next.js & Pembuatan Manifest Build
```bash
npm run build
```
- **Process Exit Code (Shell):** `0`
- **Build Identity:** `.next/BUILD_ID` = `F-DKJqKQFwVIN2WjYeN-h`
- **Tracked Files:** 18 berkas terarah (`p26_inbox_and_auth`)
- **Status Manifest:** `VALID`
- **Lokasi Manifest:** `.next/build-source-manifest.json` dan `docs/evidence/P2_6/build-source-manifest.json`
- **Hasil:** Turbopack compiled successfully; 8 rute siap (termasuk `/dashboard`, `/api/inbox/conversations`, `/api/inbox/conversations/[id]`, `/api/inbox/conversations/[id]/read`).

### H. Suite Pengujian Interaktif Browser Chrome CDP (`verify-p26-inbox.mjs`)
```bash
node tests/interactive/verify-p26-inbox.mjs
```
- **Expected Exit Code:** `0`
- **Calculated Exit Code:** `0`
- **Process Exit Code (Shell Eksekutor):** `0`
- **Lingkungan Uji:**
  - Server Next.js Production terisolasi pada port dinamis (`http://127.0.0.1:3310`)
  - GoTrue Auth Container pada port 54331
  - PostgreSQL Database terisolasi pada port 54332
  - Chrome Native CDP Headless pada port 9226
- **Direktori Run:** `docs/evidence/P2_6/run-7fc817aa/`
- **Artefak:** `docs/evidence/P2_6/run-7fc817aa/evidence.json`
- **Integritas Build & Runner:**
  - `buildIdentity.buildId`: `F-DKJqKQFwVIN2WjYeN-h`
  - `buildIdentity.manifestBuildId`: `F-DKJqKQFwVIN2WjYeN-h`
  - `buildIdentity.status`: `SYNCHRONIZED` (BUILD_ID dan seluruh source hashes cocok dengan manifest build)
  - `buildIdentity.isValid`: `true`
  - `buildIdentity.isApplicable`: `true`
  - `runnerRevisionSha256`: `981bed57424824f3c5fd000301eda833efef56eaecea9a3a9645c45471393525`
- **Hasil:** **24 / 24 Assertions Wajib LULUS PENUH (PASS)**:
  1. `build_source_binding_verification`: Validasi pengikatan BUILD_ID dan source hashes terhadap manifest build (PASS).
  2. `auth_setup`: Akun staf uji berhasil login dan memperoleh sesi aktif (PASS).
  3. `shell_integration_and_indicators`: Judul 'Inbox / Antrean', badge SHADOW, penanda dummy, dan target sentuh direktori pelanggan >= 40px (PASS).
  4. `desktop_two_pane_layout`: Layout dua panel 1280x800 berdampingan tanpa overflow (list: 380px, detail: 797px) (PASS).
  5. `conversation_list_rendering`: Render 25 item, preview pesan, waktu WIB, badge unread, dan item percakapan (PASS).
  6. `non_color_selection_indicator`: Pembeda seleksi non-warna ganda (border 4px + teks badge "Dipilih" ber-`data-selected="true"`) (PASS).
  7. `conversation_detail_thread`: Panel kronologis receivedAt ASC + kartu informasi Fase P3 (PASS).
  8. `search_and_filters`: Filter bar mendukung pencarian kata kunci dan menyaring daftar secara akurat (PASS).
  9. `pagination_reset_on_filter_change`: Navigasi ke Halaman 2, pengubahan filter pencarian otomatis mereset paginasi kembali ke Halaman 1 dengan parameter baru (PASS).
  10. `empty_vs_filtered_empty_states`: State 'Tidak ada hasil untuk filter ini' + tombol 'Reset filter' (PASS).
  11. `pagination_dataset_integrity`: Paginasi 28 fixture run (`[Run-${runId}]`): Halaman 1 (25 item) dan Halaman 2 (3 item) disjoin dan mencakup seluruh 28 ID (strict set equality: missing=0, unexpected=0) (PASS).
  12. `viewport_read_acknowledgment`: Bounding box viewport aktual via `getBoundingClientRect` pada fixture Pelanggan Delta (9 pesan, 0 reads di DB sebelum aksi), HTTP 200 `{ success: true }`, penambahan baris `staff_message_reads` dengan `is_confirmed = true`, pesan off-viewport tetap 0 baris DB, unread badge berkurang (PASS).
  13. `read_acknowledgment_retry_isolation`: Fault injection HTTP 500 memunculkan alert banner, tombol coba lagi mengirimkan ulang tepat snapshot pesan gagal (1 ID) tanpa penambahan ID baru, dan terkonfirmasi di database `is_confirmed = true` (PASS).
  14. `hidden_tab_read_suppression`: Tab dokumen tersembunyi (`document.hidden = true`) supresi 0 request network dan 0 mutasi DB status baca; saat tab kembali visible, pembacaan viewport berjalan normal (PASS).
  15. `polling_and_scroll_retention`: Polling 5s non-destruktif mempertahankan scroll saat membaca pesan lama dan memunculkan pill 'Pesan baru di bawah' (PASS).
  16. `polling_failure_and_banner_alert`: Kegagalan polling mempertahankan data terakhir dan menampilkan banner 'Pembaruan terhenti' dengan timestamp pembaruan terakhir (WIB) tanpa overpromise pemulihan (PASS).
  17. `polling_overlap_with_foreground_fetch`: Request foreground (klik paginasi Berikutnya) saat polling komponen tumpang tindih; loading selesai (`isLoadingList: false`), tombol paginasi aktif kembali, data halaman 2 tampil tepat (PASS).
  18. `stale_response_rejection`: Respons percakapan A yang ditunda dilepas setelah percakapan B terbuka (berangkat dari Percakapan C); urutan barrier event terverifikasi `["A_requested", "B_rendered", "A_released", "A_resolved", "B_remains_active"]`; percakapan B tetap aktif dan data A tidak menimpa B (PASS).
  19. `detail_failure_isolation_after_open`: Verifikasi polling DOM memastikan Percakapan A terbukti aktif sebelum injeksi; kegagalan detail B setelah A terbuka menampilkan error B, tidak membocorkan data lama A (PASS).
  20. `list_error_and_recovery_isolated`: Kegagalan daftar percakapan (HTTP 500) menampilkan error list; tombol 'Coba lagi' memulihkan 25 item secara independen sementara error detail tetap bertahan (PASS).
  21. `detail_error_and_recovery_isolated`: Kegagalan detail percakapan (HTTP 500) menampilkan error detail; tombol 'Coba lagi' memulihkan pesan percakapan secara independen sementara error daftar tetap bertahan (PASS).
  22. `mobile_viewport_and_navigation`: Single-pane mobile 375x667 dengan tombol 'Kembali ke daftar percakapan' yang mempertahankan filter dan state antrean (PASS).
  23. `keyboard_navigation_and_focus`: Navigasi keyboard menampilkan focus ring yang terlihat jelas (`outline-2 outline-offset-2`) dan region `aria-live` polite untuk notifikasi (PASS).
  24. `runner_cleanup_and_teardown`: Pembersihan child process via PID verification (`process.kill(pid, 0)`), penghapusan user staf via Admin API, dan pembersihan fixture via `cleanupFixture()` selesai tanpa residu database (0 conv, 0 msg, 0 id) (PASS).
- **Pembersihan Pasca-Run:**
  - Akun staf uji dihapus via Admin API (0 error).
  - Fixture run dibersihkan via `cleanupFixture()`.
  - Verifikasi residu database: 0 conversations, 0 messages, 0 identities tersisa milik run (`residualVerification: "0 residu (conversations=0, messages=0, identities=0)"`).

---

## 5. Bukti Visual dan Kepatuhan Desain (Impeccable Craft)

Pengujian visual terarah dilakukan menggunakan panduan Impeccable pada artefak tangkapan layar `docs/evidence/P2_6/run-7fc817aa/`:

1. **`desktop_inbox_two_pane.png`**:
   - Layout dua panel desktop (1280x800) seimbang, border pembatas jelas, kontras tipografi WCAG AA, badge SHADOW dan data dummy tidak menutupi hierarki antrean.
2. **`desktop_filter_applied.png`**:
   - Filter bar menyediakan kontrol intuitif dengan status aktif yang jelas. Paginasi otomatis kembali ke Halaman 1 saat filter diterapkan.
3. **`desktop_empty_filtered.png`**:
   - Filter kosong menyajikan pesan ramah ("Tidak ada hasil untuk filter ini") dan tombol "Reset filter" yang mengembalikan daftar secara instan.
4. **`desktop_polling_stopped_banner.png`**:
   - Banner peringatan koneksi menggunakan token peringatan netral/amber dengan timestamp format WIB dan tombol aksi coba lagi.
5. **`mobile_inbox_detail.png` & `mobile_inbox_list.png`**:
   - Tampilan mobile (375x667) bersih dalam mode single-pane. Header panel detail mobile (`mobile_inbox_detail.png` di `docs/evidence/P2_6/run-7fc817aa/`) dipoles dengan layout wrapping (`flex-col sm:flex-row`, flex-wrap) di mana badge status `Percakapan Aktif` dan `Ditangani` membungkus rapi di bawah judul pengirim tanpa pemotongan teks atau horizontal scroll. Sub-baris metadata rapi (verifikasi, external ID, channel, kode layanan). Tombol kembali memiliki target sentuh memadai (>= 40px) dan mempertahankan filter serta state antrean.
6. **`keyboard_focus_ring.png`**:
   - Focus ring terlihat jelas (`outline-2 outline-offset-2`) pada kontrol interaktif, mendukung navigasi keyboard penuh.

---

## 6. Batasan dan Keterbukaan Bukti

Untuk menjaga integritas teknis, berikut adalah batas bukti yang diverifikasi:
1. **Keterbatasan Histori D116 dan D117**: Isi asli entri D116 dan D117 sebelum pemadatan belum dapat diverifikasi atau dipulihkan karena ketiadaan sumber pembanding terverifikasi di workspace. Catatan ini dipertahankan sebagai catatan dokumentasi nonpenghambat yang tidak mempengaruhi validitas teknis kode atau bukti empiris P2.6 yang telah diterima.
2. **Bukan Pengujian Outbound**: Seluruh pengujian berada dalam mode otomasi `SHADOW`. Tidak ada pengiriman pesan otomatis ke Telegram atau WhatsApp yang dijalankan.
3. **Batas Simulasi Mock**: Data status jaringan menggunakan mock provider lokal tanpa koneksi perangkat fisik OLT/NMS.
4. **Batas Scope P2.6**: UI tidak menyediakan input pengetikan pesan aktif untuk composer balasan atau catatan internal staf (kedua fitur dijadwalkan pada Fase P3). Panel konteks jaringan lengkap dijadwalkan pada P2.7.
5. **Batas Bukti Unit vs Session Nyata**: Pengujian unit `auth-config.test.ts` membuktikan logika resolusi pasangan kredensial fail-closed; integrasi sesi staf nyata diverifikasi melalui runner browser interaktif terhadap GoTrue container port 54331.

---

## 7. Status Akhir dan Penutupan P2.6

Seluruh acceptance criteria P2.6 Tahap 1 dan Tahap 2 telah diselesaikan secara tuntas dan dibuktikan secara empiris:
- **Status Dokumen:** ✅ **Done**
- **Dasar Penutupan:** Seluruh bukti empiris telah tuntas dan diterima:
  - 18 berkas source terikat secara faktual pada `BUILD_ID: F-DKJqKQFwVIN2WjYeN-h` via `.next/build-source-manifest.json` dan `docs/evidence/P2_6/build-source-manifest.json`;
  - 6 / 6 pengujian unit metadata build mandiri lulus (exit code 0);
  - 5 / 5 pengujian unit finalizer mandiri lulus (exit code 0);
  - 24 / 24 skenario browser CDP live lulus penuh (`run-7fc817aa`, exit code 0);
  - 4 mode negative/guard harness terbukti fail-closed dan membedakan rollback `finally` dari fallback cleanup pipeline;
  - Residu database 0;
  - 253 unit tests proyek lulus penuh;
  - 33 integrasi inbox lulus penuh.
- **Rekomendasi / Next Step:** P2.6 resmi ditutup (**Done**). Pipeline berikutnya adalah P2.7 (Panel konteks identitas dan evidence jaringan). P2.7 belum dimulai.
