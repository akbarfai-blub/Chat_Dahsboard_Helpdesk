# Laporan Review & Verifikasi P2.5 — Worker Pemrosesan Job dengan Lease dan Attempt

Status Task P2.5: **DONE** (Seluruh koreksi terarah, pembuktian server HTTP lokal Next.js port 3188, lease timing query terpisah, background fault injection, dan rekonsiliasi dokumentasi telah terbukti empiris 100%)  
Rekomendasi: **Selesai (DONE)**

---

## 1. Ringkasan Eksekutif & Tujuan P2.5

Implementasi P2.5 menghadirkan worker pemrosesan job yang aman terhadap konkurensi paralel, kegagalan crash, dan eksekusi pasca-ACK untuk Upaznet Helpdesk Automation:
1. **Atomic Claiming dengan Transaksi Langsung & Row Lock `FOR UPDATE SKIP LOCKED` (D93, D96)**: Job diambil secara atomik dengan transaksi mandiri (`BEGIN ... SELECT ... FOR UPDATE SKIP LOCKED ... COMMIT`) dan token kepemilikan unik (`lease_token` bertipe `text`); pemicu paralel tidak dapat merebut lease yang masih aktif. Transaksi claim mandiri ini tidak menggunakan `inHelpdeskTransaction` atau advisory lock global identity, menjaga performa konkurensi worker paralel.
2. **Pemisahan Query Waktu Validasi Otoritas Lease Pasca Row Lock pada Jalur Default (D95, D96)**: `recordJobFailure()` membedakan secara eksplisit waktu kejadian kegagalan (`failureTime` untuk pencatatan `completed_at` dan perhitungan backoff `next_attempt_at`) dari waktu validasi otoritas lease (`validationTime`). Pada jalur default, `recordJobFailure()` mengunci baris `processing_jobs` dengan `SELECT ... FOR UPDATE` terlebih dahulu; setelah lock diperoleh, fungsi menjalankan query terpisah `SELECT clock_timestamp() AS lock_acquired_at` dalam transaksi dan client yang sama. Bukti empiris pada AC 12 (tanpa override `validationNow`) membuktikan: saat client lain menahan row lock dan caller terbukti menunggu di `pg_locks`, pelepasan lock setelah lease kedaluwarsa menurut PostgreSQL menyebabkan `recordJobFailure()` mengembalikan `"lease_lost"` dengan mutasi nol (snapshot job dan attempt 100% identik), disusul keberhasilan recovery oleh worker berikutnya.
3. **Token Fencing pada Transaksi Final & Penutupan Jalur Direct process() (D94)**: Transaksi commit domain (`HelpdeskPersistence.process()`) memvalidasi kepemilikan lease di bawah baris kunci `FOR UPDATE`. Worker usang yang kehilangan lease (kedaluwarsa atau digantikan worker baru) ditolak dan tidak dapat memutasi domain atau menandai job selesai. Pemanggilan direct `process()` tanpa lease token pada seluruh job `in_progress` (baik lease aktif maupun kedaluwarsa) ditolak tegas untuk menjaga integritas siklus attempt.
4. **Pembuktian Eksekusi Pasca-ACK Melalui Server HTTP Next.js Lokal Nyata (D93, D95, D96)**: Pengujian integrasi AC 14 menjalankan server HTTP Next.js lokal terprogram pada port dedicated 3188 (`app.prepare()` + `http.createServer`). Menetapkan environment PostgreSQL dan API Supabase secara eksplisit pasca-prepare serta mereset pool singleton. Menggunakan barrier terkontrol berbasis lock `FOR UPDATE` pada active incident (yang memblokir domain `process()` namun membiarkan `receive()` tidak terblokir), terbukti: (a) ACK HTTP 200 `{ status: "accepted" }` diterima caller saat pemrosesan domain belum berjalan (`triage_assessments = 0`); (b) Setelah barrier dilepas, runtime Next.js `after()` secara otomatis menyelesaikan background processing hingga job berstatus `'done'`, attempt `'success'`, dan assessment tersimpan tanpa pemanggilan runner manual; (c) Tidak terbentuk outbound otomatis (0 outbound); (d) Jalur negatif HTTP nyata (401 unauthorized, 400 malformed, 200 ignored) dan idempotensi duplikat (status accepted dengan `duplicate: true`, tetap 1 job) terverifikasi.
5. **Eksekusi Background Callback dengan Controlled Fault Injection (D96)**: Pengujian AC 13 Subtest D membuktikan eksekusi callback background yang mengalami kegagalan terkontrol (fault injection pada query `INSERT INTO public.triage_assessments`). Terbukti: ACK 200 tetap sukses, ingress event committed tidak hilang, attempt 1 dicatat persisten sebagai `'retryable_failure'` dengan error tersanitasi, `next_attempt_at` dimundurkan sesuai backoff, dan recovery retry pada attempt 2 berhasil menyelesaikan job menjadi `'done'`. Pembuktian dibedakan tegas antara harness in-memory (`afterRunner`), server HTTP lokal, dan fault injection.
6. **Drain Resilien yang Tidak Terhenti pada Job Exhausted (D94)**: Ketika sebuah job kehabisan attempt, statusnya ditandai terminal `'failed'` dan attempt-nya `'terminal_failure'`, namun drain tidak menghentikan perulangan melainkan melanjutkan pemrosesan job eligible berikutnya dalam batch yang sama.
7. **Sanitasi Error & Proteksi SHADOW**: Pesan error dibersihkan dari kredensial database sebelum disimpan; mode SHADOW tetap menghasilkan tepat 0 `reply_claims` dan 0 `outbound_intents` otomatis.
8. **Preservasi Baseline Pembanding Terpisah & Pencatatan Terbuka Historis (D95, D96, D97)**: Pembersihan fixture dibatasi ketat ke UUID run; data pembanding terpisah terbukti 100% identik sebelum dan sesudah cleanup utama tanpa mengandalkan pengecekan tabel kosong secara global. Riwayat eksekusi penghapusan ad-hoc historis lama dicatat secara faktual dan transparan berdasarkan log aktual sebagai *unknown* tanpa fabrikasi data.
9. **Presedensi API Runtime Route, Pembatas Diagnostik Server, Kesesuaian Target Koneksi Aktual Driver pg, & Autentikasi Pra-Factory (D97, D98, D99, D100)**: `getHelpdeskAdminClient()` mendahulukan pembacaan variabel server `SUPABASE_URL` / `HELPDESK_TEST_API_URL` sebelum `NEXT_PUBLIC_SUPABASE_URL`, mencegah inlining statis Turbopack/Next.js yang menanam URL port 54321. Runner pengujian gagal sebelum mutasi (*fail-closed*) jika target runtime tidak sesuai lingkungan tes terisolasi. Rute HTTP webhook Telegram dilengkapi pembatas diagnostik server eksplisit (`ENABLE_TEST_RUNTIME_DIAGNOSTICS === "true"`, D98) yang nonaktif secara default. Pada konfigurasi normal, request dengan header pengujian tidak dialihkan dan tidak membocorkan metadata. Jika aktif: (a) Autentikasi secret via `timingSafeSecretMatch` dieksekusi secara ketat **sebelum** factory pool (`getHelpdeskPool`) maupun client API (`getHelpdeskAdminClient`) dipanggil; (b) `timingSafeSecretMatch` membandingkan panjang byte buffer UTF-8 (`Buffer.byteLength`) sebelum `timingSafeEqual`, bukan panjang karakter string UTF-16, dan aman tanpa exception saat menerima karakter multi-byte; (c) Kegagalan factory terkontrol setelah autentikasi ditangani dengan HTTP 500 `INITIALIZATION_FAILED` ber-envelope standar tanpa membocorkan credential, connection string, atau error mentah; (d) Target diagnostik mewajibkan konfigurasi target tes eksplisit tanpa fallback ke variabel runtime utama; (e) Target efektif PostgreSQL dievaluasi menggunakan parser konfigurasi driver `pg.Client` (`new Client(opts)`) pada objek pool tersimpan tanpa membuka koneksi jaringan, secara akurat menangkap parameter query pengganti target (`?port=...`, `?host=...`); (f) Target loopback port dev/prod (5432, 54322) ditolak dengan HTTP 403 `TEST_TARGET_INVALID` secara independen dari API, dan target tidak cocok ditolak dengan HTTP 403 `TEST_TARGET_MISMATCH`, semuanya terbukti sebelum query dijalankan (pool.query = 0, API call = 0); (g) Marker dievaluasi menggunakan kolom `description` pada tabel yang sudah ada `public.mock_network_scenarios` (tanpa membuat tabel marker baru atau migrasi skema baru) hanya setelah target cocok; marker tidak ditemukan atau berbeda token ditolak tanpa membocorkan metadata.
10. **Penyelarasan Fixture Identity & Teardown Menyeluruh Sejak Awal Setup (D97, D98)**: `TELEGRAM_BOT_ACCOUNT_ID` diselaraskan dengan akun fixture run sebelum dan sesudah `nextApp.prepare()`, dan ingress event terbukti ber-UUID identitas sama persis dengan fixture. Seluruh setup (env, fixture, server) dibungkus dalam `try/finally` dengan `EnvRestorer` dan `combineErrors`. Pembuktian teardown pada kegagalan setup terkontrol (AC 14.1, D98) dibatasi secara faktual pada pembersihan fixture dan pemulihan environment saat inisialisasi dibatalkan sebelum server dijalankan, tanpa klaim penutupan port atau proses server yang belum dibuka.

