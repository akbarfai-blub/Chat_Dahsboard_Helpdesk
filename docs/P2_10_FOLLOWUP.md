# Catatan checkpoint dan tindak lanjut P2.10

Tanggal catatan: 13 Oktober 2026 (Asia/Jakarta).

Catatan ini merangkum review lanjutan setelah laporan persiapan P2.10. Ini bukan bukti deployment atau hasil pengujian baru. Klaim kesiapan tooling dalam `P2_10_REVIEW.md`, `DEPLOYMENT.md`, dan D143 perlu dibaca bersama temuan di bawah sampai dokumentasinya diselaraskan pada pekerjaan perbaikan.

## Status yang dibawa ke sesi berikutnya

- P2.7 dan P2.8: **Done**, berdasarkan penerimaan dan bukti sebelumnya. Jangan membuka ulang tanpa perubahan atau bukti masalah baru.
- P2.9: tetap **Done** sesuai tracker.
- P2.10: **In Progress**. Persiapan lokal tersedia, tetapi ada enam temuan tooling yang belum diperbaiki, target remote belum dihubungkan, dan deployment serta smoke test remote belum terverifikasi.
- P2.11: **Not Started**, menunggu P2.10.

Branch checkpoint menyimpan kemajuan pekerjaan; keberadaan commit/push bukan penerimaan P2.10, izin menjalankan script yang bermasalah ke database remote, atau bukti deployment.

## Status Resolusi Enam Temuan Tooling Deployment (D144)

Keenam temuan tooling telah diperbaiki secara tuntas dan diverifikasi dengan 29 assertion passing pada suite `tests/tooling/deployment-tooling.test.mjs` di database terisolasi:

| Prioritas | Temuan | Status | Perbaikan dan Bukti Verifikasi |
|---|---|---|---|
| P1 | Smoke test dapat PASS tanpa pemeriksaan wajib | **Teratasi (PASS)** | `scripts/smoke-test-deployment.mjs`: Menghilangkan stub `pass: true`. Mewajibkan login/inbox/logout staf via `@supabase/ssr`, bounded polling job worker, kueri skema presisi, dan zero mutation DB riil. Ketiadaan kredensial atau DB memicu FAIL eksplisit. Terbukti pada Suite 5 (`tests/tooling/deployment-tooling.test.mjs`: 5.1, 5.2, 5.5). |
| P1 | Validasi TLS remote lebih lemah daripada runtime aplikasi | **Teratasi (PASS)** | `parseAndValidateDbConfig` diterapkan pada seluruh script (`apply-prototype-migrations.mjs`, `apply-prototype-seed.mjs`, `smoke-test-deployment.mjs`). Mewajibkan `sslmode=verify-full` untuk remote host, menghapus fallback `rejectUnauthorized: false`, dan menolak `sslmode=disable`. Terbukti pada Suite 1 (1.1–1.7). |
| P2 | Kueri smoke test menggunakan kolom yang tidak ada | **Teratasi (PASS)** | Kueri DB diselaraskan 100% dengan skema aktual pada `ingress_events`, `processing_jobs`, `messages`, `triage_assessments`, `outbound_intents`, dan `reply_claims`. Terbukti pada Suite 5 (5.4). |
| P2 | Schema dan pencatatan versi migration belum satu transaksi | **Teratasi (PASS)** | `stripOuterTransactionWrapper` membersihkan outer `BEGIN/COMMIT`. DDL skema dan insert ke `schema_migrations` dijalankan dalam 1 transaksi PostgreSQL atomik tunggal. Injeksi error sebelum commit membuktikan rollback serentak DDL dan version record. Terbukti pada Suite 2 (2.1–2.4). |
| P2 | Penolakan Telegram tidak menghasilkan exit gagal | **Teratasi (PASS)** | `scripts/manage-telegram-webhook.mjs`: Menangani `ok: false`, status HTTP non-200, timeout, dan network error dengan exit 1 tanpa leak token. Memvalidasi kesesuaian URL via `getWebhookInfo` pasca-set/restore. Terbukti pada Suite 3 (3.1–3.4). |
| P2 | SHADOW belum diwajibkan sebelum memasukkan pesan uji | **Teratasi (PASS)** | `scripts/apply-prototype-seed.mjs` memvalidasi mode SHADOW aktual (`requireShadow: true`). `smoke-test-deployment.mjs` menambahkan Pre-Ingestion Guard yang memblokir injeksi payload uji jika mode bukan `SHADOW` atau `emergency_stop` aktif. Terbukti pada Suite 4 (4.1–4.4). |

