# Design System — Upaznet Helpdesk

**Versi:** 2.0 · **Tanggal:** 25 September 2026 · **Status:** baseline desain prototype diselaraskan P0.10  
Pendamping [PRD v2.1](PRD.md). Pilihan visual berikut adalah keputusan desain untuk implementasi awal, bukan identitas brand resmi ISP. Semua data contoh fiktif.

> **Ringkasan Pembaruan v2.0:**  
> Menyelaraskan arah desain dengan identitas navy (`#003C71`), aksen brand hijau (`#00A651`), tombol aksi terkalibrasi kontras (`#007A3D`), pemisahan token warna ke dalam dua lapisan (palet dasar vs pemetaan semantik), tipografi Geist Sans dan Geist Mono, hierarki 10px–24px (menghilangkan micro-tight 9px), pemakaian komponen standar, serta matriks perhitungan kontras WCAG 2.2 AA sebelum implementasi task P0.10.

---

## 1. Prinsip

1. **Inbox lebih dulu:** target landing setelah login adalah antrean percakapan/komplain. Custpanel tetap dipakai untuk tiket, delegasi teknisi dan finance; dashboard ini menjadi workspace komunikasi dan pemeriksaan.
2. **Bukti dekat keputusan:** status selalu disertai sumber, waktu observasi, dan alasan ringkas.
3. **Satu tindakan utama:** “Mulai tangani”, “Kirim balasan”, atau “Tandai pulih” sesuai konteks.
4. **Jangan menyamakan status:** online, episode pulih, dan pesan terkirim adalah tiga hal berbeda.
5. **Hemat perhatian:** latar terang, teks kontras tinggi, warna fungsional untuk status/aksi, tanpa gradient dekoratif atau efek visual berlebihan (*no AI slop*).
6. **Jujur tentang simulasi:** badge “Prototype · Data dummy” persisten; teks pelanggan memiliki prefix simulasi.

---

## 2. Navigasi dan shell

| Menu | Route referensi | Isi |
|---|---|---|
| Inbox / Antrean | /dashboard/complaints | Target landing, percakapan masuk, episode, detail chat dan balasan |
| Gangguan | /dashboard/incidents | Tab “Otomatis” dan “Manual”, riwayat dan lifecycle |
| Pelanggan (sekunder) | /dashboard/customers | Pencarian/direktori pendukung seluruh pelanggan, layanan dan ODP/ODC |
| Template | /dashboard/templates | Default/per-incident, version dan preview |
| Log & kesehatan | /dashboard/logs | Decision log, audit, outbound, pending jobs |
| Pengaturan | /dashboard/settings | Mode, allowlist, simulasi dan kontrol automation |

- **Dimensi Shell Desktop:** sidebar 216 px, topbar 64 px, area konten mengambil sisa layar. Tidak memakai max-width sempit untuk tabel operasional.
- **Topbar:** judul halaman, “Data dummy”, mode automation, keadaan koneksi, profil staf. Emergency stop tersedia melalui kontrol mode; tidak memenuhi semua halaman dengan tombol bahaya.
- **Status Koneksi Shell:** memuat session expiry, offline/polling error, dan pending count. Status “terhubung” hanya bila pemeriksaan berhasil, bukan default.
- **Batasan Proyek Eksternal:** tidak ada navigasi, tab, ataupun label vendor konfigurasi OLT atau proyek terpisah *Upaznet Config & Command Generator*.

---

## 3. Token warna dalam dua lapisan

Token warna disusun ke dalam dua lapisan arsitektur terpisah:
1. **Palet Dasar (Primitives):** Palet nilai warna heksadesimal mentah yang mendefinisikan warna netral, identitas brand, dan permukaan.
2. **Pemetaan Semantik (Semantic Tokens):** Token fungsional yang mereferensikan palet dasar berdasarkan peran spesifik UI (teks, aksi, kontrol, batas, dan fokus). Pemisahan ini memastikan identitas brand (`brand.primary`) tidak tertukar dengan tombol aksi interaktif (`action.primary`).

### 3.1 Palet dasar (Primitives)

| Token Dasar | Nilai Hex | Peran & Deskripsi |
|---|---|---|
| `primary` | `#003C71` | Navy identitas Upaznet, topbar/sidebar, varian panel |
| `accent` | `#00A651` | Hijau aksen brand resmi; BUKAN untuk tombol teks putih normal |
| `accent-hover` | `#008C44` | Hover aksen brand |
| `neutral-bg` | `#FBFCFD` | Latar belakang kanvas aplikasi |
| `surface` | `#FFFFFF` | Permukaan kartu, panel, tabel, modal dialog |
| `ink` | `#1E293B` | Teks utama dengan tingkat kontras tertinggi (Slate 800) |
| `muted` | `#64748B` | Teks sekunder/muted, border kontrol (Slate 500) |
| `border` | `#E2E8F0` | Border subtle, pemisah dekoratif tabel (Slate 200) |
| `border-strong` | `#CBD5E1` | Border tegas, divider pembagi kolom (Slate 300) |
| `field-bg` | `#F8FAFC` | Latar kontrol input form & textarea (Slate 50) |
| `rail-bg` | `#F1F5F9` | Latar header netral, panel navigasi sekunder (Slate 100) |
| `panel-text` | `#DBEAFE` | Teks sekunder/keterangan pada panel navy (Blue 100) |
| `panel-border` | `#1E3A8A` | Border dekoratif varian panel navy (Blue 900) |
| `panel-on-navy` | `#FFFFFF` | Teks putih/judul utama pada panel navy |

