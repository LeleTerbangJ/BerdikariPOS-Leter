# 🧪 Panduan Tes Manual — Cetak Tanpa Struk v4.7 (Prioritas 15.3)

Panduan ini memverifikasi opsi cetak per-transaksi (Prioritas 15, 15.3): kasir bisa memilih **apa yang dicetak** saat pembayaran selesai lewat **dua toggle independen** — **"Cetak struk kasir"** dan **"Cetak tiket dapur"**. Kombinasinya: cetak semua (default), **skip struk kasir saja (tiket dapur tetap keluar di awal)**, skip tiket dapur saja, atau **tidak mencetak apa pun** — lengkap dengan **anti tiket DOBEL** di dapur saat resume pending. Berlaku konsisten di **3 jalur pembayaran**: checkout normal (POS), **Split Bill**, dan **resume Pending Payment**. Ikuti urutan A → B → C → D (≈ 25–35 menit).

> **Ruang lingkup**: opsi ini hanya memengaruhi **cetak otomatis saat pembayaran selesai**. Cetak ulang struk dari halaman Transaksi (tombol cetak ulang) dan **Struk Sementara** dari daftar Pending **tetap berfungsi normal** — tidak terpengaruh.

## 0. Persiapan

- **Chrome atau Edge versi terbaru** (untuk menguji printer Bluetooth; mode Browser Print juga bisa dipakai untuk verifikasi cepat).
- **Printer thermal** kasir tersambung di **Settings → Printer** (Printer Kasir, Test Print berhasil). Opsional: 1 **printer dapur** (Bluetooth atau Browser Print) untuk memverifikasi perilaku tiket dapur.
- Login sebagai **Manager** atau **Kasir** (akun seed: `manager`/`manager123`, `kasir`/`kasir123`).
- Pastikan **auto print aktif**: Settings → Printer → **Metode Cetak** = Bluetooth (atau Browser Print) dan/atau toggle **auto print setelah checkout** ON — dua checkbox cetak hanya muncul bila salah satu aktif.
- Siapkan **3–4 item menu**, termasuk minimal 1 item dengan **target dapur** (mis. kategori `Makanan`/`Minuman` dengan printer dapur) agar perilaku tiket dapur bisa diverifikasi.

> [!NOTE] **Apa yang diuji di sini**: modal pembayaran menampilkan **dua checkbox** — **"Cetak struk kasir"** (default ✅) & **"Cetak tiket dapur"** (default ✅). Saat **keduanya nonaktif** muncul keterangan *"(tidak ada cetakan sama sekali)"*. Opsi bersifat **per transaksi** — setiap kali modal pembayaran dibuka, kembali ke default (cetak semua).

---

## A. Checkout Normal (POS)

**Tujuan**: kasir bisa memilih 3 mode — cetak semua (default), **skip struk kasir saja (tiket dapur tetap keluar)**, atau tidak mencetak apa pun.

1. **Baseline (default)**: buat pesanan 2–3 item di POS → klik **Bayar** → pastikan kedua checkbox **tercentang**.
   **Hasil yang diharapkan**: ✅ Setelah pembayaran selesai, **struk kasir tercetak** (via Bluetooth atau dialog browser) **dan tiket dapur keluar** untuk item bertarget dapur.

2. **Skip struk kasir saja** (kebutuhan utama): buat pesanan baru → **Bayar** → **kosongkan hanya** checkbox **"Cetak struk kasir"** (biarkan **"Cetak tiket dapur"** tetap tercentang).
   **Hasil yang diharapkan**: ✅ Tidak ada popup/jendela print struk yang terbuka; transaksi selesai; **struk kasir TIDAK tercetak**; **tiket dapur TETAP keluar** untuk item dapur (dapur tidak kehilangan pesanan).

3. **Tidak mencetak apa pun**: buat pesanan baru → **Bayar** → kosongkan **kedua** checkbox.
   **Hasil yang diharapkan**: ✅ Muncul keterangan **"(tidak ada cetakan sama sekali)"**; transaksi selesai tanpa cetakan apa pun — struk kasir TIDAK dan tiket dapur TIDAK.

4. **Struk saja**: buat pesanan baru → kosongkan **"Cetak tiket dapur"** saja → bayar.
   **Hasil yang diharapkan**: ✅ Struk kasir tercetak, tiket dapur tidak (opsional — kasus tepi).