## Status Resolusi Temuan Review Lanjutan (D145 & D146)

Temuan review lanjutan dari evaluasi tooling deployment telah diselesaikan dan diverifikasi penuh:

| Prioritas | Temuan | Status | Perbaikan dan Bukti Verifikasi |
|---|---|---|---|
| P1 | Logout gagal tidak boleh menghasilkan PASS | **Teratasi (PASS)** | `scripts/smoke-test-deployment.mjs`: Memeriksa `{ error: signOutError }` dari `staffClient.auth.signOut()`. Jika terjadi error, `signOutSuccess = false`, error dicatat ke logger, dan `staffAuth.pass` serta `allPassed` bernilai `false`, meskipun cookie lokal terhapus dan request berikutnya tertolak. Terbukti pada Subtest 5.8. |
| P1 | Proteksi dashboard harus memverifikasi tujuan redirect | **Teratasi (PASS)** | Menambahkan `isValidLoginRedirect(status, locationHeader, baseUrl)`. Mewajibkan status 307 atau 302, origin cocok dengan baseUrl, dan pathname strictly `/login`. Menolak respons 200 dengan Location, serta menolak redirect ke `/dashboard`, `/maintenance`, `/login-malicious`, atau off-origin. Diterapkan pada Check 2 dan Check 5. Terbukti pada Subtests 5.6, 5.7, 5.9. |
| P1 | Pengerasan pemeriksaan origin redirect (D146) | **Teratasi (PASS)** | Memperbaiki `isValidLoginRedirect` agar mem-parse URL dengan target URL sebagai base dan selalu membandingkan `parsed.origin === parsedBase.origin` tanpa kondisi awalan teks `http://`/`https://`. Menolak protocol-relative off-origin (`//other.example/login`) dan skema uppercase off-origin (`HTTPS://other.example/login`) secara presisi. Terbukti pada Subtest 5.6. |
| P2 | Pulihkan histori tabel D143 secara persis | **Teratasi (PASS)** | Tabel keputusan D143 dipulihkan persis dari commit baseline `2e1321b` di `docs/decision-log.md`. Riwayat D144 dan seluruh keputusan lainnya dipertahankan. D145 dan D146 ditambahkan secara append-only. Diverifikasi via diff dan format log. |
| P2 | Selaraskan petunjuk environment dengan runner | **Teratasi (PASS)** | `docs/DEPLOYMENT.md` diperbarui agar selaras dengan kontrak runner: merinci argumen CLI (`argv[2]` target URL, `argv[3]` DB URL), variabel process environment (`DEPLOYMENT_URL`, `TELEGRAM_TESTER_ALLOWLIST`), variabel yang dibaca dari `.env.local`, prioritas, dan default. Dijelaskan eksplisit bahwa target URL sengaja tidak dibaca dari `.env.local` untuk mencegah salah target ke localhost. |

## Status Resolusi Pengujian Transport/CLI Telegram Lokal Terkontrol (D147)

Kekurangan bukti pengujian transport dan CLI Telegram telah diselesaikan dan diverifikasi penuh pada suite `tests/tooling/deployment-tooling.test.mjs` menggunakan HTTP loopback fixture dan subprocess CLI terisolasi (5 subtest baru, 3.5–3.9):