---

## 2. Schema Database & Migrasi (Migration 20261002100000)

File migrasi `supabase/migrations/20261002100000_create_job_leases_and_attempts.sql` (dan salinan pengujian pada `tests/test-env/supabase/migrations/`):

1. **Perluasan Tabel `public.processing_jobs`**:
   - `lease_token text`: Token kepemilikan lease aktif (bertipe `text`), diperbarui setiap kali klaim berhasil.
   - `lease_expires_at timestamptz`: Waktu kedaluwarsa lease; dihitung `now() + lease_duration`.
   - `attempt_count integer not null default 0`: Jumlah percobaan yang telah dijalankan.
   - `max_attempts integer not null default 3`: Batas maksimum attempt sebelum menjadi terminal failed.
   - `next_attempt_at timestamptz not null default now()`: Waktu paling cepat job boleh di-claim berikutnya (backoff).
   - `last_error text`: Ringkasan error terakhir yang telah dibersihkan dari kredensial.
   - Check constraint status diperluas: `check (status in ('pending', 'in_progress', 'done', 'failed'))`.
   - Partial index pendukung klaim:
     - `processing_jobs_eligibility`: `(status, next_attempt_at, lease_expires_at) where status in ('pending', 'in_progress')`.

2. **Tabel Riwayat Attempt `public.processing_job_attempts`**:
   - Kolom: `(id uuid, ingress_id uuid references processing_jobs(ingress_id) on delete cascade, attempt_number integer, lease_token text not null, started_at timestamptz, completed_at timestamptz, outcome text, error_message text, created_at timestamptz)`.
   - Outcome constraint: `check (outcome in ('in_progress', 'success', 'retryable_failure', 'terminal_failure', 'lease_expired'))`.
   - Unique constraint: `unique (ingress_id, attempt_number)`.
   - RLS diaktifkan (`alter table ... enable row level security`), hak akses mutasi eksklusif diberikan kepada `service_role`.

3. **Integritas Schema & Tipe**:
   - Tipe database TypeScript disinkronkan pada `lib/supabase/database.types.ts`.
   - Migrasi diaplikasikan langsung pada database pengujian terisolasi (`127.0.0.1:54332`) dan tercatat pada `supabase_migrations.schema_migrations`.

---

## 3. Parameter Operasional & Default Prototype (D93, D94, D95, D96)

Selaras dengan batasan fungsi serverless Next.js App Router dan PRD §11:

| Parameter | Nilai Default | Rasional & Hubungan Runtime |
|---|---|---|
| `DEFAULT_LEASE_DURATION_MS` | `30_000` (30 detik) | Cukup menampung latensi mock provider jaringan (2 detik) ditambah transaksi database, namun cukup pendek agar pemulihan pasca-crash worker tidak tertunda terlalu lama. |
| `MAX_INBOUND_ATTEMPTS` | `3` (3 kali) | Batas 3 attempt inbound diadopsi secara mandiri sebagai keputusan teknis D93. Batas ini mencegah perulangan tak berujung akibat payload malformed atau bug domain. *(Catatan: PRD §11 mengatur outbound; D93 menegaskan ini sebagai keputusan inbound independen).* |
| `BASE_BACKOFF_MS` | `2_000` (2 detik) | Backoff eksponensial dihitung `BASE_BACKOFF_MS * 2^(attempt - 1)` (Attempt 1: 2s, Attempt 2: 4s, Attempt 3: terminal fail). Waktu target `next_attempt_at` dihitung deterministik dari waktu kejadian kegagalan dicatat (`failureTime`), bukan dari waktu claim awal. |
| `MAX_JOBS_PER_DRAIN` | `5` (5 job) | Membatasi kuota batch worker per pemanggilan drain untuk mencegah monopoloisasi dan starvation. |
| `DRAIN_TIMEOUT_MS` | `20_000` (20 detik) | **Batas Waktu Antar-Job (Inter-Job Gating Threshold)**: Diperiksa di antara penyelesaian satu job sebelum memulai klaim job berikutnya. Ini **bukan hard timeout** yang memotong paksa atau me-race eksekusi satu job aktif yang sedang berjalan di tengah jalan. Job yang sedang berjalan dibiarkan menyelesaikan transaksinya secara konsisten. Durasi fungsi serverless yang dikonfigurasikan di platform host harus mencakup batas inter-job threshold (20s) ditambah latensi maksimum satu siklus job aktif (~5s). |