5. **Reset default transaksi berikutnya**: buka transaksi baru → klik **Bayar**.
   **Hasil yang diharapkan**: ✅ Kedua checkbox **kembali tercentang** (default) — pilihan tidak "menempel" dari transaksi sebelumnya.

6. **Cetak ulang manual tetap berfungsi**: di halaman **Transaksi**, pilih transaksi yang tadi tanpa struk → klik **cetak ulang struk**.
   **Hasil yang diharapkan**: ✅ Struk bisa dicetak manual kapan pun — opsi hemat struk hanya menunda, tidak menghapus struk.

**Hasil akhir A**: ✅ Checkout normal mendukung 3 mode (semua / skip struk saja / tanpa cetakan); default kembali otomatis; reprint manual tetap ada.

---

## B. Split Bill

**Tujuan**: opsi yang sama tersedia **per sub-bill** di modal Split Bill — kasir bisa memilih cetak per sub-bill, tanpa risiko tiket dobel.

1. Buat pesanan 2–3 item (termasuk item dapur) → klik **Bayar** → klik **Split Bill**.
2. Pilih mode **"Nominal Rata" (Equal)** dengan 2 bagian (atau mode per item bila ingin menguji keduanya).
3. Di **Payment Box sub-bill 1**: pastikan kedua checkbox **tercentang** → **Bayar Sub-Bill 1**.
   **Hasil yang diharapkan**: ✅ Struk sub-bill 1 tercetak + **tiket dapur lengkap** keluar sekali (sub-bill pertama split fresh mengirim tiket dapur penuh).
4. Di **Payment Box sub-bill 2**: **kosongkan "Cetak struk kasir"** → **Bayar Sub-Bill 2**.
   **Hasil yang diharapkan**: ✅ Sub-bill 2 selesai **tanpa struk kasir**; tiket dapur TIDAK dicetak ulang (sudah keluar sekali di sub-bill 1 — tidak dobel).
5. **Skip struk di sub-bill 1 (fresh)**: buka split bill baru → di **sub-bill 1** kosongkan hanya **"Cetak struk kasir"** → Bayar Sub-Bill 1.
   **Hasil yang diharapkan**: ✅ Struk sub-bill 1 dilewati, **tiket dapur TETAP keluar** (dapur tetap dapat pesanan di awal).
6. **Split dari pending**: buat pending dengan item dapur → resume → **Split Bill**.
   **Hasil yang diharapkan**: ✅ Checkbox **"Cetak tiket dapur" TIDAK muncul** (split dari pending tidak pernah mencetak ulang tiket — sudah keluar saat Simpan Pending → anti dobel); hanya checkbox struk yang tersedia per sub-bill.
7. **Reset saat modal dibuka ulang**: tutup modal split → buka split bill baru.
   **Hasil yang diharapkan**: ✅ Kedua checkbox kembali **tercentang** (default) — tidak menempel antar sesi split.

**Hasil akhir B**: ✅ Split bill mendukung skip struk per sub-bill (tiket dapur tetap keluar di sub-bill 1 fresh); tidak ada tiket dobel; reset default setiap modal dibuka.

---

## C. Resume Pending Payment

**Tujuan**: saat melanjutkan (resume) **Pesanan Gantung (Pending)**, aplikasi **otomatis mencegah tiket dapur dobel** — tiket dapur sudah tercetak saat pesanan disimpan Pending.

1. Buat pesanan 2–3 item di POS (termasuk item dapur) → klik **Simpan Pending** (atau simpan gantung). Catat **#antrean** pesanan.
   **Hasil yang diharapkan**: ✅ Saat disimpan, **struk kasir + tiket dapur tercetak** (perilaku default) — dapur mulai menyiapkan.
2. Dari tombol **Daftar Pesanan Gantung** (atau halaman Pending Payment) → klik **Lanjutkan Pembayaran** pada pesanan itu.
   **Hasil yang diharapkan**: ✅ Pesanan dimuat kembali ke keranjang (item, tipe pesanan, meja, promo/voucher sesuai saat disimpan) dan modal pembayaran terbuka.
3. **Anti dobel tiket (item tidak berubah)**: tanpa mengubah item → perhatikan checkbox di modal.
   **Hasil yang diharapkan**: ✅ Checkbox **"Cetak tiket dapur" dalam keadaan TIDAK tercentang (default OFF)** — tiket dapur sudah tercetak saat Simpan Pending, tidak perlu ulang. "Cetak struk kasir" tetap tercentang.
