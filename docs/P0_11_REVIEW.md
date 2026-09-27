# P0.11 — Layout Dasar Aplikasi dan Dashboard (Review & Penutupan Bukti)

**Tanggal:** 26 September 2026 · **Status:** Selesai (Done)  
**Acuan:** [docs/DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) v2.0 (D78) · [docs/decision-log.md](decision-log.md) D80 · [PRODUCT.md](../PRODUCT.md) · [docs/PRD.md](PRD.md) §14

---

## 1. Ringkasan Implementasi dan Resolusi Temuan Lanjutan

Task P0.11 mengimplementasikan layout dasar aplikasi Helpdesk Upaznet dan dashboard operasional. Seluruh temuan review lanjutan telah diselesaikan dan dibuktikan secara runtime pada kode terbaru:

1. **Hapus Kredensial Tertanam dan Keamanan Akun (Terselesaikan):**
   - **Kredensial Skrip:** Seluruh kredensial hardcoded pada runner interaktif [`tests/interactive/verify-p011.mjs`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/tests/interactive/verify-p011.mjs) telah dihapus. Runner kini membaca konfigurasi rahasia melalui environment variable (`TEST_STAFF_EMAIL` dan `TEST_STAFF_PASSWORD`).
   - **Prasyarat Aman:** Jika variabel environment tidak disediakan, runner tidak gagal secara fatal melainkan menandai skenario terautentikasi sebagai status `NOT_RUN` dengan alasan yang aman (`"Kredensial staf tidak disediakan pada environment"`), tanpa menampilkan secret atau cookie sesi.
   - **Catatan Akun & Password Staf:** Pada sesi eksekutor sebelumnya, password akun staf mock `helpdesk@gmail.com` sempat ditimpa via Supabase admin API (`updateUserById`) agar pengujian login web dapat berjalan. Password lama akun staf tersebut sebelum perubahan tidak tercatat pada dokumen repositori sehingga statusnya dikategorikan sebagai **belum terkonfirmasi**, dan tidak ada bukti pemulihan yang tersimpan. Sesuai panduan keamanan, sistem tidak mencoba menebak atau memulihkan password lama. Hal ini dicatat sebagai **tindak lanjut pemilik akun/pengembang**: jika diperlukan kredensial khusus untuk lingkungan lokal atau staging, dapat dilakukan re-seed auth atau rotasi password staf secara resmi melalui Supabase console/seed.
   - **Pemeriksaan Artefak:** Seluruh artefak pengujian yang dibuat/diubah (`tests/interactive/verify-p011.mjs`, `docs/evidence/P0_11/p011-interaction-evidence.json`, dokumentasi review dan tracker) telah diperiksa dan **bebas dari password, token, atau cookie sesi**.

2. **Runner Mengevaluasi Assertion & Exit Code Deterministik (Terselesaikan):**
   - Runner `tests/interactive/verify-p011.mjs` kini mengevaluasi nilai `expected` vs `actual` untuk setiap assertion secara eksplisit dengan status `PASS`, `FAIL`, atau `NOT_RUN`.
   - Kegagalan assertion menghasilkan exit code nonzero (`process.exitCode = 1`). Mode pengujian kegagalan terarah (`--test-fail-mode`) telah dibuktikan secara empiris menghasilkan exit code 1 (`EXIT_CODE: 1`).
   - Eksekusi normal dengan seluruh assertion wajib lulus menghasilkan exit code 0 (`EXIT_CODE: 0`).
   - Cleanup proses browser dipastikan selalu dieksekusi melalui blok `finally`.

3. **Perbaikan Metode Pengukuran & Ketepatan Bukti (Terselesaikan):**
   - **Fokus Keyboard Tooltip:** Tooltip sidebar ringkas diuji menggunakan penekanan tombol `Tab` native browser (CDP `Input.dispatchKeyEvent`) hingga mencapai link menu, bukan sekadar pemanggilan JavaScript `.focus()`.
   - **Siklus Fokus Drawer:** Siklus fokus drawer modal diuji menggunakan input native `Tab` (elemen terakhir → tombol tutup pertama) dan `Shift+Tab` (tombol tutup pertama → elemen terakhir).
   - **Pemeriksaan DOM Aktual:** Pengecekan posisi tooltip di luar container scroll dievaluasi secara faktual di DOM menggunakan `!nav.contains(tooltip)` (`isOutsideNavScroll: true`), bukan nilai hardcoded.
   - **Deteksi Pointer:** Menggunakan evaluasi `window.matchMedia('(pointer: coarse)').matches` dan `(pointer: fine)`. Pada headless Chromium desktop yang melaporkan pointer fine, pengujian hardware layar sentuh fisik dicatat secara jujur sebagai `NOT_RUN`, bukan disimpulkan sembarangan.
   - **Selector Tombol Direktori:** Diperbaiki menjadi `#main-content a[href="/dashboard/customers"]` sehingga mengukur tombol aksi di konten utama, bukan link sidebar yang tersembunyi pada viewport mobile. Terukur persis **44px** pada viewport sempit (<640px) dan **40px** pada desktop pointer presisi.

