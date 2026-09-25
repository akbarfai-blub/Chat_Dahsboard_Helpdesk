# P0.5 Review — Logout dan penanganan kegagalan logout (verifikasi ulang)

**Tanggal verifikasi:** 25 September 2026 (penutupan temuan alat uji & verifikasi ulang)
**Task:** P0.5 (dependency: P0.4 ✅) · **Acuan keputusan:** D50, PRD v2.1 (logout mengakhiri sesi, kegagalan logout terlihat)
**Ruang lingkup:** verifikasi tombol Keluar, pengakhiran sesi, akses ulang setelah sesi berakhir, dan jalur error saat logout gagal. Signup, reset password, OAuth, MFA, role, dan token UI di luar lingkup.
**Status dokumen:** ditulis ulang setelah tinjauan menolak rekomendasi *Done* sebelumnya karena bukti asersi tidak memenuhi seluruh acceptance criteria. Perbaikan kode dari tinjauan lama **dipertahankan**; yang diubah adalah metode pembuktian, asersi harness, dan pelaporan hasil.

## 1. Lingkungan (tanpa secret)

- WSL2 (Ubuntu, node v24.14.1) sebagai shell; binari + harness uji dieksekusi di **host Windows** (node v24.13.1, `C:\Program Files\nodejs\node.exe`); Docker Desktop dengan stack Supabase lokal proyek ini.
- Supabase lokal: Auth/GoTrue v2.196.0 di `http://127.0.0.1:54321` (URL dari `.env.local`; key tidak dicatat di dokumen ini).
- Aplikasi: Next.js dev server dijalankan di **Windows** (binari native SWC/Turbopack di `node_modules` terpasang untuk Windows), port `3000` untuk alur normal dan port `3001` untuk alur kegagalan.
- Peramban: Playwright 1.63 dengan Chrome sistem Windows (headless, `locale: id-ID`); node_modules Playwright di `C:\Users\INVANSION\AppData\Local\Temp\p04-pw` (di luar repo; dipakai juga oleh P0.4). Playwright MCP bawaan tidak dapat dipakai — diakali dengan harness Playwright lokal, bukan dependency repo baru.
- Simulasi kegagalan logout **mencapai jalur logout yang nyata**: instance dev port `3001` di-start dengan `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54389` (proxy setempat `p05-fail-proxy.mjs` → `54321`). Mode `pass` meneruskan semua request; mode `fail` hanya membalas `POST /auth/v1/logout` dengan HTTP 500 `Internal Server Error (simulated)`. Supabase lokal yang dipakai layanan lain **tidak pernah dimatikan**; hanya proksi lokal per-uji yang digagalkan.
- Akun uji temporary `p05-logout-review-mud3mcid@example.test` (id `697b79ad-e2e0-45a9-891b-69d9ec8dad77`) dibuat via admin API GoTrue (`supabase status -o json`), **dihapus setelah uji** dan diverifikasi `GET_BY_EMAIL: NOT_FOUND`. Kredensial disimpan hanya di luar repo (`/tmp/opencode/p05-creds.json`); tidak ada password/token tertulis di artefak repo. Tidak ada akun staf yang diubah/di-reset; database tidak di-reset.
- Catatan operasional: Next.js dev bersifat single-instance — lock `.next\dev` mencegah port `3000` dan `3001` berjalan bersamaan, sehingga uji normal dan uji gagal dijalankan **bergantian** (stop salah satu sebelum start yang lain). Network namespace WSL2 tidak menjangkau `127.0.0.1:3000` milik Windows (WSL `curl` → `000`); karena itu harness dijalankan dari sisi Windows via runner `p05-run-win.mjs` (di `/tmp/opencode`, di luar repo). Semua dev server dan proxy dihentikan setelah uji; port `3000`, `3001`, `54389` tidak lagi mendengarkan.

## 2. Perubahan kode

Perubahan kode aplikasi berikut berasal dari iterasi tinjauan sebelumnya dan **dipertahankan** (diverifikasi ulang pada iterasi ini; tidak ada perubahan kode aplikasi baru):

| File | Perubahan | Alasan |
| --- | --- | --- |
| `app/login/actions.ts` | `logout()`: pada `error` dari `signOut()`, periksa status sesi aktual via `supabase.auth.getUser()`; sesi masih valid → `redirect("/dashboard?error=logout")`; sesi sudah hilang → `redirect("/login?error=logout")`. Komentar penjelas 2 baris ditambahkan (mengapa cabang ini ada). | auth-js `_signOut` **meng-evict sesi lokal sebelum mengembalikan error** untuk error non-401/403/404 (mis. HTTP 500), sehingga jalur lama `/dashboard?error=logout` ter-bounce ke `/login` oleh `proxy.ts` sebelum alert sempat dirender — pesan kegagalan logout **tidak pernah tampil** (AC6b FAIL pada baseline). Cabang berdasarkan status sesi aktual memastikan pesan muncul di tempat yang tepat untuk kedua kemungkinan akhir sesi. |
| `app/login/page.tsx` | Tambah pemetaan `params.error === "logout"` → "Logout belum berhasil. Periksa koneksi lalu coba kembali." | Agar `/login?error=logout` (kasus sesi sudah di-evict oleh error) menampilkan pesan kegagalan logout. Dashboard sudah menampilkan `error=logout` untuk kasus sesi masih valid. |

