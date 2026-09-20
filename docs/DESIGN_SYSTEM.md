# Design System — Upaznet Helpdesk
**Versi:** 1.1 · **Tanggal:** 20 September 2026 · **Status:** baseline desain prototype  
Pendamping [PRD v2.1](PRD.md). Pilihan visual berikut adalah keputusan desain untuk implementasi awal, bukan identitas brand resmi ISP. Semua data contoh fiktif.

## 1. Prinsip
1. **Inbox lebih dulu:** target landing setelah login adalah antrean percakapan/komplain. Custpanel tetap dipakai untuk tiket, delegasi teknisi dan finance; dashboard ini menjadi workspace komunikasi dan pemeriksaan.
2. **Bukti dekat keputusan:** status selalu disertai sumber, waktu observasi, dan alasan ringkas.
3. **Satu tindakan utama:** “Mulai tangani”, “Kirim balasan”, atau “Tandai pulih” sesuai konteks.
4. **Jangan menyamakan status:** online, episode pulih, dan pesan terkirim adalah tiga hal berbeda.
5. **Hemat perhatian:** latar terang, teks kontras, warna hanya untuk status/aksi, tanpa gradient dekoratif.
6. **Jujur tentang simulasi:** badge “Prototype · Data dummy” persisten; teks pelanggan memiliki prefix simulasi.

## 2. Navigasi dan shell
| Menu | Route referensi | Isi |
|---|---|---|
| Inbox / Antrean | /dashboard/complaints | Target landing, percakapan masuk, episode, detail chat dan balasan |
| Gangguan | /dashboard/incidents | Tab “Otomatis” dan “Manual”, riwayat dan lifecycle |
| Pelanggan (sekunder) | /dashboard/customers | Pencarian/direktori pendukung seluruh pelanggan, layanan dan ODP/ODC |
| Template | /dashboard/templates | Default/per-incident, version dan preview |
| Log & kesehatan | /dashboard/logs | Decision log, audit, outbound, pending jobs |
| Pengaturan | /dashboard/settings | Mode, allowlist, simulasi dan kontrol automation |

- Desktop sidebar 216 px, topbar 64 px, area konten mengambil sisa layar. Tidak memakai max-width sempit untuk tabel operasional.
- Topbar: judul halaman, “Data dummy”, mode automation, keadaan koneksi, profil staf. Emergency stop tersedia melalui kontrol mode; tidak memenuhi semua halaman dengan tombol bahaya.
- Shell memuat session expiry, offline/polling error, dan pending count. Status “terhubung” hanya bila pemeriksaan berhasil, bukan default.
- Tidak ada navigasi/label vendor konfigurasi OLT atau proyek Command Generator.

## 3. Token warna
| Token | Nilai | Penggunaan |
|---|---|---|
| bg.canvas | #F8FAFC | Latar aplikasi |
| bg.surface | #FFFFFF | Panel/table/dialog |
| bg.subtle | #F1F5F9 | Header tabel/hover netral |
| text.primary | #0F172A | Judul dan isi utama |
| text.secondary | #475569 | Keterangan dan timestamp |
| border.subtle | #CBD5E1 | Pemisah dekoratif |
| border.control | #64748B | Batas input yang perlu dikenali |
| action.primary | #1D4ED8 | Tombol utama dengan teks putih |
| action.hover | #1E40AF | Hover primary |
| action.soft | #EFF6FF | Selected row/notice informasi |
| success.text / bg | #166534 / #F0FDF4 | Online/pulih sebagai label sesuai konteks |
| warning.text / bg | #92400E / #FFFBEB | Basi, unknown, butuh pemeriksaan |
| danger.text / bg | #B91C1C / #FEF2F2 | LOS, gagal kirim, force-close |
| info.text / bg | #1E40AF / #EFF6FF | Baru, proses, informasi |
| neutral.text / bg | #475569 / #F1F5F9 | Arsip/tidak tersedia |
| focus.ring | #2563EB | Ring 2 px + offset 2 px |

