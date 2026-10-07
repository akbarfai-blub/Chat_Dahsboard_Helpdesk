# Laporan Review & Verifikasi P2.6 Tahap 1 — Fondasi Data Inbox dan Akses Staf

Status Task P2.6: **IN PROGRESS**. Koreksi A, B1, dan B2 diterima; validasi terarah Antigravity selesai penuh (D114, D115, 2026-10-06).
Rekomendasi: seluruh koreksi Tahap 1 (A, B1, B2) telah ditutup secara empiris; lanjutkan ke Tahap 2 UI Inbox (dashboard antrean, filter bar, riwayat thread, dan polling 5 detik). Prompt validasi tersedia di [P2_6_B2_VALIDATION_PROMPT.md](P2_6_B2_VALIDATION_PROMPT.md).

---

## 1. Ringkasan Eksekutif & Tujuan P2.6 Tahap 1 (Termasuk Penutupan Koreksi A)

Implementasi P2.6 Tahap 1 menghadirkan fondasi data, layanan aplikasi, dan kontrak API khusus staf untuk antrean/inbox Helpdesk Upaznet, sebagai persiapan landing dashboard:
1. **Unread Persisten Per Staf Terisolasi (D101, D102)**: Menghadirkan tabel `public.staff_conversation_reads` dengan kunci komposit `(staff_id, conversation_id)`. Posisi pembacaan staf A terbukti tidak mengubah posisi atau jumlah unread staf B.
2. **Pengamanan Mutasi Kursor Baca & Penutupan Penulisan Langsung (D102 / Koreksi A)**:
   - Hak mutasi langsung (`INSERT`, `UPDATE`, `DELETE`) pada `public.staff_conversation_reads` dicabut penuh dari role `authenticated` dan `anon` via migrasi `20261004110000`.
   - Pembuktian empiris database role sebenarnya (`SET LOCAL ROLE authenticated`) memastikan penulisan langsung ditolak dengan kode PostgreSQL `42501` (`permission_denied`), sementara `SELECT` data milik sendiri tetap diizinkan di bawah RLS.
   - Penandaan dibaca wajib melalui backend tersertifikasi (`markConversationRead`), di mana identitas staf murni diambil dari sesi server (`getUser()`).
3. **Batas Kepercayaan Validasi Origin Server-Side & Anti-Spoofing Forwarded Headers (D102, D103 / Koreksi A)**:
   - Sumber origin tepercaya dikunci murni pada server authority (`HELPDESK_TRUSTED_ORIGINS`), variabel platform deployment Vercel (`VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_URL`), base URL (`NEXT_PUBLIC_APP_URL` / `APP_URL`), atau loopback dev (`http://localhost:3000`, `http://127.0.0.1:3000`).
   - Header request dari client (`x-forwarded-host`, `x-forwarded-proto`, `host`) dilarang keras menambahkan atau memperluas origin yang diizinkan. Upaya spoofing origin asing ditolak 403 `origin_mismatch`.
   - Perbandingan origin exact mencakup skema, host, dan port via normalisasi WHATWG URL.
   - Origin tidak ada (`origin_missing`), tidak valid/null (`origin_invalid`), dan tidak cocok (`origin_mismatch`) ditolak dengan HTTP 403 `FORBIDDEN` dalam amplop standar tanpa kebocoran internal.
   - Konfigurasi server yang invalid/malformed memicu fail-closed (HTTP 403 `origin_mismatch`), tanpa pernah diam-diam beralih ke sumber tidak tepercaya.
   - Validasi berlangsung mendahului parsing body, pemeriksaan sesi, maupun pemanggilan koneksi pool database.
4. **Verifikasi Batas Autentikasi Boundary Route & Penegakan Aktor Sesi (D102 / Koreksi A)**:
   - Tes boundary membuktikan GET list, GET detail, dan POST read tanpa sesi mengembalikan 401 `UNAUTHENTICATED` dengan 0 pemanggilan ke database pool.
   - Upaya payload injeksi `staffId` pada body POST read diabaikan; aktor yang digunakan murni UUID dari sesi server (`user.id`).
   - Validasi batas percakapan memastikan pesan target diverifikasi milik percakapan yang diminta; menandai dibaca dengan pesan dari percakapan lain ditolak 404 `MESSAGE_NOT_FOUND`.
5. **Read-State Eksplisit & Kursor Agregat (D108–D112)**: Unread ditentukan dari `staff_message_reads.is_confirmed` per pesan dan per staf. `acknowledgedMessageIds` mengakui snapshot eksplisit; fallback `lastReadMessageId` hanya mengakui satu pesan. Kursor agregat mempertahankan presisi PostgreSQL dan tidak menentukan rentang pesan yang dianggap dibaca. `advanced` berarti ada pesan baru yang diakui, bukan selalu perpindahan kursor.
6. **Dekopling Utuh Percakapan 24 Jam dan Episode Komplain**: Container percakapan 24 jam (`conversations`) tidak sama dengan episode komplain (`complaints`). Pesan non-komplain tetap tersimpan utuh di Inbox dan detail dengan status `latestEpisode = null` dan penanda `needsReview = true`.
7. **Snapshot Satu Statement & Pagination (D113, D114)**: List memakai CTE tunggal dan detail satu SELECT dengan join lateral. Default limit 25 (maksimal 25); page serta offset wajib bilangan bulat aman. Urutan list ditegaskan di CTE pemilih halaman dan SELECT terluar setelah LEFT JOIN (`paged.last_activity_at DESC NULLS LAST, paged.id DESC NULLS LAST`). Validasi Antigravity membuktikan kebenaran urutan dan invariant snapshot.
8. **Verifikasi Cleanup Fixture Graph Lengkap & Kegagalan Terkontrol (D102, D103, D104, D105, D106 / Koreksi A)**:
   - AC 11 membuktikan pembersihan graph lengkap hasil pemrosesan `receive()` dan `process()` (`ingress_events`, `channel_identities`, `conversations`, `messages`, `complaints`, `triage_assessments`, `complaint_audit_log`, `reply_claims`, dan `staff_conversation_reads`). Keberadaan seluruh record target dibuktikan sebelum cleanup. Target dihapus via `cleanupFixture(pool, targetTracker)`; terbukti seluruh record target terhapus tuntas (count = 0) dan snapshot data pembanding terpisah pada 6 tabel tetap terpreservasi identik.
   - Seluruh tracker (targetTracker dan compTracker) dilindungi oleh teardown mandiri pada blok `finally`; kegagalan pembersihan satu tracker tidak menghentikan pembersihan tracker lainnya.
   - **Pencatatan Pre-Tracked Identity Sebelum `receive()`**: Helper `receiveTrackedInboundFixture` mengeliminasi celah race window dengan membuat baris `public.channel_identities` terlebih dahulu dan mencatatnya ke tracker sebelum `persistence.receive()` dipanggil. Saat `receive()` berjalan, `store.ensureIdentity()` memanfaatkan `ON CONFLICT DO UPDATE RETURNING id` untuk mengadopsi identity yang telah terlacak tersebut. Ingress ID dan message ID dicatat segera setelah `receive()` berhasil.
   - Subtest AC 11.1 membuktikan kegagalan terkontrol pasca pembuatan target tetap mengeksekusi teardown kedua tracker tanpa kebocoran data.
   - **Skenario Kegagalan Query Terkontrol Pasca receive() (AC 11.2, D107)**: Menguji situasi kegagalan query pertama sesudah `persistence.receive()` di dalam `receiveTrackedInboundFixture`: `SELECT identity_id FROM public.ingress_events WHERE id = $1` yang diinjeksi via dependency query `faultInjectedPool`. Helper terbukti gagal sebelum return (`helperReturned = false`). ID fixture dibaca dari tracker dan observasi query. Keberadaan `channel_identities`, `ingress_events`, dan `processing_jobs` dibuktikan nyata ada di DB sebelum cleanup via pool asli. Teardown pada blok `finally` membersihkan ketiganya tuntas (count = 0), serta membuktikan tidak ada downstream resource (`messages`, `triage_assessments`, `complaints`, `reply_owners`, `reply_claims`, `outbound_intents`) yang bocor atau diklaim terbentuk secara prematur di mode SHADOW. Dual error diproteksi `combineErrors`.
   - AC 12 memanggil jalur `HelpdeskPersistence.process()` nyata dengan lease token invalid yang memicu `PersistenceError("lease_lost")` dari dalam engine pemrosesan aktual, membuktikan seluruh sumber daya yang sempat dibuat dibersihkan tuntas pada `finally`.
   - AC 12.1 membuktikan `combineErrors` menggabungkan pesan primary error dan cleanup error secara bersamaan tanpa saling menutupi, sementara tracker lain tetap berhasil dibersihkan di DB.
