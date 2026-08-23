# 🧪 Panduan Tes Manual — v4.9.3: Tombol X Search POS, Struk Tutup Shift Ringkas & Manager Force Close Shift

Panduan ini menguji eksekusi **ANALYSE.md bagian H (roadmap revisi AUDIT-OX)**: Wave 1a (tombol X clear search), Wave 1b (struk tutup shift ringkas + filter `!refunded`), Wave 2 (Manager Force Close Shift — Migration 31, guard konflik, anti-race audit), dan Wave 3 (realtime shift lintas device).

## 0. Persiapan

**Akun default (seed):**

| Role | Username | Password |
|---|---|---|
| Manager | `manager` | `manager123` |
| Kasir | `kasir` | `kasir123` |

- PIN Manager default: **`1234`**.
- **WAJIB**: jalankan SQL butir 16 di Supabase SQL Editor sekali (lihat `DEPLOYMENT.md §4`):
  ```sql
  ALTER TABLE shifts ADD COLUMN IF NOT EXISTS closed_by TEXT;
  ALTER TABLE shifts ADD COLUMN IF NOT EXISTS closed_by_id TEXT;
  ALTER TABLE shifts ADD COLUMN IF NOT EXISTS closed_by_role TEXT;
  ```
- Siapkan **2 device/browser profile** (Device A = Kasir, Device B = Manager) — bisa 2 browser berbeda di 1 PC.
- Pastikan keduanya online & login berbeda akun (restriksi multi-login).
- Printer thermal opsional (tes struk bisa lewat dialog print browser / preview).

> [!TIP] **Urutan tes yang disarankan**: A → B → C → D → E → F → G → H (≈ 25–35 menit). Tes H (regresi) paling penting sebelum deploy.

---

## A. Tombol 'X' Clear Search pada Search Bar POS (Wave 1a)

1. Login sebagai **Kasir** di Device A → halaman **POS**.
2. Ketik kata kunci di search bar (mis. `Lele`) → katalog terfilter.
3. Perhatikan ikon **X** muncul di sisi kanan dalam search bar.

**Hasil yang diharapkan**:
- ✅ Ikon **X hanya muncul saat search berisi teks**; hilang saat kosong.
- ✅ Klik X → search langsung **kosong**, katalog kembali menampilkan semua menu (1 klik, tanpa backspace).
- ✅ Lebar area teks input tidak tertimpa ikon (padding kanan adaptif `pr-9`).
- ✅ Ketik lagi setelah clear → X muncul kembali; filter kategori tetap bekerja normal bersama search.

---

## B. Struk Tutup Shift Ringkas + Filter Refunded (Wave 1b)

**Persiapan data shift uji** (Device A, login Kasir):
1. Buka shift (modal awal Rp200.000).
2. Buat **4 transaksi**: #1 Cash Rp20.000, #2 QRIS Rp30.000, #3 Transfer Rp15.000, #4 Cash Rp25.000.
3. **Refund transaksi #4** (Cash): Device B login Manager → Riwayat Transaksi → tombol Refund → otorisasi PIN `1234`.

**Eksekusi tutup shift**:
4. Kembali ke Device A (Kasir) → sidebar → **Tutup Shift** → input kas aktual (hitung sesuai expected) → lanjut sampai cetak ringkasan.

**Hasil yang diharapkan**:
- ✅ Struk mencetak bagian:
  ```
  --- Riwayat Transaksi ---
  QRIS      | 1 Pelanggan
  Transfer  | 1 Pelanggan
  Cash      | 1 Pelanggan
  ```
