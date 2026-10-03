# Laporan Review & Verifikasi P2.4 — Orkestrasi Inbound ke Assessment SHADOW

Status Task P2.4: **DONE**  
Rekomendasi: **Selesai dan Terverifikasi Penuh pada Database Nyata Terisolasi**

---

## 1. Kondisi Ingress Terdahulu (Histori Dampak Pengujian Lama)

Berdasarkan pemeriksaan *read-only* terdahulu (sebelum penetapan guard isolasi D87–D89), dua baris `ingress_events` nyata pengguna pada database lokal tidak ditemukan (hilang akibat eksekusi pengujian lama atau reset sebelum D87):
- `5b0ffccb-46d4-4b14-8e79-7cad86ed83f3`
- `9682eff5-63cd-442a-820c-ae5e7313e4f5`

*Atribusi & Batas Perlindungan Data*: Pencatatan histori ini dipertahankan secara utuh sesuai instruksi AGENTS.md. Kami tidak mengarang data pemulihan atau membuka kembali investigasi yang telah ditutup. Database pengguna (`Chat_Automation_Helpdesk` pada port 54321/54322) dilindungi penuh dan tidak pernah disentuh atau dimutasi sepanjang pelaksanaan P2.4.

---

## 2. Lingkungan Pengujian Terisolasi Nyata

Untuk memenuhi penutupan verifikasi nyata tahap pertama dan pengujian integrasi orkestrasi P2.4 tanpa merisikokan lingkungan pengguna, telah disiapkan lingkungan Supabase lokal khusus pengujian:
1. **Identitas Lingkungan & Port Terpisah**:
   - Project Name: `Chat_Automation_Helpdesk_Test`
   - Direktori Konfigurasi: `tests/test-env/supabase/`
   - Database Port: `54332` (terpisah dari database pengguna pada `54322`)
   - API / Kong Port: `54331` (terpisah dari API pengguna pada `54321`)
   - Status Layanan: Container Docker `supabase_db_Chat_Automation_Helpdesk_Test` dan komponen pendukung berjalan secara independen. Layanan pengguna tidak dihentikan atau diubah konfigurasinya.
2. **Schema & Fixture Migrations**:
   - Seluruh 7 migration schema resmi (`20260919115958` hingga `20260930100000_create_manual_incidents.sql`) diterapkan berurutan tanpa mengubah isi migration.
   - Seed data foundation (`supabase/seed.sql`) dan fixture jaringan (`supabase/fixtures/network.sql`) diterapkan pada database tes.
3. **Marker Isolasi Terverifikasi**:
   - Marker record dibuat pada tabel `public.mock_network_scenarios` dengan `id = 'test_env_isolated_marker'` dan `name = 'TEST_ENVIRONMENT_ISOLATION_TOKEN_7F89B2'`.
4. **Sumber Konfigurasi**:
   - Dideklarasikan dalam file `.env.test` di root workspace (`HELPDESK_TEST_DATABASE_URL`, `HELPDESK_TEST_API_URL`, `HELPDESK_TEST_SERVICE_ROLE_KEY`, `HELPDESK_TEST_ENV_MARKER`).
   - Eksekusi pengujian dijalankan dengan flag `--env-file=.env.test`.

---

## 3. Penutupan Verifikasi Database Nyata Tahap 1

Sebelum menjalankan pengujian orkestrasi bisnis, verifikasi guard dan siklus cleanup dibuktikan secara empiris pada database fisik nyata:
1. **Pembuktian Kesamaan Pasangan Target (PG Pool + Supabase API Query)**:
   - Guard `requireIsolatedDatabase(pool, supabase, config)` membaca record marker secara independen melalui PostgreSQL query dan Supabase JS Client `maybeSingle()`.
   - Terbukti token yang dibaca kedua jalur identik (`TEST_ENVIRONMENT_ISOLATION_TOKEN_7F89B2`), membuktikan PostgreSQL Pool dan Supabase Client mengakses instance database terisolasi yang sama persis.