### 3.2 Pemetaan semantik (Semantic Tokens)

| Token Semantik | Nilai Hex / Mapping | Penggunaan & Ketentuan Kontras |
|---|---|---|
| `brand.primary` | `#003C71` | Identitas korporat Upaznet, shell desktop |
| `brand.accent` | `#00A651` | Aksen grafis brand visual; dilarang untuk latar tombol teks putih normal |
| `action.primary` | `#007A3D` | Latar tombol aksi utama; terkalibrasi kontras 5,45:1 terhadap teks putih |
| `action.primary.hover` | `#006633` | Hover tombol aksi utama; kontras 7,12:1 terhadap teks putih |
| `action.on-primary` | `#FFFFFF` | Warna teks di atas tombol aksi utama |
| `text.primary` | `#1E293B` | Judul, isi utama tabel, dan chat bubble |
| `text.secondary` | `#475569` | Keterangan, timestamp, dan subtitle |
| `text.muted` | `#64748B` | Teks pelengkap; HANYA pada latar `surface`, `field-bg`, atau `neutral-bg` |
| `border.subtle` | `#E2E8F0` | Garis pemisah baris tabel dan kartu |
| `border.strong` | `#CBD5E1` | Batas luar tabel atau pemisah kolom antrean |
| `border.control` | `#64748B` | Batas kontrol input yang perlu dikenali (memenuhi WCAG non-teks 3:1) |
| `focus.ring` | `#2563EB` | Indikator fokus keyboard (ring 2px + offset 2px); efektif pada latar terang |

### 3.3 Token status semantik

| Token Status | Teks (fg) | Latar (bg) | Rasio Kontras | Definisi Penggunaan |
|---|---|---|---|---|
| `success` | `#166534` | `#F0FDF4` | 6,81:1 (PASS) | Perangkat online / episode pulih |
| `warning` | `#92400E` | `#FFFBEB` | 6,84:1 (PASS) | Data basi, unknown, butuh review staf |
| `danger` | `#B91C1C` | `#FEF2F2` | 5,91:1 (PASS) | Sinyal hilang (LOS), gagal kirim, force-close |
| `info` | `#1E40AF` | `#EFF6FF` | 8,01:1 (PASS) | Episode baru, sedang diproses, pengumuman |
| `neutral` | `#475569` | `#F1F5F9` | 6,92:1 (PASS) | Arsip, episode ditutup (closed), mode shadow |

### 3.4 Aturan khusus & batasan penggunaan warna

1. **Pemisahan `brand.primary` vs `action.primary`:**  
   Identitas navy (`#003C71`) digunakan untuk header shell dan aksen identitas korporat. Tombol aksi operasional ("Mulai tangani", "Kirim ke Telegram") secara konsisten menggunakan hijau aksi terkalibrasi (`#007A3D`), bukan navy.
2. **Larangan Penggunaan `#00A651` & `#008C44` pada Tombol Teks Putih:**  
   Warna hijau `#00A651` (aksen brand) dan `#008C44` (aksen hover) memiliki rasio kontras 3,19:1 dan 4,34:1 terhadap teks putih, sehingga gagal memenuhi ambang batas minimum WCAG AA (4,5:1 untuk teks normal). Oleh karena itu, keduanya dilarang keras digunakan sebagai latar tombol dengan teks putih. Tombol aksi wajib memakai `action.primary` (`#007A3D`) yang menghasilkan rasio 5,45:1.
3. **Pembedaan Makna Status dari Aksen Brand:**  
   Warna hijau brand Upaznet bukanlah bukti bahwa jaringan atau koneksi pelanggan sehat. Status operasional wajib mematuhi pembedaan:
   - "Perangkat online" (observasi ONU) bukan bukti internet normal.
   - "Episode pulih" (RESOLVED) adalah status penanganan tiket masalah, bukan status fisik perangkat.
   - "Pesan terkirim" (sent) adalah tanda terima channel adapter Telegram, bukan bukti pesan telah dibaca pelanggan.
4. **Status Wajib Teks:**  
   Warna tidak pernah menjadi satu-satunya pembawa informasi. Setiap StatusBadge wajib menyertakan label teks eksplisit dan ikon semantik pendukung.

