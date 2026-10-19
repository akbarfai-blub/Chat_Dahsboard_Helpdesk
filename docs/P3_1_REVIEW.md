# P3.1 Review — Renderer Template Tetap dan Snapshot Teks

Dokumen ini menyajikan peninjauan implementasi terarah, arsitektur domain, migrasi skema database, integrasi persistence, dan bukti verifikasi empiris komprehensif untuk **P3.1 — Renderer template tetap dan snapshot teks** sesuai [AGENTS.md](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/AGENTS.md), [PRD.md §6.2, §7 (FR-07, FR-08), §10 (FR-13), §11 (FR-19)](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/docs/PRD.md), [TRACKER.md](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/docs/TRACKER.md), dan [decision-log.md](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/docs/decision-log.md) (D65, D66, D69, D159).

---

## 1. Ringkasan Status

- **Status Milestone**: ✅ **Done** (Seluruh acceptance criteria PRD §7, FR-07, FR-08, FR-13, dan FR-19 telah terimplementasi dan terverifikasi secara empiris melalui suite unit test domain murni, suite pipeline tooling, suite integrasi database terisolasi penuh dengan 0 skips, dan suite integrasi persistence baseline).
- **Keputusan Terkait**: D65, D66, D69, **D159**.
- **Batas Scope P3.1**:
  - Mengimplementasikan domain contracts & renderer murni tanpa I/O.
  - Mengimplementasikan skema migrasi dan seed idempoten untuk `response_templates`, `template_versions`, dan kolom snapshot pada `outbound_intents`.
  - Mengintegrasikan resolusi template aktif dan penyimpanan snapshot teks pada `HelpdeskPersistence.process()` dan `HelpdeskPersistence.staffAction()`.
  - Menegakkan penolakan fail-closed pada `template_error` (blokir dispatch, 0 baris `outbound_intents`/`reply_claims` dibuat).
  - `dispatchAuthorized` strictly dipertahankan `false` di seluruh alur.
  - Pre-dispatch guard akhir ([P3.2](TRACKER.md#task-p3-2)), dispatch HTTP ke Telegram ([P3.3](TRACKER.md#task-p3-3)), worker outbound ([P3.4](TRACKER.md#task-p3-4)), dan UI pengelolaan template ([P4.3](TRACKER.md#task-p4-3)) berada di luar scope dan tidak diimplementasikan pada task ini.

---

## 2. Implementasi Domain Murni

### A. Kontrak & Konstanta (`lib/domain/template-contracts.ts`)
- **Konstanta Resmi**:
  - `SIMULATION_PREFIX = "[SIMULASI DATA DUMMY]"`
  - `EMPTY_ESTIMATED_RECOVERY_FALLBACK = "masih dalam pemeriksaan"`
- **Teks Default 7 Template PRD §7 (`DEFAULT_TEMPLATE_BODIES`)**:
  - `MASS_GENERAL`: `"Saat ini terdapat gangguan jaringan yang berdampak luas. Laporan Anda sudah masuk antrean helpdesk. Estimasi pemulihan: {{estimated_recovery}}."`
  - `MASS_AREA`: `"Saat ini terdapat gangguan jaringan di area layanan Anda. Laporan Anda sudah masuk antrean helpdesk. Estimasi pemulihan: {{estimated_recovery}}."`
  - `NETWORK_DISRUPTION`: `"Terdeteksi indikasi gangguan jaringan yang memengaruhi layanan Anda. Laporan Anda sudah masuk antrean helpdesk."`
  - `LOS_AREA`: `"Terdeteksi indikasi gangguan sinyal yang juga terlihat pada beberapa koneksi di area Anda. Laporan Anda sudah masuk antrean helpdesk."`
  - `LOS_INDIVIDUAL`: `"Terdeteksi indikasi gangguan sinyal pada koneksi Anda. Laporan Anda sudah masuk antrean helpdesk untuk diperiksa."`
  - `ONLINE_CHECK`: `"Perangkat koneksi Anda terdeteksi online saat pengecekan. Keluhan Anda tetap kami teruskan ke helpdesk untuk pemeriksaan lebih lanjut."`
  - `GENERIC`: `"Mohon maaf atas kendalanya. Kondisi koneksi Anda belum dapat kami pastikan. Laporan Anda sudah masuk antrean helpdesk untuk pemeriksaan manual."`
- **Whitelist Placeholder per Kategori (`ALLOWED_PLACEHOLDERS_BY_KEY`)**:
  - `MASS_GENERAL` & `MASS_AREA`: strictly `["estimated_recovery"]`.
  - `NETWORK_DISRUPTION`, `LOS_AREA`, `LOS_INDIVIDUAL`, `ONLINE_CHECK`, `GENERIC`: `[]` (tidak mengizinkan placeholder apa pun).

### B. Validasi Sintaks & Whitelist (`validateTemplateBody`)
- Memvalidasi `key` terhadap daftar 7 `TemplateKey` resmi (`invalid_template_key`).
- Memvalidasi `body` bertipe string, tidak kosong (`empty_template_body`), dan panjang $\le 4096$ karakter (`body_too_long`).
- Deteksi sintaks kurung kurawal ketat: kurung kurawal tidak seimbang/menggantung/tunggal (seperti `{{estimated_recovery`, `estimated_recovery}}`, `{{{x}}}`, `{{}}`, atau nama dengan karakter non-identifier) ditolak tegas sebagai `malformed_placeholder_syntax`.
- Whitelist check: placeholder di luar whitelist privasi (misalnya `{{odp_id}}`, `{{customer_id}}`, atau `{{estimated_recovery}}` pada `GENERIC`) ditolak sebagai `disallowed_placeholder`.

### C. Resolusi Template Aktif (`resolveActiveTemplate`)
- **Prioritas Scope FR-07**: Template scope `'incident'` untuk `incidentId` yang cocok mengalahkan template scope `'default'` untuk template key yang sama.
- **Fallback**: Jika tidak ada template aktif scope `'incident'`, sistem melakukan fallback ke scope `'default'`.
- **Invariant Fail-Closed Tepat Satu Versi Aktif**:
  - Jika terdapat $> 1$ kandidat aktif pada scope terpilih $\to$ return error `conflicting_active_templates`.
  - Jika terdapat $0$ kandidat aktif pada scope terpilih dan default $\to$ return error `missing_active_template`.

### D. Rendering Otomatis (`renderAutomaticTemplate`)
- **Validasi Kunci Pra-Resolusi**: Memvalidasi secara ketat `typeof input.templateKey === "string" && VALID_TEMPLATE_KEYS.has(input.templateKey)` sebelum memanggil `resolveActiveTemplate`. Jika kunci tidak valid, langsung mengembalikan `outcome: "template_error"`, `canDispatch: false`, `errorCode: "invalid_template_key"`.
- **Substitusi `{{estimated_recovery}}`**:
  - Jika `estimatedRecovery` bernilai `null`, `undefined`, string kosong `""`, atau whitespace saja `"   "`, sistem menyubstitusi dengan `EMPTY_ESTIMATED_RECOVERY_FALLBACK` (`"masih dalam pemeriksaan"`).
  - Jika bernilai teks, dilakukan *literal replacement* menggunakan `.replaceAll("{{estimated_recovery}}.", () => recoveryVal)` dan `.replaceAll("{{estimated_recovery}}", () => recoveryVal)` sehingga mendukung template kustom insiden yang memuat placeholder lebih dari satu kali, tanpa mengevaluasi ulang pola `{{...}}` di dalam nilai estimasi (mencegah *template injection*).
  - Mencegah tanda titik ganda `..` di akhir kalimat jika teks estimasi sudah berakhiran tanda titik `.`.
- **Penambahan Prefix Wajib**: Mengembalikan teks akhir dengan prefix `[SIMULASI DATA DUMMY] `.
- **Hasil Deterministik**:
  - Sukses: `outcome: "rendered"`, `canDispatch: true`, `snapshot` berisi `{ templateKey, templateVersionId, templateVersion, templateScope, incidentId, renderedBodyWithoutPrefix, outboundText, renderedAt }`.
  - Gagal: `outcome: "template_error"`, `canDispatch: false`, `errorCode`, `reason`, `snapshot: null`.

### E. Normalisasi Balasan Staf (`renderStaffReplySnapshot` & `applySimulationPrefix`)
- Menjamin pesan manual staf ber-prefix tepat satu `[SIMULASI DATA DUMMY] `.
- **Normalisasi Prefix Berulang**: Menggunakan loop `while (body.startsWith(SIMULATION_PREFIX)) { body = body.slice(SIMULATION_PREFIX.length).trim(); }` sehingga pesan yang memiliki prefix 2x atau lebih dinormalisasi bersih menjadi tepat satu prefix.
- Menolak input kosong, spasi saja, atau hanya berisi pengulangan prefix simulasi tanpa pesan nyata (`empty_message_body`).
- Membatasi panjang maksimal balasan staf $\le 10000$ karakter.

---

## 3. Migrasi Skema & Seed Database

### A. Migrasi `supabase/migrations/20261019120000_create_response_templates.sql`
- **Kolom Insiden**: Menambahkan `description text` dan `estimated_recovery text` pada `public.incidents`.
- **Tabel `public.response_templates`**:
  - Relasi scope: `scope = 'default' and incident_id is null` atau `scope = 'incident' and incident_id is not null`.
  - Unique index: `(template_key) where scope = 'default'` dan `(incident_id, template_key) where scope = 'incident'`.
- **Tabel `public.template_versions`**:
  - Foreign key ke `response_templates(id)` dengan `on delete cascade`.
  - Check constraint: `version > 0`, `btrim(body) <> '' and length(body) <= 4096`.
  - **Partial Unique Index**: `CREATE UNIQUE INDEX template_versions_one_active ON public.template_versions(template_id) WHERE is_active = true` menjamin tepat maksimal 1 versi aktif per template di tingkat basis data.
- **Kolom Snapshot pada `public.outbound_intents`**:
  - `template_version_id uuid references public.template_versions(id)`
  - `template_key text`
  - `template_version integer check (template_version is null or template_version > 0)`
  - `template_scope text check (template_scope is null or template_scope in ('default', 'incident'))`
  - `template_error text`
  - Check constraint `outbound_intents_origin_fields_check`: merelaksasi syarat `body is null` untuk `origin = 'automatic'` menjadi `(body is null or (btrim(body) <> '' and length(body) <= 10000))` sehingga snapshot teks hasil render dapat disimpan, sekaligus menjaga kompatibilitas mundur dengan test lama yang meng-insert `body = null`.
- **Permissions & RLS**:
  - Revoke dari `anon, authenticated`.
  - RLS aktif dengan policy SELECT untuk `authenticated`.
  - Full access (`SELECT, INSERT, UPDATE, DELETE`) untuk `service_role`.
- **Mirror Invariant**: Salinan identik byte-for-byte dibuat pada `tests/test-env/supabase/migrations/20261019120000_create_response_templates.sql` untuk memenuhi syarat ketat `test-migration-runner.ts`.

### B. Seed Idempoten 7 Template PRD §7 (`supabase/seed.sql`)
- Ketujuh template default PRD §7 disemai dengan UUID deterministik:
  - `response_templates`: `70000000-0000-4000-8000-000000000001` s/d `...07`
  - `template_versions`: `71000000-0000-4000-8000-000000000001` s/d `...07` (version 1, `is_active = true`)
- Menggunakan klausul `ON CONFLICT (id) DO NOTHING` sehingga aman dijalankan berulang kali.

### C. Penyelarasan Tooling Deployment & Schema Verification
- `scripts/apply-prototype-pipeline.mjs`: `CORE_TABLES` diperluas mencakup `'response_templates'` dan `'template_versions'` (total 24 core tables).
- `tests/tooling/test-client-seam.mjs` & `tests/tooling/pipeline-tooling.test.mjs`: `MOCK_REPO_VERSIONS` diperbarui mencakup `'20261019120000'` (total 14 migrasi); assertion test 3.15 dan test 4.4 diselaraskan.
- Seluruh 53 checks pada `pipeline-tooling.test.mjs` lulus penuh.

---

## 4. Integrasi Persistence & Fail-Closed Behavior

### A. Alur Pemrosesan Inbound (`HelpdeskPersistence.process()`)
1. **Pembacaan Insiden**: Kueri insiden aktif pada `public.incidents WHERE status = 'ACTIVE'` membaca kolom `description` dan `estimated_recovery`.
2. **Evaluasi Template pada Rencana Reservasi**:
   - Ketika `planReplyClaim` menghasilkan rencana reservasi (`!plan.reason`) dan `decision.effectiveTemplateKey` tersedia:
     - Sistem mengambil kandidat template dari `public.response_templates` dan `public.template_versions` untuk key tersebut (mencakup scope `'default'` dan scope `'incident'` jika `decision.incidentId` ada).
     - Memanggil `renderAutomaticTemplate(...)`.
3. **Penanganan `template_error` (Fail-Closed Dispatch)**:
   - Jika hasil render adalah `template_error`:
     - `claim = { outcome: "skipped", reason: "template_error", intentId: null }`.
     - `dispatchAuthorized = false`.
     - Tidak ada baris yang di-insert ke `public.outbound_intents` maupun `public.reply_claims` (0 entri dibuat).
     - Mencatat event audit: `store.audit(episode.id, "template_error", { errorCode, reason, templateKey }, null, ingressId)`.
     - Mencatat `templateError` pada `triage_assessments.processing_result`.
4. **Penyimpanan Snapshot pada Hasil Render Sukses (`rendered`)**:
   - `store.reserve(...)` menerima snapshot render.
   - Baris `public.outbound_intents` menyimpan:
     - `body`: `snapshot.outboundText` (lengkap dengan prefix `[SIMULASI DATA DUMMY] `)
     - `template_version_id`: `snapshot.templateVersionId`
     - `template_key`: `snapshot.templateKey`
     - `template_version`: `snapshot.templateVersion`
     - `template_scope`: `snapshot.templateScope`
   - `triage_assessments.processing_result` menyimpan `templateSnapshot`.
5. **Penghindaran Properti Undefined pada `ProcessingResult`**:
   - `ProcessingResult` menyebarkan secara kondisional `...(templateSnapshot ? { templateSnapshot } : {})` dan `...(templateError ? { templateError } : {})` untuk mencegah perbedaan kesetaraan objek in-memory terhadap objek hasil deserialisasi JSONB dari database.

### B. Alur Balasan Manual Staf (`HelpdeskPersistence.staffAction()`)
1. Saat `action === "manual_reply"`, sistem memvalidasi dan memformat pesan via `renderStaffReplySnapshot(input.body)`.
2. Jika input kosong atau hanya berisi prefix simulasi, sistem melempar `PersistenceError("invalid_reply")`.
3. Fingerprint idempotensi perintah staf (`fingerprint([...])`) tetap dihitung dari `input.body` asli untuk konsistensi command log.
4. Teks yang disimpan ke `public.outbound_intents.body` adalah `staffOutboundText` yang sudah ber-prefix `[SIMULASI DATA DUMMY] `.

---

## 5. Bukti Verifikasi Empiris

### A. Unit Test Domain Murni (`tests/domain/template-renderer.test.ts`)
Dieksekusi dengan `npm test` (`tsc -p tsconfig.test.json && node --test`):
- **Hasil**: **9/9 checks PASS** (Total unit test suite aplikasi: **319/319 checks PASS**, exit code 0, durasi ~930ms).
- **Rincian Pengujian**:
  1. `validateTemplateBody - Valid templates and placeholders`: Memvalidasi ketujuh template default PRD §7 dan placeholder whitelist.
  2. `validateTemplateBody - Key and structure validation`: Menolak key tidak dikenal, body bukan string, body kosong, dan body $> 4096$ karakter.
  3. `validateTemplateBody - Syntax checking for curly braces`: Menolak kurung kurawal tunggal/menggantung `{{`, `}}`, `{{{x}}}`, `{{}}`, dan karakter non-identifier.
  4. `validateTemplateBody - Whitelist checking for placeholders`: Menolak placeholder terlarang seperti `{{odp_id}}`, `{{customer_id}}`, dan `{{estimated_recovery}}` pada `GENERIC`.
  5. `resolveActiveTemplate - Scope priority and invariants`: Membuktikan prioritas override incident mengalahkan default; fallback ke default jika tidak ada override incident; fail-closed `conflicting_active_templates` jika $>1$ aktif pada scope sama; fail-closed `missing_active_template` jika 0 aktif.
  6. `renderAutomaticTemplate - Seven PRD §7 default templates render with prefix`: Membuktikan seluruh 7 template PRD §7 ter-render akurat dengan prefix `[SIMULASI DATA DUMMY] `.
  7. `renderAutomaticTemplate - estimated_recovery fallback and substitution`: Membuktikan fallback `"masih dalam pemeriksaan"` saat estimasi `null`, `undefined`, `""`, atau `"   "`; substitusi normal; dukungan kemunculan ganda `{{estimated_recovery}}`; pencegahan titik ganda `..`; dan pencegahan template injection.
  8. `renderAutomaticTemplate - Template error propagation`: Membuktikan kegagalan validasi atau resolusi template (termasuk validasi kunci awal) menghasilkan `outcome: "template_error"`, `canDispatch: false`, dan `errorCode: "invalid_template_key"`.
  9. `applySimulationPrefix & renderStaffReplySnapshot`: Membuktikan idempoten prefix, normalisasi multi-prefix (2x atau lebih) menjadi tepat satu prefix, serta penolakan pesan yang hanya berisi prefix simulasi berulang atau whitespace saja.

### B. Tooling Pipeline Deployment (`tests/tooling/pipeline-tooling.test.mjs`)
Dieksekusi dengan `node tests/tooling/pipeline-tooling.test.mjs`:
- **Hasil**: **53/53 checks PASS** (exit code 0, durasi ~653ms).
- Membuktikan integritas skema (14 migrasi repo, 24 core tables termasuk `response_templates` dan `template_versions`).

### C. Integration Test Database Terisolasi (`tests/integration/template-renderer.test.ts`)
Dieksekusi dengan `npm run test:template:local` (`tsc -p tsconfig.test.json && node --conditions=react-server --env-file=.env.test --test .test-build/tests/integration/template-renderer.test.js`):
- **Hasil**: **8/8 checks PASS** (1 parent suite + 7 subtests), **0 fail, 0 skipped**, exit code 0, durasi ~1160ms.
- **Rincian Eksekusi Aktual**:
  1. `Database Schema & Constraints: Default templates exist and partial unique index prevents duplicate active versions`: PASS (29.9ms).
  2. `Inbound Processing in LOS_AND_GENERIC mode: Saves snapshot text with prefix and template metadata`: PASS (114.6ms).
  3. `Immutability Verification: Modifying template versions does NOT alter stored intent snapshot`: PASS (20.4ms).
  4. `Incident Override: Incident-scoped template beats default template and uses estimated_recovery`: PASS (122.4ms).
  5. `Fallback for estimated_recovery: When estimated_recovery is null, uses fallback string`: PASS (105.0ms).
  6. `Template Error Fail-Closed: Blocks dispatch and creates zero outbound records`: PASS (103.4ms).
  7. `Staff Manual Reply: Normalizes simulation prefix and rejects prefix-only inputs`: PASS (105.1ms).
- **Perbaikan Urutan Teardown & Foreign Key**:
  - Kolom non-existent `created_by` dihapus dari `INSERT INTO public.incidents`.
  - Relasi anak (`reply_claims`, `complaint_evidence_links`, `outbound_intents`) dibersihkan sebelum `response_templates` dan `incidents` dihapus, mencegah pelanggaran FK `23503` pada `template_versions` dan `incidents`.
  - `reply_owners` dibersihkan berdasarkan `customer_id` dan `identity_id` sebelum `cleanupFixture(pool, tracker)` dijalankan untuk mencegah pelanggaran FK `reply_owners_customer_id_fkey` pada tabel `customers`.
  - Teardown terstruktur: menangkap `primaryError`, mengumpulkan `cleanupErrors`, menghapus data staf dari `staff_commands` & audit log sebelum menghapus staf dari `auth.users`, memverifikasi kueri 0 residu pada 10 tabel, dan memanggil `combineErrors(primaryError, cleanupErrors)`.
  - Blok bypass `try { await pool.query("SELECT 1"); } catch { t.skip(); }` dihapus penuh; pengujian dieksekusi secara nyata terhadap instance PostgreSQL lokal yang aktif.

### D. Regresi Integration Test Baseline
1. `npm run test:persistence:local`: **12/12 checks PASS**, **0 fail, 0 skipped**, exit code 0, durasi ~1962ms.
2. `npm run test:shadow:local`: **6/6 checks PASS**, **0 fail, 0 skipped**, exit code 0, durasi ~1014ms.

### E. Verifikasi Linter & Typecheck
- `npx eslint lib/domain/template-*.ts lib/application/helpdesk-persistence.ts lib/repositories/episode-store.ts tests/domain/template-*.ts tests/integration/template-*.ts`: **0 errors, 0 warnings** (exit code 0).
- `npx tsc --noEmit`: **0 errors (Kompilasi TypeScript bersih)** (exit code 0).

---

## 6. Matriks Acceptance Criteria ke Bukti Empiris

| Acceptance Criteria (PRD §7, FR-07, FR-08, FR-13, FR-19) | Implementasi Teknis | Bukti Empiris Terverifikasi | Status |
|---|---|---|---|
| **1. Validasi Key dan Placeholder Whitelist** | • `validateTemplateBody` di `lib/domain/template-renderer.ts`<br>• `ALLOWED_PLACEHOLDERS_BY_KEY` membatasi `{{estimated_recovery}}` hanya untuk `MASS_GENERAL` & `MASS_AREA`. | • Unit test `tests/domain/template-renderer.test.ts` (test 1, 2, 3, 4)<br>• Penolakan `{{odp_id}}`, `{{customer_id}}`, `{{}}`, dll. terbukti. | ✅ Terbukti |
| **2. Template Kosong/Invalid Memblokir Dispatch (Fail-Closed)** | • `resolveActiveTemplate` & `renderAutomaticTemplate` mengembalikan `template_error`<br>• `HelpdeskPersistence.process()` memblokir reservasi intent/claim (0 baris dibuat) dan mencatat audit log. | • Unit test test 8<br>• Integration test skenario 6 (0 baris `outbound_intents`, `claim.reason = 'template_error'`, audit log tercatat). | ✅ Terbukti |
| **3. Estimasi Kosong Menggunakan Fallback PRD** | • `EMPTY_ESTIMATED_RECOVERY_FALLBACK = "masih dalam pemeriksaan"` diterapkan saat null/undefined/kosong.<br>• Pencegahan titik ganda `..`. | • Unit test test 7<br>• Integration test skenario 5 (outbound body memuat teks fallback tanpa titik ganda). | ✅ Terbukti |
| **4. Penyimpanan Teks Aktual dan Versi (Immutability)** | • `public.outbound_intents` menyimpan kolom `body`, `template_version_id`, `template_key`, `template_version`, `template_scope`<br>• Check constraint diperbarui. | • Migration `20261019120000`<br>• Integration test skenario 2 & 3 (mengubah `template_versions` tidak mengubah snapshot lama). | ✅ Terbukti |
| **5. Seluruh Outbound Memakai Prefix Simulasi** | • `SIMULATION_PREFIX = "[SIMULASI DATA DUMMY]"` diterapkan otomatis pada render otomatis dan balasan manual staf.<br>• Idempoten: mencegah double prefix dan menormalisasi multi-prefix berulang. | • Unit test test 6 & 9<br>• Integration test skenario 2, 4, dan 7 (seluruh outbound diawali tepat satu prefix). | ✅ Terbukti |
| **6. Bebas Konten Generatif** | • Domain renderer adalah fungsi murni deterministik berbasis template tetap PRD §7; tidak ada model AI atau teks probabilistik pada alur outbound. | • Seluruh substitusi berbasis string replacement literal deterministik; zero external AI/LLM calls. | ✅ Terbukti |
| **7. Batas Scope: dispatchAuthorized Tetap False** | • `dispatchAuthorized: false` ditegaskan pada `persistence-contracts.ts` dan `HelpdeskPersistence.process()`. | • Integration test skenario 2, 4, 5, 6 memverifikasi `result.dispatchAuthorized === false`. | ✅ Terbukti |

---

## 7. Kesimpulan

Tugas **P3.1 — Renderer template tetap dan snapshot teks** telah selesai penuh (**✅ Done**). Seluruh komponen domain renderer, skema database, seed template, dan integrasi persistence telah berfungsi sesuai spesifikasi PRD v2.1 dan aturan proyek. Pipeline dapat dilanjutkan ke tugas berikutnya: **P3.2 — Pemeriksaan terakhir sebelum dispatch**.