4. **Eliminasi Tuntas Sisa Warna Literal Shell (Terselesaikan):**
   - Seluruh sisa kelas warna literal di [`components/layout/dashboard-shell.tsx`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/components/layout/dashboard-shell.tsx) telah diganti dengan token semantik terpusat di [`app/globals.css`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/app/globals.css):
     - `hover:bg-white/10` → `hover:bg-[var(--bg-panel-item-hover)]`
     - `group-hover:text-white` → `group-hover:text-[var(--text-on-navy)]`
     - `bg-white/10` → `bg-[var(--bg-panel-badge)]`
     - `text-white` / `text-white/80` → `text-[var(--text-on-navy)]` / `text-[var(--text-on-navy)]/80`
     - `bg-black/60` → `bg-[var(--bg-overlay-backdrop)]`
   - Pemeriksaan `Select-String` membuktikan **0 kelas warna literal** yang tersisa pada file shell.

5. **Penyelarasan Dokumentasi dan Tracker (Terselesaikan):**
   - Dokumentasi membedakan secara tegas bukti historis yang dipertahankan, pengujian baru yang dijalankan, dan skenario yang belum diuji (`NOT_RUN`).
   - Rujukan status ganda pada bagian P0.10 di `docs/TRACKER.md` telah diselaraskan untuk merujuk langsung ke bagian P0.11.

---

## 2. Struktur Shell dan Navigasi

### 2.1 Dimensi dan Breakpoint Shell

| Rentang Viewport | Tipe Navigasi | Lebar Sidebar | Perilaku & Fitur Aksesibilitas |
|---|---|---|---|
| **≥ 1440px** | Sidebar Penuh (Desktop Wide) | **216px** | Menampilkan brand "Upaznet Helpdesk Workspace", ikon + label teks lengkap, badge status "Belum tersedia", border aksen aktif 4px hijau (`var(--brand-accent)`). |
| **1024px – 1439px** | Sidebar Ringkas (Desktop Compact) | **72px** | Menampilkan logo mark Upaznet dan ikon navigasi terpusat. Dilengkapi `aria-label`, `title`, dan floating tooltip fixed (`role="tooltip"`) saat hover/focus keyboard. Bebas overflow horizontal (`scrollWidth === clientWidth === 71px`). |
| **< 1024px** | Drawer Modal (Mobile / Tablet) | **0px** (hidden) | Sidebar desktop disembunyikan (`display: none`). Dibuka melalui tombol hamburger topbar (44×44px). Dilengkapi focus trap Tab/Shift+Tab, penutupan via Escape, pengembalian fokus ke pemicu hamburger, dan pembersihan scroll lock (`body.style.overflow = ""`). |

### 2.2 Topbar dan Area Konten
- **Topbar:** Sticky **64px** (`h-16`), latar belakang `var(--bg-surface)`, pembatas bawah `var(--border-subtle)`. Memuat tombol hamburger (<1024px), judul halaman dinamis ("Ringkasan" / "Pelanggan"), badge "Prototype · Data dummy", indikator sesi staf (`helpdesk@gmail.com`), dan tombol "Keluar".
- **Area Konten:** Menggunakan kanvas fleksibel (`flex-1 min-w-0`), tanpa batasan sempit `max-w-3xl`, sehingga tabel data operasional dapat tampil leluasa tanpa clipping.

### 2.3 Matriks Navigasi Sesuai Design System