---

## 4. Arsitektur Komponen & Fencing Transaksi

### A. Lifecycle State Machine Job

```
[ Ingress Created ]
        │
        ▼
   ( pending ) ◄────────────────────────┐ (Retryable Failure & attempt < max)
        │                               │
        │ claimJob() [Atomic Lock]      │
        ▼                               │
 ( in_progress ) ───────────────────────┘
        │
        ├──► ( done )   [Transaksi final sukses: assessment & audit tersimpan]
        │
        └──► ( failed ) [Terminal Failure: attempt >= max atau fatal unrecoverable]
```

### B. Atomic Claiming (`claimJob` & `claimNextJob`)
- Menjalankan transaksi langsung pada pool client tersendiri:
  `BEGIN; SELECT ... FROM public.processing_jobs WHERE status IN ('pending', 'in_progress') AND next_attempt_at <= now() AND (lease_expires_at IS NULL OR lease_expires_at <= now()) ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED; ... COMMIT;`.
- **Tidak menggunakan `inHelpdeskTransaction` atau advisory lock**: Hal ini menjaga throughput klaim paralel antar worker tanpa mengalami serialisasi global yang tidak perlu. Advisory lock transaksi hanya digunakan saat mutasi domain/identitas di `HelpdeskPersistence.process()` dan `receive()`.
- Jika job sebelumnya berstatus `in_progress` dengan lease kedaluwarsa:
  - Jika `attempt_count >= max_attempts`, job ditandai `'failed'` dan attempt lama ditutup sebagai `'terminal_failure'`.
  - Jika masih ada kuota attempt, attempt lama ditutup persisten sebagai `'lease_expired'`.
- Men-generate token `lease_token` baru (UUID string), memperbarui `processing_jobs` (`status = 'in_progress'`, `attempt_count = attempt_count + 1`, `lease_expires_at = now() + duration`), dan menyisipkan baris attempt baru pada `processing_job_attempts` (`outcome = 'in_progress'`).
- Seluruh I/O provider dan orkestrasi pemrosesan dieksekusi **di luar** transaksi claim ini.

### C. Fencing Waktu Validasi Lease Pasca Row Lock (`recordJobFailure`)
- Diterapkan perbaikan D95 & D96 yang membedakan:
  1. `failureTime`: Waktu saat kegagalan terjadi di application service. Digunakan untuk mengisi `completed_at` pada attempt dan menghitung jadwal retry `next_attempt_at`.
  2. `validationTime`: Waktu pemeriksaan kewenangan worker yang dievaluasi ulang **setelah** row lock `SELECT ... FOR UPDATE` berhasil diperoleh dari database.
- Urutan query:
  1. Query penguncian baris:
     `SELECT status, lease_token, lease_expires_at, attempt_count, max_attempts FROM public.processing_jobs WHERE ingress_id = $1 FOR UPDATE`.
  2. Query pembacaan timestamp terpisah (hanya dieksekusi setelah query penguncian baris selesai, menggunakan client dan transaksi yang sama):
     `SELECT clock_timestamp() AS lock_acquired_at`.
- Pemeriksaan kewenangan lease:
  - Waktu transaksi awal (`now()`) **tidak digunakan** karena tidak memperhitungkan durasi menunggu koneksi atau antrean lock.
  - `validationTime` menggunakan `clock_timestamp()` PostgreSQL hasil query terpisah (atau clock yang dapat dikendalikan dalam tes via `options.validationNow`).
  - Verifikasi: status masih `'in_progress'`, `lease_token` cocok, dan `lease_expires_at > validationTime`.
  - **Jika lease kedaluwarsa saat menunggu lock**: Transaksi segera di-commit dan mengembalikan `{ outcome: "lease_lost" }` **tanpa mengubah status baris `processing_jobs` maupun riwayat `processing_job_attempts`** (zero mutation snapshot).

### D. Fencing Transaksi Final (`HelpdeskPersistence.process`)
- Saat transaksi domain final dimulai, baris `processing_jobs` dikunci dengan `FOR UPDATE`.
- Jika `context.leaseToken` disertakan:
  - Diverifikasi bahwa `jobRow.lease_token === context.leaseToken` dan `jobRow.lease_expires_at > now()`.
  - Jika token tidak cocok atau lease telah habis, transaksi langsung di-rollback dan melempar `PersistenceError("lease_lost")`.
- Jika `context.leaseToken` tidak disertakan (direct call):
  - Jika status `'in_progress'` dan lease masih aktif, ditolak dengan `PersistenceError("job_leased_by_other_worker")`.
  - Jika status `'in_progress'` dan lease kedaluwarsa, ditolak dengan `PersistenceError("job_lease_expired")` (wajib recovery via claim).
- Saat transaksi sukses, status job dimutasi menjadi `'done'` dan attempt aktif dimutasi menjadi `'success'` secara atomik bersama entitas episode, assessment, dan audit log.

### E. Eksekusi Pasca-ACK via Next.js `after`
- Route handler `app/api/webhooks/telegram/route.ts` memanggil `handleTelegramWebhook()`.
- Hook `onAccepted` dipicu secara internal segera setelah `persistence.receive()` berhasil mengomit ingress dan pending job.
- Handler mengembalikan respons standar API Helpdesk:
  `{ success: true, data: { status: "accepted", ingressId, duplicate }, error: null }` (HTTP 200).
- Pendaftaran callback `after`:
  ```ts
  after(async () => {
    try {
      const pool = getHelpdeskPool();
      const client = getHelpdeskAdminClient();
      await drainProcessingJobs(pool, client);
    } catch (err) {
      console.error("Background job processing failed:", err);
    }
  });
  ```
- Runtime Next.js platform menunggu promise `after` hingga drain selesai sebelum membekukan container serverless.

---

## 5. Bukti Empiris & Hasil Pengujian

