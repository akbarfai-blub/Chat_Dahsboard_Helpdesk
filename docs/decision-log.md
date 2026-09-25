> **Acuan aktif:** [PRD v2.0](PRD.md) dan [Design System](DESIGN_SYSTEM.md). Baca D65–D69 untuk keputusan konsolidasi yang menggantikan status historis di bawah. Entry baru berikutnya D70.

# Decision Log — Chat Automation Upaznet Helpdesk

Histori keputusan proyek, termasuk draft dan keputusan yang kemudian diganti. Entri awal berasal dari PRD v1.2 yang telah dihapus setelah konsolidasi. **Acuan aktif adalah [PRD v2.0](PRD.md)**; status historis di bawah dibaca bersama keputusan penggantinya, terutama D65–D69.

**Aturan menambah entry baru:** tambahkan di bawah dengan nomor lanjutan (berikutnya D70), jangan pernah edit/hapus entry lama. Kalau sebuah keputusan lama dianggap usang, tandai `(superseded by D#)` di kolom keterangan, entry lama tetap dibiarkan ada untuk histori.

---

## Lifecycle & State Machine

| # | Keputusan |
|---|---|
| D34 | State `DRAFT` tidak digunakan — incident langsung `ACTIVE` saat dibuat |
| D35 | Debounce **tidak** direset saat `RESOLVED → ACTIVE` (reopen) |
| D36 | `RESOLVED → CLOSED` manual sepenuhnya, tanpa reminder/auto-close |
| — | Maksimal 1 incident `ACTIVE` — create/activate baru ditolak kalau masih ada yang ACTIVE (PRD §4.2) |
| — | Reopen mempertahankan `incident_id` yang sama, bukan bikin incident baru (PRD §4.2) |
| — | `force_close_reason` wajib (trimmed non-empty) **hanya** untuk force-close, bukan `RESOLVED → CLOSED` normal (H-001) |

## Area Matching & Customer Identification

| # | Keputusan |
|---|---|
| D9 | FS putus/backbone luas = General (tidak perlu lookup wilayah) |
| D14 | Lookup hanya berdasarkan identifier channel (nomor WA / Telegram ID) |
| D15 | Identifier tidak match/tidak ditemukan → selalu dianggap tidak terdampak (bukan "mungkin") |
| D26 | Customer area cache TTL = 24 jam |
| D27 | Hierarki ODC→ODP→Customer tidak dimapping ulang — mengandalkan Custpanel |
| D28 | `affected_areas` mendukung ODP + ODC, exact match tanpa hierarchical traversal runtime |
| D29 | Definisi "terdampak" resmi: lookup valid **DAN** area match |

## Automation & Reply Behavior

| # | Keputusan |
|---|---|
| D1 | Hybrid: General broadcast vs Area-Specific |
| D4 | Automation tidak menjawab follow-up — hanya first response |
| D10 | Auto-reply 1x per customer per incident (debounce) |
| D16 | Phase 1 sepenuhnya rule-based, bukan AI/LLM |
| D17 | Auto-reply tidak bergantung semantic interpretation isi pesan |
| — | Perubahan `odp_ids`/`odc_ids` saat ACTIVE tidak memicu re-broadcast ke yang sudah dibalas (PRD §5.3) |

## Reliability & Failure Handling

| # | Keputusan |
|---|---|
| D7 | Custpanel down/timeout → no auto-reply + escalate |
| D8 | Retry lookup 1–2x |
| D20 | Dedup berdasarkan message ID channel |
| D21 | Outbound send failure → log + manual follow-up |
| D22 | Default fail-safe → human handling |
| D39 | Debounce & message dedup via DB unique constraint, bukan check-then-insert |
| — | Lookup gagal (API down) di-log dengan flag `lookup_failed`, beda dari `no_match` (Addendum §4.5) |

## Data Model

| # | Keputusan |
|---|---|
| D24 | Conversation entity dibangun sejak Phase 1, bukan retrofit |
| D25 | Conversation inactivity window = 24 jam (selaras WA customer service window) |

## Human Handover & Operational