2. **Siklus Hidup Entitas Penuh (`receive()` + `process()`) & Cleanup Bersih**:
   - Dibuat identitas baseline pembanding (`channel_identities`) yang tidak diikutsertakan dalam scope penghapusan fixture.
   - Dibuat identitas fixture tes, lalu dipanggil `persistence.receive()` dan `orchestrateProcessing()` dengan pesan komplain koneksi `"wifi mati total lampu merah los"`.
   - Terbukti seluruh grafik entitas terbentuk nyata di database: `messages` (1), `triage_assessments` (1), `complaints` (1), `complaint_audit_log` (>= 1), `conversations` (1), dan `processing_jobs` (`status = 'done'`).
   - Eksekusi `cleanupFixture(pool, { identityIds: [testIdent.id], ingressIds: [ingressId] })` membuktikan:
     - 100% entitas fixture tes terhapus dari seluruh tabel terkait.
     - Identitas pembanding baseline tetap utuh 100% (`count = 1`).
3. **Pembersihan Kegagalan Terkontrol Tanpa Kebocoran Koneksi**:
   - Controlled failure disuntikkan pada hook `onBeforeTransaction`.
   - Transaksi gagal sesuai ekspektasi; `cleanupFixture()` di blok `finally` membersihkan seluruh sisa fixture; job tetap tercatat `pending`; dan `pool` ditutup dengan aman tanpa kebocoran koneksi.

---

## 4. Implementasi Orkestrasi Inbound ke Assessment SHADOW (P2.4)

Komponen utama diimplementasikan pada `lib/application/orchestrate-processing.ts` dan integrasi transaksi pada `lib/application/helpdesk-persistence.ts`:
1. **Entry Point Internal Berbasis `ingressId` Tersimpan**:
   - `orchestrateProcessing(pool, supabase, ingressId, options)` memproses satu pesan ingress yang telah tersimpan persisten.
   - Isi pesan, pengirim (`senderExternalId`), dan timestamp `received_at` dibaca dari tabel tepercaya `public.ingress_events`.
   - Idempotensi fast-path: Jika pesan telah memiliki assessment pada `public.triage_assessments`, hasil pemrosesan dikembalikan langsung tanpa pemeriksaan ulang status provider.
2. **Eksekusi Provider di Luar Transaksi & Instrumentasi Hook**:
   - Pemanggilan `inspectNetworkStatus()` dieksekusi di luar `inHelpdeskTransaction` / advisory lock.
   - Pemisahan eksekusi dibuktikan melalui instrumentasi urutan hook pada `orchestrateProcessing()`: `onBeforeProvider` -> `onProviderCall` -> `onAfterProvider` -> `onBeforeTransaction`. Eksekusi transaksi database aktual (`HelpdeskPersistence.process()` di dalam `inHelpdeskTransaction`) dipanggil tepat setelah `onBeforeTransaction` sebagaimana diverifikasi melalui pemeriksaan alur kode.
   - Skenario default diselaraskan ke `"normal"`. Skenario invalid atau timeout ditangani terstruktur tanpa melempar unhandled exception.
   - Snapshot kualitas provider (`providerQuality`) terstruktur mencakup: `source: "MOCK"`, `scenarioId`, `outcome`, `reason`, `onu` (status, quality, observedAt), `upstream` (status, quality, observedAt), dan `checkedAt`. Snapshot ini disimpan persisten di dalam kolom `processing_result` pada `public.triage_assessments` untuk kebutuhan audit.
3. **Sumber Otoritatif Incident Database & Revalidasi Identitas dalam Transaksi**:
   - Pada saat transaksi final dimulai (`HelpdeskPersistence.process()`), database menjadi satu-satunya sumber otoritatif manual incidents aktif via `SELECT id, type, status, odp_ids, odc_ids, version FROM public.incidents WHERE status = 'ACTIVE' FOR SHARE`.
   - Daftar incident final tidak dibatasi oleh snapshot context awal sebelum provider berjalan; seluruh incident aktif terbaru diikutsertakan.
   - Snapshot context lama tidak pernah dihidupkan kembali sebagai bukti aktif jika baris database tidak ditemukan atau sudah tidak aktif (eliminasi total fallback runtime sintetis).
   - Jika incident telah selesai atau dihapus selama jeda provider, bukti usang dibatalkan dan sistem jatuh kembali (*fallback*) ke bukti independen/generic yang aman.
   - Identitas pengirim divalidasi ulang; jika terjadi deregistrasi/unverified selama jeda provider, bukti ONU tidak dapat diterapkan pada identitas lain.
