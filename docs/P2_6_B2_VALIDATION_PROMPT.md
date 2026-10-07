# Prompt Antigravity — Validasi koreksi B2 P2.6 Tahap 1

Lakukan validasi terarah pada koreksi B2 proyek Upaznet Helpdesk Automation yang telah ditulis Codex (D114). Baca AGENTS.md, docs/PRD.md, bagian P2.6 di docs/TRACKER.md, dan D114 di docs/decision-log.md. Kode terbaru belum menjalankan test, lint, typecheck, build, atau integrasi.

Koreksi A dan B1 tetap baseline yang diterima. Fokus hanya pada empat temuan: pengurutan SELECT terluar, overflow pagination, bukti AC 14–15, serta kesesuaian dokumentasi dengan kontrak. Jangan memulai UI Inbox, refactor lain, atau mengulang seluruh suite tanpa dampak baru.

## 1. Pemeriksaan statis dan unit terarah

Periksa file berikut serta perubahan yang terkait D114; jangan menganggap seluruh working tree sebagai hasil koreksi ini:

- lib/application/inbox-contracts.ts
- lib/application/inbox-service.ts
- tests/application/inbox-service.test.ts
- tests/integration/inbox.test.ts — tambahan ID fixture AC 2 dan koreksi AC 14–15
- docs/P2_6_STAGE1_REVIEW.md, docs/TRACKER.md, dan D114 pada decision-log

Jalankan dari root repo, berurutan; lanjutkan eksekusi unit hanya jika kompilasi berhasil agar tidak memakai build lama:

```powershell
npx tsc -p tsconfig.test.json
node --conditions=react-server --test .test-build/tests/application/inbox-service.test.js
npx eslint lib/application/inbox-contracts.ts lib/application/inbox-service.ts tests/application/inbox-service.test.ts tests/integration/inbox.test.ts
```

Pastikan bukti unit menutup:

- Page tidak aman, angka yang menjadi Infinity, dan page aman dengan offset overflow ditolak parser.
- Boundary page yang masih menghasilkan offset aman diterima untuk limit 25 dan limit 1.
- Service langsung menolak NaN/Infinity/pecahan/angka di luar batas dengan `InboxError("INVALID_PARAMETER")`, status 400, tanpa SQL.
- Route mengembalikan 400 `{ success: false, data: null, error: { code: "INVALID_PARAMETER", message } }` sebelum `getPool()` dipanggil.
- ORDER BY ada di SELECT terluar setelah LEFT JOIN, bukan hanya CTE pemilih halaman. Tinjau sumber SQL; hasil satu rencana eksekusi saja tidak membuktikan jaminan urutan.

## 2. Integrasi pada lingkungan tes yang telah diterima

Gunakan .env.test dan Supabase lokal khusus `Chat_Automation_Helpdesk_Test`, PostgreSQL 54332/API 54331. Guard `requireIsolatedDatabase` wajib membuktikan marker PostgreSQL dan API cocok sebelum mutasi fixture. Jangan mencetak credential atau token marker. Jangan memakai database pengguna (5432/54322/API 54321), scenario bawaan sebagai marker, reset database, atau mengubah migration yang sudah diaplikasikan.

```powershell
npm run test:inbox:local
```

Tidak perlu menjalankan ulang suite migration, worker, persistence, atau seluruh unit: auth/RLS, migration, lease, dan baseline B1 tidak berubah. Bila lingkungan tes belum tersedia atau guard gagal, tetap selesaikan pemeriksaan statis/unit/lint; laporkan integrasi pending, jangan mengganti target database.

Periksa assertion dan hasil konkret berikut:

1. **AC 14 — Detail**: writer berada di barrier sebelum commit saat reader mengeksekusi SQL nyata. Writer commit sesudah hasil SELECT pertama diperoleh tetapi sebelum rows dikembalikan ke service. Respons tersebut tetap memiliki kedua ID fixture, seluruh `isRead=false`, unreadCount 2. Pembacaan berikutnya harus unreadCount 1 dengan hanya ID pertama dibaca. Service memakai tepat satu statement.
2. **AC 14 — List**: saat read-ack pesan kedua ditahan, list berfilter tag unik + `unread=true` memperoleh count 1 dan item ID percakapan yang sama. Setelah commit, pembacaan baru memperoleh count 0 dan items kosong. Count/item yang diambil sebelum commit harus tetap konsisten; service memakai satu statement.
3. **Lifecycle AC 14**: controlled reader failure sebelum SELECT harus diteruskan sebagai error asli. Writer barrier dilepas di finally, promise riil settled sebelum koneksi sehat dikembalikan, timer dibersihkan; jika settlement timeout, koneksi aktif dibatalkan/destroy dan kegagalan cleanup dilaporkan. Inbound ketiga diuji sebagai before/after terpisah, jangan menyebutnya bukti overlap inbound.
4. **AC 15**: tepat 28 ID fixture; halaman 10/10/8 dengan count 28 dan totalPages 3. Gabungan ID identik dengan seluruh fixture dan setiap ID muncul tepat sekali. Timestamp sama menguji UUID DESC lintas batas halaman; pengulangan setiap halaman mengembalikan ID yang sama. Halaman jauh kosong mempertahankan count 28; pencarian tanpa hasil menghasilkan count 0, totalPages 0, items kosong.
5. **Fixture dan cleanup**: identity fixture AC 14 dicatat sebelum receive(), graph diproses melalui HelpdeskPersistence.process(), dan teardown terbatas milik run tetap berjalan. Jangan melemahkan assertion preservasi/cleanup yang sudah ada.

## 3. Hasil dan dokumentasi

Laporkan perintah aktual, exit code, jumlah passed/failed/skipped, assertion kunci, dan versi kode yang diuji. Sertakan hasil gagal pertama dan koreksi minimal bila ada. Jika perlu memperbaiki kegagalan, batasi pada scope D114 dan ulangi hanya pemeriksaan yang terdampak; jangan melonggarkan assertion agar hijau.

Selaraskan docs/P2_6_STAGE1_REVIEW.md dan docs/TRACKER.md dengan hasil versi terakhir. Jangan menyalin angka historis 228/33/7 sebagai hasil baru. Decision log append-only; tambahkan ID berikutnya hanya jika ada keputusan/perubahan perilaku baru atau rekonsiliasi status yang perlu dicatat, tanpa mengubah D113/D114.

Gunakan kontrak aktual: status `active`/`closed`, field `sender`, `lastMessage`, `latestEpisode`, serta envelope `{ success, data, error }`. Dataset AC 15 adalah 28 percakapan, limit 10; bukan 60 item. Bedakan contoh bentuk JSON, pemanggilan handler langsung dengan stub sesi, dan HTTP/browser E2E.

B2 hanya boleh Done bila validasi terarah dan integrasi relevan lulus untuk kode terakhir. Jika integrasi pending/gagal, B2 tetap In Progress dengan alasan spesifik. P2.6 tetap In Progress karena UI Inbox/polling belum dikerjakan. Jangan menjalankan git add/commit/push/tag/deploy.
