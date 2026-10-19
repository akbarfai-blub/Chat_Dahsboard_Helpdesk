# P3.2 Review — Pemeriksaan Terakhir Sebelum Dispatch

Dokumen ini menyajikan peninjauan implementasi terarah, arsitektur domain, integrasi persistence transaksional, dan bukti verifikasi empiris komprehensif untuk **P3.2 — Pemeriksaan terakhir sebelum dispatch** sesuai [AGENTS.md](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/AGENTS.md), [PRD.md §4, §5 (FR-02, FR-04), §6.1, §6.2, §7 (FR-07, FR-08), §8, §10 (FR-13), §11 (FR-16, FR-17), §13 (AC-06)](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/docs/PRD.md), [TRACKER.md](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/docs/TRACKER.md), dan [decision-log.md](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/docs/decision-log.md) (D66, D67, D68, D77, D160).

---

## 1. Ringkasan Status

- **Status Milestone**: ✅ **Done** (Seluruh acceptance criteria pada PRD §8, §11 FR-16/FR-17, §13 AC-06, dan TRACKER.md #task-p3-2 telah terimplementasi tuntas dan terverifikasi secara empiris dengan 0 fail dan 0 skipped pada PostgreSQL lokal terisolasi).
- **Keputusan Terkait**: D66, D67, D68, D77, **D160**.
- **Batas Scope P3.2 Ketat**:
  - Mengimplementasikan kontrak dan fungsi domain murni pre-dispatch gate (`lib/domain/dispatch-contracts.ts` & `lib/domain/dispatch-gate.ts`) tanpa I/O, tanpa database, dan tanpa clock implisit.
  - Mengintegrasikan evaluasi pra-dispatch transaksional atomik via `HelpdeskPersistence.evaluateDispatchGate()` di `lib/application/helpdesk-persistence.ts`.
  - `decideTriage` (`lib/domain/triage-decision.ts`), `planReplyClaim` (`lib/domain/reply-claim.ts`), dan `HelpdeskPersistence.process()` (`lib/application/helpdesk-persistence.ts`) **strictly dipertahankan mengembalikan `dispatchAuthorized: false`**.
  - Dispatch HTTP ke Telegram ([P3.3](TRACKER.md#task-p3-3)) dan worker delivery loop / tabel `outbound_attempts` / transisi status ke `'in_flight'` / `'sent'` ([P3.4](TRACKER.md#task-p3-4)) berada di luar scope dan tidak diimplementasikan pada task ini.
  - Tidak ada migrasi skema SQL baru yang dibuat karena seluruh tabel dan kolom yang dibutuhkan telah tersedia pada skema basis data prototype.

---

## 2. Arsitektur Domain Murni Pre-Dispatch Gate

### A. Kontrak & Tipe (`lib/domain/dispatch-contracts.ts`)
- **Konstanta Resmi**:
  - `PRE_DISPATCH_RULE_VERSION = "pre-dispatch-gate-v1"`
  - `MAX_TELEGRAM_OUTBOUND_TEXT_LENGTH = 4096` (sesuai limit protokol Telegram Bot API).
- **Daftar Alasan Pemblokiran (`PreDispatchBlockedReason`)**:
  - Status & integritas intent: `"intent_not_pending"`, `"invalid_intent"`.
  - Handoff tersimpan: `"handoff_not_persisted"`.
  - Channel / tester / private chat: `"unsupported_channel"`, `"empty_tester_allowlist"`, `"non_private_chat"`, `"not_in_tester_allowlist"`.
  - Lifecycle / follow-up / takeover: `"episode_closed"`, `"staff_takeover"`, `"follow_up"`.
  - Claim & owner: `"missing_reply_claim"`, `"claim_owner_merged_or_invalid"`, `"claim_conflict"`.
  - Template & body: `"template_error"`, `"missing_template_snapshot"`, `"missing_simulation_prefix"`, `"invalid_outbound_body"`, `"template_blocked_by_mode"`.
  - Mode & emergency stop: `"invalid_mode"`, `"shadow_mode_at_receipt"`, `"shadow_mode_current"`, `"emergency_stop_at_receipt"`, `"emergency_stop_active"`.
  - Incident relevan: `"incident_not_found"`, `"incident_no_longer_active"`, `"incident_type_mismatch"`, `"incident_area_no_longer_matches"`.
- **Hasil Evaluasi (`PreDispatchEvaluationResult`)**:
  - Discriminated union dengan properti pembeda `outcome: "authorized"` vs `outcome: "blocked"`.
  - Jika **authorized**: `dispatchAuthorized: true`, menyertakan `outboundText`, target `(channel: "telegram", channelAccountId, chatId, senderExternalId)`, `effectiveMode`, serta `authorizedIncidentId` dan `authorizedIncidentVersion` (bila relevan). `shouldCancelIntent: false`.
  - Jika **blocked**: `dispatchAuthorized: false`, menyertakan `primaryReason` (alasan utama pertama), `blockedReasons` (seluruh alasan terdeteksi), dan `shouldCancelIntent: boolean` (`false` untuk intent non-pending seperti in_flight/sent/cancelled, `true` untuk intent pending yang gagal guard).

### B. Evaluasi 9 Guard Deterministik (`lib/domain/dispatch-gate.ts`)
Fungsi `evaluatePreDispatchGate(input: PreDispatchEvaluationInput)` menguji seluruh 9 gerbang secara deterministik dan terurut:
1. **Status & Struktur Dasar Intent**:
   - Jika `intent.status !== "pending"` $\to$ langsung return `blocked` dengan `primaryReason: "intent_not_pending"` dan `shouldCancelIntent: false` (mencegah pembatalan terhadap intent yang sudah terkirim, in-flight, atau unknown).
   - Validasi struktur wajib berdasarkan `origin`: intent `'automatic'` wajib memiliki `ownerId`, `messageId`, `complaintId`, `decision`, dan tanpa atribut staf; intent `'staff'` wajib memiliki `staffId`, `clientRequestId`, `complaintId`, dan tanpa atribut otomatis. Pelanggaran memicu `invalid_intent`.
2. **Handoff Tersimpan (`handoff_not_persisted`)**:
   - Episode wajib terikat dan cocok dengan `intent.complaintId`.
   - `conversationId` wajib string non-kosong.
   - Khusus `automatic`: `messagePersisted === true`, `assessmentPersisted === true`, dan `ingress !== null` wajib terpenuhi.
3. **Tester Allowlist & Private Chat (Berlaku untuk Automatic dan Staff)**:
   - Channel wajib `"telegram"` dan `channelAccountId` non-kosong (`unsupported_channel`).
   - Allowlist tester disaring ketat ke ID safe integer positif (`^[1-9]\d*$`); jika kosong $\to$ `empty_tester_allowlist`.
   - Penegakan private chat 1-on-1: `chatId` dan `senderExternalId` wajib format safe integer positif dan **`chatId === senderExternalId`**; grup/supergroup dengan ID negatif atau obrolan non-private ditolak tegas sebagai `non_private_chat`.
   - Pengirim dan chat wajib terdaftar pada himpunan allowlist (`not_in_tester_allowlist`).
4. **Follow-up & Staff Takeover**:
   - Status episode `'CLOSED'` memblokir baik balasan otomatis maupun balasan manual staf (`episode_closed`).
   - Khusus `automatic`:
     - Jika `episode.automationSuppressed === true` atau `hasStaffReplyOnEpisode === true` $\to$ `staff_takeover`.
     - Jika `episode.status !== "NEW"` atau bukan pesan pertama pada episode (`!isFirstMessageOnEpisode`) atau terdapat intent otomatis lain yang aktif/terkirim $\to$ `follow_up`.
   - Khusus `staff`: Episode berstatus `'IN_PROGRESS'` atau `'RESOLVED'` dengan `automationSuppressed: true` **tetap diizinkan** (`authorized`), karena balasan staf merupakan penanganan manusia yang sah.
5. **Claim & Rekonsiliasi Owner (Khusus Automatic)**:
   - Verifikasi eksistensi dan kesesuaian `intentOwner`.
   - Rekonsiliasi `effectiveOwnerId = mergedInto ?? id`: jika owner telah di-merge atau identitas terverifikasi ke customer owner yang berbeda, memastikan klaim telah direkonsiliasi (`claim_owner_merged_or_invalid`).
   - Memeriksa setiap target wajib dari keputusan triage (`episode` dan target bukti `eventIds`/`incidentId`): konflik klaim oleh intent lain memicu `claim_conflict`; ketiadaan klaim valid atas intent ini memicu `missing_reply_claim`.
6. **Template & Snapshot Body**:
   - Body wajib ada, string non-kosong, panjang $\le 4096$, dan diawali tepat satu prefix `[SIMULASI DATA DUMMY] ` tanpa pengulangan prefix (`missing_simulation_prefix` / `invalid_outbound_body`).
   - Khusus `automatic`: `intent.templateError` wajib null, body tidak boleh memuat placeholder unreplaced `{` atau `}`, serta snapshot metadata (`templateKey`, `templateVersionId`, `templateVersion >= 1`, `templateScope`) wajib valid dan selaras dengan keputusan triage (`template_error` / `missing_template_snapshot`).
7. **Mode Penerimaan, Mode Terbaru & No SHADOW Backlog Replay (AC-06)**:
   - Validasi mode setting aktual (`SHADOW`, `LOS_AND_GENERIC`, `FULL`).
   - Khusus `automatic`:
     - Jika diterima saat `SHADOW` $\to$ diblokir `shadow_mode_at_receipt` (pantang memutar ulang backlog SHADOW walau mode sekarang `FULL`).
     - Jika mode aktual saat ini turun ke `SHADOW` $\to$ diblokir `shadow_mode_current`.
     - Evaluasi mode efektif `restrictiveMode(received, current)`: jika mode efektif `LOS_AND_GENERIC` dan template adalah `ONLINE_CHECK` $\to$ diblokir `template_blocked_by_mode`.
   - Khusus `staff`: Balasan manual staf **tidak diblokir** oleh mode `SHADOW` maupun `LOS_AND_GENERIC`.
8. **Emergency Stop**:
   - Khusus `automatic`: Diblokir jika emergency stop aktif saat penerimaan (`emergency_stop_at_receipt`) atau saat evaluasi (`emergency_stop_active`).
   - Khusus `staff`: Balasan manual staf **tetap diizinkan** saat emergency stop aktif (PRD §8).
9. **Incident Relevan (Khusus Automatic)**:
   - Jika intent relevan dengan insiden (`MASS_GENERAL`, `MASS_AREA`, atau `templateScope === "incident"`):
     - Insiden terkait wajib ditemukan (`incident_not_found`).
     - Status insiden wajib `ACTIVE`; jika `RESOLVED` atau `CLOSED` $\to$ diblokir `incident_no_longer_active` (PRD §6.2).
     - Kesesuaian tipe insiden: `MASS_GENERAL` wajib insiden `GENERAL`, `MASS_AREA` wajib insiden `AREA_SPECIFIC` (`incident_type_mismatch`).
     - Pada `MASS_AREA`: bukti pemetaan pelanggan (`ODP`/`ODC`) wajib masih tercakup di dalam `odp_ids` atau `odc_ids` insiden (`incident_area_no_longer_matches`).
     - Jika seluruh guard lolos, menyertakan `authorizedIncidentId` dan `authorizedIncidentVersion` aktual.

---

## 3. Integrasi Persistence Transaksional

Pada `HelpdeskPersistence.evaluateDispatchGate(intentId, options)` (`lib/application/helpdesk-persistence.ts`):
1. **Row-Level Locking**: Mengambil baris `public.outbound_intents WHERE id = $1 FOR UPDATE` di dalam transaksi atomik PostgreSQL (`inHelpdeskTransaction`).
2. **Pengambilan Data Dependensi Atomik**:
   - Episode terkait dari `public.complaints`.
   - Identitas pengirim dan percakapan terbaru dari `channel_identities` dan `conversations`/`messages`.
   - Deteksi kepemilikan dan klaim dari `reply_owners` dan `reply_claims`.
   - Status pesan pertama episode (`ORDER BY created_at ASC, id ASC LIMIT 1`).
   - Deteksi intervensi staf terdahulu pada episode (`origin = 'staff'`).
   - Deteksi intent otomatis aktif/terkirim lain pada episode (`in_flight`, `sent`, `unknown`).
   - Data insiden aktual dengan lock bersama (`public.incidents FOR SHARE`).
   - Pengaturan otomasi aktual via `store.settings()`.
3. **Efek Samping Transaksional Sesuai Hasil**:
   - Jika `outcome === "blocked"` dan `shouldCancelIntent === true`:
     - Memperbarui status intent menjadi `'cancelled'` (`UPDATE public.outbound_intents SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status = 'pending'`).
     - Mencatat audit log `dispatch_blocked` di `public.complaint_audit_log` dengan detail alasan pemblokiran (`primaryReason` dan `blockedReasons`).
   - Jika `outcome === "authorized"`:
     - Mencatat audit log `dispatch_authorized` secara idempoten (hanya jika belum ada log untuk intent tersebut, menjaga evaluasi berulang tetap aman tanpa polusi audit log).
     - Status intent tetap dipertahankan `'pending'` (transisi ke `'in_flight'` dan pencatatan delivery attempt didelegasikan secara tepat ke worker [P3.4](TRACKER.md#task-p3-4)).

---

## 4. Bukti Verifikasi Empiris

Seluruh pengujian dieksekusi melawan PostgreSQL lokal terisolasi (`supabase_db_Chat_Automation_Helpdesk_Test` pada loopback port `54332`), tanpa skenario `t.skip()` palsu, dan tanpa residu database (0 residual rows).

### A. Unit Test Suite Domain Murni (`tests/domain/dispatch-gate.test.ts`)
Dijalankan via `npm test`:
- **Hasil**: **332/332 tests passed (0 fail, 0 skipped, exit code 0)**.
- **Cakupan Pengujian**:
  1. Otorisasi sukses otomatis pada mode `LOS_AND_GENERIC` (individual LOS) dan `FULL` dengan insiden massal aktif.
  2. Otorisasi sukses balasan manual staf bahkan dalam mode `SHADOW` dan saat `emergencyStop = true`.
  3. Guard 1: Status non-pending (`in_flight`, `sent`, `failed`, `unknown`, `cancelled`) gagal tertutup seketika dengan `shouldCancelIntent: false`.
  4. Guard 1: Penolakan `invalid_intent` untuk field tidak lengkap atau salah peruntukan origin.
  5. Guard 2: Penolakan `handoff_not_persisted` (episode null, mismatch id, conversationId kosong, message/assessment/ingress tidak tersimpan).
  6. Guard 3: Penolakan channel & allowlist (`unsupported_channel`, `empty_tester_allowlist`, `non_private_chat` untuk grup/ID negatif, `not_in_tester_allowlist`).
  7. Guard 4: Penolakan follow-up & takeover (`episode_closed`, `staff_takeover` saat episode suppressed atau ada balasan staf, `follow_up` saat bukan pesan pertama atau episode bukan `NEW`).
  8. Guard 4: Verifikasi balasan manual staf **tetap authorized** pada status `IN_PROGRESS` dan `RESOLVED`.
  9. Guard 5: Penolakan klaim (`missing_reply_claim`, `claim_conflict`, `claim_owner_merged_or_invalid`).
  10. Guard 6: Penolakan template & body (`missing_template_snapshot`, `missing_simulation_prefix`, `invalid_outbound_body`, `template_error` untuk placeholder kurung kurawal yang belum terganti atau teks > 4096).
  11. Guard 7: Penolakan mode dan **No SHADOW Backlog Replay** (`shadow_mode_at_receipt`, `shadow_mode_current`, `template_blocked_by_mode` untuk ONLINE_CHECK pada mode LOS_AND_GENERIC).
  12. Guard 8: Penolakan emergency stop aktif untuk otomasi, dan bukti staff reply tetap diizinkan.
  13. Guard 9: Penolakan insiden (`incident_not_found`, `incident_no_longer_active` saat insiden resolved/closed, `incident_type_mismatch`, `incident_area_no_longer_matches` saat ODP pelanggan dikeluarkan dari insiden area).

### B. Integration Test Suite Database Terisolasi (`tests/integration/dispatch-gate.test.ts`)
Dijalankan via `npm run test:dispatch:local`:
- **Hasil**: **6/6 checks PASS (0 fail, 0 skipped, exit code 0, durasi ~1212ms)**.
- **Rincian Skenario Terverifikasi**:
  1. **Happy Path Automatic & Staff Authorization in LOS_AND_GENERIC**:
     - Inbound LOS menghasilkan intent `pending` dengan `dispatchAuthorized = false` pada `process()`.
     - `evaluateDispatchGate(intentId)` mengembalikan `outcome: "authorized"` dan `dispatchAuthorized: true`.
     - Tercatat audit log `dispatch_authorized` dengan detail `intentId` dan `effectiveMode`.
     - Evaluasi berulang terbukti idempoten (audit log tidak digandakan).
     - Balasan manual staf pada episode aktif berhasil diotorisasi dengan `origin: "staff"` dan mencatat audit log.
  2. **Staff Takeover Sebelum Send Membatalkan Automatic Intent**:
     - Pesan masuk membentuk intent otomatis `pending`.
     - Staf melakukan `start` handling; intent otomatis di database terbatalkan menjadi `'cancelled'`.
     - `evaluateDispatchGate` menolak dengan `primaryReason: "intent_not_pending"` dan `shouldCancelIntent: false`.
     - Pada intent pending yang dievaluasi saat episode suppressed, gate mendeteksi `staff_takeover`, mengubah status intent menjadi `'cancelled'`, dan mencatat audit log `dispatch_blocked`.
  3. **Mode Changes & Emergency Stop + Non-Replay Backlog SHADOW (AC-06)**:
     - Pesan masuk saat mode `SHADOW` menghasilkan 0 outbound intent.
     - Mode diubah ke `FULL`; pesan baru diproses normal dan menghasilkan intent.
     - Pesan SHADOW lama diverifikasi tetap memiliki 0 outbound intent (**zero replay**).
     - Intent `ONLINE_CHECK` yang diterima saat `FULL` dievaluasi saat mode diturunkan ke `LOS_AND_GENERIC` $\to$ diblokir `template_blocked_by_mode` dan intent dibatalkan (`status = 'cancelled'`).
     - Emergency stop diaktifkan $\to$ intent otomatis diblokir `emergency_stop_active` dan dibatalkan, sedangkan balasan manual staf pada episode yang sama **tetap diizinkan (`authorized`)**.
  4. **Incident Resolved atau Area Berubah Sebelum Send (PRD §6.2)**:
     - Insiden `GENERAL` aktif versi 1 diotorisasi dengan `authorizedIncidentVersion = 1` tercatat di audit log.
     - Insiden diubah menjadi `RESOLVED` sebelum send $\to$ `evaluateDispatchGate` menolak dengan `incident_no_longer_active` dan membatalkan intent menjadi `'cancelled'`.
     - Insiden `AREA_SPECIFIC` yang menghapus ODP pelanggan sebelum send $\to$ ditolak dengan `incident_area_no_longer_matches` dan dibatalkan.
  5. **Tester Allowlist & Private Chat Enforcement**:
     - Pengirim yang tidak terdaftar di allowlist saat evaluasi ditolak dengan `not_in_tester_allowlist` dan dibatalkan menjadi `'cancelled'`.
     - Evaluasi allowlist kosong ditolak dengan `empty_tester_allowlist` baik untuk balasan otomatis maupun balasan staf.
  - **Teardown & Zero Residue**: Seluruh fixture uji (`reply_claims`, `complaint_evidence_links`, `outbound_intents`, `response_templates`, `incidents`, `reply_owners`, `customers`, `services`, `channel_identities`) dibersihkan tuntas; akun staf sementara dihapus dari `auth.users`; kueri 10 tabel memvalidasi 0 baris residu.

### C. Regresi Baseline & Tooling Pipeline
- `node tests/tooling/pipeline-tooling.test.mjs`: **53/53 checks PASS** (exit code 0).
- `npm run test:template:local`: **8/8 checks PASS** (exit code 0).
- `npm run test:persistence:local`: **12/12 checks PASS** (exit code 0).
- `npm run test:shadow:local`: **6/6 checks PASS** (exit code 0).
- `npx eslint lib/domain/dispatch-*.ts lib/application/helpdesk-persistence.ts lib/repositories/episode-store.ts tests/domain/dispatch-*.ts tests/integration/dispatch-*.ts`: **0 errors, 0 warnings**.
- `npx tsc --noEmit`: **0 errors**.

---

## 5. Kesimpulan & Langkah Selanjutnya

Milestone **P3.2 — Pemeriksaan terakhir sebelum dispatch** telah selesai penuh (**✅ Done**). Seluruh guard deterministik pra-pengiriman, penolakan fail-closed yang aman, perlindungan backlog SHADOW dari replaying saat mode berganti, pembatalan intent otomatis saat staf takeover, pengisolasian private chat tester, serta integrasi persistence transaksional atomik telah terverifikasi secara ketat.

Pipeline siap melanjutkan ke **[P3.3 — Pengiriman Telegram melalui ChannelAdapter](TRACKER.md#task-p3-3)**.
