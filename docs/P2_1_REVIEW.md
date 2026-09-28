# P2.1 — ChannelAdapter Inbound Telegram dan Pembatasan Tester (Review & Penutupan Bukti)

**Tanggal:** 29 September 2026 · **Status:** ✅ Selesai (Done)  
**Acuan:** [docs/PRD.md](PRD.md) §2, §4, §10, §11 · [docs/decision-log.md](decision-log.md) D81, D82 · [docs/TRACKER.md](TRACKER.md)  
**File Terkait:**  
- [`lib/adapters/channel-adapter-contracts.ts`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/lib/adapters/channel-adapter-contracts.ts)
- [`lib/adapters/telegram/telegram-types.ts`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/lib/adapters/telegram/telegram-types.ts)
- [`lib/adapters/telegram/telegram-adapter.ts`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/lib/adapters/telegram/telegram-adapter.ts)
- [`tests/adapters/telegram-adapter.test.ts`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/tests/adapters/telegram-adapter.test.ts)

---

## 1. Ringkasan Implementasi

Task P2.1 mengimplementasikan kontrak generic `InboundChannelAdapter` dan adapter konkret untuk Telegram Bot API (`TelegramChannelAdapter`). Adapter berfungsi sebagai batas sistem (*system boundary*) murni yang:
1. Memvalidasi payload masuk yang tidak tepercaya (baik berupa string mentah, Buffer, maupun objek).
2. Memeriksa batasan ukuran sebelum dan sesudah parsing (ukuran byte raw payload vs panjang karakter teks/caption).
3. Memvalidasi format tanggal pesan Telegram (`message.date`) terhadap batas representasi tanggal ECMAScript (`MAX_TELEGRAM_DATE_SECONDS = 8_640_000_000_000` detik), menolak nilai invalid/di luar rentang secara terstruktur tanpa melempar exception `RangeError`, tanpa menetapkan batas umur pesan atau menolak tanggal masa depan yang valid.
4. Menegakkan batasan tester: hanya private chat (`chat.type === "private"`) dan pengirim terdaftar pada `testerAllowlist` yang diterima; konfigurasi allowlist kosong gagal tertutup (*fail-closed*); konfigurasi tidak valid atau campuran pada helper maupun constructor melempar error dan tidak menerapkan allowlist parsial secara diam-diam.
5. Menormalisasi pesan ke dalam format `InboundReceipt` yang siap diserahkan ke `HelpdeskPersistence.receive()`, sekaligus menghasilkan `NormalizedInboundMessage` untuk kebutuhan display/review staf.
6. Memisahkan channel, bot account ID, sender external ID, chat ID, dan provider message ID sebagai field yang berbeda dan deterministik.
7. Menolak atau mengabaikan update yang belum didukung (seperti `edited_message`, `channel_post`, `callback_query`) dengan status terstruktur agar tidak memicu duplikasi atau mengganggu lifecycle episode.
8. Tidak melakukan klasifikasi keyword, lookup pelanggan/jaringan, pembuatan episode, mutasi database, atau I/O jaringan.

---

## 2. Kontrak ChannelAdapter

### 2.1 Interface Adapter (`InboundChannelAdapter`)
```typescript
export interface InboundChannelAdapter {
  readonly channel: string;
  readonly channelAccountId: string;

  /**
   * Validasi ukuran byte mentah sebelum JSON.parse() untuk melindungi memori runtime.
   */
  validatePayloadSize(rawPayload: string | Uint8Array | Buffer): InboundPayloadSizeValidation;

  /**
   * Parse dan normalisasi payload webhook yang tidak tepercaya.
   */
  parseInbound(rawPayload: unknown): InboundAdapterResult;
}
```

