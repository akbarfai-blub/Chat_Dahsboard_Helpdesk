# P0.10 — Token UI Terpusat dan Pemuatan Font (Review & Penutupan Bukti)

**Tanggal:** 26 September 2026 · **Status:** Selesai (Done)  
**Acuan:** [docs/DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) v2.0 · [docs/decision-log.md](decision-log.md) D78 & D79 · [docs/PRD.md](PRD.md) §14

---

## 1. Ringkasan Implementasi dan Perbaikan Terarah

P0.10 menyediakan token desain terpusat dua lapisan yang terintegrasi langsung dengan Tailwind CSS v4, pemuatan nyata font Geist dan Geist Mono melalui `next/font/google` di Next.js App Router, perbaikan adaptasi tinggi kontrol sentuh dan viewport sempit, serta pembuktian empiris komprehensif pada browser desktop dan viewport sempit.

### Temuan Review → Perbaikan Terarah → Bukti

1. **Temuan:** Kontrol form (input email, password, tombol Masuk) pada viewport sempit (<640px) awalnya tetap berukuran minimum desktop 40px, belum memanfaatkan token kontrol 44px (`--control-height-touch`).
2. **Perbaikan:**
   - Menambahkan aturan media query coarse-pointer di `app/globals.css`:
     ```css
     @media (pointer: coarse) {
       :root {
         --control-height-default: var(--control-height-touch);
       }
     }
     ```
   - Memperbarui elemen input dan tombol di `app/login/page.tsx` menggunakan kelas utilitas responsif:
     `min-h-[var(--control-height-touch)] sm:min-h-[var(--control-height-default)]`
     Kode mengimplementasikan dukungan ganda: breakpoint lebar layar (<640px) dan aturan `@media (pointer: coarse)`. Pada viewport sempit (<640px / breakpoint proyek), kontrol secara otomatis menggunakan ukuran minimal 44px (`--control-height-touch`), sedangkan pada desktop dengan pointer presisi (≥640px) tetap 40px. Jika perangkat menggunakan pointer kasar (layar sentuh), aturan `@media (pointer: coarse)` menyelaraskan kontrol desktop ke 44px (kemampuan implementasi ini dibedakan dari cakupan pengujian viewport).
3. **Bukti:** Pengukuran runtime yang dilaporkan eksekutor menunjukkan tinggi kontrol 44px pada viewport aktual 500×572 CSS pixels dan 40px pada viewport aktual 1264×705 CSS pixels (dengan sasaran resize jendela masing-masing 375×667 dan 1280×800).

### File yang Dibuat / Diubah

1. `app/globals.css`:
   - Deklarasi token dua lapisan (Palet Dasar Primitives dan Pemetaan Semantik).
   - Integrasi `@theme` Tailwind CSS v4.
   - Aturan adaptasi kontrol sentuh coarse-pointer (`@media (pointer: coarse)`).
   - Utilitas peran tipografi 8 level (`display` hingga `micro`).
   - Indikator fokus keyboard aksesibel (`.focus-ring` dan `.focus-ring-navy`).
   - Aturan `prefers-reduced-motion: reduce`.
2. `app/layout.tsx`:
   - Konfigurasi `next/font/google` untuk Geist Sans (`--font-geist-sans`) dan Geist Mono (`--font-geist-mono`).
   - Fallback `Arial, sans-serif` dan `ui-monospace, monospace`.
   - Injeksi variabel CSS ke tag `html`, mempertahankan `lang="id"` dan metadata produk.
3. `app/login/page.tsx`:
   - Penerapan token semantik (kanvas, kartu permukaan, teks primer/sekunder, batas kontrol, input field-bg, tombol aksi `#007A3D`, focus ring).
   - Penerapan kontrol tinggi adaptif 44px pada viewport sempit (<640px) dan 40px pada desktop pointer presisi.
   - Tanpa mengubah logika autentikasi, validasi, dan penanganan error.
4. `docs/DESIGN_SYSTEM.md`:
   - Penyelarasan 4 temuan desain acuan: teks besar WCAG (≥ 18pt/24px reguler atau ≥ 14pt bold), fungsi dekoratif `panel-border` terhadap navy, penghapusan referensi `@next/font`, dan pemulihan aturan baseline (baris 56px, preview 2 baris, accessible name tombol ikon, penanda baris terpilih selain warna).