9. **Guard Target Efektif Driver `pg`, Atomisitas Transaksi & Lifecycle Harness Bersama (D103, D104, D105, D106 / Koreksi A)**:
   - Resolusi target PostgreSQL pada runner dievaluasi berdasarkan opsi koneksi efektif driver `pg` (`resolveEffectivePgTarget` via parser internal `new Client({ connectionString })`) tanpa membuka koneksi jaringan. Hal ini mendeteksi penggantian port atau host via query parameter (`?port=54322`, `?port=5432`, `?host=evil.com`). Target default pengguna dan host diversion ditolak keras sebelum koneksi jaringan atau pool dibuat, terbukti dengan counter 0 call. Kredensial tidak pernah dicetak dalam log atau pesan error.
   - Runner memerlukan lingkungan terisolasi dengan baseline schema dan marker yang sudah tersedia di `public.mock_network_scenarios.description` dengan ID sesuai `HELPDESK_TEST_ENV_MARKER` (`test_env_isolated_marker`). Runner tidak melakukan bootstrap database kosong sebelum tabel marker tersedia.
   - DDL migrasi dan pencatatan versi ke `supabase_migrations.schema_migrations` dieksekusi secara atomik menggunakan satu dedicated client (`pool.connect()`) dengan pelepasan wrapper `BEGIN/COMMIT` terluar secara presisi tanpa merusak SQL internal. Rollback atomik terbukti membatalkan DDL saat pencatatan versi gagal.
   - **Wiring Harness Lifecycle Bersama (`runMigrationTestLifecycle`)**: Helper lifecycle bersama pada `tests/utils/test-migration-harness.ts` digunakan untuk eksekusi integrasi migrasi nyata maupun pengujian negatif guard dengan stub dependencies. Guard sesungguhnya memeriksa token marker, membatalkan eksekusi fixture, mengeksekusi 0 DDL/mutasi teardown, menutup pool, serta menggabungkan error utama dan error penutupan pool via `combineErrors` tanpa saling menutupi.

---

## 2. Perubahan Schema & Migrasi Database

File migrasi yang diterapkan:
1. Migrasi Awal: [`supabase/migrations/20261004100000_create_staff_conversation_reads.sql`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/supabase/migrations/20261004100000_create_staff_conversation_reads.sql).
2. Migrasi Koreksi A: [`supabase/migrations/20261004110000_revoke_direct_staff_conversation_reads_mutation.sql`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/supabase/migrations/20261004110000_revoke_direct_staff_conversation_reads_mutation.sql).
3. Migrasi Koreksi B1: [`supabase/migrations/20261004120000_create_staff_message_reads.sql`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/supabase/migrations/20261004120000_create_staff_message_reads.sql).
4. Migrasi Koreksi B1 (Backfill Unconfirmed): [`supabase/migrations/20261004130000_correct_legacy_message_read_backfill.sql`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/supabase/migrations/20261004130000_correct_legacy_message_read_backfill.sql).
Seluruhnya telah disinkronkan ke direktori migrasi lingkungan uji: [`tests/test-env/supabase/migrations/`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/tests/test-env/supabase/migrations/).

### A. Tabel `public.staff_conversation_reads`
```sql
create table if not exists public.staff_conversation_reads (
  staff_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  last_read_message_id uuid references public.messages(id) on delete set null,
  last_read_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (staff_id, conversation_id)
);
```

### B. Proteksi Akses & Kebijakan Hak (D102)
- **Pencabutan Hak Mutasi Langsung dari Browser**:
  ```sql
  -- Migrasi 20261004110000
  revoke insert, update, delete on table public.staff_conversation_reads from authenticated;
  revoke insert, update, delete on table public.staff_conversation_reads from anon;
  grant select on table public.staff_conversation_reads to authenticated;
  ```
- **Row Level Security (RLS)**: Diaktifkan (`alter table public.staff_conversation_reads enable row level security`).
- **Policy Authenticated**:
  - `select`: `auth.uid() = staff_id` (hanya pembacaan baris milik sendiri yang diizinkan langsung).
  - Mutasi wajib melalui koneksi backend tersertifikasi (`markConversationRead`).
- **Indeks Efisiensi**:
  - `idx_staff_conversation_reads_lookup`: `(conversation_id, staff_id)`
  - `idx_staff_conversation_reads_staff`: `(staff_id)`

### C. Tabel Granular `public.staff_message_reads` (Koreksi B1 / D108)
```sql
create table if not exists public.staff_message_reads (
  staff_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (staff_id, message_id)
);

alter table public.staff_message_reads enable row level security;
revoke insert, update, delete on table public.staff_message_reads from authenticated;
revoke insert, update, delete on table public.staff_message_reads from anon;
grant select on table public.staff_message_reads to authenticated;

create policy staff_message_reads_owner_select on public.staff_message_reads
  for select to authenticated using (auth.uid() = staff_id);
```

### D. Sinkronisasi Tipe & Harness Pengujian
- Tipe TypeScript database diperbarui di [`lib/supabase/database.types.ts`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/lib/supabase/database.types.ts) untuk tabel `conversations`, `staff_conversation_reads`, dan `staff_message_reads`.
- Pembersihan fixture pada [`tests/utils/test-guard.ts`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/tests/utils/test-guard.ts) (`cleanupFixture`) diperluas untuk membersihkan baris `staff_message_reads` dan `staff_conversation_reads` berdasarkan ID percakapan uji sebelum tabel induk dihapus.
- Migrasi diaplikasikan pada database pengujian terisolasi (`Chat_Automation_Helpdesk_Test`, `127.0.0.1:54332`) dan tercatat pada `supabase_migrations.schema_migrations`.
- Reproduksibilitas fixture diperkuat dengan pencatatan instan sumber daya (`TestResourceTracker`) segera setelah pembuatan `receive()`, sebelum processing job dijalankan, serta pengujian preservasi baseline pembanding terpisah.