---

## 4. Tipografi dan hierarki

### 4.1 Definisi font

- **Sans (Antarmuka Operasional):** `Geist, Arial, sans-serif`.  
  Digunakan untuk seluruh antarmuka aplikasi, navigasi, tabel komplain, bubble chat pelanggan, form input, dan teks tombol.
- **Mono (Data Teknis & Kode):** `Geist Mono, ui-monospace, monospace`.  
  Digunakan secara ketat HANYA untuk ID komplain (`C-001`), kode ODP/ODC (`ODP-DUMMY-01`), error code, payload teknis, dan catatan audit transaksi. Teks nama pelanggan dan percakapan chat tetap menggunakan Sans.

> **Catatan Kebutuhan Font (P0.10):**  
> Pada saat implementasi task P0.10, font Geist dan Geist Mono harus benar-benar dimuat ke dalam aplikasi (misalnya melalui package `@next/font` atau `next/font/google` di Next.js App Router) dengan fallback yang terkonfigurasi. Deklarasi CSS `font-family` semata tanpa pemuatan font tidak mencukupi acceptance criteria P0.10.

### 4.2 Hierarki ukuran dan bobot

| Role | Ukuran (px) | Weight | Line Height | Letter Spacing | Penggunaan Utama |
|---|---|---|---|---|---|
| `display` | 24px | 700 (Bold) | 1.2 (28.8px) | normal | Judul halaman utama shell/topbar |
| `headline` | 16px | 700 (Bold) | 1.4 (22.4px) | normal | Judul panel, section header, kartu insiden |
| `body` | 14px | 400 (Regular) | 1.5 (21.0px) | normal | Teks pesan chat, deskripsi komplain, baris tabel |
| `action` | 14px | 600 (Semibold) | 1.5 (21.0px) | normal | Teks tombol utama, tombol outline, tab navigasi |
| `label` | 12px | 600 (Semibold) | 1.33 (16.0px) | normal | Label form input, header kolom tabel, StatusBadge |
| `metadata` | 12px | 400 (Regular) | 1.5 (18.0px) | normal | Timestamp absolut/relatif, ID channel, helper text |
| `mono` | 13px | 400 (Regular) | 1.625 (21.1px) | normal | ID episode, error code, log teknis transaksi |
| `micro` | 10px | 700 (Bold) | 1.25 (12.5px) | 0.1em | Penanda opsional / pill badge ringkas |

### 4.3 Aturan tipografi

- **Uppercase & Letter-Spacing:**  
  Uppercase dengan `letter-spacing: 0.05em` hanya diperbolehkan untuk label kelompok pendek (misalnya: "STATUS", "AKSI").
- **Aturan Micro (10px):**  
  Micro boleh memakai uppercase dan `letter-spacing: 0.1em` untuk penanda tambahan (misalnya label tipe fixture "MOCK"). Dilarang menggunakan micro untuk informasi operasional krusial.
- **Larangan Ukuran 9px:**  
  Dilarang keras menyediakan varian `micro-tight` (9px) untuk antarmuka operasional apa pun karena tidak terbaca dengan andal pada layar standar operator.
- **Casing Kontrol & Tombol:**  
  Label form input, tombol aksi, navigasi, dan status badge menggunakan penulisan kata biasa (Sentence case atau Title case), bukan huruf kapital semua.
- **Batas Keterbacaan Informasi Penting:**  
  Informasi penting seperti waktu observasi, status jaringan, nomor kontak, dan pesan kesalahan wajib berukuran **minimal 12px**.

---

## 5. Semantik status

| Domain | Label UI | Warna Token + Ikon |
|---|---|---|
| Episode NEW | Baru | Biru (`info`) + inbox |
| IN_PROGRESS | Ditangani | Biru (`info`) + user |
| RESOLVED | Pulih | Hijau (`success`) + check |
| CLOSED | Ditutup | Abu (`neutral`) + archive |
| ONU online | Perangkat online | Hijau (`success`) + check-circle |
| ONU LOS | Sinyal hilang (LOS) | Merah (`danger`) + alert |
| Unknown | Belum diketahui | Amber (`warning`) + help |
| Stale | Data basi | Amber (`warning`) + clock |
| Area evidence | Indikasi area | Amber (`warning`) + network; tampilkan rasio/cakupan |
| Manual ACTIVE | Incident aktif | Merah (`danger`) + alert; tidak disamakan dengan otomatis terkonfirmasi |
| SHADOW | Shadow · tanpa balasan otomatis | Abu (`neutral`) + eye |
| LOS_AND_GENERIC | Gangguan + generik | Biru (`info`) + message |
| FULL | Semua rule aktif | Biru (`info`) + check |
| Attempt pending/sending | Menunggu / Mengirim | Abu/biru + clock |
| Attempt sent | Diterima Telegram | Check; tidak menulis “dibaca” |
| Attempt failed | Gagal dikirim | Merah (`danger`) + x |
| Attempt unknown | Hasil kirim belum pasti | Amber (`warning`) + help; tanpa tombol retry langsung |