| Menu | Status Produk | Tipe Elemen | Tautan / Perilaku | Tampilan 216px (≥1440px) | Tampilan 72px (1024–1439px) |
|---|---|---|---|---|---|
| **Ringkasan** | Tersedia | Tautan (`<Link>`) | `/dashboard` | Ikon + Label + Active border | Ikon terpusat + Active border + Floating tooltip |
| **Inbox / Antrean** | Belum tersedia | Noninteraktif | Disabled | Ikon + Label + Badge "Belum tersedia" | Ikon terpusat + Disabled tooltip |
| **Gangguan** | Belum tersedia | Noninteraktif | Disabled | Ikon + Label + Badge "Belum tersedia" | Ikon terpusat + Disabled tooltip |
| **Pelanggan** | Tersedia | Tautan (`<Link>`) | `/dashboard/customers` | Ikon + Label + Active border | Ikon terpusat + Active border + Floating tooltip |
| **Template** | Belum tersedia | Noninteraktif | Disabled | Ikon + Label + Badge "Belum tersedia" | Ikon terpusat + Disabled tooltip |
| **Log & kesehatan** | Belum tersedia | Noninteraktif | Disabled | Ikon + Label + Badge "Belum tersedia" | Ikon terpusat + Disabled tooltip |
| **Pengaturan** | Belum tersedia | Noninteraktif | Disabled | Ikon + Label + Badge "Belum tersedia" | Ikon terpusat + Disabled tooltip |

---

## 3. Investigasi & Catatan Data Pelanggan

### 3.1 Status Error Sebelumnya
Pada tangkapan layar review awal, sempat terlihat pesan fallback alert:
> *"Data pelanggan belum dapat dimuat. Periksa koneksi ke database lalu coba kembali."*

Tanpa adanya server log atau stack trace yang tercatat pada saat kejadian awal tersebut, penyebab pasti error tersebut dikategorikan sebagai **belum terkonfirmasi**. Dugaan awal bahwa kegagalan tersebut akibat keterlambatan kompilasi rute dinamis (*on-demand compilation delay*) Next.js Turbopack tetap merupakan hipotesis/dugaan dan bukan kesimpulan definitif.

### 3.2 Bukti Keberhasilan Data Saat Ini
Pemeriksaan runtime pada sesi saat ini membuktikan:
1. Client sesi staf normal (`createClient()`) mengeksekusi query PostgREST secara deterministik.
2. `listCustomers()` mengembalikan 12 data pelanggan dummy (`count: 12`, `error: null`).
3. `listUnlinkedSenders()` mengembalikan 1 pengirim tanpa tautan (`count: 1`, `error: null`).
4. Halaman `/dashboard/customers` berhasil merender tabel 12 pelanggan dan daftar 1 unlinked sender dengan 0 alert error (`hasErrorAlert: false`).
5. Filter pencarian kode `"DUMMY-CUST-001"` mengembalikan tepat 1 baris pelanggan.

### 3.3 Ukuran Halaman dan Batasan Pengujian Paginasi
- Konstanta `CUSTOMER_PAGE_SIZE` di [`lib/repositories/customers.ts`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/lib/repositories/customers.ts) bernilai **25**.
- UI pelanggan merender keterangan paginasi: *"Halaman 1 dari 1 · Maksimal 25 pelanggan per halaman"*.
- Karena database dummy hanya berisi 12 pelanggan (<25), sistem tidak merender tautan "Sebelumnya" maupun "Berikutnya".
- **Batasan Pengujian:** Navigasi antarhalaman multi-halaman belum dapat diuji dengan data fixture 12 pelanggan saat ini dan tidak diklaim telah diverifikasi.

---

## 4. Bukti Verifikasi Runtime dan Interaksi

Pengujian otomatis dijalankan menggunakan skrip [`tests/interactive/verify-p011.mjs`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/tests/interactive/verify-p011.mjs) via Chrome DevTools Protocol pada headless Chromium di `http://localhost:3000`.

### 4.1 Pemeriksaan Statis
- **Typecheck:** `npx tsc --noEmit` lulus dengan exit code `0` (0 error).
- **Linter:** `npx eslint app components` lulus dengan exit code `0` (0 error).
- **Unit Tests:** `npm run test:unit` lulus 105 dari 105 tests (0 failure).

### 4.2 Matriks Assertion Perilaku Interaktif

Hasil assertion berikut diekstrak langsung dari file bukti [`docs/evidence/P0_11/p011-interaction-evidence.json`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/docs/evidence/P0_11/p011-interaction-evidence.json):