Artefak bukti (harness + hasil) ditambahkan di `docs/evidence/P0_5/` — daftar lengkap di §7. Tidak ada endpoint, flag, atau bypass autentikasi khusus pengujian yang ditambahkan ke aplikasi; mock hanya berada di sisi harness (module loader uji mandiri, lihat §4.3), bukan di kode aplikasi. Tidak ada perombakan arsitektur, dependency baru, perubahan schema, atau commit/push. Bagian P0.5 pada `docs/TRACKER.md` diselaraskan dengan hasil verifikasi aktual. Perubahan `git status` lain di repo adalah modifikasi pengguna yang sudah ada sebelumnya dan dipertahankan.

Perilaku yang sudah benar sebelum perbaikan (tidak diubah): tombol "Keluar" di dashboard, logout sukses → `/login` dengan cookie sesi hilang, proteksi halaman via `proxy.ts` + `getUser` (dashboard/customers langsung, reload, back, tab kedua), login ulang setelah logout, dan tanpa leak secret di HTML/console.

## 3. Langkah reproduksi

1. `npx supabase start` (Docker) dan `npm run dev` (Windows) port 3000; siapkan `.env.local` sesuai README.
2. Buat akun uji temporary via `docs/evidence/P0_5/p05-account.mjs` (admin API GoTrue; membaca `supabase status -o json`); kredensial disimpan di file terpisah di luar repo.
3. **Alur normal** — jalankan `p05-logout-tests.mjs` terhadap `http://localhost:3000` dari Windows node (runner `p05-run-win.mjs` menyalin harness + menyuntik env via PowerShell): login → tombol Keluar (klik mouse; Tab+Enter; Tab+Space) → assert `/login`, cookie auth hilang, form kosong tanpa identitas staf → akses `/dashboard`, `/dashboard/customers` (tanpa data pelanggan), reload halaman terlindungi → injeksi ulang cookie pra-logout → **Back** setelah logout → reload tab kedua + navigasi tab kedua ke `/dashboard` → Keluar dua kali beruntun → Keluar setelah sesi berakhir → tanpa alert saat logout sukses → login kembali → regresi P0.4 (password spasi) → grep HTML/console untuk secret. Hasil: `results-main.json`.
4. **Alur kegagalan** — jalankan instance dev port 3001 dengan `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54389` (proxy `p05-fail-proxy.mjs`); proxy mode `pass` → login (bukti env proxy benar-benar dipakai); proxy mode `fail` (HANYA `POST /auth/v1/logout` → 500) → klik Keluar → assert pesan generik tampil, tanpa raw error/token, tanpa redirect sukses menyesatkan → jalur sesi-valid (`/dashboard?error=logout`) → retry setelah pulih → proxy mode `pass` → login ulang + logout sukses tanpa alert error. Hasil: `results-failure.json`. (Opsional verifikasi tambahan reformatting `logout()` dengan `prettier` di luar repo — tidak menyentuh kode aplikasi.)
5. **Seleksi cabang `logout()` (mock terisolasi)** — jalankan `p05-ac6d-branch-logic.mjs` (node biasa, WSL maupun Windows): module loader memock **hanya** `@/lib/supabase/server`; `app/login/actions.ts` yang asli dan `next/navigation.redirect()` yang asli dimuat untuk nyata. Hasil: `results-ac6d.json`. Ini **bukan** verifikasi browser/Supabase E2E — lihat batas bukti §4.3.
6. Pemeriksaan statis: `npx tsc --noEmit`, `npm run lint`, `npm run test`, `npm run build` (Windows), LSP diagnostics pada file yang diubah, dan `eslint` pada seluruh harness `docs/evidence/P0_5/*.mjs`.

## 4. Hasil aktual (23 September 2026)

**Rekapitulasi final: total 38 baris = 37 PASS + 1 INFO, 0 FAIL, 0 NOT RUN.** Angka "26 PASS" pada dokumen lama tidak dipakai lagi; perbedaan jumlah baris karena AC6d dipecah menjadi 1+4+2 baris, logout keyboard menjadi baris terpisah (2 aktivasi + 1 penolakan), dan AC8a2 ditambahkan.

### 4.1 Alur normal — dev 3000 (`results-main.json`, 24 baris: 23 PASS + 1 INFO)