| Prioritas | Skenario | Status | Perbaikan dan Bukti Verifikasi |
|---|---|---|---|
| P1 | HTTP non-200 (termasuk body `ok: true`) | **Teratasi (PASS)** | Loopback fixture mengirim HTTP 500 dengan `{"ok": true, "result": "misleading"}`. `telegramApiRequest` terbukti memeriksa status HTTP dan menolak dengan error `[500] HTTP 500`. Terbukti pada Subtest 3.5. |
| P1 | JSON rusak pada HTTP 200 | **Teratasi (PASS)** | Loopback fixture mengirim respons HTML pada HTTP 200. Terbukti menghasilkan rejection terkontrol `Failed to parse Telegram API response (HTTP 200)` tanpa menggantung. Terbukti pada Subtest 3.6. |
| P1 | Transport timeout | **Teratasi (PASS)** | Loopback fixture menahan respons tanpa mengirim data. Request dengan timeout 150ms terbukti menghentikan request (`req.destroy()`) dan reject dalam batas waktu (< 2s, aktual ~158ms). Terbukti pada Subtest 3.7. |
| P1 | Exit code CLI nonzero pada kegagalan | **Teratasi (PASS)** | Subprocess CLI terisolasi (`cwd: os.tmpdir()`, tanpa `.env.local`) terbukti menghasilkan exit code 1 pada HTTP 500, JSON rusak, dan timeout, tanpa mencetak pesan sukses palsu di stdout. Terbukti pada Subtest 3.8. |
| P1 | Pembanding sukses CLI exit 0 & verifikasi URL | **Teratasi (PASS)** | Subprocess CLI terisolasi menjalankan `status` dan `set`; terbukti menghasilkan exit code 0, verifikasi post-konfigurasi `getWebhookInfo` cocok dengan URL target, dan payload `setWebhook` menegakkan `drop_pending_updates: false`. Terbukti pada Subtest 3.9. |

## Status Resolusi Validasi Endpoint Telegram API (D148)

Titik injeksi pengujian yang diperkenalkan pada D147 telah diamankan secara ketat dengan validasi endpoint presisi sebelum request dibuat (*pre-flight validation*), terbukti pada suite `tests/tooling/deployment-tooling.test.mjs` (4 subtest baru, 3.10–3.13):

| Prioritas | Skenario | Status | Perbaikan dan Bukti Verifikasi |
|---|---|---|---|
| P1 | Validasi URL presisi & larangan HTTP nonlokal | **Teratasi (PASS)** | `validateTelegramApiBaseUrl`: default `https://api.telegram.org`, HTTP hanya untuk loopback (`localhost`, `127.0.0.1`, `::1`), host nonlokal wajib HTTPS. Menolak pencocokan substring/prefix (`localhost.attacker.com`), kredensial dalam URL, dan protokol selain HTTP/HTTPS. Terbukti pada Subtest 3.10 (13 variasi URL). |
| P1 | Rejeksi pre-flight zero-transport | **Teratasi (PASS)** | `telegramApiRequest` memvalidasi URL sebelum inisialisasi request. Menolak URL invalid/insecure dengan nol pemanggilan transport jaringan (`httpCalls === 0`, `httpsCalls === 0`). Terbukti pada Subtest 3.11. |
| P1 | Validasi konfigurasi HTTPS nonlokal aman | **Teratasi (PASS)** | Host nonlokal dengan HTTPS lolos validasi konfigurasi dan mencapai transport client dengan `rejectUnauthorized: undefined` (verifikasi TLS bawaan aktif) tanpa request eksternal via spy https. Terbukti pada Subtest 3.12. |
| P1 | Penolakan endpoint tidak aman pada CLI | **Teratasi (PASS)** | Subprocess CLI terisolasi keluar dengan exit code 1 dan pesan validasi presisi (bukan timeout, network error, atau token error) saat disuntikkan `TELEGRAM_API_BASE_URL` HTTP nonlokal, ftp, atau hostname loopback palsu. Terbukti pada Subtest 3.13. |

## Status Resolusi Pengerasan Guard Pipeline & Assertion Wajib Verifikasi Skema (D150)

Perbaikan terarah pada pipeline dan verifier database telah selesai dan diverifikasi dengan 37 checks passing pada suite `tests/tooling/pipeline-tooling.test.mjs` di lingkungan lokal terisolasi, serta diverifikasi secara read-only pada database Supabase Cloud remote:

| Prioritas | Bidang | Status | Perbaikan dan Bukti Verifikasi |
|---|---|---|---|
| P1 | Pengerasan guard pra-mutasi target & state | **Teratasi (PASS)** | `scripts/apply-prototype-pipeline.mjs`: `validatePipelineTarget` memvalidasi host, port, username eksak (`postgres.saysxjdyalnbhxqqmytp` tanpa substring matching), database, sslmode=verify-full, dan NETWORK_PROVIDER=mock. `evaluatePreCheckGuard` menghentikan proses sebelum runner migrasi atau seeder dipanggil jika mode existing bukan SHADOW, emergency stop aktif, atau ledger tidak konsisten (tabel ada tanpa ledger atau versi migrasi tidak dikenal). Terbukti pada Suite 1 & 2 (`tests/tooling/pipeline-tooling.test.mjs`, 15 checks, pemanggilan runner migrasi dan seed terbukti tepat 0). |
| P1 | Verifikasi assertion wajib skema & fixture | **Teratasi (PASS)** | `runDirectedVerification`: Membandingkan ledger dengan 13 migration resmi (0 missing, 0 unknown); memverifikasi 22 tabel inti di schema `public`; memverifikasi fixture spesifik UUID/kode (1 ODC, 2 ODP, 12 pelanggan, 12 layanan, 12 topologi, 5 identitas); memverifikasi tester Telegram `6727338166` terhubung ke pelanggan 0001 dan berstatus `verified`; memverifikasi 16 skenario mock network, 180 observasi ONU, 16 observasi upstream, dan mewajibkan observasi stale bernilai true tanpa manipulasi timestamp; memverifikasi mode SHADOW dan emergency_stop=false. Terbukti pada Suite 3 (15 checks). |
| P1 | Verifikasi mandiri read-only tanpa mutasi | **Teratasi (PASS)** | `scripts/verify-prototype-schema.mjs`: Menjalankan verifikasi skema dan fixture terarah di dalam transaksi `BEGIN READ ONLY` dengan timeout 10 detik dan TLSv1.3 (`NODE_EXTRA_CA_CERTS=certs/prod-ca-2021.crt`). Menjamin 0 mutasi database dan pemetaan kegagalan/kelulusan ke exit code 1/0. Terbukti pada Suite 4 (3 checks) dan eksekusi remote aktual. |
| P1 | Verifikasi read-only remote Supabase Cloud | **Teratasi (PASS)** | Dijalankan langsung ke database Supabase Cloud (`saysxjdyalnbhxqqmytp`) via Session pooler port 5432: seluruh assertion lulus (13/13 migrasi, 22 tabel inti, seluruh fixture pelanggan/topologi/identitas/tester/network/stale/automation_settings cocok persis, pesan "ALL READ-ONLY ASSERTIONS PASSED", exit code 0, 0 mutasi). |

## Status Resolusi Isolasi Subprocess CLI, Keanggotaan Pasangan Fixture Jaringan & Penyelarasan Fakta Resmi (D151)

Penyempurnaan pengujian tooling CLI, pengerasan assertion observasi jaringan, dan rekonsiliasi data faktual telah selesai dan diverifikasi dengan 49 checks passing pada suite `tests/tooling/pipeline-tooling.test.mjs`, serta diverifikasi secara read-only pada database Supabase Cloud remote:

