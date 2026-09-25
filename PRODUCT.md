# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
- **Helpdesk & NOC Staff**: Petugas shift helpdesk ISP Upaznet (±6.000 pelanggan) yang bertugas memantau antrean komplain Telegram, memeriksa validitas status jaringan/koneksi, merespons pesan pelanggan dari dashboard, dan memperbarui status lifecycle episode.
- **Pelanggan Tester (Allowlist)**: Pelanggan dalam daftar uji coba yang mengirimkan pesan komplain atau keluhan via chat privat bot Telegram, menerima auto-reply terverifikasi (simulasi), dan menerima balasan langsung dari staf.
- *Audiens terkait luar*: Teknisi lapangan dan tim finance tetap menggunakan Custpanel untuk delegasi tiket dan pembukuan/keuangan.

## Product Purpose
Upaznet Helpdesk Automation adalah antarmuka operasional (dashboard) untuk mempercepat respons pertama komplain pelanggan ISP secara deterministik dan terukur, memadukan auto-triage komplain berbasis status jaringan (mock OLT/NMS) dengan kontrol insiden massal manual (Mass Outage) dalam satu antrean terpadu. Keberhasilan produk tercapai saat keluhan tester tertangkap di antrean, dievaluasi dengan assessment yang transparan dan dapat dijelaskan, dicegah dari pengiriman balasan duplikat/salah sasaran, serta staf dapat mengambil alih percakapan dan membalas langsung tanpa kehilangan jejak audit.

## Positioning
Berbeda dari sistem ticketing tradisional (seperti Custpanel) yang berfokus pada workflow penugasan teknisi dan billing, dan berbeda dari chatbot generik/AI yang sering mengarang diagnosa tanpa bukti, Upaznet Helpdesk Automation adalah *workspace triase percakapan waktu-nyata* dengan satu mesin pengambil keputusan outbound deterministik yang menggabungkan bukti jaringan nyata/mocked (ONU LOS, area LOS, upstream outage) dengan kontrol override insiden staf, tanpa auto-ticketing buta dan tanpa klaim teknis yang tidak terbukti.

## Operating Context
- **Lingkungan Penggunaan**: Digunakan di browser desktop oleh staf helpdesk selama jam kerja operasional dan shift malam (desktop sidebar 216px, topbar 64px, antrean responsif tanpa batasan max-width sempit).
- **Alur Kerja Utama**:
  1. Pelanggan mengirim keluhan di bot Telegram -> pesan diidentifikasi dan diantrekan secara atomik.
  2. Evaluasi otomatis (Triage Assessment) menentukan status gangguan (General incident, Area incident, Upstream, Individual ONU LOS, atau Generic/Online) berdasarkan aturan deterministik.
  3. Dashboard menampilkan antrean komplain, badge status, ringkasan bukti jaringan, dan riwayat attempt balasan.
  4. Staf memulai penanganan ("Mulai Tangani"), meninjau konteks, mengirimkan balasan terarah melalui ChannelAdapter, atau menandai kasus pulih/selesai.
  5. Bila diperlukan kunjungan fisik/tindakan lapangan, staf membuat tiket secara manual di Custpanel.
- **Ritual & Keadaan Operasional**: Pergantian shift staf, monitoring mode automation (SHADOW, LOS_AND_GENERIC, FULL), aktivasi darurat (Emergency Stop), dan penanganan lonjakan (burst) saat gangguan massal.

## Capabilities and Constraints
- **Kapabilitas Terkonfirmasi**:
  - Ingress deduplication & atomicity (menjamin pesan Telegram tidak diduplikasi atau hilang).
  - Lifecycle episode keluhan (NEW -> IN_PROGRESS -> RESOLVED -> CLOSED) dengan aturan bahwa satu episode mencakup satu masalah terlepas dari batasan inactivity 24 jam.
  - Insiden manual (GENERAL / AREA_SPECIFIC) dengan batasan maksimal satu insiden ACTIVE.
  - Balasan otomatis terkontrol (maksimal 1 balasan otomatis per identitas + episode/event; dihentikan begitu staf mulai menangani).
  - Pengiriman balasan staf langsung dari antrean dashboard melalui ChannelAdapter.
  - Audit trail dan decision snapshot lengkap untuk setiap pesan dan aksi staf.