4. **Penegakan Mode SHADOW**:
   - Di bawah mode `SHADOW`, sistem menghasilkan tepat 0 klaim otomatis (`claim.outcome = "skipped"`, `claim.reason = "shadow_mode"`) dan 0 draft balasan otomatis di `public.outbound_intents` (`dispatchAuthorized = false`).
   - Peningkatan konfigurasi ke `FULL` tidak mengaktifkan backlog SHADOW yang sudah tersimpan (idempotensi tetap terjaga).
5. **Penanganan Kasus Bisnis & Pengecualian Sesuai PRD**:
   - Kasus GENERAL pada sender verified dan pesan non-komplain membypass provider jaringan (terbukti 0 provider calls).
   - Pengirim unverified dan pesan non-komplain tanpa GENERAL diproses ke template `GENERIC` / status review tanpa lookup jaringan.
   - Pesan media tanpa caption tersimpan bersih di `ingress_events` dan `messages` tanpa mengarang teks pelanggan.
   - Fault injection terarah di tengah transaksi membuktikan rollback bersih (0 baris di luar transaksi), dan retry berikutnya berhasil secara idempoten.

---

## 5. Bukti Pengujian & Hasil Empiris

### A. Pengujian Integrasi Orkestrasi & Real Database P2.4
- **Perintah**: `node --env-file=.env.test --test .test-build/tests/integration/orchestration.test.js`
- **Exit Code**: `0`
- **Hasil**: **11 passed**, 0 failed, 0 skipped (Durasi: ~4,2 detik).
- **Rincian Subtest**:
  1. `✔ Real Database Verification: receive() + process() creates full entity graph and cleanup removes all test entities leaving baseline intact`
  2. `✔ Real Database Verification: Controlled failure in processing performs cleanup without connection leaks`
  3. `✔ AC 1: Simulated Telegram webhook ingress saves job first, then explicit processing completes full persistence graph`:
     - Payload Telegram Update valid dikirim via `handleTelegramWebhook()` dengan secret dan akun tes.
     - Respons webhook mengembalikan HTTP 200 `{ status: "accepted", duplicate: false }`.
     - Ingress dan job tersimpan (`status = 'pending'`), dengan 0 messages dan 0 assessments pada jalur ACK.
     - Pemanggilan `orchestrateProcessing()` secara eksplisit melengkapi grafik entitas: `messages` (1), `conversations` (1), `complaints` (1), `triage_assessments` (1), `complaint_audit_log` (>= 1), dan job `status = 'done'`.
  4. `✔ AC 2: Scenario matrix produces decisions and reasons adhering to PRD`:
     - 10 skenario teruji: `normal` -> ONLINE_CHECK (`online`), `los_individual` -> LOS_INDIVIDUAL (`los_individual`), `los_area` -> LOS_AREA (`los_area`), `upstream_down` -> NETWORK_DISRUPTION (`upstream_down`), `stale`/`unknown`/`timeout`/`provider_error` -> GENERIC (`onu_unusable`), partial failure, manual AREA match -> MASS_AREA (`manual_area_match`), manual AREA no-match -> ONLINE_CHECK (`online`).
  5. `✔ AC 3: GENERAL and non-complaint bypass provider (0 calls); Unverified and media without caption handled cleanly`:
     - GENERAL terbukti 0 provider calls -> MASS_GENERAL (`general_active`).
     - Non-komplain terbukti 0 provider calls -> review tanpa episode (`episodeId = null`).
     - Unverified sender terbukti 0 provider calls -> GENERIC (`identity_unresolved`).
     - Media foto tanpa caption tersimpan bersih di `ingress_events` dan `messages`.
  6. `✔ AC 4: SHADOW mode suppresses auto claims and intents; settings change to FULL does not activate backlog`:
     - `claim.outcome = "skipped"`, `claim.reason = "shadow_mode"`, `dispatchAuthorized = false`, 0 baris `outbound_intents`.
     - Update settings ke FULL tidak mengaktifkan backlog SHADOW yang sudah tersimpan.
  7. `✔ AC 5: Deduplication prevents duplication across sequential and parallel runs; follow-up reuses episode`:
     - Dedup sekuensial dan paralel menghasilkan tepat 1 message dan assessment identik.
     - Follow-up pesan kedua pada masalah yang sama mengaitkan `episodeId` yang sama persis tanpa membuat episode baru.
  8. `✔ AC 6: Fault injection in mid-transaction verifies transaction rollback; retry succeeds and is idempotent`:
     - Proxy pool menyuntikkan kegagalan pada saat mutasi `INSERT INTO public.triage_assessments` (setelah `messages`, `complaints`, dan `complaint_audit_log` dimutasi dalam transaksi aktif).
     - Pemeriksaan independen di luar transaksi membuktikan rollback penuh: 0 baris messages, 0 baris complaints, 0 baris assessments; job tetap `pending`.
     - Retry tanpa error berhasil idempoten dan menandai job `done`.
  9. `✔ AC 7: Provider runs outside transaction; hook sequence verified; revalidates changed identity, incident replacement, and deleted incident`:
     - Urutan hook terbukti deterministik: `onBeforeProvider` -> `onProviderCall` -> `onAfterProvider` -> `onBeforeTransaction`, diikuti pemanggilan transaksi mutasi pada alur kode.
     - Mutasi data dieksekusi setelah provider selesai memeriksa jaringan namun sebelum transaksi final dimulai (`onAfterProvider`):
       - Part A: Identitas di-unlink menjadi unverified -> bukti ONU dibatalkan dan jatuh kembali ke GENERIC (`identity_unresolved`).
       - Part B: Incident A (AREA_SPECIFIC, version 1 -> RESOLVED version 2) di-resolve dan incident B (GENERAL, version 5) dibuat ACTIVE -> assessment final memilih `MASS_GENERAL` (`general_active`) dan menunjuk ID/version B. Terbukti `decision.evidence` pada objek hasil dan baris `public.triage_assessments` di database memuat entri `kind: "incident"`, ID B, dan version 5 (berbeda dari version 1 dan 2 milik A).
       - Part C: Incident awal dihapus dari database -> sistem menolak snapshot usang, tidak menghidupkan kembali data yang hilang, dan jatuh kembali ke bukti independen (`ONLINE_CHECK`, `online`, `incidentId: null`) tanpa bukti incident.
  10. `✔ AC 8: Default scenario without override uses 'normal', and providerQuality is readable from database`:
     - Default scenario menghasilkan `normal` -> ONLINE_CHECK (`online`).
     - Snapshot terstruktur `providerQuality` terbaca lengkap dari kolom `processing_result` pada `public.triage_assessments`.