| Prioritas | Bidang | Status | Perbaikan dan Bukti Verifikasi |
|---|---|---|---|
| P1 | Isolasi subprocess CLI & seam client lokal | **Teratasi (PASS)** | `scripts/verify-prototype-schema.mjs` dan `scripts/apply-prototype-pipeline.mjs` mendukung konfigurasi dummy via `process.env.PROTOTYPE_ENV_FILE` dan mock client/transport seam via `process.env.PROTOTYPE_TEST_CLIENT_MODULE` (diimpor via `pathToFileURL` untuk kompatibilitas Windows path `D:\...`). Subprocess pengujian tidak membaca `.env.local` pengguna, tidak mewarisi kredensial remote, dan tidak melakukan kontak jaringan eksternal. Kegagalan negatif murni dari penolakan guard/assertion dan BUKAN akibat kegagalan DNS (`ENOTFOUND`), koneksi (`ECONNREFUSED`), timeout (`ETIMEDOUT`), TLS, atau file hilang. Terbukti pada Suite 4 (`tests/tooling/pipeline-tooling.test.mjs`: 4.3–4.6). |
| P1 | Pembuktian nol pemanggilan runner migrasi & seed | **Teratasi (PASS)** | `runPrototypePipeline` dibuktikan memanggil runner migrasi dan seed tepat 0 kali (`migrationCalls === 0`, `seedCalls === 0`) pada 5 jalur penolakan guard: (1) target invalid / NETWORK_PROVIDER non-mock, (2) mode non-SHADOW, (3) emergency stop aktif, (4) tabel aplikasi ada tanpa ledger, dan (5) versi migrasi tidak dikenal di ledger. Kondisi valid pembanding terbukti berhasil memanggil runner. Terbukti pada Suite 2 (`tests/tooling/pipeline-tooling.test.mjs`: 2.7a–2.7e, 2.8). |
| P1 | Verifikasi keanggotaan pasangan fixture jaringan eksak | **Teratasi (PASS)** | `runDirectedVerification` Step 10 menegakkan keanggotaan pasangan eksak: (a) 180 pasangan `scenario_id` + `service_id` untuk 15 skenario observasi dan 12 dummy services; (b) skenario `missing_status` terbukti 0 observasi ONU; (c) 16 pasangan `scenario_id` + `link_id` untuk 16 skenario dan `MOCK-UPLINK-01`. Pemeriksaan dibatasi strictly pada ruang fixture (data tambahan di luar ruang fixture tidak menggagalkan verifikasi; penggantian observasi normal dengan `missing_status` atau link salah terbukti fail-closed). Terbukti pada Suite 3 (`tests/tooling/pipeline-tooling.test.mjs`: 3.12a–3.12e). |
| P2 | Penyelarasan fakta identitas, topologi & skenario resmi | **Teratasi (PASS)** | Seluruh dokumentasi dan assertion diselaraskan 100% dengan sumber resmi (`supabase/seed.sql` dan `supabase/fixtures/network.sql`): ODC UUID berawalan `30000000` (`ODC-DUMMY-01`), ODP UUID berawalan `40000000` (`ODP-DUMMY-01`, `0002`), identitas dummy berawalan `60000000` (`0001`–`0005`), kode pelanggan `DUMMY-CUST-001` s/d `012`, pembagian topologi 10 layanan ke ODP-01 dan 2 layanan ke ODP-02, serta nama skenario mock jaringan (`normal`, `los_individual`, `los_area`, `low_coverage`, `upstream_down`, `stale`, `unknown`, `missing_status`, `future_timestamp`, `missing_timestamp`, `provider_error`, `timeout`, `onu_error_upstream_down`, `upstream_error_los`, `recovered`, `new_event`). |
| P1 | Verifikasi read-only remote Supabase Cloud | **Teratasi (PASS)** | Dijalankan via `scripts/verify-prototype-schema.mjs` ke Supabase Cloud (`saysxjdyalnbhxqqmytp`) Session pooler port 5432 dengan `NODE_EXTRA_CA_CERTS=certs/prod-ca-2021.crt`: seluruh assertion lulus (13/13 migrasi, 22 tabel inti, seluruh fixture ODC/ODP/pelanggan/layanan/topologi/identitas/tester, 180 pasangan ONU dan 16 pasangan Upstream, stale preserved, mode SHADOW, exit code 0, 0 mutasi pada database remote). |

## Status Resolusi Penutupan Jalur Campuran Mock Client & Verifikasi Remote Aktual (D152)

Pencegahan pencampuran mock client dengan runner mutasi nyata, penegakan injeksi lengkap, dan pelaporan bukti verifikasi remote aktual telah selesai dan diverifikasi:

| Prioritas | Bidang | Status | Perbaikan dan Bukti Verifikasi |
|---|---|---|---|
| P1 | Penolakan `PROTOTYPE_TEST_CLIENT_MODULE` pada CLI mutasi | **Teratasi (PASS)** | `scripts/apply-prototype-pipeline.mjs`: Menolak variabel lingkungan `PROTOTYPE_TEST_CLIENT_MODULE` di tingkat CLI maupun di dalam fungsi `runPrototypePipeline`. Keluar dengan exit code 1 dan pesan penolakan presisi sebelum membuka koneksi, membaca schema, atau memanggil runner migrasi/seed. Mencegah state mock mengizinkan mutasi remote nyata. Terbukti pada Suite 4 (`tests/tooling/pipeline-tooling.test.mjs`: Subtest 4.7) dan Suite 2 (Subtest 2.9c). |
| P1 | Penegakan dependency injection lengkap | **Teratasi (PASS)** | `runPrototypePipeline`: Jika `clientFactory` diinjeksi secara programmatic, pemanggil wajib menyertakan `migrationRunner` dan `seedRunner`. Ketiadaan salah satu runner memicu penolakan fail-closed sebelum koneksi atau efek samping apa pun, mencegah fallback ke default runner nyata. Terbukti pada Suite 2 (`tests/tooling/pipeline-tooling.test.mjs`: Subtests 2.9a & 2.9b). Pembanding lengkap dengan mock client dan runner terbukti berhasil (Subtest 2.8). |
| P1 | Preservasi client lokal pada verifier read-only | **Teratasi (PASS)** | `scripts/verify-prototype-schema.mjs` tetap mempertahankan dukungan `PROTOTYPE_TEST_CLIENT_MODULE` untuk pengujian CLI subprocess karena verifier beroperasi dalam transaksi `BEGIN READ ONLY` dan tidak memiliki efek samping mutasi. |
| P1 | Bukti verifikasi remote aktual tertelusuri (task-554) | **Teratasi (PASS)** | Menjalankan satu eksekusi read-only terbaru via `scripts/verify-prototype-schema.mjs` dengan client `pg` nyata, `sslmode=verify-full`, dan `NODE_EXTRA_CA_CERTS=certs/prod-ca-2021.crt` pada 15 Oktober 2026, 22:52 WIB (task-554). Seluruh assertion lulus penuh, exit code 0, 0 mutasi database. Stdout/stderr disajikan murni tanpa teks rekonstruksi naratif dari log asli `task-554.log`. |

