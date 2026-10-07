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

## Isolasi Fixture dan Pengamanan Pengujian P2.4 — D87

Tanggal: 30 September 2026. Koreksi pengamanan pengujian P2.4 setelah temuan penghapusan data produksi (ingress_events).

| ID | Keputusan | Status / dampak |
|---|---|---|
| D87 | 1. **Guard _Fail-Closed_**: Skrip pengujian tidak boleh mengubah atau menghapus data jika target database bukan test environment. Fungsi `requireIsolatedDatabase(pool)` memeriksa `SELECT current_database()` dan menolak eksekusi jika nama database tidak memuat kata `test` atau `temp`.<br>2. **Penghapusan Delete Global**: Tidak ada pemanggilan fungsi yang mendelete keseluruhan tabel (`DELETE FROM table`). Pengamanan isolasi dilakukan per ID entitas spesifik yang dibentuk tes.<br>3. **Isolasi Namespace Fixture Jaringan**: Pembuatan fixture network mock mematuhi pembuatan *scenario* secara spesifik (ID: `p24-<UUID>`) serta *mock_onu_status* mandiri, bukan merubah timestamp state mock bawaan (scenario `normal`) secara global. <br>4. **Cleanup via _Finally_**: Cleanup per-tes dieksekusi urut secara aman melalui _finally_ agar jika tes gagal/error unhandled, cleanup tetap dieksekusi atau dilempar sebagai test failure tanpa menghapus state test lain maupun database utama. | PENGAMANAN PENGUJIAN P2.4 (Tahap 1) SELESAI. DEFAULT: Target selain test/temp ditolak fail-closed; tes D87 diselesaikan, integrasi penuh (Tahap 2) dengan database khusus (misal `helpdesk_test`) menunggu tahapan terpisah. Data `ingress_events` lama pengguna dihapus dari tes lama (recovery offline manual jika dibutuhkan). Review: docs/P2_4_REVIEW.md. Entry berikutnya D88. |

## Koreksi Pengamanan Isolasi Pengujian dan Validasi Lingkungan — D88

Tanggal: 30 September 2026. Koreksi mendalam atas pengamanan pengujian D87.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D88 | 1. **Guard Verifikasi Konfigurasi Eksplisit**: Guard `requireIsolatedDatabase()` mensyaratkan variabel lingkungan spesifik (`HELPDESK_TEST_DATABASE_URL`, `HELPDESK_TEST_API_URL`, `HELPDESK_TEST_SERVICE_ROLE_KEY`). Nama target database `postgres` dan API URL default `127.0.0.1:54321` ditolak (*fail-closed*), menjamin bahwa pengujian menargetkan lingkungan tes (PostgreSQL dan provider Supabase) yang sama dan disiapkan eksplisit.<br>2. **Cleanup Terarah (Leaf-to-Root)**: `cleanupFixture()` melacak dan menghapus fixture dari tabel daun ke akar (`complaint_evidence_links`, `reply_claims`, `complaint_audit_log`, `triage_assessments`, `outbound_intents`, `messages`, `reply_owners`, `complaints`, `conversations`, `processing_jobs`, `ingress_events`, `channel_identities`) dengan toleransi kegagalan tanpa menelan pesan *error* utama.<br>3. **Isolasi Lingkungan Global**: *Singleton* `automation_settings` dan objek environment `process.env` dicatat sebelum setup pengujian dan dipulihkan sepenuhnya di blok terluar `finally` tanpa merusak state saat gagal. | KOREKSI PENGAMANAN P2.4 SELESAI. DEFAULT: Eksekusi otomatis dilewati tanpa mutasi jika variabel `HELPDESK_TEST_*` kosong. Data pengguna terdahulu dilaporkan tidak ditemukan tanpa penetapan kepastian pemulihan selain arsip backup eksternal tak diverifikasi. P2.4 status `In Progress`. Review dan bukti guard test (`test-guard.test.ts`) ada di `docs/P2_4_REVIEW.md`. Entry berikutnya D89. |

P2.4 masih dalam tahap penyelesaian dengan kebutuhan database terisolasi. Entry berikutnya D89.

## Koreksi Mekanisme Guard Verifikasi Pasangan Target, Lifecycle State Terarah, dan Cleanup Resilien P2.4 — D89

Tanggal: 1 Oktober 2026. Koreksi mendalam atas pengamanan pengujian D88 berdasarkan temuan review.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D89 | 1. **Validasi Pra-Koneksi & Pembuktian Target Ganda (PG + Supabase API)**: Konfigurasi pengujian (`HELPDESK_TEST_DATABASE_URL`, `HELPDESK_TEST_API_URL`, `HELPDESK_TEST_SERVICE_ROLE_KEY`, `HELPDESK_TEST_ENV_MARKER`) diurai dan divalidasi sebelum koneksi apapun dibuat. Konfigurasi kosong atau invalid langsung ditolak (*fail-closed*) tanpa inisialisasi Pool atau Client provider. Target database pengguna dan alias loopback (`localhost`, `127.0.0.1`, `::1`, `0.0.0.0` pada port 5432/54322 dengan DB `postgres` serta port API 54321) ditolak secara preventif. Pembuktian isolasi dan kesamaan target dilakukan *read-only* melalui pembacaan marker lingkungan setup (`mock_network_scenarios` dengan token terverifikasi) melalui PostgreSQL Pool dan query nyata Supabase Client (`maybeSingle()`). Pasangan yang tidak cocok atau gagal membaca marker yang sama langsung ditolak.<br>2. **Lifecycle State & Tracking Terarah**: Pola penggantian seluruh `process.env` digantikan oleh `EnvRestorer` yang hanya menyimpan variabel yang diubah (`NETWORK_SCENARIO_ID`) dan memulihkan nilainya (atau delete jika awalnya tidak ada). Seluruh resource yang dibuat (termasuk data pembanding/baseline sejak langkah pertama) dicatat dalam `TestResourceTracker` sehingga kegagalan sebagian pada setup tetap memicu pembersihan resource yang sudah terlanjur dibuat. Penutupan pool dan pemulihan `automation_settings` dijamin dalam blok `finally` terluar. Error utama tes dipertahankan dan error cleanup diakumulasikan via `combineErrors` (`AggregateError`) tanpa saling menutupi.<br>3. **Cleanup Resilien Berbasis Relasi**: `cleanupFixture` menangani parameter majemuk secara dinamis (parameter pertama kosong seperti `ownerIds` tidak melewatkan penghapusan parameter kedua seperti `complaintIds`). Kegagalan discovery atau penghapusan satu entitas tidak menghentikan pembersihan entitas independen lainnya. Namespace acak unik (`runId`) diterapkan pada account dan sender untuk mencegah benturan konkurensi.<br>4. **Status Verifikasi & Pelaporan**: Pengamanan kode terbukti via stub/spy pada `tests/utils/test-guard.test.ts` (9 tests passed, exit code 0). Pengujian integrasi `orchestration.test.ts` secara eksplisit ditandai `skipped` (`t.skip()`) saat konfigurasi tes belum disediakan, bukan passed semu. Status P2.4 tetap In Progress sampai database tes nyata terisolasi disediakan. | KOREKSI PENGAMANAN P2.4 SELESAI. DEFAULT: Pengamanan kode teruji dengan stub; isolasi dan cleanup database nyata belum diverifikasi. Status P2.4: `In Progress`. Entry berikutnya D90. |

P2.4 tetap In Progress menunggu penyediaan database tes terisolasi. Entry berikutnya D90.

## Verifikasi Database Nyata Terisolasi dan Orkestrasi Inbound ke Assessment SHADOW (P2.4) — D90

Tanggal: 1 Oktober 2026. Penyiapan lingkungan tes terisolasi, penutupan verifikasi database nyata tahap pertama, dan penyelesaian orkestrasi pemrosesan inbound ke assessment SHADOW (P2.4).

| ID | Keputusan | Status / dampak |
|---|---|---|
| D90 | 1. **Lingkungan Pengujian Terisolasi**: Lingkungan Supabase lokal khusus pengujian (`Chat_Automation_Helpdesk_Test`, port API 54331, port PostgreSQL 54332) disiapkan secara independen tanpa mengganggu atau memutasi database pengguna (`Chat_Automation_Helpdesk` pada 54321/54322). Seluruh 7 migration schema aktif, seed foundation, fixture jaringan, dan marker isolasi unik (`mock_network_scenarios` dengan token terverifikasi) diterapkan. Konfigurasi dideklarasikan secara eksplisit dalam `.env.test`. Guard `requireIsolatedDatabase()` membuktikan PostgreSQL dan Supabase API membaca marker identik sebelum mutasi dijalankan. <br>2. **Verifikasi Cleanup & Isolasi Database Nyata (Tahap 1 Ditutup)**: Eksekusi nyata `receive()` dan `process()` membuktikan pembentukan grafik entitas lengkap (`ingress_events`, `processing_jobs`, `messages`, `conversations`, `complaints`, `triage_assessments`, `complaint_audit_log`). Cleanup terarah berbasis relasi daun-ke-akar (`cleanupFixture()`) membuktikan 100% entitas fixture uji terhapus bersih sementara data identitas baseline pembanding tetap utuh tanpa mutasi. Skenario controlled failure sebelum transaksi membuktikan pembersihan fixture tanpa kebocoran koneksi pool. <br>3. **Orkestrasi Inbound Internal & Idempotensi (P2.4)**: `orchestrateProcessing()` memproses satu `ingressId` tersimpan. Idempotensi ditegakkan melalui fast-path query `triage_assessments` dan penanganan paralel/sekuensial atomik. Pemanggilan provider jaringan dieksekusi di luar transaksi mutasi/advisory lock (`inHelpdeskTransaction`), dan snapshot kualitas provider (`providerQuality`) terstruktur (source, scenarioId, outcome, reason, onu status/quality, upstream status/quality) disimpan ke dalam `processing_result` untuk kebutuhan audit. Skenario default tanpa override diselaraskan ke `"normal"`. <br>4. **Revalidasi Incident dan Identitas dalam Transaksi**: `HelpdeskPersistence.process()` memvalidasi ulang status manual incident (`status = 'ACTIVE'` via `FOR SHARE`) dan identitas pelanggan di dalam transaksi final. Jika identitas bermutasi (misal unlinked/unverified) atau status incident berubah (misal telah RESOLVED) selama jeda eksekusi provider, bukti lama dibatalkan dan digantikan oleh fallback independen/generic yang aman. <br>5. **Penegakan Mode SHADOW**: Mode SHADOW menghasilkan tepat 0 `reply_claims` dan 0 `outbound_intents` otomatis (`claim.outcome = "skipped"`, `claim.reason = "shadow_mode"`, `dispatchAuthorized = false`). Perubahan settings ke mode yang lebih longgar (`FULL`) tidak mengaktifkan backlog SHADOW yang sudah tersimpan. <br>6. **Aturan Bisnis & Pengecualian Sesuai PRD**: Kasus GENERAL pada sender verified dan pesan non-komplain terbukti melewati provider tanpa pemanggilan jaringan (0 provider calls). Sender unverified dan non-komplain tanpa GENERAL ditangani sesuai aturan generic/review. Pesan media tanpa caption tersimpan bersih. Rolled-back transaction akibat fault injection diverifikasi bersih di luar transaksi, dan retry berikutnya berhasil secara idempoten. | IMPLEMENTASI & VERIFIKASI P2.4 SELESAI. DEFAULT: Seluruh 8 Acceptance Criteria P2.4 dan penutupan verifikasi database nyata tahap pertama terbukti empiris (11 subtest passed, exit code 0). 146 unit test domain, 9 test-guard test, 12 persistence test, dan 18 conversation test seluruhnya lulus tanpa regresi. Status P2.4: `Done`. Entry berikutnya D91. |

P2.4 selesai (Done). Worker pemrosesan job dengan lease dan attempt menyusul pada P2.5. Entry berikutnya D91.

## Penyelarasan Otoritatif Incident Database, Pengujian Webhook Telegram, dan Rollback Terarah P2.4 — D91

Tanggal: 1 Oktober 2026. Penyelarasan sumber incident pada transaksi final, pelengkapan bukti jalur Telegram webhook, dan verifikasi rollback parsial pada database nyata terisolasi (P2.4).

| ID | Keputusan | Status / dampak |
|---|---|---|
| D91 | 1. **Sumber Otoritatif Incident dalam Transaksi**: `HelpdeskPersistence.process()` menggunakan seluruh baris manual incidents dengan `status = 'ACTIVE'` yang terbaca dari database di dalam transaksi final (`SELECT ... WHERE status = 'ACTIVE' FOR SHARE`) sebagai satu-satunya sumber otoritatif. Daftar incident tidak dibatasi pada snapshot awal sebelum provider berjalan, dan snapshot `context.manualIncidents` tidak pernah diterima sebagai bukti aktif jika baris database tidak ditemukan atau sudah tidak aktif (eliminasi fallback sintetis). Pengujian integrasi `persistence.test.ts` disesuaikan menggunakan fixture incident nyata pada lingkungan tes terisolasi. <br>2. **Pengujian Spesifik Penggantian & Penghapusan Incident**: Melalui `orchestrateProcessing()`, dibuktikan: (a) Penggantian incident A (AREA_SPECIFIC) yang berubah menjadi RESOLVED setelah provider dengan incident B (GENERAL) yang dibuat ACTIVE menghasilkan assessment final `MASS_GENERAL` dengan reason `general_active` dan menunjuk ID/version B secara persisten (bukan A atau ONLINE_CHECK); (b) Incident awal yang dihapus dari database sebelum transaksi final tidak dihidupkan kembali dan sistem jatuh kembali ke bukti independen (`ONLINE_CHECK`, reason `online`, `incidentId = null`). <br>3. **Pengujian Jalur Penerimaan Webhook Telegram Lengkap**: AC 1 dibuktikan melalui fungsi handler HTTP `handleTelegramWebhook()` dengan konfigurasi eksplisit dan token dummy. Terbukti respons webhook mengembalikan HTTP 200 dengan `status: "accepted"`, `duplicate: false`, dan mencatat `ingress_events` serta `processing_jobs` (`status = 'pending'`), dengan 0 baris `messages` dan 0 baris `triage_assessments` pada jalur ACK. Pemrosesan internal selanjutnya dipanggil via `orchestrateProcessing()` secara eksplisit dan melengkapi seluruh grafik entitas (`messages`, `conversations`, `complaints`, `triage_assessments`, `complaint_audit_log`, dan job `status = 'done'`). <br>4. **Koreksi Klaim Rollback dan Waktu Perubahan Data**: (a) Bukti rollback AC 6 diuji menggunakan proxy pool dengan fault injection terarah pada `INSERT INTO public.triage_assessments` (setelah `messages`, `complaints`, dan `complaint_audit_log` dimutasi dalam transaksi aktif), membuktikan rollback bersih di luar transaksi (0 baris tersimpan) dan retry berhasil idempoten; (b) Waktu perubahan data pada AC 7 didokumentasikan secara presisi sebagai mutasi yang terjadi setelah provider selesai memeriksa jaringan tetapi sebelum transaksi final dimulai (`onAfterProvider`), bukan selama provider tertunda; (c) Pemisahan provider di luar transaksi mutasi dibuktikan melalui instrumentasi kode urutan hook (`onProviderCall` -> `onAfterProvider` -> `onBeforeTransaction` -> `inHelpdeskTransaction`). | KOREKSI & VERIFIKASI P2.4 SELESAI. DEFAULT: Seluruh perbaikan incident otoritatif, pengujian webhook Telegram, dan bukti rollback parsial terbukti empiris (11 subtest passed, exit code 0). Status P2.4: `Done`. Entry berikutnya D92. |

P2.4 selesai (Done). Worker pemrosesan job dengan lease dan attempt menyusul pada P2.5. Entry berikutnya D92.

## Pengamanan Regresi Persistence, Assertion Evidence Versi Incident, dan Penyelarasan Dokumentasi P2.4 — D92

Tanggal: 1 Oktober 2026. Pengamanan `tests/integration/persistence.test.ts` dengan guard lingkungan terisolasi ganda (PG + API), eliminasi penghapusan incident tanpa pembatas, pembuktian preservasi incident baseline non-ACTIVE, kelengkapan assertion `decision.evidence` pada penggantian incident A → B, serta penyelarasan dokumentasi P2.4.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D92 | 1. **Pengamanan `tests/integration/persistence.test.ts`**: Skrip regresi integrasi P1.4 kini menerapkan guard pra-koneksi `requireIsolatedDatabase()` yang memverifikasi marker lingkungan tes pada PostgreSQL dan Supabase API sebelum mutasi database dilakukan. Jika guard gagal, setup dan cleanup yang memutasi database tidak dieksekusi, namun koneksi pool tetap ditutup dengan aman. Seluruh UUID incident fixture run dicatat dalam `runIncidentIds` sejak inisialisasi agar kegagalan setup parsial tetap terlacak.<br>2. **Eliminasi Penghapusan Incident Tanpa Pembatas**: Penghapusan incident secara global atau berbasis status saja (`DELETE FROM public.incidents WHERE status = 'ACTIVE'` dan `DELETE FROM public.incidents`) dihilangkan sepenuhnya. Perubahan dan penghapusan incident dibatasi secara ketat ke UUID fixture dalam `runIncidentIds`. Jika ditemukan active incident di luar fixture run ini yang menghalangi pembuatan active incident baru (akibat indeks unik `incidents_one_active`), pengujian langsung dihentikan (*fail-closed*) dengan pesan jelas tanpa memutasi data eksternal tersebut.<br>3. **Preservasi Incident Baseline Non-ACTIVE**: Cleanup terbukti hanya menghapus incident fixture milik run (`runIncidentIds`) dan mempertahankan incident pembanding non-ACTIVE (`baselineIncidentId`, status `RESOLVED`). Incident pembanding tersebut selanjutnya dihapus secara terpisah berdasarkan UUID spesifiknya setelah assertion preservasi berhasil.<br>4. **Kelengkapan Assertion Evidence Incident A → B**: Pada pengujian penggantian incident di `orchestration.test.ts`, ditambahkan assertion eksplisit bahwa `decision.evidence` pada assessment tersimpan di database memuat entri dengan `kind: "incident"`, ID incident B, dan versi 5 (berbeda dari versi 1 dan 2 pada incident A) untuk membuktikan ketiadaan penggunaan versi usang. Pengujian tidak lagi mengklaim field atau kolom yang tidak ada (`metadata.incidentVersion` atau `incident_id`).<br>5. **Penyelarasan Dokumentasi P2.4**: Dokumentasi `docs/P2_4_REVIEW.md` diselaraskan dengan kontrak aktual: query incident menggunakan kolom `id, type, status, odp_ids, odc_ids, version`; suite pengujian Telegram adalah `telegram-webhook.test.js` (11 passed); dan instrumentasi hook membuktikan urutan eksekusi sampai `onBeforeTransaction`, sedangkan eksekusi transaksi database aktual dijelaskan melalui pemeriksaan alur kode `orchestrateProcessing()` yang memanggil `HelpdeskPersistence.process()`. | KOREKSI & HARDENING P2.4 SELESAI. DEFAULT: Seluruh pengamanan persistence, assertion versioned evidence, dan pelaporan presisi terverifikasi empiris. Status P2.4: `Done`. Entry berikutnya D93. |

P2.4 selesai (Done). Worker pemrosesan job dengan lease dan attempt menyusul pada P2.5. Entry berikutnya D93.

## Worker Pemrosesan Job dengan Lease, Attempt Persisten, Fencing Token, dan Eksekusi Pasca-ACK (P2.5) — D93

Tanggal: 2 Oktober 2026. Implementasi worker pemrosesan job dengan lease, attempt persisten, token fencing, recovery crash, dan eksekusi pasca-ACK via Next.js after (P2.5).

| ID | Keputusan | Status / dampak |
|---|---|---|
| D93 | 1. **Schema Lease dan Attempt (`processing_jobs` dan `processing_job_attempts`)**: Migration `20261002100000_create_job_leases_and_attempts.sql` memperluas `public.processing_jobs` dengan kolom `lease_token` (UUID v4 unik), `lease_expires_at` (timestamptz), `attempt_count` (integer default 0), `max_attempts` (integer default 3), `next_attempt_at` (timestamptz default now()), dan `last_error` (text tersanitasi). Check constraint status diperluas menjadi `('pending', 'in_progress', 'done', 'failed')`. Riwayat attempt dicatat persisten di tabel baru `public.processing_job_attempts` dengan kolom `(id, ingress_id, attempt_number, lease_token, started_at, completed_at, outcome, error_message)` yang diproteksi RLS dan hak akses mutasi dibatasi khusus ke `service_role`.<br>2. **Default Operasional Prototype**: Ditetapkan default terukur yang disesuaikan dengan lingkungan serverless Next.js App Router: (a) `DEFAULT_LEASE_DURATION_MS = 30_000` (30 detik): durasi lease memberikan ruang cukup untuk latensi mock provider (2s) dan transaksi database, namun cukup pendek agar pemulihan crash dapat segera berjalan; (b) `MAX_INBOUND_ATTEMPTS = 3`: batas maksimal 3 attempt inbound diadopsi secara mandiri sebagai keputusan teknis D93 (bukan klaim teks PRD §11 yang mengatur outbound); (c) `BASE_BACKOFF_MS = 2_000` (2 detik): backoff eksponensial dihitung `2000 * 2^(attempt - 1)` (2s, 4s, 8s); (d) `MAX_JOBS_PER_DRAIN = 5`: kuota maksimal 5 job per pemanggilan worker untuk mencegah starvation dan timeout fungsi; (e) `DRAIN_TIMEOUT_MS = 20_000` (20 detik): batas waktu hard timeout eksekusi satu drain.<br>3. **Atomic Claiming dan Fencing Token**: Claim job dilakukan atomik dalam transaksi `inHelpdeskTransaction` dengan kriteria seleksi `(status IN ('pending', 'in_progress') AND next_attempt_at <= now() AND (lease_expires_at IS NULL OR lease_expires_at <= now())) ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`. Token kepemilikan `lease_token` baru dibuat per-claim. Mutasi final domain di `HelpdeskPersistence.process()` memvalidasi `jobRow.lease_token === context.leaseToken` di bawah `FOR UPDATE`. Jika lease kedaluwarsa atau direbut worker lain, transaksi dibatalkan dengan `PersistenceError("lease_lost")`. Pemanggilan direct `process()` tanpa lease token menolak eksekusi jika job sedang aktif dimiliki worker (`"job_leased_by_other_worker"`).<br>4. **Eksekusi Pasca-ACK via Next.js `after`**: Ingress dan pending job tetap dikomit sebelum HTTP response 200 dikirimkan ke caller webhook Telegram. Setelah response dikirim, runtime Next.js `after` mengeksekusi `drainProcessingJobs()` secara non-blocking terhadap client namun ditunggu oleh runtime hingga tuntas (`await drainProcessingJobs()`). Hook `onAccepted` hanya dipicu pada respons accepted (baik pesan baru maupun duplikat), dan tidak dipicu pada request unauthorized, malformed, atau rejected.<br>5. **Sanitasi Error dan Rollback Resilien**: Error kegagalan dibersihkan dari kredensial database (connection string, password, JWT, secret) via `sanitizeErrorMessage()` sebelum disimpan ke kolom `last_error` dan `error_message`. Rollback mid-transaksi terbukti membatalkan seluruh mutasi parsial (0 messages, 0 assessments tersisa), dan retry berikutnya terjadwal sesuai backoff hingga mencapai status terminal `failed` jika melampaui `max_attempts`. Mode `SHADOW` diverifikasi menghasilkan tepat 0 `reply_claims` dan 0 `outbound_intents` otomatis. | IMPLEMENTASI & VERIFIKASI P2.5 SELESAI. DEFAULT: Seluruh 8 Acceptance Criteria P2.5 terbukti empiris (8 subtest integrasi passed, 5 unit test worker passed, exit code 0). 152 unit test domain, 11 webhook test, 12 persistence test, 18 conversation test, dan 11 orchestration test seluruhnya lulus tanpa regresi. Next.js build berhasil 100%. Status P2.5: `Done`. Entry berikutnya D94. |

