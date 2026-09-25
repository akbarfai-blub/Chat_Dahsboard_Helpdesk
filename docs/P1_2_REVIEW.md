# P1.2 — Decision engine kandidat template

Tanggal: 21 September 2026. Status: **selesai untuk scope P1.2**. P1.3 lifecycle dan P1.4 transaksi/claim belum selesai.

## Yang dibangun

| File | Fungsi |
|---|---|
| lib/domain/triage-contracts.ts | Kontrak input bukti, incident, mode, template key, dan hasil keputusan |
| lib/domain/triage-decision.ts | Fungsi murni decideTriage: prioritas, validasi ulang bukti dan penerapan mode |
| tests/domain/triage-decision.test.ts | 28 pengujian baru untuk prioritas, scope, waktu, event dan mode |
| tests/integration/triage.test.ts | Komposisi P1.1 + repository identitas + MockProvider + decision engine melalui Supabase lokal |
| package.json | Perintah test:triage:local |

PRD, README, CLAUDE dan decision log D74 diperbarui. Tidak ada migration, perubahan seed, dependency, endpoint atau UI baru pada paket ini. Tiket tetap manual di Custpanel.

## Input dan hasil

Input: evaluatedAt dari caller, classification P1.1, identity P1.1, network snapshot, daftar snapshot incident manual, mode, dan emergencyStop. Domain memiliki kontrak bukti sendiri; hasil NetworkCheckResult kompatibel secara struktur tanpa domain mengimpor provider/vendor.

Hasil:
- ruleVersion = triage-priority-v1, evaluatedAt, outcome candidate/review, reason.
- candidateTemplateKey: kandidat berdasarkan bukti.
- effectiveTemplateKey: key setelah aturan mode.
- evidence: referensi incident/versi, mapping, ONU/upstream, dan aggregate area yang dipilih.
- incidentId dan eventIds yang diketahui; ID kejadian tidak dikarang.
- notes: kode alasan tambahan, tanpa raw error/provider secret.
- automation: mode, blockedReasons dan disposition.
- **dispatchAuthorized selalu false**: keputusan belum mengotorisasi pengiriman.

Contoh pelanggan online dalam LOS_AND_GENERIC:

```json
{
  "candidateTemplateKey": "ONLINE_CHECK",
  "effectiveTemplateKey": "GENERIC",
  "reason": "online",
  "automation": {
    "mode": "LOS_AND_GENERIC",
    "disposition": "pending_delivery_checks",
    "blockedReasons": []
  },
  "dispatchAuthorized": false
}
```

Hasil tidak memuat teks balasan aktual. Render template, override versi template, prefix simulasi, validasi placeholder dan penyimpanan snapshot pesan adalah tahap berikutnya.

## Urutan keputusan

| Kondisi | Kandidat |
|---|---|
| Satu GENERAL ACTIVE valid | MASS_GENERAL; tidak mengakses classification/identity/network |
| Selain GENERAL: pesan bukan komplain koneksi | Review tanpa kandidat |
| Komplain dengan identitas unresolved | GENERIC |
| AREA_SPECIFIC ACTIVE, mapping valid dan wilayah cocok | MASS_AREA |
| Upstream down fresh dengan mapping dampak valid | NETWORK_DISRUPTION |
| ONU pelanggan LOS fresh dan area memenuhi threshold | LOS_AREA |
| ONU pelanggan LOS fresh, area tidak cukup | LOS_INDIVIDUAL |
| ONU pelanggan online fresh | ONLINE_CHECK |
| Bukti tidak ditemukan/gagal/basi/unknown | GENERIC |

GENERAL adalah satu-satunya pengecualian keyword sesuai PRD §4/§7. AREA tidak membalas pesan other/review. AREA no-match/gagal mapping tidak menghalangi fallback otomatis yang memiliki bukti independen.

## Pemeriksaan bukti