## Status Resolusi Error 500 Inbox Vercel, CA Certificate & Pengalihan Halaman Awal (D153)

Penyebab kegagalan Inbox pada deployment Vercel dan halaman awal statis telah diselesaikan dan diverifikasi penuh:

| Prioritas | Bidang | Status | Perbaikan dan Bukti Verifikasi |
|---|---|---|---|
| P1 | Error 500 Inbox akibat kegagalan TLS CA pada driver `pg` | **Teratasi (PASS)** | `lib/postgres/server.ts`: Menambahkan `resolveDatabaseCaCertificate()` (env `HELPDESK_DB_CA`/`SUPABASE_DB_CA` → disk `certs/prod-ca-2021.crt` → bundled fallback `SUPABASE_ROOT_CA_2021`). Inisialisasi `new Pool` memisahkan parameter koneksi (`host`, `port`, `database`, `user`, `password`) dan menyuntikkan `ssl: { ca, rejectUnauthorized: true, servername: url.hostname }` secara eksplisit sehingga tidak ditimpa oleh parser `pg-connection-string`. Terbukti empiris menyelesaikan `SELF_SIGNED_CERT_IN_CHAIN` dan berhasil melakukan query ke Supabase Transaction Pooler remote. |
| P1 | Pengalihan sesi server-side halaman awal `/` | **Teratasi (PASS)** | `app/page.tsx`: Mengganti "Hello world!" statis dengan Server Component dinamis yang memverifikasi sesi server-side via `@/lib/supabase/server` `createClient().auth.getUser()`. Mengalihkan staf dengan sesi valid ke `/dashboard` (307) dan pengunjung tanpa sesi ke `/login` (307) tanpa redirect loop atau naive cookie/localStorage check. Terbukti lulus kompilasi dinamis Next.js (`ƒ /`). |
| P1 | Bundling sertifikat pada Next.js Serverless Functions | **Teratasi (PASS)** | `next.config.ts`: Menambahkan `outputFileTracingIncludes: { "/**": ["./certs/**/*"] }` untuk memastikan direktori `certs/` disertakan dalam bundle Serverless Functions Vercel. |
| P2 | Diagnostik error server aman dan terbatas | **Teratasi (PASS)** | `app/api/inbox/conversations/route.ts` dan `[id]/route.ts`: Menambahkan safe diagnostic logging pada blok `catch (err)` yang mencatat nama, kode, dan pesan yang disanitasi (menghapus format password/URI) ke `console.error` tanpa membocorkan rahasia atau isi pesan pelanggan. |
| P1 | Build produksi & regresi unit test | **Teratasi (PASS)** | `npm run build` sukses (exit code 0, `BUILD_ID: JTdS8Jb2coBKY5Q1yv8GA`, manifest 26 berkas valid); `npm test` 307/307 tests PASS (exit code 0); `eslint` 0 error/warning pada seluruh berkas yang dimodifikasi. |

## Status Resolusi Tiga Catatan Review P2.10 (D154)

Tiga catatan review pada implementasi D153 telah diperbaiki secara tuntas dan diverifikasi:

| Prioritas | Bidang | Status | Perbaikan dan Bukti Verifikasi |
|---|---|---|---|
| P1 | Pengerasan Keamanan Log Error Rute Inbox | **Teratasi (PASS)** | `lib/application/inbox-service.ts`, `app/api/inbox/conversations/route.ts`, dan `[id]/route.ts`: Menghapus logging `err.message` dan sanitasi regex terbatas. Memperkenalkan `classifyRouteError` terpusat: logging server secara ketat HANYA mencatat objek `{ route, category, code }`. Kategori dibatasi (`DatabaseError`, `TlsError`, `NetworkError`, `ConfigurationError`, `UnknownError`) dan kode divalidasi ketat (SQLSTATE 5 karakter, allowlisted TLS/POSIX network error codes). Kode tidak dikenal dibuang dan digantikan `UNEXPECTED_ERROR`. Pesan mentah, stack trace, connection string, password, bearer token, cookie, dan isi pesan pelanggan 100% tidak diteruskan ke log maupun respons HTTP. Respons kegagalan tetap HTTP 500 envelope standar. Terbukti pada 4 unit test terarah di `tests/application/inbox-service.test.ts`. |
| P1 | Pengujian Kriptografis Fallback CA X.509 | **Teratasi (PASS)** | `lib/postgres/server.ts` dan `tests/application/inbox-service.test.ts`: `resolveDatabaseCaCertificate` diperluas dengan opsi injeksi `{ env?, certPath? }` tanpa mengubah signature runtime default. Mengaktifkan jalur fallback (Step 3) secara deterministik ketika environment kosong dan berkas cert tidak ada/tidak dapat dibaca. Sertifikat fallback diparse sebagai X.509 (`crypto.X509Certificate`) dan dicocokkan secara kriptografis terhadap acuan `certs/prod-ca-2021.crt` (subject, issuer, serialNumber, validTo, fingerprint256 identik). Pengujian tidak memodifikasi/menghapus berkas disk dan tanpa koneksi jaringan. Terbukti pada subtest `resolveDatabaseCaCertificate fallback parses as valid X.509 and matches reference certificate`. |
| P2 | Penyelarasan Bukti Empiris & Dokumentasi | **Teratasi (PASS)** | Mempartisi secara tegas 4 ranah pembuktian (reproduksi TLS laptop, validasi lokal terbaru, smoke test deployment bersumber pengguna, dan konfirmasi pengiriman Telegram nyata bersumber pengguna). Menambahkan `D154` dan `D155` secara append-only di `docs/decision-log.md` untuk meluruskan D153/D154, memperbarui `docs/TRACKER.md`, dan menyelaraskan inventarisasi env var di `docs/DEPLOYMENT.md`. |

## Batas bukti yang tersedia

Pemisahan secara tegas empat ranah pembuktian yang tersedia:

1. **Ranah 1 — Reproduksi TLS dari Laptop (Lokal)**:
   - Investigasi awal membuktikan bahwa parser connection string driver `pg` menimpa opsi TLS menjadi kosong `{}` saat menemukan `sslmode=verify-full`, memicu `SELF_SIGNED_CERT_IN_CHAIN` karena CA Supabase tidak ada di trust store bawaan Node.js.
   - Solusi konfigurasi pool eksplisit dengan parameter terpisah dan CA eksplisit terbukti berhasil menghubungkan client `pg` laptop ke Transaction Pooler Supabase remote (`saysxjdyalnbhxqqmytp`).

2. **Ranah 2 — Validasi Lokal Perubahan Terbaru (Runtime D154/D155)**:
   - **Regresi Unit Tests**: **310/310 tests PASS** (`npm test`, exit code 0, durasi ~606ms).
   - **Targeted Route & CA Fallback Tests**: **49/49 assertions PASS** pada `tests/application/inbox-service.test.ts`, mencakup zero-leak assertions pada log dan respons, sanitasi error code, aktivasi Step 3 fallback, dan validasi X.509 kriptografis.
   - **Linter**: **0 error / 0 warning** (`npx eslint app/api/inbox/conversations/route.ts "app/api/inbox/conversations/[id]/route.ts" lib/application/inbox-service.ts lib/postgres/server.ts tests/application/inbox-service.test.ts`).
   - **Build Produksi Next.js**: `npm run build` sukses (exit code 0), `BUILD_ID: yBmXh45QZ1qw8jB7Ss89p`, 26 berkas manifest VALID.