Pengujian dijalankan pada database Supabase nyata terisolasi (`Chat_Automation_Helpdesk_Test` pada port 54332/54331) dengan flag eksplisit `--env-file=.env.test` dan verifikasi marker ganda `requireIsolatedDatabase()`.

### A. Pengujian Integrasi Job Worker (`tests/integration/job-worker.test.ts`)

Menjalankan 1 suite induk dan 16 subtest terarah:

| # | Skenario Pengujian | Hasil Aktual & Assertion Kunci | Status |
|---|---|---|---|
| AC 1 | **Concurrency Protection**: Dua worker memanggil `claimJob()` paralel pada job yang sama | Tepat 1 worker memperoleh claim (`attemptNumber: 1`, `outcome: 'in_progress'`), worker kedua mengembalikan `null`. | **PASS** (57.6ms) |
| AC 2 | **Valid Lease Protection & Expired Recovery**: Worker mencoba klaim saat lease aktif vs setelah kedaluwarsa | Klaim saat lease aktif ditolak (`null`). Klaim setelah lease kedaluwarsa berhasil mereclaim dengan `attemptNumber: 2` dan token baru; attempt 1 ditandai persisten sebagai `'lease_expired'`. | **PASS** (59.9ms) |
| AC 3 | **Fenced Stale Worker Execution**: Worker lama yang bangun setelah lease direbut worker baru mencoba commit | `persistence.process()` menolak worker lama dengan `PersistenceError("lease_lost")`. Database memverifikasi 0 messages dan 0 assessments tersimpan oleh worker lama (rollback bersih). `recordJobFailure()` juga menolak worker lama (`"lease_lost"`). Worker baru menyelesaikan job (`done`, attempt 2 `'success'`). | **PASS** (1284.6ms) |
| AC 4 | **Fenced Unreclaimed Expired Lease (`recordJobFailure`)**: Late failure recording pada job yang lease-nya kedaluwarsa sebelum direclaim | Ditolak dengan outcome `"lease_lost"`, status job tetap `'in_progress'`, lease token tidak berubah, dan attempt history tetap konsisten. | **PASS** (755.6ms) |
| AC 5 | **Direct process() on Active Lease**: Pemanggilan langsung `process()` tanpa leaseToken pada job yang aktif di-lease | Ditolak dengan kode error `"job_leased_by_other_worker"`, mencegah tes internal mendahului worker aktif. | **PASS** (42.7ms) |
| AC 6 | **Direct process() on Expired Lease**: Pemanggilan langsung `process()` tanpa leaseToken pada job yang lease-nya kedaluwarsa | Ditolak dengan `"job_lease_expired"`, 0 messages, 0 assessments, status job tetap `'in_progress'`, dan attempt history tidak terkorupsi. Recovery via `claimJob()` sukses melanjutkan ke `'done'`. | **PASS** (718.8ms) |
| AC 7 | **Retry Scheduling & Terminal Failure**: Penjadwalan ulang kegagalan transient vs batas maksimum attempt | Attempt 1 gagal -> dijadwalkan ulang (+2s); Attempt 2 gagal -> dijadwalkan ulang (+4s); Attempt 3 gagal -> job deterministik beralih ke status terminal `'failed'` dan attempt 3 berstatus `'terminal_failure'` dengan error tersanitasi. | **PASS** (82.9ms) |
| AC 8 | **Deterministic Failure-Time Backoff**: Perhitungan backoff dari waktu kegagalan dicatat | Claim pada t0, failure pada t0+5s dengan base 2s menghasilkan `next_attempt_at = t0+7s` dan `completed_at = t0+5s`. Gating terbukti: klaim pada t0+6s menghasilkan `null`, klaim pada t0+7s berhasil. | **PASS** (56.8ms) |
| AC 9 | **Mid-Transaction Rollback**: Fault injection pada mutasi domain di dalam transaksi aktif worker | Transaksi di-rollback penuh (0 messages, 0 assessments tersimpan). Worker mencatat attempt sebagai `'retryable_failure'` dan job tetap eligible untuk retry berikutnya. | **PASS** (117.1ms) |
| AC 10 | **Webhook Post-ACK Scheduling & Drain**: Integrasi alur webhook handler dan worker drain eksplisit | Respons HTTP 200 `{ status: "accepted" }` dikembalikan saat pesan dan job pending committed; pemanggilan drain memproses hingga entitas lengkap tersimpan dan job `'done'`. Mode SHADOW menghasilkan 0 reply claims dan 0 outbound intents. | **PASS** (79.7ms) |
| AC 11 | **Drain Resilience Across Exhausted Jobs**: Drain memproses job A yang kehabisan attempt lalu job B yang eligible | Job A beralih ke `'failed'` (`'terminal_failure'`), dan drain tidak berhenti (*no early break*) melainkan melanjutkan ke Job B dan menyelesaikannya hingga `'done'` (`processedCount: 2, successCount: 1, failureCount: 1`). | **PASS** (108.0ms) |
| AC 12 | **Targeted Lease Validation Timing on Default Path (D96)**: Deteksi kedaluwarsa lease saat tertahan antrean row lock tanpa override validationNow | Menahan row lock pada client terpisah. Caller terbukti aktif menunggu di `pg_locks` (`waiting = true`). Setelah lease kedaluwarsa menurut PostgreSQL `clock_timestamp()`, lock dilepas. `recordJobFailure()` membaca timestamp pasca-lock via query terpisah, mendeteksi lease kedaluwarsa, dan mengembalikan outcome `"lease_lost"`. Snapshot job dan attempt tetap 100% identik tanpa mutasi. Recovery via claim baru berhasil mengklaim attempt 2 dan menyelesaikan job hingga `'done'`. | **PASS** (530.1ms) |
| AC 13 | **Telegram Route Controlled Integration (afterRunner harness) & Background Fault Injection (D96, D97)**: Pengujian alur rute webhook, penyelarasan identitas, dan kegagalan background terkontrol | (1) `TELEGRAM_BOT_ACCOUNT_ID` diselaraskan dengan akun fixture run (`acc_rt_<runId>`); (2) Ingress dan pending job committed sebelum HTTP response dikembalikan; (3) Assert eksplisit `ingress.identity_id === fixtureIdent.id` membuktikan tidak ada fallback ke akun bot default; (4) Respons HTTP 200 `{ success: true, data: { status: "accepted" } }` selesai tanpa menunggu worker (attempt = 0, assessments = 0); (5) Callback `after` mengeksekusi drain hingga job selesai (`done`, attempt `success`, assessment tersimpan); (6) Negative branches: Unauthorized (401), Malformed JSON (400), Unsupported update (200 ignored) tidak menjadwalkan worker; (7) Duplicate accepted menghasilkan HTTP 200 `duplicate: true` tanpa membuat job baru; (8) **Background Fault Injection**: Ingress event dan pending job committed sebelum ACK. Callback background dieksekusi dengan fault injection pada query `INSERT INTO public.triage_assessments`. ACK tetap sukses, ingress tidak hilang, attempt dicatat `'retryable_failure'` dengan error tersanitasi, `next_attempt_at` diundur, dan retry recovery pada attempt 2 sukses menjadi `'done'`. | **PASS** (277.8ms) |
| AC 14 | **Telegram Route Real Next.js Server, after() Lifecycle & Server Diagnostic Guard (D96, D97, D98, D99)**: Server HTTP Next.js lokal nyata pada port dedicated 3188 dengan pembatas diagnostik server dan validasi target koneksi runtime aktual | (1) Menjalankan server Next.js lokal nyata (`next({ dev: false }).prepare()`, `http.createServer`) pada port 3188; (2) `getHelpdeskAdminClient()` mendahulukan `SUPABASE_URL` / `HELPDESK_TEST_API_URL` atas `NEXT_PUBLIC_SUPABASE_URL`; (3) **Pembatas Diagnostik Server & Kesesuaian Target (D98, D99)** diverifikasi melalui 6 skenario HTTP over-the-wire: (a) *Nonaktif/Konfigurasi Normal*: header tes & secret valid tidak mengalihkan alur atau membocorkan metadata (empty body menghasilkan 400 struktur payload normal tanpa properti diagnostik); (b) *Secret Salah*: ditolak sebelum akses DB/API dengan envelope 401 `UNAUTHORIZED`; (c) *Konfigurasi Tes Inkomplit*: ketiadaan marker env menghasilkan 403 `TEST_CONFIG_INCOMPLETE` tanpa fallback; (d) *Target DB Mismatch*: konfigurasi tes DB diarahkan ke port 54339 ditolak pra-kueri dengan 403 `TEST_TARGET_MISMATCH`; (e) *Target API Mismatch*: konfigurasi tes API diarahkan ke port 54339 ditolak pra-kueri dengan 403 `TEST_TARGET_MISMATCH`; (f) *Lingkungan Tes Terverifikasi*: verifikasi target PG pool (`getHelpdeskPoolTarget`) dan API runtime (`getSupabaseClientTarget`) berhasil mengonfirmasi kesamaan marker (`verified: true`, `apiEndpoint: 'http://127.0.0.1:54331'`); (g) Flag diagnostik dimatikan kembali untuk eksekusi alur normal; (4) `TELEGRAM_BOT_ACCOUNT_ID` diselaraskan dengan `acc_srv_<runId>` dan ditegaskan ulang pasca-prepare; (5) Assert eksplisit `ingress.identity_id === fixtureIdent.id`; (6) Barrier setup via row lock `FOR UPDATE` pada active incident memblokir domain `process()` tanpa memblokir `receive()`; (7) Request HTTP POST nyata dari client menerima HTTP 200 accepted saat pemrosesan domain belum selesai (`triage_assessments = 0`); (8) Barrier di-commit/dilepas; runtime Next.js `after()` secara otomatis menyelesaikan background processing hingga job berstatus `'done'`, attempt `'success'`, dan assessment tersimpan tanpa pemanggilan runner manual; (9) Tidak terbentuk outbound otomatis (0 outbound); (10) Negative HTTP branches (401 unauthorized, 400 malformed, 200 ignored) dan duplicate idempotency terverifikasi pada level HTTP nyata. | **PASS** (540.2ms) |
| AC 14.1 | **Controlled Setup Failure Teardown: cleanupFixture & EnvRestorer run in finally when setup is aborted (D97, D98)**: Pembuktian eksekusi cleanup di blok finally saat inisialisasi setup dibatalkan | Simulasi pembatalan setup terkontrol saat inisialisasi (error dilempar setelah entitas fixture dibuat namun sebelum server `prepare()` / `listen()` dijalankan) membuktikan: (1) Blok `finally` mengeksekusi `cleanupFixture()` berbasis UUID identitas fixture yang sudah dibuat; (2) `EnvRestorer` memulihkan seluruh variabel lingkungan yang dimodifikasi (menghapus variabel yang awalnya tidak ada dengan `delete`, bukan `"undefined"`); (3) Database terbukti bersih dari entitas fixture yang dibuat di awal setup; (4) Lingkungan kembali ke baseline bersih tanpa memodifikasi atau meninggalkan status dangling. Pengujian dibatasi secara faktual pada pembersihan fixture dan pemulihan environment, tanpa klaim penutupan port atau proses server yang tidak pernah dibuka. | **PASS** (14.1ms) |
| AC 15 | **Comparator Baseline Preservation (D95, D97)**: Preservasi data pembanding terpisah saat eksekusi dan cleanup fixture | Dibuat fixture pembanding terpisah (non-eligible job `'done'` dengan `completed_at` non-null) dan disnapshot. Pemrosesan dan cleanup fixture utama hanya menghapus resource dalam run UUID utama. Snapshot data pembanding terbukti 100% identik sebelum dan sesudah cleanup utama (tanpa mengandalkan count = 0 tabel global). Pembanding dibersihkan secara terpisah berdasarkan UUID spesifiknya. | **PASS** (161.3ms) |
| AC 16 | **Controlled Failure Teardown (D95, D97)**: Penanganan error terkontrol pada lifecycle fixture dan pool | Fault injection terkontrol dalam blok `try/catch` membuktikan cleanup fixture di blok `finally` (berdasarkan UUID run spesifik) dan penutupan koneksi client pool tetap tuntas dieksekusi tanpa meninggalkan resource dangling. | **PASS** (30.5ms) |

