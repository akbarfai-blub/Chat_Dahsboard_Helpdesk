# Rangkuman percakapan dan baseline sebelum P2.6 Tahap 2 — UI Inbox

Tanggal: 2026-10-06. Dokumen ini merangkum pekerjaan yang dibahas, hasil eksekutor yang telah direview, dan baseline yang diterima sebelum implementasi UI Inbox. Sumber aktif tetap AGENTS.md, PRD.md, TRACKER.md, dan decision-log.md; rangkuman ini tidak menggantikan acceptance criteria.

## 1. Posisi proyek

| Tahap | Hasil | Status yang diterima |
|---|---|---|
| P2.4 | Orkestrasi inbound ke assessment SHADOW | Done |
| P2.5 | Worker job, lease, attempt, retry/recovery, dan lifecycle setelah ACK | Done |
| P2.6 Tahap 1 — A | Fondasi data/API Inbox, akses staf, Origin, migration runner, dan fixture | Done |
| P2.6 Tahap 1 — B1 | Unread per pesan/per staf dan penandaan baca eksplisit | Done |
| P2.6 Tahap 1 — B2 | Classification faktual, snapshot baca, pagination, dan kontrak/dokumentasi | Done; diterima setelah validasi Antigravity D115 |
| P2.6 keseluruhan | Inbox sebagai landing dashboard | In Progress; Tahap 2 UI/polling masih diperlukan |

## 2. P2.4 — Orkestrasi inbound ke assessment SHADOW

- Alur inbound menjalankan identitas, klasifikasi, pengambilan bukti, keputusan, asosiasi episode, dan penyimpanan assessment/handoff.
- Provider I/O berlangsung di luar transaksi. Transaksi final menyimpan data terkait secara atomik dan memvalidasi ulang konteks yang dapat berubah.
- Sumber incident final dibaca dari database pada transaksi final. Regresi penggantian incident A menjadi B dan jalur Telegram termasuk dalam bukti yang diterima.
- SHADOW menghasilkan assessment tanpa auto claim atau outbound otomatis. Peningkatan mode tidak mengirim ulang backlog SHADOW.
- Dedup, pemakaian episode yang sama untuk follow-up, rollback kegagalan transaksi, serta retry idempoten diverifikasi dalam bukti tahap ini.
- Pengamanan tes diperketat: lingkungan Supabase lokal terpisah, marker PostgreSQL/API yang sama, fixture milik run, cleanup terbatas, preservasi data pembanding, dan controlled failure. Catatan dampak pengujian lama tetap tersimpan di histori; tidak ada klaim pemulihan data lama pada rangkuman ini.

Acuan: [P2_4_REVIEW.md](P2_4_REVIEW.md), TRACKER P2.4, dan keputusan D87–D92. Angka pengujian tahap ini adalah bukti historis, bukan hasil pengujian baru saat membuat rangkuman.

## 3. P2.5 — Worker pemrosesan job

- Claim atomik memakai lease token dan attempt persisten; pemicu paralel tidak mengambil job yang sama.
- Lease aktif dilindungi, lease kedaluwarsa dapat direclaim, dan worker lama ditolak sebelum mutasi final/failure recording.
- Retry memakai backoff; recovery crash, retryable failure, dan terminal failure tercatat di database.
- Default yang diterima: lease 30 detik, maksimal 3 attempts, backoff dasar 2 detik, maksimal 5 jobs per drain. Batas drain 20 detik membatasi awal job berikutnya, bukan penghentian paksa job aktif.
- Ingress dan job disimpan sebelum ACK. Lifecycle `after()` dan background failure dibuktikan pada server Next.js lokal nyata, terpisah dari harness callback terkontrol.
- Target efektif PostgreSQL/Supabase API dan marker diverifikasi. Diagnostik khusus tes dibatasi, nonaktif secara default, dengan autentikasi secret sebelum factory/query dan error tersanitasi.
- Fixture/cleanup, pemulihan environment, dan aturan ignore metadata runtime Supabase tes dirapikan.
- Prototype belum menjanjikan scheduler selalu aktif atau SLA produksi; SHADOW tetap tanpa pengiriman otomatis.

Acuan: [P2_5_REVIEW.md](P2_5_REVIEW.md), TRACKER P2.5, dan keputusan D93–D100.

## 4. P2.6 Tahap 1 — Fondasi data dan API Inbox

### Koreksi A: akses staf, migration runner, dan lifecycle fixture

- Endpoint list, detail, dan penandaan baca tersedia khusus staf. Actor berasal dari sesi server, bukan payload client.
- Mutasi read-state langsung oleh `anon`/`authenticated` dicabut; mutasi melalui backend tervalidasi. RLS dan hak role database nyata memiliki bukti eksplisit.
- Origin tepercaya berasal dari konfigurasi server; forwarded headers tidak memperluas allowlist.
- Migration runner memakai target efektif driver pg, guard sebelum mutasi, ledger, dan transaksi atomik. Transisi memakai file SQL aktual.
- Identity fixture dicatat sebelum receive(); cleanup tetap berjalan saat guard, setup, query pasca-receive, processing, atau teardown gagal. Error utama dan cleanup tidak saling menutupi.

### Koreksi B1: unread berdasarkan pesan yang benar-benar diakui

