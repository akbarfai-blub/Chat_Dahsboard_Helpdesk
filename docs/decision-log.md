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

## Implementasi Token UI Terpusat dan Pemuatan Font — D79

Tanggal: 26 September 2026. Implementasi P0.10 pada CSS dan layout root.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D79 | Implementasi token UI terpusat dua lapisan di `app/globals.css`, integrasi `@theme` Tailwind CSS v4, pemuatan font Geist & Geist Mono via `next/font/google` di `app/layout.tsx`, penetapan token `--focus-ring-color-navy: #ffffff` (kontras 11,14:1 terhadap navy #003C71), serta dukungan `prefers-reduced-motion`. | IMPLEMENTASI P0.10 SELESAI. DEFAULT: ring fokus pada navy ditetapkan ke #FFFFFF (kontras 11,14:1); fallback font Sans menggunakan Arial, sans-serif; fallback font Mono menggunakan ui-monospace, monospace; layout dashboard P0.11 tetap pekerjaan terpisah. Detail dan bukti verifikasi pada P0_10_REVIEW.md. |

P0.10 selesai (Done). Layout antrean dan shell dashboard menyusul pada P0.11. Entry berikutnya D80.

## Layout Dasar Aplikasi dan Dashboard — D80

Tanggal: 26 September 2026. Implementasi P0.11 pada layout bersama dashboard dan navigasi responsif.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D80 | Implementasi layout shell bersama dashboard (`app/dashboard/layout.tsx` dan `components/layout/dashboard-shell.tsx`) dengan desktop sidebar lebar 216px navy `#003C71`, topbar tinggi 64px, area konten fleksibel tanpa batas `max-w` sempit, identitas "Upaznet Helpdesk" dan penanda "Prototype · Data dummy". Navigasi menyajikan route yang tersedia (`/dashboard` dan `/dashboard/customers`) dengan penanda `aria-current="page"` dan border aksen hijau, serta menyajikan menu yang belum dibangun (Inbox, Gangguan, Template, Log, Pengaturan) sebagai item noninteraktif dengan badge "Belum tersedia". Viewport sempit (<1024px) menggunakan drawer modal aksesibel dengan focus trap, penutupan Escape, pengembalian fokus ke pemicu, dan scroll lock bersih. Proteksi sesi server-side dan Server Action logout dipertahankan. | IMPLEMENTASI P0.11 SELESAI. DEFAULT: Landing `/dashboard` menyajikan ringkasan workspace jujur dan tautan direktori pelanggan tanpa fabrikasi metrik/antrean; halaman `/dashboard/customers` diintegrasikan ke layout bersama tanpa duplikasi aside/header. Review dan bukti: docs/P0_11_REVIEW.md. |

P0.11 selesai (Done). Entry berikutnya D81.

## ChannelAdapter Inbound Telegram dan Pembatasan Tester — D81

Tanggal: 29 September 2026. Implementasi P2.1 ChannelAdapter inbound Telegram dan pembatasan tester.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D81 | Kontrak ChannelAdapter memisahkan normalisasi pesan channel dari domain logic dan persistence. Normalisasi identitas Telegram: `channel="telegram"`, `channelAccountId` disuplai dari konfigurasi tepercaya server (bukan dari payload), `senderExternalId` dari `from.id` numerik, `chatId` dari `chat.id`, dan `providerMessageId` dari `message_id`. Username Telegram tidak digunakan sebagai identitas tepercaya. Pembatasan tester: hanya `chat.type === "private"` dan pengirim dalam `testerAllowlist` yang diterima (`accepted`); grup/supergroup/channel atau allowlist kosong ditolak (`rejected`, fail-closed). Update `edited_message` dan tipe update non-pesan lainnya ditandai `unsupported` agar tidak memicu duplikasi atau siklus lifecycle sembarangan. Pesan media valid (foto, dokumen, suara, dsb.) diterima dengan mempertahankan metadata tipe pesan untuk review staf, dengan `receipt.text` diisi caption bila ada atau string kosong `""` bila tanpa caption, tanpa mengarang teks pelanggan. Batas ukuran: payload mentah maksimal 64 KB (65.536 byte) yang dapat divalidasi pre-parse, teks maksimal 4.096 karakter, dan caption maksimal 1.024 karakter. | IMPLEMENTASI P2.1 SELESAI. DEFAULT: pesan non-teks tester tanpa caption diteruskan dengan `receipt.text=""` agar persistence dapat mencatat ingress untuk review staf tanpa mengarang teks pelanggan; allowlist kosong memblokir seluruh pesan masuk (fail-closed); adapter murni in-memory tanpa I/O jaringan, mutasi DB, atau triage domain. Detail dan bukti: docs/P2_1_REVIEW.md. Entry berikutnya D82. |

## Koreksi Batas Tanggal, Fail-Closed Allowlist, dan Batas Metadata P2.1 — D82

Tanggal: 29 September 2026. Penutupan temuan review P2.1.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D82 | 1. **Batas representasi tanggal Telegram**: `message.date` divalidasi terhadap batas atas representasi tanggal ECMAScript (`MAX_TELEGRAM_DATE_SECONDS = 8_640_000_000_000` detik atau 100.000.000 hari sejak epoch). Nilai di luar rentang safe integer positif atau melebihi batas tersebut (termasuk `Number.MAX_SAFE_INTEGER`) dikembalikan sebagai `outcome: "rejected"` dengan alasan terstruktur `invalid_payload_structure` dan konversi `toISOString()` dicegah melempar exception `RangeError`. Tanpa membatasi usia pesan lampau atau menolak tanggal masa depan dalam batas representasi. <br>2. **Fail-closed konfigurasi tester allowlist**: Helper `parseTesterAllowlist()` dan constructor `TelegramChannelAdapter` menerapkan fail-closed penuh. Konfigurasi campuran (misal `"987654321,not_a_number"`), token kosong (`",,"`), atau ID non-numerik/non-safe-integer langsung melempar exception `Error` pada saat startup/parsing, bukan mengabaikan secara diam-diam dan menerapkan allowlist parsial. Allowlist kosong tetap merupakan konfigurasi valid yang menolak seluruh pesan masuk pada runtime (`empty_tester_allowlist`). <br>3. **Batas metadata dan persistence**: Metadata kaya (`messageType`, `hasMedia`, `caption`, `isForwarded`, `sentAt`, `senderInfo`) hanya berada pada objek `result.normalized`. Kontrak `result.receipt` kompatibel secara struktural dengan `HelpdeskPersistence.receive()`, namun pemanggilan `receive()` saja saat ini belum menyimpan metadata tersebut ke dalam `ingress_events`. Pesan terusan (*forwarded*) saat ini hanya mencatat penanda boolean `isForwarded`, bukan rincian asal penerusan (*forward origin*). Penerusan dan penyimpanan metadata ke database persistence menjadi kebutuhan integrasi berikutnya (P2.2). | IMPLEMENTASI KOREKSI P2.1 SELESAI. DEFAULT: input tanggal di luar batas representasi tidak melempar error dan ditolak terstruktur; konfigurasi allowlist tidak valid menggagalkan proses (fail-closed); klaim ketersediaan metadata persisten untuk review staf ditangguhkan hingga integrasi persistence P2.2. Review dan bukti: docs/P2_1_REVIEW.md. Entry berikutnya D83. |

## Webhook Telegram dengan Secret dan ACK Persisten — D83

Tanggal: 29 September 2026. Implementasi P2.2 Webhook Telegram dengan secret dan ACK persisten.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D83 | 1. **Endpoint & Otentikasi Webhook**: `POST /api/webhooks/telegram` memvalidasi header `X-Telegram-Bot-Api-Secret-Token` terhadap konfigurasi server `TELEGRAM_WEBHOOK_SECRET` secara timing-safe. Secret kosong, tidak cocok, atau tidak dikonfigurasi gagal tertutup (*fail-closed*) dengan HTTP 401 Unauthorized sebelum pembacaan body selesai atau ada mutasi basis data. Endpoint webhook terpisah dari sesi staf. <br>2. **Perlindungan Memori & Streaming Body**: Request body dibaca secara streaming (`readLimitedRequestBody`) dengan batas keras 64 KB (`DEFAULT_MAX_PAYLOAD_BYTES`). Stream langsung dibatalkan (*early abort*) jika akumulasi byte melebihi batas, termasuk jika `Content-Length` tidak tersedia atau dipalsukan, menghasilkan HTTP 413 Payload Too Large. <br>3. **Pemetaan Respons & Semantik ACK Telegram**: Malformed JSON menghasilkan HTTP 400 Bad Request; update tak didukung (`edited_message_ignored`, `unsupported_update_type`) dan penolakan kebijakan tester (`not_in_tester_allowlist`, `non_private_chat`, `empty_tester_allowlist`) mengembalikan HTTP 200 dengan status `ignored`/`rejected` tanpa mutasi DB agar Telegram tidak melakukan retry tanpa batas; pesan diterima mengembalikan HTTP 200 (`accepted`, `duplicate: false/true`) hanya setelah ingress dan job committed; kegagalan basis data/transaksi mengembalikan HTTP 500 PERSISTENCE_FAILED agar Telegram dapat melakukan retry berkala. <br>4. **Penyimpanan Metadata Atomik (Resolusi D82)**: Migration `20260929100000_add_ingress_metadata.sql` menambahkan kolom `message_type`, `has_media`, `is_forwarded`, `caption`, `sent_at`, dan `sender_info` pada tabel `ingress_events`. Kontrak `InboundReceipt` diperluas dengan field opsional `metadata?: InboundMessageMetadata`. Metadata disimpan atomik bersama ingress event dan `processing_jobs` (`status = 'pending'`). `sent_at` dipisahkan secara eksplisit dari `received_at` server. <br>5. **Idempotensi & Isolasi Dedup**: Dedup ditegakkan atomik oleh unique constraint `(channel, account_id, chat_id, provider_message_id)`. Duplikat sekuensial maupun paralel (5 request bersamaan) menghasilkan tepat 1 baris ingress dan 1 baris job, mengembalikan `duplicate: true` dengan ID ingress yang sama tanpa menimpa metadata atau timestamp asli. Message ID yang sama pada chat atau akun bot berbeda diisolasi secara terpisah. <br>6. **Non-interferensi Jalur ACK**: Jalur webhook tidak pernah mengeksekusi network status provider, evaluasi triage, worker background, atau pengiriman outbound. | IMPLEMENTASI P2.2 SELESAI. DEFAULT: Secret webhook dan bot account ID diverifikasi di server; update non-tester/unsupported di-ACK 200 tanpa mutasi DB untuk mencegah retry loop Telegram; metadata tersimpan persisten secara atomik; isolasi dan dedup teruji pada Postgres lokal. Detail dan bukti: docs/P2_2_REVIEW.md. Entry berikutnya D84. |

## Koreksi Inisialisasi Database Lazy, Bukti Rollback, dan Batas Klaim P2.2 — D84

Tanggal: 29 September 2026. Koreksi terbatas penanganan inisialisasi database dan batas klaim P2.2.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D84 | 1. **Inisialisasi Persistence Lazy**: Pada `app/api/webhooks/telegram/route.ts`, pemanggilan pool database `getHelpdeskPool()` dipindahkan ke dalam lazy factory (`defaultPersistenceFactory`) yang hanya dieksekusi setelah verifikasi secret token dan validasi ukuran stream body berhasil. Secret yang salah/hilang/kosong langsung menghasilkan HTTP 401 Unauthorized tanpa memanggil factory database, bahkan jika konfigurasi database tidak tersedia atau bermasalah. <br>2. **Pembedaan Error Konfigurasi vs Transien**: Kegagalan inisialisasi database (misal `HELPDESK_DATABASE_URL` kosong atau connection error saat startup) menghasilkan HTTP 500 dengan kode aman `DATABASE_UNAVAILABLE` dan pesan generik tanpa mengekspos connection string, kredensial, atau stack trace. Kegagalan selama eksekusi transaksi database menghasilkan HTTP 500 `PERSISTENCE_FAILED` untuk memicu retry Telegram. <br>3. **Bukti Rollback PostgreSQL Nyata**: Pengujian integrasi lokal memvalidasi skenario rollback terarah: saat controlled failure disuntikkan pada tahap `insert into public.processing_jobs` (setelah `ingress_events` dan metadata dieksekusi dalam transaksi aktif), transaksi di-rollback penuh oleh PostgreSQL, dibuktikan via koneksi independen bahwa 0 baris parsial tersimpan di `ingress_events`. Ketika fault dilepas dan pesan yang sama dikirim ulang, tepat 1 baris ingress dan 1 baris job berhasil committed, dan pengiriman duplikat berikutnya tidak menambah data. <br>4. **Batas Ketidakpastian Commit**: Diakui bahwa jika kegagalan terjadi akibat diskoneksi jaringan saat fase `COMMIT`, hasil akhir transaksi pada server PostgreSQL mungkin tidak dapat dipastikan seketika (*uncertain*). Respons non-success dan mekanisme dedup berbasis unique constraint menjamin pengiriman ulang (*retry*) oleh Telegram tetap aman dari duplikasi data atau pekerjaan ganda. | KOREKSI P2.2 SELESAI. DEFAULT: Factory pool DB dieksekusi secara lazy setelah verifikasi secret; kegagalan inisialisasi menghasilkan HTTP 500 DATABASE_UNAVAILABLE tanpa membocorkan info koneksi; bukti rollback terarah terverifikasi pada Postgres lokal. Detail dan bukti: docs/P2_2_REVIEW.md. Entry berikutnya D85. |

P2.2 selesai (Done). Entry berikutnya D85.

Klarifikasi bukti D84: pemeriksaan rollback dilakukan melalui pool.query() di luar transaksi yang telah selesai; pengujian tidak menjamin penggunaan koneksi fisik berbeda.

## Conversation 24 Jam, Pengaitan Riwayat Pesan, dan Pemisahan Episode — D85

Tanggal: 29 September 2026. Implementasi P2.3 Conversation 24 jam dan pengaitan riwayat pesan.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D85 | 1. **Pengelompokan Conversation 24 Jam Berbasis Inactivity (Sliding Window)**: Conversation dikelompokkan secara deterministik menggunakan jeda inaktivitas 24 jam (`CONVERSATION_INACTIVITY_THRESHOLD_MS = 86_400_000` ms). Inactivity dihitung dari aktivitas relevan terakhir (`last_activity_at`), bukan usia pembuatan (`started_at`). Pesan dengan selisih waktu `< 24 jam` dari aktivitas terakhir bergabung ke conversation yang sama dan memperbarui `last_activity_at`. Batas baku yang ditetapkan: jeda `>= 24 jam` (tepat 24 jam atau lebih) menutup conversation sebelumnya (`status = 'closed'`) dan memulai conversation baru (`status = 'active'`). <br>2. **Dasar Waktu Ingress**: Penentuan batas jeda murni menggunakan waktu penerimaan server yang sudah tersimpan (`received_at`), bukan waktu klaim kirim payload (`sent_at`) ataupun waktu worker berjalan. <br>3. **Scope & Isolasi Eksplisit**: Scope conversation terikat spesifik pada tuple `(channel, account_id, chat_id, identity_id)`. Pesan pada chat, akun bot, atau channel berbeda terisolasi sepenuhnya dalam conversation terpisah. <br>4. **Pemisahan Penuh dari Complaint Episode (Decoupling)**: Conversation adalah wadah sesi komunikasi, terpisah dari siklus hidup masalah (*complaint episode*). Pergantian conversation akibat jeda >= 24 jam TIDAK mereset status episode, tidak menduplikasi episode aktif, tidak mereset debounce, dan tidak memberikan jatah balasan otomatis baru. <br>5. **Preservasi Riwayat Non-Komplain & Media Tanpa Teks**: Pesan `/start`, percakapan umum (chitchat), identitas belum terhubung, maupun media tanpa caption tetap disimpan dan dapat diambil melalui riwayat conversation (`getConversationHistory`) dengan metadata asli (`messageType`, `hasMedia`, `caption`), tanpa mengarang teks pelanggan dan tanpa membuat tiket/episode palsu. <br>6. **Out-of-Order Deterministik & Non-Interferensi Jalur Webhook**: Pesan yang diproses dengan urutan acak/berbeda dikelompokkan secara deterministik. Jalur ACK webhook tetap cepat (hanya `ingress_events` + `processing_jobs`). Pengaitan conversation dieksekusi pada jalur pemrosesan internal (`HelpdeskPersistence.process()`), sehingga pesan pending/lama otomatis diasosiasikan saat diproses tanpa batch replay massal. <br>7. **Akses Terbatas & Batas Scope**: Pengambilan riwayat dibatasi pada jalur internal aplikasi/staf; tidak dibuka ke akses publik anonim dan tidak ada izin tulis dari browser. P2.3 belum membangun UI inbox dashboard. | IMPLEMENTASI P2.3 SELESAI. DEFAULT: jeda inaktivitas >= 24 jam (86.400.000 ms) dari aktivitas terakhir memicu conversation baru; conversation sebelumnya ditandai closed; waktu berbasis received_at; episode dan debounce sepenuhnya terpisah dari lifecycle conversation; jalur ACK webhook tetap cepat tanpa interferensi; unit test domain (11 passed) dan integrasi PostgreSQL lokal (12 passed) membuktikan seluruh skenario. Detail dan bukti: docs/P2_3_REVIEW.md. Entry berikutnya D86. |

## Rekonsiliasi Bridging, Worker-Order Independency, dan Scope Identitas P2.3 — D86

Tanggal: 30 September 2026. Koreksi determinisme pengelompokan conversation P2.3 berdasarkan temuan review.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D86 | 1. **Worker-Order Independency & Bridging Reconciliation**: Kelompok akhir conversation ditentukan secara murni oleh urutan `received_at` dan aturan inaktivitas 24 jam (< 24 jam menyambung, >= 24 jam memisahkan), bukan urutan worker memproses pesan. Pesan penghubung yang tiba/diproses belakangan (misal 0h, 40h diproses lebih awal lalu 20h diproses kemudian) memicu aksi domain `merge` di mana conversation sebelumnya (`closestPrior`) menyerap conversation berikutnya (`closestFuture`). Di lapisan repository/persistence, pesan pada `public.messages` direparent ke ID conversation yang bertahan, referensi `processing_result->>'conversationId'` pada `public.triage_assessments` dimutasi atomik via `jsonb_set`, dan container conversation yang terserap dihapus tanpa meninggalkan referensi usang. <br>2. **Status Aktif Objektif Berdasarkan Urutan Waktu**: Hanya conversation dengan aktivitas paling baru dalam scope (`max(lastActivityAt)`) yang berstatus `active`. Pesan historis yang tiba terlambat dibuat/diperbarui dengan status `closed` dan TIDAK menutup atau merebut status aktif kelompok yang lebih baru. <br>3. **Penyelarasan Penuh Scope Identitas**: Scope conversation ditegakkan secara konsisten pada tuple `(channel, account_id, chat_id, identity_id)`. Pesan dari identitas berbeda pada chat yang sama (seperti grup Telegram) terisolasi secara mandiri dalam conversation masing-masing tanpa bercampur atau saling menutup status aktif. <br>4. **Preservasi Klaim & Debounce Lintas Transisi**: Transisi conversation maupun rekonsiliasi penggabungan tidak memicu evaluasi bisnis ulang dan tidak mereset klaim yang telah terpakai. Baris klaim pada `public.reply_claims` dan draft pada `public.outbound_intents` tetap utuh (tepat 1 baris) tanpa reservasi ganda. <br>5. **Rekonsiliasi Migration Dua Tahap**: Migration awal `20260929200000_create_conversation_persistence.sql` dipulihkan ke versi penerapan awal (RESTRICT FKs). Penyesuaian FK (`ON DELETE CASCADE` pada identity, `ON DELETE SET NULL` pada message) dan penambahan indeks composite `conversations_scope_identity_activity` diterapkan melalui migration lanjutan `20260929200001_adjust_conversation_foreign_keys.sql`. Keduanya tercatat resmi pada `supabase_migrations.schema_migrations` dan terverifikasi aman melalui uji eksekusi berurutan pada schema uji terisolasi. <br>6. **Bukti Rollback & Konkurensi Terarah**: Pengujian kegagalan terkontrol ditargetkan secara presisi pada `INSERT INTO public.triage_assessments` setelah manipulasi conversation dan message selesai dalam transaksi, dibuktikan dengan marker urutan `reachedInsertTriageAssessment`. Pemeriksaan di luar transaksi membuktikan 0 mutasi parsial committed, job tetap `pending`, retry berhasil idempoten, dan rollback pada aksi merge tidak merusak state conversation sebelumnya. Pemrosesan paralel pada pesan yang sama maupun berbeda terbukti bebas duplikasi atau fragmentasi kelompok. | KOREKSI P2.3 SELESAI. DEFAULT: Pengelompokan worker-order independent terbukti identik pada permutasi urutan 0/20/40, pesan historis tidak merebut status aktif, scope identitas ditegakkan penuh, klaim dan debounce tetap terjaga, rollback terarah terbukti bersih, dan migration terdaftar konsisten. Detail dan bukti: docs/P2_3_REVIEW.md. Entry berikutnya D87. |

P2.3 selesai (Done). Entry berikutnya D87.

Klarifikasi istilah D86: Pada migration awal 20260929200000, batasan foreign key menggunakan default PostgreSQL NO ACTION (tanpa klausa ON DELETE eksplisit), bukan RESTRICT eksplisit; penyesuaian perilaku delete (CASCADE pada identity_id dan SET NULL pada conversation_id) serta composite index diresmikan melalui migration 20260929200001.