### B. Pengujian Guard & Lifecycle (Stub/Spy)
- **Perintah**: `node --test .test-build/tests/utils/test-guard.test.js`
- **Exit Code**: `0`
- **Hasil**: **9 passed**, 0 failed, 0 skipped.
- **Cakupan**: Penolakan konfigurasi invalid/kosong sebelum koneksi dibuat; penolakan target pengguna dan port loopback 5432/54322/54321; penolakan pasangan target tidak cocok; penerimaan target terverifikasi; preservasi snapshot `process.env`; tracking dan cleanup kegagalan sebagian; penanganan multi-parameter dinamis; ketahanan cleanup independen saat discovery gagal; pelaporan `combineErrors` via `AggregateError`.

### C. Pengujian Regresi Lengkap
1. **Unit Test Domain**:
   - `npm run test:unit` → **146 passed**, 0 failed, 0 skipped (Exit Code `0`).
2. **P1.4 Persistence Integration (Hardened & Scoped)**:
   - `node --env-file=.env.test --test .test-build/tests/integration/persistence.test.js` → **12 passed**, 0 failed, 0 skipped (Exit Code `0`).
   - Menerapkan guard pra-koneksi ganda (PG + API), pencatatan seluruh UUID incident run (`runIncidentIds`), eliminasi delete global/status-only, penolakan active incident eksternal, serta pembuktian preservasi incident baseline non-ACTIVE across cleanup.
