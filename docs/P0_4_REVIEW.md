# P0.4 Review — Form dan aksi login staf

**Tanggal verifikasi:** 23 September 2026
**Task:** P0.4 (dependency: P0.3 ✅) · **Acuan keputusan:** D50, PRD v2.1 FR-18/FR-19 (D43–D48 tidak tersedia dan tidak direferensikan)
**Ru lingkup:** pemeriksaan form, Server Action, sesi, dan redirect terkait login; perbaikan seperlunya. Logout (P0.5), signup, reset password, OAuth, MFA, role, shell dashboard, dan token UI di luar lingkup.

## 1. Lingkungan (tanpa secret)

- WSL2 (Ubuntu, node v24.14.1) + host Windows; Docker Desktop dengan stack Supabase lokal proyek ini.
- Supabase lokal: Auth/GoTrue v2.196.0 di `http://127.0.0.1:54321` (URL dari `.env.local`; key tidak dicatat di dokumen ini).
- Aplikasi: Next.js16.3.5 dev server dijalankan di Windows (`npm run dev`, port3000) karena binari native SWC/Turbopack di `node_modules` terpasang untuk Windows (dev server WSL gagal: "Turbopack is not supported on this platform").
- Peramban: Playwright1.63 dengan Chrome sistem Windows (headless, `locale: id-ID`); harness di `%TEMP%\p04-pw` (di luar repo). Playwright MCP bawaan tidak dapat dipakai karena meminta Chrome sistem di `/opt/google/chrome` dan instalasi butuh sudo — diakali dengan harness Playwright lokal, bukan dependency repo baru.
- Akun uji temporary `p04-login-review-…@example.test` dibuat via admin API GoTrue (`supabase status -o json`), **dihhapus setelah uji** (DELETE200 → GET verify404 GONE; sisa akun `p04-login-review` =0). Tidak ada akun staf yang diubah atau di-reset; database tidak di-reset.
- Catatan operasional: Docker Desktop awalnya tidak berjalan dan dinyalakan untuk verifikasi; stack Supabase dibiarkan berjalan. Dev server dihentikan setelah uji.

## 2. Perubahan kode

| File | Perubahan | Alasan |
| --- | --- | --- |
| `app/login/actions.ts` | Guard input kosong: `!passwordValue` → `!passwordValue.trim()` (satu baris; password yang dikirim tetap apa adanya, tidak di-trim) | Baseline: password hanya-spasi lolos validasi Server Action dan diteruskan ke `signInWithPassword`, sehingga menghasilkan `error=login` ("kredensial salah") alih-alih `error=required`. AC4 menuntut input kosong ditolak oleh validasi server tanpa membentuk sesi. |

Tidak ada file lain di repo yang diubah. Tidak ada perombakan arsitektur, dependency baru, perubahan schema, commit/push, atau perubahan `docs/TRACKER.md`.

Perilaku yang sudah benar sebelum perbaikan (tidak diubah): render form berlabel Indonesia, redirect sesi di `/login`, redirect sukses ke `/dashboard`, proteksi reload dashboard via `proxy.ts` + `getUser`, pesan generik untuk kredensial salah/kesalahan koneksi, `required` pada kedua input, `role="alert"` pada pesan error, fokus `focus-visible`, hanya `NEXT_PUBLIC_*` di client tanpa `console.log` kredensial.

## 3. Langkah reproduksi

