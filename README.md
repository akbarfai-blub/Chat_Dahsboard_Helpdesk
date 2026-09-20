# Upaznet Helpdesk Automation

Prototype respons pertama komplain ISP: Telegram → rule + data jaringan dummy → antrean dashboard → balasan staf. Stack Next.js/TypeScript, Supabase Postgres/Auth, target deploy Vercel. Belum memerlukan akses OLT/NMS.

**Fokus produk:** Inbox Helpdesk + Auto-Triage + Konteks Jaringan. Tiket dibuat manual oleh staf di Custpanel berdasarkan pemeriksaan dashboard; delegasi teknisi, pelaporan tiket dan finance tetap di Custpanel.

## Acuan aktif

1. [PRD v2.1](docs/PRD.md) — requirement, rule, model data, dan urutan pembangunan.
2. [Design System v1.1](docs/DESIGN_SYSTEM.md) — baseline visual dan state UI.
3. [Decision log](docs/decision-log.md) — histori dan pilihan implementasi.
4. [Panduan implementasi](CLAUDE.md) — batas arsitektur dan konvensi kerja.

## Status implementasi lokal

- Tersedia: scaffold, login/logout staf, proteksi dashboard, migration identitas/topologi, seed dummy, dan direktori pelanggan read-only.
- `/dashboard/customers`: pencarian nama/kode, filter status administrasi, pagination 25 pelanggan, layanan → ODP → ODC, identitas channel, dan pengirim belum ditautkan.
- Halaman memakai sesi staf + RLS, tanpa service-role. Status administrasi aktif **bukan** status jaringan online. Halaman direktori belum menampilkan pemeriksaan; API mock tersedia terpisah.
- Tersedia tambahan: schema/fixture ONU dan upstream, NetworkStatusProvider/MockProvider, domain freshness/area, serta API pemeriksaan read-only khusus staf. Lihat [panduan pemeriksaan mock](docs/NETWORK_PROVIDER.md).
- Belum tersedia: domain auto-triage/pemilihan balasan, inbox/antrean percakapan, webhook Telegram, serta pengiriman balasan. Pemeriksaan belum ditampilkan dalam UI pelanggan.
- Deployment dan integrasi produksi belum diverifikasi. Semua outbound prototype nantinya hanya ke tester allowlist dan berlabel simulasi.

Migration aktual di [supabase/migrations](supabase/migrations) adalah source of truth schema. Empat tabel mock tambahan dijelaskan pada [kontrak provider](docs/NETWORK_PROVIDER.md#schema-aktual-tambahan). Enam tabel awal: `customers`, `services`, `odcs`, `odps`, `service_topology`, `channel_identities`. [SQL lama](docs/database_schema.sql) adalah snapshot historis Mass Outage; **jangan apply langsung**. Perubahan schema selanjutnya harus melalui migration baru.

## Menjalankan aplikasi

Prasyarat: Node/npm, Docker, Supabase CLI lokal melalui dependency proyek.

```powershell
npm ci
npx supabase start
```

Siapkan `.env.local` dengan `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` dari lingkungan Supabase lokal sendiri. Jangan menaruh secret/service-role pada variabel publik atau Git. Gunakan akun staf lokal yang sudah dibuat; seed tidak membuat akun login.

Jika migration belum diterapkan, tinjau lalu jalankan:

```powershell
npx supabase migration list --local
npx supabase migration up --local
```

Jalankan seed sesuai bagian berikut, lalu:

```powershell
npm run dev
```

Buka `http://localhost:3000/login`, login, lalu klik **Lihat pelanggan** atau buka `http://localhost:3000/dashboard/customers`.

## Seed dummy tanpa reset database

[Seed](supabase/seed.sql) berisi:

| Data | Jumlah / relasi |
|---|---|
| Pelanggan dan layanan | 12 pelanggan, masing-masing 1 layanan aktif secara administrasi |
| ODC / ODP | 1 ODC, 2 ODP; distribusi layanan 10 dan 2 |
| Mapping layanan | 12 mapping versi 1, sumber MOCK |
| Identitas Telegram | 4 terverifikasi ke pelanggan dummy, 1 belum ditautkan |

**ASSUMPTION / pilihan fixture:** jumlah dan distribusi ini untuk latihan; bukan inventaris pelanggan nyata. ID `dummy-bot-upaznet` dan `dummy-sender-*` bukan ID Telegram yang bisa dipakai mengirim pesan. Verifikasi fixture tidak membuktikan kepemilikan akun nyata; penautan tester akan dibuat terpisah.

Untuk instalasi lokal proyek ini di PowerShell:

```powershell
# Pastikan nama container sesuai proyek lokal ini.
docker ps --filter name=supabase_db_Chat_Automation_Helpdesk --format '{{.Names}}'

Get-Content -Raw -Encoding utf8 supabase/seed.sql |
  docker exec -i supabase_db_Chat_Automation_Helpdesk psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres
```

- Tidak perlu `supabase db reset`; akun login dan data latihan tetap dipertahankan.
- UUID fixture tetap dan `ON CONFLICT (id) DO NOTHING`: seed bisa diulang tanpa duplikasi atau menimpa perubahan pada baris yang sudah ada.
- Seluruh seed satu transaksi. Konflik kode unik dengan ID lain membatalkan seed; periksa konflik, jangan menghapus data secara otomatis.
- `supabase/config.toml` juga mendaftarkan seed untuk pembuatan ulang database yang memang disengaja. Reset tetap menghapus data lokal, termasuk akun Auth.
- Semua pelanggan fixture awal aktif; filter “Tidak aktif” menghasilkan empty state.

## Validasi dan langkah berikutnya

```powershell
npm test
npm run test:network:local
npm run lint
npm run build
```

Pemeriksaan lokal 20 September 2026: build/lint, seed dua kali dengan checksum tetap (termasuk akun Auth), HTTP halaman dengan sesi uji sementara, filter literal/empty state, redirect tanpa sesi, penolakan baca anonim dan insert langsung staf. Akun uji dihapus sesudah pemeriksaan. Tampilan belum diverifikasi melalui browser visual otomatis.

Berikutnya: domain klasifikasi/auto-triage beserta unit test → Telegram shadow dan inbox → balasan otomatis/staf. Tiket tetap dibuat manual di Custpanel; akses OLT/NMS dan lookup pelanggan nyata masih perlu dikaji. WhatsApp menyusul setelah prototype Telegram.



Panduan commit/push pertama dan rename folder: [GIT_SETUP.md](docs/GIT_SETUP.md). Nama project_id Supabase tetap dipertahankan agar database lokal yang sama digunakan.


Validasi fondasi provider (20 September 2026): 20 unit test lolos; integrasi database dan endpoint HTTP terautentikasi lolos, termasuk skenario, constraint, RLS, seed idempoten, serta envelope/no-cache. Lint dan build produksi lolos. Hash migration lama tidak berubah dan akun Auth uji dibersihkan. Default provider dapat dicoba sesuai [panduan mock](docs/NETWORK_PROVIDER.md); UI evidence belum dibuat.

