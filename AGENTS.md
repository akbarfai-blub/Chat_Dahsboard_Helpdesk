# AGENTS.md — Upaznet Helpdesk Automation

## 1. Acuan aktif

Baca [docs/PRD.md](docs/PRD.md) sebelum implementasi dan [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) untuk UI. [docs/decision-log.md](docs/decision-log.md) menyimpan histori; baseline konsolidasi D65–D69 dan baseline visual D78 berlaku untuk prototype terpadu.

- PRD v1.2, mini PRD triage, dan catatan desain lama telah dihapus oleh pengguna setelah konsolidasi. Gunakan PRD.md; histori keputusan ada di decision-log.md. Jangan memakai larangan scope lama (tanpa queue/reply UI) untuk menolak scope yang sudah disetujui.
- Pengguna menyetujui penggabungan Mass Outage + triage, lifecycle episode, input balasan staf di dashboard, dan evaluasi otomatis inbound.
- Fokus produk: Inbox Helpdesk + Auto-Triage + Konteks Jaringan. Tiket dibuat staf secara manual di Custpanel; delegasi teknisi, pelaporan tiket, dan finance tetap di sana. Direktori pelanggan adalah fitur pendukung, bukan landing/CRM pengganti.
- Belum ada akses OLT/NMS; gunakan mock provider dan data dummy. Jangan mengarang payload vendor/arti FS.
- Jangan membaca untuk integrasi, menyentuh, mengimpor, atau bergantung pada proyek Upaznet Config & Command Generator.

## 2. Stack dan arsitektur

- Next.js App Router + TypeScript; Vercel prototype; Supabase PostgreSQL + Auth saja.
- Telegram prototype, WhatsApp Cloud API fase berikutnya; ChannelAdapter memisahkan parsing/format channel dari domain.
- NetworkStatusProvider dan identity lookup port membungkus mock; tidak ada koneksi perangkat nyata pada prototype.
- Kontrak provider dan cara uji fondasi mock: docs/NETWORK_PROVIDER.md. Seed ulang tidak merefresh observasi; endpoint read-only khusus staf memerlukan NETWORK_PROVIDER=mock. Tidak ada outbound pada tahap ini.
- P1.1 identitas/klasifikasi dirangkum di docs/P1_1_REVIEW.md; P1.2 kandidat keputusan di docs/P1_2_REVIEW.md. P1.3 lifecycle episode diverifikasi di docs/P1_3_REVIEW.md; P1.4 persistence lokal terverifikasi di docs/P1_4_REVIEW.md. Reservasi bukan izin dispatch; tidak ada outbound pada tahap ini.
- P1.4 memakai pg pada server dan satu advisory lock transaksi. Gunakan inHelpdeskTransaction untuk mutasi terkait; jangan memecah transaksi menjadi request Supabase REST terpisah. Actor staf diambil dari session; provider/HTTP tidak dijalankan di dalam transaksi.
- Domain berupa fungsi TypeScript murni di lib/domain/; waktu/hasil provider masuk sebagai input. Setiap fungsi domain punya unit test bermakna di **tests**/domain/.
- Route handler parse/validate/auth → application service → response; orchestration transaksi/provider di application layer, rule bukan di route.
- Business logic bukan Postgres trigger/function/stored procedure. DB tetap menegakkan FK/unique/basic checks; application transaction menjamin atomisitas.
- Jangan mengganti stack atau menambah Redis/Realtime/Storage/Edge Functions tanpa instruksi yang mengizinkan.

## 3. Aturan inti