3. **P2.2 Webhook Integration**:
   - `node --env-file=.env.test --test .test-build/tests/integration/telegram-webhook.test.js` → **11 passed**, 0 failed, 0 skipped (Exit Code `0`).
4. **P2.3 Conversation Integration**:
   - `node --env-file=.env.test --test .test-build/tests/integration/conversation.test.js` → **18 passed**, 0 failed, 0 skipped (Exit Code `0`).
5. **Pemeriksaan Tipe (Typecheck)**:
   - `npx tsc --noEmit` → Exit Code `0` (0 error).
6. **Linter**:
   - `npx eslint tests/utils/ tests/integration/orchestration.test.ts tests/integration/persistence.test.ts lib/application/orchestrate-processing.ts lib/application/helpdesk-persistence.ts` → Exit Code `0` (0 error, 0 warning).

---

## 6. Pemetaan Bukti terhadap Acceptance Criteria P2.4

| No | Acceptance Criteria | File / Implementasi | Bukti Empiris |
|---|---|---|---|
| 1 | Penerimaan Telegram simulasi menyimpan ingress/job sebelum processing internal; processing menyimpan message, conversation, episode/review, assessment, audit, dan job done | `handleTelegramWebhook()`, `orchestrateProcessing()`, `HelpdeskPersistence.process()` | Subtest AC 1 passed: `handleTelegramWebhook()` mengembalikan HTTP 200 `{ status: "accepted", duplicate: false }` dan job `status = 'pending'`, 0 messages, 0 assessments pada jalur ACK. Pemanggilan eksplisit `orchestrateProcessing()` selanjutnya menghasilkan `messages` (1), `conversations` (1), `complaints` (1), `triage_assessments` (1), `complaint_audit_log` (`created`, `inbound_processed`), dan job `status = 'done'`. |
| 2 | Normal, LOS individu/area, upstream down, AREA match/no-match, stale/unknown, timeout/error, serta kegagalan parsial sumber menghasilkan keputusan dan alasan sesuai PRD | `lib/domain/triage-decision.ts`, `orchestrateProcessing()` | Subtest AC 2 passed: 10 skenario teruji menghasilkan template & alasan presisi: `normal` -> ONLINE_CHECK (`online`), `los_individual` -> LOS_INDIVIDUAL (`los_individual`), `los_area` -> LOS_AREA (`los_area`), `upstream_down` -> NETWORK_DISRUPTION (`upstream_down`), `stale`/`unknown`/`timeout`/`provider_error` -> GENERIC (`onu_unusable`), partial failure (`upstream_error_los`, `onu_error_upstream_down`), manual AREA match -> MASS_AREA (`manual_area_match`), manual AREA no-match -> ONLINE_CHECK (`online`). |
| 3 | GENERAL pada sender verified dan non-komplain melewati provider (0 calls); unverified dan non-komplain mengikuti generic/review; media tanpa caption tersimpan | `orchestrateProcessing()`, `HelpdeskPersistence.process()` | Subtest AC 3 passed: GENERAL terbukti 0 provider calls -> MASS_GENERAL (`general_active`); non-komplain terbukti 0 provider calls -> review tanpa episode (`episodeId = null`); unverified sender terbukti 0 provider calls -> GENERIC (`identity_unresolved`); media foto tanpa caption tersimpan bersih di `ingress_events` (`body = ""`, `hasMedia = true`, `caption = null`) dan `messages` (`classification = review`). |
| 4 | SHADOW menghasilkan 0 auto claims/intents dan `dispatchAuthorized = false`; perubahan mode ke FULL tidak mengaktifkan backlog SHADOW | `lib/domain/triage-claim.ts`, `orchestrateProcessing()`, `public.automation_settings` | Subtest AC 4 passed: `claim.outcome = "skipped"`, `claim.reason = "shadow_mode"`, `dispatchAuthorized = false`, 0 baris `outbound_intents`. Setelah mode di-update ke FULL, pemrosesan ulang pada ingressId yang sama mengembalikan hasil identik tanpa reservasi klaim atau outbound baru. |
| 5 | Duplikat sekuensial/paralel tidak menggandakan message, assessment, audit, atau episode; follow-up tidak membuat episode baru | `orchestrateProcessing()`, `HelpdeskPersistence.process()` | Subtest AC 5 passed: Eksekusi paralel (`Promise.all`) dan sekuensial menghasilkan return object identik (`deepEqual`) dan tepat 1 baris message serta 1 baris assessment. Follow-up pesan kedua pada masalah yang sama menghasilkan `episodeId` yang sama persis tanpa membuat baris complaint baru. |
| 6 | Fault injection setelah sebagian mutasi membuktikan rollback bersih di luar transaksi; retry berhasil idempoten | `inHelpdeskTransaction`, `orchestrateProcessing()` | Subtest AC 6 passed: Suntikan error via proxy pool pada saat `INSERT INTO public.triage_assessments` (setelah messages, complaints, audit termutasi) membatalkan transaksi. Pemeriksaan independen di luar transaksi membuktikan 0 baris message, complaints, dan assessments; job tetap `pending`. Retry tanpa error berhasil idempoten dan menandai job `done`. |
| 7 | Provider berjalan di luar transaksi; revalidasi perubahan identitas dan incident selama jeda provider | `orchestrateProcessing()`, `HelpdeskPersistence.process()` | Subtest AC 7 passed: Provider terbukti berjalan di luar transaksi melalui urutan hook (`onBeforeProvider` -> `onProviderCall` -> `onAfterProvider` -> `onBeforeTransaction`), diikuti transaksi mutasi pada alur kode. Mutasi pada `onAfterProvider`: (1) Unlinked identity jatuh kembali ke GENERIC (`identity_unresolved`); (2) Penggantian incident A -> B menghasilkan `MASS_GENERAL` menunjuk ID/version B, dengan assertion eksplisit bahwa `decision.evidence` memuat entri `kind: "incident"`, ID B, dan version 5 pembeda; (3) Penghapusan incident awal jatuh kembali ke bukti independen (`ONLINE_CHECK`, `online`, `incidentId: null`) tanpa bukti incident. |
| 8 | Default scenario tanpa override bekerja sesuai fixture (`normal`), dan kualitas/alasan provider tersedia di database | `orchestrateProcessing()`, `public.triage_assessments.processing_result` | Subtest AC 8 passed: Pemanggilan tanpa opsi skenario menghasilkan keputusan `normal` -> ONLINE_CHECK (`online`). Pembacaan kembali `triage_assessments` membuktikan snapshot `providerQuality` tersimpan lengkap (`source: "MOCK"`, `scenarioId: "normal"`, `outcome: "ok"`, `onu.status: "online"`, `onu.quality: "fresh"`). |