**Total Integrasi Job Worker**: 18 passed (1 suite induk + 17 subtest), 0 failed (durasi ~4.9s, exit code 0).  
Perintah: `node --import ./tests/utils/setup-node-env.ts --env-file=.env.test --conditions=react-server --test .test-build/tests/integration/job-worker.test.js`.

---

### B. Pengujian Unit Domain & Validasi Target Diagnostik

1. **Job Worker Unit Tests (`tests/domain/job-worker.test.ts`)**:
   - `sanitizeErrorMessage`: Membuang connection string database (`postgres://user:pass@host/db`), password, token JWT (`Bearer eyJ...`), dan memotong pesan error melebihi 2000 karakter.
   - `sanitizeErrorMessage truncates excessively long messages`: Memotong pesan panjang menjadi tepat 2000 karakter + penanda `... [truncated]`.
   - `isRetryableError`: Membedakan secara presisi error retryable (koneksi timeout, deadlock, 503) dari permanent error (syntax error, unique constraint violation, lease lost, job lease expired).
   - `computeBackoffMs`: Memvalidasi perhitungan eksponensial `base * 2^(attempt - 1)` dan pembatasan batas atas backoff.
   - `handleTelegramWebhook`: Memvalidasi hook `onAccepted` hanya dipanggil pada hasil `accepted` (baru maupun duplikat), dan tidak dipanggil pada `unauthorized`, `malformed`, atau `rejected`.