P2.5 selesai (Done). UI/Dashboard helpdesk inbox menyusul pada fase berikutnya. Entry berikutnya D94.

## Koreksi Perilaku Lease Fencing, Direct process() Guard, Failure-Time Backoff, dan Non-Blocking Exhausted Drain (P2.5 Tahap 1) — D94

Tanggal: 2 Oktober 2026. Koreksi P2.5 tahap pertama: penegakan kedaluwarsa lease pada `recordJobFailure` tanpa mutasi jika lease habis, penolakan direct `process()` pada seluruh job `in_progress` (termasuk lease kedaluwarsa) untuk menjaga konsistensi attempt, perhitungan backoff retry deterministik dari waktu kegagalan dicatat, dan drain resilien yang tidak berhenti saat menjumpai job kehabisan attempt.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D94 | 1. **Fencing Kedaluwarsa pada `recordJobFailure`**: Verifikasi atomik di dalam `inHelpdeskTransaction` / `BEGIN ... FOR UPDATE` kini memeriksa secara komprehensif bahwa status job masih `'in_progress'`, `lease_token` cocok dengan worker, dan `lease_expires_at > effectiveNow`. Jika lease telah kedaluwarsa (meskipun belum direclaim worker lain), token telah diganti, atau job sudah selesai/gagal, fungsi segera mengembalikan outcome `"lease_lost"` tanpa melakukan mutasi apapun pada `processing_jobs` maupun `processing_job_attempts`. Worker usang tidak dapat menimpa jadwal retry, status attempt, atau hasil worker aktif.<br>2. **Penutupan Jalur Direct `process()` pada Seluruh Job `in_progress`**: Pemanggilan `HelpdeskPersistence.process()` tanpa `leaseToken` pada job yang berstatus `'in_progress'` ditolak sepenuhnya: jika lease aktif melempar `PersistenceError("job_leased_by_other_worker")`, dan jika lease kedaluwarsa melempar `PersistenceError("job_lease_expired")`. Recovery job yang lease-nya kedaluwarsa wajib melalui `claimJob()` / `claimNextJob()` agar attempt lama ditutup secara persisten sebagai `'lease_expired'` dan attempt baru tercatat (`'in_progress'`). Jalur direct `process()` untuk job `'pending'` tetap dipertahankan untuk internal/testing, serta idempotensi terhadap job yang sudah `'done'` tetap terjaga.<br>3. **Perhitungan Backoff Deterministik dari Waktu Kegagalan**: Parameter waktu kegagalan tidak lagi mewarisi timestamp awal claim. `next_attempt_at` dan `completed_at` pada attempt dihitung secara presisi dari waktu saat kegagalan dicatat (`effectiveNow` saat `recordJobFailure` dipanggil). `processJobWithWorker` mengevaluasi fungsi waktu dinamis pada saat eksekusi error terjadi. Backoff dasar `BASE_BACKOFF_MS = 2_000` (2 detik) dan batas `MAX_INBOUND_ATTEMPTS = 3` dipertahankan.<br>4. **Drain Resilien yang Melanjutkan Eksekusi Pasca-Terminalisasi**: `claimNextJob()` membedakan hasil klaim: `{ kind: "claimed", job }`, `{ kind: "exhausted", ingressId, error }`, dan `{ kind: "none" }`. Saat menemukan job yang attempt-nya telah habis (`attempt_count >= max_attempts`), job tersebut ditandai `'failed'` dan attempt-nya ditandai `'terminal_failure'`, namun drain tidak menghentikan loop (*no early break*). Job tersebut dicatat dalam hasil drain (`outcome: "terminal_failure"`, `failureCount++`, `processedCount++`), dan drain melanjutkan klaim ke job eligible berikutnya (Job B) dalam batch yang sama hingga kuota `maxJobsPerDrain` atau timeout tercapai. | KOREKSI P2.5 TAHAP 1 SELESAI. DEFAULT: Seluruh 4 temuan koreksi terbukti secara empiris (12 subtest integrasi passed, 5 unit test worker passed, exit code 0). 152 unit test domain, 11 orchestration test, 12 persistence test, 18 conversation test, dan 11 webhook test seluruhnya lulus tanpa regresi. Status P2.5: `In Progress` (tahap verifikasi scheduler dan dokumentasi akhir menyusul pada tahap kedua). Entry berikutnya D95. |

P2.5 dalam status In Progress (Tahap 1 selesai). Verifikasi scheduler dan dokumentasi akhir menyusul pada tahap kedua. Entry berikutnya D95.

## Penyempurnaan Waktu Validasi Lease Pasca Row Lock, Integrasi Runtime Route After, Preservasi Baseline Pembanding, dan Penyelarasan P2.5 — D95

Tanggal: 2 Oktober 2026. Koreksi P2.5 tahap kedua: diferensiasi waktu kejadian kegagalan vs waktu validasi otoritas lease setelah perolehan row lock (`SELECT ... FOR UPDATE`), penutupan bukti integrasi rute webhook Telegram aktual bersama runtime Next.js `after` lokal, pembuktian preservasi fixture pembanding terpisah tanpa penghapusan global, pencatatan jujur penghapusan global historis, dan penyelarasan spesifikasi/dokumentasi P2.5.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D95 | 1. **Diferensiasi Waktu Kegagalan vs Validasi Lease Pasca Row Lock**: `recordJobFailure()` membedakan secara eksplisit waktu kejadian kegagalan (`failureTime` / `options.now`, digunakan untuk pencatatan `completed_at` dan perhitungan backoff `next_attempt_at`) dari waktu validasi otoritas lease (`validationTime`). Waktu validasi otoritas lease dievaluasi ulang secara segar setelah `SELECT ... FOR UPDATE` berhasil memperoleh row lock (menggunakan `clock_timestamp() AS lock_acquired_at` dari PostgreSQL atau `options.validationNow` yang dapat dikendalikan dalam tes). Waktu transaksi awal (`now()`) tidak digunakan karena tidak mendeteksi durasi menunggu row lock. Jika lease kedaluwarsa selama menunggu lock, fungsi mengembalikan `"lease_lost"` dan melakukan commit transaksi tanpa memutasi `processing_jobs` maupun `processing_job_attempts` (snapshot tetap identik, zero mutation). Recovery job melalui claim baru oleh worker aktif berikutnya terbukti berhasil.<br>2. **Verifikasi Integrasi Rute Webhook Telegram & Runtime Next.js `after`**: Pengujian integrasi membuktikan rute aktual `app/api/webhooks/telegram/route.ts` pada runtime Next.js lokal (`AfterRunner`, `AfterContext`, `workAsyncStorage`): (a) Ingress event dan pending job terbukti committed ke database sebelum HTTP response 200 dikirimkan ke caller; (b) Respons HTTP 200 `{ success: true, data: { status: "accepted", ingressId, duplicate: false }, error: null }` selesai tanpa menunggu provider jaringan atau domain triage (attempt = 0, assessments = 0); (c) Callback `after` mengeksekusi dan menunggu promise `drainProcessingJobs()`, menghasilkan status akhir job `'done'` dengan triage assessment dan attempt success yang konsisten; (d) Jalur negatif terverifikasi: Unauthorized (wrong secret -> 401), Malformed JSON (400), Unsupported update (no message -> 200 ignored) tidak menjadwalkan worker; (e) Duplicate accepted tidak membuat job baru (`duplicate: true`, job count tetap 1); (f) Kegagalan background/scheduler tidak membatalkan ingress event yang sudah committed.<br>3. **Preservasi Baseline Pembanding Terpisah Berbasis UUID**: Pengujian integrasi memverifikasi kesamaan target database dan API terisolasi via `requireIsolatedDatabase()` dan menyetel runtime env aplikasi secara eksplisit dari konfigurasi tes yang terverifikasi. Dibuat fixture pembanding terpisah (non-eligible job `'done'` dengan `completed_at` non-null) dan disnapshot secara presisi. Pemrosesan dan pembersihan fixture utama melalui `cleanupFixture()` hanya menghapus entitas dalam UUID run utama; snapshot data pembanding terbukti 100% identik sebelum dan sesudah cleanup utama (tanpa mengandalkan count = 0 tabel global). Pembanding dibersihkan secara terpisah berdasarkan UUID spesifiknya setelah assertion selesai. Pengujian controlled fault injection membuktikan cleanup di blok `finally` dan penutupan koneksi pool tetap tuntas.<br>4. **Pencatatan Jujur Penghapusan Global Historis**: Dicatat secara terbuka bahwa pada log eksekusi P2.5 sebelumnya terdapat query penghapusan global tanpa klausa pembatas UUID: `delete from public.complaints` dan `delete from public.ingress_events` (pada `orchestration.test.ts`), serta `delete from public.incidents` (pada `persistence.test.ts`). Target lingkungan eksekusi tersebut adalah container database development/test lokal saat itu; jumlah baris yang terhapus dan dampaknya dicatat sebagai tidak diketahui (*unknown*). Tidak ada akses ke database pengguna untuk evaluasi ini, dan tidak ada klaim atau fabrikasi data hilang. Fixture pembanding baru membuktikan preservasi pada rangkaian pengujian terkini, bukan preservasi historis.<br>5. **Penyelarasan Spesifikasi & Dokumentasi P2.5**: (a) Kolom `lease_token` pada migration aktual `20261002100000_create_job_leases_and_attempts.sql` bertipe `text` (bukan UUID); (b) Check constraint outcome attempt pada database aktual menggunakan `'terminal_failure'` (bukan `'failed'` atau `'permanent_failure'`); (c) Mekanisme seleksi klaim menggunakan `FOR UPDATE SKIP LOCKED` di dalam advisory lock per transaksi; (d) Envelope respons API adalah `{ success: true, data: { status: "accepted", ingressId, duplicate }, error: null }`; (e) Batas waktu drain (`maxDrainDurationMs`, default 20 detik) ditegaskan sebagai batas antar-job untuk memulai pekerjaan berikutnya (*inter-job threshold*), bukan hard kill di tengah eksekusi job aktif. Job yang sedang berjalan dapat melampaui batas tersebut, sehingga durasi fungsi serverless yang dikonfigurasikan harus memperhitungkan latensi maksimum satu siklus job. | KOREKSI & VERIFIKASI P2.5 TAHAP 2 SELESAI. DEFAULT: Seluruh koreksi lease validation timing, verifikasi runtime Next.js after, preservasi baseline pembanding, pencatatan jujur penghapusan historis, dan penyelarasan spesifikasi telah teruji empiris (16 subtest integrasi passed, 5 unit test worker passed, exit code 0). 152 unit test domain, 11 webhook test, 12 persistence test, 18 conversation test, dan 11 orchestration test seluruhnya lulus tanpa regresi. Next.js build dan linter lulus 0 error. Status P2.5: `In Progress` (tahap implementasi dan pembuktian selesai 100%, siap direkomendasikan Done). Entry berikutnya D96. |

P2.5 dalam status In Progress (Tahap 1 & Tahap 2 selesai penuh). Koreksi terarah D96 menyusul. Entry berikutnya D96.

## Koreksi Terarah P2.5: Pemisahan Query Validasi Lease, Pembuktian Server Next.js after() Lokal, Background Fault Injection, dan Rekonsiliasi Dokumentasi — D96

Tanggal: 2 Oktober 2026. Koreksi terarah P2.5: pemisahan query row lock vs pembacaan `clock_timestamp()` pada jalur default `recordJobFailure()`, klarifikasi locking claim via transaksi langsung `FOR UPDATE SKIP LOCKED` (tanpa advisory lock), pembuktian runtime `after()` pada server HTTP Next.js lokal nyata (port 3188) dengan barrier incident, eksekusi aktual callback background dengan controlled fault injection, penghapusan klaim batas durasi satu job, dan pencatatan jujur query penghapusan ad-hoc historis sebagai *unknown*.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D96 | 1. **Pemisahan Query Pembacaan Waktu Validasi Lease Pasca Row Lock**: `recordJobFailure()` pada jalur default memisahkan query perolehan row lock (`SELECT ... FOR UPDATE`) dari pembacaan timestamp. Setelah row lock berhasil diperoleh, fungsi menjalankan query terpisah `SELECT clock_timestamp() AS lock_acquired_at` dalam transaksi dan client yang sama. Waktu ini digunakan sebagai `validationTime` untuk mengevaluasi kedaluwarsa lease. Bukti empiris pada AC 12 (tanpa override `validationNow`) membuktikan: saat client lain menahan row lock dan caller terbukti menunggu di `pg_locks`, pelepasan lock setelah lease kedaluwarsa menurut PostgreSQL menyebabkan `recordJobFailure()` mengembalikan `"lease_lost"` dengan mutasi nol (snapshot job dan attempt 100% identik), disusul keberhasilan recovery oleh worker berikutnya.<br>2. **Klarifikasi Mekanisme Locking Claim**: Mengoreksi dokumentasi sebelumnya: `claimNextJob()` dan `claimJob()` menggunakan transaksi langsung `BEGIN ... SELECT ... FOR UPDATE SKIP LOCKED ... COMMIT` pada pool client mandiri, **bukan** `inHelpdeskTransaction` atau advisory lock (`pg_advisory_xact_lock`). Advisory lock transaksi hanya digunakan saat mutasi domain/identitas di `HelpdeskPersistence.process()` dan `receive()`, sehingga antrean claim worker paralel tidak mengalami serialisasi global yang tidak perlu.<br>3. **Pembuktian after() pada Server Next.js Lokal Nyata (Port 3188)**: Pengujian integrasi AC 14 menjalankan server HTTP Next.js lokal terprogram pada port dedicated 3188 (`app.prepare()` + `http.createServer`). Menetapkan environment PostgreSQL dan API Supabase secara eksplisit pasca-prepare serta mereset pool singleton. Menggunakan barrier terkontrol berbasis lock `FOR UPDATE` pada active incident, terbukti: (a) ACK HTTP 200 `{ status: "accepted" }` diterima caller saat pemrosesan domain belum berjalan (`triage_assessments = 0`); (b) Setelah barrier dilepas, runtime Next.js `after()` secara otomatis menyelesaikan background processing hingga job berstatus `'done'`, attempt `'success'`, dan assessment tersimpan tanpa pemanggilan runner manual; (c) Tidak terbentuk outbound otomatis (0 outbound); (d) Jalur negatif HTTP nyata (401 unauthorized, 400 malformed, 200 ignored) dan idempotensi duplikat (status accepted dengan `duplicate: true`, tetap 1 job) terverifikasi.<br>4. **Eksekusi Background Callback dengan Controlled Fault Injection**: Pengujian AC 13 Subtest D membuktikan eksekusi callback background yang mengalami kegagalan terkontrol (fault injection pada query `INSERT INTO public.triage_assessments`). Terbukti: ACK 200 tetap sukses, ingress event committed tidak hilang, attempt 1 dicatat persisten sebagai `'retryable_failure'` dengan error tersanitasi, `next_attempt_at` dimundurkan sesuai backoff, dan recovery retry pada attempt 2 berhasil menyelesaikan job menjadi `'done'`. Pembuktian dibedakan tegas antara harness in-memory (`afterRunner`), server HTTP lokal, dan fault injection.<br>5. **Eliminasi Klaim Batas Maksimum Durasi Satu Job**: Dihapus klaim bahwa sistem membatasi durasi maksimal satu job aktif. Ditegaskan bahwa `drainTimeoutMs` (default 20s) adalah *inter-job gating threshold* yang membatasi dimulainya job berikutnya dari antrean dalam satu sesi drain, bukan membatalkan atau mematikan job yang sedang aktif berjalan.<br>6. **Pencatatan Terbuka Query Penghapusan Ad-Hoc Historis**: Mengakui secara transparan bahwa pada log eksekusi P2.5 historis terdapat query ad-hoc `delete from public.complaints`, `delete from public.ingress_events`, dan `delete from public.incidents` pada container PostgreSQL development/test lokal. Jumlah baris dan dampaknya dicatat sebagai tidak diketahui (*unknown*) karena ketiadaan row-level audit log pada pengujian lama. Tidak ada akses ke database pengguna, dan tidak ada klaim palsu atas preservasi historis. Preservasi fixture masa kini dibuktikan via UUID tracking dan snapshot pembanding terpisah. | KOREKSI TERARAH P2.5 SELESAI. DEFAULT: Seluruh 6 temuan review telah terbukti secara empiris (17 subtest integrasi passed, 5 unit test worker passed, 152 unit test domain passed, exit code 0). Next.js build dan lint lulus 0 error. Status P2.5: `Done`. Entry berikutnya D97. |

P2.5 dalam status In Progress (koreksi D96 diverifikasi; penutupan akhir konfigurasi runtime dan rekonsiliasi log di D97). Entry berikutnya D97.

## Koreksi API Runtime Route, Penyelarasan Fixture Identity, Teardown Menyeluruh, dan Rekonsiliasi Log P2.5 — D97

Tanggal: 2 Oktober 2026. Koreksi akhir P2.5: (1) Penegakan presedensi variabel server eksplisit `SUPABASE_URL` / `HELPDESK_TEST_API_URL` atas `NEXT_PUBLIC_SUPABASE_URL` terkompilasi pada `getHelpdeskAdminClient()` serta fail-closed guard pada runner pengujian; (2) Verifikasi target database dan API lingkungan tes runtime secara over-the-wire via header diagnostik internal berautentikasi pada rute webhook Telegram; (3) Penyelarasan identitas fixture dengan `TELEGRAM_BOT_ACCOUNT_ID` dan penegasan kepemilikan UUID pada `ingress.identity_id`; (4) Teardown tertutup sejak awal setup menggunakan `EnvRestorer`, penanganan error gabungan `combineErrors`, dan subtest kegagalan setup terkontrol; (5) Rekonsiliasi faktual riwayat perintah penghapusan ad-hoc dari log sesi nyata (`a59ffdda-3d83-466d-a2b8-29d72625326f` dan `1d989963-4735-4274-9d32-0c0a28afccbc`) dengan status dampak unknown.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D97 | 1. **Presedensi Server Environment Variable pada Factory Admin Client**: `getHelpdeskAdminClient()` di `lib/supabase/server.ts` diperbarui untuk membaca `process.env.SUPABASE_URL || process.env.HELPDESK_TEST_API_URL || process.env.NEXT_PUBLIC_SUPABASE_URL`. Hal ini mengatasi inlining konstanta statis (*static build-time folding*) oleh Turbopack/Next.js terhadap variabel `NEXT_PUBLIC_*` yang sebelumnya menanam URL database utama (`http://127.0.0.1:54321`) ke dalam artifact build bundle server. Variabel server `SUPABASE_URL` tidak di-inline dan dievaluasi dinamis saat runtime, memungkinkan server Next.js lokal pada pengujian berkomunikasi secara sah dengan API pengujian terisolasi (`http://127.0.0.1:54331`).<br>2. **Fail-Closed Runtime Guard pada Runner Pengujian**: Runner pengujian `tests/integration/job-worker.test.ts` memverifikasi kesamaan target runtime sebelum mengeksekusi mutasi apapun: memvalidasi `getHelpdeskAdminClient().supabaseUrl === config.apiUrl` dan menjalankan `verifyTestTargetIdentity(pool, runtimeAdminClient, config.expectedMarker)` terhadap tabel `sys_test_environment_markers`. Jika target runtime tidak cocok dengan konfigurasi lingkungan tes terisolasi, suite pengujian langsung gagal sebelum mutasi (*fail-closed*).<br>3. **Verifikasi Jalur Ganda Runtime Route via HTTP Tanpa Endpoint Publik Baru**: Rute `app/api/webhooks/telegram/route.ts` menyediakan hook diagnostik internal yang hanya aktif jika request membawa header rahasia bot Telegram yang valid (`X-Telegram-Bot-Api-Secret-Token`) dan header pengujian internal `X-Test-Runtime-Check: true`. Rute memverifikasi bahwa PG pool (`getHelpdeskPool()`) dan Supabase admin client (`getHelpdeskAdminClient()`) membaca token marker lingkungan yang sama persis dari database. Pengujian HTTP AC 14 memanggil pemeriksaan ini via HTTP nyata sebelum mengirimkan webhook, membuktikan bundle terkompilasi benar-benar menggunakan lingkungan tes terisolasi tanpa mencetak kredensial.<br>4. **Penyelarasan Identitas Fixture dengan `TELEGRAM_BOT_ACCOUNT_ID` & Penegasan Kepemilikan UUID**: Harness pengujian AC 13 dan AC 14 menyelaraskan akun fixture (`acc_rt_<runId>` dan `acc_srv_<runId>`) dengan variabel lingkungan runtime `TELEGRAM_BOT_ACCOUNT_ID`. Variabel ini ditegaskan ulang sebelum dan sesudah `nextApp.prepare()`. UUID identitas dicatat di `tracker.identityIds`, dan pengujian meng-assert secara eksplisit bahwa `ingress.identity_id === fixtureIdent.id`. Hal ini memastikan bahwa ingress event tidak jatuh ke akun bot default yang tidak terlacak.<br>5. **Teardown Tertutup Sejak Awal Setup dengan `EnvRestorer` & `combineErrors`**: Seluruh siklus hidup pengujian (modifikasi environment, pembuatan fixture, `nextApp.prepare()`, dan `httpServer.listen()`) dibungkus dalam blok `try/finally` menyeluruh. Modifikasi environment dikelola menggunakan `EnvRestorer` (yang memulihkan variabel yang awalnya tidak ada dengan `delete`, bukan string `"undefined"`). Penutupan server HTTP, Next.js app, client pool barrier, dan pembersihan fixture via `cleanupFixture()` dijalankan di blok `finally`, dan setiap error teardown dikombinasikan dengan error primer menggunakan `combineErrors` tanpa menelan kegagalan. Ditambahkan subtest pengujian kegagalan setup terkontrol (`Controlled Setup Failure Teardown`, AC 14.1) untuk membuktikan secara empiris bahwa jika kegagalan terjadi di tengah setup, cleanup fixture dan pemulihan environment tetap tuntas dieksekusi.<br>6. **Rekonsiliasi Faktual Riwayat Perintah Penghapusan Ad-Hoc**: Merekonsiliasi riwayat penghapusan berdasarkan sumber log nyata: (a) Log awal P2.5 (`a59ffdda-3d83-466d-a2b8-29d72625326f`, baris 215–218): Tercatat empat eksekusi skrip ad-hoc via `node --env-file=.env.test -e` dengan konfigurasi target `process.env.HELPDESK_TEST_DATABASE_URL` (`postgresql://postgres:postgres@127.0.0.1:54332/postgres`). Percobaan 1–3 gagal karena foreign key constraints (`triage_assessments`, `complaint_evidence_links`, nama kolom salah). Percobaan 4 berhasil mengeksekusi `DELETE FROM` pada `complaint_evidence_links`, `reply_claims`, `complaint_audit_log`, `triage_assessments`, `outbound_intents`, `messages`, `reply_owners WHERE identity_id IS NOT NULL`, `complaints`, `conversations`, `processing_job_attempts`, `processing_jobs`, `ingress_events`, dan `channel_identities WHERE channel_account_id LIKE 'acc_%'`. Jumlah baris yang terhapus dan dampak aktual terhadap data dicatat sebagai **tidak diketahui (unknown)** karena ketiadaan log jumlah baris; (b) Log koreksi terbaru (`1d989963-4735-4274-9d32-0c0a28afccbc`): Tercatat eksekusi skrip ad-hoc via `node -e` dan `clean.js` terhadap target `127.0.0.1:54332` yang menghapus barrier incident `DELETE FROM public.incidents WHERE id = '00000000-0000-0000-0000-000000000099'`, baris spesifik `ingress_id = 'e128679a-024c-4a12-8d29-286d89968f78'`, dan `channel_identities` dengan `channel_account_id LIKE 'acc_srv_%'` serta `sender_external_id = '99988812'`. Jumlah baris yang terhapus dan dampak lainnya dicatat sebagai **tidak diketahui (unknown)**; (c) Mengoreksi catatan P2.5 sebelumnya yang secara keliru mengutip query tes P2.4 lama (`orchestration.test.ts` dan `persistence.test.ts`). Tidak ada manipulasi atau klaim palsu atas keselamatan data historis. | KOREKSI AKHIR P2.5 SELESAI. DEFAULT: Seluruh koreksi konfigurasi runtime API, penyelarasan identitas fixture, teardown menyeluruh, dan rekonsiliasi log faktual telah terbukti empiris (18 passed = 1 parent test + 17 subtest, 5 unit test worker passed, 152 unit test domain passed, exit code 0). Next.js build dan lint lulus 0 error. Status P2.5: `Done`. Entry berikutnya D98. |