Gunakan foreground gelap pada badge terang; jangan memakai teks putih pada kuning. Selected row memiliki garis kiri atau marker selain warna. Border.subtle tidak digunakan sebagai satu-satunya penanda kontrol input.

## 4. Tipografi, ukuran, dan motion
- Font: system sans (Segoe UI di Windows, system-ui fallback); tidak perlu download font. Monospace hanya untuk ID/log teknis. Nama pelanggan dan teks chat tetap sans.
- Page title 24/32 px weight 600; section 18/28 px 600; body/input/chat 14/22 px 400; table 14/20 px; metadata 12/18 px; angka count 24/32 px 600.
- Spacing scale: 4, 8, 12, 16, 24, 32, 48 px. Padding panel 16–24 px, gap komponen 12–16 px.
- Radius: input/button 6 px, card/dialog 10 px, badge pill. Shadow hanya untuk floating menu/dialog; panel memakai border tipis.
- Input/button tinggi 40 px, mobile 44 px. Icon 16–20 px; icon-only action memiliki area klik 40 px, accessible name dan tooltip.
- Table row 56 px default; pesan dipotong maksimum dua baris, detail tersedia saat dibuka. Jangan menyembunyikan status gagal dalam ellipsis.
- Animasi feedback 120–180 ms; hormati reduced motion. Tidak ada pulse permanen untuk setiap indikator sehat.

## 5. Semantik status
| Domain | Label UI | Warna + ikon |
|---|---|---|
| Episode NEW | Baru | Biru + inbox |
| IN_PROGRESS | Ditangani | Biru + user |
| RESOLVED | Pulih | Hijau + check |
| CLOSED | Ditutup | Abu + archive |
| ONU online | Perangkat online | Hijau + check-circle |
| ONU LOS | Sinyal hilang (LOS) | Merah + alert |
| Unknown | Belum diketahui | Amber + help |
| Stale | Data basi | Amber + clock |
| Area evidence | Indikasi area | Amber + network; tampilkan confidence data/count |
| Manual ACTIVE | Incident aktif | Merah + alert; tidak disamakan dengan otomatis terkonfirmasi |
| SHADOW | Shadow · tanpa balasan otomatis | Abu + eye |
| LOS_AND_GENERIC | Gangguan + generik | Biru + message |
| FULL | Semua rule aktif | Biru + check |
| Attempt pending/sending | Menunggu / Mengirim | Abu/biru + clock |
| Attempt sent | Diterima Telegram | Check; tidak menulis “dibaca” |
| Attempt failed | Gagal dikirim | Merah + x |
| Attempt unknown | Hasil kirim belum pasti | Amber + help; tanpa tombol retry langsung |

Warna tidak pernah menjadi satu-satunya informasi. Setiap badge memuat teks; icon dekoratif disembunyikan dari screen reader.

## 6. Antrean dan detail komplain
### 6.1 Wireframe desktop
```text
┌───────────────┬────────────────────────────────────────────────────────────┐
│ Upaznet       │ Antrean      [Data dummy] [Shadow] [Terhubung] [Akbar]     │
│               ├────────────────────────────────────────────────────────────┤
│ Antrean       │ Baru 6   Ditangani 3   Perlu diperiksa 2                  │
│ Gangguan      │ Cari nama / ID...    Status ▾  Bukti ▾  Belum dibaca □   │
│ Pelanggan     ├─────────────────┬───────────────────────┬────────────────┤
│ Template      │ Daftar episode  │ C-001 · Pelanggan Uji │ Pemeriksaan    │
│ Log           │                 │ [Baru] [Telegram]     │ LOS            │
│ Pengaturan    │ ● C-001 · LOS   │                       │ ODP-DUMMY-01   │
│               │ “wifi mati”     │ Pelanggan: wifi mati  │ Diamati 09:41  │
│               │ 2 menit lalu    │ Bot: [SIMULASI] ...   │ Area 4/8 LOS   │
│               │                 │                       │ Cakupan 8/10   │
│               │ C-002 · online  │ Balasan | Catatan     │ Alasan rule    │
│               │ ...             │ Tulis balasan...      │ [Cek ulang]    │
│               │                 │ [Kirim ke Telegram]   │ [Mulai tangani]│
└───────────────┴─────────────────┴───────────────────────┴────────────────┘
```
Ini sketsa komposisi, bukan screenshot aplikasi yang sudah dibangun. Label jumlah/identitas adalah contoh.

