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
| [P2.3](#task-p2-3)   | Conversation 24 jam dan pengaitan riwayat pesan       | ✅ Done        | P1.4.2                             | D65, D69, D85, D86  |
| [P2.4](#task-p2-4)   | Orkestrasi inbound ke assessment SHADOW               | ✅ Done        | P2.2, P2.3, P1.4.2, P1.5.2         | D65, D67, D68, D77, D87, D88, D89, D90, D91, D92 |
| [P2.5](#task-p2-5)   | Worker pemrosesan job dengan lease dan attempt        | ✅ Done        | P2.4                               | D68, D93, D94, D95, D96, D97, D98, D99, D100 |
| [P2.6](#task-p2-6)   | Inbox/antrean sebagai landing dashboard               | ✅ Done        | P0.11, P0.6, P2.3, P2.4            | D65, D69, D71, D78, D101, D102, D103, D104, D105, D106, D107, D108, D109, D110, D111, D112, D113, D114, D115, D116, D117, D118, D119, D120, D121, D122, D123 |
| [P2.7](#task-p2-7)   | Panel konteks identitas dan evidence jaringan         | ✅ Done        | P2.6, P1.5.3                       | D69, D71, D72, D124, D125, D126, D127, D128, D129, D130, D131, D132, D133, D134, D135 |
| [P2.8](#task-p2-8)   | Label dan koreksi klasifikasi oleh staf               | ✅ Done        | P2.6, P1.1.2                       | D65, D66, D69, D136, D137, D138, D139, D140, D141, D142 |
| [P2.9](#task-p2-9)   | Direktori pelanggan pendukung yang read-only          | ✅ Done        | P0.6, P0.8, P0.9                   | D70, D71            |
| [P2.10](#task-p2-10) | Konfigurasi dan deployment prototype SHADOW           | ✅ Done        | P0.2, P0.4, P0.5, P2.2, P2.5, P2.6 | D50, D67, D68, D143, D144, D145, D146, D147, D148, D149, D150, D151, D152, D153, D154, D155, D156, D157 |
| [P2.11](#task-p2-11) | Verifikasi vertical slice SHADOW end-to-end           | ✅ Done        | P2.7, P2.8, P2.10                  | D65, D67, D68, D156, D157, D158 |

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
- **Verifikasi Webhook Telegram Nyata (Sesi Pemasangan):** Pipa penerimaan webhook nyata telah terbukti melalui alur Telegram (@upaznet_helpdesk_proto_bot) → Quick Tunnel HTTPS → perantara webhook → aplikasi lokal → PostgreSQL: pesan provider message ID 2 (Ingress ID `9682eff5-63cd-442a-820c-ae5e7313e4f5`) dan pesan /start (provider message ID 1) tersimpan dengan job pending di mode SHADOW; getWebhookInfo pending_update_count 0 tanpa error. Terpisah dari pengujian simulasi lokal, pemrosesan worker/assessment (P2.4/P2.5), dan bukan bukti SLA produksi. Detail: docs/P2_2_REVIEW.md §9.

**Catatan/Blocker**

Implementasi P2.2 selesai penuh (✅ Done). Seluruh pengujian diverifikasi pada PostgreSQL lokal Supabase dengan payload simulasi Telegram resmi. Pendaftaran webhook publik ke Telegram Bot API nyata belum dilakukan (di luar cakupan P2.2). Langkah persiapan registrasi tersedia di docs/P2_2_REVIEW.md. Tahap berikutnya adalah [P2.3](#task-p2-3) (Conversation 24 jam) dan [P2.4](#task-p2-4) (Orkestrasi inbound ke assessment SHADOW).

</details>

<a id="task-p2-3"></a>

<details>
<summary>P2.3 — Conversation 24 jam dan pengaitan riwayat pesan</summary>

**Acceptance Criteria**

Conversation dikelompokkan berdasarkan inactivity sliding window 24 jam secara independen dari urutan eksekusi worker; pesan penghubung yang tiba terlambat merekonsiliasi (merge) conversation tanpa meninggalkan referensi usang; pesan historis tidak merebut status aktif atau menutup conversation yang lebih baru; pesan menyimpan identitas channel dan waktu penerimaan server tepercaya (`received_at`); pergantian conversation tidak mereset episode maupun debounce serta mempertahankan klaim dan intent yang sudah ada; pesan non-komplain, `/start`, dan media tanpa teks tetap tersimpan dan dapat diambil sebagai riwayat tanpa mengarang teks pelanggan; out-of-order arrival ditangani secara deterministik; isolasi ketat tuple `(channel, account_id, chat_id, identity_id)`; non-interferensi jalur webhook ACK; pembatasan akses riwayat pada jalur internal aplikasi tanpa hak tulis dari browser; rollback terarah terbukti bersih tanpa mutasi parsial; konkurensi paralel bebas asosiasi ganda; dan migration schema terdaftar serta teruji berurutan secara aman.

**Bukti/Verifikasi**

`lib/domain/conversation.ts`, `lib/application/persistence-contracts.ts`, `lib/repositories/episode-store.ts`, `lib/application/helpdesk-persistence.ts`, `supabase/migrations/20260929200000_create_conversation_persistence.sql`, `supabase/migrations/20260929200001_adjust_conversation_foreign_keys.sql`, `tests/domain/conversation.test.ts`, `tests/integration/conversation.test.ts`, `docs/P2_3_REVIEW.md`, dan decision log D85, D86:
- **Pengelompokan Worker-Order-Independent & Permutasi 0/20/40:** Pengelompokan akhir ditentukan murni oleh urutan `received_at` dan jeda inaktivitas 24 jam (< 24 jam menyambung, >= 24 jam memisahkan). Tiga permutasi urutan pemrosesan untuk dataset yang sama (0→20→40, 0→40→20 [bridging/merge], dan 40→20→0 [reverse arrival]) terbukti menghasilkan keanggotaan kelompok, rentang waktu (`startedAt`: 0h, `lastActivityAt`: 40h), status (`active`), dan riwayat 3 pesan yang identik. Pemanggilan ulang `process()` membuktikan idempotensi retry tanpa menduplikasi data atau meninggalkan conversation ID usang.
- **Rekonsiliasi Bridging & Konsistensi Referensi:** Saat pesan penghubung tiba terlambat, domain menghasilkan aksi `merge`. Di database, pesan pada `public.messages` direparent ke surviving conversation ID, nilai `processing_result->>'conversationId'` pada `public.triage_assessments` diperbarui via `jsonb_set` ke surviving ID, dan conversation yang terserap dihapus bersih tanpa melanggar FK.
- **Status Aktif Objektif & Preservasi Kelompok Baru:** Hanya conversation dengan `max(lastActivityAt)` dalam scope yang berstatus `active`. Pesan historis (0h atau 10h) yang tiba setelah conversation baru (40h atau 50h) dibuat/diperbarui dengan status `closed` dan tidak merebut status aktif kelompok yang lebih baru.
- **Penyelarasan Scope Identitas:** Scope conversation ditegakkan secara konsisten pada tuple `(channel, account_id, chat_id, identity_id)`. Pesan dari identitas pengirim berbeda pada grup/chat yang sama terisolasi secara mandiri dalam conversation masing-masing dan tidak saling menutup status aktif.
- **Preservasi Klaim & Debounce Lintas Transisi:** Transisi ke conversation baru setelah jeda > 24 jam terbukti tidak menduplikasi episode aktif dan tidak mereset debounce. Pengujian menggunakan fixture klaim dan intent sintetis yang disiapkan di database saat mode SHADOW, membuktikan bahwa kode transisi tidak memicu reservasi ganda (jumlah baris pada `public.reply_claims` dan `public.outbound_intents` tetap tepat 1 baris). Bukti ini tidak menunjukkan pengiriman balasan Telegram nyata karena mode SHADOW tidak mengizinkan dispatch.
- **Bukti Rollback Terarah & Snapshot Merge:** Fault injection ditargetkan presisi pada `INSERT INTO public.triage_assessments` setelah manipulasi conversation dan pesan dieksekusi, dibuktikan via marker `reachedInsertTriageAssessment`. Pemeriksaan di luar transaksi membuktikan 0 pesan, 0 conversation parsial, job tetap `pending`, retry berhasil idempoten. Pada skenario rollback merge: snapshot seluruh 5 field kedua conversation (`id`, `started_at`, `last_activity_at`, `status`, `updated_at`), asosiasi pesan, dan `processing_result` assessment terbukti tetap identik; pesan penghubung 20h tidak tersimpan; job tetap pending; serta pemrosesan ulang pasca fault dilepas berhasil menggabungkan kelompok secara utuh dan idempoten.
- **Konkurensi Paralel:** Pemanggilan `process()` secara paralel untuk pesan yang sama menghasilkan tepat 1 asosiasi pesan. Pemanggilan paralel untuk pesan berbeda dalam satu sesi percakapan berhasil menggabungkan kedua pesan ke dalam conversation tunggal yang sama tanpa asosiasi ganda atau pemecahan kelompok yang keliru.
- **Rekonsiliasi Migration & Pembuktian Skema Terisolasi:**
  - Migration awal `20260929200000_create_conversation_persistence.sql` dipulihkan ke versi penerapan awal yang bersih (default PostgreSQL NO ACTION untuk FK `identity_id` dan `conversation_id`, index `conversations_scope_activity`, `conversations_identity`, dan `messages_conversation`).
  - Penyesuaian FK (`ON DELETE CASCADE` pada identity, `ON DELETE SET NULL` pada message) serta composite index `conversations_scope_identity_activity` diresmikan via migration lanjutan `20260929200001_adjust_conversation_foreign_keys.sql`. Keduanya terdaftar resmi pada `supabase_migrations.schema_migrations`.
  - Uji kelayakan sintaks rangkaian awal diverifikasi pada tabel tiruan schema sementara.
  - Kesetaraan skema komprehensif dibuktikan via `scripts/verify-p23-schema-migration.mjs` dengan menerapkan seluruh 6 migration repository pada database pengujian terisolasi bernama dinamis (misal: `p23_verify_...`). Sebanyak 14 tes stub/spy dilaporkan lulus dan menguji validasi serta lifecycle database, termasuk error saat cleanup gagal. Assertion tes tersebut memeriksa error/rejection fungsi runVerification(); tidak menjalankan proses CLI untuk mengukur exit code. Setelah database sementara berhasil dibuat, skrip mencoba cleanup melalui finally setelah mencoba menutup pool sementara. Kegagalan penghapusan dilaporkan sebagai error beserta nama database yang tertinggal; perilaku exit code nonzero diketahui dari pemeriksaan handler CLI yang memanggil process.exit(1). Cleanup tidak dijamin selesai jika proses dihentikan paksa atau mesin mati. Verifikasi schema lokal nyata dilaporkan berhasil membandingkan sembilan kategori objek, menyelesaikan cleanup, dan berakhir dengan exit code 0.
- **Hasil Pengujian Terarah (Berdasarkan Eksekusi Aktual):**
  - Unit test keamanan skrip (`node --test tests/scripts/verify-p23-schema-migration.test.mjs`): 14 passed (exit code 0).
  - Verifikasi skema terisolasi nyata (`node scripts/verify-p23-schema-migration.mjs`): 9 kategori identik (exit code 0).
  - `tests/domain/conversation.test.ts`: 15 subtest + 1 parent test (16 passed, exit code 0).
  - `tests/integration/conversation.test.ts`: 17 subtest + 1 parent test (18 passed, exit code 0).
  - `tests/integration/telegram-webhook.test.ts`: 10 subtest + 1 parent test (11 passed, exit code 0).
  - `tests/integration/persistence.test.ts`: 11 subtest + 1 parent test (12 passed, exit code 0).
  - Suite unit test proyek (`npm run test:unit`): 146 passed (exit code 0).
  - Statis & Linter (`npm run lint`): 0 error (exit code 0).
  - Typecheck (`npx tsc -p tsconfig.test.json`): 0 error (exit code 0).
- **Integritas Pesan Nyata:** Dua pesan webhook Telegram nyata milik pengguna (provider message ID 1 `/start` dan provider message ID 2) terverifikasi tetap utuh dan pending di database.

**Catatan/Blocker**

Implementasi dan koreksi P2.3 selesai penuh (✅ Done). Data percakapan persisten dan dapat diambil melalui fungsi internal aplikasi/staf. UI inbox dashboard merupakan scope [P2.6](#task-p2-6); worker proses asinkron merupakan scope [P2.5](#task-p2-5). Pipeline siap dilanjutkan ke [P2.4](#task-p2-4) (Orkestrasi inbound ke assessment SHADOW).

</details>

<a id="task-p2-4"></a>

<details>
<summary>P2.4 — Orkestrasi inbound ke assessment SHADOW</summary>

**Acceptance Criteria**

Inbound menjalankan identitas, klasifikasi, pengambilan bukti, keputusan, dan asosiasi episode; assessment/handoff tersimpan; SHADOW tanpa claim atau outbound otomatis; I/O provider di luar transaksi.

**Bukti/Verifikasi**

`lib/application/orchestrate-processing.ts`, `lib/application/helpdesk-persistence.ts`, `tests/utils/test-guard.ts`, `tests/utils/test-guard.test.ts`, `tests/integration/orchestration.test.ts`, decision log D87, D88, D89, D90, D91, D92, dan `docs/P2_4_REVIEW.md`:
- **Lingkungan Pengujian Terisolasi Nyata:** Database Supabase lokal terisolasi (`Chat_Automation_Helpdesk_Test`, DB port 54332, API port 54331) dengan marker token eksplisit (`TEST_ENVIRONMENT_ISOLATION_TOKEN_7F89B2`). Guard `requireIsolatedDatabase()` memvalidasi kesamaan target via PG dan Supabase API sebelum mutasi.
- **Verifikasi Cleanup & Isolasi Database Nyata:** `receive()` + `process()` terbukti membentuk grafik entitas lengkap (`ingress_events`, `processing_jobs`, `messages`, `conversations`, `complaints`, `triage_assessments`, `complaint_audit_log`), pembersihan fixture 100% tuntas via `cleanupFixture()` tanpa menyentuh identitas baseline pembanding (1 baris baseline utuh), dan controlled failure dibersihkan tanpa kebocoran koneksi pool.
- **Sumber Otoritatif Incident Database & Pengamanan Regresi Persistence (D92):** `HelpdeskPersistence.process()` menggunakan seluruh baris manual incidents dengan `status = 'ACTIVE'` yang terbaca langsung dari database di dalam transaksi final (`SELECT id, type, status, odp_ids, odc_ids, version FROM public.incidents WHERE status = 'ACTIVE' FOR SHARE`). `tests/integration/persistence.test.ts` diamankan dengan guard target ganda pra-koneksi, tracking UUID incident run (`runIncidentIds`), eliminasi delete tanpa WHERE, penolakan active incident eksternal, serta pembuktian preservasi incident baseline non-ACTIVE across cleanup.
- **Pengujian Integrasi Orkestrasi P2.4 Nyata (11 Subtest Passed, Exit Code 0):**
  1. *Real Database Verification (Entity Graph & Cleanup)*: Pembentukan grafik entitas penuh dan cleanup terbukti membersihkan seluruh entitas uji tanpa memutasi baseline pembanding.
  2. *Real Database Verification (Controlled Failure & Leak Prevention)*: Kegagalan terkontrol sebelum transaksi membersihkan resource tanpa kebocoran koneksi pool.
  3. *AC 1 (Simulated Telegram Webhook Ingress & Processing)*: Payload Telegram simulasi masuk melalui `handleTelegramWebhook()`, mengembalikan HTTP 200 `{ status: "accepted" }`, dan mencatat `ingress_events` serta `processing_jobs` (`status = 'pending'`) dengan 0 messages dan 0 assessments pada jalur ACK. Pemanggilan eksplisit `orchestrateProcessing()` selanjutnya melengkapi `messages`, `conversations`, `complaints`, `triage_assessments`, `complaint_audit_log`, dan menandai job `done`.
  4. *AC 2 (Decision Matrix)*: Matriks skenario (normal -> ONLINE_CHECK/online, los_individual -> LOS_INDIVIDUAL/los_individual, los_area -> LOS_AREA/los_area, upstream_down -> NETWORK_DISRUPTION/upstream_down, stale/unknown/timeout/provider_error -> GENERIC/onu_unusable, partial failure, manual AREA match -> MASS_AREA/manual_area_match, manual AREA no-match -> ONLINE_CHECK/online) sesuai PRD.
  5. *AC 3 (Bypass & Non-complaint)*: GENERAL (0 calls) dan non-komplain (0 calls) membypass provider; unverified sender dan media tanpa caption tersimpan bersih.
  6. *AC 4 (SHADOW & Backlog Protection)*: SHADOW mode menghasilkan 0 auto claims dan 0 auto intents (`dispatchAuthorized=false`), dan peningkatan mode ke FULL tidak mengaktifkan backlog SHADOW.
  7. *AC 5 (Deduplication & Concurrency)*: Dedup sekuensial dan paralel menghasilkan tepat 1 message dan assessment identik; follow-up menggunakan episode aktif yang sama.
  8. *AC 6 (Mid-Transaction Fault Injection Rollback)*: Transaksi diuji dengan fault injection terarah pada `INSERT INTO public.triage_assessments` (setelah `messages`, `complaints`, dan `complaint_audit_log` dimutasi dalam transaksi), membuktikan rollback bersih di luar transaksi (0 baris tersimpan), job tetap `pending`, dan retry berhasil idempoten.
  9. *AC 7 (Out-of-Transaction Provider, Hook Sequence & Incident Evidence Revalidation)*: Pemisahan provider di luar transaksi mutasi dibuktikan melalui instrumentasi urutan hook (`onBeforeProvider` -> `onProviderCall` -> `onAfterProvider` -> `onBeforeTransaction`), dengan pemanggilan transaksi aktual dieksekusi setelahnya berdasarkan alur kode `orchestrateProcessing()`. Mutasi data setelah provider selesai memeriksa jaringan namun sebelum transaksi dimulai (`onAfterProvider`):
     - Unlinked identity membatalkan bukti ONU dan jatuh kembali ke GENERIC (`identity_unresolved`).
     - Penggantian incident A (AREA_SPECIFIC -> RESOLVED) dengan incident B (GENERAL -> ACTIVE, version 5) menghasilkan assessment `MASS_GENERAL` (`general_active`) menunjuk ID/version B, dengan assertion eksplisit bahwa `decision.evidence` memuat `kind: "incident"`, ID B, dan version 5 pembeda.
     - Incident awal yang dihapus dari database tidak dihidupkan kembali dan sistem jatuh kembali ke bukti independen (`ONLINE_CHECK`, `online`, `incidentId: null`) tanpa bukti incident.
  10. *AC 8 (Default Scenario & providerQuality)*: Default scenario tanpa override menghasilkan `normal`, dan snapshot terstruktur `providerQuality` tersimpan dan terbaca dari database.
- **Pengujian Pengamanan Guard (Stub/Spy):** 9 subtest passed pada `tests/utils/test-guard.test.ts` (exit code 0).
- **Regresi Suite Lulus Penuh:** `npm run test:unit` (146 passed), `tests/integration/persistence.test.ts` (12 passed dengan guard terisolasi dan fixture database nyata), `tests/integration/conversation.test.ts` (18 passed), `tests/integration/telegram-webhook.test.ts` (11 passed), `npx tsc --noEmit` (exit code 0).

**Catatan/Blocker**

P2.4 selesai (**Done**). Worker pemrosesan job dengan lease dan attempt menyusul pada P2.5. Dua ingress pengguna terdahulu dicatat hilang pada eksekusi pengujian lama berdasarkan pemeriksaan sebelumnya.

</details>

<a id="task-p2-5"></a>

<details>
<summary>P2.5 — Worker pemrosesan job dengan lease dan attempt</summary>

**Acceptance Criteria**

Job di-claim atomik dengan lease/attempt via transaksi mandiri; pemicu paralel tidak memproses job yang sama; pekerjaan setelah ACK tercatat dan diverifikasi pada server HTTP Next.js lokal nyata (port 3188) tanpa runner manual; waktu validasi lease pasca-row lock dibuktikan pada jalur default tanpa override; kegagalan background diverifikasi dengan fault injection; crash sebelum selesai dapat dilanjutkan; API runtime route terbukti mengarah ke lingkungan tes terisolasi; rute HTTP webhook memiliki pembatas diagnostik server eksplisit yang nonaktif secara default dan seluruh kegagalan mengikuti envelope standar; konfigurasi target tes diagnostik wajib eksplisit tanpa fallback ke variabel runtime utama; target efektif dievaluasi langsung dari objek pool (`getHelpdeskPoolTarget`) dan client runtime aktual (`getSupabaseClientTarget`) termasuk target pool tersimpan; resolusi target efektif PostgreSQL menggunakan parser konfigurasi driver `pg.Client` untuk mendeteksi penggantian target via parameter query (`?port=...`, `?host=...`); verifikasi host, port efektif, dan database/pathname; validasi loopback dan port PostgreSQL independen dari API (termasuk penanganan IPv6); ketidaksesuaian target atau konfigurasi invalid ditolak sebelum query PG/API diagnostik dijalankan; autentikasi secret dieksekusi ketat sebelum pemanggilan factory pool atau client API; `timingSafeSecretMatch` membandingkan panjang byte buffer UTF-8 (`Buffer.byteLength`) tanpa melempar exception pada input multi-byte; kegagalan factory terkontrol pasca-autentikasi ditangani dengan HTTP 500 generik tanpa membocorkan credential, connection string, atau error mentah; token marker PostgreSQL dan API diverifikasi identik menggunakan `public.mock_network_scenarios.description` hanya setelah target cocok; marker tidak ditemukan/berbeda gagal tanpa metadata; identitas fixture diselaraskan dengan bot account ID dan ditegaskan ber-UUID sama pada ingress; teardown membuktikan pembersihan fixture dan pemulihan environment saat setup dibatalkan; preservasi baseline pembanding terbukti tanpa penghapusan global.

**Bukti/Verifikasi**

`supabase/migrations/20261002100000_create_job_leases_and_attempts.sql`, `lib/application/job-worker-contracts.ts`, `lib/application/job-worker-service.ts`, `lib/application/helpdesk-persistence.ts`, `lib/application/orchestrate-processing.ts`, `lib/supabase/server.ts`, `app/api/webhooks/telegram/route.ts`, `lib/application/telegram-inbound-service.ts`, `lib/application/diagnostic-target-validator.ts`, `lib/postgres/server.ts`, `tests/utils/setup-node-env.ts`, `tests/domain/job-worker.test.ts`, `tests/application/diagnostic-target-validator.test.ts`, `tests/integration/job-worker.test.ts`, decision log D93, D94, D95, D96, D97, D98, D99, D100, dan `docs/P2_5_REVIEW.md`:
- **Schema & Persistence Worker Terpadu (Migration 20261002100000):** Tabel `public.processing_jobs` memuat kolom `lease_token` (bertipe `text`), `lease_expires_at` (timestamptz), `attempt_count` (integer default 0), `max_attempts` (integer default 3), `next_attempt_at` (timestamptz default now()), dan `last_error` (text tersanitasi), dengan status `('pending', 'in_progress', 'done', 'failed')`. Riwayat attempt dicatat persisten di `public.processing_job_attempts` dengan kolom `(id, ingress_id, attempt_number, lease_token, started_at, completed_at, outcome, error_message, created_at)` diproteksi RLS khusus `service_role` dengan outcome `('in_progress', 'success', 'retryable_failure', 'terminal_failure', 'lease_expired')`.
- **Default Operasional Prototype (D93, D94, D95, D96, D97, D98, D99, D100):** `DEFAULT_LEASE_DURATION_MS = 30_000` (30s: cukup untuk latensi mock provider 2s + transaksi DB, responsif terhadap crash recovery), `MAX_INBOUND_ATTEMPTS = 3` (3 attempt sebelum terminal failure), `BASE_BACKOFF_MS = 2_000` (backoff eksponensial `2000 * 2^(attempt - 1)` dihitung deterministik dari waktu kegagalan dicatat), `MAX_JOBS_PER_DRAIN = 5` (kuota batch terbatas), `DRAIN_TIMEOUT_MS = 20_000` (20s batas waktu antar-job untuk memulai pekerjaan berikutnya / *inter-job gating threshold*, bukan hard kill di tengah eksekusi job aktif).
- **Pengujian Integrasi Job Worker & Route Runtime Nyata (18 Passed = 1 Suite Induk + 17 Subtest, Exit Code 0):**
  1. *Concurrency Protection*: Dua pemicu klaim paralel (`claimJob()`) untuk job yang sama menghasilkan tepat 1 lease aktif (`attempt_number: 1`, `outcome: 'in_progress'`), sementara pemicu kedua mengembalikan `null`.
  2. *Valid Lease Protection & Expired Lease Recovery*: Job dengan lease aktif tidak dapat direbut oleh worker lain (`claimDuringLease === null`). Setelah lease kedaluwarsa, worker lain berhasil mereclaim dengan token baru (`attempt_number: 2`), dan attempt 1 dicatat sebagai `'lease_expired'`.
  3. *Fenced Stale Worker Execution*: Worker usang yang lease-nya kedaluwarsa atau digantikan worker baru ditolak oleh transaksi final `HelpdeskPersistence.process()` dengan `PersistenceError("lease_lost")` (0 messages, 0 assessments tersimpan). `recordJobFailure()` juga menolak worker usang (`"lease_lost"`). Worker baru menyelesaikan job (`done`, attempt 2 `'success'`).
  4. *Fenced Unreclaimed Expired Lease (`recordJobFailure`)*: Late failure recording pada job yang lease-nya telah kedaluwarsa sebelum direclaim worker lain ditolak dengan `"lease_lost"` tanpa mutasi status (`'in_progress'`), tanpa reset lease token, dan tanpa mengubah attempt history.
  5. *Direct process() Guard on Active Leases*: Pemanggilan langsung `process()` tanpa `leaseToken` menolak job yang sedang aktif di-lease worker (`"job_leased_by_other_worker"`).
  6. *Direct process() Guard on Expired Leases*: Pemanggilan langsung `process()` tanpa `leaseToken` pada job yang lease-nya telah kedaluwarsa ditolak dengan `"job_lease_expired"`, menghasilkan 0 pesan, 0 assessment, status job tetap `'in_progress'`, dan riwayat attempt 1 tidak terkorupsi. Recovery melalui `claimJob()` kemudian berhasil mencatat attempt 1 `'lease_expired'`, memulai attempt 2, dan memproses job hingga `'done'`.
  7. *Retry Scheduling & Terminal Failure*: Kegagalan pemrosesan menjadwalkan ulang job dengan backoff `next_attempt_at` eksponensial. Setelah melampaui `max_attempts = 3`, status job secara deterministik beralih ke `'failed'` (terminal) dengan attempt 3 berstatus `'terminal_failure'` dan error tersanitasi.
  8. *Deterministic Failure-Time Backoff Calculation*: Claim pada t0 dan failure pada t0+5s dengan base backoff 2s menghasilkan `next_attempt_at = t0+7s` dan `attempt.completed_at = t0+5s`. Gating terbukti: klaim pada t0+6s menghasilkan `null`, klaim pada t0+7s berhasil.
  9. *Mid-Transaction Rollback*: Fault injection terarah pada mutasi domain di dalam transaksi aktif membatalkan seluruh mutasi parsial (0 messages, 0 assessments tersisa). Worker mencatat attempt sebagai `'retryable_failure'` dan job dijadwalkan ulang untuk retry tanpa merusak state.
  10. *Webhook Post-ACK Scheduling & Drain*: Jalur Telegram webhook mengomit `ingress_events` dan `processing_jobs` (`status = 'pending'`) sebelum mengirim HTTP 200 `{ status: "accepted" }` ke caller. Pemanggilan drain memproses hingga seluruh entitas tersimpan dan job `'done'`.
  11. *Drain Resilience Across Exhausted Jobs*: Job A yang lease-nya kedaluwarsa dan attempt-nya habis (3/3) secara deterministik beralih ke `'failed'` (`'terminal_failure'`), dan drain dalam pemanggilan yang sama tidak berhenti melainkan melanjutkan ke Job B yang eligible dan menyelesaikannya hingga `'done'` (`processedCount: 2, successCount: 1, failureCount: 1`).
  12. *Targeted Lease Validation Timing on Default Path (D96)*: Menahan row lock pada client terpisah. Caller terbukti aktif menunggu di `pg_locks` (`waiting = true`). Setelah lease kedaluwarsa menurut PostgreSQL `clock_timestamp()`, lock dilepas. `recordJobFailure()` membaca timestamp pasca-lock via query terpisah, mendeteksi lease kedaluwarsa, dan mengembalikan outcome `"lease_lost"`. Snapshot job dan attempt tetap 100% identik tanpa mutasi. Recovery via claim baru berhasil mengklaim attempt 2 dan menyelesaikan job hingga `'done'`.
  13. *Telegram Route Controlled Integration (afterRunner harness) & Background Fault Injection (D96, D97)*: `TELEGRAM_BOT_ACCOUNT_ID` diselaraskan dengan fixture run; ingress event ber-UUID sama persis dengan fixture identitas (`ingress.identity_id === fixtureIdent.id`); ingress dan pending job committed sebelum HTTP response; respons selesai tanpa menunggu worker; callback `after` mengeksekusi drain hingga job `'done'`; negative branches (401, 400, 200 ignored) dan duplicate idempotency (`duplicate: true`) terverifikasi; background fault injection pada `triage_assessments` mencatat `'retryable_failure'` dengan error tersanitasi dan retry recovery berhasil ke attempt 2.
  14. *Telegram Route Real Next.js Server, after() Lifecycle, Server Diagnostic Guard & Target Verification (D96, D97, D98, D99, D100)*: Server Next.js lokal nyata pada port 3188; `getHelpdeskAdminClient()` mendahulukan `SUPABASE_URL` / `HELPDESK_TEST_API_URL` atas `NEXT_PUBLIC_SUPABASE_URL`; **Pembatas Diagnostik Server & Kesesuaian Target Runtime (D98, D99, D100)** diverifikasi: (a) *Nonaktif/Konfigurasi Normal*: header tes & secret valid tidak mengalihkan alur atau membocorkan metadata (empty body menghasilkan 400 struktur normal tanpa data diagnostik); (b) *Secret Salah*: ditolak sebelum akses DB/API dengan envelope 401 `UNAUTHORIZED`; (c) *Konfigurasi Tes Inkomplit*: ketiadaan target tes eksplisit tanpa fallback ke runtime utama menghasilkan 403 `TEST_CONFIG_INCOMPLETE`; (c.1) *Target DB Runtime Mismatch Over HTTP*: port/host PG berbeda dari target tes yang diharapkan ditolak sebelum query dengan 403 `TEST_TARGET_MISMATCH`; (c.2) *Target API Runtime Mismatch Over HTTP*: port/pathname API berbeda dari target tes yang diharapkan ditolak sebelum query dengan 403 `TEST_TARGET_MISMATCH`; (d) *Lingkungan Tes Terverifikasi*: verifikasi PG pool dan Supabase API runtime dengan target cocok dan marker identik pada `public.mock_network_scenarios.description` berhasil (`verified: true`); (e) Flag diagnostik dimatikan kembali untuk eksekusi alur normal; `TELEGRAM_BOT_ACCOUNT_ID` ditegaskan ulang pasca-prepare; `ingress.identity_id === fixtureIdent.id`; barrier incident via `FOR UPDATE` menahan pemrosesan background hingga ACK 200 selesai; pelepasan barrier memicu eksekusi otomatis `after()` hingga `'done'`; 0 outbound terbentuk; negative branches (401, 400, 200 ignored) dan duplikasi terverifikasi.
  15. *Controlled Setup Failure Teardown (D97, D98)*: Pembatalan setup terkontrol saat inisialisasi (error sebelum prepare/listen) membuktikan blok `finally` mengeksekusi `cleanupFixture()` berbasis UUID dan `EnvRestorer` memulihkan lingkungan tanpa meninggalkan resource dangling (terbatas pada cleanup fixture dan env saat setup dibatalkan, tanpa klaim penutupan port atau proses server yang belum dibuka).
  16. *Comparator Baseline Preservation (D95, D97)*: Fixture pembanding terpisah disnapshot sebelum dan sesudah eksekusi/cleanup run utama; data pembanding terbukti 100% identik tanpa penghapusan global.
  17. *Controlled Failure Teardown (D95, D97)*: Fault injection terkontrol dalam blok `try/catch` membuktikan cleanup fixture di blok `finally` (berdasarkan UUID run spesifik) dan penutupan koneksi client pool tetap tuntas dieksekusi.
  18. *Penegakan SHADOW Mode*: Mode default `SHADOW` diverifikasi menghasilkan tepat 0 `reply_claims` dan 0 `outbound_intents` otomatis (`claim.outcome = "skipped"`, `claim.reason = "shadow_mode"`, `dispatchAuthorized = false`).
- **Validasi Target Diagnostik Pra-Query, Resolusi Driver pg & Pengujian Spy Negatif (18 Subtest Passed, Exit Code 0, D99, D100):** `tests/application/diagnostic-target-validator.test.ts` membuktikan penolakan sebelum query: (1) Target PG runtime berbeda ditolak 403 `TEST_TARGET_MISMATCH` dengan spy 0 query PG dan 0 call API; (2) Target API runtime berbeda ditolak 403 `TEST_TARGET_MISMATCH` dengan spy 0 query PG dan 0 call API; (3) Stored pool mengevaluasi target efektif dari pool options dan menolak perubahan env menjadi target tes dengan 403 `TEST_TARGET_MISMATCH` (0 query); (4) Port loopback PG dev/prod 5432 ditolak 403 `TEST_TARGET_INVALID` secara independen dari hostname API non-loopback; (5) Port loopback API dev 54321 ditolak 403 `TEST_TARGET_INVALID` secara independen dari hostname DB non-loopback; (6) Hostname IPv6 `[::1]` dengan port 5432 ditolak 403 `TEST_TARGET_INVALID`; (7) Target PG query param port override (`?port=5432`) ditolak 403 `TEST_TARGET_INVALID`/`TEST_TARGET_MISMATCH` (0 query PG, 0 call API); (8) Target PG query param host override (`?host=evil.com`) ditolak 403 `TEST_TARGET_MISMATCH` (0 query PG, 0 call API); (9) Target PG query param port mismatch (`?port=54339`) ditolak 403 `TEST_TARGET_MISMATCH` (0 query PG, 0 call API); (10) Route boundary: secret salah dengan konfigurasi runtime inkomplit tetap ditolak 401 `UNAUTHORIZED` tanpa memanggil factory pool/client; (11) Route boundary: secret berkarakter sama tetapi panjang byte UTF-8 berbeda ditolak 401 tanpa melempar exception; (12) Route boundary: kegagalan factory terkontrol pasca-autentikasi menghasilkan 500 `INITIALIZATION_FAILED` tanpa membocorkan credential, connection string, atau error mentah; (13) Route boundary: jalur diagnostik sah terintegrasi mengembalikan 200 `{ verified: true }`; (14) Marker DB/API tidak ditemukan ditolak 403 `TEST_MARKER_NOT_FOUND` tanpa metadata diagnostik; (15) Token marker DB dan API berbeda ditolak 403 `TEST_MARKER_MISMATCH` tanpa metadata diagnostik; (16) Target dan marker cocok diverifikasi sukses 200 `{ verified: true }`; (17) Secret salah ditolak 401 `UNAUTHORIZED`; (18) Target tes inkomplit tanpa fallback ditolak 403 `TEST_CONFIG_INCOMPLETE`.
- **Catatan Faktual Eksekusi Penghapusan Historis:** String `console.log("Cleaned...")` merupakan bagian dari teks skrip perintah ad-hoc, bukan rekaman stdout/exit code yang tersimpan pada lampiran log. Karena bukti hasil aktual tidak tersedia pada lampiran log, statusnya dicatat secara jujur: "perintah tercatat; status eksekusi belum terverifikasi", target koneksi tertulis dibedakan dari target aktual terverifikasi, dan jumlah baris terhapus serta dampaknya tetap tidak diketahui (*unknown*).
- **Pengujian Unit Domain Job Worker (5 Tests Passed, Exit Code 0):** `sanitizeErrorMessage` membersihkan kredensial sensitif database dan memotong error berlebih; `isRetryableError` membedakan transient network/DB error vs permanent syntax/validation/lease error (termasuk `job_lease_expired`); `computeBackoffMs` menghitung durasi backoff eksponensial; `handleTelegramWebhook` hanya memicu callback `onAccepted` pada respons diterima (baru maupun duplicate) dan mengabaikan unauthorized/rejected.
- **Regresi Suite Lulus Penuh Tanpa Error:**
  - `npm run test:unit`: 170 unit tests passed (0 failures).
  - `tests/integration/job-worker.test.ts`: 18 tests passed (0 failures).
  - `tests/integration/persistence.test.ts`: 12 tests passed (0 failures).
  - `tests/integration/conversation.test.ts`: 18 tests passed (0 failures).
  - `tests/integration/telegram-webhook.test.ts`: 11 tests passed (0 failures).
  - `tests/integration/orchestration.test.ts`: 11 tests passed (0 failures).
  - `npx tsc --noEmit`: 0 errors.
  - `npm run lint`: 0 errors.
  - `npm run build`: Compiled successfully (Next.js 16.3.5 Turbopack, 7 rute siap).

**Catatan/Blocker**

P2.5 selesai penuh (**Done**). Seluruh bukti empiris telah terpenuhi. Pipeline berikutnya adalah [P2.6](#task-p2-6) (Inbox/antrean sebagai landing dashboard).

</details>

<a id="task-p2-6"></a>

<details>
<summary>P2.6 — Inbox/antrean sebagai landing dashboard</summary>

**Acceptance Criteria**

Inbox menampilkan percakapan dan episode, unread/status, filter, serta detail riwayat; non-komplain masuk review; data hanya tersedia bagi staf; polling baca 5 detik dan state loading/empty/error tersedia.

**Bukti/Verifikasi**

`supabase/migrations/20261004100000_create_staff_conversation_reads.sql`, `supabase/migrations/20261004110000_revoke_direct_staff_conversation_reads_mutation.sql`, `supabase/migrations/20261004120000_create_staff_message_reads.sql`, `supabase/migrations/20261004130000_correct_legacy_message_read_backfill.sql`, `lib/application/origin-validator.ts`, `lib/application/inbox-contracts.ts`, `lib/application/inbox-service.ts`, `lib/application/inbox-service.server.ts`, `app/api/inbox/conversations/route.ts`, `app/api/inbox/conversations/[id]/route.ts`, `app/api/inbox/conversations/[id]/read/route.ts`, `tests/application/inbox-service.test.ts`, `tests/integration/inbox.test.ts`, `tests/utils/test-migration-runner.ts`, `tests/utils/test-migration-runner.test.ts`, `tests/integration/migration-runner.test.ts`, `scripts/apply-test-migrations.mjs`, decision log D101, D102, D103, D104, D105, D106, D107, D108, D109, D110, D111, D112, D113, dan `docs/P2_6_STAGE1_REVIEW.md`:
- **Fondasi Data & Schema Unread Persisten Per Staf (Migration 20261004100000, 20261004120000, 20261004130000):** Tabel `public.staff_conversation_reads` dan `public.staff_message_reads` dengan isolasi per sesi staf. Pembacaan oleh Staf A terbukti tidak mengubah posisi unread Staf B.
- **Pencabutan Izin Mutasi Langsung Browser (Migration 20261004110000, 20261004120000, D102, D108):** Policy write dihapus, izin `INSERT`, `UPDATE`, `DELETE` dicabut dari `anon` dan `authenticated` pada `public.staff_conversation_reads` dan `public.staff_message_reads`. Pembuktian empiris via `SET LOCAL ROLE authenticated` membuktikan percobaan mutasi langsung menghasilkan error PostgreSQL `42501` (`permission_denied`), `SELECT` owner berhasil, dan mutasi backend tersertifikasi berfungsi normal.
- **Model Invariant Unread Eksplisit Per-Staf & Eliminasi Celah Delayed Processing (Migration 20261004120000, 20261004130000, D108, D109, D110, D111, D112 / Koreksi B1):**
  - Tabel granular `public.staff_message_reads` dengan PK komposit `(staff_id, message_id)` dan flag `is_confirmed boolean not null default true`.
  - Penandaan baca mengakui pesan snapshot detail staf secara eksplisit via `acknowledgedMessageIds: readonly string[]`.
  - Fallback `lastReadMessageId` tanpa `acknowledgedMessageIds` strictly mengakui 1 pesan persis tanpa perluasan rentang; diuji dengan pesan tertunda yang memiliki `received_at` lebih lampau dari pesan snapshot (09:30 vs 10:00) yang membuktikan pesan tertunda tetap unread di respons, detail, dan database (AC 6.4).
  - Pesan yang baru diproses/di-commit setelah snapshot staf diambil tetap unread (`isRead = false`, `unreadCount = 1`) meskipun `received_at`-nya lebih lampau (AC 6.1, eliminasi celah delayed ingress).
  - Pesan baru dengan `received_at` identik dan UUID lebih kecil tetap unread (AC 6.2).
  - Migrasi korektif `20261004130000`: baris legacy backfill ditandai `is_confirmed = false` tanpa cutoff tanggal dan tetap unread sampai diakui secara eksplisit oleh staf; konfirmasi baru meng-update `is_confirmed = true` secara idempoten (AC 6.5).
  - **Integrasi Migrasi SQL Aktual pada Namespace Terpisah (AC 6.6, D110, D111)**:
    - Skenario Upgrade pada `test_mig_upg_<runId>` dan Skenario Fresh Sequence pada namespace baru kosong `test_mig_fresh_<runId>`.
    - Fresh sequence mengeksekusi 4 file migrasi berurutan (`20261004100000`, `110000`, `120000`, `130000`) dengan pemetaan tabel read-state murni; membuktikan kolom `is_confirmed` bernilai default `true`, baris baru tanpa flag mendapat default `true`, dan acknowledgement eksplisit runtime berjalan idempoten.
    - Skenario dampak kebijakan membuktikan baris pembanding `staff_conversation_reads` (`updated_at`) dan `staff_message_reads` (`read_at`) sebelum dan sesudah 12:00:00 UTC ada di DB sebelum transisi; eksekusi migrasi korektif aktual `20261004130000` dari disk otomatis mengubah kedua sisi waktu menjadi `is_confirmed = false` tanpa statement UPDATE manual peniru migrasi. Teardown kedua namespace dilindungi `try/finally` dengan `combineErrors`.
  - Presisi mikrodetik PostgreSQL (`.123456` vs `.123789`) terlindungi penuh di SQL dan format teks ISO tanpa pemotongan oleh Date JavaScript; kursor agregat tidak pernah mundur (AC 6.3).
  - Pesan yang tiba di antara pengambilan snapshot dan eksekusi mutasi tetap unread (AC 8.1).
  - Penandaan baca tidak mengubah status episode komplain, automation settings, atau membuat claim/outbound (AC 9).
  - Endpoint GET list dan detail bersifat strictly read-only tanpa mutasi read-state (AC 10).
- **Atomisitas Transaksi, Advisory Lock Barrier & Pengerasan Lifecycle Konkurensi (D108, D109, D110, D111, D112 / Koreksi B1):**
  - Transaksi dilindungi `pg_advisory_xact_lock(hashtext($1), hashtext($2))` dengan scope `(staffId, conversationId)`.
  - Mutasi berulang dengan snapshot sama bersifat idempoten (`advanced = false`, `newlyReadCount = 0`).
  - Request dengan snapshot lama tidak memundurkan kursor baca atau menghapus status baca (`advanced = false`, respons kursor tetap pada posisi pesan pemenang).
  - **Harness Lifecycle Bersama (`runConcurrentMarkReadHarness`, D111, D112)**: Melindungi lifecycle koneksi sejak sebelum koneksi pertama diperoleh, mendaftarkan error handler rejection seketika, membatasi waktu barrier (3000ms), me-reject penantian barrier jika request 1 gagal sebelum barrier, membatasi penantian kedua request pasca-barrier dengan timeout dan timer cleanup, serta mengeksekusi hook `onBeforeSettleCleanup` sebelum penantian settlement terakhir. Koneksi yang aktif atau rusak saat timeout di-destroy seketika (`client.release(true)`). Penantian settlement menggunakan `Promise.allSettled` dengan bounded timer; koneksi sehat hanya dikembalikan ke pool setelah request settled. Jika settlement gagal, dilaporkan error eksplisit `CLEANUP_SETTLEMENT_TIMEOUT` via `combineErrors` tanpa mengklaim zero pending requests.
  - Diferensiasi presisi: flag `postBarrierTimedOut` hanya bernilai `true` saat timer timeout habis; error query mempertahankan error asli dan `postBarrierTimedOut = false`.
  - AC 7.1 membuktikan serialisasi sukses: koneksi kedua (PID 2) secara empiris terbukti terblokir di `pg_locks` pada advisory lock koneksi pertama (PID 1), kedua request selesai konsisten, dan `allSettled = true`.
  - AC 7.2 membuktikan skenario kegagalan terkontrol sebelum barrier via proxy query pada koneksi 1: penantian barrier langsung berhenti seketika tanpa hang, `finally` men-destroy koneksi 1, request 2 tidak diluncurkan, mutasi di-rollback penuh (0 read baris di DB), dan `allSettled = true`.
  - AC 7.3 membuktikan skenario timeout pasca-barrier: injeksi query tertahan pada Connection 2 membuktikan barrier tercapai dan dilepas sebelum timeout, timeout dilaporkan sebagai error eksplisit `POST_BARRIER_TIMEOUT`, koneksi aktif di-destroy, `onBeforeSettleCleanup` membatalkan injeksi, dan assertion settlement promise membuktikan Request 1 `fulfilled`, Request 2 `rejected` karena pembatalan terencana (bukan kegagalan mekanisme cleanup), serta `allSettled = true`.
  - AC 7.4 membuktikan skenario kegagalan query terkontrol setelah barrier dilepas: query Connection 2 melempar planned query error; terbukti error query asli diteruskan utuh, `postBarrierTimedOut = false`, Request 1 committed, Connection 2 di-destroy, mutasi Request 2 di-rollback, dan seluruh request settled (`allSettled = true`).
- **Penyelarasan Representasi Classification Faktual (AC 13, D113 / Koreksi B2):**
  - Kontrak `InboxMessageClassification` di `lib/application/inbox-contracts.ts` diselaraskan dengan kontrak domain `MessageClassification` dan data persisten `HelpdeskPersistence.process()`.
  - Menghapus field fiktif `confidence: 1.0` dan `flags: []` yang tidak disimpan di database.
  - Merepresentasikan field faktual: `category`, `reason`, `ruleVersion`, `normalizedText: string | null`, dan `matchedKeywords: readonly string[]`.
  - Mapper di `lib/application/inbox-service.ts` memetakan data yang benar-benar tersimpan, mempertahankan string kosong `""` dan `normalizedText: null` yang valid, serta menyediakan fallback eksplisit (`"unknown"` / `null` / `[]`) untuk baris histori kosong/rusak (`'{}'::jsonb`, `'null'::jsonb`) tanpa mengarang kepastian maupun mengklasifikasi ulang histori saat GET.
  - AC 13 membuktikan mapping faktual dari fixture hasil `HelpdeskPersistence.process()`, variasi string kosong, valid null, dan fallback data kosong (`'{}'::jsonb`, `'null'::jsonb`).
- **Snapshot Satu Kueri & Bukti Concurrency Terkoordinasi (AC 14, D113, D114, D115 / Koreksi B2):**
  - `listInboxConversations` disatukan via CTE tunggal (`matching_items`, `counted`, `paged` dengan `counted LEFT JOIN paged ON true`). Hal ini menjamin `totalCount`, `totalPages`, dan `items` selalu berasal dari snapshot konsisten dan filter yang sama, termasuk pada halaman di luar rentang (empty page).
  - `getInboxConversationDetail` disatukan dalam query tunggal join lateral (`conversations`, `channel_identities`, `customers`, lateral `complaints`, `messages`, `ingress_events`, `triage_assessments`, `staff_message_reads`).
  - `unreadCount` pada detail dihitung secara atomik dan pasti dari pesan-pesan dalam snapshot (`messages.filter(m => !m.isRead).length`), dan `isUnread` selalu konsisten `unreadCount > 0`.
  - AC 14 divalidasi empiris dengan writer barrier `onBeforeCommit`: SELECT pertama membaca snapshot sebelum commit; writer selesai commit sebelum hasil SELECT dikembalikan ke service. Detail terbukti membaca 2 unread sebelum commit vs 1 setelahnya; list `unread=true` membaca count/item 1 sebelum commit vs 0 setelahnya. Setiap service terbukti mengeksekusi tepat satu statement (`queryCount === 1`).
  - Kegagalan yang diinjeksi pada AC 14 adalah controlled reader failure sebelum SQL, dengan error asli diteruskan dan settlement promise riil ditunggu. Rejection handler, bounded wait/settlement, timer cleanup, serta destruction koneksi aktif jika settlement timeout tersedia sebagai proteksi kode; timeout tidak diinjeksi pada AC 14 ini. Inbound berikutnya teruji before/after secara terpisah.
- **Kontrak Pagination & Route Handlers (AC 15, AC 16, D113, D114, D115 / Koreksi B2):**
  - Default limit 25, maksimal 25. Validator bersama parser/service menegaskan: page harus positive safe integer dan offset `(page - 1) * limit` harus safe integer. Route menolak overflow dengan 400 `INVALID_PARAMETER` sebelum pool access; service sebelum SQL.
  - ORDER BY ditegaskan di CTE halaman dan SELECT terluar setelah LEFT JOIN: `paged.last_activity_at DESC NULLS LAST, paged.id DESC NULLS LAST`.
  - AC 15 divalidasi empiris dengan membandingkan tepat 28 ID fixture dengan gabungan halaman berukuran 10/10/8; setiap ID muncul tepat sekali (disjoint, 0 duplikasi, 0 hilang). Timestamp disamakan membuktikan keterurutan UUID DESC lintas halaman; pengulangan stabil mengembalikan ID identik. Halaman jauh kosong mempertahankan count 28 dan pencarian tanpa hasil menghasilkan count 0.
  - AC 16 membuktikan handler route Next.js sebenarnya (`GET /api/inbox/conversations` dan `GET /api/inbox/conversations/[id]`) menggunakan Web standard `Request` dan `Response`:
    - Memvalidasi envelope `{ success: true, data, error: null }` pada sukses, status 200, header `Cache-Control: private, no-store`.
    - Memvalidasi filter query params (`unread=true`, `page`, `limit`), nullability, classification faktual, dan status unread.
    - Memvalidasi envelope error standar `{ success: false, data: null, error: { code, message } }` untuk 400 (invalid param), 401 (unauthorized / no session), dan 404 (conversation not found).
    - Metodenya pemanggilan langsung fungsi route handler Next.js dengan objek `Request` Web API, stub sesi staf, dan pool tes; bukan browser E2E atau login Supabase nyata.
- **Batas Kepercayaan Origin Server-Side & Anti-Spoofing (D102, D103):** Sumber origin tepercaya dikunci murni pada konfigurasi server (`HELPDESK_TRUSTED_ORIGINS`), variabel platform deployment Vercel (`VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_URL`), base URL (`APP_URL`), atau loopback dev (`http://localhost:3000`, `http://127.0.0.1:3000`). Header request (`x-forwarded-host`, `x-forwarded-proto`, `host`) dilarang keras menambahkan atau memperluas daftar origin yang dipercaya. Origin asing ditolak 403 `origin_mismatch`. Konfigurasi invalid memicu fail-closed (HTTP 403 `origin_mismatch`). Pada route POST read, penolakan Origin terbukti mendahului body parsing, autentikasi, dan pool access.
- **Bukti Autentikasi Boundary Route & Penegakan Aktor Sesi (D102):** Rute `GET` list, `GET` detail, dan `POST` read tanpa sesi staf terbukti mengembalikan HTTP 401 `UNAUTHENTICATED` dan tidak memanggil pool database (0 pemanggilan). Aktor staf murni berasal dari sesi server (`user.id`); parameter `staffId` injeksi diabaikan. Penandaan dibaca menolak pesan dari percakapan lain (404 `MESSAGE_NOT_FOUND`).
- **Dekopling Percakapan 24 Jam & Episode Komplain:** Pesan non-komplain tetap tersimpan dan ditampilkan di Inbox dengan `latestEpisode = null` dan `needsReview = true`, membuktikan container 24 jam dan episode masalah tidak saling menghapus.
- **Verifikasi Cleanup Fixture Graph Lengkap, Pre-Tracked Identity Fixture & Proteksi Lifecycle (D102, D103, D104, D105, D106, D107, D108, D109, D110):**
  - Seluruh fixture B1 & B2 menggunakan helper `receiveTrackedInboundFixture` yang mencatat identity ke database dan tracker sebelum `receive()`, serta mendukung `existingIdentityId` untuk pesan berikutnya dari sender yang sama.
  - AC 11 membuktikan pembersihan graph lengkap hasil `receive()` dan `process()` (`ingress_events`, `channel_identities`, `conversations`, `messages`, `complaints`, `triage_assessments`, `complaint_audit_log`, `reply_claims`, `staff_conversation_reads`, dan `staff_message_reads`). Episode complaint terbukti terbentuk tanpa syarat. Ketiadaan `reply_claims` dan `outbound_intents` diverifikasi sesuai mode SHADOW. Data pembanding pada 6 tabel terbukti 100% identik dengan snapshot field-by-field.
  - Subtest AC 11.1 membuktikan pencatatan instan `identityId` segera setelah `receive()` sebelum processing/assertion; assertion diperluas memverifikasi seluruh graph terhapus tuntas tanpa kebocoran.
  - AC 11.2 membuktikan skenario kegagalan query pasca `receive()` di mana ketiga resource awal dibersihkan tuntas tanpa pembentukan downstream episode.
  - AC 12 memanggil jalur `process()` nyata dengan lease token invalid yang melempar `PersistenceError("lease_lost")`, dengan seluruh resource dibersihkan di `finally`.
  - AC 12.1 dibungkus `try/finally` sejak sebelum resource pertama dibuat; membuktikan Tracker B bersih tuntas; `combineErrors` mempertahankan pesan primary error dan cleanup error secara bersamaan tanpa saling menutupi.
- **Pemisahan Unit vs Integrasi Migrasi & Kepemilikan Fixture Per-Run (D104, D105, D106):**
  - Suite unit `tests/utils/test-migration-runner.test.ts` telah diterima tanpa koneksi DB/jaringan.
  - Suite integrasi `tests/integration/migration-runner.test.ts` dijalankan via perintah terisolasi `npm run test:migrations:local` (`--env-file=.env.test`).
  - Guard `validateEffectiveMigrationTarget` dan `requireIsolatedDatabase` mendahului koneksi dan mutasi.
  - Kepemilikan fixture unik per-run dan lifecycle harness bersama (`tests/utils/test-migration-harness.ts`).
- **Bukti Empiris Validasi Antigravity pada Kode D114 (D115):**
  - `npx tsc -p tsconfig.test.json`: Kompilasi sukses, 0 error, exit code 0.
  - `node --conditions=react-server --test .test-build/tests/application/inbox-service.test.js`: 44 tests passed, 0 failed, exit code 0 (250ms).
  - `npx eslint lib/application/inbox-contracts.ts lib/application/inbox-service.ts tests/application/inbox-service.test.ts tests/integration/inbox.test.ts`: 0 error, 0 warning, exit code 0.
  - `npm run test:inbox:local`: 33 tests passed (1 parent suite, 32 subtests), 0 failed, exit code 0 (3.83s). Guard isolasi terverifikasi, AC 14 single-statement overlap terbukti, AC 15 fixture 28 item pembagian 10/10/8 terbukti.

- **Implementasi Tahap 2 UI Inbox Landing Dashboard & Pembuktian Empiris Browser (D116, 2026-10-06)**:
  - `components/inbox/inbox-dashboard.tsx`, `components/inbox/inbox-conversation-list.tsx`, `components/inbox/inbox-conversation-panel.tsx`, `components/inbox/inbox-filter-bar.tsx`, `components/inbox/inbox-pagination.tsx`, `components/inbox/inbox-status-badge.tsx`, `components/inbox/inbox-status-banner.tsx`, `lib/utils/format-date.ts`, `app/dashboard/page.tsx`, `components/layout/dashboard-shell.tsx`, `app/dashboard/complaints/page.tsx`:
    - **Layout Dua Panel**: Panel kiri antrean (w-[380px]/xl:w-[420px]) dan panel kanan riwayat pesan kronologis (flex-1). Viewport mobile (<1024px) beralih ke *single-pane* dengan tombol "Kembali ke daftar percakapan" yang mempertahankan filter dan state antrean.
    - **Pembeda Non-Warna**: Item percakapan terpilih memiliki pembeda border aksen 4px (`border-l-4 border-l-[var(--action-primary)]`) dan badge teks eksplisit "Dipilih" (`span[data-selected="true"]`).
    - **Viewport Read Acknowledgment**: Penandaan baca menggunakan `IntersectionObserver` khusus pesan yang tampak di viewport scroll container panel aktif saat dokumen/tab aktif, memanggil `POST /api/inbox/conversations/[id]/read`.
    - **Polling 5 Detik & Preservasi Scroll**: Polling non-destruktif 5 detik memperbarui daftar dan panel detail. Auto-scroll ke bawah hanya berjalan saat berganti percakapan baru. Saat staf membaca pesan lama, scroll tidak dipaksa ke bawah dan muncul floating pill "Pesan baru di bawah". Kegagalan polling mempertahankan data terakhir dan memunculkan banner alert "Pembaruan terhenti" dengan timestamp dan tombol "Coba lagi".
    - **Batas Scope Faktual**: Composer balasan dan catatan internal staf menampilkan kartu informasi Fase P3 ("Composer pengetikan balasan manual ke pelanggan Telegram dan penyimpanan catatan internal staf akan hadir pada fase P3") tanpa input fiktif.
  - **Hasil Pengujian Browser Interaktif (`tests/interactive/verify-p26-inbox.mjs`)**:
    - Dieksekusi live dengan Chrome headless via native CDP terhadap Next.js server produksi lokal dan basis data tes terisolasi PostgreSQL 54332: **15 dari 15 skenario wajib LULUS PENUH (PASS, exit code 0)**.
    - Rincian skenario yang teruji dan lulus:
      1. `auth_setup`: Sesi aktif staf pada rute `/dashboard` (PASS).
      2. `shell_integration_and_indicators`: Judul 'Inbox / Antrean', badge SHADOW, penanda dummy, target sentuh direktori pelanggan >= 40px (PASS).
      3. `desktop_two_pane_layout`: Dua panel berdampingan 1280x800 (listWidth: 420px, detailWidth: 773px) (PASS).
      4. `conversation_list_rendering`: 25 item, preview pesan, waktu format Indonesia, badge unread (PASS).
      5. `non_color_selection_indicator`: Border 4px + teks badge 'Dipilih' (PASS).
      6. `conversation_detail_thread`: Panel aktif kronologis receivedAt ASC + kartu informasi Fase P3 (PASS).
      7. `search_and_filters`: Filter teks dengan reset halaman otomatis ke halaman 1 (PASS).
      8. `empty_vs_filtered_empty_states`: State 'Tidak ada hasil untuk filter ini' + tombol 'Reset filter' (PASS).
      9. `pagination_navigation`: Paginasi 25 item, navigasi halaman, tombol sebelumnya/berikutnya stabil (PASS).
      10. `viewport_read_acknowledgment`: POST /read terkirim hanya untuk pesan terlihat di viewport aktif (PASS).
      11. `polling_and_scroll_retention`: Polling 5s mempertahankan posisi scroll saat membaca pesan lama (PASS).
      12. `polling_failure_and_recovery`: Banner "Pembaruan terhenti" + timestamp WIB + tombol "Coba lagi" (PASS).
      13. `rapid_conversation_switching`: Perpindahan cepat membatalkan in-flight ack tanpa race condition (PASS).
      14. `mobile_viewport_and_navigation`: Single-pane mobile 375x667 dengan tombol 'Kembali' (PASS).
      15. `keyboard_navigation_and_focus`: Focus ring terlihat jelas + region aria-live polite (PASS).
  - **Artefak Bukti Screenshot & JSON (`docs/evidence/P2_6/`)**:
    - `desktop_inbox_two_pane.png`, `desktop_filter_applied.png`, `desktop_empty_filtered.png`, `desktop_polling_stopped_banner.png`, `mobile_inbox_detail.png`, `mobile_inbox_list.png`, `keyboard_focus_ring.png`, dan `p26-interaction-evidence.json`.
  - **Koreksi Review P2.6 Tahap 2 & Penguatan Alat Uji CDP (D117, 2026-10-06)**:
    - **Temuan A (Retry Snapshot Isolation)**: `handleRetryMarkRead` pada `inbox-dashboard.tsx` menggunakan `failedAckSnapshotRef` yang mencatat snapshot pesan gagal pada percakapan aktif; snapshot dibersihkan saat berganti percakapan dan tidak memperluas mark-read ke luar viewport.
    - **Temuan B (Isolasi Lingkungan CDP)**: Runner `verify-p26-inbox.mjs` terisolasi penuh dengan GoTrue container (port 54331), server Next.js terisolasi (port 3310+), header proxy `x-test-server-run-id`, serta pembuatan dan pembersihan akun staf uji via Admin API.
    - **Temuan C (Anti-Stale List)**: `activeListRequestIdRef` melacak request fetch daftar percakapan, mengabaikan respons yang terlambat saat filter atau nomor halaman berubah.
    - **Temuan D (Anti-Stale Detail & Transisi Bersih)**: Pemilihan percakapan baru langsung mengosongkan detail lama; transisi foreground dilacak via `activeForegroundDetailRequestIdRef`; polling latar belakang dipisahkan dari interaksi klik staf (`isBackground`).
    - **Temuan E (Dekopling Error Polling)**: `listPollingError` dan `detailPollingError` dipisahkan; `isLoadingList` dijamin kembali `false` di `finally`.
    - **Temuan F (Re-open Percakapan Sama pada Mobile)**: Mengklik kembali percakapan yang aktif pada mobile beralih ke tampilan `detail` tanpa fetch berlebih dan tanpa mereset scroll/filter.
    - **Temuan G (Ketelitian Format Tanggal WIB Asia/Jakarta)**: `lib/utils/format-date.ts` distandardisasi dengan `Intl.DateTimeFormat` (`timeZone: "Asia/Jakarta"`, `hourCycle: "h23"`). Teruji pada `tests/domain/inbox-ui.test.ts` (7/7 checks passed).
  - **Koreksi Lanjutan P2.6 Tahap 2 & Eliminasi False-Positive (D118, 2026-10-07)**:
    - **Penyelarasan Pasangan Konfigurasi Auth**: `lib/supabase/auth-config.ts` menyelesaikan pasangan URL dan key secara fail-closed (`runtime_server` -> `test_override` -> `public_client`), menolak konfigurasi parsial, dan melarang service-role untuk sesi staf. Teruji pada `tests/utils/auth-config.test.ts` (7 checks passed, exit code 0).
    - **Eliminasi False-Positive Read-Ack**: Port dinamis dikonfigurasi dengan `HELPDESK_TRUSTED_ORIGINS: BASE_URL`, menghilangkan penolakan 403 `origin_mismatch`. Geometri pesan terlihat diukur via `getBoundingClientRect` aktual terhadap scroll container. Respons network `/read` 200, konfirmasi DB `staff_message_reads` (`is_confirmed = true`), supresi pesan off-viewport (0 row), retry snapshot terisolasi setelah injeksi 500, supresi saat tab tersembunyi (`document.hidden = true`), dan anti-stale response diverifikasi empiris.
    - **Pemulihan Guard Lingkungan Uji**: Menggunakan helper guard proyek dari `.test-build/tests/utils/test-guard.js`. Mode `--test-guard-rejection` membuktikan penolakan database workspace aktif (54322/5432/postgres), Supabase API aktif (54321), dan marker token mismatch sebelum adanya mutasi atau query.
    - **Resiliensi Loading Daftar saat Overlap Polling**: `components/inbox/inbox-dashboard.tsx` memisahkan loading foreground via `activeForegroundListRequestIdRef` dan `latestAppliedListRequestIdRef`. Background polling tidak menahan atau menimpa loading foreground, dan `finally` memastikan `setIsLoadingList(false)`.
    - **Siklus Teardown & Verifikasi Residu**: Proses server Next.js dihentikan sinkron (`taskkill`), hasil `deleteUser()` diperiksa `{ error }`-nya, `cleanupFixture()` dijalankan di `finally`, dan residu DB diverifikasi nol (`conv=0, msg=0, id=0`). Mode `--test-cleanup-failure` membuktikan kegagalan teardown menghasilkan status FAIL dan exit code 1.
    - **Suite Pengujian Browser Interaktif (`tests/interactive/verify-p26-inbox.mjs`)**: 17 / 17 skenario wajib LULUS (PASS, exit code 0) mencakup isolasi dataset 28 fixture `[Run-${runId}]` lintas Halaman 1 (25 item) dan Halaman 2 (3 item) yang disjoin, reset paginasi saat filter diterapkan dari Halaman 2, serta isolasi kegagalan detail B setelah A terbuka.
  - **Suite Regresi Lulus Penuh**:
    - `npm run test:unit`: 247 unit tests passed (0 fail, exit code 0).
    - `npm run test:inbox:local`: 33 integration inbox tests passed (0 fail, exit code 0).
    - `node tests/interactive/verify-p26-inbox.mjs --test-guard-rejection`: PASS (exit code 0).
    - `node tests/interactive/verify-p26-inbox.mjs --test-cleanup-failure`: FAIL as expected (exit code 1).
    - `node tests/interactive/verify-p26-inbox.mjs --test-auth-logic`: PASS (exit code 0).
    - `npx tsc -p tsconfig.test.json`: 0 error (exit code 0).
    - `npx eslint`: 0 error, 0 warning (exit code 0).
    - `npm run build`: Turbopack build sukses, 8 rute siap (exit code 0).
    - `node tests/interactive/verify-p26-inbox.mjs`: 23 / 23 assertions passed (exit code 0).
    - `node tests/interactive/verify-p26-inbox.mjs --test-guard-rejection`: PASS (exit code 0).
    - `node tests/interactive/verify-p26-inbox.mjs --test-setup-failure`: FAIL as expected (exit code 1).
    - `node tests/interactive/verify-p26-inbox.mjs --test-cleanup-failure`: FAIL as expected (exit code 1).
  - **Penyelesaian Enam Temuan Review P2.6 Tahap 2 UI Inbox (D119, 2026-10-07)**:
    - **Temuan 1 (Retry Read-Ack & Hidden Tab Assertion Wajib)**: Injeksi kegagalan read-ack nyata (HTTP 500) via `window.fetch` interceptor; verifikasi banner error spesifik `[role="alert"]` teks 'Gagal menyinkronkan status baca' dan tombol 'Coba lagi'; verifikasi snapshot `conversationId` dan `messageIds` dikirim ulang tanpa penambahan ID baru dan terkonfirmasi di DB (`is_confirmed = true`). Skenario tab dokumen tersembunyi (`document.hidden = true`) membuktikan tidak ada request read-ack baru dan status DB tetap tidak terkonfirmasi selama tab tersembunyi. Keduanya menjadi assertion wajib terpisah dalam JSON (`read_acknowledgment_retry_isolation`, `hidden_tab_read_suppression`).
    - **Temuan 2 (Overlap Polling & Penolakan Respons Usang)**: Membuktikan overlap request foreground dan polling interval 5 detik komponen tanpa bypass; verifikasi loading selesai, data halaman 2 tampil, dan pagination berfungsi (`polling_overlap_with_foreground_fetch`). Respons usang dibuktikan dengan menahan respons A, memilih B, lalu melepaskan A; isi panel dan seleksi antrean tetap B (`stale_response_rejection`), terpisah dari detail B gagal setelah A terbuka (`detail_failure_isolation_after_open`).
    - **Temuan 3 (Reset Paginasi & Recovery Error Terisolasi)**: Berangkat dari Halaman 2, filter diterapkan dan assert halaman kembali ke 1 dengan parameter baru (`pagination_reset_on_filter_change`). Pemulihan error list dan detail diuji mandiri via tombol 'Coba lagi' masing-masing tanpa saling menghapus state error (`list_error_and_recovery_isolated`, `detail_error_and_recovery_isolated`).
    - **Temuan 4 (Anti-Bypass Auth Config Fail-Closed)**: `lib/supabase/auth-config.ts` menolak konfigurasi parsial `SUPABASE_URL` tanpa runtime key seketika meskipun test pair lengkap (anti-bypass), melarang peminjaman konfigurasi lintas sumber, dan melarang service-role untuk sesi staf. Teruji pada `tests/utils/auth-config.test.ts` (13 checks passed).
    - **Temuan 5 (Lifecycle Cleanup Nyata & Penguatan taskkill)**: Menghapus assertion sukses buatan; mode `--test-cleanup-failure` mengeksekusi tes nyata dan menginjeksi kegagalan operasional di blok `finally` (exit code 1); `--test-setup-failure` menguji kegagalan setup dan rollback di `finally` (exit code 1); `killProcess()` memverifikasi PID aktif sebelum dan sesudah `taskkill /pid <PID> /f /t`.
    - **Temuan 6 (Keselarasan Bukti, Mobile Polish & Dokumentasi)**: Seluruh 23 skenario dipetakan ke assertion ID konkret di `docs/evidence/P2_6/p26-interaction-evidence.json`. Header detail mobile dirapikan untuk keterbacaan identitas dan efisiensi ruang vertikal (`docs/evidence/P2_6/mobile_inbox_detail.png`).
  - **Penutupan Lima Kelompok Temuan Review P2.6 Tahap 2 UI Inbox (D120, 2026-10-07)**:
    - **Temuan 1 (Fallback Cleanup & Rollback Mid-Run Residu Nol)**: Mode `--test-cleanup-failure` mempertahankan error pembersihan awal (`cleanupErrors`), menghasilkan overall FAIL dan exit code 1, sembari mengeksekusi fallback cleanup otomatis sehingga residu database tetap terbukti nol (`conv=0, msg=0, id=0`). Mode `--test-midrun-failure` membuktikan kegagalan di tengah eksekusi memicu penghentian proses (`taskkill`) dan rollback database di `catch`/`finally` tanpa klaim kelulusan skenario UI yang belum dieksekusi.
    - **Temuan 2 (Penolakan Respons Usang Berbasis Barrier)**: Dimulai deterministik dari Percakapan C (initial condition tervalidasi). Intersepsi network `GET /api/inbox/conversations/${convAId}` menahan request A (`A_requested`), staf memilih B (`B_rendered`), respons A dilepas (`A_released`) dan selesai (`A_resolved`); panel dan seleksi antrean tetap menampilkan data B tanpa tertimpa data A (`B_remains_active`). Riwayat urutan barrier tersimpan dalam JSON bukti. Skenario kegagalan detail B setelah A terbuka tetap dipisahkan mandiri.
    - **Temuan 3 (Isolasi Pemulihan Dua Arah & Polling Banner Alert)**: Mematahkan dugaan error saling menghapus dengan mengendalikan `__faultList` dan `__faultDetail` secara independen: Arah A membuktikan pemulihan daftar (25 item) saat detail error bertahan; Arah B membuktikan pemulihan detail (Beta aktif) saat daftar error bertahan. Assertion dinilai ulang menjadi `polling_failure_and_banner_alert` tanpa overpromise pemulihan.
    - **Temuan 4 (Pemulihan Assertion Ketat & Registri Mandatori Fail-Closed)**: Read-ack normal menggunakan fixture khusus `convReadTestId` (Pelanggan Delta, 9 pesan) dengan pra-verifikasi 0 pembacaan di DB sebelum klik, pre-attached network listener, mewajibkan HTTP 200, `{ success: true }`, penambahan DB `is_confirmed = true`, off-viewport 0 DB rows, tanpa fallback longgar `HTTP || DB`. Reset paginasi memverifikasi Page 2 aktif sebelum filter diubah dan Page 1 aktif setelah filter. Integritas dataset menguji strict set equality 28 fixture (`missing === 0 && unexpected === 0`). `finalize()` memvalidasi kelengkapan registri mandatori per mode (`NORMAL_BROWSER_REGISTRY`, `GUARD_REJECTION_REGISTRY`, `SETUP_FAILURE_REGISTRY`, `MIDRUN_FAILURE_REGISTRY`, `CLEANUP_FAILURE_REGISTRY`); missing atau duplicate ID menghasilkan `INCOMPLETE`/`FAIL` dengan exit code 1.
    - **Temuan 5 (Preservasi 5 Artefak JSON Multimode, Metadata SHA256 & Polish Mobile)**: Berkas bukti tidak lagi dihapus antar-run (`fs.unlinkSync` dihapus); 5 artefak JSON per mode tersimpan berdampingan di `docs/evidence/P2_6/` (`p26-interaction-evidence.json`, `p26-runner-cleanup-fail.json`, `p26-runner-setup-fail.json`, `p26-runner-midrun-fail.json`, `p26-evidence-guard-rejection.json`) lengkap dengan metadata `runId`, `mode`, timestamp, hash SHA256 berkas kunci, dan bebas password/rahasia. Header detail mobile pada `inbox-conversation-panel.tsx` disempurnakan (`flex-col sm:flex-row`, badge wrapping) untuk mencegah pemotongan judul pengirim.
  - **Koreksi Integritas Runner, Isolasi Stale Interceptor, Pipeline Cleanup Terpadu, Artefak Unik Per-Run, dan Pengujian Mandiri Finalizer (D121, 2026-10-07)**:
    - **Temuan 1 (Sinkronisasi Build Identity & Verifikasi Header Mobile Aktual)**: Rebuild aplikasi dengan `npm run build` menghasilkan `BUILD_ID: I0LId5PqSH7QOBl8HCYN4`. Runner merekam hash SHA256 source aplikasi pada saat build dan peluncuran serta memvalidasi kesinkronannya saat finalisasi (`isSynchronized: true`). Runner revision hash dicatat mandiri (`b945740e749ce38735c159e2bd4273d068dce74fe4d51612c0d1bb4fae779a23`). Tangkapan layar `mobile_inbox_detail.png` membuktikan wrapping header mobile aktual (`flex-col sm:flex-row`, badge `Percakapan Aktif` dan `Ditangani` terbungkus rapi tanpa pemotongan teks).
    - **Temuan 2 (Isolasi Interceptor Stale & Sekuens Event Lengkap)**: Interceptor stale response dibuat single-use dan dipulihkan tanpa syarat di `finally` (`window.fetch = window.__origFetchBeforeStale`), mencegah kebocoran state. Sekuens event lengkap terekam deterministik: `["A_requested", "B_rendered", "A_released", "A_resolved", "B_remains_active"]`. Skenario `detail_failure_isolation_after_open` memvalidasi keterbukaan Percakapan A via polling DOM sebelum fault HTTP 500 diinjeksikan pada Percakapan B menggunakan fixture ID run (`convBId`). Interceptor dipulihkan di `finally`.
    - **Temuan 3 (Pipeline Cleanup Terpadu & Fallback pada Batas Pemanggilan)**: Penyatuan arsitektur cleanup `primaryCleanupFn -> catch -> fallbackCleanupFn`. Pada `--test-cleanup-failure`, fault diinjeksi pada batas pemanggilan primary cleanup, handler catch menangkap error, mencatat `cleanupErrors` (memaksa status FAIL dan exit code 1), dan fallback cleanup membersihkan seluruh fixture run dengan 0 residu database terverifikasi.
    - **Temuan 4 (Penyimpanan Artefak Unik Per-Run & Manifest Index)**: Setiap eksekusi runner disimpan dalam direktori unik terisolasi `docs/evidence/P2_6/<runId>/` tanpa menimpa run sebelumnya (`run-4e4e31df`, `guard-316b9a84`, `setup-fail-f8581666`, `midrun-fail-a783dbf9`, `cleanup-fail-fc83f2bc`). Seluruh tangkapan layar PNG dan JSON bukti disimpan di dalam direktori run masing-masing. Berkas indeks `docs/evidence/P2_6/latest-manifest.json` memetakan run terbaru per mode dengan pembedaan `expectedExitCode`, `calculatedExitCode`, dan process exit code.
    - **Temuan 5 (Pengujian Negatif Mandiri Logika Finalizer)**: Logika finalizer diekstraksi menjadi fungsi murni `evaluateFinalizeResults()` di `verify-p26-inbox.mjs` tanpa ketergantungan browser, DB, atau Next.js. Berkas pengujian mandiri `tests/interactive/verify-finalizer.test.mjs` memverifikasi 5 kasus wajib: (1) PASS lengkap exit 0; (2) Missing required ID -> INCOMPLETE exit 1; (3) Duplicate ID -> FAIL exit 1; (4) Mode registry compliance (Guard & Setup) -> PASS exit 0; (5) Cleanup error -> FAIL exit 1. Seluruh 5/5 kasus PASS (exit code 0).
  - **Pengikatan Build–Source Eksplisit, Validasi Metadata Terarah, Pemisahan Exit Code Jujur, dan Penyelarasan Bukti (D122, 2026-10-07)**:
    - **Pengikatan Build–Source Sebenarnya (`scripts/build-source-manifest.mjs`)**: Kompilasi `npm run build` merekam hash SHA-256 pre-build vs post-build atas 18 berkas cakupan eksplisit (`p26_inbox_and_auth`). Memverifikasi ketiadaan mutasi berkas selama build, mengikat `BUILD_ID: F-DKJqKQFwVIN2WjYeN-h`, dan menerbitkan manifest `status: VALID` pada `.next/build-source-manifest.json` dan `docs/evidence/P2_6/build-source-manifest.json`.
    - **Validasi Metadata Terarah (`tests/interactive/verify-build-metadata.test.mjs`)**: Membedakan `sourceHashesAtBuild`, `sourceHashesAtLaunch`, dan `sourceHashesAtFinalize`. Seluruh 6 kasus teruji mandiri: (1) Matching -> SYNCHRONIZED exit 0; (2) Missing manifest -> FAIL exit 1; (3) BUILD_ID mismatch -> FAIL exit 1; (4) Pre-launch mutation -> FAIL exit 1; (5) Runtime mutation -> FAIL exit 1; (6) Mode non-aplikasi -> kasus keenam menguji `guard_rejection` secara langsung (`NOT_APPLICABLE`, exit 0); fungsi implementasi juga mendukung `setup_failure` sebagai `NOT_APPLICABLE` secara logika. Seluruh 6/6 kasus PASS (exit code 0).
    - **Integrasi Runner & Live Normal Browser Run (`run-7fc817aa`)**: Assertion `build_source_binding_verification` ditambahkan ke registri (total 24 assertion). Evaluasi Step 2.5 memvalidasi build manifest sebelum Next.js/Chrome aktif. Seluruh 24 / 24 assertion PASS (exit code 0), runner revision hash `981bed57424824f3c5fd000301eda833efef56eaecea9a3a9645c45471393525`, 0 residu database (`conv=0, msg=0, id=0`), artefak di `docs/evidence/P2_6/run-7fc817aa/`.
    - **Pemisahan Exit Code yang Jujur & Penyelarasan Laporan**: Membedakan `expectedExitCode`, `calculatedExitCode`, dan process exit code dari eksekutor (bukan field JSON). Mengoreksi tabel cleanup: setup & mid-run failure menjalankan rollback di blok `finally`, bukan fallback cleanup pipeline (fallback cleanup hanya diuji pada mode `--test-cleanup-failure`).
  - **Penutupan Resmi P2.6, Klarifikasi Keterbatasan Histori D116/D117, dan Penyelarasan Cakupan Pengujian Metadata (D123, 2026-10-07)**:
    - **Penutupan Berbasis Bukti Aktual**: P2.6 ditutup resmi (Done) berdasarkan bukti live normal terbaru `docs/evidence/P2_6/run-7fc817aa/evidence.json` (24/24 assertion PASS, exit 0, status SYNCHRONIZED, 0 residu database) bersama bukti historis mode negatif yang telah diterima per-run (`guard-316b9a84`, `setup-fail-f8581666`, `midrun-fail-a783dbf9`, `cleanup-fail-fc83f2bc`).
    - **Keterbatasan Histori D116/D117**: Dicatat secara append-only bahwa isi asli entri D116 dan D117 sebelum pemadatan belum dapat diverifikasi atau dipulihkan dari sumber yang tersedia di workspace. Hal ini menjadi catatan dokumentasi nonpenghambat tanpa mempengaruhi validitas implementasi atau bukti empiris yang telah diterima.
    - **Ketepatan Cakupan Pengujian Metadata**: Menegaskan bahwa kasus 6 menguji langsung `guard_rejection` (`NOT_APPLICABLE`), sementara dukungan `setup_failure` merupakan fitur implementasi yang didukung secara logika tanpa klaim pengujian langsung pada kasus tersebut.
  - **Suite Regresi Lulus Penuh**:
    - `npm run test:unit`: 253 unit tests passed (0 fail, exit code 0).
    - `npm run test:inbox:local`: 33 integration inbox tests passed (0 fail, exit code 0).
    - `node tests/interactive/verify-build-metadata.test.mjs`: 6/6 metadata tests passed (exit code 0).
    - `node tests/interactive/verify-finalizer.test.mjs`: 5/5 negative/positive finalizer tests passed (exit code 0).
    - `node tests/interactive/verify-p26-inbox.mjs --test-guard-rejection`: 3/3 passed (exit code 0, artefak: `docs/evidence/P2_6/guard-316b9a84/`).
    - `node tests/interactive/verify-p26-inbox.mjs --test-setup-failure`: FAIL as expected (exit code 1, user deleted, 0 residuals, artefak: `docs/evidence/P2_6/setup-fail-f8581666/`).
    - `node tests/interactive/verify-p26-inbox.mjs --test-midrun-failure`: FAIL as expected (exit code 1, processes killed, fixtures cleaned, 0 residuals, artefak: `docs/evidence/P2_6/midrun-fail-a783dbf9/`).
    - `node tests/interactive/verify-p26-inbox.mjs --test-cleanup-failure`: FAIL as expected (exit code 1, fallback cleanup executed, 0 residuals, artefak: `docs/evidence/P2_6/cleanup-fail-fc83f2bc/`).
    - `node tests/interactive/verify-p26-inbox.mjs`: 24 / 24 assertions passed (exit code 0, 0 residuals, artefak: `docs/evidence/P2_6/run-7fc817aa/`).
    - `npx tsc --noEmit`: 0 error (exit code 0).

**Catatan/Blocker**

P2.6 selesai penuh (**✅ Done**). Seluruh acceptance criteria P2.6 Tahap 1 (fondasi schema unread persisten per staf, transaksi advisory lock, anti-bypass auth-config, kontrak pagination 10/10/8, integritas snapshot kueri tunggal) dan Tahap 2 (UI Inbox dashboard, layout responsif dua panel & single-pane mobile, penanda non-warna WCAG AA, viewport read-ack via IntersectionObserver, polling 5 detik non-destruktif, isolasi error, resiliensi loading overlap, pengikatan build-source eksplisit, dan siklus pembersihan residu nol) telah terverifikasi secara empiris. Pipeline berikutnya adalah [P2.7](#task-p2-7) (Panel konteks identitas dan evidence jaringan). Belum memulai P2.7 atau P2.8.

</details>

<a id="task-p2-7"></a>

<details>
<summary>P2.7 — Panel konteks identitas dan evidence jaringan</summary>

**Acceptance Criteria**

Staf dapat melihat konteks lengkap percakapan aktif: identitas pengirim, status verifikasi (`verified` vs `unverified`), relasi pelanggan & layanan tunggal tervalidasi server (fail-closed untuk unverified/manual tanpa fallback service ID acak), topologi ODP/ODC mapping v1; pemeriksaan jaringan on-demand ("Cek Ulang") tanpa mutasi episode/claim/outbound dengan pembatalan request in-flight dan parsing safe error envelope; pemisahan independen antara bukti status ONU dan tautan upstream (termasuk waktu observasi, kualitas, sumber, event ID); penyebut coverage eksak (`los LOS / valid valid / total total`); semantik jujur (area unknown = "Belum Dapat Ditentukan", no_indication = "Tidak Memenuhi Indikasi Area", online != internet normal, LOS != kabel fisik putus, timeout/error != down); dynamic proof age dengan penurunan kualitas/status otomatis pada data usang (> 5 menit); penjelasan alasan triage operasional Indonesia; pemisahan insiden aktif lapangan (Seksi 1) dari triage historis tersimpan (Seksi 3); serta layout responsif adaptif (>= 1440px 3 kolom permanen `min-[1440px]:flex`, 1024–1439px drawer slide-over dengan focus trap, keyboard Escape, & focus restoration, < 1024px sub-nav tabs dengan supresi read-ack saat drawer terbuka atau tab konteks aktif yang pulih saat ditutup/beralih ke pesan).

**Bukti/Verifikasi**

`components/inbox/inbox-evidence-panel.tsx`, `components/inbox/inbox-conversation-panel.tsx`, `components/inbox/inbox-dashboard.tsx`, `lib/domain/evidence-semantics.ts`, `lib/application/inbox-service.ts`, `app/api/inbox/conversations/[id]/context/route.ts`, `app/api/inbox/conversations/[id]/network-check/route.ts`, `tests/domain/evidence-semantics.test.ts`, `tests/application/inbox-context-service.test.ts`, `tests/domain/build-manifest-validation.test.ts`, `tests/interactive/verify-p27-evidence.mjs`, `tests/interactive/verify-p27-ui-lifecycle.mjs`, `tests/interactive/verify-request-correlator.test.mjs`, `tests/interactive/verify-finalization-handler.test.mjs`, `tests/interactive/verify-build-metadata.test.mjs`, `docs/P2_7_REVIEW.md`, decision log D124–D135:
- **Pengamanan Error Asynchronous Menjelang Finalisasi & Freeze Guard (`drainInFlightHandlers`, `TeardownCancellationError`, & `--test-finalization-async-failure`)**:
  - `CDPClient` menolak pekerjaan pengujian baru (`stopAcceptingNewEvents`) saat memasuki finalisasi sambil mempertahankan penyelesaian frame command (`msg.id`) untuk mencegah deadlock.
  - Seluruh Promise handler in-flight ditunggu secara tuntas sebelum hasil dibekukan via `drainInFlightHandlers(5000)`. Timeout drain menghasilkan kegagalan fatal tercatat.
  - Membedakan pembatalan teardown yang disengaja (`TeardownCancellationError`) dari kegagalan pengujian sebenarnya, sehingga penutupan koneksi tidak memicu false fail namun error terlambat tetap dicatat dan tidak disamarkan.
  - Hasil akhir mengevaluasi `effectiveFatalError = runnerFatalError || asyncControllerError || drainError`, memastikan error asynchronous terlambat pada controller menggagalkan run (exit code 1) meskipun seluruh assertion skenario sebelumnya PASS.
  - Freeze guard (`isTestPhaseFinalized` & `isArtifactFinalized`) mencegah modifikasi assertion atau bukti pasca-finalisasi.
  - Terbukti lewat pengujian unit deterministik (`tests/interactive/verify-finalization-handler.test.mjs`, **11/11 PASS, exit code 0**): memvalidasi batas logika spesifik (penghentian event baru via flag `isFinalizing`, drain timeout, late rejection capture, pembedaan `TeardownCancellationError`, dan fungsi tiruan freeze guard) sebagai komplemen deterministik pembuktian run nyata `final-fail-0d71a4ac`.
  - Mode harness kegagalan finalisasi `--test-finalization-async-failure` (`final-fail-0d71a4ac`): **Exit code 1 (kegagalan terkendali terbukti)**, `effectiveFatalError` dan `asyncFailureError` tercatat menggagalkan keseluruhan run meskipun delapan assertion (6 skenario UI + 1 validasi build + 1 cleanup) bernilai PASS secara individual, teardown bersih via `taskkill`/PID (0 residu), 0 unhandled rejection.
- **Korelasi Request Jaringan Deterministik (`NetworkRequestCorrelator` & `tests/interactive/verify-request-correlator.test.mjs`)**:
  - Seluruh fallback berbasis URL dihapus permanen. Korelasi request Fetch, respons CDP Network, dan event penyelesaian (`loadingFinished`/`loadingFailed`) dikaitkan strictly menggunakan identitas unik `fetchParams.networkId`.
  - Jika `networkId` tidak tersedia, kosong, atau ambigu, pemeriksaan digagalkan seketika dengan error eksplisit.
  - Entri respons dan penyelesaian dihapus deterministik begitu dikonsumsi, mencegah penggunaan ulang bukti historis.
  - Terbukti lewat pengujian unit deterministik (`tests/interactive/verify-request-correlator.test.mjs`, **8/8 PASS, exit code 0**).
- **Suite Pengujian Lifecycle UI Terpadu Normal (`tests/interactive/verify-p27-ui-lifecycle.mjs`)**:
  - Dieksekusi live terhadap Next.js server produksi lokal dan basis data tes terisolasi via Chrome CDP Native Fetch Interceptor dan Network Correlator.
  - Menguji dan membuktikan 6 skenario siklus hidup DOM secara presisi:
    1. *Stale Context Reordering*: Membuktikan penolakan konteks basi pada kunjungan yang sama (request lama A_old ditahan, polling terbaru A_new diselesaikan duluan dan diverifikasi di DOM, A_old dilepas setelahnya dan diverifikasi ditolak).
    2. *Slow Foreground & Polling Resilience with Strict Isolated Retry*: Menangkap 2 request berbeda (foreground ditahan dan background polling). Polling gagal 500 saat foreground in-flight memicu banner "Pembaruan terhenti"; background polling diisolasi via `document.hidden = true`; memverifikasi ketersediaan tombol retry `[role="alert"] button`; klik nyata mengeksekusi rangkaian pemulihan list (`/api/inbox/conversations`) diikuti detail (`/api/inbox/conversations/:id`); respons 200 dipenuhi dan membuktikan banner hilang, loading selesai, konteks konsisten, serta polling otomatis dipulihkan.
    3. *Delayed Network Check Rejection (A $\to$ B dan A $\to$ B $\to$ A murni)*: Membuktikan transisi A $\to$ B $\to$ A tanpa request pengganti sebelum respons A awal dilepas. Pemeriksaan A awal ditahan, beralih ke B (tampil di DOM), kembali ke A (tampil di DOM), respons A awal baru dilepas dengan marker `STALE-CHECK-SNAPSHOT-ABA`, marker ditolak, konteks A utuh, diikuti kontrol positif pemeriksaan sah dengan marker `LEGIT-POSITIVE-CONTROL` tampil di DOM. Skenario A $\to$ B tetap dipertahankan.
    4. *Assessment Sync Non-Reason Terisolasi dari Baseline API Aktual & Pergantian Layanan*: Baseline detail & context diambil langsung dari respons API aktual (mempertahankan classification lengkap dengan `ruleVersion: "unknown"`, `lastActivityAt`, pesan, urutan, sender, customer, service); mutasi HANYA pada field assessment yang sah (`triageAssessment.decision.mode = "FULL"` pada detail summary, `historicalAssessment.incidentId` pada context); diverifikasi DOM terbarui via polling dengan perbandingan data aktual sebelum/sesudah. Kasus pergantian Service ID nyata (4b) tetap diuji secara terpisah.
    5. *Preservasi Unresolved pada 3 Putaran Polling Riil dengan Korelasi NetworkId Eksak*: Memastikan `outcome=unresolved` tampil di DOM awal; memonitor penyelesaian jaringan nyata (HTTP 200 + `loadingFinished`) untuk pasangan detail dan context pada setiap putaran dengan `networkId` unik tanpa fallback URL; memverifikasi preservasi `outcome=unresolved` dan status Belum Terverifikasi di DOM setelah SETIAP putaran selesai (3 putaran penuh terbukti dengan 6 request HTTP 200 terdata); rincian putaran tersimpan lengkap dalam artefak `evidence.json`.
    6. *Safe Partial Non-2xx Snapshot & Penolakan Respons Kedaluwarsa Ketat*: Seluruh pola `if (heldRequest)` dihapus; request yang ditahan wajib tertangkap, transisi ke konteks aktif terverifikasi di DOM sebelum pelepasan lama, respons dilepas tanpa syarat, dan DOM membuktikan marker/error lama tidak menimpa konteks aktif.
  - Artefak Terkini D134: `docs/evidence/P2_7/lifecycle-2ec3deb5/evidence.json` (**8 dari 8 assertion PASS [komposisi: 6 skenario UI + 1 validasi build + 1 assertion cleanup], exit code 0, 6 screenshot PNG, BUILD_ID: T03sqBYh5cjVTfuKOsPAB, mode: ui_lifecycle, runner hash: `365c381e5f7d0a641125b6a74233773f74ac27dc37356ba64eb509dc9afb0ad8`, SYNCHRONIZED, proses dihentikan bersih via taskkill/PID, 0 residu, 0 unhandled rejection**).
  - 8 Assertion Eksak: `build_source_binding_verification`, `ui_lifecycle_stale_context_rejected_a_b_a`, `ui_lifecycle_slow_foreground_with_polling_consistent`, `ui_lifecycle_delayed_network_check_rejected_on_service_change`, `ui_lifecycle_assessment_and_service_change_syncs_context`, `ui_lifecycle_noop_polling_preserves_unresolved`, `ui_lifecycle_partial_non_2xx_accepted_and_stale_rejected`, `runner_cleanup_and_teardown`.
  - 6 Screenshot Eksak: `01_ui_lifecycle_reordered_context.png`, `02_ui_lifecycle_slow_fg_polling.png`, `03_ui_lifecycle_delayed_check_rejected.png`, `04_ui_lifecycle_assessment_service_sync.png`, `05_ui_lifecycle_polling_preserves_unresolved.png`, `06_ui_lifecycle_partial_non2xx_and_expired.png`.
  - Artefak Historis: `lifecycle-c911ebbb` (D133), `async-fail-c017efb5` (D133), `guard-reject-cb6843c8` (D133), `lifecycle-7961395d` (D132), `guard-reject-529b65bc` (D132), `lifecycle-ff68345d` (D131), `guard-reject-cd367f97` (D131), `lifecycle-4dd925d8` (D130), `lifecycle-7de3ac68`, dan `guard-reject-919966bb` disimpan sebagai arsip historis tanpa diulang pada revisi runner terbaru.
- **Proteksi Runner & Pembuktian Guard Rejection Melalui Jalur Setup**:
  - `executeRunnerSetupPipeline` digunakan bersama oleh runner normal dan mode negatif. Pembuktian penolakan database workspace aktif (54322), Supabase API aktif (54321), dan marker token mismatch diverifikasi menghentikan proses sebelum mutasi (mutation spy calls = 0), dengan audit residu komprehensif lintas resource API (`listUsers()`) dan database (`customers`, `conversations`).
  - Teardown memeriksa `{ error }` dari `deleteUser()`, wait loop terminasi proses, verifikasi residu DB, dan pelaporan cleanup error tanpa catch kosong.
- **Penyatuan Implementasi Fixture Pembanding & Serialisasi Metrik Finalizer (`tests/interactive/verify-p27-evidence.mjs`)**:
  - Menggunakan fungsi bersama `seedForeignComparisonFixture`, `checkForeignComparisonFixture`, `cleanupForeignComparisonFixture`, dan `queryForeignComparisonResiduals`.
  - Fault injection langsung pada kueri DB nyata yang dipanggil implementasi bersama.
  - Finalizer menserialisasi `operationsAttempted`, `operationsSucceeded`, `recoveryCompleted`, `residualBreakdown`, `residualsRemaining`, `expectedInjectedFailuresCount`, dan `unexpectedFailuresCount` ke dalam JSON bukti.
  - Mode negatif harness terverifikasi (`foreign-chk-fail-4dc15a98`, `foreign-del-fail-7b2c2a72`).
- **Pengujian Browser Interaktif Real Next.js (`tests/interactive/verify-p27-evidence.mjs`)**:
  - Live normal browser run `run-0efe31f6`: **21 dari 21 assertion wajib PASS (exit code 0)** pada build `BUILD_ID: T03sqBYh5cjVTfuKOsPAB`.
  - Residu database nol, user staf dihapus, proses Next.js dan Chrome diterminasi bersih via `taskkill` dan verifikasi keberadaan PID.
- **Regresi Suite Lulus Penuh**:
  - `npm test`: 277 unit, application, & domain tests passed (3 suites, 0 fail, exit code 0).
  - `node tests/interactive/verify-build-metadata.test.mjs`: 9 kontrak build metadata passed (0 fail, exit code 0).
  - `node tests/interactive/verify-request-correlator.test.mjs`: 8 kontrak correlator passed (0 fail, exit code 0).
  - `node tests/interactive/verify-finalization-handler.test.mjs`: 11 kontrak finalization handler passed (0 fail, exit code 0).

**Catatan/Blocker**

P2.7 selesai penuh (**✅ Done**). Seluruh acceptance criteria panel konteks identitas dan evidence jaringan, semantik jujur, layout adaptif, supresi read-ack, proteksi race-condition A→B→A, korelasi request deterministik berbasis `networkId`, serta penutupan celah error asynchronous pada batas finalisasi runner telah diverifikasi secara empiris dan diterima secara resmi pada review penutup (**D135**). Bukti konkret aktual (`lifecycle-2ec3deb5` 8/8 PASS, `final-fail-0d71a4ac` exit code 1 dengan clean teardown, `verify-finalization-handler.test.mjs` 11/11 PASS, `verify-request-correlator.test.mjs` 8/8 PASS, `run-0efe31f6` 21/21 PASS, build `T03sqBYh5cjVTfuKOsPAB` SYNCHRONIZED, 0 residu, 0 unhandled rejection). Validasi penutupan dilakukan murni melalui pemeriksaan dokumen dan artefak bukti tanpa menjalankan ulang pengujian. Pipeline berikutnya adalah [P2.8](#task-p2-8) (Label dan koreksi klasifikasi oleh staf). P2.8 tetap berstatus ⬜ Not Started. Tiket Custpanel dan delegasi teknisi tetap berada di Custpanel.

</details>

<a id="task-p2-8"></a>

<details>
<summary>P2.8 — Label dan koreksi klasifikasi oleh staf</summary>

**Acceptance Criteria**

Staf dapat menyimpan label/koreksi bersama aktor dan waktu; hasil rule asli dan versinya tetap tersimpan; data dapat digunakan untuk evaluasi klasifikasi PRD §13; seluruh alur keyboard nyata terbukti tanpa manipulasi buatan; episode, claim, dan debounce terbukti utuh sebelum vs sesudah; serialisasi konkuren dua staf konsisten; dan tombol error banner pada mobile 375px terukur $\ge 40$px tanpa overflow.

**Bukti/Verifikasi**

- Migration `20261012100000_create_staff_classification_labels.sql`: tabel `public.staff_message_classifications` dan riwayat `public.staff_message_classification_history` persisten di PostgreSQL.
- Domain & Service: `lib/domain/staff-classification.ts` (sanitasi batas maks 1000 karakter, penolakan kelebihan panjang dengan error) dan `lib/application/inbox-service.ts` (resolusi atribusi pemilik asli record pada simpan idempoten antar-staf via `auth.users`).
- Unit & Service Tests: `npm test` meluluskan 305/305 tests (0 fail, exit code 0), termasuk suite domain dan multi-staff idempotent attribution.
- API Route: `app/api/inbox/conversations/[id]/messages/[messageId]/classification/route.ts` menegakkan sesi server dan menolak pemalsuan aktor payload.
- UI Inbox: `components/inbox/inbox-message-classification.tsx` (pemisahan detail label tersimpan dari draft form edit, rekonsiliasi respons simpan terhadap versi server terkini via `latestStaffClassificationRef` dan `onClassificationSaved` tanpa stale closure, preservasi draft dan in-flight request status saat polling, notifikasi pembaruan konkuren `concurrent-update-notice`, banner error mandiri dengan `role="alert"` & `aria-live="polite"` pada konfirmasi langsung, isolasi error dari polling background, tombol "Coba lagi", keyboard handlers Space/Enter, focus management terpadu dengan pemulihan fokus otomatis ke tombol trigger, touch target $\ge 40$px) dan `inbox-dashboard.tsx` (rekonsiliasi simpan dan polling berbasis timestamp server `updatedAt` konsisten, isolasi perpindahan percakapan A→B dan A→B→A via visit token, penanda polling deterministik `data-detail-poll-count`, kepatuhan terhadap jeda polling `__TEST_PAUSE_POLLING`).
- Pengujian Integrasi DB: `npm run test:classification:local` meluluskan 11/11 subtests (0 fail, exit code 0), membuktikan persistensi, idempotensi atribusi multi-staf, serialisasi simpan konkuren via `inHelpdeskTransaction` (`pg_advisory_xact_lock(20260922, 14)` + `FOR UPDATE`), validasi dua urutan serial sah ($A \to B$ atau $B \to A$), penolakan otorisasi role `anon`/`authenticated` (SQLSTATE `42501`), proteksi pemalsuan aktor, dan zero operational side effects dengan perbandingan snapshot terisolasi (seluruh field operasional `complaints`, `reply_claims` dengan `owner_id` dan scope episode `scope_kind = 'episode'`, serta `outbound_intents` 100% identik sebelum vs sesudah, preservasi guard debounce terbukti melalui klaim episode yang utuh).
- Verifikasi Browser Chrome Nyata: `node tests/interactive/verify-p28-classification.mjs` (run `p28-75081ab2`, BUILD_ID `iOA-WRCicCUpodwhhbh-Q`, status `SYNCHRONIZED`) meluluskan 15/15 assertion (0 fail, exit code 0) dengan tangkapan layar PNG di `docs/evidence/P2_8/p28-75081ab2/screenshots/`:
  1. Alur keyboard lengkap murni via CDP `Input.dispatchKeyEvent`: Tab mencapai tombol edit, Enter membuka form, radio auto-focus, Tab ke Batal, Enter batal dan tutup form, focus restoration kembali ke tombol edit, Enter buka kembali, ArrowRight & ArrowLeft mengubah kategori radio, Tab ke textarea, typing catatan nyata tanpa setter value, Tab & Shift-Tab bolak-balik antara Batal dan Simpan, serta Enter simpan yang menutup form dan memperbarui UI.
  2. Preservasi draft editor Staf A saat Staf B menyimpan pembaruan via backend aplikasi dan diterima polling A, serta resiliensi in-flight loading request saat polling.
  3. Pengujian retensi error konfirmasi langsung bertahan melintasi 2 siklus polling deterministik berturut-turut tanpa interaksi staf, tombol coba lagi berhasil menyimpan dan menghapus error, tombol dismiss 'Tutup' bekerja, serta isolasi switch percakapan bersih.
  4. Penolakan respons simpan terlambat Staf A terhadap Versi B Staf B dengan korelasi deterministik `NetworkRequestCorrelator` (menyimpan Fetch `requestId` dan Network `networkId`), sinkronisasi event handler UI (`test:classification-response-handled`), penjagaan jeda polling background (`window.__TEST_PAUSE_POLLING = true`), verifikasi DB record aktif dan seluruh 5 baris riwayat audit runtut termasuk field `notes`, penolakan Bearer token tidak valid (401 tanpa mutasi), bukti negatif penolakan korelasi timeout, serta kasus kontrol Versi C baru diterapkan langsung dengan menutup editor.
  5. Pengukuran aktual touch target mobile 375px: `retry-confirm-btn` (80×44px) dan `dismiss-error-btn` (57×44px) terukur $\ge 40$px tanpa tumpang tindih (`noOverlap = true`) dan tanpa overflow horizontal (`hasHorizontalOverflow = false`); screenshot banner error diambil saat viewport 375px dan tersimpan unik sebagai `06_mobile_confirmation_error.png` tanpa tertimpa desktop (diverifikasi pada run terarah `p28-554dc41a`).
  6. Murni anotasi evaluasi: 0 outbound intents dikirim, 0 klaim dispatch teknisi, snapshot komplain dan debounce utuh.
- Dokumentasi lengkap di `docs/P2_8_REVIEW.md` dan keputusan teknis di `docs/decision-log.md` (D136, D137, D138, D139, D140, D141, D142).

**Catatan/Blocker**

P2.8 berstatus ✅ **Done** (D136, D137, D138, D139, D140, D141, D142). Seluruh acceptance criteria PRD §13, seluruh penutupan kekurangan bukti empiris, dan dua catatan review terakhir telah terpenuhi secara konkret dan terverifikasi penuh. P2.7 dan P2.9 tetap Done. Tiket Custpanel dan delegasi teknisi tetap berada di Custpanel. Pipeline berikutnya sesuai urutan dan dependensi TRACKER.md adalah [P2.10](#task-p2-10) (Konfigurasi dan deployment prototype SHADOW) dan [P2.11](#task-p2-11) (Verifikasi vertical slice SHADOW end-to-end).

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

- Build produksi Next.js terverifikasi: `npm run build` sukses (exit code 0), `BUILD_ID: uCRy779fnf8FFKoi4n9bz`, manifest 26 berkas valid (`scripts/build-source-manifest.mjs`).
- Bot Telegram live terverifikasi via Bot API: ID `8892832714`, username `@upaznet_helpdesk_proto_bot`, account ID `upaznet_helpdesk_bot`, allowlist tester `6727338166` (`scripts/manage-telegram-webhook.mjs status`). Konfigurasi webhook pada bot publik dipertahankan tanpa perubahan pada sesi perbaikan tooling ini.
- Tooling deployment diperbaiki dan diverifikasi penuh pada database terisolasi (`tests/tooling/deployment-tooling.test.mjs`, **42/42 checks PASS, exit code 0**, D144, D145, D146, D147, D148):
  1. Paritas TLS runtime (`parseAndValidateDbConfig`): remote wajib `sslmode=verify-full`, menolak `rejectUnauthorized: false` dan `sslmode=disable`, tanpa kebocoran credential pada log/error (Suite 1: 7 checks PASS).
  2. Atomisitas transaksi migrasi tunggal (`stripOuterTransactionWrapper`): DDL migrasi dan pencatatan versi ke `schema_migrations` dijalankan dalam 1 transaksi atomik; injeksi error membuktikan rollback serentak DDL dan version record (Suite 2: 4 checks PASS).
  3. Penanganan respons Telegram eksplisit, transport/CLI lokal terkontrol, & validasi endpoint URL (`manage-telegram-webhook.mjs`): respons `ok: false`, HTTP status gagal (termasuk body `ok: true`), JSON rusak pada HTTP 200, transport timeout (< 2s), dan network error memicu exit nonzero (exit code 1); CLI subprocess menghasilkan exit code 1 tanpa sukses palsu; pembanding sukses CLI menghasilkan exit code 0 dengan verifikasi kesesuaian URL via `getWebhookInfo` pasca-set/restore dan penegakan `drop_pending_updates: false` pada fixture loopback; validasi ketat `validateTelegramApiBaseUrl` mewajibkan HTTPS untuk host nonlokal, membatasi HTTP strictly ke loopback (`localhost`, `127.0.0.1`, `::1`), menolak hostname penipu, kredensial URL, dan protokol non-HTTP/HTTPS dengan nol pemanggilan transport (Suite 3: 13 checks PASS).
  4. Penegakan mode SHADOW (`apply-prototype-seed.mjs` & Pre-Ingestion Guard): seeder menolak klaim palsu jika mode bukan SHADOW; smoke test memvalidasi DB sebelum menyuntikkan payload uji dan menghentikan pengujian jika mode bukan `SHADOW` atau `emergency_stop` aktif (Suite 4: 4 checks PASS).
  5. Integritas smoke test & skema presisi (`smoke-test-deployment.mjs`): stub `pass: true` dihapus; kredensial staf dan DB URL wajib ada; kueri DB selaras 100% dengan skema aktual; zero mutation diverifikasi via hitungan riil DB; bounded polling memantau worker; dan login/inbox/logout staf nyata diverifikasi via `@supabase/ssr` (Suite 5: 9 checks PASS).
  6. Validasi redirect presisi & origin hardening (`isValidLoginRedirect`): status wajib 307/302, destination strictly `/login`, origin target selalu diverifikasi tanpa kondisi awalan teks (menolak HTTP 200 dengan Location, tujuan non-login, serta off-origin baik URL absolut, protocol-relative `//other.example/login`, maupun skema uppercase `HTTPS://other.example/login`).
  7. Penanganan kegagalan signOut: hasil `staffClient.auth.signOut()` divalidasi; jika mengembalikan error, pengujian `staffAuth` dan `allPassed` bernilai FAIL, meskipun cookie lokal telah terhapus dan request berikutnya tertolak.
- Pemulihan histori D143 secara persis dari commit baseline `2e1321b` dan pencatatan D145, D146, D147, D148, D149, D150, D151, serta D152 secara append-only di `docs/decision-log.md`.
- Penyelarasan petunjuk environment di `docs/DEPLOYMENT.md` dengan kontrak runner aktual (argumen CLI, process env, pembacaan `.env.local`, urutan prioritas, dan default).
- Dokumentasi panduan lengkap disusun di `docs/DEPLOYMENT.md`, review di `docs/P2_10_REVIEW.md`, catatan tindak lanjut di `docs/P2_10_FOLLOWUP.md`, dan decision log D144, D145, D146, D147, D148, D149, D150, D151, D152.
- **Penerapan Migrasi & Seed Supabase Remote Terverifikasi (D149)**: 13/13 migrasi resmi dari `supabase/migrations/` berhasil diterapkan secara atomik pada database Supabase Cloud (`saysxjdyalnbhxqqmytp`) via `PROTOTYPE_DATABASE_URL` (port 5432) dengan TLSv1.3 (`NODE_EXTRA_CA_CERTS=certs/prod-ca-2021.crt`), 0 pending; seed prototype diterapkan penuh (12 pelanggan dummy `DUMMY-CUST-001` s/d `012`, 12 layanan `DUMMY-SVC-001` s/d `012`, 1 ODC `ODC-DUMMY-01` [UUID `30000000-...`], 2 ODP `ODP-DUMMY-01` [UUID `40000000-...0001`] dan `ODP-DUMMY-02` [UUID `...0002`], pembagian topologi 10 ke ODP-01 dan 2 ke ODP-02, 5 identitas channel dummy [UUID `60000000-...0001` s/d `0005`], 16 skenario mock network dengan observasi stale dipertahankan, dan mapping tester Telegram `6727338166`); 22 tabel inti terverifikasi di schema `public`; singleton `automation_settings` diverifikasi dalam mode `SHADOW` (`emergency_stop: false`, `shadowGuaranteed: true`, exit code 0).
- **Pengerasan Guard Pra-Mutasi, Assertion Wajib & Verifikasi Read-Only Database Remote (D150)**:
  1. Guard pra-mutasi `scripts/apply-prototype-pipeline.mjs` diperketat: validasi target presisi (host `aws-0-ap-southeast-2.pooler.supabase.com`, port 5432, username eksak `postgres.saysxjdyalnbhxqqmytp` tanpa substring matching, database `postgres`, `sslmode=verify-full`, `NETWORK_PROVIDER=mock`). Pre-check guard membaca state aktual; jika mode existing non-SHADOW, emergency stop aktif, atau ledger tidak konsisten (tabel ada tanpa ledger atau versi asing ada di ledger), proses dihentikan fail-closed dengan 0 pemanggilan runner migrasi maupun seed.
  2. Assertion verifikasi struktural dan relasional wajib (`runDirectedVerification`): paritas penuh 13 migrasi di ledger, 22 tabel inti, fixture UUID spesifik (1 ODC, 2 ODP, 12 pelanggan, 12 layanan, 12 pemetaan topologi, 5 identitas), tester mapping Telegram `6727338166` (customer `10000000-0000-4000-8000-000000000001`, verified), fixture network (16 skenario, 180 baris ONU, 16 baris uplink dengan observasi skenario stale dipertahankan tanpa manipulasi timestamp), dan mode `SHADOW` (`emergency_stop: false`, `version: 1`).
  3. Runner verifikasi mandiri read-only `scripts/verify-prototype-schema.mjs`: mengeksekusi assertion dalam transaksi `BEGIN READ ONLY` dengan timeout 10 detik, TLSv1.3 penuh, dan 0 mutasi database.
- **Penguatan Isolasi Subprocess CLI & Verifikasi Keanggotaan Pasangan Fixture Jaringan (D151)**:
  1. Isolasi pengujian CLI: Pengujian subprocess `tests/tooling/pipeline-tooling.test.mjs` menggunakan konfigurasi dummy via `PROTOTYPE_ENV_FILE` dan client/transport seam pengujian lokal (`tests/tooling/test-client-seam.mjs` via `PROTOTYPE_TEST_CLIENT_MODULE`). Tidak membaca `.env.local` pengguna, tidak mewarisi kredensial remote, dan tidak bergantung pada kegagalan soket/jaringan eksternal untuk meluluskan tes penolakan guard.
  2. Nol pemanggilan runner migrasi & seed dibuktikan secara empiris pada 5 jalur penolakan guard: target invalid, mode non-SHADOW, emergency stop aktif, tabel aplikasi tanpa ledger, dan versi migrasi asing.
  3. Assertion pasangan fixture jaringan: Memverifikasi keanggotaan eksak 180 pasangan ONU (`scenario_id` + `service_id` untuk 15 skenario observasi dan 12 dummy service, tanpa observasi pada `missing_status`) dan 16 pasangan Upstream (`scenario_id` + `link_id` untuk 16 skenario dan `MOCK-UPLINK-01`). Pemeriksaan dibatasi strictly pada ruang fixture (data tambahan di luar ruang fixture tidak menggagalkan verifikasi).
- **Penutupan Jalur Campuran Mock Client dengan Runner Mutasi Nyata & Verifikasi Remote Aktual (D152)**:
  1. Penolakan mutlak `PROTOTYPE_TEST_CLIENT_MODULE` pada CLI mutating pipeline (`scripts/apply-prototype-pipeline.mjs`): keluar nonzero (exit 1) sebelum koneksi dibuka atau runner dipanggil, mencegah mock state mengizinkan mutasi remote nyata.
  2. Penegakan dependency injection lengkap pada fungsi `runPrototypePipeline`: jika `clientFactory` diinjeksi, `migrationRunner` dan `seedRunner` wajib diinjeksi lengkap tanpa fallback ke default nyata.
  3. Verifier read-only (`scripts/verify-prototype-schema.mjs`) mempertahankan seam lokal untuk pengujian CLI tanpa risiko efek samping mutasi.
  4. Pengujian tooling lokal terisolasi `tests/tooling/pipeline-tooling.test.mjs`: **53 checks PASS** (terdiri dari 4 parent test suites dan 49 subtests: Suite 1 [8 subtests], Suite 2 [15 subtests], Suite 3 [19 subtests], Suite 4 [7 subtests]), 0 fail, exit code 0, durasi ~614ms.
  5. Verifikasi read-only aktual terhadap database remote Supabase Cloud (`saysxjdyalnbhxqqmytp`) dieksekusi via `scripts/verify-prototype-schema.mjs` (task-554): kueri dijalankan dalam transaksi `BEGIN READ ONLY` via Session pooler port 5432 dengan `NODE_EXTRA_CA_CERTS=certs/prod-ca-2021.crt`. Seluruh assertion lulus penuh: 13/13 migrasi applied, 22 tabel inti, seluruh fixture pelanggan/layanan/topologi/identitas lengkap, tester Telegram verified, fixture network 180 pasang ONU dan 16 pasang Upstream lengkap dengan stale preserved, mode SHADOW valid, exit code 0, dan 0 mutasi database (log asli tertelusuri langsung dari `task-554.log`).
- **Resolusi Error 500 Inbox, Pengalihan Halaman Awal & Diagnostik Server (D153)**:
  1. Root cause error 500 Inbox di Vercel terbukti secara empiris: `pg-connection-string` menimpa opsi SSL menjadi kosong `{}` saat mengurai connection string `sslmode=verify-full`, menyebabkan kegagalan handshake TLS `SELF_SIGNED_CERT_IN_CHAIN` karena CA Supabase tidak ada di trust store bawaan Node.js.
  2. Perbaikan `lib/postgres/server.ts`: menambahkan `resolveDatabaseCaCertificate` dengan triple redundancy (env `HELPDESK_DB_CA`/`SUPABASE_DB_CA`, berkas `certs/prod-ca-2021.crt`, dan konstanta `SUPABASE_ROOT_CA_2021`). Inisialisasi pool remote mengoperasikan parameter terpisah dan `ssl: { ca, rejectUnauthorized: true, servername: url.hostname }` tanpa menggunakan connectionString mentah yang menimpa konfigurasi SSL. Validasi `sslmode=verify-full` tetap ditegakkan.
  3. Konfigurasi `next.config.ts`: menyertakan `outputFileTracingIncludes` untuk `./certs/**/*` agar aset CA disertakan dalam bundle Serverless Functions Vercel.
  4. Pengalihan sesi pada `/` (`app/page.tsx`): halaman statis "Hello world!" diganti Server Component dinamis yang memverifikasi sesi server-side via Supabase client; sesi valid dialihkan ke `/dashboard` (307) dan tanpa sesi dialihkan ke `/login` (307) tanpa redirect loop.
  5. Diagnostik aman di route handler (`app/api/inbox/conversations/route.ts` dan `[id]/route.ts`): mencatat nama error, kode, dan pesan yang disanitasi tanpa password/token/cookie/connection string mentah.
  6. Seluruh 307 unit test lulus (`npm test`), linter 0 error/warning, `npm run build` sukses (exit code 0, `BUILD_ID: JTdS8Jb2coBKY5Q1yv8GA`).
- **Pengerasan Keamanan Log Error, Pengujian Fallback CA X.509 & Penyelarasan Bukti Smoke Test Pengguna (D154)**:
  1. Keamanan log error: Memperbaiki diagnostik server pada `app/api/inbox/conversations/route.ts` dan `[id]/route.ts`. Pesan error mentah (`err.message`), stack trace, connection string, password, token, cookie, dan isi pesan pelanggan dijamin 100% tidak diteruskan ke log maupun respons HTTP. Menggunakan helper terpusat `classifyRouteError` yang hanya mencatat konteks route, kategori (`DatabaseError`, `TlsError`, `NetworkError`, `ConfigurationError`, `UnknownError`), dan kode terallowlist/tervalidasi. Respons kegagalan tetap mengembalikan HTTP 500 dengan envelope standar `{ success: false, data: null, error: { code: "INTERNAL_ERROR", message: "..." } }`.
  2. Pengujian fallback CA X.509: Memperluas `resolveDatabaseCaCertificate` dengan opsi injeksi `{ env?, certPath? }` untuk mengaktifkan jalur fallback (Step 3) secara deterministik tanpa menghapus/mengubah berkas fisik atau memerlukan koneksi jaringan. Memvalidasi sertifikat fallback menggunakan `crypto.X509Certificate` dan mencocokkan secara kriptografis subject, issuer, serialNumber, validTo, dan `fingerprint256` persis dengan sertifikat acuan `certs/prod-ca-2021.crt`.
  3. Validasi lokal terbaru: 310/310 unit tests PASS (`npm test`, exit code 0), 49/49 assertions PASS pada `inbox-service.test.ts`, 0 ESLint errors/warnings, `npm run build` sukses (exit code 0, `BUILD_ID: yBmXh45QZ1qw8jB7Ss89p`, 26 berkas manifest VALID).
  4. Bukti smoke test deployment bersumber dari eksekusi pengguna (`https://chat-dahsboard-helpdesk.vercel.app`):
     - Seluruh 7 pemeriksaan wajib PASS (`allPassed: true`, `PROCESS_EXIT_CODE=0`).
     - Tanpa autentikasi: `/dashboard` mengembalikan 307 menuju `/login`; `/api/inbox/conversations` mengembalikan 401.
     - Dengan sesi staf: dashboard dan API Inbox mengembalikan 200.
     - Logout berhasil; dashboard kembali mengarah ke login (307) dan API kembali 401.
     - Request webhook tanpa secret atau dengan secret salah ditolak 401; jumlah baris ingress tetap 1 sebelum dan sesudah pemeriksaan tersebut.
     - Pesan simulasi diterima dan diproses sampai job berstatus done; pesan, percakapan, dan assessment terbentuk. Ingress ID: `0877a630-93c3-4756-804f-674b21d08e78`.
     - Mode SHADOW terjaga; outbound intents dan reply claims untuk pesan simulasi masing-masing 0.
  5. Konfirmasi pesan Telegram nyata bersumber dari pengguna:
     - Bot ID `8892832714`, username `@upaznet_helpdesk_proto_bot`, webhook URL `https://chat-dahsboard-helpdesk.vercel.app/api/webhooks/telegram`, pending updates: 0, allowed updates: `message`, `edited_message`, custom cert: false.
     - Pesan Telegram nyata dari tester terkonfirmasi diterima dan masuk ke Inbox dashboard. Sesuai instruksi, evaluasi assessment pesan simulasi tidak dianggap sebagai bukti evaluasi pesan Telegram nyata.
- **Penyelarasan Rujukan BUILD_ID & Pembatasan Ringkasan Smoke Test (D155)**:
  1. Penyelarasan BUILD_ID acuan aktif ke `yBmXh45QZ1qw8jB7Ss89p` sesuai artefak `.next/BUILD_ID` dan `docs/evidence/P2_7/build-source-manifest.json` yang sinkron dengan 26 berkas workspace.
  2. Pembatasan ringkasan smoke test deployment pengguna strictly pada fakta runner empiris, tanpa ekstrapolasi berlebihan terhadap integritas tabel database lain.

**Catatan/Blocker**

P2.10 telah selesai penuh (✅ **Done**).
- **Penutupan Resmi Berdasarkan Konfirmasi Pengguna**: Pengguna telah mengonfirmasi bahwa deployment terbaru Vercel P2.10 berfungsi normal: status deployment Vercel Ready, pengalihan sesi pada halaman awal `/` berfungsi normal sesuai sesi staf, serta antrean Inbox dan detail percakapan terbuka normal tanpa error 500. Sesuai AGENTS.md, status Done dicatat secara jujur bersumber dari konfirmasi pengguna tersebut tanpa fabrikasi commit SHA atau deployment ID. Rujukan status HTTP 200 dan 307 bersumber dari automated smoke test `scripts/smoke-test-deployment.mjs` (D156, D157).

</details>

<a id="task-p2-11"></a>

<details>
<summary>P2.11 — Verifikasi vertical slice SHADOW end-to-end</summary>

**Acceptance Criteria**

1. Komplain dummy dari tester Telegram muncul di Inbox dengan episode dan assessment yang sesuai.
2. Replay event inbound yang sama tidak menggandakan ingress, pesan, episode, maupun assessment terkait (identitas dedup: `account_id` + `chat_id` + `message_id`).
3. Pengirim yang belum terpetakan ke pelanggan tetap terlihat di Inbox tanpa memperoleh detail layanan.
4. Pesan non-komplain tetap terlihat dan ditangani sesuai aturan PRD (kategori `other`, tanpa episode komplain baru atau tiket palsu).
5. Tidak ada outbound otomatis atau claim debounce yang terbentuk akibat skenario SHADOW (diverifikasi langsung di level state persistence).

**Bukti/Verifikasi**

`tests/integration/vertical-slice-shadow.test.ts`, `docs/P2_11_REVIEW.md`, `package.json` (`test:shadow:local`), dan decision log D156, D157, D158:
- **Suite Integrasi Terarah Vertical Slice SHADOW (`test:shadow:local`)**: 6 passed / 6 checks PASS (exit code 0, durasi ~690ms):
  - *AC1*: Update komplain tester verified (`"Lapor min koneksi wifi mati total lampu indikator LOS merah kedip terus..."`) diterima webhook (HTTP 200 accepted), diproses worker drain hingga done, dan tampil di Inbox dashboard (`listInboxConversations` dan `getInboxConversationDetail`) dengan episode `NEW`, kategori `connection_complaint`, `serviceId` terikat, serta assessment `ONLINE_CHECK` dengan `dispatchAuthorized = false`, `claim.outcome = 'skipped'`, `claim.reason = 'shadow_mode'`.
  - *AC2*: Replay payload Telegram yang identik secara tuple `(account_id, chat_id, message_id)` mengembalikan HTTP 200 `{ status: "accepted", duplicate: true }`, worker drain memproses 0 job, dan perbandingan hitungan database sebelum vs sesudah replay membuktikan delta 0 baris (0 penambahan pada `ingress_events`, `processing_jobs`, `messages`, `complaints`, maupun `triage_assessments`).
  - *AC3*: Pengirim allowlist tanpa relasi pelanggan (`verification_status = 'unverified'`, `customer_id = null`) tampil di Inbox staf dengan `customerId = null`, `customerName = null`, `serviceId = null`, dan assessment candidate `GENERIC` dengan reason `identity_unresolved` tanpa kebocoran topologi atau data layanan.
  - *AC4*: Pesan salam/ucapan dari tester tersimpan di riwayat percakapan dengan klasifikasi `category = 'other'`, `complaintId = null` (tidak membuat tiket/episode komplain palsu), serta assertion wajib triage assessment memvalidasi `outcome = 'review'`, `reason = 'non_connection_message'`, dan `dispatchAuthorized = false`.
  - *AC5*: Kueri langsung ke database membuktikan `count(*) FROM outbound_intents WHERE origin = 'automatic' = 0` (mencakup 3 pesan fixture dan owners), `count(*) FROM reply_claims = 0` (mencakup complaints dan owners), serta tepat 3 row assessment terverifikasi memiliki `dispatchAuthorized = false` dan `claim.outcome = 'skipped'`.
- **Teardown & Zero Residue**: ID staf aktual dari `createUser` digunakan dan diverifikasi terhapus dari `auth.users` via `getUserById`. Kueri residu SQL memverifikasi 0 baris residual pada seluruh 15 tabel yang tersentuh fixture.
- **Regresi Unit Suite & Linter**: `npm test` meluluskan seluruh 310 checks (0 fail, exit code 0); `npx eslint tests/integration/vertical-slice-shadow.test.ts` 0 error/warning.
- **Konfirmasi Live Pengguna pada Deployment Vercel**: Pengguna telah memverifikasi secara langsung pada deployment live Vercel (`https://chat-dahsboard-helpdesk.vercel.app/dashboard`) menggunakan bot Telegram `@upaznet_helpdesk_proto_bot`:
  1. Pesan komplain dari akun Telegram tester nyata diterima oleh webhook live dan tampil di antrean Inbox dashboard.
  2. Detail percakapan terbuka normal tanpa error HTTP 500, menampilkan episode berstatus `NEW` serta Triage Assessment dalam mode `SHADOW` (`dispatchAuthorized = false`).
  3. Tidak ada balasan otomatis yang dikirim kembali ke Telegram tester.

**Catatan/Blocker**

P2.11 berstatus ✅ **Done** (D156, D157, D158).
- **Penutupan Kekurangan Bukti**: Konfirmasi live fungsional oleh pengguna di atas resmi menutup kekurangan bukti interaksi langsung Telegram nyata ke dashboard Vercel live. Seluruh 5 Acceptance Criteria (AC1–AC5) telah terverifikasi secara empiris melalui kombinasi integrasi lokal, smoke test remote, dan pengujian live pengguna.
- **Phase 2 Selesai Penuh**: Seluruh 11 tugas pada Phase 2 (`P2.1`–`P2.11`) telah berstatus ✅ **Done** (**Phase 2 Completed**).
- **Langkah Berikutnya**: Pipeline beralih ke Phase 3 (Balas & Penanganan), dimulai dari [P3.1 — Renderer template tetap dan snapshot teks](#task-p3-1).

</details>

[Kembali ke navigasi](#navigasi)

---

<a id="p3"></a>

## P3 — Balas & Penanganan

| Task ID            | Nama Task                                               | Status         | Dependency                          | Decision ID Terkait |
| ------------------ | ------------------------------------------------------- | -------------- | ----------------------------------- | ------------------- |
| [P3.1](#task-p3-1) | Renderer template tetap dan snapshot teks               | ✅ Done        | P1.2, P1.4.1                        | D65, D66, D69, D159 |
| [P3.2](#task-p3-2) | Pemeriksaan terakhir sebelum dispatch                   | ✅ Done        | P1.4.3, P2.1, P2.5, P3.1            | D66, D67, D68, D77, D160 |
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

`lib/domain/template-contracts.ts`, `lib/domain/template-renderer.ts`, `tests/domain/template-renderer.test.ts`, `supabase/migrations/20261019120000_create_response_templates.sql`, `supabase/seed.sql`, `lib/application/helpdesk-persistence.ts`, `lib/repositories/episode-store.ts`, `tests/integration/template-renderer.test.ts`, `docs/P3_1_REVIEW.md`, decision log D159:
- **Domain Murni Renderer (`lib/domain/template-renderer.ts`)**:
  - Validasi sintaks kurung kurawal ketat (`validateTemplateBody`), menolak kurung kurawal tunggal/menggantung/tidak seimbang (`malformed_placeholder_syntax`) dan placeholder di luar whitelist (`disallowed_placeholder`). Whitelist strictly `["estimated_recovery"]` untuk `MASS_GENERAL` & `MASS_AREA`, dan `[]` untuk 5 template lainnya.
  - Resolusi template aktif (`resolveActiveTemplate`): validasi kunci template di awal (`invalid_template_key`); override incident-scoped mengalahkan default untuk key sama; fallback ke default jika tidak ada override incident; fail-closed `conflicting_active_templates` jika >1 versi aktif pada scope yang sama; fail-closed `missing_active_template` jika 0 aktif.
  - Substitusi literal `{{estimated_recovery}}`: fallback otomatis `"masih dalam pemeriksaan"` jika null/kosong/whitespace; dukungan multi-kemunculan via `replaceAll`; pencegahan titik ganda `..`; pencegahan re-evaluasi template injection; penambahan wajib prefix `[SIMULASI DATA DUMMY] `.
  - Normalisasi balasan manual staf (`renderStaffReplySnapshot`): idempoten melepas pengulangan prefix `[SIMULASI DATA DUMMY]` (2x atau lebih), menolak pesan kosong atau pesan yang hanya berisi prefix simulasi (`empty_message_body`), batas panjang <= 10000.
  - Unit test `tests/domain/template-renderer.test.ts` (**9/9 checks PASS**, total unit suite **319/319 checks PASS**, exit code 0).
- **Migrasi Schema & Constraint Database (`20261019120000_create_response_templates.sql`)**:
  - Kolom `description` dan `estimated_recovery` ditambahkan ke `public.incidents`.
  - Tabel `public.response_templates` dengan constraint relasi scope `'default'` (`incident_id is null`) dan `'incident'` (`incident_id is not null`).
  - Tabel `public.template_versions` dengan partial unique index `template_versions_one_active` on `(template_id) where is_active = true`.
  - Kolom snapshot pada `public.outbound_intents`: `template_version_id`, `template_key`, `template_version`, `template_scope`, `template_error`, serta relaksasi check constraint agar `origin = 'automatic'` dapat menyimpan snapshot teks `body`.
  - Tooling pipeline test `tests/tooling/pipeline-tooling.test.mjs` (**53/53 checks PASS**, exit code 0).
- **Integrasi Persistence & Fail-Closed Dispatch**:
  - Pada `HelpdeskPersistence.process()`: membaca `estimated_recovery` dari active incident; memuat kandidat template aktif; merender template; pada `template_error` memblokir dispatch (`claim.outcome = 'skipped'`, `claim.reason = 'template_error'`, `dispatchAuthorized = false`, 0 outbound intent/claim terbentuk) dan mencatat audit log; pada `rendered` menyimpan snapshot `body`, `template_version_id`, `template_key`, `template_version`, dan `template_scope` di `outbound_intents`.
  - Menghindari properti ber-value `undefined` pada `ProcessingResult` agar selalu identik secara struktural dengan hasil deserialisasi JSONB database.
  - Pada `HelpdeskPersistence.staffAction()`: memformat manual reply dengan `renderStaffReplySnapshot` (menolak prefix-only), menyimpan teks ber-prefix di `outbound_intents.body`.
- **Suite Integrasi Database Terisolasi (`tests/integration/template-renderer.test.ts`)**:
  - Dieksekusi via `npm run test:template:local` pada PostgreSQL lokal terisolasi: **8/8 checks PASS (0 fail, 0 skipped, exit code 0, durasi ~1160ms)**:
    1. Schema & Constraints: 7 default templates exist, versi 1 aktif, partial unique index menolak 2 versi aktif, constraint scope incident.
    2. Inbound Processing LOS_AND_GENERIC: snapshot text ber-prefix, metadata versi, `dispatchAuthorized = false`.
    3. Immutability Verification: modifikasi template version tidak mengubah snapshot intent historis (FR-07, FR-13).
    4. Incident Override: template scope incident mengalahkan default dan menyubstitusi `estimated_recovery`.
    5. Fallback estimasi: `estimated_recovery` null memakai fallback PRD tanpa titik ganda `..`.
    6. Template Error Fail-Closed: template cacat memblokir dispatch, 0 intent/claim dibuat, audit log tercatat.
    7. Staff Manual Reply: normalisasi prefix simulasi, idempoten tanpa double prefix, penolakan pesan kosong/prefix-only.
  - Teardown & Zero Residue: membersihkan child records (`reply_claims`, `complaint_evidence_links`, `outbound_intents`) sebelum menghapus `response_templates` dan `incidents`; membersihkan `reply_owners` sebelum `cleanupFixture`; menghapus staf dari `auth.users` dengan verifikasi `getUserById`; kueri 10 tabel memverifikasi 0 residual fixtures.
- **Regresi Baseline Integration Suite**:
  - `npm run test:persistence:local`: **12/12 checks PASS** (0 fail, 0 skipped, exit code 0).
  - `npm run test:shadow:local`: **6/6 checks PASS** (0 fail, 0 skipped, exit code 0).
- **Linter & Typecheck**:
  - `npx eslint ...`: 0 errors, 0 warnings.
  - `npx tsc --noEmit`: 0 errors.
- `dispatchAuthorized` strictly dipertahankan `false` di seluruh alur.

**Catatan/Blocker**

P3.1 selesai penuh (**✅ Done**). Pre-dispatch final checks (P3.2), dispatch HTTP ke Telegram (P3.3), worker outbound (P3.4), dan UI pengelolaan template (P4.3) berada di luar scope dan tidak diimplementasikan pada task ini.

</details>

<a id="task-p3-2"></a>

<details>
<summary>P3.2 — Pemeriksaan terakhir sebelum dispatch</summary>

**Acceptance Criteria**

Sebelum send, periksa handoff tersimpan, tester/private chat, follow-up/takeover, claim, template, mode penerimaan/terbaru, emergency stop, serta incident yang relevan; perubahan mode tidak memutar backlog SHADOW.

**Bukti/Verifikasi**

`lib/domain/dispatch-contracts.ts`, `lib/domain/dispatch-gate.ts`, `tests/domain/dispatch-gate.test.ts`, `lib/application/helpdesk-persistence.ts`, `tests/integration/dispatch-gate.test.ts`, `package.json` (`test:dispatch:local`), `docs/P3_2_REVIEW.md`, decision log D66, D67, D68, D77, D160:
- **Domain Murni Gerbang Pra-Dispatch (`lib/domain/dispatch-contracts.ts` & `lib/domain/dispatch-gate.ts`)**:
  - `evaluatePreDispatchGate`: Menegakkan 9 guard secara deterministik tanpa I/O:
    1. Status & Struktur Dasar: Intent non-pending langsung gagal tertutup tanpa cancel (`intent_not_pending`, `shouldCancelIntent: false`); validasi kelengkapan field origin (`invalid_intent`).
    2. Handoff Tersimpan: Episode wajib ada dan sesuai `complaintId`, `conversationId` non-kosong; untuk automatic wajib `messagePersisted`, `assessmentPersisted`, dan `ingress !== null` (`handoff_not_persisted`).
    3. Tester Allowlist & Private Chat: Channel telegram (`unsupported_channel`), ID safe integer positif, obrolan private 1-on-1 (`chatId === senderExternalId`, menolak grup/supergroup via `non_private_chat`), dan terdaftar di allowlist (`not_in_tester_allowlist`, `empty_tester_allowlist`).
    4. Follow-up & Staff Takeover: Status `CLOSED` memblokir automatic dan staff (`episode_closed`); automatic diblokir jika episode suppressed atau ada balasan staf (`staff_takeover`), atau bukan pesan pertama / status bukan `NEW` (`follow_up`); balasan staf tetap diizinkan pada `IN_PROGRESS` dan `RESOLVED`.
    5. Claim & Rekonsiliasi Owner: Validasi owner, rekonsiliasi merged owner (`claim_owner_merged_or_invalid`), deteksi claim conflict oleh intent lain (`claim_conflict`), dan ketiadaan claim wajib (`missing_reply_claim`).
    6. Template & Body: Validasi snapshot body ber-prefix simulasi, tanpa pengulangan prefix, panjang <= 4096 (`missing_template_snapshot`, `missing_simulation_prefix`, `invalid_outbound_body`, `template_error` untuk placeholder kurung kurawal unreplaced).
    7. Mode & No SHADOW Replay (AC-06): Diterima saat SHADOW ditolak (`shadow_mode_at_receipt`, tidak memutar ulang backlog), mode aktual SHADOW ditolak (`shadow_mode_current`), template `ONLINE_CHECK` pada mode efektif `LOS_AND_GENERIC` ditolak (`template_blocked_by_mode`). Balasan staf tidak terblokir oleh mode.
    8. Emergency Stop: Memblokir intent otomatis jika aktif saat receipt (`emergency_stop_at_receipt`) atau saat evaluasi (`emergency_stop_active`). Balasan staf tetap lolos (PRD §8).
    9. Incident Relevan: Verifikasi insiden ada (`incident_not_found`), aktif (`incident_no_longer_active`), tipe cocok (`incident_type_mismatch`), dan area ODP/ODC pelanggan masih tercakup pada insiden area (`incident_area_no_longer_matches`).
  - Unit test `tests/domain/dispatch-gate.test.ts`: **13/13 subtests PASS** (total unit suite **332/332 checks PASS**, 0 fail, exit code 0).
- **Integrasi Persistence Transaksional (`lib/application/helpdesk-persistence.ts`)**:
  - `evaluateDispatchGate(intentId, options)`: Mengambil intent dengan lock `FOR UPDATE` di dalam `inHelpdeskTransaction`.
  - Mengumpulkan seluruh dependensi aktual (episode, conversation, message, assessment, ingress, channel identity, claims, settings, dan incident) secara atomik.
  - Jika `outcome === "blocked"` dan `shouldCancelIntent`: memperbarui status intent menjadi `'cancelled'` dan mencatat audit log `dispatch_blocked` dengan alasan rinci.
  - Jika `outcome === "authorized"`: status intent tetap `'pending'` (siap diambil worker P3.4) dan mencatat audit log `dispatch_authorized` secara idempoten (tanpa duplikasi log pada evaluasi berulang).
  - `decideTriage`, `planReplyClaim`, dan `HelpdeskPersistence.process()` strictly tetap mengembalikan `dispatchAuthorized: false`.
- **Suite Integrasi Database Terisolasi (`tests/integration/dispatch-gate.test.ts`)**:
  - Dieksekusi via `npm run test:dispatch:local` pada PostgreSQL lokal terisolasi: **6/6 checks PASS (0 fail, 0 skipped, exit code 0, durasi ~1212ms)**:
    1. Happy Path Automatic & Staff Authorization in LOS_AND_GENERIC: intent otomatis dan manual staf berhasil diotorisasi (`outcome: "authorized"`, `dispatchAuthorized: true`), audit log `dispatch_authorized` tercatat idempoten.
    2. Staff Takeover Sebelum Send Membatalkan Automatic Intent: start handling oleh staf membatalkan intent otomatis menjadi `'cancelled'`; evaluasi gate menolak intent yang sudah dibatalkan (`intent_not_pending`) maupun intent pending pada episode tersupresi (`staff_takeover`).
    3. Mode Changes & Emergency Stop + Non-Replay Backlog SHADOW (AC-06): pesan SHADOW menghasilkan 0 intent; peralihan ke FULL tidak memutar ulang backlog SHADOW (tetap 0 intent); penurunan mode ke LOS_AND_GENERIC membatalkan intent `ONLINE_CHECK` (`template_blocked_by_mode`); emergency stop membatalkan intent otomatis tetapi balasan staf tetap authorized.
    4. Incident Resolved atau Area Berubah Sebelum Send (PRD §6.2): insiden GENERAL aktif mencatat versi insiden terotorisasi; insiden di-resolve sebelum send membatalkan intent (`incident_no_longer_active`); ODP pelanggan dihapus dari insiden AREA_SPECIFIC sebelum send membatalkan intent (`incident_area_no_longer_matches`).
    5. Tester Allowlist & Private Chat Enforcement: pencabutan tester dari allowlist membatalkan intent (`not_in_tester_allowlist`); allowlist kosong memblokir balasan otomatis dan staf (`empty_tester_allowlist`).
  - Teardown & Zero Residue: membersihkan seluruh tabel fixture (`reply_claims`, `complaint_evidence_links`, `outbound_intents`, `response_templates`, `incidents`, `reply_owners`, `customers`, `services`, `channel_identities`) sebelum `cleanupFixture`; menghapus staf dari `auth.users`; kueri 10 tabel memvalidasi 0 residual fixtures.
- **Regresi Baseline & Tooling Pipeline**:
  - `npm test`: **332/332 checks PASS** (0 fail, exit code 0).
  - `node tests/tooling/pipeline-tooling.test.mjs`: **53/53 checks PASS** (exit code 0).
  - `npm run test:template:local`: **8/8 checks PASS** (exit code 0).
  - `npm run test:persistence:local`: **12/12 checks PASS** (exit code 0).
  - `npm run test:shadow:local`: **6/6 checks PASS** (exit code 0).
  - `npx eslint ...`: 0 errors, 0 warnings.
  - `npx tsc --noEmit`: 0 errors.

**Catatan/Blocker**

P3.2 selesai penuh (**✅ Done**). Gerbang pra-dispatch telah terpasang penuh dan terverifikasi aman. Pipeline siap melanjutkan ke pengiriman Telegram via ChannelAdapter ([P3.3](TRACKER.md#task-p3-3)) dan worker outbound delivery loop ([P3.4](TRACKER.md#task-p3-4)).

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