### D. Jalur Penerapan Migrasi Tes Tervalidasi Guard & Atomik (D103, D104)
Untuk memastikan seluruh migrasi diterapkan secara aman, konsisten, dan atomik ke lingkungan tes tanpa script ad-hoc:
- **Runner Migrasi Terarah**: Disediakan [`tests/utils/test-migration-runner.ts`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/tests/utils/test-migration-runner.ts) dan script eksekusi [`scripts/apply-test-migrations.mjs`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/scripts/apply-test-migrations.mjs).
- **Guard Berlapis Sebelum DDL (Prinsip D100)**:
  1. *Resolusi Target Efektif Driver `pg` Tanpa Akses Jaringan*: Target PostgreSQL diurai menggunakan opsi koneksi driver `pg` aktual (`new Client({ connectionString })`) tanpa memanggil `connect()`. Mencegah penargetan database pengguna (`54322`, `5432`, `54321`) dan mendeteksi penggantian host atau port via query parameters (`?port=...`, `?host=...`). Penolakan diverifikasi menghasilkan 0 pemanggilan pool factory maupun query.
  2. *Dual-Path Marker Verification*: Memverifikasi PostgreSQL dan Supabase API membaca token marker yang sama (`test_env_isolated_marker`) dari `public.mock_network_scenarios.description` sebelum satu pun perintah DDL dieksekusi. Mismatch menghasilkan penolakan keras (0 DDL). Runner memerlukan database terisolasi yang sudah memiliki baseline schema dan tabel marker; runner tidak melakukan bootstrap database kosong.
  3. *Verifikasi Konsistensi File*: Memeriksa kesesuaian byte-for-byte antara file migrasi root (`supabase/migrations/`) dan salinan lingkungan uji (`tests/test-env/supabase/migrations/`).
  4. *Idempotensi Status Migrasi*: Memeriksa tabel `supabase_migrations.schema_migrations`. Migrasi yang sudah tercatat dilewati secara aman tanpa DDL berulang.
  5. *Eksekusi DDL & Ledger Atomik*: DDL migrasi dan pencatatan ledger dijalankan dalam transaksi atomik menggunakan satu dedicated client (`pool.connect()`). Pembungkus terluar `BEGIN;` dan `COMMIT;` dilepas secara aman dari file migrasi sehingga DDL dan INSERT versi committed atau rolled back bersamaan.
- **Prosedur Penerapan**:
  - *Lingkungan Tes*: Jalankan `node --env-file=.env.test scripts/apply-test-migrations.mjs` (atau panggil `runTestMigrations()`). Runner memvalidasi guard, mengonfirmasi kesamaan marker, dan menerapkan migrasi pending secara atomik, atau melaporkan status ledger up-to-date (0 applied, 10 skipped). Perlu dibedakan bahwa 0 migration applied pada ledger tetap dapat mengeksekusi statement DDL persiapan idempotent seperti `CREATE SCHEMA IF NOT EXISTS` dan `CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations` pada fase bootstrap pemeriksaan ledger.
  - *Output Tersanitasi*: Laporan eksekusi hanya mencatat host, port, dan database target tanpa mengekspos kredensial authority atau query parameter.

---

## 3. Kontrak API Khusus Staf

Seluruh endpoint beroperasi di bawah amplop respons standar aplikasi:
- Sukses: `{ success: true, data: T, error: null }`
- Gagal: `{ success: false, data: null, error: { code: string, message: string } }`
- Header Keamanan & Caching: Seluruh respons menetapkan `Cache-Control: private, no-store`.

Contoh JSON di bawah menjelaskan bentuk kontrak, bukan rekaman respons dari server HTTP. Status percakapan adalah `active`/`closed`; identitas pelanggan berada di `sender.customerId`/`sender.customerName`. Field `customer.accountStatus`, `targetNode`, serta status `open`/`escalated` tidak termasuk kontrak ini.

### 1. `GET /api/inbox/conversations`
Mengambil daftar ringkasan percakapan untuk antrean staf dengan filter, pencarian, snapshot konsisten, dan pagination stabil (25 item/halaman).

- **Query Parameters**:
  - `page`: nomor halaman (default `1`, integer >= 1 dan `Number.isSafeInteger(page)`).
  - `limit`: ukuran halaman (default `25`, max `25`, integer 1..25).
  - `status`: filter status percakapan (`"active"`, `"closed"`, atau `"all"`).
  - `episodeStatus`: filter status episode aktif (`"NEW"`, `"IN_PROGRESS"`, `"RESOLVED"`, `"CLOSED"`, `"none"`, atau `"any"`).
  - `unread`: boolean (`"true"` / `"false"`).
  - `needsReview`: boolean (`"true"` / `"false"`).
  - `search`: pencocokan parsial case-insensitive pada display name, ID eksternal pengirim, nama pelanggan, service code, dan body pesan; maksimal 100 karakter.
  - Offset `(page - 1) * limit` juga wajib `Number.isSafeInteger`. Page atau offset yang tidak aman ditolak dengan 400 `INVALID_PARAMETER` sebelum pool diambil; pemanggil service langsung mendapat validasi yang sama sebelum query.
- **Semantik Snapshot & Pagination**:
  - `totalCount` dan `items` dievaluasi dalam satu query CTE tunggal (`counted LEFT JOIN paged ON true`); `totalPages` dihitung dari hasil tersebut. Bukti overlap read-ack pada tes AC 14 versi D114 masih pending.
  - CTE memilih halaman dengan `ORDER BY last_activity_at DESC, id DESC`. SELECT terluar menegaskan `ORDER BY paged.last_activity_at DESC NULLS LAST, paged.id DESC NULLS LAST`, termasuk penanganan sentinel halaman kosong.
  - Pada dataset yang tidak berubah, transisi halaman (`page=1` -> `page=2`) menghasilkan item yang mutually exclusive (0 duplikasi) dan komprehensif. Perubahan dataset antar-request dapat menggeser posisi halaman sesuai sifat dasar offset pagination.
- **Format Respons Sukses (HTTP 200)**:
  ```json
  {
    "success": true,
    "data": {
      "items": [
        {
          "id": "c81f33e8-5b4d-4a2e-9d87-17e9976bb201",
          "channel": "telegram",
          "accountId": "bot_12345",
          "chatId": "chat_67890",
          "status": "active",
          "startedAt": "2026-10-04T01:00:00.000Z",
          "lastActivityAt": "2026-10-04T02:00:00.000Z",
          "sender": {
            "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
            "senderExternalId": "user_123",
            "displayName": "Budi Santoso",
            "verificationStatus": "verified",
            "customerId": "d820875c-3f9b-44a6-b516-1f6b8b1a37c9",
            "customerName": "Budi Santoso"
          },
          "lastMessage": {
            "id": "e812d8a4-0ef6-4df1-872e-336336e118ad",
            "body": "Internet mati dari tadi pagi lampu los merah",
            "receivedAt": "2026-10-04T02:00:00.000Z",
            "category": "connection_complaint",
            "reviewReason": null
          },
          "latestEpisode": {
            "id": "fa2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
            "status": "NEW",
            "category": "connection_complaint",
            "serviceId": "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
            "serviceCode": "INET-001",
            "createdAt": "2026-10-04T02:00:00.000Z",
            "updatedAt": "2026-10-04T02:00:00.000Z"
          },
          "unreadCount": 2,
          "isUnread": true,
          "needsReview": false
        }
      ],
      "totalCount": 1,
      "page": 1,
      "limit": 25,
      "totalPages": 1
    },
    "error": null
  }
  ```

### 2. `GET /api/inbox/conversations/[id]`
Mengambil detail percakapan dan riwayat pesan lengkap terurut kronologis naik dalam satu snapshot konsisten.

- **URL Parameter**: `id` (UUID percakapan yang valid).
- **Semantik Konsistensi**:
  - Seluruh header metadata, sender identity, latest episode, dan riwayat pesan diambil melalui query tunggal.
  - Nilai agregat `unreadCount` dijamin matematis sama dengan jumlah pesan di `messages` yang memiliki `isRead === false`.
  - `isUnread` bernilai `true` jika dan hanya jika `unreadCount > 0`.
  - Tidak ada wrapper redundan `conversation` di dalam respons (data percakapan dikembalikan langsung sebagai objek utama di `data`).
  - Representasi `classification` bersifat faktual murni mengikuti domain: `category`, `reason`, `ruleVersion`, `normalizedText` (termasuk nilai `null` yang sah), dan `matchedKeywords`. Tidak memuat `confidence` palsu (1.0) maupun array flags fiktif. Nilai rusak/kosong di database jatuh ke fallback representasi eksplisit (`"unknown"`, `null`, `[]`) tanpa mengklasifikasi ulang histori saat GET.