| Skenario | Metode/perintah | Hasil | Bukti (dari `results-main.json`) |
| --- | --- | --- | --- |
| Login uji | Playwright: kredensial akun uji → submit | PASS | `url=/dashboard, dashHeadingVisible=true, staffEmailVisible=true, authCookies=1`. Akun temporary, dihapus setelah uji. |
| AC1a — Keluar tersedia (mouse) | Playwright: cari tombol | PASS | `buttons=1`. |
| AC1b — Keluar dapat difokus keyboard + fokus terlihat | Tab ke tombol, `getComputedStyle` outline | PASS | `focused=Keluar`, outline `2px solid`. |
| AC2 — Logout mouse → `/login`, cookie auth hilang, form kosong tanpa identitas staf | Klik Keluar pada sesi sah | PASS | `url=/login; authCookiesBefore=1, authCookiesAfter=0; formVisible=true; emailInput=""; dashHeadingVisible=false; staffEmailVisible=false`. Screenshot: `docs/evidence/P0_5/ac2-login-after-logout.png` |
| AC2_chain — Redirect ke `/login` dari Server Action (**asersi penuh**) | Awasi request Server Action + header respons | PASS | `actionPosts=["POST /dashboard nextAction=00668ceb…"]`; `actionRedirectHeader=["200 /dashboard redirect=\"/login;push\""]`; `final=/login`; `authCookiesAfter=0`. **Perbaikan tinjauan:** bukti redirect = header `x-action-redirect` pada respons Server Action `POST /dashboard` (navigasi ke `/login` dikerjakan client-side oleh router Next, sehingga tidak ada request `/login` terpisah) + cookie sesi hilang; status HTTP saja **tidak** dipakai sebagai bukti. |
| AC2_obs — Cache header (observasi, **di luar AC**) | Statis-review `proxy.ts` + observasi header | INFO | `staticReview=proxy.ts matcher [login, dashboard/:path*] menetapkan Cache-Control "private, no-cache, no-store, must-revalidate, max-age=0"`; `observedActionResponse="200 /dashboard cc=\"no-cache, must-revalidate\""`. Bukan syarat kelulusan AC P0.5. |
| AC8a — Tanpa alert saat logout sukses | Awasi role=alert saat logout sukses | PASS | `alerts=[]`. |
| AC2_kbd Enter — Logout keyboard (Tab+Enter, tanpa click/submit JS) | Fokus tombol via Tab, tekan Enter saja | PASS | `focused=Keluar, final=/login, authCookiesBefore=1, authCookiesAfter=0, formVisible=true, dashHeadingVisible=false`. Screenshot: `docs/evidence/P0_5/ac2-keyboard-logout.png` |
| AC2_kbd_deny — Akses ulang `/dashboard` setelah logout keyboard ditolak | `goto /dashboard` setelah logout keyboard | PASS | `final=/login, formVisible=true`. |
| AC2_kbd Space — Logout keyboard (Tab+Space, tanpa click) | Fokus tombol via Tab, tekan Space | PASS | `focused=Keluar, final=/login, authCookiesAfter=0, formVisible=true`. |
| AC3a — `/dashboard` langsung setelah logout → `/login` (tidak pernah dirender) | `goto /dashboard` tanpa sesi | PASS | `status=200, final=/login, formVisible=true, dashHeadingVisible=false`. |
| AC3b — Reload halaman terlindungi → `/login` | `page.goto /dashboard` lalu reload | PASS | `final=/login, formVisible=true, dashHeadingVisible=false`. |
| AC3c — `/dashboard/customers` tidak menampilkan data pelanggan | `goto /dashboard/customers` tanpa sesi | PASS | `status=200, final=/login, formVisible=true, customersHeadingVisible=false`. |
| AC3d — Injeksi ulang cookie pra-logout (skenario di luar alur normal) | Set ulang cookie sesi, buka `/login` | PASS | `final=/login, status=200, formVisible=true`. **Keterbatasan (dilaporkan jujur):** server menolak karena sesi GoTrue sudah dicabut via logout (endpoint `/user` memvalidasi session_id); akses token JWT mentah tetap berlaku hingga kedaluwarsa untuk pemegang lain (perilaku Supabase/GoTrue), di luar kendali aplikasi. |
| AC4 — Back setelah logout tidak membuka dashboard (**laporan dikoreksi**) | Navigasi `/dashboard` → keluar → `goBack` | PASS | `backUrl=/login, dashHeadingVisible=false, formVisible=true, dashRequestsAfterBack=2, dashTextOnlyInScripts=true`. **Perbaikan tinjauan:** dashboard **tidak dirender untuk pengguna** — konten dashboard hanya ditemukan di dalam payload skrip RSC (`dashTextOnlyInScripts=true`), bukan elemen yang terlihat; `dashRequestsAfterBack=2` dicatat sebagai fakta request, **tidak** dijadikan bukti dashboard dirender. Screenshot: `docs/evidence/P0_5/ac4-back-nav.png` |
| AC5 — Tab2 reload setelah logout di tab1 → `/login` | Dua halaman Playwright; reload tab2 | PASS | `tab2InitialDashboard=true, tab2AfterReload=/login`. Keterbatasan: sinkronisasi UI antar-tab seketika bukan requirement. |
| AC5b — Tab2 navigasi baru ke `/dashboard` → `/login` | Tab2 `goto /dashboard` | PASS | `final=/login`. |
| AC7a — Keluar dua kali beruntun tidak crash/tidak loop | Klik Keluar berulang | PASS | `final=/login, afterSettle=/login, appError=false`. |
| AC7b — Logout saat sesi sudah berakhir → aman, tanpa loop | Bersihkan cookie lalu Keluar | PASS | `final=/login, afterSettle=/login, formVisible=true`. |
| AC8a2 — Tanpa alert saat logout sukses pada sesi yang sudah berakhir | Awasi role=alert saat logout berulang | PASS | `alerts=[]`. |
| AC9a — Login kembali setelah logout → `/dashboard` | Kredensial valid → submit | PASS | `url=/dashboard, dashHeadingVisible=true`. |
| AC9b — Regresi P0.4: password spasi ditolak sebagai input kosong | `noValidate`, password `"   "` | PASS | `query=/login?error=required`; alert "Email dan password wajib diisi." (regresi P0.4 tetap terjaga). |
| AC9c — Tanpa secret/raw error di HTML | Grep HTML hasil render | PASS | `htmlHits=[]` (pola: `AuthApiError`, `Internal Server Error (simulated`, `at Server Actions`, `errorStack`, potongan password uji, `eyJhbGciOi`). |
| AC9d — Console/bad responses bersih | Awasi console + respons | PASS | Hanya `404 (Not Found)` favicon (lihat Observasi §6); tanpa token/password. |