- `staff_message_reads.is_confirmed` menjadi sumber read-state per pesan/per staf. Kursor agregat bukan bukti seluruh rentang pesan telah dilihat.
- `acknowledgedMessageIds` mengakui snapshot eksplisit. Fallback `lastReadMessageId` hanya satu pesan.
- Pesan di luar snapshot tetap unread, termasuk delayed processing, timestamp sama, atau waktu lebih lama dari kursor.
- Legacy backfill tidak dianggap confirmed. Kursor mempertahankan presisi mikrodetik PostgreSQL.
- Transaksi/advisory lock melindungi penandaan baca konkuren; kursor tidak mundur dan acknowledgement berulang idempoten.
- Harness B1 membuktikan overlap melalui PID/lock, kegagalan sebelum barrier, timeout pasca-barrier, settlement sesudah pembatalan, dan perbedaan timeout dengan error query biasa.

### Koreksi B2: snapshot, pagination, dan kontrak final

- Classification detail memakai `category`, `reason`, `ruleVersion`, `normalizedText`, dan `matchedKeywords`; tidak mengarang confidence/flags. Histori kosong/rusak memakai fallback eksplisit tanpa re-klasifikasi saat GET.
- List count/items dan detail masing-masing dibaca dalam satu statement. AC 14 memakai writer barrier dan commit terkoordinasi untuk membuktikan respons tetap pada satu snapshot.
- Pagination default/maksimal 25; page dan offset wajib safe integer. Overflow ditolak 400 sebelum database. ORDER BY ditegaskan di SELECT terluar setelah LEFT JOIN.
- AC 15 memverifikasi seluruh 28 ID fixture, halaman 10/10/8, timestamp ties, UUID DESC, stabilitas pengulangan, serta halaman/pencarian kosong.
- Status percakapan `active`/`closed`; identitas pelanggan berada di `sender`. Envelope aplikasi `{ success, data, error }`, dengan `Cache-Control: private, no-store`.
- Pengujian route Inbox berupa pemanggilan handler Request/Response langsung dengan stub sesi dan pool tes; belum merupakan browser E2E atau login Supabase nyata melalui HTTP.

Acuan: [P2_6_STAGE1_REVIEW.md](P2_6_STAGE1_REVIEW.md) dan keputusan D101–D115. Koreksi akhir ditulis Codex; eksekusi validasi terarah dilakukan Antigravity.

## 5. Bukti terbaru dan dua perapian dokumentasi

Validasi Antigravity atas kode D114, dicatat D115:

| Pemeriksaan | Hasil yang dilaporkan |
|---|---|
| `npx tsc -p tsconfig.test.json` | Exit 0, 0 error |
| Unit file Inbox | 44 checks passed, 0 failed, 0 skipped |
| Lint empat file TypeScript koreksi | Exit 0, 0 error, 0 warning |
| `npm run test:inbox:local` | 33 checks passed, 0 failed, 0 skipped |

Integrasi memakai Supabase lokal khusus tes, PostgreSQL 54332/API 54331; marker PG/API cocok sebelum mutasi. Angka 228 unit checks pada D113 adalah agregat historis, bukan jumlah terbaru unit file Inbox.

Perapian sebelum Tahap 2 sudah diterapkan:

1. **AC 14:** bounded wait/settlement, timer cleanup, dan destruction koneksi aktif jika settlement timeout dinyatakan sebagai proteksi yang tersedia dalam kode. Kegagalan yang benar-benar diinjeksi adalah reader failure sebelum SQL. Bukti timeout B1 AC 7.3 tetap terpisah untuk harness B1.
2. **AC 12:** baris tabel review dikembalikan. Tes yang masih ada memanggil process() dengan lease token invalid, menangkap `lease_lost`, menjalankan cleanup di finally, dan membuktikan ingress/job/identity fixture terhapus.

Perapian ini hanya dokumentasi. Hasil D115 dan status Done A/B1/B2 tetap berlaku; tidak ada tes ulang, perubahan runtime/migration, atau keputusan perilaku baru. Histori decision log dipertahankan dengan klarifikasi editorial; ID keputusan berikutnya tetap D116.

## 6. Fokus Tahap 2 — UI Inbox

- Inbox menjadi landing dashboard helpdesk: daftar percakapan, preview pesan, ringkasan episode/status, badge unread, dan penanda needs-review.
- Filter/pencarian dan pagination memakai kontrak API yang telah diterima; panel detail menampilkan riwayat pesan, termasuk non-komplain.
- Polling baca 5 detik serta state loading/empty/error tersedia sesuai acceptance criteria P2.6.
- Penandaan baca mengirim hanya ID pesan yang benar-benar ditampilkan kepada staf; polling bukan bukti pesan telah dibaca.
- UI berbahasa Indonesia mengikuti [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md), baseline visual D78, dan PRD aktif. Baca panduan Next.js versi lokal sebelum menulis kode.
- Panel evidence lengkap berada pada P2.7; koreksi klasifikasi staf pada P2.8; composer balasan/kontrol lifecycle mengikuti fase P3. Tidak menambahkan outbound pada tahap UI Inbox ini.

Baseline yang perlu dipertahankan: Next.js App Router + TypeScript, Supabase PostgreSQL/Auth, provider mock, SHADOW, session actor, backend tervalidasi, transaksi aplikasi, dan isolasi tes. Tidak ada akses OLT/NMS nyata atau integrasi ke proyek Upaznet Config & Command Generator.

Metode kerja: review berdasarkan scope/risk dan bukti eksekutor; bagian yang sudah diterima tidak dibuka ulang tanpa perubahan atau bukti baru. Pengujian diarahkan pada perubahan UI/integrasi baru. Commit/push tetap manual oleh pengguna; rangkuman ini tidak menjalankan git add/commit/push/deploy dan tidak memulai implementasi UI.