### 6.2 Perilaku utama
- Daftar default: episode belum CLOSED, NEW/unread di atas, lalu waktu tunggu terlama. Staf boleh mengubah sorting; polling tidak memindahkan item yang sedang dipilih saat mengetik.
- Filter: status, unread, kategori, jenis bukti, send failure, manual incident/event. “Data basi” berbeda dari “LOS”.
- Row: episode ID, nama/ID masked bila unresolved, preview pesan, badge kondisi, unread count, last inbound; timestamp lengkap melalui tooltip/detail.
- Detail: nomor episode/status, layanan, channel, riwayat kronologis; label jelas “Pelanggan”, “Automation”, “Akbar (staf)” dan “Catatan internal”.
- Composer: tab “Balasan ke pelanggan” default, tab “Catatan internal” berbeda latar dan label. Tombol berubah menjadi “Kirim ke Telegram” atau “Simpan catatan”. Channel penerima selalu terlihat.
- Enter membuat baris baru; Ctrl/Cmd+Enter mengirim bila valid. Tidak mengirim pada Enter biasa. Kosong/whitespace → tombol disabled, alasan inline.
- Draft tidak hilang saat polling/error/network reconnect. Jangan menyimpan PII draft ke penyimpanan browser permanen pada prototype; session expiry mempertahankan tampilan draft selama halaman masih terbuka.
- Double-click send → request ID sama; tampilkan “Mengirim”. Sukses tampil di timeline; gagal tampil inline dengan konteks. Status unknown tidak menawarkan retry cepat.
- “Mulai tangani” menghentikan automation pending untuk episode. Jika send sudah in-flight, tampilkan informasi itu; jangan memberi jaminan pesan sudah dibatalkan.
- “Tandai pulih” meminta catatan singkat; “Tutup episode” hanya dari RESOLVED. “Buka kembali” mempertahankan ID. “Pisahkan masalah” ada di menu sekunder, dengan penjelasan episode baru.
- Sidebar pemeriksaan: status ONU, upstream, ODP/ODC, waktu observasi dan waktu cek, sumber MOCK, coverage, incident/event, template/reason. Gunakan safe reason code; credential/stack trace tidak ditampilkan atau dikirim ke pelanggan.
- “Cek ulang” memperbarui assessment untuk staf; label penjelas “Tidak mengirim balasan otomatis baru”. Jangan diam-diam mengirim saat staf memeriksa ulang.

### Batas dengan Custpanel
- Episode/status percakapan bukan tiket teknisi. Pembuatan tiket dan delegasi dilakukan staf secara manual di Custpanel.
- Bukti jaringan ditampilkan dekat percakapan untuk membantu penulisan tiket; tidak ada tombol yang mengesankan sinkronisasi Custpanel sudah tersedia.
- Usulan berikutnya: salin ringkasan pemeriksaan dan simpan nomor tiket sebagai referensi. Belum dibangun pada tahap provider.
- Implementasi saat ini baru direktori pelanggan dan API pemeriksaan. Inbox, panel evidence dan composer menyusul; jangan menampilkan tombol kirim atau status monitoring yang belum terhubung.

