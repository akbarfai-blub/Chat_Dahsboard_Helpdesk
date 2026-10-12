# Catatan checkpoint dan tindak lanjut P2.10

Tanggal catatan: 13 Oktober 2026 (Asia/Jakarta).

Catatan ini merangkum review lanjutan setelah laporan persiapan P2.10. Ini bukan bukti deployment atau hasil pengujian baru. Klaim kesiapan tooling dalam `P2_10_REVIEW.md`, `DEPLOYMENT.md`, dan D143 perlu dibaca bersama temuan di bawah sampai dokumentasinya diselaraskan pada pekerjaan perbaikan.

## Status yang dibawa ke sesi berikutnya

- P2.7 dan P2.8: **Done**, berdasarkan penerimaan dan bukti sebelumnya. Jangan membuka ulang tanpa perubahan atau bukti masalah baru.
- P2.9: tetap **Done** sesuai tracker.
- P2.10: **In Progress**. Persiapan lokal tersedia, tetapi ada enam temuan tooling yang belum diperbaiki, target remote belum dihubungkan, dan deployment serta smoke test remote belum terverifikasi.
- P2.11: **Not Started**, menunggu P2.10.

Branch checkpoint menyimpan kemajuan pekerjaan; keberadaan commit/push bukan penerimaan P2.10, izin menjalankan script yang bermasalah ke database remote, atau bukti deployment.

## Enam temuan review yang masih terbuka

| Prioritas | Temuan | Lokasi dan perbaikan yang diperlukan |
|---|---|---|
| P1 | Smoke test dapat PASS tanpa pemeriksaan wajib | `scripts/smoke-test-deployment.mjs`: login hanya mengisi `pass: true` tanpa autentikasi nyata; CLI tidak memasok kredensial; ketiadaan DB dapat dianggap berhasil; status job dan keberadaan pesan tidak menentukan hasil. Jalankan login/inbox/logout nyata, wajibkan bukti DB dan pemrosesan, serta cegah pemeriksaan yang tidak dijalankan menghasilkan keseluruhan PASS. |
| P1 | Validasi TLS remote lebih lemah daripada runtime aplikasi | `scripts/apply-prototype-migrations.mjs`, `scripts/apply-prototype-seed.mjs`, dan `scripts/smoke-test-deployment.mjs`: tolak koneksi remote yang tidak memenuhi aturan `sslmode=verify-full` milik `lib/postgres/server.ts`; jangan memakai fallback tanpa verifikasi sertifikat. |
| P2 | Kueri smoke test menggunakan kolom yang tidak ada | `scripts/smoke-test-deployment.mjs`: sesuaikan kueri dengan migration aktual, termasuk identitas ingress, `attempt_count`, relasi pesan, intent, dan primary key komposit claim. Korelasikan hasil ke pesan/ingress pengujian secara tepat, bukan substring atau semua record dalam dua menit terakhir. |
| P2 | Schema dan pencatatan versi migration belum satu transaksi | `scripts/apply-prototype-migrations.mjs`: file SQL sudah memiliki `BEGIN/COMMIT`; pembungkus transaksi runner tidak membuat transaksi bersarang. Pastikan perubahan schema dan pencatatan versi atomik. Buktikan rollback bila pencatatan versi gagal, tanpa mengedit migration lama yang sudah diterapkan. |
| P2 | Penolakan Telegram tidak menghasilkan exit gagal | `scripts/manage-telegram-webhook.mjs`: respons `ok: false` pada set/restore harus menghasilkan kegagalan eksplisit dan exit nonzero. Verifikasi konfigurasi aktual setelah pemasangan; jangan menganggap respons JSON yang berhasil dibaca sebagai pemasangan yang berhasil. |
| P2 | SHADOW belum diwajibkan sebelum memasukkan pesan uji | `scripts/apply-prototype-seed.mjs` hanya mencetak mode existing, sedangkan smoke test memeriksa mode setelah POST. Periksa mode sebelum pengujian yang memasukkan pesan dan jangan melaporkan seed menjamin SHADOW apabila tidak memverifikasinya. |

## Batas bukti yang tersedia

- Laporan eksekutor mencatat build lokal `uCRy779fnf8FFKoi4n9bz`, unit test aplikasi 305/305 PASS, penerapan enam migration lokal yang tertunda, eksekusi ulang migration no-op, seed lokal, dan pembacaan status bot/webhook Telegram.
- Build manifest mencakup 26 berkas sumber aplikasi; empat script deployment baru tidak termasuk cakupannya.
- Build dan unit test aplikasi tersebut tidak membuktikan kebenaran empat script deployment baru. Eksekusi migration yang berhasil juga belum membuktikan rollback schema dan pencatatan versi secara atomik.
- Smoke test mengirim payload HTTP simulasi. Hasilnya kelak harus dibedakan dari pesan yang benar-benar dikirim melalui akun Telegram tester.
- Menurut laporan eksekutor, Vercel CLI belum login dan target Supabase remote belum terhubung. Ketersediaan akses harus diperiksa kembali pada sesi eksekusi berikutnya tanpa menampilkan secret.
- Review lanjutan dilakukan dengan membaca laporan, script, migration, dan dokumentasi; tidak menjalankan ulang tes atau mengakses deployment.

## Urutan kelanjutan

1. Perbaiki enam temuan di atas dan tambahkan bukti terarah pada lingkungan terisolasi. Prioritaskan kegagalan yang harus menolak PASS, kecocokan schema, transaksi migration, validasi TLS, dan respons gagal Telegram.
2. Selaraskan panduan deployment dan laporan dengan perilaku serta pengujian aktual. Koreksi keputusan historis melalui entri decision log baru dengan ID berikutnya; jangan mengubah D143 atau histori sebelumnya.
3. Identifikasi target prototype Supabase/Vercel, konfigurasi environment melalui saluran rahasia yang sesuai, lalu lakukan deployment dan pemasangan webhook setelah persiapan siap.
4. Catat smoke test deployment nyata, termasuk autentikasi staf, webhook, pemrosesan job, SHADOW, serta ketiadaan outbound otomatis dan claim debounce yang disebabkan pesan uji.
5. Rekomendasikan P2.10 Done hanya setelah acceptance criteria memiliki bukti konkret. Setelah itu lanjutkan P2.11 sesuai tracker.

## Isi checkpoint repository

- Sertakan implementasi P2.7/P2.8, migration, pengujian, dokumentasi, dan bukti yang sudah tersedia.
- Sertakan persiapan P2.10 sebagai pekerjaan yang belum selesai beserta catatan ini.
- File sementara `scratch/`, environment rahasia, metadata runtime lokal, dan hasil build tidak diperlukan dalam commit checkpoint.
- Commit dan push dilakukan manual oleh pengguna sesuai AGENTS.md. Catatan ini tidak menyatakan commit atau push sudah dilakukan.