1. `npx supabase start` (Docker) dan `npm run dev` di Windows; siapkan `.env.local` sesuai README.
2. Buat akun uji temporary via admin API GoTrue (atau pakai akun staf lokal milik sendiri), simpan kredensial di file terpisah.
3. Jalankan harness Playwright (skenario di bawah) terhadap `http://localhost:3000`: goto `/login` tanpa sesi → assert label/`required` → Tab×3 assert urutan & outline → klik submit kosong (validasi browser) → `form.noValidate=true` lalu submit kosong dan password spasi (Server Action; assert `?error=required`, teks alert, nol cookie `auth-token`) → kredensial salah dan akun tak dikenal (assert `?error=login`, teks generik identik, tanpa leak, nol cookie) → isi kredensial valid + Enter → assert `/dashboard`, cookie sesi, tampil email → `reload` → assert tetap `/dashboard` → goto `/login` → assert redirect `/dashboard` → grep HTML/console untuk secret.
4. AC7: jalankan instance dev terpisah dengan `set NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:59999` (port mati) di **dalam** cmd Windows pada port3001; buka `/login`, submit kredensial **valid** → wajib gagal ke `?error=login` (membuktikan env mati benar-benar dipakai), lalu assert pesan generik tanpa leak dan tanpa cookie. Env dari shell WSL tidak tembus ke proses Windows (WSLENV) — percobaan AC7 pertama tidak valid dan diulang dengan metode ini.
5. Pemeriksaan: `npm run lint`, `npm test`, `npm run build` (Windows), LSP diagnostics pada file yang diubah.

## 4. Hasil aktual (23 September 2026)

| Skenario | Metode/perintah | Hasil | Bukti / keterbatasan |
| --- | --- | --- | --- |
| AC1 — Tanpa sesi, `/login` menampilkan form berlabel Indonesia | Playwright `goto /login`, context baru tanpa cookie | PASS | `url=/login`; h1 "Masuk ke Upaznet"; `label[for=email]`="Email", `label[for=password]`="Password"; tombol "Masuk"; `required` true/true. Screenshot: `%TEMP%\p04-pw\evidence\ac1-login-form.png` |
| AC2 — Kredensial valid → sesi sah + redirect `/dashboard` | Playwright: isi form + **Enter** (submit keyboard) ke Server Action `login` | PASS | `url=/dashboard`; body memuat email akun uji; cookie `sb-127-auth-token` (1). Akun temporary, dihapus setelah uji. |
| AC3 — Reload dashboard tetap terakses | `page.reload()` setelah login | PASS | `url` tetap `/dashboard`, email tampil, tidak redirect `/login` |
| AC4a — Form kosong ditolak validasi browser | Klik "Masuk" pada form kosong | PASS | Tidak ada navigasi; `validity.valueMissing=true`. Keterbatasan: teks bubble native Chrome ("Please fill out this field.") mengikuti locale browser, bukan UI aplikasi; pesan aplikasi berikutnya berbahasa Indonesia. |
| AC4b — Server Action tetap memvalidasi input kosong saat HTML validation dilewati; tidak terbentuk sesi | `form.noValidate=true`, submit `email`+`password` kosong | PASS | Redirect `?error=required`; alert `role=alert`: "Email dan password wajib diisi."; `authCookies=0`. |
| AC4c — Password hanya-spasi ditolak sebagai input kosong | `noValidate`, email valid + password `"   "` | PASS **setelah perbaikan** (baseline: FAIL) | Baseline: `?error=login` + "Login belum berhasil…" (spasi diteruskan ke Supabase). Sesudah fix: `?error=required` + "Email dan password wajib diisi."; `authCookies=0`. Interpretasi "kosong" = spasi saja; password berisi dipertahankan tanpa trim saat dikirim. |
| AC5a — Kredensial salah → pesan generik, tanpa bocoran, tanpa sesi | Playwright: email akun uji + password salah | PASS | `?error=login`; alert persis "Login belum berhasil. Periksa email, password, dan koneksi."; leak `["Invalid login credentials","AuthApiError","auth/v1", userId, password uji]` = []; `authCookies=0`. Screenshot: `evidence/ac5-wrong-credentials.png` |
| AC5b — Akun tidak dikenal → pesan sama persis (tanpa enumerasi akun) | Playwright: email tak dikenal + password apa pun | PASS | Alert identik dengan AC5a (`sameAsKnownAccount=true`); `authCookies=0` |
| AC6 — Sesi sah membuka `/login` → `/dashboard` | Playwright `goto /login` dalam context login | PASS | `final url=/dashboard` (log server: `GET /login 307` lalu `GET /dashboard 200`) |
| AC7 — Kegagalan koneksi Auth ditangani; bukan login berhasil | Dev server terpisah port3001, `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:59999` (port mati); submit kredensial **valid** | PASS | `DEAD_URL_CONFIRMED`: `?error=login` + pesan generik yang sama; `/login` tetap200 dengan form; tanpa leak (`ECONNREFUSED`/`fetch failed`/stack tidak ada di HTML); `authCookies=0`. Percobaan pertama tidak valid (env tidak ter-apply + kredensial palsu) dan diganti metode di atas. Simulasi mengarah ke port mati, bukan mematikan Supabase produksi. |
| AC8 — Keyboard, label, fokus, pesan error dapat dikenali | Playwright: Tab×3, `getComputedStyle` outline, alert di-scope `main`, submit via Enter | PASS | Urutan fokus `email → password → button[submit]`; outline fokus `2px solid`; label terikat `for/id`; tanpa alert saat normal (`alertsInMain=0`); submit keyboard membuktikan login (AC2). Keterbatasan: verifikasi keyboard terbatas pada alur form login, bukan uji screen reader menyeluruh (P5.2). |
| AC9 — Tanpa secret server di client/log | Grep HTML hasil render + console Playwright; grep log dev server; statis `grep process.env/console.log` | PASS | `htmlHits=[]`, `consoleSecretHits[]` untuk pola `service_role`, `SERVICE_ROLE`, `HELPDESK_DATABASE_URL`, password uji, `eyJhbGciOi`; log dev tanpa `service_role`/JWT/password uji; `app/login`, `lib/supabase`, `proxy.ts` hanya memakai `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` dan tidak mencetak kredensial. |
| Regresi — lint / unit test / build | `npm run lint`; `npm test`; `npm run build` (Windows); LSP diagnostics `app/login/actions.ts` | PASS | lint exit0; unit **105 pass /0 fail**; build `EXIT=0` (compiled successfully, TypeScript ok); LSP tanpa diagnostics. Integration test `test:*:local` bergantung CLI Docker/Windows — tidak dijalankan di WSL dan di luar scope P0.4 (P0.4 tidak memiliki integration test sendiri). |