5. `docs/decision-log.md`:
   - Pencatatan keputusan arsitektur D79 secara append-only (fokus ring navy `#FFFFFF`, Google Fonts terbundel statis, pemetaan `@theme`).
6. `docs/TRACKER.md`:
   - Pembaruan status task P0.10 menjadi `Done`.
7. `docs/evidence/P0_10/`:
   - Menyimpan 4 artefak screenshot bukti final bersih tanpa kredensial atau alamat email pribadi.

---

## 2. Struktur Token Dua Lapisan

### Lapisan 1: Palet Dasar (Primitives)
| Token CSS | Nilai Hex | Peran & Deskripsi |
|---|---|---|
| `--color-primary` | `#003C71` | Navy identitas Upaznet, shell desktop, varian panel navy |
| `--color-accent` | `#00A651` | Hijau aksen brand resmi (dilarang untuk latar tombol teks putih normal) |
| `--color-accent-hover` | `#008C44` | Hover aksen brand |
| `--color-neutral-bg` | `#FBFCFD` | Latar belakang kanvas aplikasi |
| `--color-surface` | `#FFFFFF` | Permukaan kartu, panel, tabel, dialog |
| `--color-ink` | `#1E293B` | Teks utama kontras tertinggi (Slate 800) |
| `--color-muted` | `#64748B` | Teks pelengkap, batas kontrol input (Slate 500) |
| `--color-border` | `#E2E8F0` | Border subtle, pemisah baris tabel (Slate 200) |
| `--color-border-strong` | `#CBD5E1` | Border tegas, pembatas kolom antrean (Slate 300) |
| `--color-field-bg` | `#F8FAFC` | Latar kontrol input form & textarea (Slate 50) |
| `--color-rail-bg` | `#F1F5F9` | Latar header netral, navigasi sekunder (Slate 100) |
| `--color-panel-text` | `#DBEAFE` | Teks sekunder pada panel navy (Blue 100) |
| `--color-panel-border` | `#1E3A8A` | Border dekoratif varian panel navy (Blue 900; dekoratif) |
| `--color-panel-on-navy` | `#FFFFFF` | Teks putih pada panel navy |

### Lapisan 2: Pemetaan Semantik (Semantic Tokens)
| Token Semantik | Nilai / Referensi | Penggunaan Utama |
|---|---|---|
| `--brand-primary` | `var(--color-primary)` | Identitas korporat Upaznet |
| `--brand-accent` | `var(--color-accent)` | Aksen visual grafis brand |
| `--action-primary` | `#007A3D` | Latar tombol aksi utama (kontras 5,45:1 thd teks putih) |
| `--action-primary-hover` | `#006633` | Hover tombol aksi utama (kontras 7,12:1 thd teks putih) |
| `--action-on-primary` | `#FFFFFF` | Warna teks tombol aksi utama |
| `--text-primary` | `var(--color-ink)` | Judul, isi utama tabel, chat bubble |
| `--text-secondary` | `#475569` | Keterangan, timestamp, subtitle (kontras 7,58:1 pada surface, 6,92:1 pada rail) |
| `--text-muted` | `var(--color-muted)` | Teks pelengkap; hanya pada surface/field/kanvas |
| `--border-control` | `var(--color-muted)` | Batas kontrol form (memenuhi rasio non-teks WCAG ≥ 3:1) |
| `--border-subtle` | `var(--color-border)` | Pembatas kartu dan baris tabel |
| `--border-strong` | `var(--color-border-strong)` | Pembatas tegas panel dan kolom |
| `--bg-canvas` | `var(--color-neutral-bg)` | Kanvas latar belakang utama |
| `--bg-surface` | `var(--color-surface)` | Permukaan kartu dan form |
| `--bg-field` | `var(--color-field-bg)` | Latar kontrol input/textarea |
| `--focus-ring-color` | `#2563EB` | Indikator fokus keyboard pada latar terang (ring 2px, offset 2px) |
| `--focus-ring-color-navy` | `#FFFFFF` | Indikator fokus keyboard pada varian panel navy (ring 2px, offset 2px; kontras 11,14:1) |