---

## 6. Pemakaian komponen

### 6.1 Tombol (Button)
- **Tombol Utama (Primary):**  
  Menggunakan latar `action.primary` (`#007A3D`), teks `action.on-primary` (`#FFFFFF`), dengan hover `action.primary.hover` (`#006633`). Digunakan untuk aksi positif terarah (misal: "Mulai tangani", "Kirim ke Telegram").
- **Tombol Sekunder / Outline:**  
  Menggunakan latar `surface` (`#FFFFFF`), teks `ink` (`#1E293B`) atau navy (`#003C71`), dengan batas kontrol `border.control` (`#64748B`) agar batas kontrol dapat dikenali dengan jelas.
- **Tombol Bahaya (Danger):**  
  Menggunakan teks putih pada latar `danger.text` (`#B91C1C`) hanya untuk aksi destruktif terkonfirmasi (Force-close insiden).

### 6.2 Kontrol form (Input & Textarea)
- Menggunakan latar `field-bg` (`#F8FAFC`), teks `ink` (`#1E293B`), teks petunjuk `text.muted` (`#64748B`), dan batas `border.control` (`#64748B`).
- Label field wajib terlihat secara permanen di luar input; placeholder tidak boleh menggantikan posisi label.
- Tinggi input standar: 40 px pada desktop, 44 px pada mode sentuh/mobile.

### 6.3 Varian panel navy
- Menggunakan latar `primary` (`#003C71`), judul `panel-on-navy` (`#FFFFFF`), keterangan `panel-text` (`#DBEAFE`), dan pembatas `panel-border` (`#1E3A8A`).
- **Batasan Varian:** Panel navy murni merupakan varian visual kontras (misal ringkasan darurat atau kartu informasi status topbar). Dilarang keras menambahkan fitur terminal/CLI atau simulator command generator pada panel ini.
- **Larangan `panel-border`:** Token `panel-border` (`#1E3A8A`) dilarang diterapkan secara universal sebagai batas kontrol input atau fokus keyboard karena kontrasnya tidak memenuhi syarat pada latar terang.

### 6.4 Spacing, radius, dan motion (Tetap dari baseline)
- **Spacing Scale:** 4, 8, 12, 16, 24, 32, 48 px. Padding panel 16–24 px, gap komponen 12–16 px.
- **Border Radius:** input dan button 6 px, card dan dialog 10 px, badge berbentuk pill.
- **Shadow:** Hanya untuk floating menu/dialog; panel dashboard standar menggunakan border tipis.
- **Motion:** Durasi feedback 120–180 ms; wajib menghormati `prefers-reduced-motion`. Tidak ada animasi pulse permanen untuk indikator koneksi sehat.

---

## 7. Validasi keterbacaan dan matriks kontras WCAG AA

Perhitungan rasio kontras berikut didasarkan pada rumus luminansi relatif standar WCAG 2.2 (`(L1 + 0.05) / (L2 + 0.05)`).  
Standar kepatuhan:
- **WCAG AA Teks Normal (< 18px atau < 14px bold):** Minimal **4,5:1**.
- **WCAG AA Teks Besar (≥ 18px atau ≥ 14px bold) & Kontrol Non-Teks:** Minimal **3,0:1**.

### 7.1 Tabel hasil perhitungan kontras aktual