2. **Diagnostic Target Validator & Negative Proof (`tests/application/diagnostic-target-validator.test.ts`)**:
   - *Target PostgreSQL runtime mismatch*: Ditolak sebelum kueri dengan HTTP 403 `TEST_TARGET_MISMATCH`; counter spy membuktikan tepat 0 kueri PostgreSQL dan 0 request API dijalankan.
   - *Endpoint API runtime mismatch*: Ditolak sebelum kueri dengan HTTP 403 `TEST_TARGET_MISMATCH`; counter spy membuktikan 0 kueri PG dan 0 request API.
   - *Stored Pool Target Evaluation*: Pool yang telah dibuat tetap dinilai berdasarkan opsi koneksi efektifnya (`opts.connectionString` / `opts.host`) meskipun variabel lingkungan runtime dimutasi; ditolak dengan 403 `TEST_TARGET_MISMATCH`, 0 kueri dijalankan.
   - *Pemeriksaan Port DB Independen*: Port 5432 loopback ditolak dengan 403 `TEST_TARGET_INVALID` meskipun endpoint API menggunakan host remote `https://api.upaznet.test`.
   - *Pemeriksaan Port API Independen*: Port 54321 loopback ditolak dengan 403 `TEST_TARGET_INVALID` meskipun endpoint DB menggunakan host remote `remote-db.upaznet.test`.
   - *Normalisasi IPv6*: Hostname loopback IPv6 (`[::1]`) dengan port 5432 ditolak dengan 403 `TEST_TARGET_INVALID`.
   - *Target PostgreSQL query parameter port override (`?port=5432`) (D100)*: Terdeteksi via konfigurasi driver `pg.Client` dan ditolak sebelum kueri dengan HTTP 403 `TEST_TARGET_INVALID`/`TEST_TARGET_MISMATCH`; counter spy membuktikan tepat 0 kueri PG dan 0 request API.
   - *Target PostgreSQL query parameter host override (`?host=evil.com`) (D100)*: Terdeteksi via konfigurasi driver `pg.Client` dan ditolak sebelum kueri dengan HTTP 403 `TEST_TARGET_MISMATCH`; counter spy membuktikan 0 kueri PG dan 0 request API.
   - *Target PostgreSQL query parameter port mismatch (`?port=54339`) (D100)*: Terdeteksi via konfigurasi driver `pg.Client` dan ditolak sebelum kueri dengan HTTP 403 `TEST_TARGET_MISMATCH`; counter spy membuktikan 0 kueri PG dan 0 request API.
   - *Route boundary: Secret salah dengan konfigurasi runtime inkomplit (D100)*: Ditolak dengan HTTP 401 `UNAUTHORIZED`; counter spy membuktikan factory pool dan client API tidak dipanggil sama sekali.
   - *Route boundary: Secret berkarakter sama tetapi panjang byte UTF-8 berbeda (D100)*: Input multi-byte (`secret12\u00E9` vs `secret123`) aman ditolak dengan HTTP 401 tanpa melempar exception `RangeError` dari `timingSafeEqual`.
   - *Route boundary: Kegagalan factory terkontrol pasca-autentikasi (D100)*: Secret valid dengan factory yang gagal menghasilkan HTTP 500 `INITIALIZATION_FAILED` ber-envelope standar tanpa membocorkan credential, connection string, atau error mentah.
   - *Route boundary: Jalur diagnostik sah terintegrasi (D100)*: Menghasilkan HTTP 200 `{ success: true, data: { verified: true } }` dengan envelope standar.
   - *Marker Tidak Ditemukan*: Ditolak dengan HTTP 403 `TEST_MARKER_NOT_FOUND` dengan `data: null` tanpa membocorkan endpoint atau metadata marker.
   - *Marker Token Mismatch*: Token PostgreSQL dan API yang berbeda ditolak dengan HTTP 403 `TEST_MARKER_MISMATCH` dengan `data: null`.
   - *Target & Marker Cocok*: Berhasil mengembalikan HTTP 200 `{ success: true, data: { verified: true, apiEndpoint, dbMarker, apiMarker }, error: null }`.
   - *Autentikasi Salah*: Ditolak dengan HTTP 401 `UNAUTHORIZED`, 0 kueri dijalankan.
   - *Tanpa Fallback*: Variabel runtime utama (`HELPDESK_DATABASE_URL`, `SUPABASE_URL`) tidak dijadikan fallback; ketiadaan `HELPDESK_TEST_*` ditolak dengan 403 `TEST_CONFIG_INCOMPLETE`, 0 kueri dijalankan.

**Total Pengujian Unit Proyek**: **170 passed**, 0 failed (durasi ~350ms, exit code 0).  
Perintah: `npm run test:unit`.

---

### C. Regresi Suite Menyeluruh

| Suite Pengujian | Target File / Perintah | Hasil Aktual |
|---|---|---|
| Domain & Application Unit Tests | `npm run test:unit` | **170 passed**, 0 failed (exit code 0) |
| Webhook Integration | `tests/integration/telegram-webhook.test.ts` | **11 passed**, 0 failed (exit code 0) |
| Persistence Integration | `tests/integration/persistence.test.ts` | **12 passed**, 0 failed (exit code 0) |
| Conversation Integration | `tests/integration/conversation.test.ts` | **18 passed**, 0 failed (exit code 0) |
| Orchestration Integration | `tests/integration/orchestration.test.ts` | **11 passed**, 0 failed (exit code 0) |
| Job Worker Integration | `tests/integration/job-worker.test.ts` | **18 passed**, 0 failed (exit code 0) |
| TypeScript Compiler | `npx tsc --noEmit` | **0 errors** (exit code 0) |
| Test TypeScript Compiler | `npx tsc -p tsconfig.test.json` | **0 errors** (exit code 0) |
| Linter | `npm run lint` | **0 errors**, 194 warnings historis (exit code 0) |
| Next.js Build | `npm run build` | **Compiled successfully** (Next.js 16.3.5 Turbopack, 7 rute siap, exit code 0) |

---

## 6. Catatan Faktual atas Eksekusi Perintah Penghapusan Ad-Hoc Historis