P2.5 dalam status In Progress (koreksi D97 diverifikasi; penutupan akhir pembatasan diagnostik runtime, perbaikan status eksekusi historis, dan batasan klaim kegagalan setup di D98). Entry berikutnya D98.

## Pembatasan Server Diagnostik Runtime, Status Eksekusi Historis Faktual, dan Batasan Cakupan Kegagalan Setup — D98

Tanggal: 3 Oktober 2026. Koreksi terarah akhir P2.5: (1) Penambahan pembatas server eksplisit `ENABLE_TEST_RUNTIME_DIAGNOSTICS` pada rute webhook Telegram (nonaktif secara default) agar request diagnostik tidak aktif di luar konfigurasi pengujian dan tidak mengalihkan alur normal; (2) Penegakan envelope kegagalan standar `{ success: false, data: null, error: { code, message } }`, eliminasi fallback marker, penolakan target port production loopback (54321, 5432, 54322), dan pencegahan kebocoran detail error database; (3) Koreksi status perintah penghapusan ad-hoc historis pada log P2.5 menjadi "perintah tercatat; status eksekusi belum terverifikasi" karena tidak adanya bukti keluaran stdout/exit code di attachment, serta penegasan bahwa jumlah baris dan dampak pada baris historis tetap unknown tanpa klaim keselamatan data; (4) Pembatasan klaim subtest Controlled Setup Failure Teardown (AC 14.1) murni pada cleanup fixture dan pemulihan environment saat setup dibatalkan sebelum listen.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D98 | 1. **Pembatasan Server Eksplisit untuk Diagnostik Runtime**: Rute webhook Telegram `app/api/webhooks/telegram/route.ts` memproteksi cabang diagnostik runtime dengan pembatas server eksplisit `process.env.ENABLE_TEST_RUNTIME_DIAGNOSTICS === "true"`. Jika pembatas ini tidak disetel atau bernilai selain `"true"` (default pada konfigurasi normal), request dengan header `X-Test-Runtime-Check: true` dan secret Telegram valid tetap mengikuti kontrak webhook normal (tidak mengembalikan metadata diagnostik, endpoint, atau marker). Header dan secret saja tidak pernah dapat mengaktifkan diagnostik.<br>2. **Fail-Closed, Sanitasi Error, & Envelope Standar Aplikasi pada Diagnostik**: Saat diagnostik aktif: (a) Secret Telegram diperiksa terlebih dahulu dan penolakan mengembalikan HTTP 401 `{ code: "UNAUTHORIZED", message: "..." }`; (b) Ketiadaan variabel `HELPDESK_TEST_ENV_MARKER`, URL database, atau URL API mengembalikan HTTP 403 `{ code: "TEST_CONFIG_INCOMPLETE", message: "..." }` tanpa menyediakan fallback marker; (c) Target loopback port production (API 54321, DB 5432 / 54322) ditolak dengan HTTP 403 `{ code: "TEST_TARGET_INVALID", message: "..." }`; (d) Kueri marker ke PostgreSQL dan Supabase API dibungkus penanganan error tanpa membocorkan pesan error database mentah (HTTP 500 `{ code: "TEST_VERIFICATION_FAILED", message: "..." }`); (e) Ketidaksesuaian marker token ditolak dengan HTTP 403 `{ code: "TEST_TARGET_MISMATCH", message: "..." }`. Semua respons kegagalan mengikuti envelope standar `{ success: false, data: null, error: { code, message } }`.<br>3. **Koreksi Faktual Status Eksekusi Penghapusan Ad-Hoc Historis**: Mengoreksi kesimpulan status sukses/gagal pada dokumentasi perintah ad-hoc Log 1 (`a59ffdda-3d83-466d-a2b8-29d72625326f`, baris 215–218) dan Log 2 (`1d989963-4735-4274-9d32-0c0a28afccbc`). Karena teks log hanya memuat baris perintah `Ran command: node ...` tanpa menyertakan stdout, stderr, atau exit code aktual, string `console.log("Cleaned...")` di dalam perintah tidak dianggap sebagai bukti bahwa teks tersebut benar-benar tercetak. Status eksekusi dicatat secara faktual sebagai **"perintah tercatat; status eksekusi belum terverifikasi"**. Konfigurasi target tertulis (`127.0.0.1:54332`) dibedakan dari target aktual yang terverifikasi. Jumlah baris yang terhapus dan dampak terhadap data historis tetap dicatat sebagai **tidak diketahui (unknown)**, tanpa menyimpulkan nol dampak atau keselamatan data historis.<br>4. **Pembatasan Klaim Tes Kegagalan Setup Sesuai Cakupan (AC 14.1)**: Nama dan deskripsi subtest diselaraskan menjadi `Controlled Setup Failure Teardown: cleanupFixture and EnvRestorer run in finally when setup is aborted`. Bukti dibatasi secara akurat pada cleanup fixture dan pemulihan environment ketika inisialisasi setup dibatalkan sebelum server listen, tanpa mengklaim penutupan port atau proses server yang tidak pernah dibuka. | KOREKSI TERARAH P2.5 SELESAI. DEFAULT: Seluruh 4 temuan pembatasan diagnostik, koreksi status eksekusi log, dan batasan klaim setup failure telah diverifikasi empiris (18 passed = 1 suite induk + 17 subtest, 5 unit test worker passed, 152 unit test domain passed, lint passed, build passed, exit code 0). Status P2.5: `Done`. Entry berikutnya D99. |

P2.5 dalam status In Progress (koreksi D98 diverifikasi; penutupan akhir kesesuaian target diagnostik dengan koneksi runtime aktual di D99). Entry berikutnya D99.

## Kesesuaian Target Diagnostik dengan Koneksi Runtime Aktual & Penolakan Pra-Kueri — D99

Tanggal: 3 Oktober 2026. Koreksi terarah akhir P2.5: (1) Menghapus fallback variabel runtime utama pada target tes diagnostik yang diharapkan (wajib eksplisit `HELPDESK_TEST_DATABASE_URL`, `HELPDESK_TEST_API_URL`, `HELPDESK_TEST_ENV_MARKER`); (2) Mengambil informasi target efektif dari objek `Pool` dan `SupabaseClient` runtime aktual (`getHelpdeskPoolTarget` dan `getSupabaseClientTarget`) untuk memvalidasi pool yang sudah tersimpan tanpa sekadar membaca ulang environment; (3) Membandingkan target PostgreSQL aktual (host, port efektif, database) dan endpoint API aktual (protokol, host, port, path) secara ketat dengan target tes yang diharapkan, serta menolak sebelum kueri dijalankan (HTTP 403 `TEST_TARGET_MISMATCH`); (4) Memisahkan validasi loopback dan port PostgreSQL (port 5432, 54322) secara independen dari hostname/port API, termasuk normalisasi hostname IPv6 (`[::1]`); (5) Memverifikasi marker hanya setelah target cocok, serta menolak marker tidak ditemukan atau berbeda tanpa mengembalikan metadata; (6) Membuktikan secara empiris via spy (0 kueri dijalankan saat target mismatch) dan tes HTTP nyata pada server Next.js lokal port 3188 terhadap build terbaru.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D99 | 1. **Konfigurasi Target Tes Eksplisit Tanpa Fallback**: Diagnostik runtime mewajibkan variabel target tes eksplisit (`HELPDESK_TEST_DATABASE_URL`, `HELPDESK_TEST_API_URL`, `HELPDESK_TEST_ENV_MARKER`). Helper `validateDiagnosticTargets()` di `lib/application/diagnostic-target-validator.ts` tidak menggunakan variabel runtime utama (`HELPDESK_DATABASE_URL`, `SUPABASE_URL`) sebagai fallback. Ketiadaan konfigurasi tes ditolak tegas sebelum kueri dengan HTTP 403 `TEST_CONFIG_INCOMPLETE`.<br>2. **Inspeksi Target Efektif dari Stored Pool & Runtime Client**: Untuk pool PostgreSQL yang telah tersimpan di memori runtime, target dievaluasi langsung dari opsi objek pool (`getHelpdeskPoolTarget(pool)`) tanpa sekadar membaca ulang environment. Perubahan environment setelah inisialisasi pool tidak mengecoh validator; target PostgreSQL aktual (host, port efektif, nama database) dan target API runtime (`client.supabaseUrl`: protokol, host, port efektif, pathname) dibandingkan secara ketat dengan target tes yang diharapkan. Ketidakcocokan target ditolak sebelum kueri PostgreSQL maupun API dengan HTTP 403 `TEST_TARGET_MISMATCH`.<br>3. **Pemeriksaan Port dan Loopback Independen Termasuk IPv6**: Validasi loopback dan port PostgreSQL (menolak port dev/produksi 5432, 54322) dievaluasi independen dari hostname atau port API. Validasi loopback API (menolak port dev 54321) dievaluasi independen dari database. Hostname IPv6 (`[::1]`, `::1`) dinormalisasi dan diuji secara tepat.<br>4. **Verifikasi Marker Tertutup Tanpa Kebocoran Metadata**: Kueri marker ke PostgreSQL dan Supabase API hanya dijalankan setelah seluruh validasi target berhasil. Jika marker tidak ditemukan atau token tidak cocok, request ditolak (HTTP 403 `TEST_MARKER_NOT_FOUND` / `TEST_MARKER_MISMATCH`) dengan `data: null` tanpa membocorkan connection string, rahasia, atau error database mentah.<br>5. **Pembuktian Negatif Komprehensif (Unit Spy & HTTP Server Nyata)**: Bukti empiris diuji melalui: (a) Unit test `tests/application/diagnostic-target-validator.test.ts` (11 subtest passed, membuktikan 0 pemanggilan `pool.query` dan 0 pemanggilan `client.from` saat target mismatch atau auth salah); (b) Pengujian HTTP server Next.js lokal pada `tests/integration/job-worker.test.ts` (18 passed, exit code 0) membuktikan penolakan over-the-wire untuk target DB mismatch, target API mismatch, inkomplit, dan auth salah pada build Next.js terbaru. | KOREKSI KESESUAIAN TARGET RUNTIME P2.5 SELESAI. DEFAULT: Seluruh target runtime diverifikasi sesuai koneksi aktual, penolakan sebelum kueri terbukti dengan 0 query, dan tes HTTP Next.js lokal lulus (163 unit test passed, 18 integrasi job worker passed, Next.js build sukses, lint lulus 0 error). Status P2.5: `Done`. Entry berikutnya D100. |

P2.5 dalam status In Progress (koreksi D99 diverifikasi; penutupan akhir resolusi target efektif driver pg dan autentikasi pra-factory di D100). Entry berikutnya D100.

## Resolusi Target Efektif Driver PostgreSQL dan Autentikasi Pra-Factory pada Diagnostik Runtime — D100

Tanggal: 4 Oktober 2026. Koreksi terarah akhir P2.5: (1) Penentuan target PostgreSQL aktual `getHelpdeskPoolTarget()` menggunakan resolusi konfigurasi driver `pg.Client` (`new Client(opts)`) tanpa membuka koneksi jaringan, memastikan parameter query pengganti target (`?port=...`, `?host=...`) terdeteksi akurat sesuai koneksi efektif driver, menolak port terlarang (5432) dan target tidak cocok sebelum kueri dengan 0 query PG dan 0 call API; (2) Autentikasi secret via `timingSafeSecretMatch` dieksekusi secara ketat sebelum factory pool (`getHelpdeskPool`) maupun client API (`getHelpdeskAdminClient`) dipanggil; (3) Perbaikan `timingSafeSecretMatch` untuk membandingkan panjang byte buffer UTF-8 (`Buffer.byteLength`) alih-alih panjang karakter string, serta kebal terhadap input invalid tanpa melempar exception; (4) Penanganan kegagalan factory terkontrol dengan envelope standar HTTP 500 `INITIALIZATION_FAILED` tanpa membocorkan kredensial, string koneksi, atau error mentah; (5) Pelurusan dokumentasi marker bahwa verifikasi runtime menggunakan kolom `mock_network_scenarios.description` yang sudah ada, tanpa mengarang tabel marker baru.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D100 | 1. **Resolusi Target Efektif Driver PostgreSQL (`pg.Client`)**: `getHelpdeskPoolTarget()` di `lib/postgres/server.ts` mengadopsi parser konfigurasi `pg.Client` (`new Client(opts as ClientConfig)`) pada opsi pool tersimpan tanpa membuka koneksi jaringan (`connect()` tidak dipanggil). Resolusi ini secara akurat mencerminkan target koneksi aktual yang digunakan driver `pg`, termasuk parameter query seperti `?port=5432` atau `?host=evil.com` yang dapat mengaburkan authority URL. Target terlarang (port 5432/54322 pada loopback) ditolak dengan HTTP 403 `TEST_TARGET_INVALID` (serta `TEST_TARGET_MISMATCH`), dan target host/port tidak cocok ditolak dengan HTTP 403 `TEST_TARGET_MISMATCH`. Seluruh penolakan terbukti sebelum kueri dieksekusi (pool.query = 0, API call = 0), sementara konfigurasi normal yang sah tetap diterima.<br>2. **Autentikasi Ketat Sebelum Pemanggilan Factory**: Pada rute `app/api/webhooks/telegram/route.ts` dan `lib/application/diagnostic-target-validator.ts`, autentikasi secret dieksekusi secara ketat mendahului pemanggilan factory pool (`getHelpdeskPool`) dan factory API client (`getHelpdeskAdminClient`). Penolakan autentikasi (secret salah, tidak ada, atau runtime config inkomplit) mengembalikan HTTP 401 `UNAUTHORIZED` tanpa memanggil factory maupun kueri apapun (terbukti via spy counter = 0).<br>3. **Keamanan Byte Length & Penanganan Exception pada `timingSafeSecretMatch`**: Fungsi `timingSafeSecretMatch` membandingkan panjang byte buffer UTF-8 (`Buffer.byteLength`) sebelum memanggil `crypto.timingSafeEqual`, bukan panjang karakter string UTF-16. Hal ini mencegah pelemparan exception `RangeError` saat menerima secret dengan jumlah karakter sama tetapi panjang byte berbeda (misal karakter multi-byte). Input non-string atau invalid ditangani aman tanpa exception.<br>4. **Penanganan Kegagalan Factory Terkontrol Tanpa Kebocoran Informasi**: Kegagalan pada factory setelah autentikasi valid ditangani di dalam blok `try/catch` dan menghasilkan respons standar HTTP 500 `{ code: "INITIALIZATION_FAILED", message: "Layanan database atau API runtime tidak tersedia." }` tanpa membocorkan variabel environment, kredensial koneksi, atau stack trace mentah.<br>5. **Pelurusan Dokumentasi Marker Aktual**: Dokumentasi diluruskan secara faktual: marker pengujian runtime menggunakan kolom `description` pada tabel skenario yang sudah tersedia `public.mock_network_scenarios` (dengan ID `HELPDESK_TEST_ENV_MARKER`), tanpa membuat tabel marker fiktif atau migrasi skema baru.<br>6. **Verifikasi Komprehensif**: Diuji via 18 skenario unit & route boundary pada `tests/application/diagnostic-target-validator.test.ts` (170 unit tests lulus, exit code 0), 18 integrasi job worker lulus pada server Next.js lokal nyata (port 3188), Next.js build sukses, dan linter lulus 0 error. | KOREKSI TERARAH P2.5 SELESAI PENUH. DEFAULT: Seluruh target runtime diverifikasi sesuai koneksi efektif driver pg, autentikasi terbukti mendahului pemanggilan factory, dan dokumentasi selaras dengan kode aktual. Status P2.5: `Done`. Entry berikutnya D101. |

P2.5 selesai penuh (Done). Pipeline siap dilanjutkan ke P2.6 / fase berikutnya. Entry berikutnya D101.

## Fondasi Data Inbox, Akses Staf, dan Unread Persisten Per Staf (P2.6 Tahap 1) — D101

Tanggal: 4 Oktober 2026. Implementasi P2.6 Tahap 1: fondasi data Inbox dan akses staf:
1. Skema persistensi unread persisten per staf (`public.staff_conversation_reads`) dengan composite key `(staff_id, conversation_id)` yang terisolasi per sesi staf dan tidak saling mempengaruhi antar-staf.
2. Penandaan pesan dibaca strictly monotonic dan idempotent berbasis posisi pesan yang ditampilkan (`lastReadMessageId` dan `ingress_events.received_at`), mencegah kemunduran kursor dan tidak menelan pesan baru yang datang bersamaan/setelahnya.
3. Dekopling utuh container percakapan 24 jam dengan episode komplain: pesan non-komplain tetap tampil utuh di Inbox dan detail dengan status `latestEpisode = null` dan penanda `needsReview = true`.
4. Layanan aplikasi dan API khusus staf (`lib/application/inbox-service.ts`, `app/api/inbox/conversations`) dengan CTE terstruktur, pagination stabil 25 item (`last_activity_at DESC, id DESC`), filter status episode/unread/review, serta pencarian parameterized.
5. GET endpoints dan polling bersifat read-only tanpa efek samping mutasi database; mutasi kursor baca diisolasi pada POST terproteksi (`/api/inbox/conversations/[id]/read`) dengan actor murni dari sesi server (`getUser()`).
6. Pembacaan pesan dibuktikan tidak memutasi status episode komplain, tidak memicu supresi otomasi, dan tidak membuat jatah outbound intents.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D101 | 1. **Tabel Unread Cursor Persisten Per Staf (`public.staff_conversation_reads`)**: Dibuat tabel baru dengan kolom `staff_id` (UUID references `auth.users(id)` on delete cascade), `conversation_id` (UUID references `public.conversations(id)` on delete cascade), `last_read_message_id` (UUID references `public.messages(id)` on delete cascade), `last_read_at` (timestamptz), dan `updated_at` (timestamptz default now()), dengan primary key `(staff_id, conversation_id)` dan RLS khusus `authenticated` (`auth.uid() = staff_id`). Pembacaan oleh Staf A terbukti tidak mengubah posisi unread Staf B.<br>2. **Penyelarasan Linimasa & Monotonisitas Posisi Baca**: Penandaan dibaca dievaluasi terhadap `ingress_events.received_at` dari pesan target yang ditampilkan. Pembaruan kursor menggunakan `ON CONFLICT (staff_id, conversation_id) DO UPDATE ... WHERE excluded.last_read_at > public.staff_conversation_reads.last_read_at OR (excluded.last_read_at = ... AND excluded.last_read_message_id > ...)`. Pemanggilan ulang dengan pesan sama adalah idempotent (`advanced: false`), penandaan pesan lama ditolak memundurkan kursor (`advanced: false`), dan pesan baru yang datang setelah posisi baca tetap dihitung sebagai unread.<br>3. **Visibilitas Pesan Non-Komplain & Pemisahan Konsep Percakapan 24 Jam**: Pesan non-komplain (kategori selain komplain koneksi atau tanpa episode) tetap tersimpan dan ditampilkan di Inbox dengan `latestEpisode = null` dan `needsReview = true`. Pesan tidak dibuang diam-diam, dan percakapan 24 jam tetap terpisah dari siklus hidup episode masalah.<br>4. **Query Inbox Berbasis CTE & Pagination Stabil 25 Item**: `listInboxConversations` dan `getInboxConversationDetail` menstrukturkan logika data menggunakan CTE (`filtered_conversations`, `conversation_messages_agg`, `conversation_unread`, `latest_messages`, `latest_episodes`, `combined_items`). Pagination dibatasi default 25 item (maksimal 25) dengan urutan stabil deterministik `ORDER BY ci.last_activity_at DESC, ci.id DESC`. Total item dan total halaman dihitung sinkron.<br>5. **Batas Akses Staf & Read-Only Polling**: Rute HTTP `/api/inbox/conversations`, `/api/inbox/conversations/[id]`, dan `/api/inbox/conversations/[id]/read` memvalidasi sesi staf via `createClient().auth.getUser()`, menolak request tanpa sesi dengan HTTP 401 `UNAUTHENTICATED`. Actor staf murni diambil dari sesi server, menolak manipulasi dari browser. GET list/detail dan polling terbukti 100% read-only tanpa mutasi. Penandaan dibaca tidak mengubah status `public.complaints`, tidak memicu perubahan `public.automation_settings`, dan tidak membuat entri `public.outbound_intents`. | P2.6 TAHAP 1 SELESAI. DEFAULT: Seluruh 10 kriteria penerimaan terverifikasi empiris (11 subtest integrasi inbox passed, 11 unit test inbox passed, total 181 unit test passed, exit code 0). Status P2.6 tetap `In Progress` (tahap 2 UI Inbox dan polling menyusul). Entry berikutnya D102. |

P2.6 dalam status In Progress (Tahap 1 selesai penuh; Tahap 2 UI Inbox dan polling menyusul). Entry berikutnya D102.

## Koreksi A P2.6 Tahap 1: Pengamanan Mutasi Kursor Unread, Penolakan Mutasi Browser Langsung, Proteksi Origin/CSRF, dan Bukti Batas Sesi Staf — D102