| Pasangan Elemen | Warna Foreground | Warna Background | Rasio Kontras | Status Normal (≥4.5:1) | Status Large / Non-text (≥3:1) | Batas Penggunaan / Catatan |
|---|---|---|---|---|---|---|
| **Tombol Aksi Utama** | `#FFFFFF` (`action.on-primary`) | `#007A3D` (`action.primary`) | **5,45:1** | **PASS** | **PASS** | Standar baku tombol aksi utama |
| **Tombol Aksi Hover** | `#FFFFFF` (`action.on-primary`) | `#006633` (`action.primary.hover`) | **7,12:1** | **PASS** | **PASS** | State hover tombol aksi |
| *Brand Accent pada Putih (Uji)* | `#FFFFFF` | `#00A651` (`brand.accent`) | **3,19:1** | **FAIL** | **PASS** | **DILARANG** untuk teks normal tombol; hanya aksen grafis |
| *Brand Accent Hover pada Putih (Uji)* | `#FFFFFF` | `#008C44` (`accent-hover`) | **4,34:1** | **FAIL** | **PASS** | **DILARANG** untuk teks normal tombol |
| **Teks Utama pada Surface** | `#1E293B` (`text.primary`) | `#FFFFFF` (`surface`) | **14,63:1** | **PASS** | **PASS** | Kontras sangat tajam |
| **Teks Utama pada Field** | `#1E293B` (`text.primary`) | `#F8FAFC` (`field-bg`) | **13,98:1** | **PASS** | **PASS** | Teks isi form input |
| **Teks Utama pada Rail** | `#1E293B` (`text.primary`) | `#F1F5F9` (`rail-bg`) | **13,35:1** | **PASS** | **PASS** | Teks header rail/sidebar |
| **Teks Utama pada Kanvas** | `#1E293B` (`text.primary`) | `#FBFCFD` (`neutral-bg`) | **14,24:1** | **PASS** | **PASS** | Konten kanvas aplikasi |
| **Teks Sekunder pada Surface** | `#475569` (`text.secondary`) | `#FFFFFF` (`surface`) | **7,58:1** | **PASS** | **PASS** | Keterangan, timestamp detail |
| **Teks Sekunder pada Field** | `#475569` (`text.secondary`) | `#F8FAFC` (`field-bg`) | **7,24:1** | **PASS** | **PASS** | Helper text di bawah input |
| **Teks Sekunder pada Rail** | `#475569` (`text.secondary`) | `#F1F5F9` (`rail-bg`) | **6,92:1** | **PASS** | **PASS** | Label kolom header tabel |
| **Teks Sekunder pada Kanvas** | `#475569` (`text.secondary`) | `#FBFCFD` (`neutral-bg`) | **7,38:1** | **PASS** | **PASS** | Subtitle halaman |
| **Teks Muted pada Surface** | `#64748B` (`text.muted`) | `#FFFFFF` (`surface`) | **4,76:1** | **PASS** | **PASS** | Metadata sekunder |
| **Teks Muted pada Field** | `#64748B` (`text.muted`) | `#F8FAFC` (`field-bg`) | **4,55:1** | **PASS** | **PASS** | Teks placeholder input |
| *Teks Muted pada Rail* | `#64748B` (`text.muted`) | `#F1F5F9` (`rail-bg`) | **4,34:1** | **FAIL** | **PASS** | **DILARANG** untuk teks normal pada rail-bg; gunakan `text.secondary` |
| **Teks Muted pada Kanvas** | `#64748B` (`text.muted`) | `#FBFCFD` (`neutral-bg`) | **4,63:1** | **PASS** | **PASS** | Footer / teks pelengkap |
| **Judul Panel Navy** | `#FFFFFF` (`panel-on-navy`) | `#003C71` (`primary`) | **11,14:1** | **PASS** | **PASS** | Judul pada varian panel navy |
| **Keterangan Panel Navy** | `#DBEAFE` (`panel-text`) | `#003C71` (`primary`) | **9,13:1** | **PASS** | **PASS** | Keterangan pada panel navy |
| **Border Kontrol pada Surface** | `#64748B` (`border.control`) | `#FFFFFF` (`surface`) | **4,76:1** | n/a (non-teks) | **PASS** (≥3:1) | Batas input form pada kartu |
| **Border Kontrol pada Field** | `#64748B` (`border.control`) | `#F8FAFC` (`field-bg`) | **4,55:1** | n/a (non-teks) | **PASS** (≥3:1) | Batas input pada background field |
| **Border Kontrol pada Rail** | `#64748B` (`border.control`) | `#F1F5F9` (`rail-bg`) | **4,34:1** | n/a (non-teks) | **PASS** (≥3:1) | Kontrol pada panel rail |
| **Focus Ring pada Surface** | `#2563EB` (`focus.ring`) | `#FFFFFF` (`surface`) | **5,17:1** | n/a (non-teks) | **PASS** (≥3:1) | Indikator fokus tombol/link |
| **Focus Ring pada Field** | `#2563EB` (`focus.ring`) | `#F8FAFC` (`field-bg`) | **4,94:1** | n/a (non-teks) | **PASS** (≥3:1) | Indikator fokus input form |
| **Focus Ring pada Rail** | `#2563EB` (`focus.ring`) | `#F1F5F9` (`rail-bg`) | **4,72:1** | n/a (non-teks) | **PASS** (≥3:1) | Fokus navigasi rail |
| *Focus Ring pada Navy* | `#2563EB` (`focus.ring`) | `#003C71` (`primary`) | **2,16:1** | n/a (non-teks) | **FAIL** (<3:1) | **DILARANG** ring biru pada navy; wajib gunakan ring putih / `#DBEAFE` |
| **StatusBadge Success** | `#166534` (`success.text`) | `#F0FDF4` (`success.bg`) | **6,81:1** | **PASS** | **PASS** | Pulih / online |
| **StatusBadge Warning** | `#92400E` (`warning.text`) | `#FFFBEB` (`warning.bg`) | **6,84:1** | **PASS** | **PASS** | Basi / unknown / butuh review |
| **StatusBadge Danger** | `#B91C1C` (`danger.text`) | `#FEF2F2` (`danger.bg`) | **5,91:1** | **PASS** | **PASS** | LOS / gagal kirim |
| **StatusBadge Info** | `#1E40AF` (`info.text`) | `#EFF6FF` (`info.bg`) | **8,01:1** | **PASS** | **PASS** | Baru / proses / info |
| **StatusBadge Neutral** | `#475569` (`neutral.text`) | `#F1F5F9` (`neutral.bg`) | **6,92:1** | **PASS** | **PASS** | Arsip / closed |