Berdasarkan rekonsiliasi faktual langsung terhadap sumber log yang disediakan pengguna:

### A. Log Awal P2.5 (`C:\Users\INVANSION\.codex\attachments\a59ffdda-3d83-466d-a2b8-29d72625326f\Pasted text.txt`, baris 215–218)
1. **Target Konfigurasi Database**:
   - *Konfigurasi Target Tertulis*: `process.env.HELPDESK_TEST_DATABASE_URL` yang didefinisikan pada `.env.test` sebagai `postgresql://postgres:postgres@127.0.0.1:54332/postgres`.
   - *Target Aktual Terverifikasi*: Berbeda dari konfigurasi tertulis; target koneksi aktual saat perintah ad-hoc tersebut dijalankan tidak dapat diverifikasi secara independen dari log lampiran semata.
2. **Perintah SQL Ad-Hoc Tercatat**:
   - Percobaan 1: `DELETE FROM public.messages`, `complaints`, `processing_job_attempts`, `processing_jobs`, `ingress_events`, serta `channel_identities WHERE channel_account_id LIKE 'acc_%'`. (Tercatat dalam konteks kegagalan akibat foreign key constraint tabel anak `triage_assessments`).
   - Percobaan 2: Menambahkan `DELETE FROM public.triage_assessments` di awal. (Tercatat dalam konteks kegagalan akibat foreign key constraint pada `complaint_evidence_links` dan `reply_claims`).
   - Percobaan 3: Menambahkan `DELETE FROM` pada `complaint_evidence_links`, `reply_claims`, `complaint_audit_log`, `triage_assessments`, `outbound_intents`, `messages`, `reply_owners WHERE channel_identities_id IS NULL OR true`. (Tercatat dalam konteks kegagalan karena kolom bernama `identity_id`, bukan `channel_identities_id`).
   - Percobaan 4: Memperbaiki kueri menjadi:
     `DELETE FROM public.complaint_evidence_links;`
     `DELETE FROM public.reply_claims;`
     `DELETE FROM public.complaint_audit_log;`
     `DELETE FROM public.triage_assessments;`
     `DELETE FROM public.outbound_intents;`
     `DELETE FROM public.messages;`
     `DELETE FROM public.reply_owners WHERE identity_id IS NOT NULL;`
     `DELETE FROM public.complaints;`
     `DELETE FROM public.conversations;`
     `DELETE FROM public.processing_job_attempts;`
     `DELETE FROM public.processing_jobs;`
     `DELETE FROM public.ingress_events;`
     `DELETE FROM public.channel_identities WHERE channel_account_id LIKE 'acc_%';`
3. **Status Eksekusi dan Dampak**:
   - String `console.log('Cleaned test records successfully')` merupakan bagian dari teks skrip `node -e` yang dijalankan, bukan bukti bahwa pesan tersebut benar-benar tercetak pada stdout terminal.
   - Karena lampiran log hanya memuat baris perintah tanpa mencatat rekaman stdout, stderr, atau exit code aktual, statusnya dicatat secara faktual: **perintah tercatat; status eksekusi belum terverifikasi**.
   - **Keterbatasan Bukti**: Jumlah baris (*row count*) yang terhapus dan dampak aktual terhadap data historis pada saat itu tidak dapat dibuktikan dan tetap **tidak diketahui (unknown)**. Tidak ada kesimpulan bahwa dampaknya nol atau bahwa data historis pasti aman.

### B. Log Koreksi Terbaru (`C:\Users\INVANSION\.codex\attachments\1d989963-4735-4274-9d32-0c0a28afccbc\Pasted text.txt`)
1. **Target Konfigurasi Database**:
   - *Konfigurasi Target Tertulis*: String koneksi tertulis `postgresql://postgres:postgres@127.0.0.1:54332/postgres`.
   - *Target Aktual Terverifikasi*: Berbeda dari konfigurasi tertulis; target koneksi aktual saat eksekusi berlangsung tidak dapat dibuktikan dari teks lampiran semata.
2. **Perintah SQL Ad-Hoc Tercatat**:
   - Pembersihan barrier incident: `DELETE FROM public.incidents WHERE id = $1` dengan ID parameterized `'00000000-0000-0000-0000-000000000099'`.
   - Pembersihan entitas uji server Next.js melalui `node -e` dan skrip `clean.js`:
     `DELETE FROM public.complaint_audit_log WHERE message_id = 'e128679a-024c-4a12-8d29-286d89968f78';`
     `DELETE FROM public.triage_assessments WHERE message_id = 'e128679a-024c-4a12-8d29-286d89968f78';`
     `DELETE FROM public.messages WHERE id = 'e128679a-024c-4a12-8d29-286d89968f78';`
     `DELETE FROM public.processing_job_attempts WHERE ingress_id = 'e128679a-024c-4a12-8d29-286d89968f78';`
     `DELETE FROM public.processing_jobs WHERE ingress_id = 'e128679a-024c-4a12-8d29-286d89968f78';`
     `DELETE FROM public.ingress_events WHERE id = 'e128679a-024c-4a12-8d29-286d89968f78';`
     Serta penghapusan channel identities dengan:
     Variasi 1: `DELETE FROM public.channel_identities WHERE channel_account_id LIKE 'acc_srv_%';`
     Variasi 2 / `clean.js`: `DELETE FROM public.channel_identities WHERE sender_external_id = '99988812';`
3. **Status Eksekusi dan Dampak**:
   - String `console.log("Cleaned")` dan `console.log("Cleaned up successfully")` merupakan bagian dari teks skrip perintah yang diajukan, bukan rekaman stdout/exit code yang tersimpan pada lampiran log.
   - Karena lampiran log tidak menyediakan output stdout, stderr, atau exit code aktual untuk perintah-perintah tersebut, statusnya dicatat secara jujur: **perintah tercatat; status eksekusi belum terverifikasi**.
   - **Keterbatasan Bukti**: Jumlah baris aktual yang terhapus dan dampaknya pada lingkungan saat itu tidak tercatat dan tetap **tidak diketahui (unknown)**. Tidak ada klaim nol dampak atau rekonstruksi mutasi historis.