Tanggal: 4 Oktober 2026. Koreksi A P2.6 Tahap 1: pengamanan mutasi kursor unread dan pembuktian batas akses staf:
1. Pencabutan izin mutasi langsung browser (`INSERT`, `UPDATE`, `DELETE`) dari `anon` dan `authenticated` pada `public.staff_conversation_reads` melalui migration baru `20261004110000_revoke_direct_staff_conversation_reads_mutation.sql`.
2. Pembuktian empiris dengan peran database sesungguhnya (`SET LOCAL ROLE authenticated`) bahwa percobaan penulisan langsung ditolak PostgreSQL dengan error `42501` (`permission_denied`), sementara pembacaan milik sendiri (`SELECT`) tetap diizinkan di bawah RLS owner, dan jalur backend tersertifikasi (`markConversationRead`) berfungsi normal.
3. Proteksi Origin / CSRF pada `POST /api/inbox/conversations/[id]/read` via `validateRequestOrigin()` yang dieksekusi ketat mendahului mutasi, pembacaan body, autentikasi, dan koneksi database. Origin yang hilang, tidak valid, atau lintas-domain ditolak dengan HTTP 403 `FORBIDDEN` ber-envelope standar tanpa membocorkan detail sensitif internal.
4. Bukti batas autentikasi rute: `GET` list, `GET` detail, dan `POST` read tanpa sesi staf terbukti mengembalikan HTTP 401 `UNAUTHENTICATED` dengan 0 pemanggilan database pool/query.
5. Aktor staf diproteksi murni dari sesi server (`user.id`); injeksi `staffId` pada body payload ditolak/diabaikan. Penandaan dibaca menolak pesan dari percakapan lain (404 `MESSAGE_NOT_FOUND`).
6. Sinkronisasi sumber migrasi ke `tests/test-env/supabase/migrations/`, pencatatan fixture segera setelah dibuat (`TestResourceTracker`), dan pembuktian preservasi fixture pembanding 100% identik sebelum dan sesudah cleanup.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D102 | 1. **Pencabutan Izin Mutasi Langsung Browser pada `public.staff_conversation_reads` (Migration 20261004110000)**: Kebijakan `insert` dan `update` milik authenticated dihapus, serta izin `INSERT`, `UPDATE`, `DELETE` dicabut dari role `authenticated` dan `anon`. Role `authenticated` hanya memiliki izin `SELECT` di bawah policy RLS `staff_reads_owner_select` (`auth.uid() = staff_id`). Pengujian membuktikan dengan peran database nyata (`SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', ...)`): percobaan `INSERT`, `UPDATE`, dan `DELETE` langsung menghasilkan error PostgreSQL `42501` (`permission_denied`), sedangkan `SELECT` berhasil, dan backend pool client dengan service role dapat melakukan pembaruan kursor secara sah.<br>2. **Proteksi Origin & CSRF pada POST Penandaan Dibaca**: Rute `POST /api/inbox/conversations/[id]/read` menerapkan validasi ketat via `validateRequestOrigin(request)` sebelum parsing JSON, autentikasi, atau query database. Header Origin yang tidak ada, bernilai browser `"null"`, malformed, atau tidak cocok dengan host/protokol server ditolak dengan HTTP 403 `FORBIDDEN` (`{ success: false, data: null, error: { code: "FORBIDDEN", message: "Akses tidak diizinkan." } }`) tanpa membocorkan hostname internal.<br>3. **Bukti Autentikasi Boundary Route & Penegakan Aktor Sesi**: Rute `GET /api/inbox/conversations`, `GET /api/inbox/conversations/[id]`, dan `POST /api/inbox/conversations/[id]/read` menyediakan dependency injection `InboxRouteDeps` untuk pengujian deterministik. Terbukti via spy: request tanpa sesi mengembalikan HTTP 401 `UNAUTHENTICATED` dan tidak memanggil pool database (0 pemanggilan). Pada sesi valid, aktor staf diambil murni dari sesi server (`authData.user.id`); parameter `staffId` yang disuntikkan penyerang di body request diabaikan sepenuhnya.<br>4. **Validasi Batas Pesan Lintas-Percakapan**: `markConversationRead` memvalidasi relasi pesan terhadap percakapan target (`m.id = $1 AND m.conversation_id = $2`). Penggunaan ID pesan yang sah namun milik percakapan lain ditolak tegas dengan HTTP 404 `MESSAGE_NOT_FOUND`.<br>5. **Sinkronisasi Migrasi Tes & Preservasi Fixture Pembanding**: File migrasi `20261004100000` dan `20261004110000` disinkronkan ke `tests/test-env/supabase/migrations/`. Fixture dicatat ke tracker segera saat `receive()` selesai sebelum `process()`. Fixture pembanding terpisah dibuktikan tetap 100% identik sebelum dan sesudah penghapusan fixture uji utama, membuktikan isolasi cleanup berbasis UUID tanpa penghapusan global. | KOREKSI A P2.6 TAHAP 1 SELESAI. DEFAULT: Seluruh 6 temuan pengamanan mutasi unread, penolakan mutasi browser langsung, proteksi CSRF/Origin, isolasi aktor sesi, dan batas pesan percakapan telah terverifikasi empiris (14 subtest integrasi inbox passed, 195 unit test passed, exit code 0). Status P2.6: `In Progress`. Entry berikutnya D103. |

P2.6 dalam status In Progress (Koreksi A selesai; Koreksi B model unread/kontrak data dan UI menyusul). Entry berikutnya D103.

## Penutupan Koreksi A P2.6 Tahap 1: Batas Kepercayaan Origin Server-Side, Bukti Cleanup Graph Lengkap & Failure Path, dan Guard Jalur Penerapan Migration — D103

Tanggal: 4 Oktober 2026. Penutupan menyeluruh Koreksi A P2.6 Tahap 1:
1. **Batas Kepercayaan Validasi Origin Server-Side (`lib/application/origin-validator.ts`)**:
   - Sumber origin tepercaya dikunci murni pada konfigurasi server (`HELPDESK_TRUSTED_ORIGINS`), variabel platform deployment Vercel (`VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_URL`), base application URL (`NEXT_PUBLIC_APP_URL` / `APP_URL`), atau fallback lingkungan non-produksi (`http://localhost:3000`, `http://127.0.0.1:3000`).
   - Header dari request (`x-forwarded-host`, `x-forwarded-proto`, `host`) dilarang keras menambahkan atau memperluas daftar origin yang dipercaya. Percobaan spoofing ditolak tegas dengan HTTP 403 `origin_mismatch`.
   - Perbandingan origin dilakukan secara exact (scheme, host, dan port via WHATWG URL normalization).
   - Konfigurasi origin tepercaya yang tidak valid memicu fail-closed (HTTP 403 `FORBIDDEN`), tanpa pernah diam-diam beralih ke sumber yang tidak tepercaya.
   - Pada boundary route handler `POST /api/inbox/conversations/[id]/read`, penolakan Origin terbukti tidak memanggil autentikasi dan tidak menyentuh database pool.
2. **Bukti Cleanup Fixture Graph Lengkap dan Jalur Kegagalan Terkontrol (`tests/integration/inbox.test.ts`)**:
   - Fixture target yang diuji pembersihannya pada AC 11 berupa graph utuh hasil pemrosesan `HelpdeskPersistence.receive()` dan `process()`, mencakup `ingress_events`, `channel_identities`, `conversations`, `messages`, `complaints` (episode), `triage_assessments`, `complaint_audit_log`, `reply_claims`, dan `staff_conversation_reads`.
   - Keberadaan seluruh record target dibuktikan secara eksplisit sebelum pembersihan.
   - Fixture pembanding terpisah disiapkan dengan snapshot mendalam pada percakapan, pesan, episode, assessment, dan read state.
   - Target dibersihkan via `cleanupFixture(pool, targetTracker)`; terbukti seluruh record target terhapus tuntas (count = 0) dan data pembanding tetap 100% identik dengan snapshot.
   - Fixture pembanding dibersihkan di blok `finally` dan diverifikasi terhapus tuntas.
   - Skenario AC 12 membuktikan jalur kegagalan terkontrol: pencatatan resource segera setelah `receive()` menjamin teardown berhasil membersihkan seluruh resource tanpa kebocoran data saat processing gagal.
   - Integrasi `combineErrors(primaryError, cleanupErrors)` memastikan jika primary error dan cleanup error sama-sama terjadi, keduanya dilaporkan secara utuh dan kegagalan cleanup tidak pernah tertelan.
   - Teardown diproteksi oleh guard: jika guard lingkungan gagal sebelum fixture dibuat, teardown tidak mengeksekusi mutasi pada database yang belum terverifikasi.
3. **Guard Driver-Level Jalur Penerapan Migration (`tests/utils/test-migration-runner.ts` & `scripts/apply-test-migrations.mjs`)**:
   - Runner migrasi terpadu menerapkan guard `parseAndValidateTestConfig` (mencegah target DB pengguna port 54322/54321).
   - Verifikasi dual-path marker token PG dan Supabase API mendahului seluruh operasi DDL; penolakan target atau token mismatch menghasilkan nol DDL dan nol mutasi fixture.
   - Verifikasi konsistensi byte-for-byte antara file migrasi root (`supabase/migrations`) dan salinan lingkungan tes (`tests/test-env/supabase/migrations`).
   - Pemeriksaan tabel `supabase_migrations.schema_migrations`; migrasi yang sudah tercatat (`20261004100000`, `20261004110000`) tidak diterapkan ulang secara buta.
   - DDL dieksekusi dalam transaksi atomik pada pool yang sudah lolos guard.
   - Terverifikasi empiris melalui 5 subtest di `tests/utils/test-migration-runner.test.ts` dan eksekusi `scripts/apply-test-migrations.mjs`.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D103 | 1. **Batas Kepercayaan Origin Server-Side & Anti-Spoofing Forwarded Headers**: `validateRequestOrigin` memvalidasi origin hanya terhadap server authority (`HELPDESK_TRUSTED_ORIGINS`, `VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_URL`, `APP_URL`, atau loopback dev). Header client (`x-forwarded-host`/`proto`) tidak dapat memperluas daftar origin yang dipercaya. Origin asing ditolak 403 `origin_mismatch`. Konfigurasi invalid memicu fail-closed 403 `origin_mismatch`. Pada route POST read, penolakan Origin terbukti mendahului auth dan pool access.<br>2. **Verifikasi Cleanup Graph Penuh & Kegagalan Terkontrol**: AC 11 membuktikan pembersihan graph lengkap (conversation, message, complaint, triage assessment, audit, dan read record) via `cleanupFixture` dengan keberadaan record terbukti sebelum cleanup dan preservasi fixture pembanding 100% identik. AC 12 membuktikan pencatatan instan sumber daya menjamin cleanup tuntas saat proses gagal. `combineErrors` melaporkan primary error dan cleanup error secara bersamaan tanpa menyembunyikan kegagalan cleanup. Mutasi teardown diblokir jika guard lingkungan belum lolos.<br>3. **Runner Migrasi Tes Tervalidasi Guard**: Disediakan `tests/utils/test-migration-runner.ts` dan `scripts/apply-test-migrations.mjs` yang memverifikasi konfigurasi host/port, konsistensi file migrasi root vs test-env, dan dual-path marker sebelum mengeksekusi DDL. Migrasi yang sudah tercatat di `schema_migrations` dilewati secara aman tanpa DDL redundan. | PENUTUPAN KOREKSI A P2.6 TAHAP 1 SELESAI PENUH. DEFAULT: Tiga kekurangan Koreksi A (kepercayaan origin, cleanup graph/failure path, dan guard jalur migrasi) telah ditutup dan terbukti secara empiris. Status P2.6 tetap `In Progress` (menunggu Koreksi B model unread/kontrak data dan Tahap 2 UI Inbox). Entry berikutnya D104. |
| D104 | 1. **Resolusi Target Efektif Driver `pg` Tanpa Akses Jaringan (D100)**: `tests/utils/test-migration-runner.ts` mengadopsi `resolveEffectivePgTarget(connectionString)` via parser internal driver `pg` (`new Client({ connectionString })`) tanpa membuka koneksi jaringan. Hal ini mendeteksi penggantian host atau port via query parameters (`?port=54322`, `?port=5432`, `?host=evil.com`). Target pengguna dan host diversion ditolak keras sebelum koneksi jaringan atau pool dibuat, terbukti dengan counter 0 call. Kredensial tidak pernah dicetak dalam log atau pesan error.<br>2. **Atomisitas DDL & Ledger Transaksi Tunggal**: Runner mengelola satu dedicated client via `pool.connect()` sepanjang migrasi. Pembungkus terluar `BEGIN;` dan `COMMIT;` dilepas secara presisi dari SQL migrasi tanpa mengubah konten internal. DDL dan pencatatan ledger `supabase_migrations.schema_migrations` dieksekusi atomik dalam satu transaksi. Terbukti empiris pada database uji terisolasi via fixture bertarget unik: sukses (tabel terbentuk + ledger tercatat), rollback (kegagalan check-constraint pada ledger membatalkan DDL tanpa residu), dan skipping (0 DDL).<br>3. **Proteksi Teardown Multi-Tracker & Preservasi Pembanding 6 Tabel (AC 11 & AC 11.1)**: `tests/integration/inbox.test.ts` membungkus targetTracker dan compTracker dalam blok `finally` dengan blok try-catch mandiri sehingga kegagalan satu tracker tidak menghentikan yang lain. Assert episode complaint dibuktikan tanpa syarat. Snapshot dan preservasi diverifikasi mendalam pada 6 tabel (`conversations`, `messages`, `complaints`, `staff_conversation_reads`, `triage_assessments`, `complaint_audit_log`). Absennya `reply_claims` dan `outbound_intents` dibuktikan sesuai perilaku SHADOW. Subtest AC 11.1 membuktikan teardown pasca pembuatan target mencegah kebocoran data.<br>4. **Jalur Processing Nyata & Pelaporan Error Ganda (AC 12 & AC 12.1)**: AC 12 memanggil jalur `HelpdeskPersistence.process()` nyata dengan lease token invalid yang memicu `PersistenceError("lease_lost")` dari dalam engine processing, dengan seluruh resource ingress dibersihkan di blok `finally`. AC 12.1 membuktikan `combineErrors` mempertahankan pesan primary error dan cleanup error secara bersamaan tanpa saling menutupi, sementara tracker independen lainnya tetap berhasil dibersihkan di DB.<br>5. **Klarifikasi Marker & Persyaratan Runner**: Runner memerlukan lingkungan terisolasi dengan baseline schema dan marker yang sudah tersedia di `public.mock_network_scenarios.description` dengan ID sesuai `HELPDESK_TEST_ENV_MARKER` (`test_env_isolated_marker`). Runner tidak melakukan bootstrap database kosong sebelum tabel marker tersedia. | PENUTUPAN PENUH KOREKSI A P2.6 TAHAP 1 TERVERIFIKASI EMPIRIS. Seluruh guard target efektif, atomisitas DDL & ledger, proteksi teardown multi-tracker, dan failure path nyata telah terbukti (13 checks test-migration-runner lulus, 17 checks inbox integration lulus, 221 unit test lulus, exit code 0). Status P2.6: `In Progress` (Koreksi B model unread/kontrak data dan Tahap 2 UI Inbox menyusul). Entry berikutnya D105. |
| D105 | 1. **Pemisahan dan Pengamanan Suite Integrasi Migration**: Pengujian database nyata dipisahkan dari `tests/utils/test-migration-runner.test.ts` ke suite integrasi mandiri `tests/integration/migration-runner.test.ts`. `npm run test:unit` murni menguji parser, resolusi target driver pg, unwrapping transaksi, dan mock spies (218 passed, 0 failed, 0 skipped, 0 network/DB access). Ditambahkan script `npm run test:migrations:local` dengan flag eksplisit `--env-file=.env.test`. Seluruh hardcoded connection string, credential fallback, dan marker fallback dihapus. Guard target efektif driver pg dan verifikasi marker ganda PostgreSQL/API wajib mendahului seluruh mutasi harness; kegagalan guard terbukti menghasilkan nol DDL dan nol mutasi teardown dengan koneksi ditutup secara aman.<br>2. **Kepemilikan Fixture Migration Per-Run & Isolasi Teardown**: Seluruh entitas fixture migration (`test_atom_ok_<runId>`, `test_atom_rb_<runId>`, versi ledger `2099...`, constraint `chk_mig_reject_<runId>`, dan direktori sementara `tmpdir()/helpdesk-migration-test-<runId>`) dibentuk unik per-run dari string alfanumerik yang tervalidasi regex identifier. Cleanup hanya menghapus resource yang tercatat milik run ini tanpa `DROP TABLE ... CASCADE` pada nama statis atau penghapusan global pada ledger migrasi. Constraint penolakan ledger hanya menolak versi fail run ini dan dibersihkan di blok `finally`. Error utama, rollback, cleanup, dan pool end digabungkan via `combineErrors` tanpa saling menutupi.<br>3. **Penutupan Kebocoran Identity pada AC 11.1 (`inbox.test.ts`)**: `identityId` kedua fixture (target dan pembanding) dicatat ke `targetTracker` dan `compTracker` segera setelah `persistence.receive()` berhasil sebelum pemrosesan atau assertion lanjutan. Assertion pasca kegagalan terkontrol membuktikan seluruh entitas graph (`channel_identities`, `ingress_events`, `processing_jobs`, `conversations`, `messages`, `triage_assessments`, serta `complaints` dan `complaint_audit_log`) terhapus tuntas (count = 0) tanpa kebocoran.<br>4. **Proteksi Siklus Hidup AC 12.1 dan Suite Pool Teardown (`inbox.test.ts`)**: AC 12.1 dibungkus blok `try/finally` sejak sebelum resource pertama dibuat (`receive()`), memastikan teardown selalu berjalan jika query di tengah langkah gagal. Tracker B dibuktikan bersih tuntas di database (termasuk `channel_identities` dan `ingress_events`). Pada teardown suite, `await pool.end()` dibungkus `try/catch` dan error-nya diakumulasikan ke `cleanupErrors` sebelum `combineErrors` sehingga tidak pernah menimpa primary error atau meniadakan error cleanup yang terkumpul. | PENUTUPAN DEFINITIF KOREKSI A P2.6 TAHAP 1 TERVERIFIKASI EMPIRIS. Isolasi unit vs integrasi migrasi, kepemilikan fixture unik per-run, penghapusan kebocoran identity AC 11.1, dan proteksi teardown AC 12.1/suite pool telah terbukti (6 subtest migration-runner passed, 17 subtest inbox integration passed, 218 unit test passed, eslint 0 error). Status P2.6: `In Progress` (Koreksi B model unread/kontrak data dan Tahap 2 UI Inbox menyusul). Entry berikutnya D106. |
| D106 | 1. **Lifecycle Harness Bersama untuk Uji Guard & Integrasi Migrasi (`test-migration-harness.ts`)**: Ekstraksi helper `runMigrationTestLifecycle` yang dipakai bersama oleh eksekusi integrasi migrasi normal dan pengujian kegagalan guard. Guard sesungguhnya (`requireIsolatedDatabase`) dieksekusi sebelum mutasi/workload apa pun. Pada pengujian negatif dengan stub dependencies (marker tidak cocok), guard memvalidasi dan melempar error target mismatch; langkah eksekusi fixture terbukti tidak pernah dijalankan; mutasi teardown terbukti 0 DDL; pool koneksi terbukti tetap ditutup aman; dan kegagalan penutupan pool digabungkan secara utuh dengan error utama via `combineErrors` tanpa saling menutupi.<br>2. **Pencatatan Pre-Tracked Identity Sebelum `receive()` & Eliminasi Race Window**: Pada `tests/integration/inbox.test.ts` (AC 11, AC 11.1, AC 11.2, AC 12, AC 12.1), helper `receiveTrackedInboundFixture` membuat baris `public.channel_identities` terlebih dahulu dengan UUID dan natural key unik milik run, serta langsung mencatatnya ke `TestResourceTracker` sebelum `persistence.receive()` dipanggil. Saat `receive()` berjalan, `store.ensureIdentity()` menyelesaikan konflik via `ON CONFLICT DO UPDATE RETURNING id` dan memakai identity yang telah terlacak tersebut. Ingress ID dan message ID dicatat segera setelah `receive()` berhasil, dan relasi `ingress_events.identity_id === identityId` diverifikasi.<br>3. **Skenario Kegagalan Query Terkontrol Pasca receive() (AC 11.2)**: Ditambahkan pengujian terkontrol di mana `receive()` berhasil membentuk resource di database, tetapi query berikutnya sengaja digagalkan dengan error yang direncanakan. Teardown pada blok `finally` berjalan menggunakan tracker yang sudah memiliki kepemilikan identity dan ingress. Terbukti bahwa seluruh fixture (`channel_identities`, `ingress_events`, `processing_jobs`) terhapus tuntas (count = 0), dan resource downstream (`messages`, `triage_assessments`, `complaints`, `reply_owners`, `reply_claims`, `outbound_intents`) bernilai 0 tanpa klaim prematur karena kegagalan terjadi sebelum `process()`. Mode SHADOW dipertahankan. | PENUTUPAN KOREKSI A P2.6 TAHAP 1 SELESAI PENUH & DEFINITIF. Wiring harness lifecycle bersama, pengujian negatif guard dengan stub dependencies, pencatatan pre-tracked identity fixture, dan skenario kegagalan query pasca receive() telah terbukti empiris (7 subtests migration-runner passed, 18 subtests inbox integration passed, 218 unit tests passed, eslint 0 error, tsc 0 error). Status P2.6: `In Progress` (Koreksi B model unread/kontrak data dan Tahap 2 UI Inbox menyusul). Entry berikutnya D107. |

| D107 | 1. **Rekonsiliasi Bukti Kegagalan Query AC 11.2 via Injeksi Dependency Query Nyata**: Pada `tests/integration/inbox.test.ts` (AC 11.2), mekanisme kegagalan query diperbaiki dari melempar error di luar helper menjadi pengujian kegagalan sesungguhnya pada query pertama di dalam helper `receiveTrackedInboundFixture` sesudah `persistence.receive()` berhasil: `SELECT identity_id FROM public.ingress_events WHERE id = $1`. Injeksi dilakukan satu kali melalui dependency query khusus pengujian (`faultInjectedPool` via Proxy), sedangkan operasi `receive()` produksi tetap berjalan nyata pada database pengujian terisolasi.<br>2. **Verifikasi Lifecycle Terproteksi, Pre-Cleanup Existence & Zero Leakage**: Terbukti helper gagal sebelum mengembalikan hasil (`helperReturned = false`). ID fixture dibaca langsung dari tracker dan observasi query (bukan dari return value helper yang gagal). Keberadaan `channel_identities`, `ingress_events`, dan `processing_jobs` dibuktikan secara nyata sebelum pembersihan melalui query database pool asli. Blok `finally` mengeksekusi `cleanupFixture(pool, controlledTracker)` dan membuktikan ketiga sumber daya tersebut terhapus tuntas (count = 0), dengan downstream resources (`messages`, `triage_assessments`, `complaints`, `reply_owners`, `reply_claims`, `outbound_intents`) tetap 0 tanpa pembentukan episode prematur.<br>3. **Agregasi Dual Error Tanpa Saling Menutupi**: Error terencana (`PLANNED_POST_RECEIVE_QUERY_FAILURE: Database connection terminated during post-receive ingress identity lookup`) dan error teardown diproteksi `combineErrors` sehingga kegagalan cleanup tidak menutupi error utama ataupun sebaliknya. | PENUTUPAN KOREKSI A P2.6 TAHAP 1 TERVERIFIKASI EMPIRIS PENUH. Pengujian kegagalan query pasca receive() sebelum helper return terbukti tuntas (18 subtests inbox integration passed, eslint 0 error, tsc 0 error). Status P2.6: `In Progress` (Koreksi B model unread/kontrak data dan Tahap 2 UI Inbox menyusul). Entry berikutnya D108. |

P2.6 dalam status In Progress (Koreksi A selesai definitif; Koreksi B1 unread model selesai; Koreksi B2 dan Tahap 2 UI Inbox menyusul). Entry berikutnya D108.

## Koreksi B1 P2.6 Tahap 1: Invariant Unread Eksplisit Per-Staf, Eliminasi Celah Delayed Processing, dan Penandaan Baca Atomik Monotonik — D108

