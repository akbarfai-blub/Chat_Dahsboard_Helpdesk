# P1.3 — Kontrak lifecycle episode

Revisi 22 September 2026, rule `episode-lifecycle-v2`. Implementasi domain dan kode test telah diperbarui. **Test, lint, typecheck, dan build belum dijalankan pada revisi ini**, sesuai instruksi pengguna. Hasil pengujian revisi sebelumnya bukan bukti untuk kode ini.

## Struktur

- `lib/domain/episode-contracts.ts`: snapshot, input command, association, hasil perubahan dan audit.
- `lib/domain/episode-lifecycle.ts`: aturan murni tanpa database, channel, session, atau clock global.
- `tests/domain/episode-lifecycle.test.ts`: skenario regresi yang dapat dijalankan pengguna.

Komentar di kode menjelaskan batas kepercayaan dan alasan kebijakan; rincian integrasi berada di dokumen ini.

## Kontrak yang berubah

Aksi staf menerima `command` berisi `actor: { kind: "staff", staffId }`, `expectedVersion`, dan `at`. Resolve menambahkan `resolutionNote`, split menambahkan `splitReason`. Contoh:

```typescript
const result = resolveEpisode(snapshot, {
  actor: { kind: "staff", staffId: sessionUserId },
  expectedVersion: request.expectedVersion,
  at: serverTimestamp,
  resolutionNote: request.resolutionNote,
});
```

Jangan mengganti versi request dengan versi snapshot terbaru. Versi harus integer positif; ketidakcocokan menghasilkan `version_mismatch`, termasuk split. Timestamp harus ISO dengan timezone dan tanggal kalender valid; output audit dinormalisasi UTC.

Hasil aksi dibedakan menjadi `accepted`, `noop`, dan `rejected`. Hanya `accepted` membawa perubahan serta audit. `noop` tidak menaikkan versi atau menulis audit perubahan status. Pengulangan resolve tidak mengganti catatan resolusi terdahulu. Tidak ada claim/debounce dalam patch lifecycle, sehingga reopen tidak menghapus claim lama.

Snapshot sekarang mempunyai `isPrimary` dan `closedAt`. `closedAt` wajib valid untuk CLOSED, null untuk status lainnya. Association menerima satu object: classification, identity, existingEpisodes, optional triageDecision dan targetEpisodeId. Kandidat GENERAL berasal dari kontrak P1.2; SHADOW tetap boleh membentuk episode tanpa mengizinkan pengiriman.

## Association dan identitas

Application layer harus memasok seluruh kandidat relevan untuk layanan **dan identitas sender**, termasuk episode identity_only sebelum penautan. Membaca hanya service_id akan menyembunyikan konflik yang perlu direkonsiliasi.

| Kondisi | Keputusan |
|---|---|
| Tidak ada kandidat dan inbound eligible | Intent episode NEW, category connection_complaint atau other untuk GENERAL |
| Satu kandidat NEW/IN_PROGRESS | Attach pada episode tersebut |
| Beberapa kandidat terbuka, tepat satu primary | Attach pada primary |
| Ada kandidat terbuka dan RESOLVED, atau beberapa RESOLVED | Review kecuali target eksplisit diberikan |
| Keluhan pada RESOLVED | Reopen hanya jika target masalah sama dikonfirmasi oleh application layer |
| Non-komplain GENERAL pada satu RESOLVED | Attach tanpa reopen atau membuat episode penerimaan baru |
| Pesan ambigu/lainnya tanpa GENERAL | Review staf, tidak mengirim otomatis |
| Identity null tanpa ID stabil | Review; provisioning identitas dilakukan application layer |
| Identitas sama tetapi scope berbeda | Review identity_reconciliation_required sebelum membuat episode baru |
| Hanya CLOSED | Episode baru dengan previousEpisodeId berdasarkan closedAt terbaru |

`targetEpisodeId` adalah pilihan terpercaya dari konteks penanganan/staf, bukan ID dari teks pelanggan atau parameter browser yang belum diotorisasi. Untuk reopen, pilihan ini juga menyatakan masalah yang sama. Keyword saja tidak cukup membuktikan kesamaan masalah. Ini default konservatif, bukan implementasi semantic matching.

Scope berbeda tidak digabung. Kandidat dari sender/layanan lain tidak dipilih. Penautan, downgrade identitas, atau perpindahan layanan yang terdeteksi memerlukan rekonsiliasi; tidak otomatis memigrasikan scope ataupun claim. Riwayat CLOSED juga diperiksa agar claim lama tidak terlewat. Jika closedAt sama, ID dibandingkan secara leksikal sebagai tie-break deterministik, bukan penentu usia.