### 7.2 Pasangan dengan pembatasan penggunaan khusus

1. **`brand.accent` (`#00A651`) dan `accent-hover` (`#008C44`) pada Teks Putih:**  
   Kedua warna ini tidak boleh digunakan sebagai latar belakang tombol dengan teks putih. Rasio 3,19:1 dan 4,34:1 hanya memenuhi syarat teks besar (≥18px) atau elemen grafis non-teks.
2. **`text.muted` (`#64748B`) pada `rail-bg` (`#F1F5F9`):**  
   Rasio kontras berada di 4,34:1 (kurang dari 4,5:1). Pada area sidebar atau header rail, teks sekunder wajib menggunakan `text.secondary` (`#475569`, rasio 6,92:1).
3. **`focus.ring` (`#2563EB`) pada Navy (`#003C71`):**  
   Rasio kontras hanya 2,16:1, sehingga ring biru tidak terlihat dengan jelas di atas latar navy. Komponen interaktif yang berada di dalam panel navy wajib menggunakan ring fokus putih (`#FFFFFF`) atau biru es terang (`#DBEAFE`).
4. **Catatan Validasi Teknis:**  
   Pemeriksaan nilai warna heksadesimal di atas adalah verifikasi matematis pasangan warna token. Hal ini **bukan** pengganti pengujian aksesibilitas antarmuka menyeluruh (seperti pengujian screen reader, tab ordering, touch target sizing, dan rendering nyata di browser). UI tidak dapat diklaim telah lolos WCAG hanya karena tabel token ini telah diverifikasi.

---

## 8. Antrean dan detail komplain

### 8.1 Wireframe desktop
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
*Sketsa komposisi antarmuka, bukan screenshot implementasi.*

### 8.2 Perilaku utama
- **Daftar Default:** episode belum CLOSED, NEW/unread di atas, lalu waktu tunggu terlama. Staf boleh mengubah sorting; polling tidak memindahkan item yang sedang dipilih saat mengetik.
- **Filter:** status, unread, kategori, jenis bukti, send failure, manual incident/event. “Data basi” berbeda dari “LOS”.
- **Row:** episode ID (Geist Mono), nama/ID masked bila unresolved, preview pesan, badge kondisi, unread count, last inbound; timestamp lengkap melalui tooltip/detail.
- **Detail:** nomor episode/status, layanan, channel, riwayat kronologis; label jelas “Pelanggan”, “Automation”, “Akbar (staf)” dan “Catatan internal”.
- **Composer:** tab “Balasan ke pelanggan” default, tab “Catatan internal” berbeda latar dan label. Tombol berubah menjadi “Kirim ke Telegram” (`action.primary`) atau “Simpan catatan”. Channel penerima selalu terlihat.
- **Keyboard Shortcuts:** Enter membuat baris baru; Ctrl/Cmd+Enter mengirim bila valid. Tidak mengirim pada Enter biasa. Kosong/whitespace → tombol disabled, alasan inline.
- **Draft Persistence:** Draft tidak hilang saat polling/error/network reconnect. Jangan menyimpan PII draft ke penyimpanan browser permanen pada prototype; session expiry mempertahankan tampilan draft selama halaman masih terbuka.
- **Idempotensi Pengiriman:** Double-click send → request ID sama; tampilkan “Mengirim”. Sukses tampil di timeline; gagal tampil inline dengan konteks. Status unknown tidak menawarkan retry cepat.
- **Handoff Staf:** “Mulai tangani” menghentikan automation pending untuk episode. Jika send sudah in-flight, tampilkan informasi itu; jangan memberi jaminan pesan sudah dibatalkan.
- **Lifecycle Actions:** “Tandai pulih” meminta catatan singkat; “Tutup episode” hanya dari RESOLVED. “Buka kembali” mempertahankan ID. “Pisahkan masalah” ada di menu sekunder, dengan penjelasan episode baru.
- **Sidebar Pemeriksaan:** status ONU, upstream, ODP/ODC, waktu observasi dan waktu cek, sumber MOCK, coverage, incident/event, template/reason. Gunakan safe reason code; credential/stack trace tidak ditampilkan atau dikirim ke pelanggan.
- **Cek Ulang:** “Cek ulang” memperbarui assessment untuk staf; label penjelas “Tidak mengirim balasan otomatis baru”. Jangan diam-diam mengirim saat staf memeriksa ulang.