Tanggal: 4 Oktober 2026. Implementasi Koreksi B1 P2.6 Tahap 1:
1. **Model Invariant Unread Eksplisit Per-Staf (`public.staff_message_reads`)**:
   - Model lama yang membandingkan `received_at` dan UUID pesan terhadap kursor skalar tunggal (`last_read_at`, `last_read_message_id`) rentan terhadap anomali visibilitas: pesan yang terlambat diproses (delayed processing) atau pesan yang masuk di antara snapshot detail dan mutasi baca dapat memiliki `received_at` lebih lama/sama dan UUID lebih kecil, sehingga secara keliru terhitung sudah dibaca padahal staf belum pernah melihatnya.
   - Solusi: Menghadirkan tabel granular `public.staff_message_reads` (migrasi `20261004120000_create_staff_message_reads.sql`):
     - Kolom: `staff_id uuid`, `conversation_id uuid`, `message_id uuid`, `read_at timestamptz`.
     - Kunci primer komposit: `(staff_id, message_id)`.
     - Foreign key cascade ke `auth.users(id)`, `public.conversations(id)`, dan `public.messages(id)`.
     - RLS diaktifkan; hak `INSERT`, `UPDATE`, `DELETE` dicabut penuh dari role `authenticated` dan `anon`; hanya `SELECT` baris milik sendiri yang diizinkan (`auth.uid() = staff_id`). Mutasi hanya diizinkan via service role di backend.
2. **Kontrak Layanan & Penandaan Baca Berbasis Snapshot**:
   - `MarkConversationReadCommand` menerima `acknowledgedMessageIds: readonly string[]` (daftar eksplisit UUID pesan dari snapshot detail yang ditampilkan ke staf) di samping fallback backward-compatible `lastReadMessageId`.
   - Seluruh ID pesan divalidasi harus berupa UUID valid dan diverifikasi milik percakapan target (`conversation_id = $1`). Upaya menyisipkan pesan dari percakapan lain ditolak tegas dengan HTTP 404 `MESSAGE_NOT_FOUND`.
   - GET list (`listInboxConversations`) dan GET detail (`getInboxConversationDetail`) tidak melakukan mutasi apa pun (strictly read-only).
   - Penandaan baca tidak mengubah status episode complaint, claim outbound, maupun automation settings.
3. **Atomisitas Transaksi & Preservasi Kursor Monotonik**:
   - Mutasi dieksekusi dalam transaksi PostgreSQL (`BEGIN ... COMMIT`) yang dilindungi advisory lock transaksi: `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))` dengan scope `(staffId, conversationId)`.
   - Insersi batch menggunakan `INSERT INTO public.staff_message_reads ... ON CONFLICT (staff_id, message_id) DO NOTHING RETURNING message_id`. Nilai `newlyReadCount` ditentukan murni dari hasil mutasi DB yang berhasil (`RETURNING`).
   - Definisi `advanced`: `newlyReadCount > 0` (benar-benar memajukan status pembacaan pesan baru).
   - Kursor agregat di `public.staff_conversation_reads` diperbarui secara monotonik mengambil pesan terbaca terbaru (`ORDER BY ie.received_at DESC, m.id DESC LIMIT 1`).
   - Idempotensi: Request berulang dengan snapshot yang sama mengembalikan `advanced = false`, `newlyReadCount = 0`, dan tidak mengubah state DB.
   - Anti-Regresi: Request dengan snapshot lama tidak menurunkan kursor baca yang sudah lebih maju atau menghapus pesan yang sudah terbaca; respons tetap mengembalikan kursor pemenang.
   - Resolusi unread terpadu:
     - `unreadCount = COUNT(m.id) ... WHERE smr.message_id IS NULL`
     - `isRead = EXISTS (SELECT 1 FROM public.staff_message_reads smr WHERE smr.message_id = m.id AND smr.staff_id = $2)`
     - `isUnread = NOT isRead`
4. **Verifikasi Empiris Terarah (23 Subtests Integrasi Inbox Passed)**:
   - AC 6 (4.a): Isolasi unread persisten per staf A vs B dan reload state.
   - AC 6.1 (4.d): Pesan delayed processing dengan `received_at` lebih lama yang di-commit setelah snapshot staf tetap UNREAD.
   - AC 6.2 (4.e): Pesan baru dengan `received_at` identik dan UUID lebih kecil tetap UNREAD.
   - AC 6.3 (4.f): Presisi mikrodetik PostgreSQL (`.123456` vs `.123789`) tidak menyebabkan salah baca.
   - AC 7 (4.b, 4.c): Idempotensi pengulangan snapshot & request snapshot lama tidak memundurkan kursor atau menghilangkan status baca.
   - AC 7.1 (4.g): Dua request konkuren pada koneksi terpisah (`client1` & `client2`) dengan barrier deterministik membuktikan request kedua terblokir di `pg_locks` (`locktype = 'advisory' AND NOT l.granted`), keduanya selesai sukses berurutan, dan kursor akhir konsisten.
   - AC 8.1 (4.h): Pesan baru yang masuk di antara snapshot fetch dan penandaan baca tetap UNREAD.
   - AC 9: Penandaan baca tidak mengubah status episode komplain, automation mode, atau membuat outbound claim.
   - AC 1.1: Penolakan mutasi langsung browser (`permission_denied` 42501) pada `public.staff_message_reads`.
   - AC 11: Cleanup fixture cascade mencakup `staff_message_reads` dan preservasi data pembanding 100% utuh.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D108 | 1. **Model Invariant Unread Eksplisit Per-Staf (`public.staff_message_reads`)**: Penandaan baca menggunakan pengakuan ID pesan snapshot secara eksplisit via tabel `public.staff_message_reads (staff_id, conversation_id, message_id, read_at)` dengan PK komposit `(staff_id, message_id)`. Role `authenticated` dan `anon` dilarang menulis langsung (`revoke INSERT, UPDATE, DELETE`); hanya `SELECT` milik sendiri yang diizinkan RLS. Mutasi dieksekusi via backend service role.<br>2. **Eliminasi Celah Delayed Processing & Anomali Timestamp/UUID**: Pesan yang belum masuk snapshot detail staf tetap terhitung unread (`isRead = false`, `unreadCount`), terbukti pada: (a) pesan delayed processing dengan `received_at` lebih lampau yang baru di-commit, (b) pesan dengan `received_at` identik dan UUID lebih kecil, (c) presisi mikrodetik PostgreSQL (`.123456` vs `.123789`), serta (d) pesan baru yang masuk di antara fetch snapshot dan mutasi baca.<br>3. **Atomisitas Transaksi, Advisory Lock & Monotonisitas Respons**: Mutasi dilindungi `pg_advisory_xact_lock(hashtext($1), hashtext($2))` dan dieksekusi atomik `BEGIN...COMMIT`. Nilai `advanced` dan `newlyReadCount` dibentuk dari `RETURNING message_id` DB. Request berulang idempoten (`advanced = false`). Request snapshot lama tidak memundurkan kursor agregat di `public.staff_conversation_reads`. Uji konkurensi terbukti memblokir koneksi kedua di `pg_locks` advisory dan menjaga integritas state.<br>4. **Integritas Fixture & Isolasi Cleanup**: Cleanup cascade pada `tests/utils/test-guard.ts` mencakup `public.staff_message_reads`. Baseline fixture pembanding 6 tabel terbukti 100% utuh pasca cleanup target. | KOREKSI B1 P2.6 TAHAP 1 TERVERIFIKASI EMPIRIS PENUH. Seluruh invariant unread, eliminasi delayed processing misread, atomisitas advisory lock, dan kepatuhan permission DB terbukti (23 subtests inbox integration passed, 218 unit tests passed, 7 migration runner passed, eslint 0 error, tsc 0 error). Status P2.6: `In Progress` (Koreksi B2 dan Tahap 2 UI Inbox menyusul). Entry berikutnya D109. |

## Koreksi Terarah B1 P2.6 Tahap 1: Penutupan Empat Temuan Review B1 (Fallback, Backfill Konservatif, Presisi Mikrodetik, dan Fixture Ownership) — D109

Tanggal: 4 Oktober 2026. Implementasi koreksi terarah B1 P2.6 Tahap 1 menutup 4 temuan review:
1. **Pemberhentian Perluasan Rentang pada Fallback `lastReadMessageId`**:
   - Menghapus pembacaan dan penandaan rentang pesan (`received_at < ... OR (received_at = ... AND id <= ...)`) pada cabang fallback `lastReadMessageId`.
   - Semantik final: jika `acknowledgedMessageIds` diberikan, hanya kumpulan ID tersebut yang ditandai dibaca (`lastReadMessageId` tidak boleh memperluas). Jika hanya `lastReadMessageId` yang diberikan (fallback tunggal), hanya satu pesan persis yang disebutkan yang diakui.
   - Pesan divalidasi terhadap percakapan target (`conversation_id = $1`). Pesan dari percakapan lain ditolak 404 `MESSAGE_NOT_FOUND`.
   - Terbukti empiris pada AC 6.4: snapshot memuat M1; M2 diproses setelah snapshot; request hanya `lastReadMessageId = M1` tidak membuat M2 terbaca (`unreadRemaining = 1`, M2 `isRead = false`); pengulangan menghasilkan `newlyReadCount = 0` dan `advanced = false`.
2. **Koreksi Transisi Read-State Lama secara Konservatif via Migrasi Baru (`20261004130000`)**:
   - Dibuat migrasi korektif baru `supabase/migrations/20261004130000_correct_legacy_message_read_backfill.sql` dan salinan identik `tests/test-env/supabase/migrations/20261004130000_correct_legacy_message_read_backfill.sql`.
   - Menambahkan kolom `is_confirmed boolean not null default true` pada `public.staff_message_reads` dan `public.staff_conversation_reads`.
   - Menandai seluruh baris hasil backfill rentang migrasi lama sebagai tidak terkonfirmasi (`is_confirmed = false`).
   - Kebijakan unread: seluruh query unread (`listInboxConversations`, `getInboxConversationDetail`, kursor agregat) memfilter secara ketat `is_confirmed = true`. Pesan dari baris legacy yang belum memiliki acknowledgement eksplisit diperlakukan sebagai unread sampai ada pengakuan baru dari staf.
   - Konfirmasi eksplisit baru menggunakan `ON CONFLICT (staff_id, message_id) DO UPDATE SET is_confirmed = true, read_at = now() WHERE NOT staff_message_reads.is_confirmed RETURNING message_id`, sehingga konfirmasi terhitung tepat pada `newlyReadCount` dan berjalan idempoten.
   - Terbukti empiris pada AC 6.5: baris unconfirmed tidak membuat pesan terbaca; konfirmasi eksplisit memajukan state secara idempoten; staf lain tetap terisolasi.