- **Batasan & Constraint Keras**:
  - Prototype tahap ini beroperasi dengan `NETWORK_PROVIDER=mock` dan data dummy; belum ada koneksi OLT/NMS nyata.
  - Semua outbound prototype wajib dibatasi ke allowlist tester dengan label simulasi.
  - Transaksi database menggunakan pg pool lokal dengan single advisory lock (`inHelpdeskTransaction`); dilarang memecah transaksi menjadi REST calls terpisah.
  - Dilarang membuat relasi, menyentuh, atau bergantung pada proyek eksternal *Upaznet Config & Command Generator*.
  - Custpanel tetap sistem utama tiket, delegasi teknisi, dan finance (tidak digantikan).
- **Hal yang Sengaja Belum Ditentukan (Open Items)**:
  - Format kontrak payload vendor OLT nyata & integrasi WhatsApp Cloud API resmi (ditunda ke fase produksi).
  - Penanganan multi-layanan per customer (saat ini 1 fixture = 1 layanan).

## Brand Commitments
- **Nama Produk**: Upaznet Helpdesk Automation (Upaznet Helpdesk).
- **Tone & Voice**: Ringkas, faktual, tenang, dan transparan. Tidak pernah memberi janji estimasi waktu pemulihan (ETA) atau diagnosa penyebab fisik kabel putus tanpa bukti terkonfirmasi.
- **Integritas Simulasi**: Label "Prototype · Data dummy" wajib tampil persisten; setiap balasan tester memiliki penanda simulasi.

## Evidence on Hand
- Dokumentasi requirement aktif: `docs/PRD.md` (PRD v2.1).
- Aturan arsitektur & engineering: `AGENTS.md`.
- Desain sistem & visual tokens: `docs/DESIGN_SYSTEM.md`.
- Kontrak mock provider jaringan: `docs/NETWORK_PROVIDER.md`.
- Spesifikasi & verifikasi lifecycle episode: `docs/EPISODE_LIFECYCLE.md`, `docs/P1_3_REVIEW.md`, `docs/P1_4_REVIEW.md`.
- *Ketidakhadiran yang dilarang difabrikasi*: Tidak ada akses live OLT/NMS nyata, tidak ada data pelanggan riil di luar data seed dummy fixture.

## Product Principles
1. **Inbox dan Antrean adalah Pusat Kerja**: Ruang kerja staf berpusat pada antrean komunikasi dan triase komplain; bukan sekadar monitor pasif.
2. **Bukti Mendahului Keputusan**: Status jaringan selalu menampilkan timestamp, sumber, dan tingkat kepastian. Online bukan bukti internet normal; unknown bukan bukti jaringan sehat.
3. **Satu Tindakan Utama yang Jelas**: Setiap state antrean memiliki aksi kontekstual yang tegas ("Mulai Tangani", "Kirim Balasan", "Tandai Pulih") tanpa membingungkan operator.
4. **Hemat Perhatian, Tanpa Ornamen Palsu**: Desain fungsional kontras tinggi, palet warna terbatas semata-mata untuk status semantik dan interaksi, menghindari dekorasi berlebihan atau efek visual artifisial.
5. **Aman dari Kegagalan Ganda (Defensive by Design)**: Tidak ada retry buta saat status pengiriman tidak pasti; idempotency dan dedup ditegakkan di level database.

## Accessibility & Inclusion
- Palet warna mematuhi rasio kontras WCAG AA (misal: tombol aksi utama `#007A3D` berkontras 5,45:1 terhadap teks putih; identitas navy `#003C71`; foreground gelap pada badge terang).
- Warna tidak pernah menjadi satu-satunya penanda status (setiap badge selalu menyertakan label teks eksplisit dan icon pendukung).
- Tipografi Geist Sans untuk antarmuka umum dan Geist Mono khusus data teknis/ID, dengan ukuran minimal 12px untuk informasi operasional penting.
- Mendukung navigasi keyboard penuh, visible focus ring (`#2563EB` 2px offset 2px pada latar terang, ring terang pada panel navy), dan menghormati preferensi `prefers-reduced-motion` untuk transisi (120–180 ms).