## 7. Gangguan dan incident manual
- Tab default “Indikasi otomatis”: event/scope, bukti, observed_at, coverage, jumlah episode terkait. Tidak menulis “kabel putus” berdasarkan LOS.
- Tab “Incident manual”: satu ACTIVE, daftar RESOLVED/CLOSED, create GENERAL/AREA_SPECIFIC, description, affected ODP/ODC, estimasi text, preview template.
- GENERAL menampilkan penjelasan “Pemberitahuan umum untuk inbound, tanpa pemeriksaan wilayah”. AREA_SPECIFIC membutuhkan affected ID.
- Resolve/reopen/normal close memakai label tindakan spesifik. Force-close ditempatkan pada menu sekunder danger, dialog alasan wajib.
- Dialog force-close: incident ID, dampak menghentikan override, field alasan, tombol “Force-close incident”. Tidak memakai tombol generik “OK”.
- Jika incident ACTIVE lain ada, form menyajikan konflik dan link incident tersebut; jangan menawarkan “paksa aktif” yang melewati constraint.
- Saat version conflict, tampilkan “Data sudah diubah staf lain. Muat versi terbaru”; jangan overwrite diam-diam.
- Mengubah area/template tidak mengirim ulang pelanggan yang sudah dibalas. Tampilkan keterangan ini dekat aksi simpan.

## 8. Template, log, dan simulasi
**Template:** key/scope/version, editor plaintext, daftar placeholder yang diizinkan, contoh render fiktif. Simpan membuat versi; history bisa dilihat. Preview bukan kirim. Required placeholder/error ditampilkan inline.

**Log & kesehatan:** tab Keputusan / Pengiriman / Aktivitas / Pekerjaan. Filter correlation/episode/incident, waktu, reason. Ringkasan terpisah: error provider, gagal outbound, hasil unknown, job tertunda; jangan satu angka “error” tanpa jenis. Tampilkan terakhir diperbarui dan tombol refresh.

**Simulasi:** skenario normal, LOS individual, LOS area, upstream down+ONU online, stale/timeout, identitas unknown dan recovery. Pada fondasi saat ini, skenario dipilih per GET pemeriksaan dan tidak mengubah status global. Waktu observasi hanya diperbarui lewat refresh fixture lokal eksplisit; membaca data tidak membuat data basi menjadi fresh. UI simulator dan evaluasi inbound menyusul. Tidak menamai action “Putuskan jaringan”. Pilihan fixture tidak menyentuh data/log historis atau sistem lain.

**Mode:** ringkasan apa yang dikirim tiap mode, dropdown + aksi Terapkan, audit aktor/waktu. Beralih dari shadow ke live menampilkan ringkasan tester tujuan dan tidak replay backlog. Emergency stop menghentikan otomatis; tindakan manual staf tetap tersedia.

## 9. Komponen wajib
| Komponen | Kontrak state/perilaku |
|---|---|
| Button | primary/secondary/ghost/danger; loading mempertahankan lebar; disabled dengan alasan |
| Input/Textarea/Select | label nyata, hint, required, error; placeholder tidak menggantikan label |
| StatusBadge | semantic domain + label + ikon; tidak menerima warna bebas per halaman |
| DataTable/List | loading, empty, filtered-empty, error, pagination; selection pakai keyboard |
| Tabs | label jumlah opsional, aria selected, keyboard navigation |
| EvidenceCard | status/source/observed_at/checked_at/coverage dan reason; unknown bukan sukses |
| MessageItem | actor/channel/time/text/delivery; internal note terpisah dari bubble pelanggan |
| ReplyComposer | destination, draft, send state, request identity; tak ada auto-send |
| AlertBanner | persisten untuk offline/shadow/unknown send; toast hanya feedback tambahan |
| Dialog/Drawer | fokus terperangkap, Escape untuk batal, kembali ke pemicu; alasan destructive bila relevan |
| EmptyState | satu penjelasan + aksi yang relevan, tanpa ilustrasi dekoratif wajib |
| AuditEntry | actor/action/time/before-after; read-only |
| Pagination | 25 baris default, label total/filter; tidak infinite scroll pada log prototype |

