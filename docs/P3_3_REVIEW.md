# P3.3 Review — Pengiriman Telegram melalui ChannelAdapter

Dokumen ini menyajikan arsitektur teknis, kontrak antarmuka, implementasi keamanan, dan bukti pengujian empiris komprehensif untuk **P3.3 — Pengiriman Telegram melalui ChannelAdapter** sesuai dengan aturan pada [AGENTS.md](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/AGENTS.md), [PRD.md §4, §7 FR-08, §11 FR-16/FR-17, §17](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/docs/PRD.md), [TRACKER.md](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/docs/TRACKER.md), dan [decision-log.md](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/docs/decision-log.md) (D50, D65, D67, D161).

---

## 1. Ringkasan Status

- **Status Milestone**: ✅ **Done** (Acceptance Criteria P3.3 pada TRACKER.md `#task-p3-3` terpenuhi dan terbukti secara empiris dengan 0 fail dan 0 skipped).
- **Keputusan Terkait**: D50, D65, D67, **D161**.
- **Batas Scope P3.3 Ketat**:
  - Mengimplementasikan kontrak outbound dan helper pemetaan murni `buildOutboundSendRequest` pada `lib/adapters/channel-adapter-contracts.ts`.
  - Mengimplementasikan pengiriman HTTP keluar ke Telegram Bot API (`sendOutbound`) pada `lib/adapters/telegram/telegram-adapter.ts`.
  - Mempertahankan kompatibilitas penuh constructor `TelegramChannelAdapter` untuk alur inbound webhook yang sudah ada.
  - Menolak membuat migrasi SQL baru atau tabel `outbound_attempts`, dan menolak membangun worker loop / scheduler background database pada task ini (scope [P3.4](TRACKER.md#task-p3-4)).
  - Nol eksekusi git (`git commit`, `git push`, `git tag`).

---

## 2. Arsitektur Outbound ChannelAdapter

### A. Kontrak & Pemetaan Seragam (`lib/adapters/channel-adapter-contracts.ts`)

1. **Struktur Permintaan Pengiriman (`OutboundSendRequest`)**:
   Menyatukan jalur pengiriman balasan otomatis dan balasan manual staf di bawah satu payload standar:
   ```ts
   export interface OutboundSendRequest {
     readonly intentId: string;
     readonly origin: "automatic" | "staff";
     readonly dispatchAuthorized: true;
     readonly channel: string;
     readonly channelAccountId: string;
     readonly chatId: string;
     readonly senderExternalId: string;
     readonly text: string;
     readonly timeoutMs?: number;
   }
   ```

2. **Fungsi Pemetaan Murni (`buildOutboundSendRequest`)**:
   Memetakan hasil evaluasi pra-dispatch gerbang P3.2 (`PreDispatchAuthorizedResult`) ke `OutboundSendRequest` secara deterministik tanpa efek samping I/O. Memastikan balasan otomatis dan balasan staf melalui jalur adapter yang persis sama.

3. **Taksonomi Hasil Pengiriman (`OutboundSendResult` — Discriminated Union)**:
   - **`OutboundSendAccepted` (Sukses Pasti Provider)**:
     - `outcome: "accepted"`, `deliveryStatus: "provider_accepted"`, `readByRecipient: false`.
     - Menyimpan `providerMessageId`, `providerAcceptedAt` (ISO 8601 UTC), `respondedAt`, `httpStatus`, dan `retryable: false`.
     - *Jaminan PRD §11 FR-16*: Status `accepted` hanya menyatakan Telegram Bot API telah menerima pesan untuk dihantarkan; adapter **tidak pernah mengklaim bahwa pesan telah dibaca oleh pelanggan**.
   - **`OutboundSendFailedRetryable` (Kegagalan Pasti yang Dapat Di-retry)**:
     - `outcome: "failed_retryable"`, `httpDispatched: true`, `retryable: true`.
     - Mencakup `rate_limited` (HTTP 429) dan `provider_server_error` (HTTP 5xx).
     - Mengekstrak `retryAfterMs` dari atribut respons Telegram `parameters.retry_after` maupun fallback header HTTP `Retry-After`.
   - **`OutboundSendFailedPermanent` (Kegagalan Pasti Permanen — Dilarang Retry)**:
     - `outcome: "failed_permanent"`, `retryable: false`.
     - Mencakup pelanggaran pre-flight guard lokal (`httpDispatched: false`) serta penolakan permanen provider HTTP 4xx selain 429 (`httpDispatched: true`, mis. 400, 401, 403 bot diblokir, 404).
   - **`OutboundSendUnknown` (Hasil Ambigu Setelah Dispatch — Dilarang Retry Buta)**:
     - `outcome: "unknown"`, `httpDispatched: true`, `retryable: false`.
     - Mencakup `timeout_after_dispatch` (AbortError atau timeout socket), `network_error_after_dispatch` (socket hangup/koneksi putus di tengah jalan), dan `ambiguous_provider_response` (HTTP 200 tetapi JSON malformed, `ok !== true`, missing `message_id`, atau chat ID mismatch).
     - *Jaminan PRD §11 FR-16*: Dilarang melakukan blind retry jika pesan mungkin telah sampai di Telegram untuk mencegah pesan duplikat ke pelanggan.

4. **Interface Outbound**:
   - `OutboundChannelAdapter`: Mendefinisikan method `sendOutbound(request: OutboundSendRequest): Promise<OutboundSendResult>`.
   - `ChannelAdapter`: Menggabungkan `InboundChannelAdapter` dan `OutboundChannelAdapter`.

---

## 3. Implementasi Keamanan pada `TelegramChannelAdapter` (`lib/adapters/telegram/telegram-adapter.ts`)

1. **Kompatibilitas Mundur & Konfigurasi**:
   - Constructor `TelegramAdapterConfig` diperluas dengan field opsional: `botToken?: string`, `apiBaseUrl?: string`, `fetchImpl?: typeof fetch`, `defaultSendTimeoutMs?: number`.
   - Jika `botToken` tidak diinjeksi saat inisialisasi class, `sendOutbound` secara dinamis mengambil dari variabel lingkungan `process.env.TELEGRAM_BOT_TOKEN`.
   - Nilai default: `DEFAULT_TELEGRAM_API_BASE_URL = "https://api.telegram.org"` dan `DEFAULT_SEND_TIMEOUT_MS = 10_000` (10 detik).

2. **Sanitasi Kredensial Rahasia (`redactTelegramBotToken`)**:
   - Fungsi pembantu yang menyaring setiap kemunculan token bot literal dan regex URL pattern `/bot[^/\s]+\//gi` menjadi `/bot[REDACTED]/`.
   - Membatasi pesan error maksimal 500 karakter untuk mencegah memory & log bloat.
   - Semua `errorMessage` yang dikembalikan oleh `sendOutbound` diproses melalui sanitasi ini, menjamin token Telegram tidak bocor ke log, respons HTTP, maupun audit database.

3. **12 Pre-Flight Safety Guards (`httpDispatched: false`, Nol Request HTTP)**:
   Sebelum menyentuh jaringan atau memanggil `fetchImpl`, adapter memvalidasi 12 guard keamanan secara berurutan:
   1. `dispatchAuthorized === true`: Menolak request tanpa otorisasi pra-dispatch (`dispatch_not_authorized`).
   2. `origin === "automatic" || origin === "staff"`: Menolak jenis pesan lain seperti internal note (`invalid_origin`).
   3. `channel === "telegram"`: Menolak channel yang tidak didukung adapter (`unsupported_channel`).
   4. `channelAccountId === this.channelAccountId`: Menolak mismatch akun bot (`account_mismatch`).
   5. `this.testerAllowlist.size > 0`: Fail-closed jika allowlist kosong (`empty_tester_allowlist`).
   6. `isValidTesterId` dan `chatId === senderExternalId`: Menegakkan private 1-on-1 chat, menolak ID negatif grup/supergroup (`non_private_chat`).
   7. `testerAllowlist.has(chatId)`: Membatasi pengiriman hanya ke tester terdaftar (`not_in_tester_allowlist`).
   8. `text.trim().length > 0`: Menolak pesan kosong (`empty_message_body`).
   9. `text.startsWith("[SIMULASI DATA DUMMY] ")`: Menegakkan prefix simulasi wajib (`missing_simulation_prefix`).
   10. `bodyAfterPrefix.length > 0` dan tanpa double prefix: Menolak pesan yang hanya memuat prefix atau memiliki double prefix (`empty_message_body`, `invalid_outbound_body`).
   11. `text.length <= maxTextLength` (4096): Menegakkan limit panjang teks protokol Telegram (`text_too_long`).
   12. `effectiveBotToken.length > 0`: Memastikan token bot tersedia sebelum memanggil API (`missing_bot_token`).

4. **Eksekusi HTTP Terkontrol & Timeout AbortController**:
   - Mengirim HTTP POST ke endpoint `${apiBaseUrl}/bot${botToken}/sendMessage` dengan payload JSON `{ chat_id, text }`.
   - Dilindungi `AbortController` dengan batas timeout yang dapat dikustomisasi per request (`request.timeoutMs`) atau default adapter (10 detik).
   - Membersihkan timer pada blok `finally`.

---

## 4. Matriks Pemenuhan Acceptance Criteria P3.3

| Kriteria Acceptance P3.3 | Status | Implementasi Teknis & Bukti |
|---|---|---|
| **Jalur Adapter Bersama (Automatic & Staff)** | **TERPENUHI** | `buildOutboundSendRequest` memetakan baik `origin: "automatic"` maupun `origin: "staff"` ke `OutboundSendRequest`. Keduanya memanggil `adapter.sendOutbound()` yang sama dengan payload HTTP yang konsisten. Terbukti pada unit test dan integration test Scenario 1 & 2. |
| **Tujuan Hanya Tester Allowlist & Private Chat** | **TERPENUHI** | Guard pre-flight 5, 6, dan 7 menegakkan `chatId === senderExternalId` safe integer positif dan terdaftar di `testerAllowlist`. Menolak grup/channel ID negatif via `non_private_chat` dan non-tester via `not_in_tester_allowlist` dengan **0 pemanggilan fetch**. |
| **Prefix Simulasi Wajib** | **TERPENUHI** | Guard pre-flight 9 dan 10 memvalidasi `text.startsWith("[SIMULASI DATA DUMMY] ")`, menolak pesan tanpa prefix, body kosong setelah prefix, dan pesan dengan double prefix (`invalid_outbound_body`). |
| **Provider ID Dikembalikan** | **TERPENUHI** | Pada HTTP 200 dengan JSON valid, adapter mengekstrak `result.message_id` dan mengembalikannya sebagai `providerMessageId` (string) serta mengonversi `result.date` ke ISO 8601 UTC `providerAcceptedAt`. |
| **Hasil Pasti vs Ambigu Diklasifikasikan** | **TERPENUHI** | Hasil diklasifikasikan ke dalam 4 kategori diskriminatif: `accepted` (sukses pasti), `failed_retryable` (429 & 5xx pasti), `failed_permanent` (pre-flight & 4xx pasti), dan `unknown` (timeout, network error, malformed JSON setelah dispatch). |
| **Tidak Mengklaim Pesan Telah Dibaca** | **TERPENUHI** | Tipe `OutboundSendAccepted` secara eksplisit menetapkan field konstan `deliveryStatus: "provider_accepted"` dan `readByRecipient: false` (PRD §11 FR-16). |

---

## 5. Bukti Pengujian Empiris

### A. Unit Tests (`tests/adapters/telegram-outbound.test.ts`)
Dieksekusi via `npm test`:
- `buildOutboundSendRequest` memetakan otorisasi otomatis dan staf secara seragam (PASS).
- `redactTelegramBotToken` menyaring token literal, pattern URL, dan melakukan truncating 500 karakter secara aman (PASS).
- `sendOutbound` happy path menghasilkan payload HTTP POST yang valid dan mengembalikan `outcome: "accepted"`, `deliveryStatus: "provider_accepted"`, `readByRecipient: false` (PASS).
- 14 skenario penolakan pre-flight guard membuktikan **0 pemanggilan fetch** dan mengembalikan `failed_permanent` dengan `httpDispatched: false` (PASS).
- HTTP 429 mengekstrak `retryAfterMs` dari parameter JSON (5000ms) maupun header fallback HTTP (8000ms) dengan `failed_retryable` (PASS).
- HTTP 500, 502, 503, 504 mengembalikan `failed_retryable` (PASS).
- HTTP 400, 401, 403, 404 mengembalikan `failed_permanent` (PASS).
- Ambiguous outcomes (timeout, socket hangup, malformed JSON HTTP 200, missing message_id, chat_id mismatch) mengembalikan `unknown` dengan `retryable: false` (PASS).
- Uji sanitasi error membuktikan token bot rahasia tidak pernah bocor pada `errorMessage` (PASS).

**Hasil**: **341/341 tests PASS** (0 fail, 0 skipped, durasi ~1157ms).

### B. Integration Tests (`tests/integration/telegram-outbound.test.ts`)
Dieksekusi via `npm run test:outbound-adapter:local` menggunakan server HTTP loopback Node.js nyata (`127.0.0.1:0`) dan basis data PostgreSQL lokal terisolasi:
1. **Automatic Reply End-to-End via Loopback Telegram API**: Inbound `LOS_INDIVIDUAL` diproses persistence hingga intent terbentuk; dievaluasi pra-dispatch gate hingga `authorized`; dipetakan via `buildOutboundSendRequest`; dikirim via `adapter.sendOutbound` ke server loopback. Server loopback memverifikasi penerimaan header & body JSON dengan prefix simulasi; adapter menerima `outcome: "accepted"`, `providerMessageId: "991122"`, `deliveryStatus: "provider_accepted"`, `readByRecipient: false` (PASS).
2. **Staff Manual Reply End-to-End via Same Adapter Path**: Staf mengirim pesan manual; dievaluasi gate pra-dispatch; dikirim menggunakan method `adapter.sendOutbound` yang sama; server loopback menerima request; adapter menerima `providerMessageId: "991123"`, `readByRecipient: false` (PASS).
3. **Pre-Flight Rejection Zero HTTP Traffic**: Mengirim request ke non-tester dan request tanpa prefix simulasi ditolak adapter dengan `httpDispatched: false`; server HTTP loopback memverifikasi mencatat tepat **0 request masuk** (PASS).
4. **Definite Retryable, Definite Permanent, dan Ambiguous Timeout**: Server loopback mengembalikan 429 (`retryAfterMs: 7000`), 403 (`failed_permanent`), dan menahan koneksi hingga timeout 80ms terlewati (`outcome: "unknown"`, `reason: "timeout_after_dispatch"`, `retryable: false`, token ter-redaksi penuh) (PASS).
5. **Teardown & Zero Residue**: Server loopback ditutup (`server.close()`), customer/service/identity/ingress/message/complaint/outbound_intents dibersihkan, user staf dihapus dari `auth.users`, kueri residue memverifikasi 0 baris tersisa di 10 tabel inti (PASS).

**Hasil**: **5/5 checks PASS** (0 fail, 0 skipped, exit code 0, durasi ~814ms).

### C. Regresi Baseline & Tooling Pipeline
- `node tests/tooling/pipeline-tooling.test.mjs`: **53/53 checks PASS** (exit code 0).
- `npm run test:dispatch:local` (P3.2): **6/6 checks PASS** (exit code 0).
- `npm run test:template:local` (P3.1): **8/8 checks PASS** (exit code 0).
- `npm run test:persistence:local` (P1.4): **12/12 checks PASS** (exit code 0).
- `npm run test:shadow:local` (P2.11): **6/6 checks PASS** (exit code 0).
- `npx eslint lib/adapters/**/*.ts tests/adapters/*.ts tests/integration/telegram-outbound.test.ts`: **0 errors, 0 warnings**.
- `npx tsc --noEmit`: **0 errors**.

---

## 6. Kesimpulan & Langkah Selanjutnya

P3.3 telah **selesai penuh (`✅ Done`)**. Saluran adapter Telegram untuk pengiriman outbound telah siap dan teruji aman, baik untuk jalur balasan otomatis maupun balasan staf. 

Pipeline siap melanjutkan ke **P3.4 — Worker outbound, delivery attempt, dan retry aman** (`docs/TRACKER.md#task-p3-4`), yang akan mengimplementasikan skema `outbound_attempts`, worker execution loop dengan leasing transaksional, backoff retry untuk `failed_retryable`, dan penanganan investigasi manual untuk hasil `unknown`.