### 4.2 Jalur kegagalan logout — dev 3001 + proxy (`results-failure.json`, 9 baris: 9 PASS)

| Skenario | Metode/perintah | Hasil | Bukti (dari `results-failure.json`) |
| --- | --- | --- | --- |
| FAIL_login — Login melalui proxy (mode pass) | Proxy pass → login | PASS | `url=/dashboard, dashHeadingVisible=true`. Terisolasi: env aplikasi menunjuk proxy setempat, bukan Supabase langsung — membuktikan env gagal benar-benar dipakai. |
| AC6a — Kegagalan 500: tanpa redirect sukses menyesatkan | Proxy fail (hanya `POST /auth/v1/logout` → 500); klik Keluar pada sesi sah | PASS | `final=/login?error=logout` (bukan klaim berhasil); `alerts=["Logout belum berhasil. Periksa koneksi lalu coba kembali."]`; `cookiesBefore=1, cookiesAfter=0`; `formVisible=true, dashHeadingVisible=false`. |
| AC6b — Pesan generik Bahasa Indonesia tampil di jalur error yang sesuai | Assert alert di halaman akhir | PASS | `alerts=["Logout belum berhasil. Periksa koneksi lalu coba kembali."], final=/login?error=logout`. |
| AC6c — Tidak ada raw error/token di halaman | Grep HTML hasil render | PASS | `leaks=[]` (pola sama dengan AC9c; pola `"500"` mentah tidak dipakai karena false-positive terhadap `fontWeight:500`/`border-slate-500`). |
| AC6d1 — Sesi hilang setelah kegagalan: `/login?error=logout`, tanpa redirect loop (**browser E2E nyata, HTTP 500**) | Proxy fail; logout; amati akhir | PASS | `final=/login?error=logout, afterSettle=/login, alerts=[…], cookiesAfter=0` — tanpa loop. Metode: browser nyata + Server Action nyata + Supabase lokal (via proxy yang hanya memutus `POST /auth/v1/logout`); cabang sesi-hilang dipilih karena `getUser()` setelah error tidak menemukan sesi (auth-js meng-evict sesi pada error non-401/403/404). |
| AC6d3 — Sesi valid: pesan kegagalan tampil di `/dashboard?error=logout`, tombol Keluar tersedia, tanpa redirect loop (browser E2E) | Login nyata (proxy pass) → buka `/dashboard?error=logout` (target cabang sesi-valid) | PASS | `final=/dashboard?error=logout, alerts=[…], alertVisible=true, keluarAvailable=true, staysOnDashboard=true, dashHeadingVisible=true`. Screenshot: `docs/evidence/P0_5/ac6-dashboard-error-valid-session.png` — **pemilihan cabang itu sendiri** dibuktikan terpisah oleh mock terisolasi (§4.3), bukan oleh baris ini. |
| AC6d3b — Retry logout setelah kondisi pulih (sesi valid): sukses → `/login` tanpa alert error | Pada sesi valid setelah kegagalan, proxy pass → klik Keluar lagi | PASS | `final=/login, alerts=[]`. |
| AC6e — Setelah kondisi pulih, login ulang + logout sukses → `/login` tanpa alert error | Proxy pass setelah kegagalan; login → logout | PASS | `url=/login, alerts=[]`. Terisolasi: gunakan proxy pass setelah kegagalan, bukan mematikan/menyalakan Supabase. |
| AC6f — Console bersih (tanpa token/password) | Awasi console | PASS | Hanya `404 (Not Found)` favicon. |

### 4.3 Seleksi cabang `logout()` — mock terisolasi (`results-ac6d.json`, 5 baris: 5 PASS)

**Batas bukti (dinyatakan eksplisit):** module loader memock **hanya** `@/lib/supabase/server` (seam klien Supabase). Kode yang diuji untuk nyata: kode sumber `app/login/actions.ts` (dimuat dari disk) dan `next/navigation.redirect()` bawaan Next. **Ini bukan verifikasi browser/Supabase E2E** — cabang yang diuji adalah logika pemilihan redirect pada `logout()` yang asli. Tidak ada logika logout yang disalin ke test; mock dimuat via modul loader Node, bukan flag/endpoint aplikasi.