### 2.2 Tipe Hasil Adapter (`InboundAdapterResult`)
Hasil parsing dibagi ke dalam tiga luaran mutlak:
1. **`accepted` (`InboundAccepted`):**
   - `receipt: InboundReceipt`: membawa `sender` (`SenderKey`), `chatId`, `providerMessageId`, dan `text` yang kompatibel secara struktural dengan `HelpdeskPersistence.receive()`.
   - `normalized: NormalizedInboundMessage`: memuat metadata kaya seperti `messageType` (`text`, `photo`, `document`, `voice`, `video`, `audio`, `sticker`, `location`, `contact`, `other`), `hasMedia`, `caption`, penanda boolean `isForwarded`, `sentAt` (ISO UTC), dan `senderInfo` (nama/username informasional).
   - *Catatan Batas Persistence:* Kompatibilitas struktural `receipt` tidak sama dengan integrasi persistence. Pemanggilan `HelpdeskPersistence.receive(result.receipt)` saat ini hanya menyimpan teks/caption (`receipt.text`), sender, chat ID, dan provider message ID ke database. Metadata kaya pada `result.normalized` (tipe media, `isForwarded`, dsb.) belum disimpan ke tabel `ingress_events`.
2. **`unsupported` (`InboundUnsupported`):**
   - Digunakan untuk data protokol Telegram yang valid tetapi berada di luar cakupan pemrosesan bot saat ini:
     - `edited_message_ignored`: pesan hasil editan pengguna diabaikan secara eksplisit agar tidak memicu pesan/episode baru atau merusak debounce.
     - `unsupported_update_type`: `channel_post`, `callback_query`, `inline_query`, `poll`, dsb.
     - `unsupported_message_type`: pesan servis internal Telegram (misal pin message, update photo chat).
3. **`rejected` (`InboundRejected`):**
   - Digunakan untuk payload yang melanggar keamanan, format, ukuran, atau batasan tester:
     - `payload_too_large`: ukuran raw payload melebihi batas byte.
     - `invalid_json`: payload mentah bukan string JSON yang valid.
     - `invalid_payload_structure`: payload root bukan objek, kehilangan `update_id`, atau tanggal di luar rentang representasi (`> MAX_TELEGRAM_DATE_SECONDS`).
     - `missing_required_fields`: objek `chat` atau `from` tidak ditemukan.
     - `non_private_chat`: pesan berasal dari grup, supergroup, atau channel.
     - `not_in_tester_allowlist`: pengirim tidak terdaftar dalam allowlist tester.
     - `empty_tester_allowlist`: allowlist kosong atau belum dikonfigurasi (fail-closed).
     - `sender_chat_mismatch`: chat ID dan sender ID berbeda pada private chat.
     - `invalid_id_format`: ID Telegram bukan safe integer positif.
     - `text_too_long`: teks atau caption melebihi batas karakter.

---

## 3. Keputusan Teknis dan Default Prototype (D81, D82)

Sesuai catatan append-only pada [docs/decision-log.md](decision-log.md) entri **D81** dan **D82**:

| Parameter / Kebijakan | Nilai Default | Rasional & Dasar Keputusan |
|---|---|---|
| **Bot Account ID** | Disuplai via `config.botAccountId` | Berasal dari konfigurasi tepercaya server (`TELEGRAM_BOT_ACCOUNT_ID`), tidak pernah diambil dari klaim bebas payload. |
| **Identitas Pengirim** | String dari `from.id` numerik | `from.id` adalah ID permanen pengguna Telegram. Username (`from.username`) hanya metadata opsional dan dilarang menjadi identitas tepercaya karena dapat diubah sewaktu-waktu. |
| **Integritas Private Chat** | `chat.type === "private"` & `chat.id === from.id` | Telegram menjamin kesamaan chat ID dan sender ID pada private chat. Jika tidak sama, ditolak demi keamanan. |
| **Tester Allowlist** | `Set<string>` (numeric ID strings) | Disuplai via `config.testerAllowlist` (dapat diparse via `parseTesterAllowlist`). **Fail-closed penuh**: jika konfigurasi mengandung entri tidak valid, campuran (misal `"987654321,not_a_number"`), atau token kosong, melempar error saat startup/parsing dan menolak seluruh pesan tanpa menerapkan allowlist parsial. Allowlist kosong tetap valid dan menolak seluruh pesan saat runtime (`empty_tester_allowlist`). |
| **Rentang Tanggal Pesan** | `MAX_TELEGRAM_DATE_SECONDS = 8_640_000_000_000` detik | Batas atas representasi tanggal ECMAScript (100.000.000 hari dari epoch). Nilai di atas batas ini atau bernilai `Number.MAX_SAFE_INTEGER` ditolak terstruktur (`invalid_payload_structure`) tanpa melempar exception `RangeError`. Tidak ada pembatasan usia pesan lampau atau penolakan tanggal masa depan. |
| **Max Payload Size** | `65.536` byte (64 KB) | Melindungi proses server dari eksploitasi payload JSON berukuran besar sebelum diparse ke memori. |
| **Max Text Length** | `4.096` karakter | Mengikuti batas panjang pesan native teks Telegram Bot API (jauh di bawah batas 10.000 karakter `HelpdeskPersistence.receive()`). |
| **Max Caption Length** | `1.024` karakter | Mengikuti batas panjang caption native media Telegram Bot API. |
| **Pesan Non-Teks** | Diterima (`accepted`) | Pesan foto, dokumen, suara, video, audio, atau stiker dari tester yang sah tidak dibuang. Jika memiliki caption, caption menjadi `receipt.text`. Jika tanpa caption, `receipt.text = ""` (string kosong). Teks pelanggan tidak dikarang secara palsu. |
| **Pesan Diteruskan (*Forwarded*)** | Ditandai `isForwarded: true` | Implementasi saat ini **hanya mempertahankan penanda boolean `isForwarded`**, bukan rincian asal penerusan (*forward origin*). Identitas pengirim tetap `from.id` (tester yang mengirim ke bot). Data forward tidak boleh menjadi bukti identitas pelanggan. |

