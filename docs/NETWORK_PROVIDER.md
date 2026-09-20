# Pemeriksaan jaringan mock

Fondasi pemeriksaan untuk **Inbox Helpdesk + Auto-Triage + Konteks Jaringan**. Tiket, delegasi teknisi, pelaporan tiket, dan finance tetap di Custpanel; staf membuat tiket di sana secara manual. Tahap ini belum membuat inbox, auto-reply, atau integrasi channel.

## Lapisan dan kontrak

- `NetworkStatusProvider`: port pemeriksaan, tidak bergantung pada Telegram/WhatsApp.
- `MockProvider`: membaca store, mengatur deadline/abort, memisahkan bukti ONU dan upstream.
- `SupabaseMockNetworkStore`: membaca tabel menggunakan session staf/RLS; tanpa service-role di endpoint.
- `lib/domain/network-status.ts`: fungsi murni freshness dan indikasi area; tidak mengakses DB/clock sendiri.
- `inspectMockNetwork`: menetapkan waktu server, freshness 5 menit dan deadline total 2 detik. Waktu autentikasi berada di luar deadline provider ini.

Input provider: `customerId`, `serviceId`, `checkedAt`, `deadlineAt`, opsional `freshnessMs`. Caller wajib menetapkan otorisasi/identitas. Provider memverifikasi pasangan customer/service; mengetahui ID tidak membuktikan kepemilikan chat.

Output: `outcome` (ok/not_found/error), safe `reason`, source MOCK, scenarioId, checkedAt, mapping ODP/ODC beserta versi/sumber, observasi ONU, snapshot area ODP/ODC, indicatedArea, observasi upstream dan kualitas pembacaannya.

Setiap observasi memisahkan:
- `reportedStatus`: nilai asal, dapat LOS/down meskipun data basi.
- `status`: nilai layak dipakai; unknown jika bukti tidak valid.
- `quality`: fresh, unknown, stale, not_found, invalid_timestamp, timeout, provider_error, mapping_invalid.
- `observedAt`, `eventId`, source. ID pada bukti basi bukan bukti gangguan masih aktif.

`outcome=ok` berarti pemeriksaan selesai, **bukan jaringan sehat**. Kesalahan salah satu sumber tetap tampil pada kualitas komponen; bukti sumber lain dipertahankan. Tidak ada retry, diagnosis kabel putus, klaim internet normal, pemilihan template, atau pengiriman pesan.

## Schema aktual tambahan

Migration baru `20260920090000_create_mock_network_status.sql`; migration lama tidak diubah.

| Tabel | Relasi/invariant |
|---|---|
| mock_network_scenarios | PK nama skenario; mode kegagalan ONU dan upstream terpisah |
| mock_onu_status | Unik (scenario_id, service_id), FK layanan; LOS/online/unknown |
| mock_upstream_status | Unik (scenario_id, link_id); up/down/unknown; down wajib event ID |
| mock_upstream_impacts | FK upstream + FK (service_id, mapping_version) ke service_topology; dampak eksplisit |

Semua tabel: RLS aktif, authenticated SELECT saja, anon tanpa akses. Mutasi fixture hanya lewat SQL lokal yang disengaja. Tidak ada business trigger/stored procedure. File database_schema.sql tetap snapshot historis dan bukan schema aktual.

**ASSUMPTION/default prototype:**
- Anggota area adalah layanan aktif dengan mapping current yang sudah berlaku dan ODP/ODC aktif. Layanan tanpa mapping tidak dapat ditempatkan pada denominator wilayah tertentu.
- Total dihitung dari topologi, bukan hanya baris status. Paging eksplisit menghindari pemotongan diam-diam oleh batas REST.
- ≥3 LOS, ≥50% anggota valid, coverage ≥80%; pilih ODP sebelum ODC. Unknown/stale/missing tidak dihitung valid.
- Indikasi area tidak menyatakan setiap pelanggan terdampak. ONU online tetap online walaupun tetangga LOS.
- Mapping upstream harus sama versinya dengan mapping layanan saat pemeriksaan; ketidakcocokan → mapping_invalid.
- Pembacaan topologi berurutan belum merupakan snapshot transaksi lintas seluruh tabel. Perubahan mapping target yang terdeteksi menggagalkan pemeriksaan. Fixture tidak diedit bersamaan dengan uji; sebelum data produksi, snapshot konsisten perlu ditinjau.