| Skenario | Hasil | Bukti (dari `results-ac6d.json`) |
| --- | --- | --- |
| Preamble — kode asli diimpor, redirect() Next asli dipakai | PASS | `actionsSource=…/app/login/actions.ts`, `nextNavigation=…/node_modules/next/navigation.js`. |
| AC6d2a — Sesi masih valid: signOut error + getUser valid → `/dashboard?error=logout` (bisa coba lagi), 1 redirect, tanpa loop | PASS | `digest=NEXT_REDIRECT;replace;/dashboard?error=logout;307;`, `parsedTarget=/dashboard?error=logout`, `signOutCalls=1, getUserCalls=1, redirectsThrown=1`. |
| AC6d2b — Sesi sudah hilang: signOut error + getUser tanpa user → `/login?error=logout`, 1 redirect | PASS | `digest=NEXT_REDIRECT;replace;/login?error=logout;307;`, `signOutCalls=1, getUserCalls=1`. Konsisten dengan AC6d1 (browser E2E HTTP 500) dan analisis auth-js yang meng-evict sesi pada error non-401/403/404. |
| AC6d2c — Logout sukses: signOut tanpa error → `/login` tanpa `error=logout`, getUser **tidak** dipanggil | PASS | `digest=NEXT_REDIRECT;replace;/login;307;`, `signOutCalls=1, getUserCalls=0`. Konsisten dengan AC2 (browser E2E logout sukses tanpa alert). |
| AC6d2d — Tidak ada loop/klaim ganda: tepat satu redirect per invokasi, `logout()` tidak pernah resolve normal | PASS | `redirectsPerBranch=[1,1,1]`. Bukti level kode; perilaku loop level navigasi dibuktikan oleh AC6d1/AC6d3 (`afterSettle` di URL akhir). |

## 5. Perbaikan berdasarkan temuan tinjauan

### 5.1 Temuan tinjauan asersi awal (iterasi 23 September 2026)

| # | Temuan tinjauan | Aksi pada iterasi ini | Hasil | Lokasi bukti |
| --- | --- | --- | --- | --- |
| 1 | `AC2_chain` dianggap PASS tanpa asersi; `dashboardNoStore=false` dihitung membuktikan cache; beberapa cek menerima hasil delivery tanpa memeriksa kondisi bernama pada kriteria (URL/status saja). | `AC2_chain` kini memakai **asersi penuh**: request Server Action teramati (`POST /dashboard` berheader Next-Action), header respons `x-action-redirect: /login;push` terperiksa, `final=/login`, dan `authCookiesAfter=0`. Klaim cache dipisah ke baris observasi `AC2_obs` (stasis + header respons) yang `INFO`, bukan syarat kelulusan. Status HTTP tidak dijadikan bukti redirect. | PASS (AC2_chain), INFO (AC2_obs) | `results-main.json` baris `AC2_chain` dan `AC2_obs` |
| 2 | Logout keyboard tidak dibuktikan (hanya assert fokus, bukan aktivasi). | Skenario baru `AC2_kbd Enter` dan `AC2_kbd Space`: fokus tombol Keluar via Tab lalu aktivasi keyboard saja (Enter tanpa JS submit, Space) — tanpa `click()`. Server Action berjalan (sesi berakhir, cookie 0, `/login` tampil); `AC2_kbd_deny` membuktikan `/dashboard` ditolak setelah logout keyboard. | 3 PASS | `results-main.json` baris `AC2_kbd Enter`, `AC2_kbd Space`, `AC2_kbd_deny`; screenshot `ac2-keyboard-logout.png` |
| + | Pelaporan: jumlah baris/hasil tidak lagi menyalin angka lama. | Rekapitulasi dihitung ulang dari artefak final; baris `INFO` dihitung terpisah; `AC2_obs`/`AC4_obs` tidak dihitung sebagai PASS AC. | 37 PASS + 1 INFO, 0 FAIL, 0 NOT RUN | `results-main.json`, `results-failure.json`, `results-ac6d.json` |

### 5.2 Temuan alat pengujian dan koreksi klaim penutupan (iterasi 25 September 2026)

Tinjauan sebelumnya mengidentifikasi bahwa penutupan temuan sebelumnya mengandung hasil sukses palsu (*false positive*) dan pengujian terpisah yang belum menguji kode harness aktual. Dilakukan perbaikan terarah:

| # | Temuan alat uji | Masalah pada implementasi lama | Aksi perbaikan pada iterasi ini | Metode verifikasi | Hasil | Lokasi bukti |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | Deteksi kebocoran dilakukan setelah sanitasi (false positive). | `consoleIssues` diisi teks yang sudah disamarkan `sanitize()`, lalu `rawConsoleHasSecret` memeriksa password/token pada teks tersebut. Password/token sintetis tidak terdeteksi dan dinilai PASS secara keliru. | Deteksi pesan asli dilakukan di memori *sebelum* sanitasi via `detectLeaks(rawText)` pada `p05-harness-utils.mjs`. `ConsoleTracker` mengumpulkan kategori kebocoran (`leakCategories`) dan hanya menyimpan teks yang sudah disamarkan ke dalam log/artefak (`issues`). Skenario menegaskan `!consoleTracker.hasLeaks()` (kebocoran menghasilkan FAIL), sementara artefak tetap bebas secret mentah. | Pengujian memori dan event handler dengan password sintetis, JWT, dan Bearer token sintetis pada `p05-harness-proof.mjs` (Group 2). | PASS (kebocoran terdeteksi, kategori terekam, asersi skenario FAIL, output bersih) | `p05-harness-utils.mjs`, `p05-logout-tests.mjs`, `p05-logout-failure.mjs`, `p05-harness-proof.mjs` (Group 2) |
| T2 | Kegagalan penyimpanan hasil dan cleanup masih menghasilkan exit code 0. | Blok `finally` menangkap error `writeFileSync` dan `browser.close` hanya dengan `console.error` tanpa mempengaruhi status akhir proses, sehingga exit code tetap 0. | `createHarnessLifecycle` mengelola siklus akhir (`finalize`). Skenario FAIL, harness error, kegagalan penulisan file, maupun kegagalan cleanup browser menjamin exit code 1 via `executeExit()`. Cleanup tetap diupayakan jika penyimpanan file gagal. Jika penulisan gagal, ringkasan aman dicetak ke stderr (`RESULTS_FALLBACK_SUMMARY`) tanpa mengklaim artefak tersimpan. Error utama tetap tersimpan saat screenshot/cleanup gagal. | Subprocess terisolasi dengan skenario FAIL, penulisan gagal, cleanup gagal, dan preservasi error utama pada `p05-harness-proof.mjs` (Group 3, 4, 5, 6, 7). | PASS (exit code 1 pada setiap kegagalan; ringkasan stderr aman; cleanup tetap jalan; exit code 0 saat semua sukses) | `p05-harness-utils.mjs`, `p05-harness-proof.mjs` (Group 3–7) |
| T3 | Suite pembuktian belum menguji kode harness aktual. | `p05-harness-proof.mjs` sebelumnya menguji program contoh terpisah untuk exit code dan keyboard Promise, serta sanitizer helper akun yang terpisah dari harness browser. | Logika bersama diekstrak ke modul alat uji `p05-harness-utils.mjs` (`createSanitizer`, `ConsoleTracker`, `executeKeyboardAction`, `createHarnessLifecycle`). Modul ini diimpor dan dipakai nyata oleh `p05-logout-tests.mjs`, `p05-logout-failure.mjs`, `p05-account.mjs`, dan `p05-harness-proof.mjs`. Suite pembuktian memverifikasi modul bersama ini dan memastikan kedua harness browser mengimpor dan memakainya. | Pemeriksaan kode sumber kedua harness + eksekusi pengujian terhadap modul bersama pada `p05-harness-proof.mjs` (Group 1 & 8). | PASS (kedua harness terbukti memakai `p05-harness-utils.mjs`, keyboard action diawait tuntas) | `p05-harness-utils.mjs`, `p05-harness-proof.mjs` (Group 1, 8) |
| T4 | Helper akun dan penanganan kredensial. | Helper akun berpotensi membocorkan kredensial, tidak mendukung get-by-id, dan crash saat diimpor tanpa env `SUPABASE_SERVICE_KEY`. | `p05-account.mjs` mewajibkan password via env `P05_PASSWORD` (tanpa cetak ke stdout), mendukung `get-by-id`, paginasi penuh `get-by-email`, safeguard `isTestAccount` (menolak penghapusan akun non-uji), pembedaan 404 dari network error, serta defer pemeriksaan service key agar aman diimpor. | Pengujian subprocess langsung GoTrue admin API: create, get-by-id, get-by-email, isTestAccount, delete, konfirmasi 404, network error, dan validasi env pada `p05-harness-proof.mjs` (Group 9). | PASS (helper akun aman; akun non-uji terlindungi) | `p05-account.mjs`, `p05-harness-proof.mjs` (Group 9) |
| T5 | Fallback service-role key tertanam dalam kode & suite belum terpisah aman. | `p05-harness-proof.mjs` sebelumnya memuat fallback service-role key langsung dalam kode pada Group 9, sehingga berpotensi mengeksekusi integrasi tanpa konfigurasi eksplisit atau membocorkan secret di file tracked. | Fallback key dihapus seluruhnya dari kode sumber; key hanya diterima dari environment (`process.env.SUPABASE_SERVICE_KEY`). Ditambahkan fungsi pengaman `assertLocalSupabaseUrl` pada `p05-account.mjs` untuk menolak target remote (`https://...`) sebelum request HTTP dilakukan. Pelaksanaan pengujian sintetis dipisahkan dari integrasi akun: suite default berjalan murni offline (tanpa DB & tanpa key) dan menandai integrasi sebagai `NOT RUN`. Integrasi diaktifkan eksplisit via flag `--with-account`; jika key tidak tersedia di env, suite keluar dengan exit code 1 dan pesan prasyarat aman tanpa request jaringan. | Pengujian subprocess tanpa key, penolakan target remote, validasi pesan prasyarat saat `--with-account` tanpa key, pemindaian kode anti-fallback key, serta eksekusi integrasi lokal penuh jika key tersedia di env. | PASS (sintetis 20 PASS / 0 FAIL / 1 NOT RUN; integrasi 28 PASS / 0 FAIL / 0 NOT RUN; target remote ditolak; zero fallback key tertanam) | `p05-account.mjs`, `p05-harness-proof.mjs` (Group 9 & 10) |

### 5.3 Cara Menjalankan Suite Verifikasi Alat Uji

1. **Mode Sintetis Offline (Default — tanpa database, tanpa kredensial):**
   ```bash
   node docs/evidence/P0_5/p05-harness-proof.mjs
   ```
   - Berjalan murni offline dan in-memory dengan secret sintetis.
   - Hasil aktual: **20 checks PASS, 0 FAIL, 1 NOT RUN** (Group 10 integrasi akun GoTrue ditandai `NOT RUN`), exit code 0.