---

## 4. Matriks Pemenuhan Acceptance Criteria P2.1

| Kriteria Acceptance P2.1 | Implementasi & Pengujian | Status |
|---|---|---|
| **1. Validasi input tak tepercaya** | Memvalidasi JSON malformed, tipe root bukan objek, `update_id` bukan safe integer, ketiadaan field wajib `chat`/`from`, serta batas representasi tanggal `message.date` (`MAX_TELEGRAM_DATE_SECONDS = 8_640_000_000_000` dan `Number.MAX_SAFE_INTEGER`). Input invalid ditolak terstruktur tanpa exception. | ✅ Terpenuhi |
| **2. Normalisasi pesan Telegram ke bentuk receipt** | Menghasilkan `InboundReceipt` dengan `sender.channel = "telegram"`, `channelAccountId`, `senderExternalId`, `chatId`, `providerMessageId`, dan `text`. Terverifikasi lolos `isValidSenderKey()`. | ✅ Terpenuhi |
| **3. Pemeriksaan private chat & fail-closed allowlist** | Menolak grup/supergroup/channel (`non_private_chat`). Menolak pengirim di luar allowlist (`not_in_tester_allowlist`). Allowlist kosong menolak semua (`empty_tester_allowlist`). Konfigurasi allowlist invalid/campuran langsung melempar error dan menolak penerapan parsial. | ✅ Terpenuhi |
| **4. Hasil terstruktur dengan alasan eksplisit** | Seluruh cabang luaran mengembalikan diskriminator `outcome: "accepted" \| "unsupported" \| "rejected"` dengan kode alasan (`reason`) dan detail pesan yang aman tanpa membocorkan rahasia. | ✅ Terpenuhi |
| **5. Pemisahan identitas & akun tepercaya** | Channel, bot account, sender, chat, dan message ID dipisahkan pada properti berbeda. Bot account berasal dari konfigurasi server. Pesan dengan message ID sama pada chat/account berbeda menghasilkan identitas berbeda. | ✅ Terpenuhi |
| **6. Variasi payload & update** | Menangani teks, pesan non-teks (foto, dokumen, suara, dsb.), dan update `edited_message` secara eksplisit (`edited_message_ignored`). Pesan forward ditandai dengan flag boolean `isForwarded` tanpa mengubah pengirim. | ✅ Terpenuhi |
| **7. Batas ukuran terukur** | Pre-parse byte size validation (`validatePayloadSize`) membedakan ukuran byte dari panjang karakter teks, menangani multibyte UTF-8 (emoji/simbol), dan menolak teks >4096 / caption >1024. | ✅ Terpenuhi |
| **8. Portabilitas & tanpa side-effect** | Adapter murni in-memory tanpa koneksi database, tanpa panggilan HTTP/fetch keluar, dan tanpa mutasi global. | ✅ Terpenuhi |