---

## 7. File Dibuat / Diubah & Asumsi/Default Baru

1. **File Dibuat**:
   - `lib/application/orchestrate-processing.ts`: Layanan orkestrasi pemrosesan inbound internal dari ingressId tersimpan hingga pembentukan assessment dan asociasi episode.
   - `tests/test-env/supabase/config.toml`: Konfigurasi proyek Supabase lokal terisolasi (`Chat_Automation_Helpdesk_Test`, DB 54332, API 54331).
   - `tests/utils/test-guard.ts`: Guard validasi pra-koneksi, verifikasi marker target ganda (PG + API), tracking resource terarah (`TestResourceTracker`), pemulihan environment aman (`EnvRestorer`), dan cleanup fixture berbasis relasi.
   - `tests/utils/test-guard.test.ts`: Pengujian unit stub/spy untuk guard isolasi dan mekanisme cleanup.
   - `tests/integration/orchestration.test.ts`: Suite pengujian integrasi orkestrasi P2.4 dan verifikasi database nyata terisolasi (11 subtest).
   - `.env.test`: Konfigurasi eksplisit lingkungan tes terisolasi.
2. **File Diubah**:
   - `lib/application/helpdesk-persistence.ts`:
     - Pengambilan seluruh incident aktif dari database (`SELECT id, type, status, odp_ids, odc_ids, version FROM public.incidents WHERE status = 'ACTIVE' FOR SHARE`) di dalam transaksi final sebagai satu-satunya sumber otoritatif.
     - Penghapusan pembatasan daftar incident pada snapshot ID awal sebelum provider berjalan.
     - Penghapusan total fallback runtime sintetis (`effectiveIncidents.push(inc)`); snapshot context tidak pernah dihidupkan kembali jika baris database tidak ada.
     - Revalidasi identitas pelanggan di dalam transaksi mutasi.
     - Penyimpanan snapshot `providerQuality` terstruktur ke dalam `processing_result` pada `public.triage_assessments`.
   - `tests/integration/persistence.test.ts`:
     - Penerapan guard pra-koneksi `requireIsolatedDatabase()` (PG + API) sebelum mutasi.
     - Pencatatan seluruh UUID incident run (`runIncidentIds`) untuk mitigasi kegagalan parsial.
     - Penghapusan delete global/status-only tanpa pembatas fixture.
     - Penolakan active incident eksternal yang menghalangi run.
     - Pembuktian cleanup menghapus fixture uji dan mempertahankan incident baseline non-ACTIVE pembanding (`baselineIncidentId`).
   - `tests/integration/orchestration.test.ts`:
     - Penyesuaian AC 1 melalui handler webhook Telegram `handleTelegramWebhook()`, memverifikasi jalur ACK vs pemrosesan eksplisit.
     - Penyesuaian AC 6 dengan fault injection terarah di tengah transaksi mutasi (`INSERT INTO public.triage_assessments`) menggunakan proxy pool.
     - Penyesuaian AC 7 dengan pembuktian urutan hook deterministik (`onBeforeProvider` -> `onProviderCall` -> `onAfterProvider` -> `onBeforeTransaction`), penggantian incident A (AREA, v1->v2) -> B (GENERAL, v5), assertion eksplisit `decision.evidence` (kind, ID, version 5), dan penolakan snapshot incident yang dihapus.
   - `lib/application/persistence-contracts.ts`: Penambahan tipe snapshot terstruktur `providerQuality` pada `ProcessingContext` dan `ProcessingResult`.
   - `package.json`: Skrip pengujian terarah dan dependensi yang relevan.
   - `docs/decision-log.md`: Penambahan entri keputusan D90, D91, dan D92 secara append-only.
   - `docs/TRACKER.md`: Pembaruan status P2.4 menjadi Done dengan bukti verifikasi lengkap (D87–D92).