- **Format Respons Sukses (HTTP 200)**:
  ```json
  {
    "success": true,
    "data": {
      "id": "c81f33e8-5b4d-4a2e-9d87-17e9976bb201",
      "channel": "telegram",
      "accountId": "bot_12345",
      "chatId": "chat_67890",
      "status": "active",
      "startedAt": "2026-10-04T01:00:00.000Z",
      "lastActivityAt": "2026-10-04T02:00:00.000Z",
      "sender": {
        "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
        "senderExternalId": "user_123",
        "displayName": "Budi Santoso",
        "verificationStatus": "verified",
        "customerId": "d820875c-3f9b-44a6-b516-1f6b8b1a37c9",
        "customerName": "Budi Santoso"
      },
      "latestEpisode": {
        "id": "fa2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
        "status": "NEW",
        "category": "connection_complaint",
        "serviceId": "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
        "serviceCode": "INET-001",
        "createdAt": "2026-10-04T02:00:00.000Z",
        "updatedAt": "2026-10-04T02:00:00.000Z"
      },
      "unreadCount": 1,
      "isUnread": true,
      "needsReview": false,
      "messages": [
        {
          "id": "d112d8a4-0ef6-4df1-872e-336336e118ac",
          "conversationId": "c81f33e8-5b4d-4a2e-9d87-17e9976bb201",
          "identityId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
          "direction": "inbound",
          "channel": "telegram",
          "accountId": "bot_12345",
          "chatId": "chat_67890",
          "providerMessageId": "msg_001",
          "body": "Pagi min",
          "receivedAt": "2026-10-04T01:30:00.000Z",
          "createdAt": "2026-10-04T01:30:01.000Z",
          "messageType": "text",
          "hasMedia": false,
          "isForwarded": false,
          "caption": null,
          "senderInfo": {},
          "classification": {
            "category": "other",
            "reason": "no_keyword_match",
            "ruleVersion": "connection-keywords-v1",
            "normalizedText": "pagi min",
            "matchedKeywords": []
          },
          "reviewReason": null,
          "complaintId": null,
          "triageAssessment": null,
          "isRead": true
        },
        {
          "id": "e812d8a4-0ef6-4df1-872e-336336e118ad",
          "conversationId": "c81f33e8-5b4d-4a2e-9d87-17e9976bb201",
          "identityId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
          "direction": "inbound",
          "channel": "telegram",
          "accountId": "bot_12345",
          "chatId": "chat_67890",
          "providerMessageId": "msg_002",
          "body": "Internet mati dari tadi pagi lampu los merah",
          "receivedAt": "2026-10-04T02:00:00.000Z",
          "createdAt": "2026-10-04T02:00:01.000Z",
          "messageType": "text",
          "hasMedia": false,
          "isForwarded": false,
          "caption": null,
          "senderInfo": {},
          "classification": {
            "category": "connection_complaint",
            "reason": "connection_keyword",
            "ruleVersion": "connection-keywords-v1",
            "normalizedText": "internet mati dari tadi pagi lampu los merah",
            "matchedKeywords": ["internet mati", "los"]
          },
          "reviewReason": null,
          "complaintId": "fa2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
          "triageAssessment": {
            "decision": {
              "outcome": "candidate",
              "reason": "individual_los",
              "category": "connection_complaint",
              "mode": "SHADOW",
              "emergencyStop": false
            },
            "processingResult": {
              "claim": {
                "outcome": "skipped",
                "reason": "shadow_mode",
                "intentId": null
              },
              "dispatchAuthorized": false
            }
          },
          "isRead": false
        }
      ]
    },
    "error": null
  }
  ```

### 3. `POST /api/inbox/conversations/[id]/read`
Menandai pesan dibaca oleh staf berdasarkan snapshot eksplisit (`acknowledgedMessageIds`) atau fallback satu pesan (`lastReadMessageId`).

- **URL Parameter**: `id` (UUID percakapan yang valid).
- **Request Body**:
  ```json
  {
    "conversationId": "c81f33e8-5b4d-4a2e-9d87-17e9976bb201",
    "acknowledgedMessageIds": [
      "d112d8a4-0ef6-4df1-872e-336336e118ac",
      "e812d8a4-0ef6-4df1-872e-336336e118ad"
    ],
    "lastReadMessageId": "e812d8a4-0ef6-4df1-872e-336336e118ad"
  }
  ```
- **Format Respons Sukses (HTTP 200)**:
  ```json
  {
    "success": true,
    "data": {
      "success": true,
      "conversationId": "c81f33e8-5b4d-4a2e-9d87-17e9976bb201",
      "lastReadMessageId": "e812d8a4-0ef6-4df1-872e-336336e118ad",
      "lastReadAt": "2026-10-04T02:00:00.000000Z",
      "unreadRemaining": 0,
      "advanced": true,
      "newlyReadCount": 2
    },
    "error": null
  }
  ```
- **Karakteristik Operasi & Semantik `advanced`**:
  - `acknowledgedMessageIds`: snapshot eksplisit. Mengakui array ID pesan yang benar-benar ditampilkan di layar staf saat itu. Pesan yang datang bersamaan atau di luar snapshot tidak ikut terakui.
  - Fallback `lastReadMessageId`: hanya mengakui satu pesan target tunggal yang disebutkan tanpa ekspansi rentang waktu.
  - `advanced: true`: bernilai `true` apabila terdapat pesan baru yang berhasil diakui (`newlyReadCount > 0`), termasuk saat kursor agregat di `staff_conversation_reads` tidak bergerak maju (misalnya saat mengakui pesan yang bertimestamp lebih lampau dari kursor agregat).
  - `advanced: false`: bernilai `false` bila tidak ada pesan baru yang diakui (idempoten).

---

## 4. Arsitektur Komponen & Semantik Kursor Unread

```
[ Inbound Message ] ──► ingress_events (received_at)
                                │
                                ▼
                       messages (id, conversation_id)
                                │
[ Staff A (Browser) ] ──────────┼───────────────────────► [ Staff B (Browser) ]
         │                      │                                  │
  POST .../read                 │                           POST .../read
         ▼                      ▼                                  ▼
staff_message_reads (Staff A, message_id, confirmed)  staff_message_reads (Staff B, message_id, confirmed)
         │                                                         │
         ▼                                                         ▼
Unread A = pesan tanpa confirmed read milik A        Unread B = pesan tanpa confirmed read milik B
```

### A. Penyelarasan Linimasa & Monotonisitas (`ingress_events.received_at`)
- Riwayat pesan kronologis diurutkan berdasarkan `ie.received_at ASC, m.id ASC`.
- Kursor agregat memilih pesan terbaru dari confirmed read milik staf, dengan urutan PostgreSQL `ie.received_at DESC, m.id DESC`. Timestamp tidak melewati konversi `Date` JavaScript saat menentukan kursor.
- Sumber unread adalah keberadaan confirmed read per pesan, seperti query berikut:
  ```sql
  SELECT COUNT(m.id)::integer AS count
  FROM public.messages m
  LEFT JOIN public.staff_message_reads smr
    ON smr.message_id = m.id AND smr.staff_id = $1 AND smr.is_confirmed = true
  WHERE m.conversation_id = $2 AND smr.message_id IS NULL;
  ```
- Pesan di luar snapshot tetap unread meskipun received_at lebih lama atau sama dengan kursor agregat. Kursor tidak memperluas acknowledgement menjadi rentang waktu.
- Mengakui pesan lama yang belum dibaca menghasilkan `advanced: true` tanpa memundurkan kursor. Mengulang acknowledgement yang sudah confirmed menghasilkan `advanced: false`.