### 8.3 Batas integrasi dengan Custpanel
- Episode/status percakapan bukan tiket teknisi. Pembuatan tiket dan delegasi dilakukan staf secara manual di Custpanel.
- Bukti jaringan ditampilkan dekat percakapan untuk membantu penulisan tiket; tidak ada tombol yang mengesankan sinkronisasi Custpanel sudah tersedia secara otomatis.

---

## 9. Gangguan dan incident manual

- **Tab Default “Indikasi otomatis”:** event/scope, bukti, observed_at, coverage, jumlah episode terkait. Tidak menulis “kabel putus” berdasarkan LOS.
- **Tab “Incident manual”:** maksimal satu ACTIVE, daftar RESOLVED/CLOSED, form pembuatan GENERAL/AREA_SPECIFIC, description, affected ODP/ODC, estimasi text, preview template.
- **Penjelasan Scope:** GENERAL menampilkan penjelasan “Pemberitahuan umum untuk inbound, tanpa pemeriksaan wilayah”. AREA_SPECIFIC membutuhkan affected ID.
- **Aksi Transisi:** Resolve/reopen/normal close memakai label tindakan spesifik. Force-close ditempatkan pada menu sekunder danger, dialog alasan wajib.
- **Dialog Force-Close:** incident ID, dampak menghentikan override, field alasan (wajib diisi non-empty), tombol bahaya “Force-close incident”.
- **Guard Konflik:** Jika incident ACTIVE lain sudah ada, form menyajikan konflik dan tautan ke incident tersebut; tidak menawarkan bypass paksa.
- **Deteksi Versi:** Saat version conflict, tampilkan “Data sudah diubah staf lain. Muat versi terbaru”; jangan overwrite diam-diam.
- **Integritas Debounce:** Mengubah area/template tidak memicu pengiriman ulang ke pelanggan yang sudah dibalas sebelumnya.

---

## 10. Template, log, dan simulasi

- **Template:** key/scope/version, editor plaintext, daftar placeholder yang diizinkan, contoh render fiktif. Simpan membuat versi baru; riwayat dapat ditinjau. Preview bukan pengiriman langsung.
- **Log & Kesehatan:** tab Keputusan / Pengiriman / Aktivitas / Pekerjaan. Filter correlation/episode/incident, waktu, reason. Ringkasan terpisah: error provider, gagal outbound, hasil unknown, job tertunda.
- **Simulasi:** skenario normal, LOS individual, LOS area, upstream down+ONU online, stale/timeout, identitas unknown, dan recovery. Skenario dipilih per GET pemeriksaan dan tidak mengubah status global. Waktu observasi hanya diperbarui lewat refresh fixture lokal eksplisit. Tidak menamai action “Putuskan jaringan”.
- **Mode Kontrol:** ringkasan apa yang dikirim tiap mode (SHADOW, LOS_AND_GENERIC, FULL), dropdown + aksi Terapkan, audit log aktor/waktu. Beralih dari shadow ke live tidak mereplay backlog pesan lama. Emergency stop mematikan fungsi otomatisasi pesan tanpa mematikan antrean staf.

---

## 11. Komponen wajib

| Komponen | Kontrak state/perilaku |
|---|---|
| `Button` | primary (`action.primary`), secondary/outline, ghost, danger; loading mempertahankan lebar; disabled dengan alasan eksplisit |
| `Input` / `Textarea` / `Select` | label nyata terlihat, hint, required, error inline; placeholder tidak menggantikan label; latar `field-bg` |
| `StatusBadge` | domain semantik + label teks + ikon; tidak menerima warna sembarang per halaman |
| `DataTable` / `List` | loading skeleton, empty, filtered-empty, error, pagination 25 baris; navigasi selection keyboard |
| `Tabs` | label jumlah opsional, aria selected, keyboard arrow navigation |
| `EvidenceCard` | status/source/observed_at/checked_at/coverage dan safe reason; status unknown bukan sukses |
| `MessageItem` | actor/channel/time/text/delivery; catatan internal memiliki visual pembeda dari bubble pelanggan |
| `ReplyComposer` | destination tertera, draft persistence, state sending, request ID idempotency; dilarang auto-send |
| `AlertBanner` | persisten untuk peringatan offline/shadow/unknown send; toast hanya feedback tambahan |
| `Dialog` / `Drawer` | fokus terperangkap (trap focus), Escape untuk batal, kembali ke pemicu; alasan destructive bila relevan |
| `EmptyState` | satu penjelasan + satu aksi yang relevan, tanpa ilustrasi dekoratif wajib |
| `AuditEntry` | actor/action/time/before-after; read-only |
| `Pagination` | 25 baris default, label total/filter; tidak infinite scroll pada log prototype |

---

## 12. Loading, kosong, dan kegagalan