### Status Semantik (5 Domain Status)
- **Success (`online / pulih`):** teks `#166534`, latar `#F0FDF4`, border `#BBF7D0` (kontras teks 6,81:1).
- **Warning (`basi / review`):** teks `#92400E`, latar `#FFFBEB`, border `#FDE68A` (kontras teks 6,84:1).
- **Danger (`LOS / gagal`):** teks `#B91C1C`, latar `#FEF2F2`, border `#FECACA` (kontras teks 5,91:1).
- **Info (`baru / proses`):** teks `#1E40AF`, latar `#EFF6FF`, border `#BFDBFE` (kontras teks 8,01:1).
- **Neutral (`arsip / shadow`):** teks `#475569`, latar `#F1F5F9`, border `#E2E8F0` (kontras teks 6,92:1).

---

## 3. Pemuatan dan Verifikasi Font Nyata

### A. Tiga Tingkat Verifikasi Font

1. **Font Dikonfigurasi (Configured):**
   - Sans: `next/font/google` Geist Variable, diinjeksikan ke `--font-geist-sans`, fallback `Arial, sans-serif`.
   - Mono: `next/font/google` Geist Mono Variable, diinjeksikan ke `--font-geist-mono`, fallback `ui-monospace, monospace`.
2. **Font Dimuat (Loaded in `document.fonts`):**
   - Hasil inspeksi runtime aktual pada sesi browser:
     - Geist Sans: `__Geist_f558ef` (Family: `"Geist", "Geist Fallback", ui-sans-serif, system-ui, sans-serif`, status: `loaded`, weight: `100 900`).
     - Geist Mono: `__Geist_Mono_9ef393` (Family: `"Geist Mono", "Geist Mono Fallback", ui-monospace, SFMono-Regular, monospace`, status: `loaded`, weight: `100 900`).
3. **Font Merender Glyph (Rendered / Platform Glyphs):**
   - Bukti pengukuran lebar string `"Upaznet Helpdesk 2026"` menggunakan Canvas 2D context pada ukuran 16px:
     - Dengan `16px __Geist_f558ef`: **170,52 px**
     - Dengan `16px Arial` (fallback): **176,84 px**
     - Selisih metrik **6,32 px** membuktikan secara deterministik bahwa browser merender glyph dari font Geist, bukan menggunakan fallback Arial.
   - Bukti pengukuran Geist Mono pada string teknis:
     - Dengan `13px __Geist_Mono_9ef393`: **166,42 px**
     - Dengan `13px monospace` (fallback): **171,60 px**
     - Selisih metrik **5,18 px** membuktikan Geist Mono aktif merender sampel teknis.

### B. Hierarki Peran Tipografi
- `.type-display`: 24px (1.5rem), weight 700 bold, line-height 1.2.
- `.type-headline`: 16px (1rem), weight 700 bold, line-height 1.4.
- `.type-body`: 14px (0.875rem), weight 400 regular, line-height 1.5.
- `.type-action`: 14px (0.875rem), weight 600 semibold, line-height 1.5.
- `.type-label`: 12px (0.75rem), weight 600 semibold, line-height 1.33.
- `.type-metadata`: 12px (0.75rem), weight 400 regular, line-height 1.5.
- `.type-mono`: 13px (0.8125rem), weight 400 regular, line-height 1.625 (font Geist Mono).
- `.type-micro`: 10px (0.625rem), weight 700 bold, line-height 1.25, tracking 0.1em uppercase. Ukuran 9px dihindari.

---

## 4. Matriks Rasio Kontras (Kalkulasi Matematis vs Runtime DOM)

Metode perhitungan: Menggunakan rumus luminansi relatif standar WCAG 2.2 (`(L1 + 0.05) / (L2 + 0.05)`).  
Ambang batas:
- Teks Normal: Rasio unrounded ≥ 4,500.
- Teks Besar (≥ 18pt/24px reguler atau ≥ 14pt bold) & Elemen Non-Teks: Rasio unrounded ≥ 3,000.

