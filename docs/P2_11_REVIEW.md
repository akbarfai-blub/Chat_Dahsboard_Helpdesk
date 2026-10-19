# P2.11 — Laporan Verifikasi Vertical Slice SHADOW End-to-End

Dokumen ini mencatat bukti verifikasi empiris untuk **P2.11 — Verifikasi vertical slice SHADOW end-to-end** serta sinkronisasi penutupan **P2.10** berdasarkan konfirmasi pengguna terhadap deployment Vercel prototype.

Acuan:
- [AGENTS.md](../AGENTS.md)
- [docs/PRD.md](PRD.md)
- [docs/decision-log.md](decision-log.md) (entri D153, D154, D155, D156, D157, D158)
- [docs/TRACKER.md](TRACKER.md)
- [docs/P2_10_FOLLOWUP.md](P2_10_FOLLOWUP.md)

---

## 1. Konteks dan Penutupan P2.10

### 1.1 Status P2.10: ✅ Done (Berdasarkan Konfirmasi Deployment Pengguna)
- **Konfirmasi Pengguna**: Pengguna telah mengonfirmasi bahwa deployment terbaru Vercel P2.10 berfungsi normal:
  - Status deployment Vercel: **Ready**.
  - Pengalihan sesi pada halaman awal (`/`) berfungsi sesuai status autentikasi staf (pengguna terautentikasi dialihkan ke dashboard, unauthenticated dialihkan ke login).
  - Halaman antrean Inbox (`/dashboard`) dan detail percakapan terbuka normal tanpa galat 500 `INTERNAL_ERROR`.
- **Atribusi Bukti**: Penutupan P2.10 dicatat secara transparan bersumber dari konfirmasi pengguna tersebut tanpa mengarang commit SHA atau deployment ID. Rujukan detail kode status HTTP 307 dan HTTP 200 bersumber secara spesifik dari eksekusi automated smoke test sebelumnya (`scripts/smoke-test-deployment.mjs`, D153/D154).

---

## 2. Lingkungan, Versi Kode, dan Partisi Bukti (P2.11)

| Parameter | Nilai / Spesifikasi |
|---|---|
| **Target Lingkungan Lokal** | Database lokal PostgreSQL terisolasi (`127.0.0.1:54332`), Supabase API lokal (`http://127.0.0.1:54331`) |
| **Marker Isolasi** | `test_env_isolated_marker` (`TEST_ENVIRONMENT_ISOLATION_TOKEN_7F89B2`) pada `public.mock_network_scenarios` |
| **Runtime & Node.js** | Node.js v24.13.1, TypeScript target ES2022 (`CommonJS` via `tsconfig.test.json`) |
| **Versi Kode Sumber** | Main repository commit baseline `59cb15d` dengan penambahan suite `tests/integration/vertical-slice-shadow.test.ts` |
| **Mode Operasional** | `mode = 'SHADOW'`, `emergency_stop = false` pada `public.automation_settings` |
| **Partisi Bukti** | **1. Bukti Integrasi Lokal**: Suite integrasi terarah `tests/integration/vertical-slice-shadow.test.ts` (`npm run test:shadow:local`) memverifikasi pipeline application service (`handleTelegramWebhook`, `drainProcessingJobs`, `inbox-service`) dan persistence database secara terpadu (6/6 checks PASS, 0 residu pada 15 tabel & `auth.users`).<br>**2. Bukti Remote Deployment**: Smoke test deployment Vercel (`scripts/smoke-test-deployment.mjs`) membuktikan penerimaan webhook simulasi (`0877a630-93c3-4756-804f-674b21d08e78`) hingga job done di lingkungan live Vercel (7/7 checks PASS, D154/D155).<br>**3. Konfirmasi Live Telegram Pengguna**: Pengujian interaksi langsung Telegram tester `@upaznet_helpdesk_proto_bot` → webhook live Vercel → antrean Inbox dashboard (`https://chat-dahsboard-helpdesk.vercel.app/dashboard`) → detail percakapan terbuka normal dengan episode `NEW` dan Triage Assessment `SHADOW` (`dispatchAuthorized = false`) tanpa balasan otomatis ke Telegram tester.<br>**4. Atribusi Bukti Jujur**: Ketiga ranah pembuktian di atas dicatat secara terpisah dan faktual tanpa mengarang message ID, commit SHA, atau timestamp spesifik yang tidak diberikan pengguna. |