- Satu pengambil keputusan outbound: GENERAL manual → AREA manual valid → upstream valid → area LOS → individu LOS → online/generik.
- GENERAL tidak lookup area dan merupakan pengecualian keyword. Unverified tidak mendapat detail layanan; general non-spesifik/generik diperbolehkan sesuai PRD.
- Satu episode per masalah; NEW/IN_PROGRESS/RESOLVED/CLOSED. Reopen masalah sama tidak reset debounce. CLOSED final; layanan berbeda tidak digabung sembarang.
- Input balasan staf di dashboard mengirim lewat adapter; catatan internal tidak pernah terkirim.
- Status online bukan bukti internet normal; LOS bukan bukti kabel tertentu putus. Jangan memberi diagnosis/ETA tanpa bukti.
- Manual incidents tetap maksimal satu ACTIVE, create langsung aktif, reopen ID sama, normal close manual, force-close wajib alasan trimmed non-empty. Network events/complaints tidak terkena guard satu ACTIVE.
- Perubahan template/area/shift/mode tidak mengirim ulang. Satu balasan otomatis per identitas+episode dan guard identitas+incident/event jika tersedia.
- Debounce/dedup lewat INSERT + unique constraint, bukan check-then-insert. Klaim episode/event atomik; hasil send tidak pasti tidak boleh di-retry buta.
- Telegram dedup mencakup account + chat + message; jangan pakai raw message_id global.
- Mock freshness 5 menit dan threshold ≥3 LOS/≥50% valid/coverage ≥80%; cache area 24 jam bukan cache status jaringan.
- SHADOW default tanpa otomatis mengirim; LOS_AND_GENERIC → FULL, tanpa replay backlog. Emergency stop mematikan automation, bukan antrean.
- Semua outbound prototype ke allowlist tester dengan label simulasi, termasuk balasan staf.

## 4. Keamanan dan runtime

- Staf setara tidak berarti authenticated mendapat semua DB write. Mutasi melalui backend tervalidasi; audit/claim dilindungi; session menentukan actor.
- Secret/service-role hanya server, tidak prefix NEXT*PUBLIC*. Validasi secret webhook sebelum efek samping.
- Simpan ingress+job sebelum ACK; processing dan attempt persisten. Jangan mengandalkan fire-and-forget Vercel.
- Ikuti batas/default retry/recovery pada PRD §11; prototype belum menjanjikan scheduler always-on atau SLA produksi.
- Balasan manual menggunakan request ID untuk dedup klik ganda dan menghentikan pending first response.
- API aplikasi: success dengan data, failure dengan error code/message. Pengecualian protokol hanya handshake challenge WhatsApp ketika fase integrasi tersebut dibuat.

## 5. Data dan perubahan

- supabase/migrations/ menjadi source of truth schema aktual ketika dibuat. docs/database_schema.sql adalah snapshot historis Mass Outage, tidak lengkap untuk PRD v2.0; jangan apply langsung.
- Buat migration baru untuk perubahan schema, jangan edit migration yang sudah diaplikasikan. Update dokumentasi schema bila signifikan.
- Decision log append-only; jangan menghapus histori. Sebelum menambahkan keputusan, periksa ID terakhir pada docs/decision-log.md dan gunakan nomor berikutnya. D43–D48 tidak tersedia, jangan dikarang.
- Pilihan teknis baru yang berdampak perilaku dicatat; default visual/operasional konsolidasi boleh diimplementasikan dalam scope.
- Kode/nama variabel Bahasa Inggris; UI Bahasa Indonesia. Env UPPER_SNAKE_CASE, prefix layanan sesuai fungsi.
- Rekomendasi commit message mengikuti Conventional Commits, tetapi agent tidak commit sendiri.

## 6. Git dan scope kerja

- Jangan menjalankan git commit/push/tag atau mengubah history/remote. Commit dan push manual oleh pengguna kecuali instruksi pengguna berikutnya secara eksplisit mengganti aturan ini.
- Ubah hanya file yang diperlukan, jangan refactor sekalian atau menghapus data/proyek lain.
- Tidak perlu meminta ulang izin untuk scope prototype yang sudah disetujui.
- Setelah task, jelaskan file dibuat/diubah/dihapus, alasan perubahan, asumsi/default baru, validasi dan kegagalan. Jangan mengklaim implementasi/deploy hanya karena spesifikasi ada.
- Jika fakta vendor belum diketahui, gunakan interface/mock dan tandai OPEN ITEM. Jika bukti jaringan tidak cukup, jangan klaim gangguan terkonfirmasi; gunakan generic/manual sesuai PRD.

## 7. Kebijakan review — berbasis risiko dan hemat token