### B. Isolasi Multi-Staf
- Penyimpanan kursor menggunakan partisi `staff_id` (UUID dari `auth.users`).
- Pengujian membuktikan: Saat Staf A menandai pesan 1 dan pesan 2 sebagai dibaca (`unreadCount` Staf A menjadi 0), Staf B tetap memiliki `unreadCount = 2`.

### C. Dekopling Container Percakapan 24 Jam dengan Episode Komplain
- Container percakapan mewakili sesi obrolan 24 jam (`conversations`).
- Masalah pelanggan dapat berupa komplain koneksi (yang membentuk baris `complaints`) atau pesan umum non-komplain (pertanyaan info promo, tagihan, dll yang tidak membentuk episode komplain).
- Pada percakapan non-komplain:
  - `latestEpisode` bernilai `null`.
  - `needsReview` bernilai `true` (menandakan perlunya review/tanggapan staf helpdesk).
  - Pesan tetap tampil di Inbox dan dapat dibuka detail riwayatnya.

---

## 5. Bukti Empiris & Hasil Pengujian (Termasuk Penutupan Koreksi A)

Bukti integrasi yang telah diterima berasal dari database Supabase lokal terisolasi (`Chat_Automation_Helpdesk_Test`, PostgreSQL 54332/API 54331) dengan marker dan guard fail-closed. Bukti unit memakai stub tanpa koneksi database. Perubahan D114 belum menjalankan test, lint, typecheck, build, atau integrasi; tabel membedakan baseline yang diterima dari skenario baru yang masih pending.

### A. Pengujian Unit Layanan & Boundary Route (`tests/application/inbox-service.test.ts`)
Cakupan baseline unit dan boundary yang telah diterima tercantum di bawah. Jumlah checks untuk file setelah D114 menunggu laporan Antigravity; angka historis bukan hasil versi terbaru.

1. **Validasi Query Parameter & Kontrak Inbox (1 parent suite, 10 subtests)**:
   - Parameter default diterapkan saat query kosong (`page=1`, `limit=25`).
    - Validasi nilai `page` mewajibkan integer positif `>= 1`; D114 menambahkan batas safe integer untuk page dan offset, beserta boundary yang masih valid.
   - Validasi nilai `limit` membatasi integer positif hingga maksimal `25`.
    - Validasi enum `status` (`active`, `closed`, `all`).
   - Validasi enum `episodeStatus` (`NEW`, `IN_PROGRESS`, `RESOLVED`, `CLOSED`, `none`, `any`).
   - Validasi boolean ketat `unread` dan `needsReview`.
   - Sanitasi teks pencarian `search` (trim dan batas 100 karakter).
   - Penolakan parameter ganda untuk mencegah parameter pollution.
   - Validasi format UUID ketat (`isValidUuid`).
   - Preservasi kode error, pesan, dan HTTP status pada `InboxError`.

2. **Validasi Proteksi Origin Server-Side & Anti-Spoofing (1 parent suite, 10 subtests)**:
   - Header `Origin` tidak ada ditolak dengan HTTP 403 `origin_missing`.
   - Browser `Origin: null` ditolak dengan HTTP 403 `origin_invalid`.
   - Format `Origin` malformed ditolak dengan HTTP 403 `origin_invalid`.
   - Foreign `Origin` ditolak dengan HTTP 403 `origin_mismatch` walaupun header `x-forwarded-host` dan `x-forwarded-proto` dicocokkan dengannya (anti-spoofing).
   - Header forwarded tidak dapat memperluas daftar origin yang diizinkan.
   - Request dari origin sah diterima (`localhost:3000` dev default).
   - Request dari `HELPDESK_TRUSTED_ORIGINS` terkonfigurasi diterima.
   - Request dari variabel platform Vercel (`VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_URL`) diterima.
   - Konfigurasi server yang invalid/malformed ditangani terkendali (fail-closed, 403 `origin_mismatch`, tanpa fallback diam-diam).
   - Perbandingan exact scheme, host, dan port menolak segala bentuk variasi protokol, subdomain, atau port asing.

3. **Uji Boundary Autentikasi Route & Session Actor via Dependency Injection (1 parent suite, 6 subtests)**:
   - `GET /api/inbox/conversations` tanpa sesi mengembalikan 401 dan tidak memanggil pool database (0 query).
   - `GET /api/inbox/conversations/[id]` tanpa sesi mengembalikan 401 dan tidak memanggil pool database (0 query).
   - `POST /api/inbox/conversations/[id]/read` tanpa Origin ditolak 403 tanpa memanggil auth dan tanpa menyentuh pool.
   - `POST /api/inbox/conversations/[id]/read` dengan spoofed Origin ditolak 403 tanpa memanggil auth dan tanpa menyentuh pool.
   - `POST /api/inbox/conversations/[id]/read` tanpa sesi mengembalikan 401 dan tidak memanggil pool database.
   - `POST /api/inbox/conversations/[id]/read` memaksakan aktor staf berasal dari sesi server (`user.id`) dan mengabaikan nilai injeksi `staffId` pada body JSON request.

### B. Pengujian Unit Guard & Runner Migrasi Tes (`tests/utils/test-migration-runner.test.ts`)
Bukti baseline runner telah diterima tanpa koneksi database. Suite ini tidak berubah pada D114:
1. Verifikasi konsistensi byte-for-byte antara file migrasi root (`supabase/migrations`) dan salinan lingkungan uji (`tests/test-env/supabase/migrations`).
2. Resolusi target efektif via driver `pg` mendeteksi query parameters (`?port=54322`, `?port=5432`, `?host=evil.com`) tanpa membuka koneksi jaringan.
3. Penolakan target pengguna dan pengganti query param sebelum pool/koneksi/query dipanggil (terbukti 0 call pool factory/query):
   - 3.1 Target pengguna (port 54322 di authority) ditolak keras.
   - 3.2 URL yang tampak memakai port 54332 tetapi memiliki `?port=54322` ditolak keras.
   - 3.3 URL dengan `?port=5432` (port PostgreSQL default host) ditolak keras.
   - 3.4 URL dengan `?host=evil.com` yang mengarahkan keluar dari target tes ditolak keras.
4. Marker mismatch antara PostgreSQL dan Supabase API menghasilkan nol DDL dan nol mutasi fixture (via mock spy).
5. Pelepasan pembungkus transaksi terluar (`BEGIN;` dan `COMMIT;`) berlangsung aman tanpa merusak statement atau trigger internal.

### C. Pengujian Integrasi Migrasi & Kepemilikan Fixture Per-Run (`tests/integration/migration-runner.test.ts`)
Dijalankan via perintah mandiri `npm run test:migrations:local` dengan flag `--env-file=.env.test` (7 checks lulus penuh, 1 parent suite, 6 subtests, exit code 0):
1. **Verifikasi Guard Mismatch via Lifecycle Harness Bersama (Subtest 1.1, D106)**:
   - Menjalankan `runMigrationTestLifecycle` yang sama persis dengan eksekusi integrasi normal.
   - Menggunakan stub pool/Supabase dengan marker yang tidak cocok (`mismatched_test_marker`).
   - Guard sebenarnya mengeksekusi query marker dan melempar error mismatch (`Environment guard mismatch`).
   - Assertion membuktikan: pemeriksaan marker benar-benar dipanggil (`markerQueryCalled = true`), langkah fixture creation/processing dilewati (`fixtureStepExecuted = false`), nol DDL dan nol mutasi teardown (`teardownMutationExecuted = false`), pool koneksi tetap ditutup (`poolClosed = true`), dan error mismatch dilaporkan.
2. **Dual Error Reporting pada Siklus Hidup Harness (Subtest 1.2, D106)**:
   - Jika guard melempar error mismatch dan penutupan pool juga gagal (`pool.end()` throws `pool_close_error`), `combineErrors` menggabungkan kedua error tersebut tanpa saling menutupi.
   - Error utama dilaporkan dan error penutupan pool disertakan pada properti pesan/agregasi.