- Snapshot jaringan harus milik customer/service yang teridentifikasi. Snapshot salah pelanggan/layanan atau waktu cek invalid/future → GENERIC.
- Freshness observasi dihitung ulang saat keputusan, maksimal 5 menit, inklusif. Flag fresh dari pemeriksaan lama tidak cukup. observedAt tidak boleh melebihi checkedAt/evaluatedAt.
- Status efektif dan reportedStatus harus konsisten. Quality gagal/basi/unknown tidak dipromosikan menjadi fresh.
- Mapping harus untuk layanan yang sama, berversi positif, sudah berlaku ketika dicek, memiliki ODP/ODC/sumber, serta usia snapshot ≤24 jam. Ini TTL mapping, bukan TTL observasi.
- Upstream membutuhkan link ID, event ID eksplisit dan mapping version yang sama. Semua event dari bukti upstream down yang valid dipertahankan untuk kebutuhan assessment/claim selanjutnya.
- Area hanya untuk scope ODP/ODC pelanggan, keanggotaan lengkap sesuai total, target service/version konsisten, serta threshold version yang dikenali.
- Coverage/rasio/LOS dihitung ulang dari anggota unik yang masih fresh; tidak mempercayai angka aggregate/state lama saja.
- ≥3 LOS, ≥50% valid, coverage ≥80%; pilih ODP sebelum ODC.
- ONU pelanggan harus LOS fresh untuk LOS_AREA. Tetangga LOS tidak membuat pelanggan online dianggap LOS.
- Bukti ONU dan upstream independen. ONU basi/gagal tidak membatalkan upstream valid; upstream gagal tidak membatalkan ONU valid.
- Event target LOS yang diketahui tetap tercatat. Event area hanya ditautkan bila seluruh LOS valid memiliki event eksplisit yang sama; jika tidak, area.eventId null. Tidak ada korelasi event produksi/hysteresis.

## Mode dan batas otorisasi

| Mode/kondisi | Hasil |
|---|---|
| Mode tidak diberikan | Default SHADOW |
| SHADOW | Kandidat tetap dihitung, automation blocked, tanpa claim |
| LOS_AND_GENERIC | ONLINE_CHECK turun ke GENERIC; kandidat lain tetap |
| FULL | Kandidat online dapat tetap ONLINE_CHECK |
| Emergency stop | Kandidat diagnosis tetap ada, automation blocked |
| Mode/waktu evaluasi invalid | Review tanpa kandidat |

**DEFAULT/ASSUMPTION:** lebih dari satu incident ACTIVE, atau snapshot incident ACTIVE tidak valid, menghasilkan review tanpa kandidat. Data incident manual pada P1.2 berupa input/fixture, bukan CRUD incident.

**Kontrak caller:** input merupakan snapshot internal yang telah dibaca/diotorisasi oleh application layer, bukan payload pelanggan langsung. Engine tidak mengecek webhook, tester/private chat atau otorisasi endpoint. Tidak ada I/O/clock tersembunyi.

**Pending delivery checks** masih membutuhkan penyimpanan ingress/episode/assessment/handoff, pemeriksaan follow-up/takeover staf, mode pada penerimaan dan saat dispatch (tanpa backlog replay), state incident terkini, template valid, serta klaim atomik. Fitur-fitur tersebut belum diselesaikan oleh P1.2; hasil ini tidak boleh langsung diteruskan ke adapter pengiriman.

## Pengujian dan cara review

```powershell
npm test
npm run test:triage:local
npm run lint
npm run build
```

Hasil: 76 unit test lolos (48 sebelumnya + 28 P1.2), 17 skenario integrasi lolos (18 test termasuk induk), lint/build lolos. Integrasi mencakup 16 fixture jaringan pada SHADOW/LOS_AND_GENERIC/FULL dan pengirim unverified. Akun Auth uji sementara sudah dihapus, sisa 0.

Integrasi membutuhkan Docker/Supabase lokal serta seed identitas/jaringan yang sudah ada. Evaluasi menggunakan waktu observasi fixture normal agar repeatable; tidak merefresh atau mengubah fixture jaringan.

Prioritas review: online di area LOS, kegagalan parsial sumber, GENERAL tanpa lookup, AREA untuk komplain saja, downgrade online pada LOS_AND_GENERIC, serta dispatchAuthorized=false. Perilaku dashboard masih sama; pemeriksaan ini baru domain dan pengujiannya.

Langkah berikutnya P1.3: lifecycle episode serta penghentian first response saat staf mengambil alih.