- ✅ Transaksi yang di-refund (#4) **TIDAK dihitung** — total "Pelanggan" = 3, konsisten dengan baris "Jumlah Transaksi" di atas struk (bukan 4).
- ✅ TIDAK ada lagi daftar per-nomor antrean (`#1 | Cash | Rp...` satu per satu) — hemat kertas.
- ✅ Angka keuangan tetap benar: Total Penjualan exclude refunded; baris **"Refund Tunai (dikembalikan)"** tampil; **Expected Cash & Selisih Kas tetap akurat** (netting refund — tidak double-subtract).
- ✅ Shift tertutup normal, kasir ter-logout.

> [!NOTE] Jika tidak sempat membuat refund: minimal verifikasi Σ count rekap = "Jumlah Transaksi" di struk yang sama.

---

## C. Manager Force Close Shift — Happy Path (Wave 2)

**Persiapan shift aktif**:
1. Device A login Kasir → **Buka Shift** (modal awal Rp100.000) → buat 2 transaksi apa pun metodenya. **Jangan tutup shift.**
2. Device B login **Manager** → **Laporan** → tab **Shift**.

**Verifikasi UI kartu shift aktif**:
3. Kartu kasir dengan badge **🟢 Shift Aktif** menampilkan tombol **"🔒 Tutup Paksa"** di kanan header.

**Hasil yang diharapkan**:
- ✅ Tombol hanya tampil untuk role **Manager** dan hanya pada kartu status open.
- ✅ Klik tombol → modal **"Tutup Paksa Shift"** menampilkan: nama kasir pembuka, waktu buka, Modal Awal, Total Penjualan, Jumlah Transaksi, dan **Expected Cash live** (dihitung dari data tersinkron — cocokkan dengan formula: modal awal + penjualan tunai + kas masuk − kas keluar).
- ✅ Tombol **"Lanjut — Otorisasi Manager" nonaktif** sampai kas fisik diisi.

**Eksekusi force close**:
4. Isi **Kas Aktual di Laci** dengan nominal sengaja BERBEDA dari expected cash (mis. kurang Rp5.000) → pratinjau **Selisih kas** tampil live merah.
5. Klik "Lanjut — Otorisasi Manager" → **PinModal** muncul → isi PIN salah dulu → ditolak; lalu PIN benar `1234`.

**Hasil yang diharapkan**:
- ✅ PIN salah → error tanpa efek samping.
- ✅ PIN benar → toast sukses "Shift … ditutup paksa", modal tertutup.
- ✅ Kartu shift di tab Shift berubah menjadi **🔒 Tutup Shift** dengan selisih kas tercatat.
- ✅ Indikator "Shift Aktif" di sidebar Device A **hilang otomatis tanpa refresh** (lihat tes F realtime).

---

## D. Role Gate — Kasir Tidak Melihat Tombol

1. Login sebagai **Kasir** → **Laporan** → tab **Shift** (saat ada shift aktif).
2. Perhatikan kartu shift aktif.

**Hasil yang diharapkan**:
- ✅ Tombol "Tutup Paksa" **TIDAK tampil** untuk Kasir (dan Acaraki/Staf Gudang bila punya akses laporan).
- ✅ Tidak ada jalur lain yang membuka modal force close dari role non-Manager.

---

## E. Guard Konflik — Kasir Tidak Menimpa Shift Hasil Force Close

> Skenario inti Pilar 1: shift sudah dipaksa tutup Manager, lalu kasir mencoba tutup normal.

1. Ulangi persiapan tes C (shift aktif di Device A).
2. Device B (Manager) **force close** shift tsb (tes C langkah 4–5).
3. Di Device A (Kasir), sidebar masih menampilkan shift (atau setelah refresh) → coba alur **Tutup Shift** normal: input kas aktual → lanjut sampai selesai cetak.
   - *Catatan*: jika Device A online, realtime sudah meng-clear activeShift sebelum kasir sempat menutup → alur tutup tidak tersedia; itu juga hasil yang benar. Untuk memaksa skenario, putuskan internet Device A SEBELUM Manager force close, lalu nyalakan kembali internet saat kasir akan menutup.

**Hasil yang diharapkan**:
- ✅ Muncul toast kuning: **"Shift sudah ditutup dari perangkat lain (oleh {nama Manager}) — data shift cloud dipakai."**
- ✅ Data shift lokal Device A TIDAK menimpa versi cloud (tidak ada 2 record tutup untuk shift sama).
- ✅ Kasir tetap ter-logout (escape path jalan walau konflik).
- ✅ Offline saat guard dicek (fetch gagal) → tutup shift berjalan seperti perilaku lama (tidak macet).

---

## F. Realtime Shift Lintas Device (Wave 3)

1. Dua device online, shift aktif dibuka dari Device A.
2. Device B (Manager) diam di halaman **Laporan → tab Shift** TANPA pernah refresh.
3. Dari Device A: kasir tutup shift normal.

**Hasil yang diharapkan**:
- ✅ Kartu shift di Device B berubah 🔒 **tanpa refresh** (< beberapa detik).
- ✅ Sebaliknya: buka shift baru di Device A → Device B menampilkan 🟢 Shift Aktif baru tanpa refresh.
- ✅ Force close dari Device B → indikator "Shift Aktif" di sidebar Device A hilang otomatis (loadFromCloud clear activeShift — anti ghost resurrection: shift TIDAK muncul kembali sebagai aktif).
- ✅ Tidak ada error di console kedua device; tidak ada duplikasi entri shift.

---

## G. Anti-Race Audit — Tutup Normal Selagi Modal Force Close Terbuka

> Menguji fix bug race: audit log tidak boleh mencatat force close yang tidak jalan.

1. Persiapan: shift aktif di Device A; Device B (Manager) buka modal Tutup Paksa → isi kas fisik → sampai layar **PIN** (jangan konfirmasi).
2. Di Device A: kasir **tutup shift NORMAL** sampai selesai (logout).
3. Tunggu realtime menyamakan Device B (~beberapa detik).
4. Kembali ke Device B → konfirmasi PIN.

**Hasil yang diharapkan**:
- ✅ Toast kuning: **"Shift sudah ditutup dari perangkat lain — tutup paksa dibatalkan."**
- ✅ **TIDAK ADA** entry `force_close_shift` baru di Audit Log (ini yang membedakan dari perilaku buggy).
- ✅ Record shift hanya memiliki SATU penutupan (oleh kasir), bukan tertimpa force close.

---

## H. Verifikasi Jejak Audit, Database & Regresi Alur Existing

### H.1 Audit Log
1. Device B → **Audit Log** → filter dropdown aksi → pilih **"Tutup Paksa Shift"**.
**Hasil**: ✅ Entry muncul dengan label berwarna oranye; detail memuat nama kasir pembuka, jam buka, kas fisik; metadata: `shiftId/openedBy/closingCash/expectedCash/totalSales/totalTransactions`.

### H.2 Database cloud (kolom Migration 31)
1. Supabase → Table Editor → `shifts` → baris hasil force close.
**Hasil**: ✅ Kolom `closed_by` = nama Manager, `closed_by_id` & `closed_by_role` terisi; shift tutup normal → ketiganya `null`.
**Hasil (DB lama belum ALTER)**: ✅ App jalan normal; console browser mencetak SQL Migration 31; fitur lain tidak terganggu; badge failed-ops TIDAK menumpuk (guard kolom syncShift).

### H.3 Regresi alur shift existing
- ✅ Buka shift pertama pagi hari → form modal awal muncul normal (quick amount buttons bekerja).
- ✅ Kasir kedua login saat shift aktif → modal **"Lanjutkan Shift Ini"** (kebijakan 18.3) tetap muncul dengan info kasir pembuka + modal awal — tanpa input modal ulang.
- ✅ Tutup shift normal (tanpa konflik) → expected cash & selisih benar, struk ringkas tercetak, kasir logout.
- ✅ Expected cash netral refund: refund tunai dalam shift tidak membuat expected cash minus (baris "Refund Tunai (dikembalikan)" menyeimbangkan).
- ✅ Offline: matikan internet → catat transaksi → tutup shift → berhasil seperti sebelumnya; online kembali → data sinkron.

---

## ✅ Checklist Ringkasan

| # | Tes | Pass |
|---|-----|------|
| A | Tombol X search POS (muncul/hilang/fungsi) | ☐ |
| B | Struk ringkas + count benar + refunded di-exclude + expected cash akurat | ☐ |
| C | Force close happy path (UI, PIN, selisih tercatat) | ☐ |
| D | Role gate — non-Manager tidak melihat tombol | ☐ |
| E | Guard konflik — kasir tidak menimpa shift force-closed | ☐ |
| F | Realtime lintas device (tanpa refresh, anti ghost) | ☐ |
| G | Anti-race — tidak ada audit log palsu | ☐ |
| H | Audit log + DB kolom closed_by + regresi alur shift | ☐ |

> [!NOTE] Validasi otomatis yang sudah dilakukan saat pengembangan: `npx tsc --noEmit` = 0 error · `npx vitest run` = 645/645 lolos · `npm run build` sukses. Panduan ini melengkapi dengan verifikasi perilaku runtime & lintas device.