| Pasangan Warna yang Diperiksa | Foreground | Background | Rasio Unrounded | Rasio Laporan | Status WCAG | Metode / Elemen Terperiksa |
|---|---|---|---|---|---|---|
| Border kontrol pada field-bg | `#64748B` | `#F8FAFC` | 4.54836... | **4,55:1** | **PASS** (≥3:1) | Sampling DOM input email/password |
| Border kontrol pada surface | `#64748B` | `#FFFFFF` | 4.75884... | **4,76:1** | **PASS** (≥3:1) | Spesifikasi batas kontrol form pada kartu |
| Teks utama pada surface | `#1E293B` | `#FFFFFF` | 14.6287... | **14,63:1** | **PASS** (≥4.5:1) | Sampling DOM judul form login `h1` |
| Tombol aksi utama (normal) | `#FFFFFF` | `#007A3D` | 5.4528... | **5,45:1** | **PASS** (≥4.5:1) | Sampling DOM computed button Masuk |
| Tombol aksi utama (hover) | `#FFFFFF` | `#006633` | 7.1226... | **7,12:1** | **PASS** (≥4.5:1) | Sampling DOM computed button saat hover |
| Teks sekunder pada surface | `#475569` | `#FFFFFF` | 7.5777... | **7,58:1** | **PASS** (≥4.5:1) | Sampling DOM subtitle deskripsi login |
| Teks sekunder pada rail-bg | `#475569` | `#F1F5F9` | 6.9170... | **6,92:1** | **PASS** (≥4.5:1) | Spesifikasi teks header/navigasi rail |
| Focus ring light pada surface | `#2563EB` | `#FFFFFF` | 5.1686... | **5,17:1** | **PASS** (≥3:1) | Sampling DOM outline elemen form aktif |
| Focus ring navy pada panel navy | `#FFFFFF` | `#003C71` | 11.1418... | **11,14:1** | **PASS** (≥3:1) | Sampling DOM outline tombol probe navy |
| Teks sekunder pada panel navy | `#DBEAFE` | `#003C71` | 9.1322... | **9,13:1** | **PASS** (≥4.5:1) | Sampling DOM teks keterangan probe navy |
| Border dekoratif pada panel navy | `#1E3A8A` | `#003C71` | 1.0757... | **1,08:1** | *Dekoratif* | Hanya aksen border; dilarang untuk fokus |
| Border panel navy pada latar putih | `#1E3A8A` | `#FFFFFF` | 10.3580... | **10,36:1** | **PASS** (≥3:1) | Batas kartu navy terhadap kanvas |
| Status Success | `#166534` | `#F0FDF4` | 6.8117... | **6,81:1** | **PASS** (≥4.5:1) | Spesifikasi badge online / pulih |
| Status Warning | `#92400E` | `#FFFBEB` | 6.8370... | **6,84:1** | **PASS** (≥4.5:1) | Spesifikasi badge data basi / review |
| Status Danger | `#B91C1C` | `#FEF2F2` | 5.9146... | **5,91:1** | **PASS** (≥4.5:1) | Spesifikasi badge LOS / gagal kirim |
| Status Info | `#1E40AF` | `#EFF6FF` | 8.0148... | **8,01:1** | **PASS** (≥4.5:1) | Spesifikasi badge episode baru / proses |
| Status Neutral | `#475569` | `#F1F5F9` | 6.9170... | **6,92:1** | **PASS** (≥4.5:1) | Sampling DOM badge Prototype Data dummy |

*Seluruh rasio kontras yang disyaratkan lolos ambang batas WCAG AA sebelum dilakukan pembulatan.*

---

## 5. Hasil Pemeriksaan Browser dan Validasi Aktual

### A. Validasi Build & Lingkungan
1. **Typecheck (`npx tsc --noEmit`):** PASS (Exit code 0, 0 error).
2. **ESLint (`npm run lint`):** PASS (Exit code 0, 0 error). Terdapat 188 warning pada berkas skill lokal `.agents/skills/impeccable/scripts/live-browser.js` (staged oleh pengguna); 0 warning pada kode aplikasi `app/*`. Sesuai instruksi, file skill pengguna tidak diubah.
3. **Production Build (`npm run build`):** PASS (Exit code 0, waktu kompilasi 572ms). Font Google teroptimasi dan dibundel statis.