| Kondisi | UI dan tindakan yang ditampilkan |
|---|---|
| Belum ada komplain | “Belum ada komplain. Kirim pesan dari akun tester ke bot Telegram.” |
| Filter kosong | “Tidak ada hasil untuk filter ini.” + Aksi Reset filter |
| Data pemeriksaan belum tersedia | “Belum diperiksa”, jangan menampilkan online |
| Provider gagal | “Kondisi jaringan belum dapat diperiksa”; alasan ringkas + timestamp |
| Dashboard offline / polling gagal | Banner “Pembaruan terhenti”; pertahankan data terakhir dengan timestamp |
| Gagal menyimpan data | Field/draft dipertahankan; jangan menampilkan toast sukses palsu |
| Hasil kirim unknown | Banner pada pesan/episode, arahkan pemeriksaan manual; dilarang retry buta otomatis |
| Sesi kedaluwarsa | Dialog login ulang; blokir aksi mutasi, jangan redirect tanpa konfirmasi draft |
| Loading tabel / detail | Skeleton sesuai bentuk konten dengan `aria-busy="true"`; hindari spinner full-page shell |

---

## 13. Responsive dan accessibility

- **Breakpoints Desktop & Mobile:**
  - `≥1440 px`: sidebar (216 px) + daftar antrean (300 px) + percakapan fleksibel (min 420 px) + evidence (280 px).
  - `1024–1439 px`: sidebar ringkas (72 px), daftar (280 px), percakapan; evidence beralih ke drawer. Total lebar tidak menimbulkan scroll horizontal halaman.
  - `768–1023 px`: navigasi drawer, daftar/detail dua tampilan bergantian; evidence menjadi tab dalam detail.
  - `<768 px`: satu kolom responsif; tap row membuka detail; tombol kembali mempertahankan posisi filter dan scroll. Composer tidak boleh menutupi pesan terakhir saat virtual keyboard aktif.
- **Aksesibilitas (WCAG 2.2 AA):**
  - Kontras teks biasa ≥ 4,5:1; teks besar ≥ 3,0:1; indikator kontrol/fokus non-teks ≥ 3,0:1 terhadap latar tetangga.
  - Ukuran target sentuh interaktif 40–44 px.
  - Semua aksi dapat dijangkau navigasi keyboard, urutan tab mengikuti visual, indikator fokus visible (`focus.ring` `#2563EB` 2px offset 2px).
  - Pesan masuk baru diumumkan via `aria-live="polite"` tanpa memindahkan fokus pengguna secara paksa.
  - Form error terhubung programatik (`aria-describedby`); teks tanggal dapat dibaca screen reader secara lengkap.
  - Zoom 200% tidak merusak layout atau menyembunyikan aksi utama.
  - Dukungan preferensi `prefers-reduced-motion`.

---

## 14. Copy dan konsistensi bahasa

- Gunakan istilah **“Perangkat online”**, bukan “Internet normal”; **“Indikasi gangguan”**, bukan diagnosis fisik yang belum terbukti.
- **“Diterima Telegram”** berarti provider Bot API menerima payload; tidak berarti pesan sudah dibaca oleh pelanggan.
- **“Masuk antrean”** hanya bila episode/inbox telah tersimpan di database. **“Sedang ditangani”** hanya bila staf telah mengklik aksi mulai.
- Format penulisan waktu absolut: `19 Sep 2026, 09.41 WIB`; waktu relatif ("2 menit lalu") wajib dilengkapi tooltip waktu absolut.
- Terminologi konsisten: *komplain/episode* untuk pelanggan, *incident manual* untuk override staf, *indikasi/event* untuk bukti otomatis provider.
- Data simulasi selalu diberi penanda jelas tanpa memenuhi setiap bubble chat dengan detail implementasi.

---

## 15. Checklist siap implementasi token (P0.10)

Dokumentasi ini adalah spesifikasi desain yang menjadi acuan langsung untuk pengerjaan task P0.10:
- [ ] Buat file token terpusat (`styles/tokens.css` atau konfigurasi CSS Variables pada `app/globals.css`) mendefinisikan seluruh variabel Layer 1 (palet dasar) dan Layer 2 (pemetaan semantik).
- [ ] Konfigurasikan pemuatan font Geist Sans dan Geist Mono di `app/layout.tsx` (misal via `next/font/google` atau font lokal) beserta fallback variabel CSS.
- [ ] Pastikan seluruh token status semantik (`success`, `warning`, `danger`, `info`, `neutral`) tersedia dalam variabel CSS.
- [ ] Terapkan aturan batas kontras (larangan `#00A651` untuk tombol teks putih, larangan `#64748B` pada rail-bg, serta penyesuaian focus ring navy).
- [ ] Verifikasi bahwa tidak ada kode visual lama (`#1D4ED8` atau `Segoe UI`) yang tersisa di stylesheet global.
- [ ] Lakukan build lokal dan review visual nyata untuk membuktikan token telah aktif sebelum menutup task P0.10.