---

## 3. Matriks Acceptance Criteria → Sumber Bukti → Hasil (P2.11)

| AC | Deskripsi Kriteria | Metode & Bukti Empiris | Hasil |
|---|---|---|---|
| **AC1** | Komplain dummy dari tester Telegram muncul di Inbox dengan episode dan assessment yang sesuai. | **Metode**: Pengujian integrasi lokal application service & database PostgreSQL (`tests/integration/vertical-slice-shadow.test.ts`) dan konfirmasi interaksi live pengguna via Telegram tester ke Vercel Inbox.<br>**Bukti**: Update Telegram (`"wifi mati total lampu indikator LOS merah..."`) dari tester verified allowlist diproses oleh `handleTelegramWebhook` (HTTP 200 accepted) dan dieksekusi oleh worker drain hingga job `done`. Staf memanggil `listInboxConversations` dan `getInboxConversationDetail`:<br>• Percakapan aktif tampil di antrean staf.<br>• `sender.verificationStatus = 'verified'`, `customerId` dan `customerName` terisi.<br>• `latestEpisode` berstatus `'NEW'`, kategori `'connection_complaint'`, `serviceId` terikat.<br>• Pesan memiliki `triageAssessment`: `decision.mode = 'SHADOW'`, `decision.emergencyStop = false'`, `decision.outcome = 'candidate'`, template `'ONLINE_CHECK'`, `processingResult.claim.outcome = 'skipped'`, `processingResult.claim.reason = 'shadow_mode'`, `dispatchAuthorized = false`.<br>• Dikonfirmasi secara nyata oleh pengguna pada live Vercel dashboard: pesan komplain tester Telegram tampil di antrean Inbox dan detail percakapan terbuka menampilkan episode `NEW` dan Triage Assessment `SHADOW`. | ✅ **PASS (Lokal & Live Telegram)** |
| **AC2** | Replay event inbound yang sama tidak menggandakan ingress, pesan, episode, maupun assessment terkait (identitas dedup: `account_id` + `chat_id` + `message_id`). | **Metode**: Pengujian integrasi lokal idempotensi replay.<br>**Bukti**: Snapshot hitungan baris DB sebelum replay dicatat. Payload update Telegram yang persis sama dikirim ulang ke `handleTelegramWebhook`. Respons mengembalikan HTTP 200 `{ status: "accepted", duplicate: true }` dengan ingress ID yang sama. `drainProcessingJobs` menghasilkan `processedCount: 0`. Kueri verifikasi membuktikan delta 0 baris (+0 penambahan pada `ingress_events`, `processing_jobs`, `messages`, `complaints`, maupun `triage_assessments`). Detail percakapan staf tetap tepat memiliki 1 pesan. | ✅ **PASS (Lokal)** |
| **AC3** | Pengirim yang belum terpetakan ke pelanggan tetap terlihat di Inbox tanpa memperoleh detail layanan. | **Metode**: Pengujian integrasi lokal unverified sender allowlist.<br>**Bukti**: Pengirim terdaftar dalam tester allowlist dengan `verification_status = 'unverified'` dan `customer_id = null` mengirim komplain koneksi. Diproses tuntas hingga tampil di `listInboxConversations` dan `getInboxConversationDetail`:<br>• `sender.verificationStatus = 'unverified'`.<br>• `sender.customerId = null`, `sender.customerName = null`.<br>• `latestEpisode.serviceId = null`, `latestEpisode.serviceCode = null`.<br>• `triageAssessment.decision.reason = 'identity_unresolved'`, `candidateTemplateKey = 'GENERIC'`.<br>Nol detail layanan/topologi yang bocor ke pengirim/respons. | ✅ **PASS (Lokal)** |
| **AC4** | Pesan non-komplain tetap terlihat dan ditangani sesuai aturan PRD. | **Metode**: Pengujian integrasi lokal pesan salam/ucapan non-komplain.<br>**Bukti**: Tester terverifikasi mengirim salam/ucapan tanpa kata kunci gangguan koneksi. Percakapan memuat 2 pesan (`detail.messages.length = 2`):<br>• Pesan kedua terklasifikasi `category = 'other'`, `complaintId = null` (tidak membuat episode komplain baru atau tiket palsu).<br>• Asersi wajib pada triage assessment memvalidasi `outcome = 'review'`, `reason = 'non_connection_message'`, dan `dispatchAuthorized = false`. Pesan tetap terlihat di Inbox staf tanpa memicu false alarm. | ✅ **PASS (Lokal)** |
| **AC5** | Tidak ada outbound otomatis atau claim debounce yang terbentuk akibat skenario SHADOW. | **Metode**: Kueri SQL langsung terhadap state persistence untuk seluruh pesan fixture lokal dan konfirmasi live Telegram oleh pengguna.<br>**Bukti**:<br>1. `public.outbound_intents`: `count(*) WHERE origin = 'automatic'` untuk ketiga pesan fixture (`verifiedIngressId`, `unverifiedIngressId`, `nonComplaintIngressId`), komplain, dan seluruh owners = **0**.<br>2. `public.reply_claims`: `count(*)` untuk seluruh komplain dan owners fixture = **0**.<br>3. `public.triage_assessments`: tepat 3 baris assessment ditemukan sesuai ketiga pesan fixture, masing-masing memiliki `dispatchAuthorized = false`, claim `skipped`, dengan reason `'shadow_mode'` (komplain) dan `'review'` (non-komplain).<br>4. Konfirmasi live pengguna: 0 balasan otomatis dikirimkan kembali ke akun Telegram tester pada lingkungan live. | ✅ **PASS (Lokal & Live Telegram)** |