2. **Mode Integrasi Akun Lokal GoTrue (Eksplisit — butuh Supabase lokal & key via env):**
   ```bash
   # Di Windows PowerShell (key dibaca dari CLI lokal tanpa dicatat di file tracked):
   $key = (npx supabase status --output json | ConvertFrom-Json).SERVICE_ROLE_KEY
   $env:SUPABASE_SERVICE_KEY = $key
   node docs/evidence/P0_5/p05-harness-proof.mjs --with-account
   $env:SUPABASE_SERVICE_KEY = $null
   ```
   - Membutuhkan Supabase lokal aktif (`http://127.0.0.1:54321`) dan variabel env `SUPABASE_SERVICE_KEY`.
   - Menguji siklus hidup akun temporary nyata di GoTrue: create, get-by-id, paginasi get-by-email, delete, dan konfirmasi 404 pasca-delete.
   - Hasil aktual: **28 checks PASS, 0 FAIL, 0 NOT RUN**, exit code 0.

3. **Perilaku Prasyarat Aman (Tanpa Key saat Integrasi Diminta):**
   ```bash
   node docs/evidence/P0_5/p05-harness-proof.mjs --with-account
   # Output: PREREQUISITE ERROR: SUPABASE_SERVICE_KEY environment variable is required when --with-account is specified.
   # Exit code: 1 (sebelum request jaringan apa pun)
   ```

## 6. Regresi dan pemeriksaan statis (25 September 2026)

| Pemeriksaan | Metode/Tipe | Hasil | Bukti |
| --- | --- | --- | --- |
| `npx tsc --noEmit` | Tipe statis TypeScript | PASS | EXIT:0 (tidak ada error tipe). |
| `npm run lint` | Linter ESLint proyek | PASS | EXIT:0 (`eslint` bersih). |
| `npx eslint docs/evidence/P0_5/*.mjs` | Linter ESLint alat uji | PASS | EXIT:0 (seluruh harness & helper bebas error/warning). |
| `npm test` | Unit test domain Jest/Node | PASS | unit **105 pass / 0 fail** (244 ms). |
| `node docs/evidence/P0_5/p05-harness-proof.mjs` (Mode Sintetis Offline) | Suite pembuktian alat uji (modul bersama, subprocess, guards) | PASS | **20 checks PASS / 0 FAIL / 1 NOT RUN** (exit code 0; integrasi GoTrue tercatat NOT RUN). |
| `node docs/evidence/P0_5/p05-harness-proof.mjs --with-account` (Mode Integrasi Lokal) | Suite pembuktian alat uji lengkap (termasuk GoTrue admin API) | PASS | **28 checks PASS / 0 FAIL / 0 NOT RUN** (exit code 0; GoTrue admin lifecycle terverifikasi). |
| Verifikasi cleanup akun Auth Supabase | GoTrue admin API | PASS | Hanya 1 akun staf default (`helpdesk@gmail.com`), 0 akun uji tersisa (akun temporary `20ac833a-325a-4773-9840-8451cfd8df0f` telah dihapus dan terkonfirmasi NOT_FOUND). |

*Catatan metodologi:* Pengujian browser E2E alur normal (`results-main.json`) dan alur kegagalan (`results-failure.json`) tidak dijalankan ulang pada iterasi ini guna mempertahankan integritas lingkungan dan menghindari penimpaan artefak historis, karena tidak ada perubahan kode aplikasi. Uji yang dijalankan pada iterasi ini adalah pembuktian modul alat uji bersama (`p05-harness-utils.mjs`), subprocess jalur exit code/error handling, isolasi konfigurasi, dan helper akun (`p05-account.mjs`).

## 7. Pekerjaan tersisa dan artefak

**Dalam lingkup P0.5: TIDAK ADA**. Seluruh acceptance criteria terpenuhi dengan asersi semantik dan 5 temuan alat pengujian telah diselesaikan serta dibuktikan secara empiris.

Artefak di repo (`docs/evidence/P0_5/`):