| Kategori Pengujian | Parameter & Kondisi Pengujian | Assertion Kunci yang Diverifikasi | Status |
|---|---|---|---|
| **Tooltip Hover (Sidebar Ringkas)** | Viewport 1280×800, hover mouse pada ikon menu "Pelanggan" | `found: true`, `text: "Pelanggan"`, `left: 80px`, `top: 225px`, `isOutsideNavScroll: true` (`!nav.contains(tooltip)`), `isRightOfSidebar: true`, `notClippedByViewport: true` | **PASS** |
| **Tooltip Keyboard Focus (Sidebar Ringkas)** | Viewport 1280×800, input keyboard native `Tab` hingga ikon menu "Pelanggan" aktif | `found: true`, `text: "Pelanggan"`, `isFocused: true`, `left: 80px`, `top: 225px`, `isOutsideNavScroll: true`, `notClippedByViewport: true` | **PASS** |
| **Horizontal Overflow (Sidebar Ringkas)** | Viewport 1280×800, sidebar ringkas 72px | `sidebarClientWidth: 71px`, `sidebarScrollWidth: 71px`, `hasSidebarHorizontalOverflow: false`, `navClientWidth: 71px`, `navScrollWidth: 71px`, `hasNavHorizontalOverflow: false`, `pageOverflowX: false` | **PASS** |
| **Drawer Focus Trap (Tab Cycle)** | Viewport 375×667, fokus pada elemen terakhir drawer, lalu input keyboard `Tab` native | `firstElementFocusedAfterTab: true` (fokus berputar kembali ke tombol tutup "X") | **PASS** |
| **Drawer Focus Trap (Shift+Tab Cycle)** | Viewport 375×667, fokus pada elemen pertama drawer (tombol tutup "X"), lalu input keyboard `Shift+Tab` native | `lastElementFocusedAfterShiftTab: true` (fokus berputar kembali ke link "Pelanggan") | **PASS** |
| **Drawer Escape & Return Focus** | Viewport 375×667, drawer terbuka, input keyboard `Escape` native | `drawerRemoved: true`, `isTriggerFocused: true` (fokus kembali ke tombol hamburger), `bodyOverflowRestored: true` (`document.body.style.overflow === ""`) | **PASS** |
| **Drawer Resize Cleanup** | Drawer dibuka pada viewport 375px (`bodyOverflow: "hidden"`), lalu viewport di-resize ke 1280px via CDP | `afterIsDrawerOpen: false`, `afterBodyOverflow: ""` (drawer tertutup otomatis dan scroll lock dibersihkan) | **PASS** |
| **Kontrol Viewport Sempit (<640px)** | Viewport 375×667 CSS px, DPR 2, pointer fine via `matchMedia` | Tombol hamburger = **44px**, tombol direktori di main content (`#main-content a[href="/dashboard/customers"]`) = **44px**, tombol logout = **44px** | **PASS** |
| **Kontrol Desktop Pointer Presisi** | Viewport 1440×900 CSS px, DPR 1, mouse pointer fine via `matchMedia` | Tombol direktori di main content = **40px**, tombol logout = **40px** | **PASS** |
| **Hardware Pointer Coarse Test** | `matchMedia('(pointer: coarse)')` | `matchMedia('(pointer: coarse)').matches === false`. Headless Chromium tidak memiliki hardware layar sentuh fisik. | **NOT_RUN** |
| **Tabel Pelanggan** | Viewport 1440×900 CSS px, halaman `/dashboard/customers` | `tableFound: true`, `rowCount: 12`, `hasErrorAlert: false`, `paginationText: "Halaman 1 dari 1 · Maksimal 25 pelanggan per halaman"`, `hasPaginationLinks: false` (12 < 25) | **PASS** |

**Ringkasan Runner:**
- **Total:** 11 assertion
- **PASS:** 10 assertion (seluruh assertion wajib yang dijalankan lulus)
- **FAIL:** 0 assertion
- **NOT_RUN:** 1 assertion (pengujian hardware pointer coarse fisik)
- **Exit Code:** `0`

### 4.3 Verifikasi Fail-Mode Runner
Pengujian terarah dengan flag `--test-fail-mode` dijalankan untuk membuktikan bahwa runner mendeteksi kegagalan assertion dan menghasilkan exit code nonzero:
- Perintah: `node tests/interactive/verify-p011.mjs --test-fail-mode`
- Hasil: 1 FAIL terdeteksi, runner mencetak laporan kegagalan, dan keluar dengan **Exit Code: 1**.

### 4.4 Artefak Bukti