---

## 4. Eksekusi Pengujian Terarah dan Exit Code

### 4.1 Suite Integrasi End-to-End Vertical Slice SHADOW (`test:shadow:local`)
- **Perintah**: `npm run test:shadow:local`
  (`tsc -p tsconfig.test.json && node --conditions=react-server --env-file=.env.test --test .test-build/tests/integration/vertical-slice-shadow.test.js`)
- **Hasil**:
  ```text
  ▶ P2.11 Vertical Slice SHADOW End-to-End Integration Suite
    ✔ AC1: Komplain dummy dari tester Telegram muncul di Inbox dengan episode dan assessment yang sesuai (97.1561ms)
    ✔ AC2: Replay event inbound yang sama tidak menggandakan ingress, pesan, episode, maupun assessment terkait (22.0279ms)
    ✔ AC3: Pengirim yang belum terpetakan ke pelanggan tetap terlihat di Inbox tanpa memperoleh detail layanan (49.7801ms)
    ✔ AC4: Pesan non-komplain tetap terlihat dan ditangani sesuai aturan PRD (50.7121ms)
    ✔ AC5: Tidak ada outbound otomatis atau claim debounce yang terbentuk akibat skenario SHADOW (3.9426ms)
  ✔ P2.11 Vertical Slice SHADOW End-to-End Integration Suite (564.3079ms)
  ℹ tests 6
  ℹ suites 0
  ℹ pass 6
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 690.3938
  ```
- **PROCESS_EXIT_CODE**: `0` (PASS).

### 4.2 Verifikasi Kebersihan Fixture Database Pasca-Uji
1. **Pembersihan Akun Auth**:
   - Akun staf fixture dibuat menggunakan `supabase.auth.admin.createUser()` dan ID aktual `staffData.user.id` disimpan ke `actualStaffUserId`.
   - Pada teardown, `supabase.auth.admin.deleteUser(actualStaffUserId)` dieksekusi dengan pemeriksaan error eksplisit.
   - Verifikasi konfirmasi pasca-penghapusan via `supabase.auth.admin.getUserById(actualStaffUserId)` membuktikan akun staf telah terhapus sempurna.
   - Residu 4 akun pengujian dari run sebelumnya (`staff-p211-*@example.test`) telah dibersihkan secara aman tanpa menyentuh akun lain.