### C. Rekonsiliasi Pernyataan Dokumentasi
1. Mengoreksi kekeliruan ulasan sebelumnya yang menyitir baris kode tes P2.4 lama (`tests/integration/orchestration.test.ts` dan `tests/integration/persistence.test.ts`) sebagai riwayat perintah ad-hoc P2.5. Riwayat faktual perintah ad-hoc P2.5 adalah perintah `node -e` yang tercatat pada Bagian A dan B di atas.
2. Tidak ada akses ke database pengguna untuk keperluan audit ini, tidak ada perintah penghapusan yang dijalankan ulang, dan tidak ada rekayasa klaim bahwa data historis lama selamat tanpa bukti. Keterbatasan bukti ditutup sebagai catatan *unknown* yang jujur.
3. Seluruh cleanup pada test suite saat ini (`tests/integration/job-worker.test.ts`) dibuktikan beroperasi murni berbasis UUID (`tracker.identityIds`, `tracker.ingressIds`, dll.), didukung bukti AC 15 (Comparator Baseline Preservation) yang menunjukkan snapshot data pembanding non-run tetap 100% utuh sebelum dan sesudah eksekusi fixture.

---

## 7. Berkas yang Dibuat dan Diubah

### Berkas Dibuat / Diperbarui pada P2.5
1. `supabase/migrations/20261002100000_create_job_leases_and_attempts.sql`: Migrasi schema kolom lease, attempt, dan tabel `processing_job_attempts`.
2. `tests/test-env/supabase/migrations/20261002100000_create_job_leases_and_attempts.sql`: Salinan migrasi untuk lingkungan tes lokal.
3. `lib/application/job-worker-contracts.ts`: Definisi antarmuka, konstanta default (D93, D94, D95, D96), custom error (`LeaseLostError`, `JobLeasedByOtherWorkerError`, `JobLeaseExpiredError`), dan opsi evaluasi waktu (`validationNow`).
4. `lib/application/job-worker-service.ts`: Implementasi `claimJob()`, `claimNextJob()`, `recordJobFailure()` dengan pemisahan query row lock vs pembacaan timestamp terpisah pasca-lock (`SELECT clock_timestamp() AS lock_acquired_at`), `processJobWithWorker()`, `drainProcessingJobs()`, dan `sanitizeErrorMessage()`.
5. `lib/supabase/server.ts`: Pembaruan `getHelpdeskAdminClient()` dengan presedensi variabel server eksplisit `SUPABASE_URL` / `HELPDESK_TEST_API_URL` atas `NEXT_PUBLIC_SUPABASE_URL` untuk mencegah build-time constant inlining oleh Turbopack/Next.js; penambahan `getSupabaseClientTarget()` dan interface `SupabaseClientTarget` (D99).
6. `lib/postgres/server.ts`: Helper `closeHelpdeskPool()` untuk teardown koneksi pool; penambahan `getHelpdeskPoolTarget()`, `normalizeHostname()`, `isLoopbackHost()`, dan interface `HelpdeskPoolTarget` untuk inspeksi target opsi koneksi pool tersimpan tanpa sekadar membaca ulang environment (D99).
7. `lib/application/diagnostic-target-validator.ts`: Helper server validasi target runtime diagnostik (`validateDiagnosticTargets`), eksekusi kueri marker tertutup (`executeDiagnosticMarkerCheck`), dan handler terintegrasi (`handleDiagnosticRuntimeCheck`) dengan penolakan pra-kueri tanpa fallback (D99).
8. `app/api/webhooks/telegram/route.ts`: Penambahan pembatas diagnostik server eksplisit (`ENABLE_TEST_RUNTIME_DIAGNOSTICS === "true"`, D98) yang nonaktif secara default; integrasi `handleDiagnosticRuntimeCheck` untuk memvalidasi kesesuaian target koneksi runtime aktual sebelum kueri dijalankan (D99).
9. `tests/utils/setup-node-env.ts`: Inisialisasi type-safe `AsyncLocalStorage` global untuk Next.js server runtime harness.
10. `tests/domain/job-worker.test.ts`: 5 unit tests pemrosesan worker.
11. `tests/application/diagnostic-target-validator.test.ts`: 18 unit tests validasi target dan bukti negatif dengan counter spy (0 kueri dijalankan saat target mismatch atau auth salah), resolusi parameter query driver pg (`?port=...`, `?host=...`), urutan autentikasi pra-factory, perbandingan byte UTF-8 (`Buffer.byteLength`), kegagalan factory terkontrol, independensi loopback/port, IPv6, dan marker tertutup (D99, D100).
12. `tests/integration/job-worker.test.ts`: 1 suite induk + 17 subtest integrasi (total 18 passed) mencakup database nyata, server HTTP Next.js lokal pada port 3188, pembatas diagnostik server & kesesuaian target runtime (6 skenario HTTP over-the-wire), barrier incident, default-path lease expiration via `pg_locks`, fault injection, setup failure teardown (terbatas pada cleanup fixture dan env saat setup dibatalkan), dan comparator preservation.
13. `docs/decision-log.md`: Penambahan entri keputusan **D93**, **D94**, **D95**, **D96**, **D97**, **D98**, **D99**, dan **D100**.
14. `docs/TRACKER.md`: Pembaruan status dan pelaporan detail P2.5.
15. `docs/P2_5_REVIEW.md`: Dokumen laporan review dan verifikasi P2.5 komprehensif ini.

---

## 8. Batas Operasional Prototype & Rekomendasi Penutupan

1. **Batas Scheduler Always-On**: Pada fase prototype serverless ini, eksekusi worker dipicu secara reaktif oleh siklus webhook inbound pasca-ACK via Next.js `after` dan pemanggilan `drainProcessingJobs()` internal. Tidak ada scheduler daemon/cron eksternal permanen yang berjalan terus-menerus. Jika terjadi crash fatal sebelum worker menyelesaikan pekerjaan dan tidak ada pesan inbound baru yang masuk, job yang tertunda akan tetap menunggu hingga pemicu inbound berikutnya atau pemanggilan drain manual.
2. **Ketiadaan UI/Dashboard Worker**: Fungsi drain dan perbaikan job saat ini beroperasi pada level application service backend. Visualisasi status job, indikator antrean, dan pemicu recovery manual oleh staf di dashboard merupakan scope [P2.6](#task-p2-6) dan [P3.8].
3. **Outbound Tetap Terisolasi**: Sesuai batasan mode SHADOW dan PRD §11, tidak ada pesan outbound yang dikirimkan ke pengguna eksternal pada tahap ini.

Seluruh Acceptance Criteria P2.5 beserta seluruh koreksi (D94, D95, D96, D97, D98, D99, D100) telah terpenuhi dan terbukti secara empiris dengan 18 passed integrasi (1 suite induk + 17 subtest), 170 unit test passed (termasuk 18 unit test validator target dengan spy dan route boundary), lint passed 0 error, dan Next.js production build compiled successfully.

Status P2.5: **Selesai (DONE)**. Pipeline siap dilanjutkan ke **P2.6** (Inbox/antrean sebagai landing dashboard).