3. **Preservasi Presisi Mikrodetik Kursor Agregat di PostgreSQL**:
   - Menghindari konversi timestamp ke JavaScript `Date` (yang memotong mikrodetik menjadi milidetik).
   - Pemilihan pesan terbaca terbaru dan pembaruan `last_read_at` dieksekusi langsung di PostgreSQL menggunakan `ie.received_at`.
   - Kursor dibaca dalam format ISO teks presisi penuh mikrodetik via `to_char(last_read_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.
   - Terbukti empiris pada AC 6.3: M1 memiliki `.123456` dan UUID lebih besar, M2 memiliki `.123789` dan UUID lebih kecil; pengakuan M1 menghasilkan respons kursor berakhir `.123456Z` dan nilai di DB cocok; pengakuan M2 menghasilkan `.123789Z`; snapshot lama tidak memundurkan kursor; assert dilakukan pada presisi PostgreSQL.
4. **Kepemilikan Fixture B1 Baru, Eliminasi Loop Acak, dan Concurrency Terikat PID**:
   - Helper `receiveTrackedInboundFixture` diperluas dengan opsi `existingIdentityId`: identity dicatat sebelum `receive()` pertama; pesan berikutnya dari pengirim yang sama menggunakan `existingIdentityId` dengan natural key yang sama tanpa duplikasi identity.
   - Relasi UUID kecil/besar dibuat 100% deterministik (`const [smallerFix, largerFix] = fixA.ingressId < fixB.ingressId ? [fixA, fixB] : [fixB, fixA]`), mengeliminasi loop pencarian acak 20 percobaan pada AC 6.2.
   - Tes konkurensi AC 7.1 membaca PID koneksi via `SELECT pg_backend_pid() AS pid` dan membuktikan connection 2 (PID 2) secara nyata terblokir pada advisory lock yang dipegang connection 1 (PID 1) melalui join `pg_locks` (`l_blocked.pid = pid2 AND l_holding.pid = pid1 AND NOT l_blocked.granted AND l_holding.granted`).
   - Blok `finally` pada AC 7.1 menjamin pelepasan barrier, penungguan request via `Promise.race` dengan timeout 3 detik, dan release koneksi aman agar tes tidak menggantung saat assertion gagal.
   - AC 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 8.1 terbukti bersih tuntas dibersihkan oleh `cleanupFixture` tanpa kebocoran data.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D109 | 1. **Penutupan Rentang Fallback `lastReadMessageId`**: Cabang fallback `lastReadMessageId` tanpa `acknowledgedMessageIds` hanya menandai tepat 1 pesan yang dimaksud; dilarang memperluas ke rentang pesan sebelumnya. Jika `acknowledgedMessageIds` ada, daftar tersebut mutlak dan tidak diperluas oleh `lastReadMessageId`. Validasi memastikan pesan ada pada percakapan target.<br>2. **Migrasi Korektif Legacy Read-State `20261004130000` & Flag `is_confirmed`**: Menambahkan kolom `is_confirmed boolean not null default true` pada `staff_message_reads` dan `staff_conversation_reads`. Baris legacy backfill ditandai `is_confirmed = false` dan diperlakukan unread sampai ada acknowledgement eksplisit baru dari staf. Konfirmasi baru meng-update `is_confirmed = true` secara idempoten.<br>3. **Presisi Mikrodetik Kursor di PostgreSQL**: Update dan perbandingan kursor agregat dieksekusi langsung di SQL dari `ingress_events.received_at`. Pembacaan kursor menggunakan `to_char(last_read_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` sehingga mikrodetik tidak terpotong oleh parser JavaScript Date.<br>4. **Pre-Tracked Identity Fixture & Concurrency Terikat PID**: Helper `receiveTrackedInboundFixture` mendukung `existingIdentityId` untuk multi-message dari sender yang sama. Loop pencarian UUID acak diganti relasi deterministik. Uji konkurensi memverifikasi blocking di `pg_locks` berdasarkan PID koneksi (`l_blocked.pid = pid2 AND l_holding.pid = pid1`) dan diproteksi timeout release pada blok `finally`. | EMPAT TEMUAN REVIEW B1 P2.6 TAHAP 1 DITUTUP PENUH & TERVERIFIKASI EMPIRIS. Seluruh 25 checks integrasi inbox, 7 checks migration runner, dan 218 checks unit tests lulus (exit code 0, eslint 0 error, tsc 0 error). Status P2.6: `In Progress` (menunggu Koreksi B2 kontrak/pagination list dan Tahap 2 UI Inbox). Entry berikutnya D110. |

## Rekonsiliasi Kebijakan Migrasi Read-State, Integrasi Migrasi SQL Aktual, Preservasi Fallback Bug-Trigger, dan Pengerasan Lifecycle Konkurensi — D110

Tanggal: 4 Oktober 2026. Implementasi penutupan bukti Koreksi B1 P2.6 Tahap 1 menutup 4 area kekurangan bukti:
1. **Rekonsiliasi Kebijakan Migrasi & Eliminasi Klaim Cutoff Tanggal**:
   - Menyelaraskan dokumentasi dengan source SQL aktual pada `supabase/migrations/20261004130000_correct_legacy_message_read_backfill.sql` dan salinan identik `tests/test-env/supabase/migrations/20261004130000_correct_legacy_message_read_backfill.sql`.
   - Mengoreksi narasi laporan sebelumnya: source migration `20261004130000` **TIDAK memiliki cutoff tanggal** (`WHERE read_at <= ...`). Kebijakan aktual: **seluruh read-state yang ada sebelum transisi diperlakukan tidak terkonfirmasi (`is_confirmed = false`) secara tanpa syarat**, karena tanpa snapshot detail staf historis, provenance pembacaan tidak dapat dibuktikan. Konsekuensinya, acknowledgement lama yang sebelumnya sah juga dapat kembali tampil unread sampai staf memberikan acknowledgement eksplisit baru.
   - Tidak ada modifikasi pada file migrasi yang telah diaplikasikan; tidak ada penambahan migrasi palsu hanya untuk menyamakan redaksi lama.
2. **Integrasi Migrasi SQL Aktual pada Namespace Terisolasi (AC 6.6)**:
   - Dibuat pengujian transisi migrasi nyata AC 6.6 membaca langsung file migrasi fisik di disk via `fs.readFileSync` (`20261004120000_create_staff_message_reads.sql` dan `20261004130000_correct_legacy_message_read_backfill.sql`).
   - Eksekusi diisolasi pada namespace skema per-run (`CREATE SCHEMA test_mig_<runId>`) dengan pemetaan `public.staff_message_reads` dan `public.staff_conversation_reads` ke namespace uji, tanpa mengubah logika SQL, kondisi WHERE, atau ekspresi backfill sama sekali.
   - *Skenario Upgrade*: kursor legacy + pesan tertunda dengan `received_at` lebih lampau dieksekusi migrasi 120000 (terbukti kedua pesan ter-backfill), lalu dieksekusi migrasi korektif 130000; terbukti kedua baris backfill dan kursor legacy menjadi `is_confirmed = false`, sementara relasi domain `public.messages` dan `public.conversations` tetap 100% utuh.
   - *Skenario Fresh Sequence*: terbukti default kolom `is_confirmed` adalah `true`, acknowledgement eksplisit pasca-transisi menghasilkan baris terkonfirmasi (`is_confirmed = true`), idempoten, dan tidak ikut mengonfirmasi pesan lain.
   - *Skenario Dampak Kebijakan*: kursor bertimestamp sebelum dan sesudah 12:00:00 (11:00:00 vs 14:00:00) keduanya terbukti menjadi `is_confirmed = false`, membuktikan kebijakan source final tanpa asumsi cutoff.
   - *Teardown*: mengeksekusi `DROP SCHEMA test_mig_<runId> CASCADE` pada blok `finally` dan menjamin preservasi baseline pembanding di `public`.
3. **Perbaikan Pemicu Regresi Fallback AC 6.4 (Reproduksi Bug Rentang Lama)**:
   - Snapshot S1 hanya memuat M1 (`received_at = 10:00:00`).
   - M2 diproses setelah S1, tetapi memiliki `received_at = 09:30:00` (lebih lampau daripada M1).
   - Pada kode lama, kondisi `received_at < last_read_at` akan keliru menandai M2 sebagai dibaca.
   - Pada AC 6.4 yang diperbaiki, pemanggilan fallback hanya dengan `lastReadMessageId = M1` membuktikan hanya M1 yang diakui; M2 tetap unread di respons (`unreadRemaining = 1`), detail (`isRead = false`, `unreadCount = 1`), dan tabel DB `staff_message_reads` (hanya ada 1 baris).
   - Pengulangan request menghasilkan `newlyReadCount = 0` dan `advanced = false`.
   - `acknowledgedMessageIds` dapat mengakui M2 setelahnya (`newlyReadCount = 1`, `unreadRemaining = 0`).
4. **Pengerasan Lifecycle Konkurensi pada Jalur Gagal (AC 7.1 & AC 7.2)**:
   - Dibangun harness bersama `runConcurrentMarkReadHarness` yang melindungi lifecycle koneksi sejak sebelum koneksi pertama diperoleh (`client1`, `client2` diinisialisasi `null` sebelum `try`).
   - Penungguan barrier `conn1EnteredBarrier` dibatasi timeout (3000ms) dan langsung dihentikan/di-reject seketika jika Request 1 mengalami kegagalan sebelum mencapai barrier (`conn1EnteredBarrierReject(err)`).
   - Blok `finally` tanpa syarat melepaskan barrier (`conn1EnteredBarrierResolve()`, `conn1CanCommitResolve()`), menunggu penuntasan request via `Promise.allSettled` dengan timeout, dan jika timeout atau broken, koneksi dilepas dengan opsi destroy (`client.release(true)`) agar koneksi terkontaminasi tidak dikembalikan ke pool.
   - AC 7.1 membuktikan skenario sukses: blocking riil di `pg_locks` terikat PID 1 & PID 2, respons dan state DB konsisten.
   - AC 7.2 menambahkan skenario kegagalan terkontrol sebelum barrier via proxy query pada koneksi 1 (`pg_advisory_xact_lock` melempar `plannedLockError`): penantian barrier langsung berhenti tanpa hang, blok `finally` dijalankan penuh, koneksi 1 di-destroy, request 2 tidak diluncurkan, dan mutasi dibatalkan penuh (0 baris di DB).

| ID | Keputusan | Status / dampak |
|---|---|---|
| D110 | 1. **Rekonsiliasi Kebijakan Migrasi Read-State**: Menyelaraskan dokumentasi dengan source final `20261004130000` bahwa seluruh baris read-state lama sebelum transisi ditandai `is_confirmed = false` secara tanpa syarat (tidak ada cutoff tanggal). Provenance historis tanpa snapshot tidak dapat dibuktikan sehingga acknowledgement lama dapat tampil unread sampai diakui kembali.<br>2. **Integrasi Migrasi SQL Aktual (AC 6.6)**: Pengujian membaca SQL langsung dari file fisik di disk pada namespace skema per-run (`CREATE SCHEMA test_mig_<runId>`). Terbukti: upgrade path menandai baris backfill dan kursor legacy `is_confirmed = false` dengan domain utuh; fresh sequence menetapkan default `true` dan acknowledgement eksplisit terkonfirmasi idempoten; evaluasi sebelum/sesudah 12:00:00 membuktikan kebijakan tanpa cutoff.<br>3. **Pemicu Bug Rentang Fallback AC 6.4**: M2 diproses setelah snapshot S1 tetapi memiliki `received_at` lebih lampau dari M1 (09:30 vs 10:00). Terbukti fallback `lastReadMessageId: M1` hanya menandai M1 dan M2 tetap unread di respons, detail, dan database.<br>4. **Pengerasan Lifecycle Konkurensi & Skenario Kegagalan Terkontrol (AC 7.1, AC 7.2)**: Harness bersama memproteksi akuisisi koneksi, membatasi waktu barrier, dan langsung menolak penantian barrier jika request 1 gagal sebelum barrier. Blok `finally` selalu melepas barrier, menunggu request, dan men-destroy koneksi rusak. AC 7.1 membuktikan overlap sukses berbasis PID; AC 7.2 membuktikan kegagalan terkontrol sebelum barrier langsung membatalkan penantian dan membersihkan koneksi tanpa hang. | KOREKSI B1 P2.6 TAHAP 1 DITUTUP LENGKAP SECARA EMPIRIS. 27 test checks integrasi inbox (1 suite, 26 subtests), 7 migration runner checks, dan 218 unit checks lulus penuh (exit code 0, eslint 0 error, tsc 0 error). Status P2.6: `In Progress` (menunggu Koreksi B2 dan Tahap 2 UI Inbox). Entry berikutnya D111. |

P2.6 dalam status In Progress (Koreksi A & B1 selesai penuh; Koreksi B2 dan Tahap 2 UI Inbox menyusul). Entry berikutnya D111.

## Penutupan Kekurangan Bukti Koreksi B1 P2.6 Tahap 1: Pemisahan Namespace Fresh Sequence, Kebijakan Tanpa Cutoff Murni dari File Migrasi, dan Timeout Konkurensi Pasca-Barrier — D111

Tanggal: 4 Oktober 2026. Implementasi penutupan dua kekurangan terakhir pada bukti migration dan lifecycle concurrency Koreksi B1 P2.6 Tahap 1:
1. **Pemisahan Namespace Migrasi & Rangkaian Lengkap Fresh Sequence (AC 6.6)**:
   - Skenario Upgrade dijalankan pada skema terisolasi `test_mig_upg_<runId>` dan Skenario Fresh Sequence dijalankan pada skema baru yang kosong dan terpisah `test_mig_fresh_<runId>`.
   - Fresh sequence mengeksekusi 4 file migrasi read-state aktual dari repositori secara berurutan:
     1. `20261004100000_create_staff_conversation_reads.sql`
     2. `20261004110000_revoke_direct_staff_conversation_reads_mutation.sql`
     3. `20261004120000_create_staff_message_reads.sql`
     4. `20261004130000_correct_legacy_message_read_backfill.sql`
   - Pemetaan skema strictly hanya mengganti referensi `public.staff_conversation_reads` dan `public.staff_message_reads` ke skema namespace uji serta melepas pembungkus transaksi terluar (`begin;` / `commit;`). Logika DDL, constraint, indeks, policy, dan backfill tetap 100% identik dengan file migrasi di disk.
   - Terbukti schema hasil fresh sequence lengkap, kolom `is_confirmed` bernilai default `true`, baris baru yang di-insert tanpa menyebutkan `is_confirmed` secara otomatis bernilai `true`, pengakuan eksplisit runtime berhasil mengonfirmasi baris, dan pengulangan berjalan idempoten (0 baris baru).
2. **Pengujian Kebijakan Tanpa Cutoff Murni via File Migrasi Tanpa UPDATE Manual (AC 6.6)**:
   - Pada `upgradeSchema`, baris pembanding dipersiapkan sebelum migrasi korektif dijalankan:
     - `staff_conversation_reads`: baris dengan `updated_at` sebelum 12:00:00 UTC (11:00:00 UTC) dan sesudah 12:00:00 UTC (14:00:00 UTC).
     - `staff_message_reads`: baris hasil backfill migrasi 120000 dengan `read_at` sebelum 12:00:00 UTC (11:00:00 UTC) dan sesudah 12:00:00 UTC (14:00:00 UTC).
   - Keberadaan baris pembanding sebelum transisi dibuktikan nyata di database via query eksplisit.
   - Migrasi korektif aktual `20261004130000` dieksekusi langsung dari file, membuktikan seluruh baris pada kedua kelompok waktu secara otomatis dan tanpa syarat beralih menjadi `is_confirmed = false`.
   - Ketergantungan pada statement `UPDATE` manual yang meniru migrasi dihapus seluruhnya.
   - Teardown kedua namespace (`test_mig_upg_<runId>` dan `test_mig_fresh_<runId>`) dilindungi `try/finally` sejak awal dengan agregasi error via `combineErrors`.
3. **Pengerasan Penantian Pasca-Barrier Konkurensi & Pengujian Timeout Terkontrol (AC 7.1, AC 7.2, AC 7.3)**:
   - Pada `runConcurrentMarkReadHarness`, penantian kedua request setelah barrier dilepas (`conn1CanCommitResolve()`) dibatasi timeout eksplisit via `Promise.race([Promise.all([...]), postBarrierTimeoutPromise])` dan timer dibersihkan setelah penantian selesai. Unbounded `Promise.all` tidak lagi menghalangi masuk ke blok `finally`.
   - Penangan rejection (`.catch(() => {})`) didaftarkan seketika saat `req1Promise` dan `req2Promise` diluncurkan untuk mencegah unhandled promise rejection.
   - Timeout dilaporkan sebagai error eksplisit `POST_BARRIER_TIMEOUT` kepada pemanggil tes.
   - Blok `finally` harness tanpa syarat melepaskan barrier (`conn1EnteredBarrierResolve()`, `conn1CanCommitResolve()`), menunggu penuntasan request via `Promise.allSettled` dengan bounded timer, dan koneksi yang masih aktif atau terputus ditandai rusak dan di-destroy via `client.release(true)` (tidak dikembalikan sebagai koneksi sehat ke pool).
   - Error pelepasan koneksi diakumulasikan dan dilaporkan bersama primary error via `combineErrors` tanpa mencetak ke `console.error`.
   - Ditambahkan pengujian AC 7.3: menginjeksi query yang tertahan setelah barrier pada Connection 2 via Proxy queryable dengan mekanisme penuntasan/pembatalan (`cancelHang` / `resolveHang`) pada teardown; membuktikan barrier tercapai dan dilepas sebelum timeout, timeout dilaporkan eksplisit, koneksi aktif di-destroy, blok `finally` tuntas, dan tidak ada promise menggantung setelah tes selesai.
   - AC 7.1 (jalur sukses dengan blocking riil di `pg_locks`) dan AC 7.2 (kegagalan terkontrol sebelum barrier) tetap dipertahankan dan lulus penuh.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D111 | 1. **Pemisahan Namespace Migrasi & Fresh Sequence Lengkap (AC 6.6)**: Skenario upgrade di `test_mig_upg_<runId>` dan fresh sequence di namespace terpisah `test_mig_fresh_<runId>`. Fresh sequence mengeksekusi 4 file migrasi berurutan (`20261004100000`, `110000`, `120000`, `130000`) dengan pemetaan tabel read-state murni dan membuktikan default `is_confirmed = true` serta idempotensi pengakuan runtime.<br>2. **Kebijakan Tanpa Cutoff Murni dari File Migrasi**: Baris pembanding `staff_conversation_reads` (`updated_at`) dan `staff_message_reads` (`read_at`) sebelum dan sesudah 12:00:00 UTC diverifikasi ada di DB sebelum transisi. Eksekusi file migrasi aktual `20261004130000` membuktikan kedua sisi waktu menjadi `is_confirmed = false` tanpa statement UPDATE manual peniru migrasi. Teardown dilindungi `combineErrors`.<br>3. **Pengerasan Penantian Pasca-Barrier & Skenario Timeout AC 7.3**: Penantian kedua request pasca-barrier dibatasi timeout dengan timer cleanup; handler rejection didaftarkan saat request diluncurkan; timeout dilaporkan eksplisit; koneksi aktif di-destroy (`client.release(true)`); error cleanup digabung via `combineErrors`. AC 7.3 membuktikan timeout pasca-barrier dengan injeksi query tertahan, koneksi aktif di-destroy, dan pembatalan injeksi di teardown tanpa kebocoran promise. | KOREKSI B1 P2.6 TAHAP 1 DITUTUP PENUH & TUNTAS SECARA EMPIRIS. Seluruh 28 checks integrasi inbox (1 suite, 27 subtests), 7 migration runner checks, dan 218 unit checks lulus penuh (exit code 0, eslint 0 error, tsc 0 error). Status P2.6: `In Progress` (menunggu Koreksi B2 dan Tahap 2 UI Inbox). Entry berikutnya D112. |

P2.6 dalam status In Progress (Koreksi A & B1 selesai penuh; Koreksi B2 dan Tahap 2 UI Inbox menyusul). Entry berikutnya D112.

## Penutupan Definitif Koreksi B1 P2.6 Tahap 1: Settlement Request Pasca-Pembatalan, Diferensiasi Timeout vs Error Query, dan Skenario Kegagalan Pasca-Barrier — D112

Tanggal: 6 Oktober 2026. Penutupan Koreksi B1 P2.6 Tahap 1 pada pengujian konkurensi data layer Inbox:
1. **Settlement Request Riil Pasca-Pembatalan (`runConcurrentMarkReadHarness` & AC 7.3)**:
   - Menghubungkan lifecycle cleanup harness dengan pembatalan injeksi melalui hook `onBeforeSettleCleanup`. Pembatalan/pelepasan kueri tertahan dieksekusi sebelum penantian settlement terakhir dimulai.
   - Koneksi yang rusak atau masih aktif saat timeout langsung di-destroy (`client.release(true)`), memutus socket dan transaksi di sisi PostgreSQL.
   - Harness menunggu penyelesaian promise request sebenarnya (`Promise.allSettled([req1Promise, req2Promise])`) dengan batas waktu (`settleTimeoutMs`) yang timer-nya dibersihkan pada semua jalur.
   - Koneksi yang sehat hanya dikembalikan ke pool (`client.release()`) setelah seluruh request selesai settle.
   - Jika settlement gagal selesai dalam batas waktu, dilaporkan kegagalan cleanup eksplisit (`CLEANUP_SETTLEMENT_TIMEOUT`); harness tidak mengklaim zero pending requests.
   - Error primer dipertahankan dan kegagalan cleanup digabung via `combineErrors` tanpa saling menutupi.
   - AC 7.3 diperkuat: assertion settlement berasal dari penantian promise riil (`await Promise.allSettled([outcome.req1Promise, outcome.req2Promise])`), membuktikan Request 1 terpenuhi (`fulfilled`), Request 2 ditolak dengan error pembatalan terencana (`POST_BARRIER_INJECTION_CANCELLED_ON_TEARDOWN`), dan membedakan penolakan request yang disengaja dari kegagalan mekanisme cleanup.
2. **Diferensiasi Presisi Timeout vs Error Query Biasa (`runConcurrentMarkReadHarness` & AC 7.4)**:
   - Memperbaiki evaluasi `Promise.race`: flag `postBarrierTimedOut = true` hanya ditetapkan ketika timer timeout benar-benar habis (`didPostBarrierTimeoutFired === true`).
   - Penolakan akibat kegagalan query mempertahankan error aslinya, menetapkan `postBarrierTimedOut = false`, dan membersihkan timer timeout pada blok `finally`.
   - Ditambahkan pengujian AC 7.4 (kegagalan query terkontrol setelah barrier dilepas pada koneksi 2): menginjeksi kegagalan query terencana (`PLANNED_POST_BARRIER_QUERY_FAILURE`) saat mengakses tabel `staff_conversation_reads` / `staff_message_reads`.
   - Terbukti empiris pada AC 7.4: error query asli diteruskan utuh, `postBarrierTimedOut === false`, Request 1 berhasil commit 3 pesan, Connection 2 yang gagal di-destroy, seluruh promise request settled, dan mutasi Request 2 di-rollback tanpa residu.
   - Seluruh 4 skenario konkurensi (AC 7.1 sukses, AC 7.2 gagal pra-barrier, AC 7.3 timeout pasca-barrier, AC 7.4 error query pasca-barrier) terbukti lulus bersih.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D112 | 1. **Settlement Request Pasca-Pembatalan (AC 7.3)**: Hook `onBeforeSettleCleanup` membatalkan injeksi sebelum penantian settlement; koneksi aktif/rusak di-destroy seketika; penantian settlement menggunakan `Promise.allSettled` dengan bounded timer; koneksi sehat hanya dikembalikan setelah request settled; kegagalan settlement dilaporkan eksplisit (`CLEANUP_SETTLEMENT_TIMEOUT`); assertion membuktikan status promise riil dan membedakan pembatalan yang disengaja dari error cleanup.<br>2. **Diferensiasi Timeout vs Error Query & AC 7.4**: Flag `postBarrierTimedOut` hanya bernilai `true` saat timer timeout benar-benar habis. Error query mempertahankan pesan asli dengan `postBarrierTimedOut = false` dan membersihkan timer. AC 7.4 membuktikan kegagalan query pasca-barrier meneruskan error asli, Connection 2 di-destroy, Request 1 committed, Request 2 di-rollback, dan seluruh request settled. | KOREKSI B1 P2.6 TAHAP 1 DITUTUP PENUH & DEFINITIF. 29 test checks integrasi inbox (1 suite, 28 subtests), 7 migration runner checks, dan 218 unit checks lulus penuh (exit code 0, eslint 0 error, tsc 0 error). Koreksi B1 selesai. Status P2.6: `In Progress` (menunggu Koreksi B2 pagination/kontrak dan Tahap 2 UI Inbox). Entry berikutnya D113. |

## Penutupan Koreksi B2 P2.6 Tahap 1: Penyelarasan Representasi Classification Faktual, Konsistensi Snapshot Satu Kueri, Kontrak Pagination Deterministik, dan Bukti Route Handlers Sebenarnya — D113

Tanggal: 6 Oktober 2026. Penutupan Koreksi B2 P2.6 Tahap 1 untuk menetapkan kontrak API Inbox yang faktual, konsisten, teruji, dan terdokumentasi sebelum implementasi UI Inbox:
1. **Penyelarasan Representasi Classification Faktual (AC 13)**:
   - Kontrak `InboxMessageClassification` di `lib/application/inbox-contracts.ts` diselaraskan dengan data persisten `HelpdeskPersistence.process()` dan domain `MessageClassification`.
   - Menghapus field fiktif `confidence: 1.0` dan `flags: []` yang tidak disimpan di database.
   - Merepresentasikan field faktual: `category`, `reason`, `ruleVersion`, `normalizedText: string | null`, dan `matchedKeywords: readonly string[]`.
   - Mapper di `lib/application/inbox-service.ts` mempertahankan nilai yang benar-benar tersimpan, termasuk `normalizedText: null` yang valid dan string kosong `""`, serta memberikan fallback eksplisit terdokumentasi (`category: "unknown"`, `reason: "unknown"`, `ruleVersion: "unknown"`, `normalizedText: null`, `matchedKeywords: []`) untuk baris histori kosong/rusak tanpa mengarang data maupun mengklasifikasi ulang histori saat GET.
   - AC 13 membuktikan mapping faktual dari fixture hasil `HelpdeskPersistence.process()`, variasi string kosong, valid null, dan fallback data kosong (`'{}'::jsonb`, `'null'::jsonb`).
2. **Penjaminan Konsistensi Snapshot Satu Kueri (AC 14)**:
   - Pada `listInboxConversations`: kueri `totalCount` dan `items` yang sebelumnya terpisah disatukan menjadi kueri CTE tunggal (`matching_items`, `counted`, `paged` dengan `counted LEFT JOIN paged ON true`). Hal ini menjamin `totalCount`, `totalPages`, dan `items` selalu berasal dari snapshot konsisten dan filter yang sama, termasuk pada halaman kosong atau di luar rentang.
   - Pada `getInboxConversationDetail`: kueri header/agregat dan kueri pesan disatukan menjadi kueri tunggal (`LEFT JOIN lateral complaints`, `messages`, `ingress_events`, `triage_assessments`, `staff_message_reads`).
   - `unreadCount` pada detail dihitung secara atomik dan pasti dari pesan-pesan dalam snapshot (`messages.filter(m => !m.isRead).length`), dan `isUnread` selalu konsisten `unreadCount > 0`.
   - AC 14 membuktikan invariant konsistensi snapshot secara deterministik saat mutasi write (`markConversationRead` dan inbound `HelpdeskPersistence.process()`) dieksekusi bersamaan dengan pembacaan detail dan list.
3. **Penegasan Kontrak Pagination & Pembuktian Route Handlers Sebenarnya (AC 15 & AC 16)**:
   - Kontrak pagination page/offset ditegaskan: default limit 25, maksimal 25, urutan deterministik `lastActivityAt DESC, id DESC`.
   - AC 15 membuktikan pada dataset statis, perpindahan halaman 1..3 menghasilkan himpunan item yang disjoin tanpa duplikasi dan tanpa item yang hilang.
   - AC 16 membuktikan handler route Next.js sebenarnya (`GET /api/inbox/conversations` dan `GET /api/inbox/conversations/[id]`) menggunakan Web standard `Request` dan `Response`:
     - Memvalidasi envelope `{ data, error: null }` pada sukses, status 200, header `Cache-Control: private, no-store`.
     - Memvalidasi filter query params (`unread=true`, `page`, `limit`), nullability, classification, dan status unread.
     - Memvalidasi envelope error standar `{ data: null, error: { code, message } }` untuk 400 (invalid param), 401 (unauthorized / no session), dan 404 (conversation not found).
     - Metode pengujian dilaporkan secara transparan sebagai pemanggilan langsung fungsi route handler Next.js dengan objek `Request` Web API dan konteks session staf (in-process standard handler execution).
4. **Penyelarasan Dokumentasi Kontrak & Klarifikasi Ledger**:
   - Memperbaiki contoh respons API pada `docs/P2_6_STAGE1_REVIEW.md`: struktur list aktual (`id`, `sender`, `lastMessage.body`, `latestEpisode`, `totalCount`), detail tanpa pembungkus fiktif `conversation`, classification faktual tanpa `confidence`/`flags`.
   - Mendokumentasikan `acknowledgedMessageIds` sebagai snapshot eksplisit vs fallback `lastReadMessageId` satu pesan, serta semantik `advanced` berbasis adanya pesan baru yang diakui.
   - Mengklarifikasi perbedaan antara "0 migration applied" (skema sudah up-to-date) dan "0 statement DDL" (pemeriksaan ledger tetap dapat menjalankan `CREATE TABLE IF NOT EXISTS` untuk bootstrap ledger).

| ID | Keputusan | Status / dampak |
|---|---|---|
| D113 | 1. **Penyelarasan Classification Faktual (AC 13)**: Menghapus `confidence: 1.0` dan `flags: []`. Merepresentasikan `category`, `reason`, `ruleVersion`, `normalizedText: string | null`, dan `matchedKeywords: readonly string[]`. Mapper mempertahankan null valid dan memberikan fallback `"unknown"` / `null` / `[]` pada data kosong tanpa re-klasifikasi.<br>2. **Konsistensi Snapshot Satu Kueri (AC 14)**: List disatukan via CTE (`counted LEFT JOIN paged ON true`) sehingga `totalCount` dan `items` selalu sinkron. Detail disatukan dalam kueri tunggal, dengan `unreadCount` berasal dari `messages.filter(m => !m.isRead).length` dan `isUnread = unreadCount > 0`. Invariant terbukti di bawah mutasi konkuren.<br>3. **Kontrak Pagination & Route Handlers Sebenarnya (AC 15, AC 16)**: Pagination page/offset deterministik limit 25, urutan `lastActivityAt DESC, id DESC`, disjoin across pages. Handler route Next.js sebenarnya diverifikasi dengan Web standard `Request`/`Response`, status 200/400/401/404, headers `Cache-Control: private, no-store`, dan session staf.<br>4. **Penyelarasan Dokumentasi & Ledger**: Contoh respons di `P2_6_STAGE1_REVIEW.md` diselaraskan dengan kontrak aktual; klarifikasi ledger bootstrap (0 migration applied vs 0 DDL statement) didokumentasikan. | KOREKSI B2 P2.6 TAHAP 1 DITUTUP LENGKAP SECARA EMPIRIS. 33 test checks integrasi inbox (1 suite, 32 subtests), 7 migration runner checks, dan 228 unit checks lulus penuh (exit code 0, eslint 0 error, tsc 0 error). Status P2.6: `In Progress` (menunggu Tahap 2 UI Inbox). Entry berikutnya D114. |

P2.6 dalam status In Progress (Koreksi A, B1, dan B2 selesai penuh; menunggu Tahap 2 UI Inbox). Entry berikutnya D114.

## Koreksi Review B2 P2.6 Tahap 1 dan Pemisahan Implementasi dari Validasi — D114

Tanggal: 2026-10-06.

Review menemukan empat kekurangan pada hasil D113: ORDER BY hanya pada CTE halaman, page/offset belum dibatasi safe integer, AC 14 belum membuktikan overlap nyata dan AC 15 belum membandingkan seluruh ID fixture, serta laporan/dokumentasi belum konsisten. Pengguna meminta Codex memperbaiki kode dan menyiapkan prompt; eksekusi test, lint, typecheck, dan integrasi dilakukan agent Antigravity.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D114 | 1. **Urutan Hasil Akhir**: SELECT terluar setelah `counted LEFT JOIN paged` menegaskan `paged.last_activity_at DESC NULLS LAST, paged.id DESC NULLS LAST`.<br>2. **Pagination Aman**: Parser dan service memakai validator bersama. Page wajib positive safe integer, limit integer 1..25, dan offset `(page - 1) * limit` wajib safe integer. Input invalid ditolak 400 `INVALID_PARAMETER` sebelum akses database; parameter yang valid tetap memakai SQL terparameterisasi.<br>3. **Bukti AC 14–15**: Tes read memakai writer barrier `onBeforeCommit`; commit terjadi sesudah hasil SELECT pertama diperoleh tetapi sebelum service menerima rows. Tes memeriksa snapshot list/detail sebelum dan sesudah commit, satu statement per service, serta lifecycle bounded dan controlled reader failure. Tes pagination membandingkan seluruh 28 ID fixture, halaman 10/10/8, timestamp ties, urutan UUID DESC, pengulangan stabil, dan empty pages.<br>4. **Dokumentasi dan Pembagian Validasi**: Kontrak memakai status `active`/`closed`, identitas pada `sender`, dan envelope `{ success, data, error }`. Contoh JSON bukan rekaman HTTP. Bukti historis D113 dipisahkan dari hasil versi terbaru. | **B2 In Progress; implementasi koreksi tersedia, validasi Antigravity pending.** Klaim penutupan penuh B2 pada D113 belum menjadi persetujuan akhir setelah temuan review ini. Hasil historis 228 unit / 33 Inbox / 7 migration checks bukan bukti D114. Codex tidak menjalankan test, lint, typecheck, build, atau mutasi database. Koreksi A dan B1 tetap diterima; tidak ada migration baru atau perubahan auth/RLS. |

Prompt validasi: `docs/P2_6_B2_VALIDATION_PROMPT.md`. B2 hanya ditutup setelah bukti terarah versi terbaru lulus. P2.6 tetap In Progress sampai UI Inbox dan acceptance criteria keseluruhan selesai. Entry berikutnya D115.

## Validasi Terarah dan Penutupan Koreksi B2 P2.6 Tahap 1 — D115

Tanggal: 2026-10-06.

Pelaksanaan validasi terarah oleh Antigravity pada kode implementasi Koreksi B2 (D114):
1. **Pemeriksaan Statis & Unit Terarah**:
   - `npx tsc -p tsconfig.test.json`: Kompilasi TypeScript sukses penuh, 0 error (exit code 0).
   - `node --conditions=react-server --test .test-build/tests/application/inbox-service.test.js`: 44 checks passed (0 failed, 0 skipped, 250ms, exit code 0). Membuktikan:
     - Parser menolak page tidak aman, string panjang yang menjadi Infinity (`"9".repeat(400)`), dan page aman dengan offset overflow (`lastSafePageAt25 + 1`).
     - Parser menerima batas aman (`lastSafePageAt25` pada limit 25, dan `MAX_SAFE_INTEGER` pada limit 1).
     - Pemanggil service langsung menerima penolakan `InboxError("INVALID_PARAMETER", 400)` untuk NaN/Infinity/pecahan/angka di luar batas tanpa pemanggilan query pool (0 SQL).
     - Route `GET /api/inbox/conversations` mengembalikan 400 `{ success: false, data: null, error: { code: "INVALID_PARAMETER", message } }` sebelum `getPool()` dipanggil (0 pool access).
     - Urutan query CTE ditegaskan pada SELECT terluar: `ORDER BY paged.last_activity_at DESC NULLS LAST, paged.id DESC NULLS LAST`.
   - `npx eslint lib/application/inbox-contracts.ts lib/application/inbox-service.ts tests/application/inbox-service.test.ts tests/integration/inbox.test.ts`: 0 error, 0 warning (exit code 0).
2. **Pengujian Integrasi Database Nyata (`npm run test:inbox:local`)**:
   - Dijalankan pada lingkungan tes terisolasi PostgreSQL 54332/API 54331 dengan validasi guard `requireIsolatedDatabase`.
   - Hasil: 33 checks passed (1 parent suite, 32 subtests), 0 failed, 0 skipped, durasi 3.83s, exit code 0.
   - **AC 14 (Snapshot Consistency & Concurrency Invariance)**: Writer berada di barrier `onBeforeCommit` saat reader mengeksekusi SQL nyata. Writer commit sesudah hasil SELECT pertama diperoleh tetapi sebelum rows dikembalikan ke service. Detail terbukti membaca 2 unread sebelum commit (`messages.every(!isRead)`), dan 1 unread sesudah commit. List `unread=true` membaca count/item 1 sebelum commit, dan count 0 / items kosong sesudah commit. Setiap pemanggilan service terbukti mengeksekusi tepat satu statement (`queryCount === 1`). Controlled reader failure sebelum SQL diteruskan utuh, settlement menunggu promise riil dengan bounded timer, timer dibersihkan, dan koneksi aktif di-destroy saat timeout. Inbound berikutnya teruji before/after secara terpisah.
   - **AC 15 (Pagination Contract & Fixture Coverage)**: Tepat 28 ID fixture teruji dengan pembagian halaman 10/10/8, totalPages 3, dan totalCount 28. Seluruh 28 ID muncul tepat sekali (disjoint, 0 duplikasi, 0 hilang). Timestamp disamakan membuktikan keterurutan UUID DESC lintas halaman; pengulangan setiap halaman stabil mengembalikan ID identik. Halaman jauh kosong (page 9999) mempertahankan count 28, dan pencarian tanpa hasil menghasilkan count 0, totalPages 0, items kosong.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D115 | **Validasi Terarah dan Penutupan Koreksi B2 P2.6 Tahap 1**: Seluruh 4 temuan review (outer ORDER BY, safe integer pagination & offset validation, bukti konkurensi snapshot terkoordinasi AC 14, serta kelengkapan cakupan dataset AC 15) telah terverifikasi secara empiris dengan bukti kompilasi tsc exit 0, 44 unit checks passed, eslint 0 error/0 warning, dan 33 integration inbox checks passed pada lingkungan uji terisolasi. Dokumentasi diselaraskan dengan kontrak final (`active`/`closed`, `sender`, `{ success, data, error }`). | **KOREKSI B2 P2.6 TAHAP 1 DITUTUP PENUH SECARA EMPIRIS.** Seluruh koreksi P2.6 Tahap 1 (A, B1, B2) telah selesai penuh. Status P2.6: `In Progress` (menunggu Tahap 2 UI Inbox). Entry berikutnya D116. |

P2.6 dalam status In Progress (Koreksi A, B1, dan B2 selesai penuh; menunggu Tahap 2 UI Inbox). Entry berikutnya D116.

Klarifikasi editorial atas bukti D115 sebelum Tahap 2 (2026-10-06): kegagalan yang diinjeksi pada AC 14 adalah reader failure sebelum SQL. Bounded wait/settlement, timer cleanup, dan destruction koneksi aktif jika settlement timeout tersedia sebagai proteksi kode; D115 tidak membuktikan injeksi timeout baru pada AC 14. Pengujian timeout B1 AC 7.3 tetap menjadi bukti terpisah untuk harness B1. Baris AC 12 pada tabel `docs/P2_6_STAGE1_REVIEW.md` dikembalikan berdasarkan tes processing failure dengan `lease_lost` yang masih ada dan termasuk suite Inbox lulus D115. Perapian ini tidak mengubah histori D115, runtime, hasil pengujian, atau status penutupan B2; bukan keputusan teknis baru. Entry berikutnya tetap D116.

## Baseline Desain UI Inbox, Penanda Non-Warna, Viewport Read Acknowledgment, dan Polling 5 Detik — D116

Tanggal: 2026-10-06.

Implementasi P2.6 Tahap 2 — UI Inbox sebagai antrean komplain dan percakapan masuk utama pada dashboard Helpdesk Upaznet:
1. **Layout Dua Panel & Navigasi**: Landing page `/dashboard` menyajikan layout dua panel responsif (panel kiri daftar antrean percakapan, panel kanan panel percakapan aktif). Pada layar mobile (<1024px), antarmuka beralih ke *single-pane* dengan tombol "Kembali ke daftar percakapan" yang mempertahankan konteks filter dan posisi daftar. Shell mempertahankan penanda visual mode SHADOW, data dummy, dan target sentuh tautan direktori pelanggan (>= 40px desktop, >= 44px mobile).
2. **Pembeda Non-Warna (WCAG AA)**: Seluruh status (episode, verifikasi pengirim, unread, kebutuhan review) menggunakan badge teks eksplisit dan token kontras tinggi. Item percakapan terpilih memiliki pembeda non-warna ganda: border kiri aksen 4px (`border-l-4 border-l-[var(--action-primary)]`) dan badge teks eksplisit "Dipilih" (`span[data-selected="true"]`).
3. **Penandaan Baca Hanya untuk Pesan yang Terlihat (Viewport-Only Acknowledgment)**: Menggunakan `IntersectionObserver` pada scroll container pesan. Pesan hanya dikirim ke `POST /api/inbox/conversations/[id]/read` jika bounding box elemen pesan tumpang tindih dengan viewport scroll container dan tab/dokumen aktif (tidak tersembunyi). Polling atau kursor agregat tidak menandai baca. Perpindahan percakapan cepat membatalkan *in-flight acknowledgement* dan mencegah respons lama menimpa state terbaru. Kegagalan *read-ack* menampilkan alert banner dan tombol coba lagi tanpa keberhasilan palsu.
4. **Preservasi Scroll & Polling 5 Detik**: Polling non-destruktif setiap 5 detik memperbarui daftar percakapan dan detail percakapan aktif. Auto-scroll ke bawah hanya aktif saat pertama kali membuka percakapan yang berbeda (`prevConversationIdRef.current !== currentId`). Saat staf membaca pesan lama (`distanceToBottom > 80px`), polling tidak memaksa scroll ke bawah, dan pesan baru memunculkan pill "Pesan baru di bawah". Jika polling gagal (misal koneksi terputus), data terakhir dipertahankan dan banner alert "Pembaruan terhenti" ditampilkan dengan timestamp pembaruan terakhir dan tombol "Coba lagi".
5. **Batas Scope Faktual**: Panel detail hanya menampilkan data faktual dari backend (pesan, pengirim, episode, klasifikasi, dan assessment triage). Area composer balasan dan catatan internal menampilkan kartu informasi Fase P3 tanpa kontrol fiktif yang seolah berfungsi.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D116 | **Baseline Desain UI Inbox P2.6 Tahap 2**: 1. Layout 2-panel desktop & single-pane mobile responsif; 2. Pembeda non-warna (border 4px + teks "Dipilih"); 3. Viewport-only read acknowledgment via `IntersectionObserver` khusus tab aktif; 4. Polling 5 detik non-destruktif dengan preservasi scroll saat membaca pesan lama & banner "Pembaruan terhenti"; 5. Batas scope faktual dengan kartu informasi Fase P3 untuk composer balasan. | Baseline desain awal P2.6 Tahap 2. Dilanjutkan dengan evaluasi review dan koreksi D117. Entry berikutnya D117. |

## Koreksi P2.6 Tahap 2 — UI Inbox, Isolasi State & Runner Browser Interaktif — D117

Tanggal: 2026-10-06.

Implementasi koreksi P2.6 Tahap 2 berdasarkan temuan review A–G pada UI Inbox dan alat uji browser:
1. **Isolasi Snapshot Retry Mark-Read (Temuan A)**: `handleRetryMarkRead` pada `inbox-dashboard.tsx` menggunakan `failedAckSnapshotRef` yang mencatat tepat snapshot `conversationId` dan `messageIds` yang gagal dikirim. Percakapan berganti membersihkan snapshot ini seketika. Retry tidak pernah memperluas acknowledgement ke pesan di luar viewport aktif.
2. **Isolasi Lingkungan Pengujian Browser & Autentikasi Staf (Temuan B)**: Runner `verify-p26-inbox.mjs` dijalankan secara mandiri dengan guard `requireIsolatedDatabase`, container GoTrue Auth pada port 54331 (`config.toml`), instance Next.js produksi pada port terisolasi (3310+), header proxy `x-test-server-run-id`, pembuatan dan teardown akun staf uji unik per-run via Admin API, serta pelacakan dan pembersihan tuntas seluruh fixture graph.
3. **Pencegahan Response Usang Daftar Percakapan (Temuan C)**: `activeListRequestIdRef` melacak request fetch daftar percakapan; respon yang tiba sesudah filter atau halaman berubah diabaikan secara aman.
4. **Isolasi Pemilihan Percakapan & Delineasi Transisi (Temuan D)**: Pemilihan percakapan baru langsung membersihkan detail lama (`setSelectedConversation(null)`), transisi foreground dilacak via `activeForegroundDetailRequestIdRef`, dan polling latar belakang dibedakan dari transisi klik staf (`isBackground`), mencegah respons lama menimpa pilihan terbaru.
5. **Dekopling Error Polling & Keamanan Loading (Temuan E)**: `listPollingError` dan `detailPollingError` dipisahkan; error pada satu sumber tidak merusak sumber lain, dan `isLoadingList` dipastikan kembali `false` pada blok `finally`.
6. **Membuka Kembali Percakapan Sama pada Mobile (Temuan F)**: Pemilihan percakapan yang sedang aktif pada tampilan mobile berpindah ke tampilan `detail` tanpa early-return kosong, tanpa fetch ulang berlebih, dan tanpa menghapus scroll atau filter.
7. **Ketelitian Formatter Tanggal WIB Asia/Jakarta (Temuan G)**: `lib/utils/format-date.ts` distandardisasi menggunakan `Intl.DateTimeFormat` dengan `timeZone: "Asia/Jakarta"` dan `hourCycle: "h23"`. Terverifikasi pada `tests/domain/inbox-ui.test.ts` (7/7 tests passed) pada pergantian tengah malam, batas tahun, dan fixed UTC.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D117 | **Koreksi P2.6 Tahap 2 UI Inbox & Penguatan Alat Uji CDP**: 1. Snapshot retry mark-read terisolasi (`failedAckSnapshotRef`); 2. Lingkungan uji browser terisolasi (GoTrue 54331, port Next.js dinamis, teardown staf & fixture); 3. Anti-stale list via `activeListRequestIdRef`; 4. Anti-stale detail & pembersihan instan seleksi percakapan; 5. Dekopling error polling list vs detail; 6. Dukungan re-open percakapan sama pada mobile; 7. Formatter WIB deterministik Asia/Jakarta. | Klaim penyelesaian awal D117 diklarifikasi oleh review lanjutan: assertion read-ack false-positive akibat trusted origin tidak terkonfigurasi pada port dinamis, guard runner melemah, dan loading dapat tersangkut pada overlap polling. Dikoreksi penuh pada D118. Entry berikutnya D118. |

## Koreksi Lanjutan P2.6 Tahap 2 UI Inbox: Eliminasi False-Positive Read-Ack, Integritas Guard Lingkungan, Resiliensi Loading Overlap, Siklus Teardown Terverifikasi, dan Penyelarasan Pasangan Konfigurasi Auth — D118

Tanggal: 2026-10-07.

Implementasi koreksi lanjutan P2.6 Tahap 2 berdasarkan temuan review terbaru:
1. **Penyelarasan Pasangan Konfigurasi Auth (`lib/supabase/auth-config.ts`)**:
   - URL dan key Supabase diselesaikan berpasangan secara ketat berdasarkan urutan tingkatan: `runtime_server` (`SUPABASE_URL` + `SUPABASE_ANON_KEY`) -> `test_override` (`HELPDESK_TEST_API_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`/`SUPABASE_ANON_KEY`) -> `public_client` (`NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`/`ANON_KEY`).
   - Konfigurasi parsial (URL dari satu lingkungan dan key dari lingkungan lain) ditolak *fail-closed* untuk mencegah pencampuran lingkungan runtime dan build.
   - Menggunakan `resolveSupabaseAuthConfig` pada `lib/supabase/server.ts` dan `proxy.ts`. Service-role dilarang keras sebagai pengganti anon key untuk sesi staf.
   - Terverifikasi pada `tests/utils/auth-config.test.ts` (7 unit checks lulus, 0 fail).
2. **Eliminasi False-Positive Read-Ack & Konfigurasi Trusted Origins**:
   - Mengonfigurasi `HELPDESK_TRUSTED_ORIGINS`, `NEXT_PUBLIC_APP_URL`, dan `APP_URL` pada proses Next.js server uji sesuai `BASE_URL` port dinamis run tersebut. Menghilangkan penolakan 403 `origin_mismatch` tanpa melemahkan validasi Origin backend.
   - Mengukur geometri pesan terlihat berdasarkan `getBoundingClientRect` aktual terhadap scroll container, bukan asumsi urutan fixture.
   - Memverifikasi response network `/read` mengembalikan HTTP 200 dan `{ success: true }`, pesan terlihat terkonfirmasi di `staff_message_reads` (`is_confirmed = true`), dan pesan di luar viewport tetap tidak tercatat (0 rows).
   - Injeksi kegagalan read-ack (HTTP 500) membuktikan banner error muncul, dan tombol coba lagi mengirimkan ulang tepat snapshot pesan terlihat tanpa ekspansi.
   - Supresi read-ack saat tab tersembunyi (`document.hidden = true`) diverifikasi tidak mengirim request acknowledgement baru.
   - Sensitivitas assertion diperketat: kegagalan status HTTP atau ketiadaan konfirmasi DB menghasilkan FAIL, bukan PASS.
3. **Pemulihan Kelengkapan Guard Lingkungan Uji**:
   - Runner `tests/interactive/verify-p26-inbox.mjs` mengimpor helper guard proyek dari `.test-build/tests/utils/test-guard.js` (`parseAndValidateTestConfig`, `verifyTestTargetIdentity`, `requireIsolatedDatabase`, `TestResourceTracker`, `cleanupFixture`).
   - Mode `--test-guard-rejection` membuktikan penolakan database workspace aktif (port 54322/5432/postgres), penolakan Supabase API aktif (port 54321), dan penolakan marker token mismatch sebelum adanya mutasi atau query pool.
4. **Resiliensi Loading Daftar saat Overlap dengan Polling (`components/inbox/inbox-dashboard.tsx`)**:
   - Kepemilikan loading foreground dipisahkan melalui `activeForegroundListRequestIdRef`. Background polling (`isBackground = true`) tidak menaikkan ID foreground dan tidak mematikan loading foreground prematur.
   - Blok `finally` memastikan `setIsLoadingList(false)` dipanggil ketika request foreground aktif selesai.
   - Respons usang dicegah menimpa data yang lebih baru melalui `latestAppliedListRequestIdRef` dan pemeriksaan kecocokan parameter aktif.
   - Diuji dengan penundaan terkontrol 800ms pada request foreground yang overlap dengan polling latar belakang: loading berhasil selesai, data halaman 2 tampil tepat, dan kontrol paginasi tetap aktif.
5. **Siklus Teardown dan Verifikasi Residu Runner**:
   - Proses server Next.js dan Chrome dihentikan dengan `taskkill` sinkron.
   - Penghapusan user staf via Admin API memeriksa hasil `{ error }` eksplisit.
   - Fixture pengujian dibersihkan via `cleanupFixture`, dan query residu menegaskan 0 percakapan, 0 pesan, dan 0 identitas yang tersisa di database.
   - Mode `--test-cleanup-failure` membuktikan kegagalan teardown menghasilkan status FAIL dan exit code 1.
   - Penulisan JSON bukti dan penentuan exit code dilakukan pada akhir blok `finally` setelah seluruh proses teardown selesai.
6. **Penyempurnaan Skenario Pengujian Interaktif CDP**:
   - Pengujian perpindahan percakapan cepat dan pencegahan respons usang (tahan A, klik B -> B tampil, A tidak menimpa).
   - Isolasi kegagalan detail B setelah A terbuka (panel menampilkan error B, tidak mempertahankan data usang A).
   - Pemulihan retry detail dan retry list secara independen.
   - Paginasi 28 ID fixture teruji penuh: Halaman 1 (25 item) dan Halaman 2 (3 item) terbukti disjoin dan mencakup seluruh 28 ID seeded.
   - Auto-reset paginasi ke Halaman 1 terbukti saat filter diterapkan dari Halaman 2.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D118 | **Koreksi Lanjutan P2.6 Tahap 2 UI Inbox & Penguatan Integritas Pengujian**: 1. Resolusi pasangan konfigurasi Auth fail-closed (`lib/supabase/auth-config.ts`); 2. Trusted origins port dinamis & verifikasi read-ack geometri aktual dengan HTTP 200/DB/UI unread; 3. Re-use helper guard proyek & bukti penolakan fail-closed; 4. Resiliensi loading daftar saat overlap polling via `activeForegroundListRequestIdRef`; 5. Siklus teardown terverifikasi dengan pemeriksaan error deleteUser & residu database; 6. Pengujian komprehensif 17 assertion interaktif browser CDP. | **KOREKSI LANJUTAN P2.6 TAHAP 2 SELESAI DENGAN BUKTI LENGKAP.** Seluruh 17 skenario browser CDP lulus (17 PASS, 0 FAIL, exit code 0). 247 unit tests lulus (exit code 0), 33 integration inbox tests lulus (exit code 0), tsc 0 error, eslint 0 error. Status P2.6: `In Progress` (siap direview untuk penutupan P2.6). Entry berikutnya D119. |

### 2026-10-07 — D119: Penyelesaian Enam Temuan Review P2.6 Tahap 2 UI Inbox

1. **Jadikan Retry Read-Ack dan Hidden Tab Assertion Wajib**:
   - Injeksi kegagalan read-ack nyata (HTTP 500) via interceptor `window.fetch`; verifikasi banner error spesifik `[role="alert"]` teks 'Gagal menyinkronkan status baca' dan tombol 'Coba lagi'.
   - Merekam snapshot `conversationId` dan `messageIds` dari request yang gagal. Tombol retry mengirimkan tepat ID yang gagal tanpa penambahan ID di luar snapshot.
   - Respons retry berhasil dan perubahan database diverifikasi untuk ID yang bersangkutan (`is_confirmed = true`).
   - Skenario tab dokumen tersembunyi (`document.hidden = true`) membuktikan tidak ada request read-ack baru dan status database tetap tidak terkonfirmasi selama tab tersembunyi.
   - Kedua skenario memiliki assertion wajib terpisah (`read_acknowledgment_retry_isolation`, `hidden_tab_read_suppression`) yang memengaruhi overall status dan exit code.

2. **Buktikan Overlap Polling dan Penolakan Respons Usang**:
   - Overlap: Mengendalikan request foreground (navigasi "Berikutnya") dan background polling komponen (interval 5s). Memverifikasi loading selesai (`isLoadingList = false`), data halaman 2 tampil tepat (3 item), dan kontrol paginasi kembali fungsional (`polling_overlap_with_foreground_fetch`).
   - Respons usang: Menahan respons detail percakapan A, memilih B, lalu melepaskan respons A. Memverifikasi bahwa isi panel dan seleksi antrean tetap B tanpa kebocoran data A (`stale_response_rejection`), terpisah dari skenario kegagalan B setelah A terbuka (`detail_failure_isolation_after_open`).

3. **Lengkapi Assertion Reset Pagination dan Recovery Error**:
   - Reset paginasi: Berangkat dari Halaman 2 (3 item), menerapkan filter baru, memverifikasi reset otomatis ke Halaman 1 dengan parameter baru dan hasil terfilter (`pagination_reset_on_filter_change`).
   - Recovery error mandiri: Kegagalan list (HTTP 500) dan kegagalan detail diuji dan dipulihkan secara mandiri via tombol 'Coba lagi' masing-masing tanpa saling menghapus state error (`list_error_and_recovery_isolated`, `detail_error_and_recovery_isolated`).

4. **Tutup Fallback Konfigurasi Auth Parsial**:
   - `lib/supabase/auth-config.ts` menerapkan aturan prioritas berpasangan: `runtime_server` -> `test_override` -> `public_client`.
   - Mengimplementasikan anti-bypass fail-closed: ketersediaan `SUPABASE_URL` tanpa runtime key langsung ditolak seketika meskipun test override pair terkonfigurasi lengkap.
   - Melarang pencampuran pasangan lintas sumber dan melarang penggunaan `SUPABASE_SERVICE_ROLE_KEY` sebagai key sesi staf.
   - 13 unit tests terarah pada `tests/utils/auth-config.test.ts` (253/253 unit tests passed).

5. **Uji Kegagalan pada Lifecycle Cleanup Sebenarnya**:
   - Menghapus assertion sukses buatan. Mode `--test-cleanup-failure` menjalankan alur uji penuh lalu menginjeksi kegagalan operasional pada `cleanupFixture` di blok `finally`, menghasilkan overall FAIL dan exit code 1.
   - Mode `--test-setup-failure` menginjeksi kegagalan saat setup setelah user terbuat, memicu rollback di `finally`, menghasilkan overall FAIL dan exit code 1.
   - `killProcess()` memverifikasi PID aktif sebelum dan sesudah `taskkill`, memeriksa exit status dan memastikan proses benar-benar berhenti.
   - Guard bersama `requireIsolatedDatabase` memverifikasi PostgreSQL 54332 & GoTrue 54331, menolak target workspace aktif (54322 & 54321), serta menolak marker token mismatch.

6. **Keselarasan Bukti, Penyesuaian Header Mobile, dan Pelaporan**:
   - Menyelaraskan seluruh dokumentasi dengan 23 automated assertion konkret pada `tests/interactive/verify-p26-inbox.mjs`.
   - Merapikan header detail mobile (`components/inbox/inbox-conversation-panel.tsx`) untuk keterbacaan identitas dan efisiensi ruang vertikal, tersimpan pada artefak `docs/evidence/P2_6/mobile_inbox_detail.png`.
   - Status P2.6 dipertahankan `In Progress` menunggu review akhir pengguna.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D119 | **Penyelesaian Enam Temuan Review P2.6 Tahap 2 UI Inbox**: 1. Retry read-ack snapshot isolation & hidden tab supresi wajib; 2. Pembuktian overlap polling komponen & penolakan respons usang; 3. Assertion reset paginasi Page 2->1 & pemulihan error list/detail terisolasi; 4. Anti-bypass fail-closed auth-config & larangan service-role; 5. Uji kegagalan teardown cleanup sebenarnya & penguatan taskkill PID; 6. Polish header detail mobile & sinkronisasi dokumentasi 23 assertion wajib. | **KOREKSI SELESAI & TERVERIFIKASI EMPIRIS.** 23/23 assertion browser CDP lulus (exit code 0). 3 mode harness (guard-rejection: exit 0, setup-failure: exit 1, cleanup-failure: exit 1) terbukti fail-closed. 253/253 unit tests lulus. Status P2.6: `In Progress` (siap direview akhir). Entry berikutnya D120. |

### 2026-10-07 — D120: Penutupan Lima Kelompok Temuan Review P2.6 Tahap 2 UI Inbox & Penguatan Integritas Pengujian

1. **Pembersihan Cadangan (Fallback Cleanup) & Pengujian Mid-Run dengan Residu Nol**:
   - Mempertahankan error pembersihan awal (`cleanupErrors`), menghasilkan status FAIL keseluruhan dan exit code 1 pada mode `--test-cleanup-failure`.
   - Mengimplementasikan pembersihan sekunder (fallback cleanup) otomatis pada resource milik run sehingga residu database tetap terbukti nol (`conversations = 0, messages = 0, channel_identities = 0`).
   - Mode `--test-midrun-failure` membuktikan kegagalan di tengah eksekusi memicu rollback proses (`taskkill`) dan resource database di blok `catch`/`finally` tanpa klaim PASS pada skenario UI yang belum dieksekusi.

2. **Penolakan Respons Usang Berbasis Barrier (Stale Response Rejection)**:
   - Tidak mengasumsikan Percakapan A sudah aktif; skenario dimulai secara deterministik dari Percakapan C (kondisi awal diverifikasi).
   - Intersepsi network spesifik pada `GET /api/inbox/conversations/${convAId}` (mengecualikan rute `/read`).
   - Event barrier membuktikan urutan: request A masuk dan ditahan (`A_requested`) -> staf mengklik B (`B_rendered`) -> respons A dilepas (`A_released`) -> respons A selesai (`A_resolved`) -> panel dan seleksi antrean tetap menampilkan data B tanpa tertimpa data A (`B_remains_active`).
   - Seluruh riwayat urutan barrier disimpan dalam JSON bukti. Assertion kegagalan detail B setelah A terbuka tetap dipisahkan secara independen.

3. **Isolasi Pemulihan Dua Arah & Klarifikasi Banner Polling**:
   - Mematahkan dugaan error saling menghapus (*cross-panel error erasure*). Pemicu error daftar (`__faultList`) dan detail (`__faultDetail`) dikendalikan secara independen.
   - Menguji kedua arah pemulihan:
     - Arah A: Dual error -> lepas fault daftar + klik coba lagi daftar -> daftar pulih (25 item) sementara banner error detail tetap bertahan.
     - Arah B: Dual error -> lepas fault detail + klik coba lagi detail -> detail pulih (Beta tampil, pesan termuat) sementara banner error daftar tetap bertahan.
   - Menamai ulang assertion kegagalan polling menjadi `polling_failure_and_banner_alert` untuk mencerminkan deteksi banner tanpa klaim pemulihan berlebih.

4. **Pemulihan Ketegasan Assertion (Restoration of Weakened Assertions)**:
   - Read-Ack Normal: Memasang listener network sebelum aksi klik; menggunakan fixture khusus `convReadTestId` (Pelanggan Delta) dengan 9 pesan yang diverifikasi memiliki 0 pembacaan di database sebelum panel dibuka; mewajibkan HTTP 200, amplop sukses `{ success: true }`, pesan terlihat terkonfirmasi di DB `is_confirmed = true`, dan pesan di luar viewport tetap tidak tercatat (0 baris); menghapus toleransi fallback longgar `HTTP || DB`.
   - Reset Paginasi: Memverifikasi kondisi Halaman 2 aktif dirender sebelum pencarian diterapkan (`expected` & `actual`), dan memverifikasi reset otomatis ke Halaman 1 dengan parameter baru.
   - Integritas Paginasi: Memverifikasi kesetaraan himpunan ketat (*strict set equality*, `missing === 0 && unexpected === 0`) antara seluruh 28 ID yang dirender lintas halaman dengan 28 fixture ID yang di-seed untuk run tersebut.
   - Registri Mandatori Fail-Closed: Fungsi `finalize()` memvalidasi hasil uji terhadap registri ID wajib spesifik per mode (`NORMAL_BROWSER_REGISTRY`, `GUARD_REJECTION_REGISTRY`, `SETUP_FAILURE_REGISTRY`, `MIDRUN_FAILURE_REGISTRY`, `CLEANUP_FAILURE_REGISTRY`). Ketiadaan ID wajib atau duplikasi ID menghasilkan status `INCOMPLETE` / `FAIL` dan exit code 1.

5. **Preservasi Artefak Multimode & Keselarasan Dokumentasi**:
   - Menghentikan penghapusan direktori bukti (`fs.unlinkSync` dihapus); seluruh 5 berkas JSON bukti disimpan berdampingan per mode (`p26-interaction-evidence.json`, `p26-runner-cleanup-fail.json`, `p26-runner-setup-fail.json`, `p26-runner-midrun-fail.json`, `p26-evidence-guard-rejection.json`).
   - Menyimpan metadata lengkap: `runId`, `mode`, `timestamp`, `codeRevisions` hash SHA256 berkas kode kunci, tanpa rahasia/password.
   - Header detail mobile pada `components/inbox/inbox-conversation-panel.tsx` disempurnakan (`flex-col sm:flex-row`, pembungkusan badge pada layar sempit) untuk mencegah pemotongan judul pengirim.
   - Menjaga status P2.6 tetap `In Progress` menunggu review akhir pengguna.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D120 | **Penutupan Lima Kelompok Temuan Review P2.6 Tahap 2 UI Inbox**: 1. Fallback cleanup & rollback mid-run dengan 0 residu database; 2. Stale response barrier-driven event verification (C -> A -> B -> A settled -> B remains); 3. Isolasi pemulihan error dua arah (list recovers vs detail error persists, dan detail recovers vs list error persists) & klarifikasi polling banner alert; 4. Pemulihan assertion ketat: pre-checked read-ack tanpa fallback longgar, Page 2 reset, strict set equality 28 fixture, dan registri mandatori fail-closed; 5. Preservasi 5 artefak JSON multimode dengan SHA256 hashes & polish header mobile. | **KOREKSI TUNTAS & TERVERIFIKASI EMPIRIS.** Seluruh 5 mode runner teruji (Normal 23/23 PASS exit 0; Guard 3/3 PASS exit 0; Setup FAIL exit 1; Midrun FAIL exit 1; Cleanup FAIL exit 1). Residu database bersih (0 conv, 0 msg, 0 id). 253/253 unit tests lulus. Status P2.6: `In Progress` (siap direview penutupan). Entry berikutnya D121. |

### 2026-10-07 — D121: Penguatan Integritas Runner, Penanganan Interceptor Stale Terisolasi, Pipeline Cleanup Terpadu, Penyimpanan Artefak Unik Per-Run, dan Pengujian Mandiri Finalizer P2.6 Tahap 2

1. **Sinkronisasi Build Identity & Verifikasi Header Mobile Aktual**:
   - Menghubungkan proses eksekusi runner dengan build produksi Next.js terbaru (`BUILD_ID: I0LId5PqSH7QOBl8HCYN4`).
   - Merekam hash SHA256 berkas-berkas source aplikasi pada saat build/launch dan memverifikasi kesesuaiannya dengan saat finalisasi (`isSynchronized: true`).
   - Runner revision hash dicatat secara mandiri (`b945740e749ce38735c159e2bd4273d068dce74fe4d51612c0d1bb4fae779a23`).
   - Screenshot `mobile_inbox_detail.png` membuktikan layout header detail mobile terbaru (`flex-col sm:flex-row`, pembungkusan badge status `Percakapan Aktif` dan `Ditangani` tanpa overflow horizontal atau pemotongan judul).

2. **Isolasi Interceptor Stale & Verifikasi Sekuens Event Lengkap**:
   - Interceptor respons stale (`stale_response_rejection`) dijadikan *single-use* dan dipulihkan tanpa syarat di blok `finally` (`window.fetch = window.__origFetchBeforeStale`), mencegah kebocoran state interceptor ke skenario berikutnya.
   - Sekuens event barrier lengkap dicatat dalam bukti: `["A_requested", "B_rendered", "A_released", "A_resolved", "B_remains_active"]` (termasuk event `B_rendered`).
   - Skenario `detail_failure_isolation_after_open` mewajibkan verifikasi polling bahwa Percakapan A benar-benar terpilih dan ter-render di panel detail sebelum menginjeksi fault HTTP 500 pada Percakapan B menggunakan fixture ID run (`convBId`). Interceptor dipulihkan tanpa syarat di `finally`.

3. **Pipeline Cleanup Terpadu (Primary -> Catch -> Fallback)**:
   - Menyatukan alur cleanup normal dan mode kegagalan dalam satu pipeline `primaryCleanupFn -> catch -> fallbackCleanupFn`.
   - Pada mode `--test-cleanup-failure`, kegagalan diinjeksi pada batas pemanggilan primary cleanup (`primaryCleanupFn` melempar error tertangkap), handler `catch` menangkap error tersebut, mencatat `cleanupErrors`, dan mengeksekusi `fallbackCleanupFn` untuk membersihkan seluruh resource milik run.
   - Verifikasi residu database menegaskan 0 residu (`conv = 0, msg = 0, id = 0`).
   - Error primary tetap dipertahankan sehingga mode cleanup failure menghasilkan status akhir `FAIL` dan exit code 1 sesuai ekspektasi pengujian negatif.

4. **Penyimpanan Artefak Unik Per-Run & Indeks Manifest**:
   - Seluruh eksekusi run disimpan dalam direktori terisolasi `docs/evidence/P2_6/<runId>/` (misal `run-4e4e31df`, `guard-316b9a84`, `setup-fail-f8581666`, `midrun-fail-a783dbf9`, `cleanup-fail-fc83f2bc`).
   - Setiap direktori menyimpan `evidence.json`, metadata lengkap, dan seluruh screenshot PNG yang dihasilkan pada run tersebut tanpa menimpa atau menghapus artefak run sebelumnya.
   - Berkas indeks `docs/evidence/P2_6/latest-manifest.json` memetakan run terbaru per mode beserta status, `expectedExitCode`, `calculatedExitCode`, `buildId`, `runnerRevisionSha256`, dan path bukti.

5. **Pengujian Negatif Mandiri Logika Finalizer**:
   - Logika evaluasi finalizer diekstraksi ke fungsi murni `evaluateFinalizeResults()` di `verify-p26-inbox.mjs` yang dapat diuji tanpa membuka Chrome, Next.js, atau database.
   - Berkas uji mandiri `tests/interactive/verify-finalizer.test.mjs` membuktikan 5 kasus wajib:
     1. Registry lengkap dengan hasil valid -> PASS / exit 0.
     2. Satu ID wajib hilang -> INCOMPLETE / exit 1.
     3. ID duplikat -> FAIL / exit 1 (fail-closed).
     4. Registry mode terisolasi (Guard mode & Setup mode tidak mewajibkan skenario browser penuh) -> PASS / exit 0.
     5. Error cleanup memaksa status FAIL / exit 1 meskipun seluruh assertion lain PASS.
   - Hasil uji: 5/5 kasus PASS (exit code 0).

| ID | Keputusan | Status / dampak |
|---|---|---|
| D121 | **Penguatan Integritas Runner, Penanganan Interceptor Stale Terisolasi, Pipeline Cleanup Terpadu, Penyimpanan Artefak Unik Per-Run, dan Pengujian Mandiri Finalizer P2.6 Tahap 2**: 1. Build identity disinkronkan (`BUILD_ID: I0LId5PqSH7QOBl8HCYN4`, SHA256 sinkron, screenshot mobile layout terverifikasi); 2. Interceptor stale single-use dengan pembersihan `finally`, pencatatan event `B_rendered`, dan verifikasi prasyarat A terbuka sebelum fault B; 3. Pipeline cleanup terpadu (primary -> catch -> fallback) dengan fault di batas pemanggilan dan 0 residu DB; 4. Direktori unik per-run `docs/evidence/P2_6/<runId>/` + `latest-manifest.json` tanpa penimpaan; 5. Unit test mandiri finalizer 5/5 kasus PASS exit 0. | **KOREKSI TAHAP 2 RUNNER & BUKTI TERVERIFIKASI EMPIRIS.** Seluruh 5 mode runner + suite unit test finalizer lulus. Status P2.6: `In Progress` (menunggu review penutupan). Entry berikutnya D122. |

P2.6 dalam status In Progress (seluruh lima temuan integritas runner dan bukti terverifikasi empiris; menunggu review penutupan P2.6). Entry berikutnya D122.

### 2026-10-07 — D122: Pengikatan Build–Source Eksplisit, Validasi Metadata Terarah, Pemisahan Exit Code Jujur, dan Penyelarasan Bukti P2.6 Tahap 2

1. **Pengikatan Hash Source dengan Build Sebenarnya (`scripts/build-source-manifest.mjs`)**:
   - Menghubungkan perekaman hash SHA-256 secara langsung ke dalam proses kompilasi Next.js (`npm run build`), bukan saat runner pengujian dimulai.
   - Mengambil snapshot hash berkas sebelum build (`preHashes`) dan membandingkannya dengan snapshot setelah build (`postHashes`). Jika terjadi mutasi berkas selama proses kompilasi, status dinyatakan `MUTATED_DURING_BUILD` dan manifest valid tidak diterbitkan.
   - Menyatakan cakupan berkas terarah secara eksplisit: `TRACKED_FILE_SCOPE = "p26_inbox_and_auth"` yang mencakup 18 berkas kunci (komponen UI Inbox, layout shell, routing dashboard, auth configuration, format helper, server service, kontrak data, dan validator origin), tanpa klaim keliru bahwa seluruh source tree di-hash.
   - Setelah kompilasi berhasil dan snapshot konsisten, manifest disimpan mengikat:
     - `buildId` (dari `.next/BUILD_ID`);
     - `sourceHashes` (hash SHA-256 aktual);
     - `createdAt` (waktu pembuatan ISO);
     - `scope` dan `trackedFiles`.
   - Manifest disimpan di `.next/build-source-manifest.json` dan salinan persisten di `docs/evidence/P2_6/build-source-manifest.json`.

2. **Validasi Metadata Terarah & Pengujian Mandiri 6 Kasus (`tests/interactive/verify-build-metadata.test.mjs`)**:
   - Dibuat fungsi murni `validateBuildMetadata()` yang membedakan secara jujur:
     - `sourceHashesAtBuild`: hash saat build yang tercatat di manifest build;
     - `sourceHashesAtLaunch`: hash aktual saat runner mulai sebelum server dan browser aktif;
     - `sourceHashesAtFinalize`: hash aktual saat evaluasi penutupan (teardown).
   - Suite pengujian mandiri `tests/interactive/verify-build-metadata.test.mjs` membuktikan 6 kasus tanpa browser atau database:
     1. Cocok -> `SYNCHRONIZED`, `isValid: true`, PASS, exit code 0.
     2. Manifest build tidak tersedia -> `MISSING_OR_INVALID_MANIFEST`, `isValid: false`, FAIL, exit code 1.
     3. BUILD_ID berbeda -> `BUILD_ID_MISMATCH`, `isValid: false`, FAIL, exit code 1.
     4. Source berubah setelah build sebelum runner dimulai -> `SOURCE_CHANGED_BEFORE_LAUNCH`, `isValid: false`, FAIL, exit code 1.
     5. Source berubah selama run berlangsung -> `SOURCE_CHANGED_DURING_RUN`, `isValid: false`, FAIL, exit code 1.
     6. Mode non-aplikasi (`guard_rejection`, `setup_failure`) -> `NOT_APPLICABLE`, `isValid: true`, `isApplicable: false` tanpa mengisi sinkronisasi semu.
   - Hasil uji mandiri: **6 / 6 kasus PASS (exit code 0)**.

3. **Integrasi Runner & Pengikatan ke Keputusan Finalizer**:
   - Runner membaca manifest milik build yang dijalankan dan melakukan validasi awal sebelum peluncuran server Next.js dan Chrome (Step 2.5).
   - Menambahkan assertion wajib `build_source_binding_verification` ke `NORMAL_BROWSER_REGISTRY` (total 24 assertion).
   - Jika manifest hilang, BUILD_ID tidak cocok, atau source tidak cocok, runner mencatat kegagalan, membatalkan peluncuran browser, dan finalizer menolak status PASS dengan exit code 1 sambil tetap menjalankan siklus teardown pembersihan.
   - Jika source termutasi di tengah eksekusi, `finalize()` mendeteksi ketidaksesuaian `sourceHashesAtFinalize`, mengubah status `buildIdentity`, dan memaksa status keseluruhan menjadi FAIL (exit code 1).
   - Eksekusi live browser normal (`run-7fc817aa`) membuktikan: `BUILD_ID: F-DKJqKQFwVIN2WjYeN-h`, status `SYNCHRONIZED`, seluruh 24/24 assertion PASS (exit code 0), dan 0 residu database tersisa.

4. **Penyelarasan Pelaporan dengan Artefak Aktual & Pemisahan Exit Code yang Jujur**:
   - Membedakan secara presisi tiga konsep exit code:
     - `expectedExitCode`: ekspektasi skenario (0 untuk normal & guard; 1 untuk setup, midrun, cleanup failure);
     - `calculatedExitCode`: hasil evaluasi runner yang dihitung di `summary.exitCode`;
     - `processExitCode`: hasil proses yang diamati langsung oleh shell/pemanggil dari proses eksekutor.
   - JSON bukti hanya menyimpan `expectedExitCode` dan `calculatedExitCode`; tidak mengklaim field `processExitCode` tersimpan dalam file JSON.
   - Mengoreksi tabel cleanup: setup failure dan mid-run failure menjalankan rollback di blok `finally`, bukan alur fallback cleanup pipeline. Fallback cleanup pipeline (`fallbackCleanupFn`) hanya dijalankan saat primary cleanup melempar error (`--test-cleanup-failure`).
   - Seluruh daftar hash SHA-256 diselaraskan dan disalin langsung dari berkas manifest dan bukti aktual tanpa perkiraan.

5. **Keterbatasan Historis & Status P2.6**:
   - Catatan keterbatasan historis: Riwayat D116 dan D117 pada log terdahulu dikonfirmasi tetap mencerminkan baseline desain dan iterasi awal; evaluasi D118, D119, D120, D121, dan D122 mengklarifikasi evolusinya secara transparan tanpa manipulasi histori lama.
   - Status P2.6 tetap **🟡 In Progress** menunggu review akhir penutupan dari pengguna.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D122 | **Pengikatan Build–Source Eksplisit, Validasi Metadata Terarah, Pemisahan Exit Code Jujur, dan Penyelarasan Bukti P2.6 Tahap 2**: 1. Build manifest binding generator (`scripts/build-source-manifest.mjs`, pre vs post snapshot comparison, `BUILD_ID: F-DKJqKQFwVIN2WjYeN-h`, cakupan eksplisit 18 berkas); 2. Suite unit test metadata build 6 kasus lulus penuh (exit code 0); 3. Integrasi runner Step 2.5 dengan assertion `build_source_binding_verification` (24/24 PASS live browser run `run-7fc817aa`, exit code 0); 4. Penyelarasan pelaporan bukti: pemisahan jujur `expectedExitCode`, `calculatedExitCode`, dan `processExitCode`, koreksi alur cleanup, pengambilan hash aktual langsung dari artefak; 5. Keterbatasan historis D116/D117 dicatat transparan tanpa pengubahan histori lama. | **KOREKSI AKHIR P2.6 TAHAP 2 TERVERIFIKASI EMPIRIS PENUH.** Seluruh 6 unit test metadata lulus, 5 unit test finalizer lulus, build manifest VALID, dan live browser normal run lulus penuh. Status P2.6: `In Progress` (menunggu review akhir penutupan). Entry berikutnya D123. |

P2.6 dalam status In Progress (pengikatan build–source, validasi metadata terarah, dan penyelarasan laporan tuntas; siap untuk review penutupan). Entry berikutnya D123.

### 2026-10-07 — D123: Penutupan P2.6 Menjadi Done, Klarifikasi Keterbatasan Histori D116/D117, dan Penyelarasan Cakupan Pengujian Metadata

1. **Penutupan Resmi P2.6 (Status: Done)**:
   - Implementasi teknis P2.6 (fondasi schema read-state persisten per-staf P2.6 Tahap 1, kontrak pagination & filtering, layout 2-panel desktop & single-pane mobile, penanda non-warna, viewport read-ack via `IntersectionObserver`, polling 5 detik non-destruktif, isolasi error, resiliensi loading overlap, pengikatan build-source eksplisit `BUILD_ID: F-DKJqKQFwVIN2WjYeN-h`, dan verifikasi teardown bersih dengan 0 residu database) telah diterima secara teknis melalui review.
   - Penutupan didasarkan pada bukti live normal terbaru pada `docs/evidence/P2_6/run-7fc817aa/evidence.json` (24/24 assertion PASS, exit code 0, status `SYNCHRONIZED`, 0 residu database).
   - Mode negatif dari eksekusi terdahulu (`guard-316b9a84`, `setup-fail-f8581666`, `midrun-fail-a783dbf9`, `cleanup-fail-fc83f2bc`) tetap diidentifikasi sebagai bukti historis yang telah diterima dan dipertahankan dalam direktori per-run masing-masing, bukan diklaim berasal dari run terbaru.
   - Status P2.6 diselaraskan menjadi **Done**.

2. **Klarifikasi Keterbatasan Histori D116 dan D117**:
   - Ditambahkan klarifikasi append-only eksplisit: isi asli entri D116 dan D117 sebelum pemadatan belum dapat diverifikasi atau dipulihkan karena ketiadaan sumber pembanding terverifikasi di workspace.
   - Tidak dilakukan rekonstruksi ingatan atau pengarangan teks asli; catatan keterbatasan ini dipertahankan sebagai catatan dokumentasi nonpenghambat yang tidak mempengaruhi validitas teknis kode atau bukti empiris P2.6 yang telah diterima.

3. **Penyelarasan Ketepatan Cakupan Pengujian Metadata**:
   - Menyelaraskan klaim dokumentasi dengan pengujian aktual pada `tests/interactive/verify-build-metadata.test.mjs`.
   - Kasus keenam pada suite tersebut menguji `mode: "guard_rejection"` secara langsung (`NOT_APPLICABLE`, `isApplicable: false`, `isValid: true`, exit code 0).
   - Fungsi implementasi `validateBuildMetadata()` mendukung penanganan `setup_failure` sebagai `NOT_APPLICABLE`, namun suite pengujian tidak mengujinya secara langsung.
   - Dokumentasi membedakan secara jujur antara dukungan logika implementasi dengan cakupan pengujian aktual tanpa menambah tes baru yang tidak diperlukan.

4. **Batas Task & Status P2.7**:
   - P2.7 (Panel konteks identitas dan evidence jaringan) berstatus `⬜ Not Started` dan belum dikerjakan.

| ID | Keputusan | Status / dampak |
|---|---|---|
| D123 | **Penutupan P2.6 Menjadi Done, Klarifikasi Keterbatasan Histori D116/D117, dan Penyelarasan Cakupan Pengujian Metadata**: 1. P2.6 ditutup resmi (Done) berbasis bukti normal terbaru `run-7fc817aa` (24/24 PASS, exit 0) dan bukti negatif historis per-run; 2. Klarifikasi append-only keterbatasan histori D116/D117 belum dapat diverifikasi/dipulihkan dari sumber yang tersedia (catatan nonpenghambat); 3. Ketepatan cakupan uji metadata: kasus 6 menguji langsung `guard_rejection`, dukungan `setup_failure` dicatat sebagai dukungan implementasi tanpa klaim pengujian langsung; 4. P2.7 tetap Not Started. | **P2.6 SELESAI PENUH (DONE).** Seluruh Acceptance Criteria P2.6 Tahap 1 dan Tahap 2 diterima. Status P2.6: `Done`. Pipeline berikutnya: P2.7 (Panel konteks identitas dan evidence jaringan). Entry berikutnya D124. |

P2.6 selesai penuh (Done). Pipeline berikutnya: P2.7 (Panel konteks identitas dan evidence jaringan). Entry berikutnya D124.