---

## 5. Bukti Pengujian Unit

Pengujian unit dieksekusi menggunakan runner native Node.js (`node --test`) melalui perintah `npm run test:unit`.

### 5.1 Rincian Pengujian Adapter (`tests/adapters/telegram-adapter.test.ts`)
1. `✔ valid private chat tester message is accepted with correct normalization`
2. `✔ tester allowlist enforcement rejects unauthorized senders and fails closed when empty`
3. `✔ parseTesterAllowlist parses valid numeric IDs with whitespace/duplicates and fails closed on invalid configs`
4. `✔ constructor enforces identical fail-closed allowlist validation on direct configurations`
5. `✔ date validation enforces representable range, handles boundaries and Number.MAX_SAFE_INTEGER without throwing`
6. `✔ rejects group, supergroup, and channel chats`
7. `✔ rejects or treats unsupported update types explicitly`
8. `✔ handles malformed JSON and structural payload failures`
9. `✔ enforces byte size limits pre-parse and text length limits on content`
10. `✔ handles non-text media messages without inventing fake customer text`
11. `✔ forwarded messages are flagged without altering sender identity to forwarded author`
12. `✔ normalization is strictly deterministic for identical payloads`
13. `✔ identical message ID on different chats or bot accounts produces distinct identities`
14. `✔ tester not yet linked to customer is passed cleanly as unverified identity without crash`
15. `✔ adapter operates purely in-memory with zero network or database mutations`

**Hasil Uji Keseluruhan:**
- **Total Suite Unit:** 120 tests (105 domain/provider + 15 adapter)
- **Passed:** 120
- **Failed:** 0
- **Linter Check:** `npx eslint lib/adapters tests/adapters` lulus 0 error, 0 warning.
- **Typecheck:** `npx tsc -p tsconfig.test.json` lulus 0 error.

---

## 6. Batasan Scope & Kebutuhan Integrasi Menuju P2.2

Adapter P2.1 adalah unit batas sistem (*system boundary*) murni in-memory. Hal-hal berikut sengaja **tidak dibuat** pada P2.1 dan menjadi kebutuhan integrasi berikutnya:
1. **HTTP Route Handler Webhook (P2.2):**
   - Route handler `POST /api/webhooks/telegram` akan memvalidasi header rahasia Telegram (`X-Telegram-Bot-Api-Secret-Token`).
   - Handler membaca request body mentah sebagai Buffer/string, memanggil `adapter.validatePayloadSize()`, lalu `adapter.parseInbound()`.
2. **Persistence Ingress & Metadata Storage (P2.2):**
   - Pemanggilan `HelpdeskPersistence.receive(result.receipt)` saat ini menyimpan receipt dasar ke `ingress_events` dan `processing_jobs`.
   - **Kebutuhan Integrasi Metadata:** Metadata kaya pada `result.normalized` (seperti jenis media `messageType`, boolean `hasMedia`, caption terpisah, penanda boolean `isForwarded`, dan detail nama pengirim) baru tersedia di memori pada objek `normalized`. Agar metadata ini dapat ditinjau oleh staf secara persisten di dashboard, perpanjangan/penerusan data metadata ke skema persistence perlu diselesaikan pada task integrasi berikutnya (P2.2 / perluasan skema).
3. **Penanganan Respon Webhook:**
   - Jika adapter menghasilkan `accepted`, handler memanggil persistence dan mengembalikan HTTP 200 OK ke Telegram.
   - Jika adapter menghasilkan `unsupported`, handler mengembalikan HTTP 200 OK ke Telegram tanpa mencatat ingress (agar Telegram tidak mencoba kirim ulang terus-menerus).
   - Jika adapter menghasilkan `rejected` karena allowlist/chat/ukuran, handler mencatat log dan mengembalikan HTTP 200 OK (atau 400 sesuai kebijakan fail-closed webhook) tanpa membocorkan secret.
4. **Pengaturan Environment:**
   - Variabel `TELEGRAM_BOT_ACCOUNT_ID` dan `TELEGRAM_TESTER_ALLOWLIST` telah ditambahkan placeholder-nya pada `.env.example`. Nilai aktual disuplai pada environment lokal/Vercel saat P2.2.
