# P2.3 Review — Conversation 24 Jam dan Pengaitan Riwayat Pesan

Tanggal: 29–30 September 2026  
Status: ✅ **Done**  
Keputusan Terkait: [D85](decision-log.md#conversation-24-jam-pengaitan-riwayat-pesan-dan-pemisahan-episode--d85), [D86](decision-log.md#rekonsiliasi-bridging-worker-order-independency-dan-scope-identitas-p23--d86), [D65](decision-log.md#konsolidasi-dan-rekonsiliasi-arsitektur-v20--d65), [D69](decision-log.md#tampilan-inbox-antrean-dan-evidence-jaringan-v20--d69)

---

## 1. Ringkasan Eksekutif

P2.3 menyediakan mekanisme pengelompokan conversation berbasis jendela inaktivitas (*sliding window*) 24 jam serta pengaitan riwayat seluruh pesan inbound ke conversation secara persisten.

Koreksi P2.3 menuntaskan seluruh temuan review kritis:
1. **Worker-Order Independency & Bridging**: Pengelompokan akhir ditentukan murni oleh urutan waktu penerimaan server tepercaya (`received_at`) dan aturan inaktivitas 24 jam (<24 jam menyambung, >=24 jam memisahkan), bukan oleh urutan eksekusi worker. Pesan penghubung yang tiba terlambat merekonsiliasi (*merge*) conversation tanpa meninggalkan referensi usang di `public.messages` maupun cached `processing_result` di `public.triage_assessments`.
2. **Status Aktif Objektif**: Hanya conversation dengan timestamp aktivitas paling mutakhir dalam scope (`max(lastActivityAt)`) yang berstatus `active`. Pesan historis yang tiba terlambat dibuat/diperbarui dengan status `closed` dan tidak merebut status aktif atau menutup conversation yang lebih baru.
3. **Penyelarasan Scope Identitas**: Scope conversation ditegakkan konsisten pada tuple `(channel, account_id, chat_id, identity_id)`. Pesan dari identitas pengirim berbeda pada grup/chat yang sama terisolasi mandiri dan tidak saling menutup.
4. **Preservasi Klaim & Debounce**: Transisi conversation 24 jam maupun rekonsiliasi penggabungan tidak mereset complaint episode dan tidak memberikan klaim balasan duplikat. Baris pada `public.reply_claims` dan `public.outbound_intents` terbukti tetap tepat 1 baris.
5. **Targeted Rollback**: Pengujian kegagalan terkontrol ditargetkan secara presisi pada `INSERT INTO public.triage_assessments` setelah mutasi conversation dan insert message selesai, membuktikan 0 perubahan parsial committed di luar transaksi, job tetap pending, retry berhasil idempoten, dan rollback pada aksi merge mempertahankan seluruh field snapshot kedua conversation awal.
6. **Rekonsiliasi Migration**: Migration awal `20260929200000` dipulihkan ke versi penerapan awal (default PostgreSQL NO ACTION); penyesuaian FK cascade/set null serta composite index `conversations_scope_identity_activity` diresmikan via migration lanjutan `20260929200001`. Keduanya terdaftar di `supabase_migrations.schema_migrations`. Kesetaraan skema dibuktikan secara komprehensif melalui perbandingan 9 kategori objek terhadap database PostgreSQL uji terisolasi yang dipasang dari nol.

Semua aturan pengelompokan diisolasi ke dalam fungsi domain murni (`lib/domain/conversation.ts`) dengan parameter waktu eksplisit. Orkestrasi transaksi dan penyimpanan dieksekusi di application layer (`HelpdeskPersistence` dan `EpisodeStore`) terlindungi oleh advisory transaction lock PostgreSQL.

---

## 2. Perubahan Kode dan Schema

### A. Migrasi Database dan Rekonsiliasi Schema
- **`supabase/migrations/20260929200000_create_conversation_persistence.sql`**:
  - Dipulihkan ke versi penerapan awal yang bersih (default PostgreSQL NO ACTION):
    - Tabel `public.conversations`:
      - `id` (uuid, primary key, default `gen_random_uuid()`)
      - `identity_id` (uuid, references `public.channel_identities(id)` dengan default NO ACTION)
      - `channel` (text not null check `btrim(channel) <> ''`)
      - `account_id` (text not null check `btrim(account_id) <> ''`)
      - `chat_id` (text not null check `btrim(chat_id) <> ''`)
      - `status` (text not null default `'active'`, check `status in ('active', 'closed')`)
      - `started_at` (timestamptz not null)
      - `last_activity_at` (timestamptz not null)
      - `created_at` / `updated_at` (timestamptz not null default now())
      - Check constraint: `last_activity_at >= started_at`
    - Indexes P2.3:
      - `conversations_scope_activity`: `(channel, account_id, chat_id, last_activity_at desc)`
      - `conversations_identity`: `(identity_id, last_activity_at desc)`
    - Kolom baru pada `public.messages`:
      - `conversation_id` (uuid, references `public.conversations(id)` dengan default NO ACTION)
      - Index: `messages_conversation`: `(conversation_id, created_at)`
    - RLS Policies & Grants: Row-Level Security aktif pada `public.conversations`. Read-only khusus authenticated staff via policy `conversations_staff_read`. Mutasi write langsung dari browser/anonim ditolak penuh (fail-closed); mutasi hanya diizinkan via koneksi pool backend.
- **`supabase/migrations/20260929200001_adjust_conversation_foreign_keys.sql`**:
  - Migration lanjutan yang menyesuaikan foreign keys dan index:
    - `conversations_identity_id_fkey`: `ON DELETE CASCADE` saat channel identity dibersihkan.
    - `messages_conversation_id_fkey`: `ON DELETE SET NULL` saat container conversation diserap/dibersihkan.
    - Composite index `conversations_scope_identity_activity`: `(channel, account_id, chat_id, identity_id, last_activity_at desc)` untuk mengoptimasi query scope identitas.
  - Keduanya terdaftar resmi pada tabel `supabase_migrations.schema_migrations`.
- **Bukti Konsistensi Skema & Pengujian Terisolasi**:
  1. *Uji Validasi Koneksi dan Siklus Hidup Database (Stub/Spy)*: Sebanyak 14 tes stub/spy dilaporkan lulus pada `tests/scripts/verify-p23-schema-migration.test.mjs`, menguji validasi URL ketat (`new URL()`, fail-closed, tanpa bocor kredensial) dan siklus hidup database termasuk error saat cleanup gagal. Assertion tes ini memeriksa error/rejection dari fungsi internal `runVerification()`, tidak menjalankan proses CLI untuk mengukur exit code.
  2. *Uji Pemasangan Baru Lengkap & Perbandingan Skema Nyata*: Dijalankan via skrip `scripts/verify-p23-schema-migration.mjs` terhadap database pengujian PostgreSQL lokal dengan nama yang di-generate dinamis. Skrip secara ketat memvalidasi host koneksi terlebih dahulu. Setelah database sementara berhasil dibuat, skrip mencoba cleanup melalui `finally` setelah mencoba menutup pool sementara. Kegagalan penghapusan dilaporkan sebagai error beserta nama database yang tertinggal; perilaku exit code nonzero diketahui dari pemeriksaan handler CLI yang memanggil `process.exit(1)`. Cleanup tidak dijamin selesai jika proses dihentikan paksa atau mesin mati. Verifikasi schema lokal nyata dilaporkan berhasil membandingkan sembilan kategori objek, menyelesaikan cleanup, dan berakhir dengan exit code 0.
     - Struktur kolom `public.conversations` (nama, tipe data, nullability, default): identik.
     - Seluruh batasan (`check`, `primary key`, `foreign key`) pada `public.conversations`: identik.
     - Kolom `public.messages.conversation_id` dan batasan FK `messages_conversation_id_fkey` (`ON DELETE SET NULL`): identik.
     - Nama dan definisi seluruh indeks P2.3 (`conversations_scope_activity`, `conversations_identity`, `messages_conversation`, `conversations_scope_identity_activity`): identik.
     - Status RLS (`relrowsecurity = true`) pada `public.conversations`: identik.
     - Kebijakan RLS (`conversations_staff_read`): identik.
     - Role table grants untuk `anon`, `authenticated`, dan `service_role`: identik.
     - Entri ledger migrasi `supabase_migrations.schema_migrations` (`20260929200000`, `20260929200001`): identik.

### B. Domain Layer Murni
- **`lib/domain/conversation.ts`**:
  - `CONVERSATION_INACTIVITY_THRESHOLD_MS = 86_400_000` (24 jam dalam milidetik).
  - Tipe hasil `EvaluateConversationGroupingResult`:
    - `action: "create"` dengan `shouldBeActive: boolean`.
    - `action: "join"` dengan `conversationId`, `updatedStartedAt?`, `updatedLastActivityAt?`, dan `shouldBeActive: boolean`.
    - `action: "merge"` dengan `survivingConversationId`, `absorbedConversationIds`, `startedAt`, `lastActivityAt`, dan `shouldBeActive: boolean`.
  - Logika deterministik:
    - Pesan penghubung yang jaraknya `< thresholdMs` ke akhir conversation sebelum dan awal conversation setelah memicu aksi `merge`.
    - `shouldBeActive` bernilai `true` hanya jika timestamp pesan/aktivitas lebih besar atau sama dengan aktivitas terbesar conversation lain dalam scope.

### C. Application & Persistence Layer
- **`lib/repositories/episode-store.ts`**:
  - `ensureConversationForIngress(receipt)`:
    - Menyertakan `identity_id = receipt.identity_id` dalam pencarian dan pembaruan kandidat conversation.
    - Menangani aksi domain `merge`:
      1. Re-parent pesan pada `public.messages` ke `survivingId`.
      2. Perbarui cached `processing_result->>'conversationId'` pada `public.triage_assessments` via `jsonb_set` ke `survivingId`.
      3. Perbarui batas rentang dan status `survivingId`.
      4. Hapus container conversation yang terserap (`delete from public.conversations where id = any(absorbedIds)`).
    - Menangani status aktif secara objektif (`shouldBeActive`): jika `false`, conversation dibuat/diperbarui dengan status `closed` tanpa menutup conversation lain yang lebih baru.
  - `listConversationsForChat(channel, accountId, chatId, identityId?)`: Mendukung filter opsional `identityId` untuk isolasi multi-user dalam satu chat.
  - `getConversationHistory(conversationId)`: Mengambil seluruh riwayat pesan dalam satu conversation berurutan secara kronologis (`received_at asc`), lengkap dengan metadata (`messageType`, `hasMedia`, `caption`, `senderInfo`, `complaintId`, `classification`).
- **`lib/application/helpdesk-persistence.ts`**:
  - Integrasi di dalam `process(ingressId)`: Memanggil `ensureConversationForIngress` di dalam transaksi atomik, menyertakan `conversation_id` saat insert ke `public.messages`, dan mengembalikan `conversationId` pada `ProcessingResult`.

---

## 3. Keputusan Desain & Perilaku (D85, D86)

1. **Jendela Inaktivitas 24 Jam (*Sliding Window*) & Independensi Urutan Worker (D85, D86)**:
   - Inaktivitas dihitung dari pesan terakhir yang relevan (`last_activity_at`), bukan umur pembuatan (`started_at`).
   - Kelompok akhir ditentukan murni oleh urutan waktu penerimaan server tepercaya (`received_at`), bukan urutan pemrosesan worker. Permutasi 0→20→40, 0→40→20, dan 40→20→0 menghasilkan satu conversation aktif yang identik (0h hingga 40h).
2. **Rekonsiliasi Bridging (D86)**:
   - Pesan penghubung yang tiba terlambat merekonsiliasi conversation terdahulu dan berikutnya. Pesan direparent, assessment disinkronkan, dan conversation yang diserap dihapus bersih.
3. **Status Aktif Berbasis Timestamp Objektif (D86)**:
   - Hanya kelompok dengan aktivitas terbaru dalam scope yang berstatus `active`. Pesan historis yang tiba terlambat dibuat/diperbarui dengan status `closed` dan tidak merebut status aktif atau menutup conversation yang lebih baru.
4. **Penyelarasan Penuh Scope Identitas (D86)**:
   - Scope conversation terikat spesifik pada tuple `(channel, account_id, chat_id, identity_id)`. Pesan dari identitas pengirim berbeda pada grup/chat yang sama terisolasi penuh.
5. **Preservasi Siklus Hidup Episode & Klaim Balasan (D85, D86)**:
   - Conversation adalah sesi komunikasi; episode adalah masalah jaringan/layanan pelanggan.
   - Transisi conversation baru (akibat jeda >= 24 jam) TIDAK mereset episode, tidak menduplikasi tiket/episode aktif, dan tidak mereset debounce.
   - Pengujian preservasi klaim menggunakan fixture klaim/intent sintetis yang disiapkan di database saat mode SHADOW, membuktikan bahwa kode transisi tidak memicu reservasi ganda (jumlah baris pada `public.reply_claims` dan `public.outbound_intents` tetap tepat 1 baris). Bukti ini tidak menunjukkan pengiriman balasan Telegram nyata karena mode SHADOW tidak mengizinkan dispatch.
6. **Preservasi Pesan Non-Komplain & Media Tanpa Teks (D85)**:
   - Pesan `/start`, percakapan chitchat, pesan dari identitas belum terhubung, maupun foto/media tanpa caption tetap disimpan dan dapat diambil kembali melalui riwayat conversation tanpa mengarang teks pelanggan dan tanpa membuat tiket/episode palsu.
7. **Keamanan Akses Internal (D85)**:
   - Pengambilan riwayat dibatasi pada jalur internal aplikasi/staf; tidak dibuka ke akses publik anonim dan tidak ada izin tulis dari browser.

---

## 4. Bukti Verifikasi (Empirical Proof)

Pengujian dijalankan pada PostgreSQL lokal Supabase (`127.0.0.1:54322`). Catatan ini merangkum bukti koreksi terakhir dan melestarikan rekaman log dari sesi eksekusi sebelumnya yang masih relevan.

### A. Bukti Koreksi Skrip Terakhir
(Skrip verifikasi migrasi dan pengamanannya)

# 1. Verifikasi Konsistensi Skema Pemasangan Baru vs Database Lokal (9 Kategori Identik)
node scripts/verify-p23-schema-migration.mjs
=== P2.3 Migration & Schema Equivalence Verification ===
[1/5] Preparing isolated database: p23_verify_40fb6950a03645feb3412fe9aa5074e0...
[2/5] Setting up Supabase prerequisites (auth schema, migrations ledger, default privileges)...
[3/5] Applying 6 migrations sequentially to isolated database...
  Applying 20260919115958_create_customer_identity_topology.sql... OK
  Applying 20260920090000_create_mock_network_status.sql... OK
  Applying 20260922090000_create_episode_persistence.sql... OK
  Applying 20260929100000_add_ingress_metadata.sql... OK
  Applying 20260929200000_create_conversation_persistence.sql... OK
  Applying 20260929200001_adjust_conversation_foreign_keys.sql... OK
[4/5] Extracting schema snapshots from both databases...
[5/5] Comparing schema objects between fresh installation and live user database...
  a. Comparing public.conversations columns...
  b. Comparing public.conversations constraints...
  c. Comparing public.messages.conversation_id column...
  d. Comparing public.messages.conversation_id foreign key constraint...
  e. Comparing indexes (conversations and messages)...
  f. Comparing RLS status...
  g. Comparing RLS policies...
  h. Comparing role table grants (anon, authenticated, service_role)...
  i. Comparing schema_migrations entries for P2.3...

>>> ALL 9 COMPARISON CATEGORIES ARE STRICTLY EQUIVALENT! <<<
Tearing down isolated database: p23_verify_40fb6950a03645feb3412fe9aa5074e0...
Teardown complete.
exit code 0

# 2. Skenario Unit Test Siklus Hidup & Keamanan Skrip (14 skenario stub/spy)
node --test tests/scripts/verify-p23-schema-migration.test.mjs
✔ URL Validation (validateUrl) (1.9826ms)
  ✔ rejects malformed URL
  ✔ rejects protocols other than postgres/postgresql
  ✔ rejects non-local hosts
  ✔ rejects query parameters (?host=10.0.0.1, options, etc)
  ✔ accepts valid local loopback URLs without query params
  ✔ does not leak password in validation errors
✔ Database lifecycle and cleanup (runVerification) (7.2315ms)
  ✔ uses different database names for different executions
  ✔ does not run DROP DATABASE if CREATE DATABASE fails
  ✔ does not run DROP DATABASE before CREATE DATABASE
  ✔ successful verification: temporary connection closed before DROP, cleanup finishes
  ✔ controlled failure after CREATE: cleanup is still attempted, returns nonzero error
  ✔ verification succeeds but DROP fails: nonzero error and database name reported
  ✔ verification fails AND DROP fails: both errors reported, nonzero
  ✔ validation failure does not create pool
ℹ tests 14
ℹ suites 2
ℹ pass 14
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0

### B. Bukti Sesi Sebelumnya yang Tetap Relevan
(Eksekusi yang direkam pada implementasi conversation awal)

# 3. Unit Tests Domain Logic Conversation (16 passed: 1 parent test + 15 subtests)
node --conditions=react-server --test .test-build/tests/domain/conversation.test.js
✔ 1. First message creates conversation with identical startedAt and lastActivityAt
✔ 2. Message with gap < 24h joins same conversation and updates lastActivityAt
✔ 3. Message with gap 23h 59m 59s (< 24h) joins same conversation
✔ 4. Message with gap EXACTLY 24h (86,400,000 ms) creates a new conversation
✔ 5. Message with gap > 24h creates a new conversation
✔ 6. Inactivity is sliding: multiple messages keep extending conversation beyond 24h total duration
✔ 7. Out-of-order earlier message (< 24h before startedAt) joins and updates startedAt
✔ 8. Message received within existing span [startedAt, lastActivityAt] joins without shifting boundaries
✔ 9. isWithinInactivityWindow accurately evaluates timestamps
✔ 10. Throws error on unparseable date
✔ 11. Bridging two conversations (0h and 40h joined by 20h) triggers merge action
✔ 12. Historical isolated message (>24h prior) creates closed conversation without usurping active status
✔ 13. Historical message joining earlier conversation does not usurp active status of later conversation
✔ 14. Exact 24h boundary bridge (0h and 24h bridged by 12h) merges cleanly
✔ 15. Bridging older conversations when a newer conversation exists remains closed
ℹ tests 16 (1 parent test + 15 subtests), pass 16, fail 0, exit code 0

# 4. Integration Tests PostgreSQL Lokal P2.3 (18 passed: 1 parent test + 17 subtests)
$env:HELPDESK_TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"; npm run test:conversation:local
▶ P2.3 24-hour conversation grouping, history association and episode decoupling
  ✔ first message creates a new conversation with accurate metadata
  ✔ message with gap < 24h joins existing conversation and updates last_activity_at
  ✔ sliding window: message after 26h from start but 24h-ε from last activity joins same conversation
  ✔ gap >= 24 hours triggers new conversation and marks previous inactive/closed
  ✔ gap exactly equal to 24h triggers new conversation per documented default
  ✔ duplicate or repeated process() call is idempotent and does not alter conversation
  ✔ messages on different chat_id or account_id remain strictly isolated
  ✔ distinct identities on the same channel, account, and chat remain strictly isolated
  ✔ permutation 0 -> 20 -> 40 resolves to single active conversation
  ✔ permutation 0 -> 40 -> 20 (bridging/merge) resolves to single active conversation
  ✔ permutation 40 -> 20 -> 0 (reverse arrival) resolves to single active conversation
  ✔ historical message arriving late does not become active or close the newer conversation
  ✔ exact 24h boundary bridged by late message merges into single active conversation
  ✔ non-complaints, /start, and caption-less media are retrievable via getConversationHistory
  ✔ conversation transition preserves existing reply_claims and outbound_intents without duplicate reservations
  ✔ controlled failure specifically at INSERT triage_assessments rolls back conversation and message associations, and retry succeeds idempotently
  ✔ parallel process() calls for identical and concurrent messages preserve conversation grouping integrity
✔ P2.3 24-hour conversation grouping, history association and episode decoupling
ℹ tests 18, pass 18, fail 0, exit code 0

Rincian Assertion Khusus Rollback Merge pada Subtest 16:
- Snapshot Pra-Merge: Disimpan ID, started_at, last_activity_at, status, updated_at kedua conversation (0h dan 40h), asosiasi conversation_id kedua pesan di public.messages, serta processing_result di public.triage_assessments.
- Titik Kegagalan Terbukti: Marker reachedInsertTriageAssessment = true membuktikan fault terjadi saat INSERT INTO public.triage_assessments pada pesan penghubung 20h (setelah mutasi conversation dan insert message dieksekusi dalam transaksi).
- Assertion Luar Transaksi Pasca-Rollback:
  * Kedua conversation dan seluruh 5 field snapshot (id, started_at, last_activity_at, status, updated_at) terbukti identik.
  * Asosiasi pesan 0h dan 40h serta processing_result assessment lama tetap utuh tanpa modifikasi.
  * Pesan penghubung 20h terbukti 0 baris pada public.messages maupun public.triage_assessments.
  * Ingress pesan penghubung 20h tetap ada (1 baris) dan processing job-nya tetap berstatus 'pending'.
- Pasca Fault Dilepas:
  * Pemrosesan ulang berhasil menghasilkan 1 conversation gabungan (resM0) dengan batas waktu akurat (started_at: t0, last_activity_at: t40) dan status 'active'.
  * Ketiga pesan dan ketiga assessment merujuk ke conversation yang bertahan.
  * Pemanggilan ulang process() terbukti idempoten tanpa duplikasi baris message atau assessment.

# 5. Regresi Webhook Telegram P2.2 (11 passed: 1 parent test + 10 subtests)
npm run test:telegram:local
✔ P2.2 Telegram webhook endpoint and persistent ACK integration
ℹ tests 11, pass 11, fail 0, exit code 0

# 6. Regresi Persistence P1.4 (12 passed: 1 parent test + 11 subtests)
npm run test:persistence:local
✔ P1.4 local PostgreSQL transactions, constraints and concurrency
ℹ tests 12, pass 12, fail 0, exit code 0

# 7. Suite Unit Test Proyek Keseluruhan (146 passed)
npm run test:unit
ℹ tests 146, pass 146, fail 0, exit code 0

# 8. Typecheck & Linter
npx tsc -p tsconfig.test.json -> 0 error (exit code 0)
npm run lint -> 0 error, 188 warnings (exit code 0)
```

---

## 5. Verifikasi Integritas Pesan Telegram Nyata

Pemeriksaan eksplisit pada database PostgreSQL lokal memastikan bahwa pesan webhook Telegram nyata milik pengguna dari sesi sebelumnya tetap utuh dan tidak terhapus:

| Ingress ID | Provider Message ID | Teks Pesan | Tipe Pesan | Status Job |
|---|---|---|---|---|
| `5b0ffccb-46d4-4b14-8e79-7cad86ed83f3` | `1` | `/start` | `text` | `pending` |
| `9682eff5-63cd-442a-820c-ae5e7313e4f5` | `2` | `Tes webhook: internet rumah mati, lampu LOS merah.` | `text` | `pending` |

Seluruh pengujian integrasi menggunakan fixture terisolasi dengan tag acak (`tag = "p23-" + randomUUID().slice(0, 8)`). Teardown pengujian hanya membersihkan baris dengan tag pengujian tersebut dan tidak menyentuh data Telegram nyata.

---

## 6. Batas Scope & Kesiapan Integrasi Berikutnya

- **Belum Membangun UI Inbox**: P2.3 menyediakan persistensi percakapan dan API internal `getConversationHistory()`. Pembuatan antarmuka visual antrean/inbox di dashboard berada pada P2.6.
- **Belum Membangun Worker Dispatch/Outbound**: Pemrosesan asinkron job pending menggunakan worker berbasis lease berada pada P2.5; outbound dispatch berada pada P3.
- **Kesiapan P2.4**: Pesan yang masuk via webhook siap diproses oleh pipeline orkestrasi triage dan assessment SHADOW pada P2.4, di mana conversation ID akan otomatis tersemat pada setiap assessment dan pesan yang diproses.