| # | Keputusan |
|---|---|
| D2 | Aktivasi mode gangguan manual (bukan otomatis dari monitoring) |
| D3 | Identifikasi customer via Custpanel API |
| D5 | Automation aktif semua shift, termasuk shift malam |
| D6 | Tidak ada auto-ticketing Phase 1 |
| D18 | Hak akses agent setara — tidak ada role bertingkat |
| D19 | Message Log retention 90 hari sementara |
| D30 | Escalate = pesan tetap di channel normal (WA Business App), tidak ada queue/ticket interface baru |
| D31 | Dashboard bukan agent reply interface — hanya incident management & log viewer |
| D32 | Tidak ada tagging/label status auto-reply di channel chat |
| D33 | Tidak ada SLA follow-up khusus setelah auto-reply |

## Tech Stack & Architecture (Prototype)

| # | Keputusan |
|---|---|
| D11 | Dashboard terpisah dari Custpanel |
| D12 | Auth login lokal |
| D13 | Architecture modular/scalable (Modular Monolith) |
| D37 | Stack prototype: Next.js (App Router) + TypeScript + Supabase (Postgres + Auth) |
| D38 | Channel prototype = Telegram via Channel Adapter interface; target production tetap WhatsApp |
| D40 | Cache wilayah pakai kolom timestamp + app logic, bukan Redis |
| D41 | RLS Supabase disederhanakan (authenticated = full access); service-role key dipisah dari client key |
| D42 | Domain logic (state machine, rule engine) di application layer, bukan DB trigger/function |

## Open Items (Belum Jadi Keputusan — Jangan Diimplementasikan Seolah Final)

- D23 — Rate limit Custpanel API & WhatsApp BSP masih open item
- Format/nilai asli `odp_id`/`odc_id` dari Custpanel
- Representasi final `estimated_recovery`
- Deployment platform production
- Konfirmasi Custpanel mengembalikan ODP + ODC sekaligus dalam satu response

---

