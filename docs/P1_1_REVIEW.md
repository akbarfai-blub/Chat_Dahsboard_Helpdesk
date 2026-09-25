# P1.1 — Identifikasi pengirim dan klasifikasi pesan

Tanggal: 21 September 2026. Status: **selesai untuk scope P1.1**, siap ditinjau Akbar. P1.2–P1.4 belum dikerjakan pada paket ini.

## Perilaku yang sudah tersedia

| Input/kondisi | Hasil |
|---|---|
| Pengirim terverifikasi, customer aktif, tepat satu layanan aktif | resolved + identityId/customerId/serviceId |
| Sender belum ada dalam database | manual / no_match; belum membuat baris baru |
| Identity ada tetapi unverified | manual / unverified, identityId tetap tersedia |
| Banyak kandidat identity atau lebih dari satu layanan | manual / identity_conflict atau multiple_services |
| Customer/layanan hilang, tidak aktif, atau relasi tidak konsisten | manual + reason spesifik; customerId/serviceId tidak dikembalikan |
| Lookup gagal / melewati deadline | manual / lookup_error atau timeout; raw error tidak dikembalikan |
| “Pak WIFI MATI” | connection_complaint; matchedKeywords: wifi mati |
| “internet lemot dan LOS” | connection_complaint; kedua keyword tercatat |
| “error” atau “wifi error” | review |
| “berapa tagihan saya?” atau “terima kasih” | other |
| “bolos”, “losmen”, “LOS123” | other; bukan kata LOS yang berdiri sendiri |
| Kosong, non-teks, atau lebih dari batas panjang | review dengan reason spesifik |

Identitas **hanya** memakai channel + channelAccountId + senderExternalId dari metadata caller. ID bersifat opaque: tidak diubah ke angka, tidak diambil dari isi chat, dan tidak dicocokkan lintas akun/channel. Mengetik kode customer lain tidak mengubah hasil lookup.

Repository melakukan satu relational SELECT menggunakan client Supabase dari caller, sehingga identity, customer, dan layanan dibaca dalam satu snapshot SQL. Tidak ada service-role client yang dibuat di kode runtime ini. Read mengikuti RLS. Dua kandidat layanan cukup untuk mengetahui bahwa pilihan tidak tunggal; layanan inactive tidak dibuang dari pemeriksaan ambiguitas.

## File implementasi

| File | Tanggung jawab |
|---|---|
| lib/domain/sender-identity.ts | Kontrak hasil dan fungsi murni resolusi identitas; versi sender-identity-v1 |
| lib/domain/message-classification.ts | Fungsi murni normalisasi/klasifikasi; versi connection-keywords-v1 |
| lib/providers/identity-lookup.ts | Port IdentityLookup dan IdentitySnapshotStore |
| lib/providers/stored-identity-lookup.ts | Deadline lookup, abort dan safe failure |
| lib/repositories/sender-identities.ts | Query identitas pada schema aktual, termasuk relasi customer/services |
| lib/application/analyze-inbound-message.ts | Menghasilkan classification + identity tanpa pemeriksaan jaringan atau pengiriman |

Hasil classification memuat category, reason, ruleVersion, normalizedText, matchedKeywords. Hasil identity memuat outcome, reason, ruleVersion, identityId, customerId, serviceId. Hasil manual selalu memiliki customerId/serviceId null.

## Default dan batas yang perlu ditinjau

- **ASSUMPTION/default:** lebih dari satu layanan, termasuk campuran active/inactive, selalu manual; tidak menebak layanan yang dikeluhkan. Customer atau satu-satunya layanan inactive juga manual.
- **ASSUMPTION/default:** timeout lookup 2 detik. Tidak ada retry otomatis atau cache identitas pada paket ini.
- **ASSUMPTION/default:** normalisasi teks NFKC, lowercase, dan penyatuan whitespace. Batas input 10.000 unit UTF-16; pesan lebih panjang masuk review tanpa dipotong.
- Lima keyword koneksi mengikuti PRD: wifi mati, internet mati, internet lemot, tidak bisa internet, LOS. Pencocokan memakai batas kata Unicode.
- **ASSUMPTION/default:** error/wifi/internet/lemot/gangguan/mati tanpa phrase koneksi lengkap masuk review. Tambahan hint ini tidak mengizinkan auto-reply.
- Matching masih literal. “Kemarin wifi mati, sekarang normal” tetap memiliki sinyal keyword komplain. Belum memahami negasi, waktu, kutipan, salah ketik atau makna percakapan. Ini bukan bukti jaringan LOS, bukan izin membalas, dan bukan pengganti validasi akurasi di SHADOW.
- Identitas resolved tidak membuktikan chat private/tester allowlist. Validasi webhook, adapter metadata, scope tester/private chat, dan pembuatan identity untuk sender baru dilakukan pada ingress P2.
- Hasil hanya dikembalikan di memori. Penyimpanan message/assessment, label koreksi staf, lifecycle, pemilihan template, claim, dan outbound menyusul. Override GENERAL kelak dievaluasi oleh decision engine; classifier tidak menghapus pesan other/review.
- Tidak ada endpoint/UI baru. Tampilan dashboard saat ini tetap sama. Tidak ada pembuatan tiket; tiket tetap manual di Custpanel.

## Verifikasi

```powershell
npm test
npm run test:identity:local
npm run lint
npm run build
```

Hasil saat penyelesaian:
- 48 unit test lolos: 28 pengujian baru P1.1 + 20 regresi fondasi jaringan.
- 7 skenario integrasi P1.1 lolos (runner melaporkan 8 termasuk test induk): resolusi nyata, isolasi account/channel, unverified/no-match, status/layanan ambigu, kode customer di chat, RLS anonim, unique constraint.
- Lint dan build lolos.
- Integrasi memerlukan Docker/Supabase lokal dengan migration aktual. Test membuat UUID fixture serta akun Auth sementara, lalu menghapus hanya data milik test. Sisa fixture/customer dan akun Auth test terverifikasi 0.
- Tidak ada migration baru, perubahan migration lama, perubahan seed, dependency baru, commit atau push.

Pengujian tersimpan di tests/domain/message-classification.test.ts, tests/domain/sender-identity.test.ts, tests/providers/identity-lookup.test.ts, dan tests/integration/identity.test.ts.

## Review sebelum P1.2

Periksa contoh kategori, keyword ambigu, serta kebijakan layanan ganda/inactive di atas. Sesudah review, paket berikutnya adalah decision engine P1.2 yang menggabungkan hasil P1.1 dengan bukti MockProvider dan memilih kandidat template beserta alasannya.