## Menyiapkan dan mencoba

Aktifkan hanya pada environment prototype: `NETWORK_PROVIDER=mock` dalam .env.local, lalu restart aplikasi. Tanpa konfigurasi ini endpoint menjawab 503 PROVIDER_DISABLED.

Dengan Docker/Supabase lokal hidup:

```powershell
npx supabase migration up --local
Get-Content -Raw -Encoding utf8 supabase/fixtures/network.sql |
  docker exec -i supabase_db_Chat_Automation_Helpdesk psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres
```

Seed dasar `supabase/seed.sql` harus sudah ada. Seed jaringan memakai key/ID tetap dan DO NOTHING; menjalankannya ulang tidak menyegarkan timestamp atau mengganti perubahan latihan.

Untuk memulai jendela uji fresh lagi, **jalankan eksplisit**:

```powershell
Get-Content -Raw -Encoding utf8 supabase/fixtures/refresh-network-observations.sql |
  docker exec -i supabase_db_Chat_Automation_Helpdesk psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres
```

Perintah ini hanya memperbarui waktu observasi skenario bernama di file; mempertahankan status/event dan akun Auth. Skenario stale tetap -10 menit, future +10 menit, missing timestamp tetap null. Setelah 5 menit, data yang tadinya fresh akan menjadi stale. Tidak ada refresh otomatis saat GET.

Sesudah login, buka:
`/api/network-status?customerId=10000000-0000-4000-8000-000000000001&serviceId=20000000-0000-4000-8000-000000000001&scenario=los_area`

Endpoint GET read-only, khusus staf, tidak di-cache. Selalu envelope `{success,data,error}`; 401 belum login, 400 input invalid, 404 service/scenario tidak ditemukan, 502 provider error, 504 provider timeout. Pada kegagalan pemeriksaan, data dapat berisi snapshot kegagalan untuk diagnosis staf, tanpa raw error/secret. Waktu evaluasi dan deadline tidak dapat dipasok lewat URL.

Halaman Pelanggan belum dihubungkan ke endpoint; label “belum diperiksa” tetap sesuai keadaan UI. Panel evidence menyusul bersama konteks inbox.

## Skenario dan hasil yang diharapkan

Gunakan customer/service 001 kecuali disebut lain.

| Skenario | Bukti yang diharapkan ketika fresh |
|---|---|
| normal | ONU online, upstream up |
| los_individual | 1/10 LOS pada ODP; area tidak terindikasi |
| los_area | 4 LOS/8 valid/10 total, ODP terindikasi |
| low_coverage | 4 LOS/6 valid/10 total, area unknown |
| upstream_down | ONU online; link down dengan 10 affected services |
| stale / unknown / missing_status | Quality stale / unknown / not_found |
| future_timestamp / missing_timestamp | invalid_timestamp |
| provider_error / timeout | Monitoring gagal; tidak berarti jaringan down |
| onu_error_upstream_down | ONU provider_error, upstream down tetap valid |
| upstream_error_los | Upstream provider_error, ONU LOS tetap valid |
| recovered | Upstream up dengan ID kejadian yang sama |
| new_event | Down dengan ID kejadian baru |

Layanan 011/012 bukan anggota impact link dummy; tidak mendapat klaim upstream down. Stable event ID hanya fixture; korelasi event produksi belum diimplementasikan. Skenario tersimpan berdampingan, pemilihan skenario pada GET tidak mengubah mode global.

## Pengujian

```powershell
npm test
npm run test:network:local
npm run lint
npm run build
```

Unit test memakai Node test runner + kompilasi TypeScript terpisah, tanpa DB/dependency baru. Integrasi membutuhkan fixture dasar/jaringan di Supabase lokal; membuat dan menghapus akun Auth sementara, memverifikasi constraints, privilege, dan idempotensi. Tidak melakukan reset. Evaluasi provider integration memakai waktu observasi fixture normal, sehingga test bisa diulang tanpa refresh timestamp.

Untuk turut menguji endpoint, jalankan aplikasi dengan NETWORK_PROVIDER=mock di terminal pertama; terminal kedua:

```powershell
$env:NETWORK_TEST_BASE_URL='http://localhost:3000'
npm run test:network:local
Remove-Item Env:NETWORK_TEST_BASE_URL
```