4. Bayar (status **Selesai**) tanpa mengubah checkbox.
   **Hasil yang diharapkan**: ✅ Transaksi selesai & **stok terpotong benar** (deduksi delta); **struk kasir tercetak**; **tiket dapur TIDAK tercetak ulang** → **tidak ada tiket dobel di dapur**.
5. **Item berubah saat resume**: resume pending lain → **tambah/hapus item** → buka modal Bayar.
   **Hasil yang diharapkan**: ✅ Checkbox **"Cetak tiket dapur" kembali tercentang (default ON)** — dapur perlu tiket baru karena isi pesanan berubah.
6. **Skip struk saat finalize**: resume pending → kosongkan **"Cetak struk kasir"** → bayar.
   **Hasil yang diharapkan**: ✅ Struk kasir tidak tercetak; tiket dapur mengikuti default anti-dobel (tidak tercetak ulang bila item tidak berubah).
7. **Pembayaran sebagian / sisa**: buat pending lain → resume → bayar **sebagian** (sisa tetap Pending).
   **Hasil yang diharapkan**: ✅ Transaksi tersimpan dengan benar, sisa tetap tercatat Pending.

**Hasil akhir C**: ✅ Resume pending otomatis anti tiket dobel (tiket dapur default OFF saat item tidak berubah, ON saat item berubah); skip struk tetap bisa; finalisasi & stok konsisten.

---

## D. Konsistensi & Kasus Khusus

**Tujuan**: memastikan opsi tidak bocor ke jalur lain dan perilaku batas benar.

1. **Tanpa printer aktif**: matikan auto print & printer di Settings (Metode Cetak = Nonaktif) → buka modal Bayar.
   **Hasil yang diharapkan**: ✅ Kedua checkbox **TIDAK muncul** (tidak ada cetak apa pun — opsi tidak relevan).
2. **Skip struk + fallback browser**: dengan printer Bluetooth **mati** → kosongkan "Cetak struk kasir" saja → checkout.
   **Hasil yang diharapkan**: ✅ Tidak ada dialog print browser struk; **tiket dapur tetap lewat jalur fallback-nya** (bila printer dapur masih hidup); toast peringatan printer terputus tetap muncul bila relevan.
3. **Struk Sementara tidak terpengaruh**: dari **Daftar Pesanan Gantung**, klik **Struk Sementara** pada pending apa pun.
   **Hasil yang diharapkan**: ✅ Struk sementara tetap tercetak normal — opsi cetak hanya untuk cetak final saat pembayaran selesai.
4. **Pre-open window**: dengan Metode Cetak = Browser Print → kosongkan "Cetak struk kasir" → checkout.
   **Hasil yang diharapkan**: ✅ Tidak ada jendela popup kosong yang terbuka sebelum pembayaran (pre-open dilewati saat skip struk).

**Hasil akhir D**: ✅ Tidak ada kebocoran ke jalur lain; kasus batas (tanpa printer, fallback mati, struk sementara, pre-open window) semuanya benar.

---

## Ringkasan Hasil

| Tahap | Area | Status |
|---|---|---|
| A | Checkout normal: 3 mode (semua / skip struk saja / tanpa cetakan) + reset default + reprint manual | ☐ |
| B | Split bill: skip struk per sub-bill, tiket dapur tetap di sub-bill 1 fresh, checkbox dapur hilang saat split pending | ☐ |
| C | Resume pending: anti tiket dobel otomatis (dapur OFF saat item sama, ON saat item berubah) | ☐ |
| D | Konsistensi: tanpa printer (checkbox hilang), fallback mati, struk sementara, pre-open window | ☐ |

> Jika semua tahap ☐ ✅, fitur hemat struk siap digunakan. Jika ada yang gagal, catat langkah + pesan toast/error + isi Console (F12), lalu laporkan ke tim pengembangan (detail teknis di `AI-HANDOFF.md` §20 & `TO DO.md` Prioritas 15.3).

---

*Panduan lain: [`TESTING-PRADEPLOY.md`](./TESTING-PRADEPLOY.md) (verifikasi pra-deploy), [`TESTING-DEMO-SALES.md`](./TESTING-DEMO-SALES.md) (demo penjualan), [`TESTING-OPNAME.md`](./TESTING-OPNAME.md) (stock opname), [`TESTING-OFFLINE.md`](./TESTING-OFFLINE.md) (mode offline), [`TESTING-PRINTER.md`](./TESTING-PRINTER.md) (printer thermal & split printer), [`TESTING-STRUK-DIGITAL.md`](./TESTING-STRUK-DIGITAL.md) (struk WA/email).*