## 5. Observasi di luar P0.4 (tidak diperbaiki)

1. **404 console saat muat halaman** — kemungkinan `/favicon.ico`; repo tidak memiliki `public/favicon`. Tidak memengaruhi alur login; catatan terpisah, bukan bagian acceptance P0.4.
2. **Transient `role="alert"` pada2 run awal harness** — tidak reproduksi pada debug terpisah maupun run final (`alertsInMain=0`); diduga indikator dev overlay menanggapi error console (favicon). Terekam apa adanya; alert aplikasi selalu berada di dalam `<main>`.
3. **Bubble validasi native Chrome** berbahasa Inggris pada context `id-ID` — locale browser, di luar kendali aplikasi; pesan aplikasi sendiri berbahasa Indonesia.
4. **Hydration warning `caret-color` pada dev** — interaksi Playwright vs React dev hydration; bukan kebocoran dan tidak muncul sebagai kegagalan alur.

## 6. Pekerjaan tersisa

- Dalam lingkup P0.4: **tidak ada**. Seluruh acceptance criteria terpenuhi dan terbukti (13 skenario PASS, termasuk regresi lint/unit/build).
- Di luar lingkup (tidak dikerjakan sesuai batasan task): P0.5 logout (fungsi `logout()` ada di `actions.ts` tetapi sengaja tidak diuji di task ini), favicon, review aksesibilitas menyeluruh (P5.2), integration test lokal di WSL.
- Hasil harness: `%TEMP%\p04-pw\results.json`, `results-ac7.json`, `evidence\*.png` (artefak sementara Windows; berisi email akun uji yang sudah dihapus, tanpa password).

## 7. Rekomendasi status

**Done** — seluruh acceptance criteria AC1–AC9 terpenuhi dengan bukti verifikasi perilaku melalui form dan Server Action nyata pada Supabase lokal, bukan sekadar sign-in SDK. Satu kekurangan yang ditemukan (password spasi lolos validasi server) telah diperbaiki dan diverifikasi ulang menjadi PASS.