Kebijakan ini berlaku saat agent mereview hasil pekerjaan agent eksekutor. Tujuannya memastikan Acceptance Criteria terpenuhi dengan pemeriksaan secukupnya, tanpa mengulang pekerjaan eksekutor.

### Penentuan risiko

Tentukan tier berdasarkan perilaku yang berubah, bukan hanya nama file. Perubahan styling pada halaman login tidak otomatis menjadi perubahan auth. Jika satu task mencakup beberapa tier, terapkan kedalaman review sesuai bagian yang berubah.

- **Risiko rendah:** UI/styling, layout, copy, token desain, dan sinkronisasi dokumentasi tanpa perubahan perilaku.
  Baca ringkasan eksekutor, diff stat, dan diff bagian relevan. Untuk perubahan visual, periksa bukti screenshot yang terkait Acceptance Criteria. Jangan membaca file penuh atau menjelajahi codebase tanpa indikasi masalah.

- **Risiko menengah:** business logic nonkritis, transformasi data, dan validasi form nonkeamanan.
  Review diff dan cocokkan dengan Acceptance Criteria. Baca konteks tambahan hanya jika diperlukan untuk memahami pemanggil, kontrak, atau dampaknya. Fokus pada ketepatan perilaku, bukan preferensi gaya kode.

- **Risiko tinggi:** auth, otorisasi, RLS/akses database, perubahan yang berkaitan dengan D66/D70, transaksi/klaim, idempotensi pengiriman, dan migrasi schema.
  Baca penuh file terkait yang diperlukan untuk menilai perubahan serta batas kepercayaannya. Wajib ada bukti pengujian eksplisit sebelum menyetujui status Done. Tidak perlu membaca seluruh codebase.

### Batas scope review

- Identifikasi perubahan milik task yang sedang direview. Jangan menganggap seluruh working tree atau staging sebagai hasil task tersebut.
- Gunakan konteks review sebelumnya; jangan membaca ulang file yang sama tanpa alasan baru.
- Perluas pemeriksaan hanya jika ditemukan ketidaksesuaian, perubahan di luar scope, bukti bertentangan, atau risiko tambahan. Jelaskan alasannya singkat.
- Jangan menjalankan sub-agent atau audit tambahan secara default; gunakan hanya jika pengguna memintanya.
- Jangan mengubah kode saat tugasnya hanya review, kecuali pengguna juga meminta perbaikan.

### Kebijakan pengujian

- Jangan menjalankan ulang test, lint, build, integrasi database, atau pengujian browser saat review, kecuali pengguna secara eksplisit meminta verifikasi independen.
- Utamakan bukti eksekutor: perintah yang dijalankan, hasil/exit code, jumlah passed/failed/skipped bila relevan, assertion kunci, dan versi kode yang diuji.
- Periksa apakah bukti tersebut menutup Acceptance Criteria dan masih sesuai dengan perubahan terakhir.
- Screenshot saja tidak membuktikan seluruh perilaku; build lulus tidak membuktikan aturan bisnis benar.
- Untuk perubahan dokumentasi saja, pemeriksaan diff, rujukan, dan konsistensi klaim dapat menjadi bukti yang cukup. Tidak perlu meminta suite aplikasi.
- Jika bukti kurang, minta hanya bukti tambahan yang spesifik terhadap kekurangan tersebut. Jangan meminta pengulangan seluruh suite tanpa alasan.

### Status dan pelaporan

- Setujui Done hanya jika Acceptance Criteria yang relevan memiliki bukti konkret.
- Jika implementasi atau bukti penting belum lengkap, rekomendasikan In Progress dan sebutkan kekurangannya secara spesifik.
- Catatan kosmetik yang tidak melanggar Acceptance Criteria tidak otomatis menghalangi Done.
- Bedakan temuan implementasi, kekurangan bukti, dan saran opsional.
- Nyatakan metode review secara jujur: pemeriksaan diff/dokumen/bukti eksekutor, bukan pengujian independen jika tidak dilakukan.
- Jangan membuka ulang bagian yang sudah diterima tanpa perubahan atau bukti baru.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