2. **Kueri SQL Residual Terpadu (15 Tabel)**:
   - Evaluasi kueri residual SQL terhadap fixture ID yang disentuh membuktikan 0 baris tersisa:
     - `odcs`: 0
     - `odps`: 0
     - `customers`: 0
     - `services`: 0
     - `service_topology`: 0
     - `mock_onu_status`: 0
     - `channel_identities`: 0
     - `ingress_events`: 0
     - `messages`: 0
     - `processing_jobs`: 0
     - `complaints`: 0
     - `triage_assessments`: 0
     - `reply_owners`: 0
     - `outbound_intents`: 0
     - `reply_claims`: 0

### 4.3 Linter
- **Perintah**: `npx eslint tests/integration/vertical-slice-shadow.test.ts`
- **Hasil**: 0 warning, 0 error, exit code: `0`.

---

## 5. Ringkasan Status

- **P2.10**: ✅ **Done** (ditutup berdasarkan konfirmasi fungsional pengguna terhadap deployment Vercel Ready, redirect sesi, dan Inbox tanpa error 500, D156/D157).
- **P2.11**: ✅ **Done**
  - Seluruh 5 Acceptance Criteria (AC1–AC5) terbukti memenuhi kontrak secara penuh dan definitif.
  - Kombinasi pembuktian empiris mencakup:
    1. Integrasi lokal terisolasi (`npm run test:shadow:local` 6/6 PASS, durasi ~690ms, 0 residu pada 15 tabel dan `auth.users`).
    2. Smoke test deployment otomatis (`scripts/smoke-test-deployment.mjs` 7/7 PASS, D154/D155).
    3. Konfirmasi interaksi live Telegram nyata oleh pengguna (pesan komplain masuk antrean Inbox Vercel, detail terbuka normal dengan episode `NEW` dan assessment `SHADOW` `dispatchAuthorized = false`, 0 balasan otomatis ke Telegram tester).
- **Phase 2 (Vertical Slice SHADOW)**: ✅ **Done** (**Phase 2 Completed**). Seluruh 11 tugas Phase 2 (`P2.1`–`P2.11`) telah berstatus **Done**.
- **Langkah Berikutnya**: Pipeline beralih ke **Phase 3 (Balas & Penanganan)**, diawali dengan **P3.1 — Renderer template tetap dan snapshot teks**.

---

## 6. Catatan Konfirmasi Live Telegram oleh Pengguna (Penutupan Bukti P2.11)

Berdasarkan pengujian langsung oleh pengguna pada bot Telegram `@upaznet_helpdesk_proto_bot` dan deployment live Vercel (`https://chat-dahsboard-helpdesk.vercel.app/dashboard`), seluruh kekurangan bukti sebelumnya telah terpenuhi secara faktual:
1. **Penerimaan Inbound Live**: Pesan komplain yang dikirimkan dari akun Telegram tester terdaftar diterima oleh webhook live dan tampil di antrean antarmuka Inbox dashboard.
2. **Detail Percakapan & Triage Assessment**: Panel detail percakapan terbuka secara normal tanpa kendala HTTP 500, menampilkan episode dengan status `NEW`, serta Triage Assessment dalam mode `SHADOW` (`dispatchAuthorized = false`).
3. **Nol Outbound ke Tester**: Dipastikan tidak ada balasan otomatis yang dikirimkan kembali ke akun Telegram tester, menjaga prinsip isolasi mode `SHADOW`.

Konfirmasi empiris ini melengkapi bukti integrasi lokal dan smoke test remote, secara resmi menutup tugas **P2.11** menjadi ✅ **Done**, serta meresmikan penyelesaian penuh seluruh rangkaian **Phase 2**.