*Bagian D1–D42 mencatat keputusan historis. Rekonsiliasi perilaku aktif ada di [PRD v2.0 §16](PRD.md#16-rekonsiliasi-keputusan); dokumen PRD lama tidak lagi tersedia dalam repository.*

## Draft Complaint Auto-Triage — D49–D58

Tanggal: 19 September 2026. Acuan historis saat pencatatan: Mini PRD v0.1 dan PRD lama §23 (keduanya sudah dihapus setelah konsolidasi). Acuan aktif: [PRD v2.0](PRD.md). D1–D42 tetap berlaku untuk Mass Outage. Arahan eksplisit pengguna dibedakan dari ASSUMPTION yang belum disetujui.

**Celah penomoran:** D43–D48 tidak ditemukan dalam repo. Enam temuan review sebelumnya bukan enam keputusan yang disetujui. Draft mulai D49 sesuai permintaan pengguna; entry baru berikutnya D59.

| ID | Draft keputusan dan alasan | Status / konsekuensi |
|---|---|---|
| D49 | Fase Complaint Auto-Triage: keyword koneksi, template tetap, setiap komplain masuk antrean + ringkasan. | Arahan eksplisit pengguna; tambahan scope, bukan pengganti Mass Outage. |
| D50 | Next.js App Router/TypeScript + Supabase Postgres/Auth; prototype Vercel/Telegram, produksi WhatsApp Cloud API melalui ChannelAdapter; domain pure TypeScript; tidak berhubungan dengan Upaznet Config & Command Generator. | Batas teknis eksplisit pengguna; deployment produksi belum final. |
| D51 | NetworkStatusProvider membungkus MockProvider/tabel dummy; OltProvider/NmsProvider ditunda. | Arahan eksplisit pengguna; kontrak vendor belum diketahui, tabel dummy belum tersedia dalam repo. |
| D52 | SHADOW tanpa send → LOS_ONLY → FULL; tanpa LLM. | Arahan eksplisit pengguna. ASSUMPTION A5: GENERIC hanya FULL, tidak replay backlog. |
| D53 | Episode triage terpisah, satu episode terbuka per pelanggan/sender sampai tutup manual; unique constraint satu balasan per episode. | ASSUMPTION A4 untuk menerjemahkan aturan 1 balasan/customer/insiden; bukan tabel mass incidents. |
| D54 | Antrean dashboard NEW/IN_PROGRESS/CLOSED, staf setara; unresolved sender tercatat, lainnya/ambigu masuk review. | ASSUMPTION A1/A3; mekanisme balas manual Telegram belum diputuskan. |
| D55 | Threshold fixture ≥3 LOS, rasio ≥50%, cakupan ≥80%; freshness 5 menit, timeout provider 2 detik. | ASSUMPTION A6/A8; parameter uji, bukan fakta ISP/vendor. |
| D56 | Mapping private-chat tester disiapkan staf; ID yang diketik bukan bukti kepemilikan. Template menyebut antrean/perangkat online, berlabel simulasi; detail area hanya staf. | ASSUMPTION A2/editorial dan usulan keamanan; identitas produksi masih OPEN. |
| D57 | Isolasi pengiriman triage dari Mass Outage selama uji; shadow boleh berdampingan. | ASSUMPTION A7; prioritas/shared debounce perlu keputusan sebelum keduanya mengirim. |
| D58 | Ingress/work item/send attempt durable; klaim terpisah dari sukses, send ambigu ke manual; mutasi backend tervalidasi dan audit dilindungi. | DRAFT usulan reliability/peninjauan akses D41 fase baru; worker Vercel dan pengecualian envelope handshake belum final. |

Konfirmasi/perubahan berikutnya dicatat lewat entry baru. ASSUMPTION tidak menjadi locked hanya karena memiliki nomor keputusan.

## Klarifikasi pengguna dan rekomendasi — D59–D64

Tanggal: 19 September 2026. Acuan historis saat pencatatan: Mini PRD v0.2 dan catatan desain awal (sudah dihapus setelah konsolidasi). Acuan aktif: [PRD v2.0](PRD.md). Entry lama dipertahankan sebagai histori; perubahan yang berlaku dijelaskan di bawah.

| ID | Keputusan / rekomendasi | Status dan hubungan histori |
|---|---|---|
| D59 | Antrean di dashboard; pelanggan menerima balasan Telegram pada prototype, WhatsApp pada produksi. | Arahan pengguna; memperjelas D54. Lokasi staf mengetik belum locked; rekomendasi composer dashboard. |
| D60 | Fixture area ≥3 LOS, ≥50% sampel valid, cakupan ≥80%; freshness 5 menit. | DISETUJUI untuk uji coba saja, mengonfirmasi bagian threshold/freshness D55. Timeout 2 detik tetap ASSUMPTION. |
| D61 | GENERIC tersedia sejak tahap balasan pertama; rollout SHADOW → LOS_AND_GENERIC → FULL. | Ketersediaan generik awal disetujui pengguna; menggantikan pembatasan GENERIC hanya FULL pada D52. Nama mode adalah pilihan dokumentasi. SHADOW tetap tidak mengirim; tanpa replay backlog masih ASSUMPTION. |
| D62 | Respons terkait gangguan FS/backbone/ODC/ODP tidak memerlukan aktivasi incident manual per kejadian. | Arah eksplisit pengguna, menggantikan usulan isolasi fungsional D57. Realisasinya melalui bukti mock/provider; bukan bukti otomatis tahu penyebab kabel putus. D2 tetap berlaku pada lifecycle manual lama. |
| D63 | Episode per masalah layanan; NEW/IN_PROGRESS/RESOLVED/CLOSED, reopen masalah sama tanpa reset, masalah berbeda dapat dipisahkan staf; event jaringan menautkan banyak complaints. | REKOMENDASI/ASSUMPTION, memperinci D53; belum keputusan pengguna. Debounce event tambahan dan aturan korelasi dijelaskan di catatan desain. |
| D64 | Evaluasi saat inbound, satu pengambil keputusan dan klaim outbound lintas kandidat; manual relevan → upstream valid → area LOS → individual → online/generik. Bukti upstream terpisah dari status ONU. | REKOMENDASI/ASSUMPTION, realisasi D62; prioritas belum disetujui. Monitoring kontinu/broadcast proaktif ditunda sebagai usulan scope. |

Entry baru berikutnya D65. D43–D48 tetap belum ditemukan; tidak diisi retrospektif.

## Konsolidasi prototype disetujui — D65–D69
Tanggal: 19 September 2026. Pengguna: “aku setuju dengan semua IDE mu itu” dan meminta satu PRD serta design system. Acuan aktif kini [PRD v2.0](PRD.md); dokumen sebelumnya adalah histori.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D65 | Terima rekomendasi episode D63, composer dashboard, evaluasi inbound dan prioritas D64; gabungkan Mass Outage dan triage dalam satu PRD. | DISETUJUI pengguna; menggantikan status rekomendasi sebelumnya. Queue/reply UI diterima, D30/D31 lama tidak berlaku pada produk terpadu. |
| D66 | Satu jalur outbound dengan klaim episode dan incident/event; GENERAL tetap tanpa lookup; no-match/unknown tidak klaim affected tetapi dapat menerima GENERIC. D41 diperketat ke mutasi backend/audit terlindungi, staf tetap setara. | Konsolidasi ide yang disetujui + detail guard implementasi; supersedes perilaku fail-silent lintas produk D7/D15 dan akses full-write D41. Manual lifecycle D2/D35/D36 tetap. |
| D67 | Provider/mock topologi/ONU/upstream, stable fixture event ID, rollout SHADOW → LOS_AND_GENERIC → FULL, tanpa backlog replay. Tidak ada koneksi OLT/NMS atau broadcast kontinu. | Baseline prototype; dummy threshold disetujui pada D60. Data vendor/arti FS dan korelasi event produksi tetap OPEN. |
| D68 | Runtime persisten, ACK setelah ingress+job, retry pasti maksimal 3 attempt, unknown tidak retry buta, pemicu recovery inbound/dashboard; retensi tidak menghapus claim aktif. | DEFAULT DESAIN prototype pada PRD §11; bukan SLA/vendor fact atau scheduler produksi. API aplikasi memakai envelope, handshake WhatsApp menjadi pengecualian protokol saat diimplementasikan. |
| D69 | PRD.md adalah satu acuan aktif; DESIGN_SYSTEM.md adalah baseline visual desktop-first dengan antrean/detail/evidence, semantic states dan aksesibilitas. Dokumen lama ditandai arsip; CLAUDE/README diarahkan ulang. | Konsolidasi diminta pengguna; warna/layout/breakpoint merupakan pilihan desain untuk implementasi, bukan brand resmi. |

Urutan berikutnya D70. D43–D48 tetap belum ditemukan; tidak diisi secara retrospektif. Default implementasi baru dapat ditinjau tanpa menghapus keputusan terdahulu.



## Seed dan direktori pelanggan foundation — D70

Tanggal: 20 September 2026. Pengguna meminta seed dummy dan implementasi halaman pelanggan.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D70 | Seed identitas/topologi idempoten dengan UUID tetap, satu transaksi, dan DO NOTHING; direktori `/dashboard/customers` read-only melalui sesi staf/RLS, pencarian nama/kode, filter status dan pagination 25. Status administrasi dibedakan dari status jaringan yang belum diperiksa. | IMPLEMENTASI sesuai permintaan. ASSUMPTION/pilihan fixture: 12 pelanggan + layanan, 1 ODC, 2 ODP (10/2 layanan), 4 identitas Telegram terverifikasi dummy dan 1 unverified. ID channel bukan ID Telegram nyata. Seed tidak membuat/mengubah akun Auth. ONU/upstream dan MockProvider menyusul, tanpa perubahan rule PRD. |

Entry berikutnya D71. Penomoran dan isi keputusan lama dipertahankan sebagai histori.


## Fokus operasional dan fondasi pemeriksaan — D71–D72

Tanggal: 20 September 2026.

| ID | Keputusan | Status / konsekuensi |
|---|---|---|
| D71 | Fokus produk Inbox Helpdesk + Auto-Triage + Konteks Jaringan. Tiket tetap dibuat manual oleh staf di Custpanel dari hasil pemeriksaan. Delegasi teknisi, pelaporan tiket dan finance tetap di Custpanel. Inbox/percakapan adalah landing target; direktori seluruh pelanggan merupakan fitur pendukung. | DISETUJUI eksplisit pengguna. Episode komplain bukan tiket teknisi kedua. Lookup data pelanggan nyata belum memiliki kontrak integrasi. |
| D72 | Fondasi NetworkStatusProvider/MockProvider, domain freshness/area, skenario terisolasi pada tabel mock, dampak upstream eksplisit berversi dan endpoint pemeriksaan read-only khusus staf. Tidak ada integrasi channel/pengiriman balasan pada tahap ini. | IMPLEMENTASI dalam scope pengguna. DEFAULT/ASSUMPTION: denominator layanan aktif dengan mapping current/area aktif; waktu evaluasi server, deadline provider total 2 detik; timestamp tidak direfresh saat membaca/seed ulang; refresh fixture eksplisit; skenario per request. Detail dan batas snapshot lintas query pada NETWORK_PROVIDER.md. |

Entry berikutnya D73. Ringkasan untuk disalin/referensi nomor tiket Custpanel masih usulan fitur berikutnya, bukan integrasi yang sudah dibuat.


## P1.1 — Resolusi identitas dan klasifikasi — D73

Tanggal: 21 September 2026. Pengguna meminta pengerjaan bertahap dimulai dari P1.1 dan rangkuman untuk review.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D73 | Implementasi read-only resolusi sender berdasarkan channel/account/sender, verified customer dan satu layanan; klasifikasi literal lima keyword PRD, hasil berversi dan safe reason. Tidak mengambil identitas dari isi chat. | IMPLEMENTASI dalam scope P1.1. ASSUMPTION/default: layanan ganda termasuk inactive → manual, customer/layanan inactive → manual; timeout 2 detik; normalisasi NFKC/huruf/spasi dan batas 10.000 unit UTF-16; hint ambigu error/wifi/internet/lemot/gangguan/mati → review. Batas literal matching dan hasil uji ada di P1_1_REVIEW.md. |

P1.2–P1.4 belum selesai. Entry berikutnya D74. Tidak ada keputusan baru tentang vendor, tiket Custpanel, atau pengiriman pesan.

## P1.2 — Decision engine kandidat template — D74

Tanggal: 21 September 2026. Pengguna meminta implementasi P1.2 setelah review rancangan.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D74 | Fungsi domain murni memilih satu kandidat sesuai prioritas PRD, memisahkan candidate/effective template key, memvalidasi ulang scope/freshness/threshold, dan menerapkan SHADOW/LOS_AND_GENERIC/FULL serta emergency stop. GENERAL satu-satunya pengecualian keyword; AREA tetap mensyaratkan komplain sesuai §4/§7. | IMPLEMENTASI P1.2. DEFAULT: mode kosong SHADOW; incident ACTIVE konflik/invalid → review; dispatchAuthorized selalu false. Mapping memakai batas 24 jam, observasi 5 menit. Event target yang diketahui dipertahankan, tidak mengarang event area. Detail review/pengujian pada P1_2_REVIEW.md. |

P1.3 lifecycle dan P1.4 transaksi/claim menyusul. P1.2 belum menyediakan renderer/template management, runtime outbound atau otorisasi dispatch. Entry berikutnya D75.

## P1.3 — Lifecycle episode dan kebijakan asosiasi — D75

Tanggal: 21 September 2026. Pengguna meminta implementasi P1.3 setelah review P1.2.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D75 | Fungsi domain murni untuk state machine episode (NEW/IN_PROGRESS/RESOLVED/CLOSED), kebijakan asosiasi pesan ke episode, derivasi scope dari identity P1.1, split oleh staf, dan suppression automation intent. CLOSED final; reopen hanya dari RESOLVED; debounce tidak direset; suppression tidak dihapus oleh reopen/mode/conversation. Sender tanpa identityId menghasilkan review bukan scope semu. Scope "service" berbeda tidak pernah digabung. | IMPLEMENTASI P1.3. DEFAULT: expectedVersion dikembalikan untuk P1.4 optimistic locking; most_recent_closed dipilih berdasarkan version tertinggi; split mewarisi scope sumber. ASSUMPTION: isFirstMessageOnEpisode disuplai caller dari application layer. suppressAutomationIntent adalah intent domain; pembatalan in-flight adalah tanggung jawab P1.4. Detail pada P1_3_REVIEW.md. |

P1.4 persistence/migration/transaksi/claim/concurrency menyusul. Entry berikutnya D76.

## Revisi P1.3 setelah review — D76

Tanggal: 22 September 2026. Pengguna meminta perbaikan P1.3, pembersihan kode/komentar, dan tidak menjalankan test atau pemeriksaan otomatis.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D76 | Kontrak episode-lifecycle-v2: command membawa expectedVersion dari request; hasil accepted/noop/rejected, perubahan dan audit terstruktur; closedAt menentukan riwayat dengan ID sebagai tie-break; perubahan scope identitas diarahkan ke rekonsiliasi; primary atau target eksplisit menentukan association; reopen inbound terpisah dari aktor staf. | Menggantikan default D75 tentang versi dan pemilihan riwayat. DEFAULT konservatif: reopen keluhan pada RESOLVED membutuhkan target masalah sama yang dipercaya; kombinasi open/resolved tanpa target masuk review. Split staf bukan primary dan menonaktifkan automation; resolve/close staf juga menonaktifkannya. Test diperbarui tetapi tidak dijalankan, termasuk lint/typecheck/build. Detail, batas kepercayaan dan langkah verifikasi ada di EPISODE_LIFECYCLE.md. |

P1.4 tetap diperlukan untuk persistence, primary constraint, rekonsiliasi claim, atomic update/audit dan concurrency. Entry berikutnya D77.

## P1.4 — Persistence dan transaksi — D77

Tanggal: 22 September 2026. Pengguna meminta implementasi P1.4 tanpa menjalankan test/pemeriksaan dan review minimal.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D77 | Driver pg untuk transaksi satu koneksi; READ COMMITTED + satu advisory lock mutasi prototype; migration episode/ingress/job/assessment/claim/outbound/audit; savepoint reservasi episode+event; request idempotency dan versi staf; rekonsiliasi ledger identity/customer. | IMPLEMENTASI belum diverifikasi runtime. DEFAULT konservatif: linking mempertahankan episode/claim, memilih primary layanan yang sudah ada dan menonaktifkan automation pada episode terkait; pending dibatalkan, in-flight dilaporkan. Split menaikkan versi sumber. Manual reply hanya antrean tersimpan, bukan send. Snapshot mode/emergency saat receipt tidak dilonggarkan. Review: P1_4_REVIEW.md. |

Migration dan seluruh test/lint/build diserahkan kepada pengguna. P2/P3 tetap diperlukan untuk webhook, conversation, worker/recovery, UI dan dispatch. Entry berikutnya D78.

## Baseline Desain Sistem dan Token UI Terpusat — D78

Tanggal: 25 September 2026. Penyelarasan arah desain visual sebelum implementasi P0.10.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D78 | Penyelarasan arah desain visual: identitas navy (`#003C71`), aksen brand hijau (`#00A651`), tombol aksi terkalibrasi kontras (`#007A3D`, hover `#006633`); pemisahan token warna dua lapisan (palet dasar primitives dan pemetaan semantik); tipografi Geist Sans dan Geist Mono dengan hierarki terdefinisi (display 24px sampai micro 10px, tanpa micro-tight 9px); pemakaian komponen standar; serta validasi rasio kontras WCAG 2.2 AA. | BASELINE DOKUMENTASI untuk P0.10. Menggantikan baseline visual awal D69. DEFAULT/BATASAN: #00A651 dan #008C44 dilarang untuk latar tombol teks putih normal (kontras 3,19:1 & 4,34:1 < 4,5:1); #64748B dilarang untuk teks normal pada rail-bg (kontras 4,34:1); focus.ring #2563EB pada navy diganti ring terang. Hijau brand bukan bukti jaringan sehat. Token belum diimplementasikan di kode CSS/font; implementasi dilakukan pada task P0.10. Detail lengkap di [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) v2.0. |

P0.10 tetap Not Started sampai token diimplementasikan di CSS. Entry berikutnya D79.