## Aksi staf dan inbound

`startHandling`, `resolveEpisode`, `reopenEpisode`, `closeEpisode`, dan `recordManualReply` menerima aktor staf dari session server. Reopen staf tidak memerlukan keyword. Resolve manual mensyaratkan catatan, close hanya dari RESOLVED. Event pulih/ONU online tidak mempunyai jalur transisi otomatis.

`reopenEpisodeFromInbound` menerima messageId internal, waktu, expectedVersion, dan input association. Fungsi mengevaluasi ulang association menggunakan snapshot target terkini. Audit menggunakan aktor inbound dengan messageId/identityId, tanpa mengarang staf. Reopen inbound mempertahankan suppression; reopen oleh staf mengaktifkannya sebagai tindakan penanganan.

`recordManualReply` hanya menghasilkan intent pengambilalihan. Penyimpanan pesan manual, dedup request, dan pengiriman tetap pekerjaan integrasi berikutnya. `noop` dari helper ini bukan alasan membuang balasan manual baru: no-op hanya berlaku pada perubahan lifecycle.

Default tambahan: tindakan staf resolve/close dan split menonaktifkan first response otomatis yang tertunda. Episode split dimulai NEW, bukan primary, dan automationSuppressed=true karena masalah tersebut telah disentuh staf. Source tidak diubah; relasi split, versi sumber, aktor, waktu dan alasan diberikan untuk transaksi P1.4. Tidak ada pemindahan histori otomatis. Jika primary ditutup sementara child masih terbuka, penentuan/promosi primary berikutnya harus eksplisit di application layer.

`classifyMessageOnEpisode` memisahkan posisi pesan (`isFollowUp`) dari suppression. Kandidat first response hanya pesan pertama pada NEW tanpa suppression. Input posisi pesan berasal dari penyimpanan, bukan urutan eksekusi job. Retry pesan pertama tetap pesan pertama; follow-up tidak membatalkan pekerjaan pertama. Semua hasil tetap `dispatchAuthorized=false`. Suppression tidak membuktikan request in-flight berhasil dibatalkan.

## Tanggung jawab P1.4

Implementasi dan langkah verifikasi tersedia di [review P1.4](P1_4_REVIEW.md); migration dan test belum dijalankan oleh agent.

1. Migration episode, primary per scope, timestamp, relasi, claim, serta audit dengan FK/check/unique yang sesuai.
2. Pembuatan episode NEW dengan ID/versi awal, pemilihan primary, dan association pesan secara atomik; hasil domain bukan jaminan tidak ada episode ganda.
3. Conditional update memakai expectedVersion, kenaikan versi, serta audit dalam satu transaksi. Split memeriksa versi sumber walaupun source tidak berubah.
4. Rekonsiliasi scope identitas dan claim episode/event tanpa memberi jatah baru. Gunakan mapping identitas yang sah; jangan menghapus claim.
5. Penetapan target masalah oleh konteks yang tervalidasi; guard mode, follow-up, claim, dan dispatch tetap diperlukan.
6. Takeover, penyimpanan balasan manual, serta pembatalan pending dijalankan atomik; in-flight dilaporkan sesuai hasil sebenarnya.

## Langkah verifikasi oleh pengguna

Jalankan dari root proyek, satu per satu. Tidak perlu database/Docker untuk unit test ini.

```powershell
# 1. Kompilasi test dan jalankan suite lifecycle saja.
npx tsc -p tsconfig.test.json
node --test .test-build/tests/domain/episode-lifecycle.test.js

# 2. Seluruh unit test domain/provider untuk memeriksa regresi P1.1/P1.2.
npm test

# 3. Pemeriksaan kode dan build aplikasi.
npm run lint
npm run build
```

Lanjutkan ke perintah berikutnya setelah perintah sebelumnya berhasil. Jika build membutuhkan konfigurasi environment, gunakan konfigurasi lokal proyek yang sudah ada. Jangan reset database. Tidak ada klaim jumlah test lolos sampai pengguna menjalankannya.

Perhatikan skenario identitas sebelum/sesudah verifikasi, mixed open/resolved setelah split, versi stale, urutan closedAt berbeda dari version, actor inbound, timestamp invalid, noop tanpa audit, dan suppression setelah staf menangani. Constraint/concurrency database belum dapat dibuktikan oleh suite domain; pengujian tersebut mengikuti implementasi P1.4.