### B. Pengukuran Runtime Browser Final
Pengujian dijalankan langsung melalui browser subagent terhadap server lokal (`http://localhost:3000/login`):

1. **Parameter Lingkungan & Rekonsiliasi Viewport:**
   - **Desktop Viewport:**
     - Parameter sasaran resize jendela: 1280 × 800 (dimensi jendela luar).
     - Viewport konten web aktual: **1264 × 705 CSS pixels** (terpotong dekorasi jendela pada lingkungan capture ini: border jendela 16px dan toolbar browser 95px).
     - `devicePixelRatio` = 1,0.
     - `innerWidth = 1264 px`, `scrollWidth = 1264 px` (selisih 0 px, tidak ada horizontal overflow).
   - **Viewport Sempit (<640px):**
     - Parameter sasaran resize jendela: 375 × 667.
     - Viewport konten web aktual: **500 × 572 CSS pixels** (terkena batas yang dilaporkan pada lingkungan capture ini sebesar ~500px).
     - `devicePixelRatio` = 1,0.
     - `innerWidth = 500 px`, `scrollWidth = 500 px` (selisih 0 px, tidak ada horizontal overflow).
     - Ukuran 500px berada di bawah breakpoint Tailwind `sm` (< 640px), membuktikan penerapan kontrol 44px melalui breakpoint lebar layar. Pengujian ini tidak mencakup simulasi media query `pointer: coarse`, sehingga cabang coarse-pointer belum diuji secara independen di luar breakpoint lebar layar.
2. **Tinggi Kontrol Aktual (Bounding Box Height):**
   - **Desktop (1264×705 CSS px / Pointer Presisi):**
     - Email input: **40,00 px** (`min-h-[var(--control-height-default)]`)
     - Password input: **40,00 px** (`min-h-[var(--control-height-default)]`)
     - Tombol Masuk: **40,00 px** (`min-h-[var(--control-height-default)]`)
   - **Viewport Sempit (500×572 CSS px / Breakpoint < 640px):**
     - Email input: **44,00 px** (`min-h-[var(--control-height-touch)]`, terterapkan via breakpoint lebar layar)
     - Password input: **44,00 px** (`min-h-[var(--control-height-touch)]`, terterapkan via breakpoint lebar layar)
     - Tombol Masuk: **44,00 px** (`min-h-[var(--control-height-touch)]`, terterapkan via breakpoint lebar layar)
3. **Warna Tombol Normal & Hover (Setelah Durasi Transisi 120ms):**
   - Normal: computed `backgroundColor = rgb(0, 122, 61)` (`#007A3D`), `color = rgb(255, 255, 255)`.
   - Hover (diukur setelah jeda 300ms): computed `backgroundColor = rgb(0, 102, 51)` (`#006633`).
4. **Navigasi Keyboard & Fokus:**
   - Tombol Tab berpindah mulus: Email → Password → Masuk.
   - Indikator Fokus Terang (`.focus-ring`): `outline: 2px solid rgb(37, 99, 235)` (`#2563EB`) dengan `outline-offset: 2px`.
   - Indikator Fokus Navy (`.focus-ring-navy` pada probe): `outline: 2px solid rgb(255, 255, 255)` (`#FFFFFF`) dengan `outline-offset: 2px` (kontras **11,14:1**).
5. **Preferensi Reduced Motion:**
   - Media query `@media (prefers-reduced-motion: reduce)` mereduksi durasi variabel menjadi `0ms` dan membatasi transisi menjadi `0.01ms !important`.

---

## 6. Rekonsiliasi Ukuran Screenshot dan Artefak Bukti

Tabel berikut merekonsiliasi antara CSS viewport yang disasar, viewport aktual peramban, DPR, dimensi berkas PNG yang tersimpan di direktori [docs/evidence/P0_10/](evidence/P0_10/), metode penangkapan, serta batas kepastiannya:

| Nama Artefak | Jenis | CSS Viewport & DPR Tercatat | Dimensi Berkas PNG | Metode Capture & Resize/Crop | Asal Bukti Pengukuran & Batas Kepastian |
|---|---|---|---|---|---|
| `desktop_login_tokens.png` | Halaman final produksi | Sasaran jendela 1280×800; viewport web aktual **1264×705** CSS px; DPR 1,0 | **1264 × 705** piksel | Full-viewport capture (`capture_browser_screenshot`, beyond-viewport: false, element-index: false); tanpa resize/crop gambar pasca-capture | Sesi peramban `p010_navy_probe_font`. Dimensi PNG persis merefleksikan area rendering web contents setelah pemanggilan `browser_resize_window` (1280×800 jendela luar dikurangi border OS 16px dan toolbar browser 95px). Mengonfirmasi form login bersih tanpa field terisi. |
| `desktop_focus_light.png` | Halaman final produksi dengan fokus keyboard | Sasaran jendela 1280×800; viewport web aktual **1264×705** CSS px; DPR 1,0 | **1264 × 705** piksel | Full-viewport capture (`capture_browser_screenshot`); tanpa resize/crop gambar pasca-capture | Sesi peramban yang sama (`p010_navy_probe_font`). Diambil saat tombol Masuk terfokus via navigasi Tab. Mengonfirmasi outline fokus biru `#2563EB` 2px offset 2px. |
| `desktop_focus_navy.png` | Bukti probe sementara (Temporary Probe) | Sasaran jendela 1280×800; viewport web aktual **1264×705** CSS px; DPR 1,0 | **1264 × 705** piksel | Full-viewport capture (`capture_browser_screenshot`); tanpa resize/crop gambar pasca-capture | Sesi terpisah `p010_navy_focus_shot`. Menampilkan probe kartu navy yang disisipkan sementara ke DOM untuk membuktikan token `#003C71`, sampel Geist Mono, dan fokus ring putih `#FFFFFF`. DOM dibersihkan kembali setelah capture. |
| `mobile_login_tokens.png` | Halaman final produksi (viewport sempit <640px) | Sasaran jendela 375×667; viewport web aktual **500×572** CSS px; DPR 1,0 | **500 × 572** piksel | Full-viewport capture (`capture_browser_screenshot`); tanpa resize/crop gambar pasca-capture | Sesi peramban `p010_navy_probe_font`. Terkena batas yang dilaporkan pada lingkungan capture ini (~500px). Viewport 500px berada di bawah breakpoint `sm` (< 640px), membuktikan penerapan kontrol 44px melalui breakpoint lebar layar tanpa overflow horizontal (`scrollWidth` = `innerWidth` = 500px). Batas kepastian: screenshot membuktikan breakpoint lebar layar (< 640px), bukan pengujian langsung perangkat sentuh atau cabang `pointer: coarse`; ukuran fisik jendela terikat batas yang dilaporkan pada lingkungan capture ini. |

---

## 7. Batasan Bukti dan Pemisahan Ruang Lingkup

1. **Hasil Baru vs Historis:**
   - *Pemeriksaan Baru:* Pengukuran tinggi kontrol 44px pada viewport sempit (<640px), verifikasi runtime rendered glyph font Geist dan Geist Mono, pengukuran hover state setelah transisi, pembersihan screenshot dari data fiktif lama, dan pembuatan screenshot final.
   - *Historis (Tidak Dijalankan Ulang):* Unit test domain (`tests/domain/*`), suite integrasi persistence database (`tests/integration/*`), dan migrasi database tidak dijalankan ulang karena task P0.10 murni berfokus pada token UI, stylesheet, dan font tanpa mengubah logika bisnis atau backend.
2. **Bukan Audit Aksesibilitas Menyeluruh:**
   - Perhitungan rasio kontras dan pengujian fokus keyboard membuktikan kepatuhan spesifikasi teknis token terhadap WCAG 2.2 AA. Ini bukan pengganti audit aksesibilitas menyeluruh dengan alat bantu assistive technology pihak ketiga atau pengujian pengguna disabilitas.
3. **P0.10 Selesai, P0.11 Tetap Menjadi Pekerjaan Berikutnya:**
   - Ketersediaan token UI dan gaya dasar login menandai selesainya P0.10. Pekerjaan struktur antarmuka dashboard, sidebar 216px, topbar 64px, dan layout antrean komplain tetap menjadi lingkup task berikutnya ([P0.11](TRACKER.md#task-p0-11)).