## 10. Loading, kosong, dan kegagalan
| Kondisi | UI dan tindakan |
|---|---|
| Belum ada komplain | “Belum ada komplain. Kirim pesan dari akun tester ke bot Telegram.” |
| Filter kosong | “Tidak ada hasil untuk filter ini.” + Reset filter |
| Data pemeriksaan belum tersedia | “Belum diperiksa”, jangan menampilkan online |
| Provider gagal | “Kondisi jaringan belum dapat diperiksa”; alasan ringkas + waktu |
| Dashboard offline/polling gagal | Banner “Pembaruan terhenti”; pertahankan data terakhir dengan timestamp |
| Gagal menyimpan | Field/draft dipertahankan; jangan menampilkan toast sukses |
| Hasil kirim unknown | Banner pada pesan/episode, arahkan pemeriksaan manual; jangan duplikasi dengan retry |
| Session habis | Dialog login kembali; aksi mutasi diblokir, jangan redirect tanpa peringatan draft |
| Loading tabel/detail | Skeleton bentuk konten, aria-busy; tidak spinner seluruh shell |

## 11. Responsive dan accessibility
- ≥1440 px: sidebar + daftar 300 px + percakapan fleksibel min 420 px + evidence 280 px.
- 1024–1439 px: sidebar ringkas 72 px, daftar 280 px, percakapan; evidence pada drawer. Total lebar tidak memaksa horizontal scrolling halaman.
- 768–1023 px: navigasi drawer, daftar/detail dua tampilan; evidence tab dalam detail.
- <768 px: satu kolom, tap row membuka detail; tombol kembali mempertahankan filter/scroll. Composer tidak menutupi pesan terakhir/keyboard mobile.
- Target WCAG 2.2 AA: kontras teks biasa ≥4.5:1, teks besar ≥3:1, indikator kontrol/fokus ≥3:1 terhadap tetangga. Target sentuh produk 40–44 px; jangan mengandalkan hanya minimum.
- Semua tindakan dapat dijangkau keyboard, urutan fokus mengikuti visual, fokus visible, heading/table labels semantik. Message baru diumumkan melalui aria-live polite tanpa memindahkan fokus.
- Form error terkait field secara programatik; time dapat dibaca lengkap; zoom 200% tidak menghilangkan aksi utama.
- Dukungan reduced motion, tidak ada status hanya warna, nama accessible untuk icon-only. Pengujian nyata dilakukan saat UI ada; spesifikasi bukan klaim compliance.
- Referensi: [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

## 12. Copy dan konsistensi
- Gunakan “Perangkat online”, bukan “Internet normal”; “Indikasi gangguan”, bukan diagnosis yang belum terbukti.
- “Diterima Telegram” berarti provider accepted; tidak berarti delivered/read.
- “Masuk antrean” hanya bila episode/inbox tersimpan. “Sedang ditangani” hanya bila staf sudah mulai.
- Timestamp UI “19 Sep 2026, 09.41 WIB”; relatif “2 menit lalu” dilengkapi waktu absolut.
- Terminologi konsisten: komplain/episode untuk pelanggan, incident manual untuk override, indikasi/event untuk bukti otomatis.
- Data simulasi selalu jelas tanpa memenuhi setiap bubble dengan informasi implementasi.

## 13. Checklist siap implementasi
- Buat tokens terpusat dan primitive UI sebelum merakit halaman; CSS approach/library dipilih saat scaffolding tanpa mengubah kontrak visual.
- Urutan UI: shell/login → antrean kosong/fixture → detail dan composer → evidence → incident → template/log → simulasi.
- Minimal review visual: 1440, 1280, 768, 390 px; empty/loading/error/unknown send; keyboard-only; zoom 200%; focus/contrast.
- Uji integrasi UI: catatan tidak terkirim, draft tidak hilang, request send ganda idempotent, aksi stale version tidak overwrite.
- Tidak menambah graphic chart/brand asset atau dependency eksternal hanya untuk dekorasi. Dark mode, attachment dan peta topologi ditunda.