3. **Ranah 3 — Smoke Test Deployment yang Dijalankan Pengguna**:
   - Sumber bukti: Eksekusi langsung oleh pengguna menggunakan `scripts/smoke-test-deployment.mjs` terhadap URL live `https://chat-dahsboard-helpdesk.vercel.app`.
   - Hasil eksekusi pengguna:
     - Seluruh 7 pemeriksaan wajib PASS (`allPassed: true`, `PROCESS_EXIT_CODE=0`).
     - Tanpa autentikasi: `/dashboard` mengembalikan 307 menuju `/login`; `/api/inbox/conversations` mengembalikan 401.
     - Dengan sesi staf: dashboard dan API Inbox mengembalikan 200.
     - Logout berhasil; dashboard kembali mengarah ke login (307) dan API kembali 401.
     - Request webhook tanpa secret atau dengan secret salah ditolak 401; jumlah baris ingress tetap 1 sebelum dan sesudah pemeriksaan tersebut.
     - Pesan simulasi diterima dan diproses sampai job berstatus done; pesan, percakapan, dan assessment terbentuk. Ingress ID pengujian: `0877a630-93c3-4756-804f-674b21d08e78`.
     - Mode SHADOW terjaga; outbound intents dan reply claims untuk pesan simulasi masing-masing 0.

4. **Ranah 4 — Konfirmasi Pengiriman Telegram Nyata Sampai Inbox**:
   - Sumber bukti: Konfirmasi pengguna setelah memasang webhook Telegram publik ke domain deployment live.
   - Konfigurasi bot Telegram live:
     - Bot ID: `8892832714`, username: `@upaznet_helpdesk_proto_bot`.
     - Webhook URL: `https://chat-dahsboard-helpdesk.vercel.app/api/webhooks/telegram`.
     - Webhook status: pending updates: 0, allowed updates: `message`, `edited_message`, custom cert: false.
   - Konfirmasi fungsional: Pesan nyata dari tester terkonfirmasi diterima dan muncul pada antrean Inbox dashboard staf.
   - *Batasan klaim*: Sesuai instruksi, evaluasi triage assessment pada pesan simulasi tidak dianggap sebagai bukti evaluasi assessment pesan Telegram nyata.

## Urutan kelanjutan

1. Tooling deployment, migrasi database remote, seed prototype, dan verifikasi read-only telah selesai (D144–D152).
2. Deployment prototype live Vercel dan smoke test deployment awal telah dieksekusi oleh pengguna dengan hasil 7/7 PASS (D153).
3. Webhook Telegram live telah dipasang oleh pengguna dan pesan Telegram nyata terkonfirmasi masuk ke Inbox.
4. Perbaikan keamanan log error, pengujian fallback CA X.509, penyelarasan BUILD_ID, dan pembatasan ringkasan smoke test telah selesai dan tervalidasi secara lokal (D154, D155).
5. **Langkah Tersisa untuk P2.10**:
   - Pengguna melakukan commit, push, dan redeploy Vercel untuk menerapkan pembaruan runtime terbaru (sanitasi log dan CA fallback resolver).
   - Pengguna memastikan deployment baru aktif dan verifikasi fungsi Inbox tetap normal.
6. Merekomendasikan status P2.10 **Done** setelah redeployment perubahan terbaru diverifikasi. Setelah itu lanjutkan ke [P2.11](TRACKER.md#task-p2-11) (Verifikasi vertical slice SHADOW end-to-end).

## Status Terkini Penutupan P2.10 (Berdasarkan Konfirmasi Pengguna) & Transisi ke P2.11

- **Konfirmasi Pengguna**: Pengguna telah mengonfirmasi bahwa deployment terbaru Vercel P2.10 berfungsi normal: status deployment Vercel **Ready**, pengalihan halaman awal (`/`) berfungsi sesuai sesi pengguna/staf, serta antrean Inbox dan detail percakapan terbuka normal tanpa error 500 (D156, D157).
- **Atribusi Status**: Berdasarkan konfirmasi operasional tersebut, tugas **P2.10** secara resmi ditutup dengan status ✅ **Done**. Kode status HTTP 200 dan 307 secara spesifik bersumber dari hasil otomatis smoke test deployment sebelumnya (`scripts/smoke-test-deployment.mjs`), bukan klaim inspeksi manual pengguna.
- **Transisi ke P2.11**: Pekerjaan dilanjutkan ke [P2.11](TRACKER.md#task-p2-11) (Verifikasi vertical slice SHADOW end-to-end).