3. **Migrasi Pending Atomik (Subtest 2)**:
   - Migrasi pending dieksekusi secara atomik dalam lifecycle harness bersama: schema terbentuk (`test_atom_ok_<runId>`) dan versi dicatat ke `supabase_migrations.schema_migrations`.
4. **Skipping Migrasi Idempoten (Subtest 3)**:
   - Migrasi yang sudah tercatat dilewati secara aman pada eksekusi berikutnya tanpa mengeksekusi DDL berulang (0 applied, 1 skipped).
5. **Rollback Atomik saat Ledger Gagal (Subtest 4)**:
   - Kegagalan pencatatan versi pada ledger (disimulasikan via check constraint unik per-run `chk_mig_reject_<runId>`) membatalkan DDL secara atomik tanpa meninggalkan tabel yatim (`test_atom_rb_<runId>`) maupun entri ledger; constraint dan tabel dibersihkan di blok teardown terbatas milik harness.

### D. Pengujian Integrasi Database Nyata (`tests/integration/inbox.test.ts`)
Baseline sebelum D114 dilaporkan 33 checks (1 parent suite, 32 subtests) oleh eksekutor. AC 14–15 diperbaiki karena bukti sebelumnya belum membuktikan overlap dan kelengkapan ID. Hasil untuk kode terbaru masih pending:

| # | Skenario Pengujian | Hasil Aktual & Assertion Kunci | Status |
|---|---|---|---|
| AC 1 | **Validasi Staff ID pada Service** | Pemanggilan service dengan staff ID invalid ditolak `InboxError("INVALID_STAFF_ID")`, status 401. Penolakan request tanpa sesi diuji terpisah pada boundary route. | **PASS (baseline)** |
| AC 1.1 | **Bukti Hak Role Database Sebenarnya (D102, D108)** | Hak tabel diverifikasi via `has_table_privilege`. Klien database nyata menjalankan `SET LOCAL ROLE authenticated`; percobaan direct `INSERT`, `UPDATE`, dan `DELETE` ke `public.staff_conversation_reads` dan `public.staff_message_reads` ditolak dengan kode PostgreSQL `42501` (`permission_denied`). Operasi `SELECT` diizinkan di bawah RLS owner. Jalur backend tersertifikasi (`markConversationRead`) terbukti sukses memajukan kursor (`advanced: true`). | **PASS** |
| AC 1.2 | **Validasi Batas Pesan Percakapan (D102)** | Memanggil penandaan dibaca menggunakan ID pesan milik percakapan lain ditolak dengan error 404 `{ code: "MESSAGE_NOT_FOUND" }`. | **PASS** |
| AC 2 | **Daftar Percakapan & Preview** | Fixture 28 percakapan memiliki preview `lastMessage.body`, waktu aktivitas, identitas pengirim/pelanggan, ringkasan episode, dan needs-review. Pagination default 25 item; `direction` terdapat pada detail pesan, bukan preview list. | **PASS (baseline)** |
| AC 3 | **Preservasi Pesan Non-Komplain** | Pesan non-komplain tetap tersimpan dan tampil utuh di Inbox dengan `latestEpisode = null` dan `needsReview = true`. Container 24 jam tidak terhapus. | **PASS** |
| AC 4 | **Penyaringan Filter & Pencarian** | Filter `status`, `episodeStatus`, `unread`, dan `needsReview`; pencarian pada display name, ID eksternal pengirim, nama pelanggan, service code, dan teks pesan. | **PASS (baseline)** |
| AC 5 | **Detail Percakapan & Riwayat Kronologis** | `GET /api/inbox/conversations/[id]` menyajikan metadata percakapan dan array pesan terurut kronologis naik (`received_at ASC, id ASC`). | **PASS** |
| AC 6 (4.a) | **Isolasi Unread Antar-Staf & Persistensi Reload** | Staf A menandai percakapan sebagai dibaca (`unreadCount` Staf A menjadi 0). Staf B yang memeriksa percakapan yang sama tetap memiliki `unreadCount = 2`. Reload detail mengembalikan status yang persisten. | **PASS** |
| AC 6.1 (4.d) | **Delayed Processing Ingress Tetap Unread (D108, D109)** | Menggunakan helper `receiveTrackedInboundFixture` yang mencatat identity sebelum `receive()` dan mendukung `existingIdentityId`. Pesan yang diterima lebih awal tetapi baru di-commit setelah snapshot staf diambil tetap terhitung unread (`isRead = false`, `unreadCount = 1`) meskipun `received_at`-nya lebih lampau. | **PASS** |
| AC 6.2 (4.e) | **Pesan Baru Timestamp Sama & UUID Lebih Kecil Tetap Unread (D108, D109)** | Relasi UUID dibuat 100% deterministik tanpa loop acak 20 percobaan. Pesan baru yang masuk dengan `received_at` persis sama dan UUID lebih kecil tetap unread (`isRead = false`, `unreadCount = 1`) karena tidak termasuk dalam snapshot yang diakui staf. | **PASS** |
| AC 6.3 (4.f) | **Presisi Mikrodetik PostgreSQL (.123456 vs .123789) (D108, D109)** | Relasi deterministik M1 (.123456, UUID lebih besar) dan M2 (.123789, UUID lebih kecil). Pengakuan M1 menghasilkan respons kursor berakhir `.123456Z` dan nilai di DB cocok. Pengakuan M2 menghasilkan `.123789Z`. Mengulang snapshot lama tidak memundurkan kursor. Assertion diverifikasi pada presisi PostgreSQL via teks ISO tanpa pemotongan oleh Date JavaScript. | **PASS** |
| AC 6.4 | **Fallback lastReadMessageId Tunggal Mereproduksi Pemicu Bug Rentang (D109, D110)** | Snapshot S1 memuat M1 (`received_at: 10:00:00`). M2 diproses setelah S1, tetapi memiliki `received_at: 09:30:00` (lebih lampau daripada M1). Memanggil fallback hanya dengan `lastReadMessageId: M1` strictly hanya menandai M1; M2 tetap unread di respons (`unreadRemaining = 1`), detail (`isRead = false`, `unreadCount = 1`), dan tabel DB `staff_message_reads` (hanya ada 1 baris). Pengulangan request idempoten (`newlyReadCount = 0`, `advanced = false`). Jalur `acknowledgedMessageIds` tetap bekerja menandai M2. | **PASS** |
| AC 6.5 | **Legacy Unconfirmed Backfill Tetap Unread & Konfirmasi Idempoten (D109, D110)** | Baris hasil backfill migrasi lama (`is_confirmed = false`) tidak membuat pesan dianggap dibaca (`unreadCount = 2`, `isRead = false`). Acknowledgement eksplisit baru dari staf mengonfirmasi baris tersebut (`is_confirmed = true`, `newlyReadCount = 1`). Pengulangan konfirmasi idempoten (`newlyReadCount = 0`). Staf lain tetap terisolasi. | **PASS** |
| AC 6.6 | **Transisi Migrasi SQL Aktual & Dampak Kebijakan (D110, D111)** | Membaca langsung SQL dari 4 file migrasi fisik di disk via `fs.readFileSync` (`20261004100000`, `110000`, `120000`, `130000`). Terbukti empiris: (a) upgrade path pada `test_mig_upg_<runId>` menandai baris backfill dan kursor legacy `is_confirmed = false` dengan relasi domain `public.messages` dan `public.conversations` utuh; (b) fresh sequence pada namespace baru kosong `test_mig_fresh_<runId>` mengeksekusi 4 file berurutan, menetapkan default `is_confirmed = true` pada kolom dan insert baru, serta acknowledgement eksplisit terkonfirmasi idempoten; (c) baris pembanding sebelum dan sesudah 12:00:00 UTC (11:00 vs 14:00) pada kedua tabel read-state diverifikasi ada sebelum transisi, dan eksekusi file migrasi aktual `20261004130000` secara otomatis mengubah kedua sisi waktu menjadi `is_confirmed = false` tanpa statement UPDATE manual peniru migrasi; (d) teardown kedua namespace dilindungi `combineErrors`. | **PASS** |
| AC 7 (4.b, 4.c) | **Monotonisitas & Idempotensi Kursor** | Memanggil penandaan dibaca pada snapshot yang sama berulang kali bersifat idempoten (`advanced: false`, `newlyReadCount: 0`). Menandai snapshot lama setelah kursor maju tidak memundurkan kursor atau menghapus status baca (`advanced: false`, kursor respons tetap pada pesan pemenang). | **PASS** |
| AC 7.1 (4.g) | **Overlapping Concurrency dengan Bukti Lock Barrier Terikat PID & Lifecycle Bersama (D108, D109, D110, D111, D112)** | Dua request penandaan dibaca konkuren dijalankan via `runConcurrentMarkReadHarness` pada koneksi berbeda (`client1`, `client2`). Terbukti empiris via join `pg_locks` berdasarkan PID koneksi nyata (`l_blocked.pid = pid2 AND l_holding.pid = pid1`) bahwa Connection 2 terblokir pada advisory lock (`pg_advisory_xact_lock`) milik Connection 1. Blok `finally` diproteksi pelepasan barrier, penantian settlement via `Promise.allSettled`, koneksi sehat dikembalikan ke pool, dan `allSettled = true`. | **PASS** |
| AC 7.2 | **Kegagalan Terkontrol Sebelum Barrier pada Request 1 (D110, D111, D112)** | Menggunakan harness bersama yang sama dengan menginjeksi kegagalan proxy query pada `pg_advisory_xact_lock` di Connection 1. Terbukti empiris: penantian barrier langsung berhenti seketika tanpa timeout hang, error ditangkap spesifik, blok `finally` dijalankan penuh, Connection 1 di-destroy (tidak dikembalikan sebagai sehat), Connection 2 tidak diluncurkan, mutasi di-rollback penuh (0 read baris di DB), dan `allSettled = true`. | **PASS** |
| AC 7.3 | **Controlled Timeout Pasca-Barrier pada Request Mark-Read & Settlement Riil (D111, D112)** | Menggunakan harness bersama yang sama dengan menginjeksi query yang tertahan setelah barrier pada Connection 2 via Proxy queryable. Terbukti empiris: barrier tercapai dan dilepas sebelum timeout, timeout dilaporkan sebagai error eksplisit `POST_BARRIER_TIMEOUT` kepada caller, koneksi aktif di-destroy via `client.release(true)` (tidak dikembalikan sehat ke pool), hook `onBeforeSettleCleanup` membatalkan injeksi sebelum settlement wait, assertion menunggu promise riil (`await Promise.allSettled`), membuktikan Request 1 `fulfilled`, Request 2 `rejected` karena pembatalan terencana, tidak ada error `CLEANUP_SETTLEMENT_TIMEOUT`, dan `allSettled = true`. | **PASS** |
| AC 7.4 | **Controlled Query Failure Pasca-Barrier pada Connection 2 (D112)** | Menggunakan harness bersama yang sama dengan menginjeksi error query terencana (`PLANNED_POST_BARRIER_QUERY_FAILURE`) pada Connection 2 pasca pelepasan barrier. Terbukti empiris: error query asli diteruskan utuh, `postBarrierTimedOut = false` (tidak diubah menjadi timeout), timer dibersihkan pada semua jalur, Request 1 committed, Connection 2 di-destroy, mutasi Request 2 di-rollback tanpa residu, dan seluruh request settled (`allSettled = true`). | **PASS** |
| AC 8 | **Preservasi Pesan Baru (Concurrent Ingress)** | Staf menandai pesan 1 sebagai dibaca. Pesan 2 yang datang setelahnya tetap dihitung sebagai unread (`unreadCount = 1`). | **PASS** |
| AC 8.1 (4.h) | **Pesan Masuk Antara Snapshot & Penandaan Baca Tetap Unread (D108, D109)** | Menggunakan `receiveTrackedInboundFixture`. Pesan yang masuk di sela-sela waktu antara staf mengambil snapshot detail dan staf mengirim request penandaan baca tetap unread (`isRead = false`, `unreadCount = 1`). | **PASS** |
| AC 9 | **Imutabilitas Domain & Pengaturan Otomasi** | Penandaan dibaca tidak mengubah status `public.complaints`, tidak memicu perubahan `public.automation_settings`, dan tidak membuat entri `public.outbound_intents`. | **PASS** |
| AC 10 | **Read-Only Semantics pada Endpoint GET** | Query GET list dan detail terbukti 100% read-only tanpa efek samping mutasi pada database. | **PASS** |
| AC 11 | **Preservasi Baseline Pembanding & Cleanup Graph Lengkap (D102, D103, D104, D106, D108, D109, D110)** | Identity pre-created dan dicatat ke tracker sebelum `receive()` dijalankan (`receiveTrackedInboundFixture`). Fixture target yang dibersihkan berupa graph lengkap hasil pemrosesan `receive()` dan `process()` (`ingress_events`, `channel_identities`, `conversations`, `messages`, `complaints`, `triage_assessments`, `complaint_audit_log`, `reply_claims`, `staff_conversation_reads`, dan `staff_message_reads`). Episode complaint terbukti terbentuk tanpa syarat. Keberadaan seluruh record target dibuktikan sebelum cleanup. Pada mode SHADOW, diverifikasi bahwa `reply_claims` dan `outbound_intents` tidak dibentuk (count = 0). Target dihapus via `cleanupFixture(pool, targetTracker)`; terbukti seluruh record target terhapus tuntas (count = 0). Data pembanding pada 6 tabel terbukti 100% identik dengan snapshot field-by-field. Seluruh tracker dilindungi blok `finally`. | **PASS** |
| AC 11.1 | **Controlled Failure After Target Creation Teardown & Identity Leak Closure (D104, D105, D106)** | Pencatatan instan `identityId` sebelum dan segera setelah `receiveTrackedInboundFixture` menjamin identitas terdaftar sebelum kegagalan disimulasikan. Teardown mandiri mengeksekusi `cleanupFixture` untuk kedua tracker di blok `finally`. Assertion komprehensif membuktikan seluruh entitas graph terhapus tuntas tanpa kebocoran. | **PASS** |
| AC 11.2 | **Controlled Query Failure After receive() & Zero Resource Leakage (D106, D107)** | Skenario kegagalan query pertama sesudah `persistence.receive()` di dalam `receiveTrackedInboundFixture`: `SELECT identity_id FROM public.ingress_events WHERE id = $1` yang diinjeksi via dependency query `faultInjectedPool` (Proxy). Terbukti helper melempar exception sebelum mengembalikan hasil (`helperReturned = false`). Error ditangkap secara spesifik. Keberadaan record dibuktikan di DB sebelum cleanup, lalu dibersihkan tuntas (count = 0) tanpa pembentukan episode prematur. Dual error diproteksi `combineErrors`. | **PASS** |
| AC 12 | **Controlled Processing Failure pada Jalur process() Nyata (D103, D104, D106)** | Fixture memakai `receiveTrackedInboundFixture`, dengan identity tercatat sebelum `receive()`. Pemanggilan `HelpdeskPersistence.process()` dengan lease token invalid menghasilkan `PersistenceError("lease_lost")`. Cleanup berjalan di `finally`; assertion setelah cleanup membuktikan ingress, processing job, dan identity milik fixture masing-masing tersisa 0 baris. Tes ini tetap ada dalam suite Inbox yang dilaporkan lulus pada D115; baris tabel dikembalikan tanpa perubahan kode atau pengujian baru. | **PASS (Antigravity, D115)** |
| AC 12.1 | **Dual Error Reporting, Protected Lifecycle & Tracker B Identity Cleanup (D104, D105, D106)** | Menggunakan `receiveTrackedInboundFixture` dibungkus `try/finally` sejak sebelum resource pertama dibuat. Teardown mandiri membuktikan Tracker B bersih tuntas di database saat Tracker A gagal. `combineErrors` melaporkan primary error dan cleanup error secara utuh tanpa saling menutupi. Teardown suite menangkap error `pool.end()` dalam `try/catch` tanpa menimpa primary error atau meniadakan error cleanup. | **PASS** |
| AC 13 | **Classification Faktual (D113)** | Mapping data persisten dan fallback histori tanpa `confidence`/`flags` fiktif; tidak berubah pada D114. | **PASS (baseline)** |
| AC 14 | **Snapshot List/Detail Melintasi Commit Read-Ack (D114, D115)** | Writer berada pada `onBeforeCommit`; SELECT pertama membaca snapshot lama, lalu writer commit sebelum rows dikembalikan ke service. Detail terbukti tetap 2 unread sebelum commit, lalu 1 pada pembacaan baru. List `unread=true` terbukti count/item 1 sebelum commit, lalu 0 pada pembacaan baru. Masing-masing service terbukti mengeksekusi tepat satu statement (`queryCount === 1`). Kegagalan yang diinjeksi adalah controlled reader failure sebelum SQL; error asli diteruskan dan lifecycle menunggu settlement promise riil. Bounded timer, timer cleanup, dan destruction koneksi aktif jika settlement timeout merupakan proteksi yang tersedia dalam kode; timeout tidak diinjeksi pada AC 14 ini. Inbound berikutnya teruji sebagai before/after terpisah tanpa klaim overlap inbound. | **PASS (Antigravity)** |
| AC 15 | **Cakupan Seluruh Fixture & Pagination (D114, D115)** | Tepat 28 ID milik run; timestamp disamakan untuk menguji UUID DESC lintas halaman. Halaman berukuran 10/10/8 terbukti disjoin (0 duplikasi), gabungan ID identik 100% dengan 28 fixture run, setiap ID muncul tepat sekali, hasil berulang stabil mengembalikan ID yang sama, halaman jauh kosong (page 9999) mempertahankan count 28, dan pencarian tanpa hasil menghasilkan count 0, totalPages 0, items kosong. | **PASS (Antigravity)** |
| AC 16 | **Route Handler Sebenarnya (D113)** | Pemanggilan langsung handler dengan Request/Response, stub sesi staf, dan pool tes; status 200/400/401/404, envelope `{ success, data, error }`, Cache-Control. Bukan browser E2E atau sesi login Supabase nyata. | **PASS (baseline)** |