| File | Tipe / Metode | Isi & Peran |
| --- | --- | --- |
| `p05-harness-utils.mjs` | Modul alat uji bersama | Fungsi utilitas bersama: sanitasi & deteksi kebocoran memori asli (`createSanitizer`), pengawasan console & pageerror (`ConsoleTracker`), eksekusi keyboard aman (`executeKeyboardAction`), dan pengelolaan lifecycle harness dengan jaminan exit code nonzero pada kegagalan skenario, penulisan hasil, atau cleanup (`createHarnessLifecycle`). |
| `p05-logout-tests.mjs` | Browser E2E harness (Playwright) | Harness alur normal browser (24 baris; mouse, keyboard via Promise.all, chain redirect, cache header, back, tab2, alert, secret redaction, safe shot, integrasi `p05-harness-utils.mjs`). |
| `p05-logout-failure.mjs` | Browser E2E harness (Playwright + Proxy) | Harness alur kegagalan (9 baris; AC6a–f, proxy 500, cabang sesi valid & hilang, safe shot, integrasi `p05-harness-utils.mjs`). |
| `p05-ac6d-branch-logic.mjs` + `p05-ac6d-loader.mjs` | Mock terisolasi (Node loader) | Uji terisolasi pemilihan cabang `logout()` asli (mock hanya `@/lib/supabase/server`). |
| `p05-fail-proxy.mjs` | Proksi lokal HTTP | Proksi lokal yang memutus `POST /auth/v1/logout` (mode pass/fail via file `p05-fail-mode`). |
| `p05-account.mjs` | CLI helper GoTrue admin | Helper akun uji temporary (kredensial via env saja tanpa hardcoded fallback, penolakan target remote `assertLocalSupabaseUrl`, tanpa leak stdout, get-by-id, paginasi per 50, pembedaan 404 vs network failure, safeguard penolakan akun non-uji, integrasi `createSanitizer`). |
| `p05-harness-proof.mjs` | Suite pembuktian terarah (Subprocess + Mock + GoTrue) | Suite pembuktian mandiri alat uji (dual-mode: default 20 PASS + 1 NOT RUN sintetis offline; `--with-account` 28 PASS integrasi lokal; integritas harness, deteksi kebocoran pra-sanitasi, exit code nonzero pada kegagalan, preservasi error utama, keyboard promise handling, zero fallback keys). |
| `results-main.json` (24 baris), `results-failure.json` (9), `results-ac6d.json` (5) | Hasil uji browser historis (23 Sept 2026) | Hasil uji final terekam aktual: **37 PASS + 1 INFO, 0 FAIL, 0 NOT RUN** (dipertahankan, tidak ditimpa oleh pengujian sintetis). |
| `ac2-keyboard-logout.png`, `ac2-login-after-logout.png`, `ac4-back-nav.png`, `ac6-logout-500.png`, `ac6-dashboard-error-valid-session.png` | Screenshot visual historis | Bukti visual render browser Playwright. |

Pembersihan lingkungan uji:
- Seluruh akun uji temporary telah dihapus via helper dan diverifikasi `NOT_FOUND`.
- Dev server dan proksi dihentikan; port `3000`, `3001`, dan `54389` telah bebas.
- Tidak ada file kredensial atau rahasia yang tersimpan di repo.

Di luar lingkup (tidak dikerjakan sesuai batasan task): P0.10 token UI, P0.11 layout dashboard (TRACKER: In Progress), favicon, review aksesibilitas menyeluruh (P5.2), integration test lokal di WSL.

## 8. Observasi di luar P0.5 (tidak diperbaiki)

1. **404 console saat muat halaman** — kemungkinan `/favicon.ico`; repo tidak memiliki `public/favicon`. Tidak memengaruhi alur logout; catatan terpisah (sudah tercatat sejak P0.4).
2. **auth-js `_signOut` meng-evict sesi lokal sebelum mengembalikan error** untuk error non-401/403/404 — perilaku library yang menjadi akar temuan AC6b; diakomodasi di `logout()` dengan cabang `getUser()`, bukan dengan memblokir eviction.
3. **Single-instance dev Next.js** — lock `.next\dev` mencegah port 3000 dan 3001 berjalan bersamaan; verifikasi normal vs gagal dijalankan bergantian. Keterbatasan lingkungan dev, bukan aplikasi.
4. **WSL2 tidak menjangkau localhost Windows** — harness harus dijalankan dari sisi Windows; runner Windows di luar repo. Keterbatasan lingkungan, bukan aplikasi.

## 9. Rekomendasi status

**Done** — seluruh acceptance criteria P0.5 terpenuhi dan dibuktikan dengan asersi yang terikat pada semantik skenario:
1. Logout mengakhiri sesi dan mengarahkan ke `/login` (AC2 beserta AC2_chain dengan bukti header `x-action-redirect`, logout keyboard via Tab+Enter dan Tab+Space yang diawait dengan benar).
2. Sesi lama tidak dapat membuka dashboard (AC3a–d, AC4, AC5/AC5b, AC7a/b).
3. Kegagalan logout terlihat (AC6a–f) termasuk kedua cabang status sesi (browser E2E nyata HTTP 500 + mock terisolasi Server Action asli).
4. Seluruh temuan alat pengujian terbuka (deteksi kebocoran memori asli pra-sanitasi, exit code nonzero pada skenario gagal/write fail/cleanup fail, preservasi error utama, penanganan Promise keyboard, keterkaitan harness aktual, penghapusan hardcoded fallback key, penolakan target remote, dan pemisahan aman suite sintetis vs integrasi akun) telah diselesaikan sepenuhnya dengan bukti empiris.

Hasil pengujian tercatat jujur dan terdiferensiasi:
- **Bukti historis browser E2E (23 Sept 2026):** **37 PASS + 1 INFO, 0 FAIL, 0 NOT RUN** (dipertahankan; browser E2E tidak dijalankan ulang karena tidak ada perubahan kode aplikasi).
- **Suite pembuktian sintetis offline default (25 Sept 2026):** **20 checks PASS, 0 FAIL, 1 NOT RUN** (Group 10 integrasi akun GoTrue dilaporkan sebagai `NOT RUN`, exit code 0).
- **Suite pembuktian integrasi akun lokal GoTrue (25 Sept 2026):** **28 checks PASS, 0 FAIL, 0 NOT RUN** (dijalankan via `--with-account` dengan key dari environment lokal, exit code 0).
- Tanpa modifikasi kode aplikasi baru, tanpa hardcoded key pada file tracked, dan tanpa bypass pengujian.