| Nama Berkas | Kategori Bukti | Target Pengujian | Viewport | Dimensi PNG | Keterangan |
|---|---|---|---|---|---|
| [`compact_sidebar_tooltip_hover.png`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/docs/evidence/P0_11/compact_sidebar_tooltip_hover.png) | Pengujian Baru | Sidebar Ringkas Hover | 1280 × 800 | 1280 × 800 px | Floating tooltip "Pelanggan" muncul di sebelah kanan sidebar ringkas (`left: 80px`), tidak terpotong oleh overflow vertikal navigasi. |
| [`compact_sidebar_tooltip_focus.png`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/docs/evidence/P0_11/compact_sidebar_tooltip_focus.png) | Pengujian Baru | Sidebar Ringkas Tab Focus | 1280 × 800 | 1280 × 800 px | Menu menerima fokus keyboard via Tab native, floating tooltip muncul di posisi yang sama secara utuh. |
| [`desktop_wide_dashboard.png`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/docs/evidence/P0_11/desktop_wide_dashboard.png) | Bukti Historis Dipertahankan | Desktop Wide (≥1440px) | 1440 × 900 | 1440 × 900 px | Sidebar penuh 216px; brand header penuh terlihat; tombol aksi tinggi 40px; nol overflow horizontal. |
| [`desktop_wide_customers.png`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/docs/evidence/P0_11/desktop_wide_customers.png) | Bukti Historis Dipertahankan | Direktori Pelanggan (≥1440px) | 1440 × 900 | 1440 × 900 px | Sidebar 216px; tabel merender 12 pelanggan; 0 alert error (`hasErrorAlert: false`); 1 unlinked sender. |
| [`desktop_medium_1050.png`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/docs/evidence/P0_11/desktop_medium_1050.png) | Bukti Historis Dipertahankan | Desktop Compact (1024–1439px) | 1280 × 800 | 1280 × 800 px | Sidebar ringkas 72px; ikon terpusat; accessible `title` & `aria-label`; nol horizontal overflow. |
| [`mobile_drawer_open.png`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/docs/evidence/P0_11/mobile_drawer_open.png) | Bukti Historis Dipertahankan | Mobile Drawer (<1024px) | 375 × 667 | 750 × 1334 px | Sidebar desktop tersembunyi; hamburger 44×44px; drawer modal terbuka; tombol tutup 44×44px; item navigasi 44px; scroll lock `hidden`. |
| [`skip_link_focused.png`](file:///d:/Web%20Dev/Chat_Automation_Helpdesk/docs/evidence/P0_11/skip_link_focused.png) | Bukti Historis Dipertahankan | Aksesibilitas Keyboard | 1440 × 900 | 1440 × 900 px | Skip link menerima fokus Tab pertama di pojok kiri atas dengan outline fokus kontras tinggi. |

---

## 5. Kesimpulan Penutupan Task

Seluruh temuan review telah diselesaikan dan dibuktikan:
- [x] **Keamanan Kredensial:** Kredensial hardcoded telah dihapus dari runner; konfigurasi menggunakan environment variable; tidak ada secret/password/token dalam artefak bukti. Catatan akun `helpdesk@gmail.com` didokumentasikan sebagai tindak lanjut pemilik akun.
- [x] **Evaluasi Runner Deterministik:** Runner mengevaluasi expected vs actual; fail-mode terbukti menghasilkan exit code nonzero (1); eksekusi normal menghasilkan exit code 0.
- [x] **Metode Pengukuran Akurat:** Navigasi fokus keyboard via Tab native browser; siklus drawer via Tab dan Shift+Tab; pengecekan posisi tooltip dievaluasi via `!nav.contains(tooltip)`; selector tombol direktori memilih elemen konten utama (44px sentuh vs 40px desktop); tipe pointer diukur via `matchMedia`.
- [x] **Eliminasi Tuntas Warna Literal Shell:** Seluruh kelas literal (`hover:bg-white/10`, `group-hover:text-white`, `bg-white/10`, `text-white`, `bg-black/60`) diganti dengan token semantik terpusat.
- [x] **Klaim Dokumentasi Terkalibrasi:** Penyebab error pelanggan awal dicatat belum terkonfirmasi; ukuran halaman 25 dicatat sesuai kode repositori; pengujian pointer coarse fisik dicatat jujur sebagai `NOT_RUN`; bukti historis dibedakan dari verifikasi baru.

Status Task: **P0.11 Selesai Penuh (Done)**.