### E. Bukti Empiris Validasi Antigravity pada Kode D114 (D115)
Validasi terarah dijalankan berurutan dari root repo oleh Antigravity pada 6 Oktober 2026:
1. `npx tsc -p tsconfig.test.json`: Kompilasi TypeScript sukses penuh, **exit code 0**, 0 error.
2. `node --conditions=react-server --test .test-build/tests/application/inbox-service.test.js`: **44 checks passed** (0 failed, 0 skipped, durasi 250ms, **exit code 0**). Membuktikan:
   - Parser menolak page tidak aman, string angka panjang yang menjadi Infinity (`"9".repeat(400)`), dan page aman yang menghasilkan offset overflow (`lastSafePageAt25 + 1`).
   - Parser menerima batas aman (`lastSafePageAt25` pada limit 25, dan `MAX_SAFE_INTEGER` pada limit 1).
   - Pemanggil service langsung menerima penolakan `InboxError("INVALID_PARAMETER", 400)` untuk NaN/Infinity/pecahan/angka di luar batas tanpa pemanggilan query pool (0 SQL).
   - Route `GET /api/inbox/conversations` mengembalikan 400 `{ success: false, data: null, error: { code: "INVALID_PARAMETER", message } }` sebelum `getPool()` dipanggil (0 pool access).
3. `npx eslint lib/application/inbox-contracts.ts lib/application/inbox-service.ts tests/application/inbox-service.test.ts tests/integration/inbox.test.ts`: **0 error, 0 warning**, **exit code 0**.
4. `npm run test:inbox:local`: **33 checks passed** (1 parent suite, 32 subtests), 0 failed, 0 skipped, durasi 3.83s, **exit code 0**. Membuktikan secara empiris:
   - Guard `requireIsolatedDatabase` memverifikasi kesesuaian target PostgreSQL 54332 dan API Supabase 54331 via token marker sebelum mutasi fixture.
   - AC 14: Single-statement snapshot invariance terbukti di bawah mutasi konkuren terkoordinasi (detail dan list sebelum/sesudah commit).
   - AC 15: Dataset pagination terverifikasi presisi: **28 percakapan, limit 10, pembagian 10/10/8**, tanpa duplikasi dan tanpa fixture yang hilang.

Catatan perapian sebelum Tahap 2 (2026-10-06): baris AC 12 dikembalikan berdasarkan tes yang masih ada; klaim timeout AC 14 dibatasi pada proteksi kode, terpisah dari reader failure sebelum SQL yang benar-benar diinjeksi. Tidak ada perubahan runtime, tes, hasil D115, atau status B2. Pengujian tidak dijalankan ulang untuk perapian dokumentasi ini.

---

## 6. Keterbatasan & Rencana Tahapan Berikutnya

1. **Status Task P2.6**: Tetap **`🟡 In Progress`** sesuai [TRACKER.md](TRACKER.md) dan [decision-log.md](decision-log.md) (D101–D115).
2. **Koreksi A, Koreksi B1, dan Koreksi B2 Selesai Penuh & Ditutup**:
   - Seluruh kekurangan Koreksi A (Origin server-side validator, cleanup graph utuh & failure path, runner migrasi atomik & guard target) telah ditutup tuntas.
   - Koreksi B1 (model unread berbasis snapshot eksplisit per-staf, penutupan fallback range expansion, migrasi korektif legacy backfill `is_confirmed = false`, preservasi mikrodetik PostgreSQL, advisory xact locking terikat PID, pre-tracked identity fixture, monotonisitas kursor, pembuktian transisi migrasi SQL aktual AC 6.6 dengan namespace terpisah dan tanpa UPDATE manual, pemicu regresi fallback AC 6.4, pengerasan lifecycle konkurensi pasca-barrier, settlement request riil pasca-pembatalan AC 7.3, serta diferensiasi timeout vs error query pasca-barrier AC 7.4) telah terverifikasi empiris penuh dan ditutup.
   - Koreksi B2 (outer ORDER BY, safe integer pagination & offset validation, bukti AC 14–15 dengan single-statement reader dan coordinated writer barrier, serta penyelarasan dokumentasi kontrak) telah divalidasi penuh oleh Antigravity dan **DITUTUP SECARA EMPIRIS**.
3. **P2.6 Tetap In Progress**:
   - Menunggu pengerjaan **Tahap 2 (UI Inbox dashboard)**.
4. **Lingkup yang Belum Dikerjakan (Masuk Tahap 2)**:
   - Komponen UI Inbox Dashboard: antrean percakapan interaktif, badge unread, penanda needs-review, filter bar, dan panel riwayat pesan (chat thread).
   - Polling client-side 5 detik dengan visual feedback loading/empty/error state.
5. **Lingkup di Luar P2.6 (Tahapan Mendatang)**:
   - Panel evidence jaringan & identitas lengkap (P2.7).
   - Composer balasan staf dan kontrol lifecycle episode (P3.1 - P3.5).
   - Recovery dashboard & outage banner (P4).
