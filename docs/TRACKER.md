# Project Tracker — Upaznet Helpdesk

Acuan: [PRD v2.1](PRD.md) · [Decision log sampai D77](decision-log.md). D43–D48 tidak tersedia.

> Tabel setiap phase berisi task, status, dependency, dan keputusan terkait. Klik Task ID untuk menuju detail, lalu buka bagian task tersebut untuk membaca acceptance criteria, bukti, dan catatan.

<a id="navigasi"></a>

**Navigasi:** [P0 · Foundation](#p0) · [P1 · Domain & Data](#p1) · [P2 · Vertical Slice Shadow](#p2) · [P3 · Balas & Penanganan](#p3) · [P4 · Outage & Controls](#p4) · [P5 · Pilot Lengkap](#p5)

**Status:** ✅ Done · 🟡 In Progress · ⬜ Not Started · ⛔ Blocked

`Done` berarti acceptance criteria terpenuhi dan ada bukti verifikasi. Kode yang belum diverifikasi tetap `In Progress`.

**Update manual:** ubah status pada tabel phase; perbarui acceptance criteria, bukti, atau catatan di bagian detail task yang sama. Setiap informasi disimpan satu kali.

---

<a id="p0"></a>

## P0 — Foundation

| Task ID              | Nama Task                                        | Status         | Dependency  | Decision ID Terkait |
| -------------------- | ------------------------------------------------ | -------------- | ----------- | ------------------- |
| [P0.1](#task-p0-1)   | Scaffold Next.js App Router + TypeScript         | ✅ Done        | —           | D50                 |
| [P0.2](#task-p0-2)   | Konfigurasi environment lokal                    | ✅ Done        | P0.1        | D50, D66            |
| [P0.3](#task-p0-3)   | Setup Supabase lokal dan Auth staf               | ✅ Done        | P0.2        | D50                 |
| [P0.4](#task-p0-4)   | Form dan aksi login staf                         | ✅ Done        | P0.3        | D50                 |
| [P0.5](#task-p0-5)   | Logout dan penanganan kegagalan logout           | ✅ Done        | P0.4        | D50                 |
| [P0.6](#task-p0-6)   | Proteksi halaman dashboard dengan sesi staf      | ✅ Done        | P0.3        | D50, D66            |
| [P0.7](#task-p0-7)   | Migrasi schema awal identitas dan topologi       | ✅ Done        | P0.3        | D67, D70            |
| [P0.8](#task-p0-8)   | Pembatasan akses database foundation             | ✅ Done        | P0.7        | D66, D70            |
| [P0.9](#task-p0-9)   | Seed dummy identitas dan topologi yang idempoten | ✅ Done        | P0.7        | D70                 |
| [P0.10](#task-p0-10) | Token UI terpusat                                | ✅ Done        | P0.1        | D69, D78, D79       |
| [P0.11](#task-p0-11) | Layout dasar aplikasi dan dashboard              | ✅ Done        | P0.1, P0.10 | D69, D80            |

### Detail task

<a id="task-p0-1"></a>

<details>
<summary>P0.1 — Scaffold Next.js App Router + TypeScript</summary>

**Acceptance Criteria**

Struktur aplikasi dan konfigurasi TypeScript tersedia; aplikasi dapat dibangun dan lint lulus.

**Bukti/Verifikasi**

`package.json`, `tsconfig.json`, `app/layout.tsx`; `README.md` bagian “Pemeriksaan lokal 20 September 2026” mencatat build/lint lulus. Catatan ini selanjutnya disebut V20.

**Catatan/Blocker**

Bukti berlaku untuk baseline foundation yang diuji; belum membuktikan build seluruh perubahan terbaru.

</details>

<a id="task-p0-2"></a>

<details>
<summary>P0.2 — Konfigurasi environment lokal</summary>

**Acceptance Criteria**

Variabel memakai `UPPER_SNAKE_CASE`; contoh konfigurasi tersedia; env lokal diabaikan Git; koneksi aplikasi memakai URL dan publishable key, tanpa secret server pada variabel publik.

**Bukti/Verifikasi**

`.env.example`, `.gitignore`, `lib/supabase/server.ts`; review statis sesuai; V20 membuktikan koneksi dengan sesi staf berfungsi.

**Catatan/Blocker**

Scope konfigurasi lokal foundation; environment deployment belum diverifikasi.

</details>

<a id="task-p0-3"></a>

<details>
<summary>P0.3 — Setup Supabase lokal dan Auth staf</summary>

**Acceptance Criteria**

Supabase lokal menyediakan PostgreSQL dan Auth; URL aplikasi dikonfigurasi; akun staf dapat memperoleh sesi Auth.

**Bukti/Verifikasi**

`supabase/config.toml`; `tests/integration/network.test.ts` mencakup sign-in akun sementara; `README.md` mencatat integrasi database dan endpoint terautentikasi lulus pada 20 September.

**Catatan/Blocker**

Bukti untuk lingkungan lokal, bukan provisioning Supabase cloud.

</details>

<a id="task-p0-4"></a>

<details>
<summary>P0.4 — Form dan aksi login staf</summary>

**Acceptance Criteria**

Kredensial valid mengarahkan ke dashboard; input kosong atau kredensial salah menampilkan pesan yang sesuai; staf yang sudah login diarahkan ke dashboard.

**Bukti/Verifikasi**

`app/login/page.tsx`, `app/login/actions.ts`; `docs/P0_4_REVIEW.md` mencatat 13 skenario terverifikasi (AC1–AC9) via Playwright headless pada Supabase lokal: form berlabel Indonesia, submit kredensial valid mengarahkan ke dashboard, input kosong/spasi ditolak Server Action (`error=required`), kredensial salah menampilkan alert generik tanpa leak kredensial, staf login diarahkan kembali ke dashboard, navigasi keyboard Tab/Enter, build dan lint lulus pada 23 September 2026.

**Catatan/Blocker**

Guard validasi spasi pada password di Server Action telah diperbaiki. Seluruh acceptance criteria terpenuhi.

</details>

<a id="task-p0-5"></a>

<details>
<summary>P0.5 — Logout dan penanganan kegagalan logout</summary>

**Acceptance Criteria**

Logout mengakhiri sesi dan mengarahkan ke login; sesi lama tidak dapat membuka dashboard; kegagalan logout terlihat.

**Bukti/Verifikasi**

`app/login/actions.ts`, `app/login/page.tsx`, `app/dashboard/page.tsx`; `docs/P0_5_REVIEW.md` dan rangkaian artefak `docs/evidence/P0_5/`:
- Bukti fungsional browser E2E historis (23 Sept 2026, 37 PASS + 1 INFO, 0 FAIL, 0 NOT RUN; tetap valid, browser tidak dijalankan ulang karena tidak ada perubahan kode aplikasi):
  - Alur normal (`results-main.json`, 24 baris: 23 PASS + 1 INFO): logout via mouse dan keyboard (Tab+Enter, Tab+Space diawait tuntas), Server Action redirect terbukti via header `x-action-redirect`, cookie sesi hilang, penolakan akses ulang `/dashboard` & `/dashboard/customers`, penanganan Back/tab2/logout ganda, tanpa leak secret/password di HTML/console.
  - Alur kegagalan (`results-failure.json`, 9 baris: 9 PASS): simulasi HTTP 500 via proksi lokal pada `POST /auth/v1/logout`, pesan generik tampil di `/login?error=logout` (sesi hilang) dan `/dashboard?error=logout` (sesi valid), tombol coba lagi tersedia, retry sukses setelah pulih.
  - Mock terisolasi (`results-ac6d.json`, 5 baris: 5 PASS): verifikasi cabang Server Action asli `logout()` dan redirect Next.js.
- Verifikasi alat uji (`p05-harness-proof.mjs`, 25 Sept 2026):
  - Mode sintetis offline default: **20 checks PASS, 0 FAIL, 1 NOT RUN** (Group 10 integrasi akun GoTrue dilaporkan NOT RUN tanpa DB/key, exit code 0).
  - Mode integrasi akun lokal GoTrue (`--with-account`): **28 checks PASS, 0 FAIL, 0 NOT RUN** (diuji dengan kredensial via env lokal, exit code 0).
  - Pembuktian terhadap kode modul bersama yang aktual (`p05-harness-utils.mjs`) pada kedua harness, deteksi kebocoran memori asli sebelum sanitasi (password, JWT, Bearer token), output/artefak bebas secret mentah, kegagalan skenario menghasilkan exit code 1, kegagalan simpan hasil/cleanup menghasilkan exit code 1 dengan safe summary ke stderr dan cleanup tetap diupayakan, preservasi error utama saat screenshot/cleanup gagal, seluruh lulus menghasilkan exit code 0, penanganan Promise keyboard, penghapusan fallback service-role key tertanam dalam kode, penolakan target remote sebelum request, kegagalan prasyarat aman dengan exit code 1 saat integrasi diminta tanpa key, serta helper akun GoTrue paginasi penuh, get-by-id, dan safeguard anti-salah hapus akun non-uji.

**Catatan/Blocker**

Tidak ada pekerjaan tersisa dalam lingkup P0.5. Seluruh acceptance criteria dan temuan terbuka alat uji tertutup penuh dengan bukti empiris. Selesai (Done).

</details>

<a id="task-p0-6"></a>

<details>
<summary>P0.6 — Proteksi halaman dashboard dengan sesi staf</summary>

**Acceptance Criteria**

Dashboard dan direktori pelanggan dapat dibuka dengan sesi sah; pengunjung tanpa sesi diarahkan ke login.

**Bukti/Verifikasi**

`proxy.ts`, `app/dashboard/page.tsx`, `app/dashboard/customers/page.tsx`; V20 mencatat akses HTTP dengan sesi uji dan redirect tanpa sesi.

**Catatan/Blocker**

—

</details>

<a id="task-p0-7"></a>

<details>
<summary>P0.7 — Migrasi schema awal identitas dan topologi</summary>

**Acceptance Criteria**

Enam tabel awal tersedia: customers, services, odcs, odps, service_topology, channel_identities; relasi dan constraint dasar terdefinisi; data foundation dapat disimpan dan dibaca.

**Bukti/Verifikasi**

`supabase/migrations/20260919115958_create_customer_identity_topology.sql`; V20 mencatat seed serta pembacaan direktori berhasil.

**Catatan/Blocker**

Scope hanya schema awal P0. `docs/database_schema.sql` adalah snapshot historis, bukan acuan migrasi aktif.

</details>

<a id="task-p0-8"></a>

<details>
<summary>P0.8 — Pembatasan akses database foundation</summary>

**Acceptance Criteria**

RLS aktif pada enam tabel awal; anonim tidak mendapat akses; authenticated hanya memiliki akses baca langsung.

**Bukti/Verifikasi**

Policy dan grant pada migrasi awal telah diperiksa; V20 mencatat penolakan baca anonim dan insert langsung staf, serta pembacaan dengan sesi staf.

**Catatan/Blocker**

—

</details>

<a id="task-p0-9"></a>

<details>
<summary>P0.9 — Seed dummy identitas dan topologi yang idempoten</summary>

**Acceptance Criteria**

Seed menyediakan pelanggan, layanan, topologi, dan identitas dummy; pengulangan tidak menduplikasi atau menimpa data; akun Auth tidak berubah.

**Bukti/Verifikasi**

`supabase/seed.sql`; V20 mencatat seed dijalankan dua kali dengan checksum tetap, termasuk akun Auth.

**Catatan/Blocker**

—

</details>

<a id="task-p0-10"></a>

<details>
<summary>P0.10 — Token UI terpusat</summary>

**Acceptance Criteria**

Token warna dua lapisan (palet dasar primitives dan pemetaan semantik), tipografi Geist Sans dan Geist Mono dengan hierarki terdefinisi (display 24px sampai micro 10px), spacing scale, radius, batas kontrol, dan fokus ring mengikuti [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) v2.0; tersedia terpusat sebagai variabel CSS untuk dipakai konsisten oleh seluruh halaman dan komponen. Font Geist benar-benar dimuat dengan fallback terkonfigurasi. Kontrol input dan tombol berukuran minimal 44px pada layar sentuh/mobile dan 40px pada desktop pointer presisi.

**Bukti/Verifikasi**

`app/globals.css`, `app/layout.tsx`, `app/login/page.tsx`, `docs/DESIGN_SYSTEM.md`, `docs/P0_10_REVIEW.md`, dan direktori `docs/evidence/P0_10/`:
- Token UI terpusat dua lapisan diimplementasikan pada `app/globals.css` bersama integrasi `@theme` Tailwind CSS v4, pemetaan kelas tipografi 8 peran (`type-display` s.d. `type-micro`), aturan adaptasi sentuh `@media (pointer: coarse)`, serta aturan fokus dan prefers-reduced-motion.
- Pemuatan nyata font Geist Sans (`__Geist_f558ef`) dan Geist Mono (`__Geist_Mono_9ef393`) melalui `next/font/google` di `app/layout.tsx` dengan fallback (`Arial, sans-serif` dan `ui-monospace, monospace`), terbukti aktif pada static assets build Next.js, terverifikasi `document.fonts`, serta dibuktikan merender glyph aktif via selisih metrik teks Canvas 2D (170,52px vs 176,84px Arial).
- Pengujian browser desktop dan mobile memverifikasi resolusi token semantik:
  - Tinggi kontrol adaptif: 40px pada desktop (viewport web 1264×705 CSS px, sasaran 1280×800) dan 44px pada mobile sentuh (< 640px; viewport web screenshot 500×572 CSS px karena batas minimal jendela desktop Chromium) untuk input email, password, dan tombol Masuk.
  - Lebar bebas overflow horizontal (`scrollWidth === innerWidth` pada desktop 1264px dan mobile 500px).
  - Warna tombol aksi `#007A3D` normal dan `#006633` hover terkalibrasi kontras (5,45:1 dan 7,12:1 thd teks putih).
  - Indikator fokus keyboard: outline biru `#2563EB` 2px offset 2px pada latar terang dan putih `#FFFFFF` pada panel navy (kontras 11,14:1 thd navy `#003C71`).
- Pemeriksaan statis: typecheck pass (0 error), linter pass (0 error), production build pass (0 error).
- Empat artefak screenshot tersimpan di `docs/evidence/P0_10/` (tiga halaman produksi final dan satu bukti probe sementara navy) dalam kondisi bersih tanpa kredensial atau alamat email pribadi; dimensi berkas PNG (1264×705 dan 500×572) telah direkonsiliasi secara faktual terhadap viewport web peramban.

**Catatan/Blocker**

Implementasi dan penutupan bukti P0.10 selesai penuh (Done). Untuk status dan verifikasi layout dashboard berikutnya, rujuk bagian [P0.11](#task-p0-11).

</details>

<a id="task-p0-11"></a>

<details>
<summary>P0.11 — Layout dasar aplikasi dan dashboard</summary>

**Acceptance Criteria**
 
Layout menggunakan bahasa Indonesia, identitas prototype/data dummy, dan fondasi shell sesuai design system ([DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) v2.0 & D80): breakpoint sidebar bertingkat (≥1440px sidebar penuh selebar 216px navy `#003C71`, 1024–1439px sidebar ringkas selebar 72px dengan ikon terpusat, accessible name, dan floating tooltip saat hover/focus, <1024px navigasi drawer modal responsif dengan focus trap, Escape key, dan scroll lock bersih), topbar tinggi 64px, area konten fleksibel tanpa batas `max-w` sempit, profil staf dari sesi Auth, Server Action logout, penanda menu aktif via `aria-current="page"` dan border aksen hijau, item unbuilt noninteraktif dengan badge "Belum tersedia", kontrol adaptif 44px sentuh dan 40px desktop, skip link aksesibel, serta direktori pelanggan berhasil memuat data dummy normal tanpa error alert.
**Bukti/Verifikasi**

`app/dashboard/layout.tsx`, `components/layout/dashboard-shell.tsx`, `app/dashboard/page.tsx`, `app/dashboard/customers/page.tsx`, `docs/P0_11_REVIEW.md`, `tests/interactive/verify-p011.mjs`, `docs/evidence/P0_11/p011-interaction-evidence.json`, dan direktori `docs/evidence/P0_11/`:
- Shell dashboard bersama diimplementasikan via `DashboardShell` dan `app/dashboard/layout.tsx`:
  - Breakpoint sidebar teruji runtime pada viewport aktual:
    - **≥1440px (1440×900 CSS px, DPR 1):** Sidebar penuh 216px (`desktop_wide_dashboard.png` - bukti historis dipertahankan), brand header lengkap, tombol aksi desktop 40px, bebas overflow horizontal (`scrollWidth === innerWidth`).
    - **1024–1439px (1280×800 CSS px, DPR 1):** Sidebar ringkas 72px (`desktop_medium_1050.png` - bukti historis dipertahankan), ikon terpusat, accessible name (`aria-label` & `title`), label tersembunyi tanpa layout break, dan floating tooltip aksesibel pada hover/focus keyboard.
    - **<1024px (375×667 CSS px, DPR 2):** Sidebar desktop disembunyikan (`display: none`), navigasi drawer modal (`mobile_drawer_open.png` - bukti historis dipertahankan) dibuka via hamburger button (44×44px), focus trap mengarahkan fokus awal ke tombol tutup (44×44px), scroll lock `body.style.overflow = "hidden"`, tombol Escape menutup drawer dan mengembalikan fokus ke pemicu, scroll lock dibersihkan bersih.
- Resolusi temuan review P0.11 terverifikasi pada kode terbaru:
  1. **Tooltip sidebar ringkas:** Tooltip menggunakan `position: fixed` di luar container scroll `<nav>` (`left: 80px`), tampil utuh saat hover mouse dan fokus keyboard via Tab native (`compact_sidebar_tooltip_hover.png`, `compact_sidebar_tooltip_focus.png`), tanpa terpotong overflow vertikal dan tanpa overflow horizontal (`hasSidebarHorizontalOverflow: false`, `sidebarScrollWidth === sidebarClientWidth === 71px`). Pengecekan DOM aktual membuktikan `!nav.contains(tooltip)` (`isOutsideNavScroll: true`). Scroll vertikal navigasi tetap berfungsi normal.
  2. **Eliminasi tuntas warna literal shell:** Seluruh warna literal pada shell telah diganti dengan token semantik terpusat, termasuk `bg-[#002D56]`, `bg-blue-50`, `text-blue-800`, `text-slate-700`, `bg-slate-100`, `border-slate-300`, `hover:bg-white/10` (`hover:bg-[var(--bg-panel-item-hover)]`), `group-hover:text-white` (`group-hover:text-[var(--text-on-navy)]`), `bg-white/10` (`bg-[var(--bg-panel-badge)]`), `text-white` (`text-[var(--text-on-navy)]`), dan `bg-black/60` (`bg-[var(--bg-overlay-backdrop)]`). Tidak ada lagi kelas warna literal yang tersisa pada `components/layout/dashboard-shell.tsx`.
  3. **Penyelarasan klaim dokumentasi:**
     - Penyebab kegagalan rendering data pelanggan sebelumnya dicatat sebagai belum terkonfirmasi (keterlambatan kompilasi Turbopack hanya dugaan).
     - Keberhasilan pemuatan 12 pelanggan dummy dan 1 unlinked sender dibuktikan runtime tanpa error alert (`rowCount: 12`, `hasErrorAlert: false`, `desktop_wide_customers.png`).
     - Ukuran halaman diselaraskan dengan konstanta `CUSTOMER_PAGE_SIZE = 25` di `lib/repositories/customers.ts` ("Halaman 1 dari 1 · Maksimal 25 pelanggan per halaman").
     - Karena 12 pelanggan < 25 per halaman, tautan paginasi tidak muncul di DOM; navigasi antarhalaman multi-halaman belum diuji dan tidak diklaim.
  4. **Kelengkapan bukti interaksi & runner teruji:**
     - Tab native dari elemen terakhir drawer berputar kembali ke tombol tutup: `drawer_tab_cycle_last_to_first: PASS`.
     - Shift+Tab native dari tombol tutup berputar kembali ke link terakhir: `drawer_shift_tab_cycle_first_to_last: PASS`.
     - Escape menutup drawer dan mengembalikan fokus ke hamburger: `drawer_escape_key_restores_focus: PASS`.
     - Resize drawer dari 375px ke 1280px membersihkan scroll lock dan menutup drawer: `drawer_resize_cleanup: PASS`.
     - Pembedaan kontrol: viewport sempit 375×667 CSS px DPR 2 pointer fine (diuji via `matchMedia`) mengukur hamburger = 44px, tombol direktori main content = 44px, dan logout = 44px; desktop 1440×900 CSS px DPR 1 mouse pointer mengukur tombol direktori main content = 40px dan logout = 40px.
     - Skenario hardware `pointer: coarse` dicatat jujur sebagai `NOT_RUN` dengan alasan belum diuji pada konfigurasi pengujian ini (lingkungan headless Chromium mengevaluasi pointer fine), tanpa menyimpulkan ada/tidaknya perangkat fisik dari media query.
     - Jalur normal dan simulasi menggunakan satu fungsi pengolahan hasil autentikasi bersama: `handleAuthenticationOutcome()`.
     - Pengujian terisolasi logika runner (`node tests/interactive/verify-p011.mjs --test-auth-logic`) lulus 5/5 skenario (exit 0), dicatat sebagai **bukti logika runner terisolasi** (bukan login Supabase/browser end-to-end).
     - Runner membedakan assertion wajib dan opsional, dengan exit code deterministik non-zero pada setiap kegagalan atau ketidaklengkapan:
       - Kredensial tidak diset: status `INCOMPLETE` (exit 1, `docs/evidence/P0_11/p011-runner-no-creds.json`).
       - Login gagal: status `FAIL` (exit 1, `docs/evidence/P0_11/p011-runner-login-fail.json`).
       - Assertion wajib gagal: status `FAIL` (exit 1, `docs/evidence/P0_11/p011-runner-assertion-fail.json`).
       - Seluruh assertion wajib lulus: status `PASS` (exit 0, `docs/evidence/P0_11/p011-runner-pass.json`).
     - Referensi variabel lama `TEST_FAIL_MODE` telah dihapus tuntas; pemeriksaan statis `no-undef` lulus 0 error, dan verifikasi akhir jalur normal (`node tests/interactive/verify-p011.mjs --test-normal-end`) membuktikan alur mencapai `finalize()` dan keluar dengan exit code 0 (`docs/evidence/P0_11/p011-runner-normal-end-proof.json`).
     - Rekaman data interaksi browser historis (`docs/evidence/P0_11/p011-interaction-evidence.json`) dipertahankan persis sesuai timestamp aslinya (10 PASS wajib, 1 NOT_RUN opsional, exit 0) dan dicatat sebagai **anotasi review dokumentasi**.
  5. **Keamanan kredensial & resolusi akun staf (Selesai):** Kredensial tidak tertanam dalam kode runner; script membaca `TEST_STAFF_EMAIL` dan `TEST_STAFF_PASSWORD` dari environment variable. Seluruh berkas bukti JSON bebas dari penulisan nilai password, token, atau cookie sesi. Pada 27 September 2026, dengan izin eksplisit pengguna, password akun staf mock `helpdesk@gmail.com` berhasil diperbarui melalui Supabase Admin API, diverifikasi berhasil login melalui Supabase Auth (sesi verifikasi kemudian ditutup), dan pengguna telah mengonfirmasi bahwa akun dapat digunakan kembali secara normal.
- Skip link `<a href="#main-content">` di awal DOM menerima fokus Tab pertama (`skip_link_focused.png` - bukti historis dipertahankan).
- Proteksi sesi: unauthenticated redirect HTTP 307 ke `/login`; Server Action logout membersihkan sesi dan mengarahkan ke `/login`.
- Pemeriksaan statis: typecheck pass (0 error), linter pass (0 error pada `app/` dan `components/`), unit tests 105/105 pass (**bukti historis**, bukan pengujian baru).

**Catatan/Blocker**

Implementasi dan penutupan bukti P0.11 selesai penuh (✅ Done).  
Implementasi UI (sidebar penuh 216px, sidebar ringkas 72px dengan floating tooltip bebas overflow, drawer modal mobile dengan focus trap dan pembersihan scroll lock, 0 warna literal pada shell, direktori 12 pelanggan normal) dan determinisme runner (exit code nonzero pada kegagalan/ketidaklengkapan, exit code 0 saat wajib lulus) telah terverifikasi secara teknis.

Seluruh temuan review dan kriteria penutupan telah terpenuhi, termasuk resolusi akun staf mock pada 27 September 2026 (pembaruan password via Supabase Admin API atas izin eksplisit pengguna, verifikasi login via Supabase Auth, penutupan sesi verifikasi, dan konfirmasi akun dari pengguna). Langkah berikutnya adalah [P2.1](#task-p2-1) (ChannelAdapter inbound Telegram dan pembatasan tester).

</details>

[Kembali ke navigasi](#navigasi)

---

<a id="p1"></a>

## P1 — Domain & Data

| Task ID                | Nama Task                                                         | Status         | Dependency                         | Decision ID Terkait |
| ---------------------- | ----------------------------------------------------------------- | -------------- | ---------------------------------- | ------------------- |
| [P1.1.1](#task-p1-1-1) | Resolusi identitas sender dan layanan                             | ✅ Done        | P0.7, P0.8, P0.9                   | D73                 |
| [P1.1.2](#task-p1-1-2) | Klasifikasi keyword dan hasil analisis berversi                   | ✅ Done        | P0.1                               | D73                 |
| [P1.2](#task-p1-2)     | Decision engine kandidat template                                 | ✅ Done        | P1.1.1, P1.1.2, P1.5.2             | D65, D66, D67, D74  |
| [P1.3](#task-p1-3)     | Lifecycle episode, asosiasi pesan, dan suppression                | ✅ Done        | P1.1.1, P1.1.2, P1.2               | D65, D76            |
| [P1.4.1](#task-p1-4-1) | Schema persistence dan koneksi transaksi PostgreSQL               | ✅ Done        | P0.7, P0.8, P1.3                   | D66, D77            |
| [P1.4.2](#task-p1-4-2) | Penyimpanan ingress, identity baru, episode, dan assessment       | ✅ Done        | P1.4.1, P1.1.1, P1.1.2, P1.2, P1.3 | D68, D76, D77       |
| [P1.4.3](#task-p1-4-3) | Reservasi claim episode dan incident/event atomik                 | ✅ Done        | P1.4.2                             | D66, D67, D77       |
| [P1.4.4](#task-p1-4-4) | Rekonsiliasi identity dan ledger claim                            | ✅ Done        | P1.4.3                             | D66, D76, D77       |
| [P1.4.5](#task-p1-4-5) | Mutasi lifecycle staf dengan versi, audit, dan request ID         | ✅ Done        | P1.3, P1.4.2                       | D66, D76, D77       |
| [P1.5.1](#task-p1-5-1) | Schema dan fixture jaringan mock                                  | ✅ Done        | P0.7, P0.9                         | D67, D72            |
| [P1.5.2](#task-p1-5-2) | NetworkStatusProvider, MockProvider, freshness, dan agregasi area | ✅ Done        | P1.5.1                             | D60, D67, D72       |
| [P1.5.3](#task-p1-5-3) | API pemeriksaan mock khusus staf                                  | ✅ Done        | P1.5.2, P0.6                       | D66, D72            |

### Detail task

<a id="task-p1-1-1"></a>

<details>
<summary>P1.1.1 — Resolusi identitas sender dan layanan</summary>

**Acceptance Criteria**

Identitas dicocokkan berdasarkan channel/account/sender; hanya customer dan layanan valid yang di-resolve; no-match, unverified, konflik, inactive, timeout, dan lookup error menghasilkan alasan aman; isi chat tidak menjadi bukti identitas.

**Bukti/Verifikasi**

`lib/domain/sender-identity.ts`, `lib/providers/stored-identity-lookup.ts`, `lib/repositories/sender-identities.ts`; `README.md` merujuk `docs/P1_1_REVIEW.md`: 7 skenario integrasi P1.1 lulus pada 21 September 2026, termasuk isolasi channel/account, ambiguitas layanan, RLS, dan unique constraint.

**Catatan/Blocker**

Scope read-only; pembuatan identity sender baru dan penautan terverifikasi ditangani pada task persistence/integrasi.

</details>

<a id="task-p1-1-2"></a>

<details>
<summary>P1.1.2 — Klasifikasi keyword dan hasil analisis berversi</summary>

**Acceptance Criteria**

Lima keyword PRD dicocokkan setelah normalisasi dengan batas kata; pesan ambigu/non-teks masuk review; hasil menyertakan category, reason, ruleVersion, dan matchedKeywords tanpa LLM.

**Bukti/Verifikasi**

`lib/domain/message-classification.ts`, `lib/application/analyze-inbound-message.ts`, `tests/domain/message-classification.test.ts`; `docs/P1_1_REVIEW.md` yang dirujuk README mencatat 48 unit test lulus: 28 pengujian baru P1.1 dan 20 regresi jaringan; lint/build lulus pada 21 September.

**Catatan/Blocker**

Matching literal belum membuktikan target precision/recall pada dataset pilot. Penyimpanan label dan koreksi staf mengikuti P2.8.

</details>

<a id="task-p1-2"></a>

<details>
<summary>P1.2 — Decision engine kandidat template</summary>

**Acceptance Criteria**

Satu kandidat dipilih sesuai prioritas; GENERAL tanpa lookup/keyword; bukti dan freshness divalidasi; mode SHADOW/LOS_AND_GENERIC/FULL serta emergency stop diterapkan; `dispatchAuthorized=false`.

**Bukti/Verifikasi**

`lib/domain/triage-contracts.ts`, `lib/domain/triage-decision.ts`, `tests/domain/triage-decision.test.ts`, `tests/integration/triage.test.ts`; `docs/P1_2_REVIEW.md` yang dirujuk README mencatat 76 unit test dan 17 skenario integrasi lulus, lint/build lulus pada 21 September 2026.

**Catatan/Blocker**

Bukti hanya untuk pemilihan kandidat; belum mencakup renderer, CRUD incident, atau pengiriman.

</details>

<a id="task-p1-3"></a>

<details>
<summary>P1.3 — Lifecycle episode, asosiasi pesan, dan suppression</summary>

**Acceptance Criteria**

NEW/IN_PROGRESS/RESOLVED/CLOSED mengikuti kontrak; CLOSED final; versi request diperiksa; primary/target menentukan asosiasi; pesan non-komplain/ambigu tidak memicu reopen; GENERAL eligible dapat mengizinkan pembuatan atau asosiasi episode tanpa reopen; reopen tidak mereset debounce; takeover/split menghentikan first response; audit membedakan aktor staf dan inbound; fungsi deterministik dan tidak memutasi snapshot.

**Bukti/Verifikasi**

`lib/domain/episode-contracts.ts`, `lib/domain/episode-lifecycle.ts`, `tests/domain/episode-lifecycle.test.ts`; `docs/P1_3_REVIEW.md`, `docs/EPISODE_LIFECYCLE.md`, dan `docs/evidence/P1_3/p13-verification-evidence.md`:
- Suite pengujian unit lifecycle (`tests/domain/episode-lifecycle.test.ts`): **26/26 checks PASS, 0 FAIL** pada review independen terdahulu (25 September 2026).
- Suite regresi domain/provider (`npm test`): **105/105 PASS, 0 FAIL** mencakup 8 file (26 episode-lifecycle, 10 message-classification, 9 network-status, 3 reply-claim, 11 sender-identity, 28 triage-decision, 7 identity-lookup, 11 mock-provider).
- Matriks acceptance criteria mencakup seluruh 11 poin terpetakan ke fungsi domain murni dan terverifikasi secara empiris.

**Catatan/Blocker**

Selesai (Done). Seluruh 11 poin acceptance criteria terpenuhi secara deterministik tanpa I/O. Domain memisahkan posisi pesan (`isFollowUp`), suppression status (`suppressionApplies`), dan kelayakan respons pertama (`firstResponseCandidate`); seluruh hasil tetap `dispatchAuthorized=false`.

</details>

<a id="task-p1-4-1"></a>

<details>
<summary>P1.4.1 — Schema persistence dan koneksi transaksi PostgreSQL</summary>

**Acceptance Criteria**

Migration menyediakan episode, ingress/job, messages/assessment, claim, outbound intent, audit, dan dedup aksi staf; FK/check/unique/RLS sesuai; mutasi menggunakan satu koneksi dan transaksi/lock bersama.

**Bukti/Verifikasi**

`supabase/migrations/20260922090000_create_episode_persistence.sql`, `lib/postgres/server.ts`, `lib/postgres/transaction.ts`; `docs/evidence/P1_4/p14-verification-evidence.md` dan `docs/P1_4_REVIEW.md` mencatat migration telah terkonfirmasi diterapkan di database lokal sebelum pengujian verifikasi dijalankan (`npx supabase migration list --local`), dan suite integrasi `tests/integration/persistence.test.ts` mencatat 11 skenario integrasi lulus (12 PASS termasuk satu pengujian induk) membuktikan RLS, penolakan privilege peran anon/authenticated (error 42501), single connection per transaksi, serta advisory lock prototype pada 25 September 2026.

**Catatan/Blocker**

Selesai (Done). Seluruh skenario transaksi dan proteksi schema terbukti pada database Supabase lokal.

</details>

<a id="task-p1-4-2"></a>

<details>
<summary>P1.4.2 — Penyimpanan ingress, identity baru, episode, dan assessment</summary>

**Acceptance Criteria**

Identity sender tersedia; ingress+job tersimpan atomik; dedup mencakup channel/account/chat/message; episode, pesan, assessment, dan audit konsisten; pemrosesan ulang mengembalikan hasil tersimpan.

**Bukti/Verifikasi**

`HelpdeskPersistence.receive()` dan `process()` pada `lib/application/helpdesk-persistence.ts`, `lib/repositories/episode-store.ts`, `tests/integration/persistence.test.ts`; `docs/evidence/P1_4/p14-verification-evidence.md` membuktikan bahwa 8 request paralel identik hanya menghasilkan 1 ingress event dan 1 processing job; dedup membedakan `chat_id` dan `channel_account_id`; pemrosesan ulang mengembalikan hasil yang idempoten; serta pesan dari pengirim Telegram berbeda pada satu layanan yang sama menghasilkan 1 primary episode dan 1 reservasi.

**Catatan/Blocker**

Selesai (Done). Atomisitas ingress + job dan idempotensi processing terbukti secara empiris. Skenario 2 membuktikan dua pengirim Telegram berbeda pada satu layanan; bukan pengujian multi-channel (misal Telegram + WhatsApp).

</details>

<a id="task-p1-4-3"></a>

<details>
<summary>P1.4.3 — Reservasi claim episode dan incident/event atomik</summary>

**Acceptance Criteria**

Claim episode dan incident/event diperoleh bersama; konflik tidak meninggalkan claim parsial; SHADOW tidak mengambil claim; follow-up/suppression tidak mendapat jatah baru; reservasi tidak mengotorisasi dispatch.

**Bukti/Verifikasi**

`lib/domain/reply-claim.ts`, `EpisodeStore.reserve()` pada `lib/repositories/episode-store.ts`, `tests/domain/reply-claim.test.ts`, `tests/integration/persistence.test.ts`; `docs/evidence/P1_4/p14-verification-evidence.md` membuktikan reservasi atomik episode + incident claim via savepoint; konflik incident claim membatalkan seluruh reservasi tanpa meninggalkan claim parsial; mode SHADOW dan status emergency stop terbukti tidak mengambil claim pengiriman (`dispatchAuthorized=false`).

**Catatan/Blocker**

Selesai (Done). Reservasi bukan izin kirim; tidak ada dispatch yang diotorisasi.

</details>

<a id="task-p1-4-4"></a>

<details>
<summary>P1.4.4 — Rekonsiliasi identity dan ledger claim</summary>

**Acceptance Criteria**

Linking terverifikasi mempertahankan episode/claim lama; tidak memberi jatah balasan baru; primary dipilih konsisten; pending otomatis dibatalkan dan in-flight dilaporkan.

**Bukti/Verifikasi**

`lib/application/link-identity.ts`, wrapper `verifyAndLinkIdentity()` pada `lib/application/staff-episodes.server.ts`, `tests/integration/persistence.test.ts`; `docs/evidence/P1_4/p14-verification-evidence.md` membuktikan linking identity menggabungkan ledger claim tanpa menghapus claim lama, mempertahankan primary episode, membatalkan outbound intent pending, mempertahankan intent `in_flight`, dan menonaktifkan automation pada episode terkait (`automation_suppressed=true`).

**Catatan/Blocker**

Selesai (Done). Logika rekonsiliasi dan ledger claim terverifikasi runtime pada database lokal.

</details>

<a id="task-p1-4-5"></a>

<details>
<summary>P1.4.5 — Mutasi lifecycle staf dengan versi, audit, dan request ID</summary>

**Acceptance Criteria**

Aktor berasal dari sesi server; versi stale ditolak; request berulang idempoten; perubahan lifecycle/split/primary dan audit atomik; pending automation dihentikan saat takeover.

**Bukti/Verifikasi**

`HelpdeskPersistence.staffAction()` pada `lib/application/helpdesk-persistence.ts`, `lib/application/staff-episodes.server.ts`, `tests/integration/persistence.test.ts`; `docs/evidence/P1_4/p14-verification-evidence.md` membuktikan validasi `expectedVersion`; penolakan versi stale (`version_mismatch`); replay request ID identik yang idempoten; penolakan konflik request ID (`request_id_conflict`); penyimpanan balasan manual yang idempoten; pembatalan auto-reply pending saat takeover; serta aksi split yang menaikkan versi episode sumber (`version = v + 1`) dan penunjukan primary eksplisit.

**Catatan/Blocker**

Selesai (Done). Layanan transaksi staf internal terverifikasi atomik dan idempoten menggunakan ID staf langsung. Pengujian ini membuktikan transaksi DB dan concurrency guard, bukan pengujian autentikasi end-to-end sesi browser/cookie yang ditangani pada P0.6.

</details>

<a id="task-p1-5-1"></a>

<details>
<summary>P1.5.1 — Schema dan fixture jaringan mock</summary>

**Acceptance Criteria**

Tabel skenario, ONU, upstream, dan dampak layanan tersedia; fixture terisolasi dan idempoten; event ID stabil; pembacaan/seed ulang tidak menyegarkan observasi.

**Bukti/Verifikasi**

`supabase/migrations/20260920090000_create_mock_network_status.sql`, `supabase/fixtures/network.sql`, `supabase/fixtures/refresh-network-observations.sql`; README bagian “Validasi fondasi provider (20 September 2026)” mencatat skenario, constraint, RLS, dan seed idempoten lulus.

**Catatan/Blocker**

Scope data simulasi; tidak membuktikan integrasi OLT/NMS nyata.

</details>

<a id="task-p1-5-2"></a>

<details>
<summary>P1.5.2 — NetworkStatusProvider, MockProvider, freshness, dan agregasi area</summary>

**Acceptance Criteria**

Provider membedakan LOS/online/unknown dan kegagalan; freshness 5 menit serta threshold ≥3 LOS, rasio ≥50%, coverage ≥80% diterapkan; bukti upstream dan ONU terpisah; deadline 2 detik.

**Bukti/Verifikasi**

`lib/providers/network-status-provider.ts`, `lib/providers/mock-provider.ts`, `lib/domain/network-status.ts`; README mencatat 20 unit test serta integrasi database lulus pada 20 September 2026; kontrak pada `docs/NETWORK_PROVIDER.md`.

**Catatan/Blocker**

Threshold berlaku untuk fixture prototype; status online bukan bukti kualitas internet normal.

</details>

<a id="task-p1-5-3"></a>

<details>
<summary>P1.5.3 — API pemeriksaan mock khusus staf</summary>

**Acceptance Criteria**

Endpoint read-only mensyaratkan sesi staf dan `NETWORK_PROVIDER=mock`; input divalidasi; response memakai envelope/no-cache; not-found, provider error, dan timeout dibedakan.

**Bukti/Verifikasi**

`app/api/network-status/route.ts`, `lib/application/inspect-network.ts`, `tests/integration/network.test.ts`; README mencatat pengujian endpoint terautentikasi, envelope/no-cache, lint/build lulus pada 20 September.

**Catatan/Blocker**

Hasil tersedia melalui API; panel evidence dashboard mengikuti P2.7.

</details>

[Kembali ke navigasi](#navigasi)

---

<a id="p2"></a>

## P2 — Vertical Slice Shadow

| Task ID              | Nama Task                                             | Status         | Dependency                         | Decision ID Terkait |
| -------------------- | ----------------------------------------------------- | -------------- | ---------------------------------- | ------------------- |
| [P2.1](#task-p2-1)   | ChannelAdapter inbound Telegram dan pembatasan tester | ✅ Done        | P1.4.2                             | D50, D67, D68, D81, D82 |
| [P2.2](#task-p2-2)   | Webhook Telegram dengan secret dan ACK persisten      | ✅ Done        | P2.1, P1.4.2                       | D68, D77, D82, D83, D84 |
| [P2.3](#task-p2-3)   | Conversation 24 jam dan pengaitan riwayat pesan       | ⬜ Not Started | P1.4.2                             | D65, D69            |
| [P2.4](#task-p2-4)   | Orkestrasi inbound ke assessment SHADOW               | 🟡 In Progress | P2.2, P2.3, P1.4.2, P1.5.2         | D65, D67, D68, D77  |
| [P2.5](#task-p2-5)   | Worker pemrosesan job dengan lease dan attempt        | ⬜ Not Started | P2.4                               | D68                 |
| [P2.6](#task-p2-6)   | Inbox/antrean sebagai landing dashboard               | ⬜ Not Started | P0.11, P0.6, P2.3, P2.4            | D65, D69, D71       |
| [P2.7](#task-p2-7)   | Panel konteks identitas dan evidence jaringan         | ⬜ Not Started | P2.6, P1.5.3                       | D69, D71, D72       |
| [P2.8](#task-p2-8)   | Label dan koreksi klasifikasi oleh staf               | ⬜ Not Started | P2.6, P1.1.2                       | D65, D66, D69       |
| [P2.9](#task-p2-9)   | Direktori pelanggan pendukung yang read-only          | ✅ Done        | P0.6, P0.8, P0.9                   | D70, D71            |
| [P2.10](#task-p2-10) | Konfigurasi dan deployment prototype SHADOW           | ⬜ Not Started | P0.2, P0.4, P0.5, P2.2, P2.5, P2.6 | D50, D67, D68       |
| [P2.11](#task-p2-11) | Verifikasi vertical slice SHADOW end-to-end           | ⬜ Not Started | P2.7, P2.8, P2.10                  | D65, D67, D68       |

### Detail task

<a id="task-p2-1"></a>

<details>
<summary>P2.1 — ChannelAdapter inbound Telegram dan pembatasan tester</summary>

**Acceptance Criteria**

Payload Telegram dinormalisasi tanpa rule domain di adapter; account/chat/message tetap terpisah; private chat dan tester allowlist divalidasi; input invalid/terlalu besar ditangani sesuai PRD.

**Bukti/Verifikasi**

`lib/adapters/channel-adapter-contracts.ts`, `lib/adapters/telegram/telegram-types.ts`, `lib/adapters/telegram/telegram-adapter.ts`, `tests/adapters/telegram-adapter.test.ts`, `docs/P2_1_REVIEW.md`, dan decision log D81, D82:
- Kontrak `InboundChannelAdapter` dan implementasi `TelegramChannelAdapter` memvalidasi input tak tepercaya, membedakan ukuran byte raw payload (`MAX_PAYLOAD_BYTES = 64KB`) sebelum parsing dari panjang teks (`MAX_TEXT_LENGTH = 4096`), serta memvalidasi struktur Telegram Update.
- Batas representasi tanggal: `message.date` divalidasi tidak melebihi batas atas representasi tanggal ECMAScript (`MAX_TELEGRAM_DATE_SECONDS = 8_640_000_000_000` detik); tanggal di luar rentang (termasuk `Number.MAX_SAFE_INTEGER`) ditolak sebagai `invalid_payload_structure` tanpa melempar exception `RangeError`, tanpa pembatasan usia pesan lampau atau penolakan tanggal masa depan yang valid.
- Pembatasan tester fail-closed: hanya `chat.type === "private"` dan pengirim terdaftar pada `testerAllowlist` yang diterima (`accepted`); grup, supergroup, channel, atau allowlist kosong ditolak (`rejected`, fail-closed). Konfigurasi allowlist campuran (misal `"987654321,not_a_number"`), token kosong, atau ID invalid pada helper dan constructor melempar error langsung dan menolak penerapan parsial secara diam-diam.
- Identitas terpisah: `channel="telegram"`, `channelAccountId` berasal dari konfigurasi tepercaya server, `senderExternalId` dari `from.id` numerik, `chatId` dari `chat.id`, dan `providerMessageId` dari `message_id`. Username Telegram tidak digunakan sebagai identitas tepercaya.
- Luaran terstruktur: `accepted` (menghasilkan `InboundReceipt` kompatibel dengan `HelpdeskPersistence.receive()` dan `NormalizedInboundMessage` untuk review staf), `unsupported` (`edited_message_ignored`, `unsupported_update_type`), dan `rejected` (`payload_too_large`, `invalid_json`, `non_private_chat`, `not_in_tester_allowlist`, dsb.) tanpa membocorkan secret atau payload.
- Pesan non-teks tester valid (foto, dokumen, suara, dsb.) dipertahankan metadata tipe pesannya; `receipt.text` diisi caption jika ada atau string kosong `""` jika tanpa caption, tanpa mengarang teks pelanggan.
- Pesan forward hanya mencatat penanda boolean `isForwarded: true` pada `normalized`, bukan rincian asal forward.
- 15 skenario unit test lulus 100% via `npm run test:unit` (total 120 unit tests proyek lulus, exit code 0); typecheck `npx tsc -p tsconfig.test.json` lulus 0 error; linter `npx eslint lib/adapters tests/adapters` lulus 0 error, 0 warning.

**Catatan/Blocker**

Implementasi ChannelAdapter selesai penuh (✅ Done). Adapter beroperasi murni in-memory tanpa I/O jaringan, mutasi DB, atau triage domain. Batas integrasi metadata: `result.receipt` kompatibel secara struktural dengan `HelpdeskPersistence.receive()`, tetapi pemanggilan `receive()` saja belum menyimpan metadata kaya (`messageType`, `hasMedia`, penanda `isForwarded`) ke tabel persistence `ingress_events`. Penerusan dan penyimpanan metadata ini ke persistence, bersama endpoint HTTP webhook dan verifikasi secret token, dilanjutkan pada [P2.2](#task-p2-2).

</details>

<a id="task-p2-2"></a>

<details>
<summary>P2.2 — Webhook Telegram dengan secret dan ACK persisten</summary>

**Acceptance Criteria**

Secret diperiksa sebelum efek samping (fail-closed jika missing/invalid/unconfigured); body dibaca dengan batas ukuran keras (streaming byte limit 64 KB); payload diproses via adapter P2.1; ingress, metadata kaya (tipe pesan, media, forward, caption, sent_at, sender_info), dan processing job committed secara atomik sebelum ACK; DB gagal menghasilkan non-success (HTTP 500 PERSISTENCE_FAILED); duplicate diterima idempoten (HTTP 200 duplicate=true) tanpa membuat pekerjaan ganda atau menimpa metadata asli; update tak didukung dan penolakan kebijakan tester mengembalikan HTTP 200 tanpa mutasi DB agar tidak memicu retry loop Telegram; tidak ada pemanggilan provider jaringan atau outbound pada jalur ACK.

**Bukti/Verifikasi**

`app/api/webhooks/telegram/route.ts`, `lib/application/telegram-inbound-service.ts`, `lib/application/helpdesk-persistence.ts`, `lib/application/persistence-contracts.ts`, `supabase/migrations/20260929100000_add_ingress_metadata.sql`, `tests/application/telegram-inbound-service.test.ts`, `tests/integration/telegram-webhook.test.ts`, `docs/P2_2_REVIEW.md`, dan decision log D83, D84:
- **Verifikasi Secret & Fail-Closed:** Header `X-Telegram-Bot-Api-Secret-Token` divalidasi timing-safe terhadap `TELEGRAM_WEBHOOK_SECRET`. Token salah, hilang, atau server unconfigured mengembalikan HTTP 401 Unauthorized sebelum pembacaan body atau efek samping database (terbukti pada unit test dan integration test).
- **Proteksi Ukuran Body:** `readLimitedRequestBody` membatasi streaming byte (max 64 KB) dan membatalkan stream seketika (*early abort*) jika terakumulasi melebihi batas, menghasilkan HTTP 413 Payload Too Large bahkan tanpa header `Content-Length`.
- **Lazy Factory & Bukti Rollback (D84):** Inisialisasi pool database dibungkus ke dalam factory lazy (`defaultPersistenceFactory`), membuktikan penolakan 401 tidak memanggil factory DB dan kegagalan inisialisasi menghasilkan 500 `DATABASE_UNAVAILABLE` yang aman. Pengujian integrasi menyuntikkan fault injection pada insert `processing_jobs` sebelum commit, dibuktikan melalui query di luar transaksi yang telah selesai bahwa tidak ada ingress yang committed (0 baris, message ID 70); setelah fault dilepas, retry dan duplicate menghasilkan tepat satu ingress dan satu job.
- **Persistensi Atomik & Resolusi D82:** Migrasi `20260929100000_add_ingress_metadata.sql` memperluas `ingress_events` dengan kolom `message_type`, `has_media`, `is_forwarded`, `caption`, `sent_at`, dan `sender_info`. `HelpdeskPersistence.receive()` menyimpan metadata ini secara atomik bersama baris `processing_jobs` (`status = 'pending'`) di dalam transaksi `inHelpdeskTransaction`. `sent_at` terbukti berbeda dari `received_at`.
- **Pesan Nonteks & Forward:** Foto tanpa caption menyimpan teks string kosong `""` (tanpa mengarang teks pelanggan), `has_media: true`, `caption: null`. Foto dengan caption menyimpan caption sebagai body dan kolom caption. Pesan forward mencatat `is_forwarded: true` tanpa mengubah identitas pengirim langsung.
- **Idempotensi & Dedup Konkuren:** Unique constraint `(channel, account_id, chat_id, provider_message_id)` mencegah duplikasi. Pengujian 5 pemanggilan handler paralel menggunakan objek Request simulasi menghasilkan tepat 1 baris ingress dan 1 baris job; 1 request mendapat `duplicate: false` dan 4 mendapat `duplicate: true` dengan ID ingress yang sama tanpa menimpa data asli.
- **Semantik ACK Telegram:** Update tak didukung (`edited_message`) dan penolakan tester mengembalikan HTTP 200 (`ignored`/`rejected`) tanpa mutasi DB untuk mencegah pengiriman berulang oleh Telegram. Kegagalan database mengembalikan HTTP 500 PERSISTENCE_FAILED untuk memicu retry Telegram.
- **Non-interferensi Jalur ACK:** Jalur webhook tidak memanggil mock network provider, evaluasi triage, maupun pengiriman outbound (triage count = 0, intent count = 0).
- **Hasil Pengujian Terarah:**
  - `tests/application/telegram-inbound-service.test.ts`: 10/10 unit tests pass (exit code 0).
  - `tests/integration/telegram-webhook.test.ts`: 11/11 PostgreSQL integration tests pass, termasuk tes induk (exit code 0).
  - Regresi unit test proyek (`npm run test:unit`): 130/130 tests pass (exit code 0).
  - Regresi persistence P1.4 (`npm run test:persistence:local`): 12/12 tests pass (exit code 0).
  - Statis & Linter (`npm run lint`): 0 error (exit code 0).
  - Build Next.js (`npm run build`): Keberhasilan build berasal dari sesi implementasi sebelumnya (exit code 0; route dinamis `ƒ /api/webhooks/telegram` terkompilasi); build setelah koreksi terakhir belum ditunjukkan dalam bukti eksekutor yang tersedia dan tidak dijalankan ulang pada sinkronisasi dokumentasi ini.

**Catatan/Blocker**

Implementasi P2.2 selesai penuh (✅ Done). Seluruh pengujian diverifikasi pada PostgreSQL lokal Supabase dengan payload simulasi Telegram resmi. Pendaftaran webhook publik ke Telegram Bot API nyata belum dilakukan (di luar cakupan P2.2). Langkah persiapan registrasi tersedia di docs/P2_2_REVIEW.md. Tahap berikutnya adalah [P2.3](#task-p2-3) (Conversation 24 jam) dan [P2.4](#task-p2-4) (Orkestrasi inbound ke assessment SHADOW).

</details>

<a id="task-p2-3"></a>

<details>
<summary>P2.3 — Conversation 24 jam dan pengaitan riwayat pesan</summary>

**Acceptance Criteria**

Conversation dikelompokkan berdasarkan inactivity 24 jam; pesan menyimpan identitas channel dan waktu penerimaan; pergantian conversation tidak mereset episode/debounce; pesan non-komplain tetap terlihat.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Tabel/kontrak conversation dan pengaitannya ke messages belum tersedia; persistence pesan P1.4 belum menutup scope ini.

</details>

<a id="task-p2-4"></a>

<details>
<summary>P2.4 — Orkestrasi inbound ke assessment SHADOW</summary>

**Acceptance Criteria**

Inbound menjalankan identitas, klasifikasi, pengambilan bukti, keputusan, dan asosiasi episode; assessment/handoff tersimpan; SHADOW tanpa claim atau outbound otomatis; I/O provider di luar transaksi.

**Bukti/Verifikasi**

`HelpdeskPersistence.process()` pada `lib/application/helpdesk-persistence.ts`, `lib/application/inspect-network.ts`; `docs/P1_4_REVIEW.md` mencatat proses persistence tersedia tetapi belum diuji dan belum terhubung ke webhook/worker.

**Catatan/Blocker**

Orkestrasi provider, conversation, webhook, dan worker belum tersambung end-to-end.

</details>

<a id="task-p2-5"></a>

<details>
<summary>P2.5 — Worker pemrosesan job dengan lease dan attempt</summary>

**Acceptance Criteria**

Job di-claim atomik dengan lease/attempt; pemicu paralel tidak memproses job yang sama; pekerjaan setelah ACK tercatat dan ditunggu runtime; crash sebelum selesai dapat dilanjutkan.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Penyimpanan `processing_jobs` tersedia sebagai fondasi P1.4; worker, lease, dan pengelolaan attempt runtime belum dibuat.

</details>

<a id="task-p2-6"></a>

<details>
<summary>P2.6 — Inbox/antrean sebagai landing dashboard</summary>

**Acceptance Criteria**

Inbox menampilkan percakapan dan episode, unread/status, filter, serta detail riwayat; non-komplain masuk review; data hanya tersedia bagi staf; polling baca 5 detik dan state loading/empty/error tersedia.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

README menyatakan inbox/antrean belum tersedia; landing saat ini masih dashboard sederhana.

</details>

<a id="task-p2-7"></a>

<details>
<summary>P2.7 — Panel konteks identitas dan evidence jaringan</summary>

**Acceptance Criteria**

Staf melihat layanan/topologi, source, observed_at, checked_at, freshness, coverage, alasan keputusan, dan unknown/stale; waktu tampil WIB; detail internal tidak masuk teks pelanggan.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

API pemeriksaan mock sudah tersedia; README menyatakan UI evidence belum dibuat.

</details>

<a id="task-p2-8"></a>

<details>
<summary>P2.8 — Label dan koreksi klasifikasi oleh staf</summary>

**Acceptance Criteria**

Staf dapat menyimpan label/koreksi bersama aktor dan waktu; hasil rule asli dan versinya tetap tersimpan; data dapat digunakan untuk evaluasi klasifikasi PRD §13.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Hasil klasifikasi berversi sudah ada, tetapi penyimpanan label koreksi dan UI belum tersedia.

</details>

<a id="task-p2-9"></a>

<details>
<summary>P2.9 — Direktori pelanggan pendukung yang read-only</summary>

**Acceptance Criteria**

Direktori menyediakan pencarian nama/kode, filter status administrasi, pagination 25, relasi layanan–ODP–ODC, dan identitas channel; status administrasi tidak disajikan sebagai status jaringan.

**Bukti/Verifikasi**

`app/dashboard/customers/page.tsx`, `app/dashboard/customers/loading.tsx`, `lib/repositories/customers.ts`; V20 mencatat HTTP dengan sesi staf, pencarian/filter literal, empty state, dan pembatasan akses berhasil; README merinci fitur direktori.

**Catatan/Blocker**

Scope fungsi direktori pendukung; review visual menyeluruh mengikuti P5.2.

</details>

<a id="task-p2-10"></a>

<details>
<summary>P2.10 — Konfigurasi dan deployment prototype SHADOW</summary>

**Acceptance Criteria**

Supabase prototype, Vercel env, bot token/secret, dan tester IDs terkonfigurasi; webhook HTTPS dapat dipakai; secret tetap server-side; default SHADOW; smoke test deployment tercatat.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

README menyatakan deployment belum diverifikasi; belum ditemukan konfigurasi/hasil deployment yang membuktikan task ini telah dikerjakan.

</details>

<a id="task-p2-11"></a>

<details>
<summary>P2.11 — Verifikasi vertical slice SHADOW end-to-end</summary>

**Acceptance Criteria**

Komplain dummy Telegram muncul di inbox beserta episode/assessment; duplicate tidak menggandakan data; unknown/non-komplain tetap terlihat; tidak ada outbound otomatis atau claim debounce di SHADOW.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Belum ada catatan uji Telegram → webhook → worker → dashboard; hasil unit/integrasi domain bukan bukti end-to-end.

</details>

[Kembali ke navigasi](#navigasi)

---

<a id="p3"></a>

## P3 — Balas & Penanganan

| Task ID            | Nama Task                                               | Status         | Dependency                          | Decision ID Terkait |
| ------------------ | ------------------------------------------------------- | -------------- | ----------------------------------- | ------------------- |
| [P3.1](#task-p3-1) | Renderer template tetap dan snapshot teks               | ⬜ Not Started | P1.2, P1.4.1                        | D65, D66, D69       |
| [P3.2](#task-p3-2) | Pemeriksaan terakhir sebelum dispatch                   | ⬜ Not Started | P1.4.3, P2.1, P2.5, P3.1            | D66, D67, D68, D77  |
| [P3.3](#task-p3-3) | Pengiriman Telegram melalui ChannelAdapter              | ⬜ Not Started | P2.1, P3.2                          | D50, D65, D67       |
| [P3.4](#task-p3-4) | Worker outbound, delivery attempt, dan retry aman       | ⬜ Not Started | P3.3                                | D68                 |
| [P3.5](#task-p3-5) | Composer balasan staf dan takeover automation           | 🟡 In Progress | P2.6, P1.4.5, P3.4                  | D65, D66, D68, D77  |
| [P3.6](#task-p3-6) | Catatan internal pada percakapan                        | ⬜ Not Started | P2.6                                | D65, D69            |
| [P3.7](#task-p3-7) | Kontrol lifecycle dan verifikasi identitas di dashboard | ⬜ Not Started | P2.6, P1.4.4, P1.4.5                | D65, D66, D76, D77  |
| [P3.8](#task-p3-8) | Recovery melalui inbound dan dashboard                  | ⬜ Not Started | P2.5, P2.6, P3.4                    | D68                 |
| [P3.9](#task-p3-9) | Verifikasi dan rollout tester LOS_AND_GENERIC           | ⬜ Not Started | P2.11, P3.4, P3.5, P3.6, P3.7, P3.8 | D65, D66, D67, D68  |

### Detail task

<a id="task-p3-1"></a>

<details>
<summary>P3.1 — Renderer template tetap dan snapshot teks</summary>

**Acceptance Criteria**

Key/placeholder divalidasi; template kosong/invalid memblokir dispatch; estimasi kosong memakai fallback PRD; teks aktual dan versi tersimpan; semua outbound memakai prefix simulasi; tidak ada konten generatif.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

README menyatakan renderer belum tersedia; pengelolaan versi melalui UI mengikuti P4.3.

</details>

<a id="task-p3-2"></a>

<details>
<summary>P3.2 — Pemeriksaan terakhir sebelum dispatch</summary>

**Acceptance Criteria**

Sebelum send, periksa handoff tersimpan, tester/private chat, follow-up/takeover, claim, template, mode penerimaan/terbaru, emergency stop, serta incident yang relevan; perubahan mode tidak memutar backlog SHADOW.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Decision engine dan reservasi tetap `dispatchAuthorized=false`; belum ada jalur otorisasi akhir pengiriman.

</details>

<a id="task-p3-3"></a>

<details>
<summary>P3.3 — Pengiriman Telegram melalui ChannelAdapter</summary>

**Acceptance Criteria**

Balasan otomatis dan staf memakai jalur adapter yang sama; tujuan hanya tester allowlist; prefix simulasi wajib; provider ID dan hasil pasti/ambigu dikembalikan tanpa mengklaim pesan telah dibaca.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

README menyatakan pengiriman balasan belum tersedia; tidak ada bukti pesan sampai tester.

</details>

<a id="task-p3-4"></a>

<details>
<summary>P3.4 — Worker outbound, delivery attempt, dan retry aman</summary>

**Acceptance Criteria**

Attempt disimpan sebelum HTTP; accepted menyimpan provider ID; timeout/crash setelah dispatch menjadi unknown tanpa retry buta; kegagalan pasti retryable mengikuti backoff/Retry-After maksimal 3 total attempt; permanen menjadi failed.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Antrean `outbound_intents` P1.4 belum merupakan implementasi worker/attempt pengiriman; belum ada hasil uji crash atau provider.

</details>

<a id="task-p3-5"></a>

<details>
<summary>P3.5 — Composer balasan staf dan takeover automation</summary>

**Acceptance Criteria**

Staf menulis dan mengirim dari dashboard; request ID mencegah klik ganda; balasan tersimpan dan tampil di riwayat; pending first response dihentikan atomik; in-flight/unknown ditampilkan; draft bertahan saat gagal.

**Bukti/Verifikasi**

Aksi `manual_reply` pada `lib/application/helpdesk-persistence.ts` menyimpan outbound intent dan membatalkan pending; `tests/integration/persistence.test.ts` memuat skenario idempotensi; `docs/P1_4_REVIEW.md` menyatakan test belum dijalankan dan belum ada send.

**Catatan/Blocker**

Composer, endpoint/Server Action publik, integrasi dispatch, delivery UI, dan verifikasi klik ganda belum tersedia.

</details>

<a id="task-p3-6"></a>

<details>
<summary>P3.6 — Catatan internal pada percakapan</summary>

**Acceptance Criteria**

Catatan internal menyimpan aktor/waktu, terlihat berbeda dari balasan pelanggan, dan tidak pernah masuk antrean pengiriman channel; AC-09 lulus untuk isolasi catatan.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Belum ditemukan penyimpanan atau UI catatan internal.

</details>

<a id="task-p3-7"></a>

<details>
<summary>P3.7 — Kontrol lifecycle dan verifikasi identitas di dashboard</summary>

**Acceptance Criteria**

Staf dapat mulai menangani, resolve dengan catatan, reopen, close, split/pilih primary, serta menautkan identitas setelah verifikasi; konflik versi terlihat; tidak ada transisi otomatis hanya karena jaringan online.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Layanan domain/persistence tersedia sebagai fondasi; UI dan endpoint publik untuk aksi staf belum dibuat.

</details>

<a id="task-p3-8"></a>

<details>
<summary>P3.8 — Recovery melalui inbound dan dashboard</summary>

**Acceptance Criteria**

Inbound memicu drain terbatas; dashboard memicu recovery terautentikasi setiap 30 detik dan menyediakan tombol proses ulang; lease mencegah duplikasi; unknown send tidak di-retry buta.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Worker/recovery belum tersedia; tanpa inbound/dashboard aktif, prototype belum menjanjikan recovery selalu berjalan.

</details>

<a id="task-p3-9"></a>

<details>
<summary>P3.9 — Verifikasi dan rollout tester LOS_AND_GENERIC</summary>

**Acceptance Criteria**

Skenario keselamatan tahap kirim lulus; Akbar memilih tahap kirim awal; balasan sampai tester; ONLINE_CHECK menjadi GENERIC; klik ganda, takeover, duplicate, crash, dan unknown diuji; hasil tercatat.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Kelulusan decision engine belum membuktikan keselamatan pengiriman nyata; aktivasi mode kirim belum memiliki bukti.

</details>

[Kembali ke navigasi](#navigasi)

---

<a id="p4"></a>

## P4 — Outage & Controls

| Task ID            | Nama Task                                       | Status         | Dependency                               | Decision ID Terkait         |
| ------------------ | ----------------------------------------------- | -------------- | ---------------------------------------- | --------------------------- |
| [P4.1](#task-p4-1) | Lifecycle dan UI incident manual                | ⬜ Not Started | P1.4.1, P2.6                             | D2, D34, D35, D36, D65, D66 |
| [P4.2](#task-p4-2) | Network event dan relasi lintas episode         | 🟡 In Progress | P1.5.1, P1.4.3, P2.7                     | D65, D66, D67, D77          |
| [P4.3](#task-p4-3) | Pengelolaan template dan versi aktif            | ⬜ Not Started | P3.1, P4.1                               | D65, D69                    |
| [P4.4](#task-p4-4) | Pengaturan mode, emergency stop, dan allowlist  | 🟡 In Progress | P1.4.1, P2.1, P3.2, P2.6                 | D66, D67, D68, D77          |
| [P4.5](#task-p4-5) | Log keputusan, audit, dan kesehatan pekerjaan   | ⬜ Not Started | P2.6, P3.4, P3.8, P4.1                   | D68, D69                    |
| [P4.6](#task-p4-6) | Simulator skenario jaringan pada dashboard      | ⬜ Not Started | P1.5.1, P1.5.3, P2.7, P4.4               | D67, D69, D72               |
| [P4.7](#task-p4-7) | Retensi data tanpa mereset debounce             | ⬜ Not Started | P1.4.3, P3.4, P4.1                       | D68                         |
| [P4.8](#task-p4-8) | Verifikasi prioritas dan debounce lintas sumber | ⬜ Not Started | P3.9, P4.1, P4.2, P4.3, P4.4, P4.5, P4.7 | D65, D66, D67, D68          |

### Detail task

<a id="task-p4-1"></a>

<details>
<summary>P4.1 — Lifecycle dan UI incident manual</summary>

**Acceptance Criteria**

Create langsung ACTIVE; maksimal satu manual ACTIVE ditegakkan DB; AREA wajib affected ID; reopen memakai ID sama; close normal manual; force-close wajib alasan; update versi dan audit atomik; edit tidak mengirim ulang.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Snapshot incident pada decision engine bukan CRUD/lifecycle incident; tabel incident dan UI belum tersedia.

</details>

<a id="task-p4-2"></a>

<details>
<summary>P4.2 — Network event dan relasi lintas episode</summary>

**Acceptance Criteria**

Event dummy memiliki ID stabil dan dapat menautkan banyak episode; perubahan bukti setelah respons pertama tidak mengirim ulang; event pulih tidak menutup episode otomatis; kejadian baru memakai ID baru.

**Bukti/Verifikasi**

Fixture event pada `supabase/fixtures/network.sql`; `complaint_evidence_links` pada migration P1.4 dan `EpisodeStore.evidence()` pada `lib/repositories/episode-store.ts`; README mencatat fixture terverifikasi, tetapi P1.4 belum diuji.

**Catatan/Blocker**

Registry/lifecycle `network_events`, hubungan terpadu, dan tampilan gangguan otomatis belum lengkap; korelasi produksi/hysteresis tetap OPEN.

</details>

<a id="task-p4-3"></a>

<details>
<summary>P4.3 — Pengelolaan template dan versi aktif</summary>

**Acceptance Criteria**

Staf mengelola default/per-incident; tepat satu versi aktif per scope/key; override incident didahulukan; preview dummy dan validasi placeholder tersedia; edit tidak mengubah snapshot riwayat atau mengirim ulang.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Tabel versi template dan UI pengelolaannya belum tersedia; kontrak key pada P1.2 bukan implementasi fitur ini.

</details>

<a id="task-p4-4"></a>

<details>
<summary>P4.4 — Pengaturan mode, emergency stop, dan allowlist</summary>

**Acceptance Criteria**

Pengaturan tervalidasi dan diaudit dengan versi; SHADOW default; mode tidak melonggarkan pesan lama; emergency stop menghentikan otomatis tetapi menjaga antrean/balasan staf; allowlist berlaku pada semua outbound.

**Bukti/Verifikasi**

Tabel `automation_settings` pada migration P1.4; pembacaan mode dan pembatasan receipt pada `lib/application/helpdesk-persistence.ts`; mode domain diuji pada P1.2, tetapi persistence P1.4 belum diuji.

**Catatan/Blocker**

Mutasi pengaturan, audit perubahan mode, pengelolaan allowlist, dan UI kontrol belum tersedia; belum ada bukti guard runtime end-to-end.

</details>

<a id="task-p4-5"></a>

<details>
<summary>P4.5 — Log keputusan, audit, dan kesehatan pekerjaan</summary>

**Acceptance Criteria**

Staf dapat melihat alasan keputusan, versi/bukti, aktivitas staf, failed/unknown/pending, attempt, dan umur job; waktu tampil WIB; data sensitif tidak bocor ke pelanggan.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Assessment dan audit persistence merupakan fondasi; halaman log/kesehatan dan query agregasinya belum tersedia.

</details>

<a id="task-p4-6"></a>

<details>
<summary>P4.6 — Simulator skenario jaringan pada dashboard</summary>

**Acceptance Criteria**

Staf dapat memilih skenario fixture untuk pemeriksaan prototype; pemilihan tidak mengubah mode global, tidak mengaktifkan incident manual, dan tidak memicu broadcast; source/waktu simulasi terlihat.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Fixture SQL dan parameter skenario API tersedia sebagai fondasi; UI simulator belum dibuat.

</details>

<a id="task-p4-7"></a>

<details>
<summary>P4.7 — Retensi data tanpa mereset debounce</summary>

**Acceptance Criteria**

Message/complaint/assessment dibersihkan 90 hari setelah episode final; inbound non-episode 90 hari dari penerimaan; audit incident 1 tahun; technical log 30 hari; claim yang masih diperlukan tetap dipertahankan.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Belum ditemukan mekanisme cleanup atau hasil uji retensi; wajib membuktikan AC-11 sebelum dinyatakan selesai.

</details>

<a id="task-p4-8"></a>

<details>
<summary>P4.8 — Verifikasi prioritas dan debounce lintas sumber</summary>

**Acceptance Criteria**

Manual GENERAL/AREA dan bukti otomatis menghasilkan satu jalur send; satu ACTIVE, reopen, perubahan template/mode, identity linking, dan event sama tidak memberi balasan kedua; race resolve-versus-send tercatat; AC-05/06/07/10/11 lulus.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Test domain prioritas P1.2 sudah ada, tetapi belum ada bukti uji terpadu incident/UI/dispatch/retensi.

</details>

[Kembali ke navigasi](#navigasi)

---

<a id="p5"></a>

## P5 — Pilot Lengkap

| Task ID            | Nama Task                                             | Status         | Dependency                                                         | Decision ID Terkait     |
| ------------------ | ----------------------------------------------------- | -------------- | ------------------------------------------------------------------ | ----------------------- |
| [P5.1](#task-p5-1) | Dataset berlabel dan evaluasi klasifikasi/template    | ⬜ Not Started | P2.8, P3.9                                                         | D65, D69, D73           |
| [P5.2](#task-p5-2) | Validasi UX, responsive, dan aksesibilitas alur utama | ⬜ Not Started | P0.4, P0.5, P0.10, P0.11, P2.7, P3.5, P3.6, P3.7, P4.3, P4.4, P4.5 | D69, D71                |
| [P5.3](#task-p5-3) | Acceptance suite terpadu AC-01–AC-12                  | ⬜ Not Started | P4.8, P5.2                                                         | D65, D66, D67, D68, D69 |
| [P5.4](#task-p5-4) | Uji burst, latency, dan metrik operasional            | ⬜ Not Started | P2.10, P3.8, P4.5                                                  | D68, D69                |
| [P5.5](#task-p5-5) | Rollout tester FULL setelah evaluasi                  | ⬜ Not Started | P4.4, P5.1, P5.3, P5.4                                             | D67                     |
| [P5.6](#task-p5-6) | Laporan pilot dan demo penerimaan Akbar               | ⬜ Not Started | P5.5                                                               | D65, D69, D71           |

### Detail task

<a id="task-p5-1"></a>

<details>
<summary>P5.1 — Dataset berlabel dan evaluasi klasifikasi/template</summary>

**Acceptance Criteria**

≥100 pesan berlabel dengan kelas terwakili; precision dan recall masing-masing ≥90%; koreksi template ≤5%; dataset, metode perhitungan, kesalahan, dan hasil tercatat sesuai PRD §13.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Unit test keyword tidak menggantikan evaluasi dataset; belum ditemukan laporan metrik pilot.

</details>

<a id="task-p5-2"></a>

<details>
<summary>P5.2 — Validasi UX, responsive, dan aksesibilitas alur utama</summary>

**Acceptance Criteria**

AC-12 lulus: keyboard/fokus, laptop/mobile, label/status, loading/empty/error, konflik versi, dan draft saat gagal dapat ditangani; hasil review dicatat untuk alur utama.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Beberapa kontrol dasar sudah memakai label/focus style, tetapi belum ada bukti review visual/keyboard/mobile menyeluruh.

</details>

<a id="task-p5-3"></a>

<details>
<summary>P5.3 — Acceptance suite terpadu AC-01–AC-12</summary>

**Acceptance Criteria**

Seluruh skenario acceptance PRD diuji end-to-end; 0 duplicate reply dan kebocoran data; kegagalan provider, identitas, concurrency, reopen, takeover, dan retensi memiliki hasil tercatat.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Kelulusan suite domain/foundation terdahulu tidak menutup acceptance produk terpadu.

</details>

<a id="task-p5-4"></a>

<details>
<summary>P5.4 — Uji burst, latency, dan metrik operasional</summary>

**Acceptance Criteria**

Burst 20 inbound simultan diuji; ACK p95 ≤2 detik dan first response p95 ≤10 detik pada operasi normal; coverage/no-match/stale/error/debounce/takeover, hasil provider, dan umur pending dilaporkan; recovery diukur terpisah.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Angka PRD adalah target, bukan hasil terukur; belum ada laporan beban atau latency prototype.

</details>

<a id="task-p5-5"></a>

<details>
<summary>P5.5 — Rollout tester FULL setelah evaluasi</summary>

**Acceptance Criteria**

Setelah evaluasi tahap awal dan pemilihan rollout oleh Akbar, FULL mengaktifkan ONLINE_CHECK sesuai bukti; allowlist, prefix simulasi, emergency stop, dan tanpa backlog replay tetap berlaku; hasil pengiriman tercatat.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Mode FULL sudah dikenali domain, tetapi belum ada bukti rollout tester atau pengiriman pada mode tersebut.

</details>

<a id="task-p5-6"></a>

<details>
<summary>P5.6 — Laporan pilot dan demo penerimaan Akbar</summary>

**Acceptance Criteria**

Demo menunjukkan komplain tester masuk, assessment dapat dijelaskan, satu respons otomatis yang layak, balasan staf, dan kegagalan yang terlihat; laporan menyertakan acceptance/metrik/batas prototype; tiket tetap manual di Custpanel.

**Bukti/Verifikasi**

—

**Catatan/Blocker**

Belum ada catatan demo atau penerimaan pilot; WhatsApp, OLT/NMS/Custpanel nyata, dan kesiapan produksi tetap di luar P0–P5 prototype ini.

</details>

[Kembali ke navigasi](#navigasi)