3. **Asumsi & Default Baru**:
   - Default skenario provider tanpa override diselaraskan ke `"normal"` (sesuai fixture dasar yang tersedia).
   - Freshness window observasi mock adalah 5 menit (`DEFAULT_FRESHNESS_MS = 300_000` ms).
   - Manual incidents dalam transaksi final sepenuhnya otoritatif dari database (`WHERE status = 'ACTIVE' FOR SHARE`).
   - Sesuai PRD, `public.incidents` menegakkan batasan maksimal satu ACTIVE incident (`incidents_one_active`); setiap pembuatan incident aktif baru di tes harus menyelesaikan/menghapus incident aktif milik run sebelumnya.

---

## 8. Rekomendasi & Batasan Scope

1. **Status P2.4 Dinyatakan Selesai (Done)**: Seluruh 8 Acceptance Criteria P2.4, penutupan verifikasi database nyata tahap pertama, pengamanan menyeluruh regresi persistence, pengujian webhook Telegram, rollback parsial mid-transaksi, dan assertion versioned incident evidence telah dibuktikan secara empiris dengan exit code 0.
2. **Batasan Scope yang Dijaga**:
   - Tidak ada worker lease/attempt, background queue drain, scheduler pemicu, atau cron (pekerjaan P2.5).
   - Tidak ada UI inbox dashboard (pekerjaan P2.6).
   - Tidak ada pengiriman outbound Telegram atau bypass mode SHADOW.
   - Database pengguna (`Chat_Automation_Helpdesk` pada 54321/54322) tidak dimutasi atau disentuh.
