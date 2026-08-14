# 🧪 Panduan Tes Manual — Cetak Tanpa Struk v4.7 (Prioritas 15.3)

Panduan ini memverifikasi opsi **"Cetak Tanpa Struk"** (Prioritas 15, 15.3): kasir bisa **menghemat kertas** dengan tidak mencetak struk kasir pada satu transaksi, **tanpa mengorbankan tiket dapur** (dapur tidak kehilangan pesanan). Berlaku konsisten di **3 jalur pembayaran**: checkout normal (POS), **Split Bill**, dan **resume Pending Payment**. Ikuti urutan A → B → C → D (≈ 20–30 menit).

> **Ruang lingkup**: opsi ini hanya memengaruhi **cetak otomatis saat pembayaran selesai**. Cetak ulang struk dari halaman Transaksi (tombol cetak ulang) dan **Struk Sementara** dari daftar Pending **tetap berfungsi normal** — tidak terpengaruh.

## 0. Persiapan

- **Chrome atau Edge versi terbaru** (untuk menguji printer Bluetooth; mode Browser Print juga bisa dipakai untuk verifikasi cepat).
- **Printer thermal** kasir tersambung di **Settings → Printer** (Printer Kasir, Test Print berhasil). Opsional: 1 **printer dapur** (Bluetooth atau Browser Print) untuk memverifikasi tiket dapur tetap keluar.
- Login sebagai **Manager** atau **Kasir** (akun seed: `manager`/`manager123`, `kasir`/`kasir123`).
- Pastikan **auto print aktif**: Settings → Printer → **Metode Cetak** = Bluetooth (atau Browser Print) dan/atau toggle **auto print setelah checkout** ON — checkbox "Cetak struk kasir" hanya muncul bila salah satu aktif.
- Siapkan **3–4 item menu**, termasuk minimal 1 item dengan **target dapur** (mis. kategori `Makanan`/`Minuman` dengan printer dapur) agar tiket dapur bisa diverifikasi.

> [!NOTE] **Apa yang diuji di sini**: saat checkbox **"Cetak struk kasir" dicentang** (default) → struk kasir + tiket dapur keduanya keluar seperti biasa. Saat **dikosongkan** → struk kasir dilewati, **tiket dapur tetap dicetak**. Opsi bersifat **per transaksi** — setiap kali modal pembayaran dibuka, kembali ke default (cetak struk).

---

## A. Checkout Normal (POS)

**Tujuan**: saat menyelesaikan pembayaran di POS, kasir bisa memilih **tidak mencetak struk kasir** untuk transaksi itu, sementara tiket dapur tetap keluar.

1. **Baseline (default cetak struk)**: buat pesanan 2–3 item di POS → klik **Bayar** → pastikan checkbox **"Cetak struk kasir"** dalam keadaan **tercentang** (default).
   **Hasil yang diharapkan**: ✅ Setelah pembayaran selesai, **struk kasir tercetak** (via Bluetooth atau dialog browser) **dan tiket dapur keluar** untuk item bertarget dapur.

2. **Hemat struk**: buat pesanan baru (2–3 item, termasuk item dapur) → klik **Bayar** → **kosongkan** checkbox **"Cetak struk kasir"**.
   **Hasil yang diharapkan**: ✅ Muncul keterangan **"(tiket dapur tetap dicetak)"** di samping checkbox; tidak ada popup/jendela print struk yang terbuka.
3. Selesaikan pembayaran (pilih metode bayar → konfirmasi).
   **Hasil yang diharapkan**: ✅ Transaksi selesai normal; **struk kasir TIDAK tercetak** (tidak ada dialog browser print struk, tidak ada cetakan keluar); **tiket dapur TETAP tercetak** untuk item dapur.
4. **Reset default transaksi berikutnya**: buka transaksi baru → klik **Bayar**.
   **Hasil yang diharapkan**: ✅ Checkbox **"Cetak struk kasir" kembali tercentang** (default) — pilihan tidak "menempel" dari transaksi sebelumnya.
5. **Cetak ulang manual tetap berfungsi**: di halaman **Transaksi**, pilih transaksi yang tadi tanpa struk → klik **cetak ulang struk**.
   **Hasil yang diharapkan**: ✅ Struk bisa dicetak manual kapan pun — opsi hemat struk hanya menunda, tidak menghapus struk.

**Hasil akhir A**: ✅ Checkout normal mendukung skip struk per transaksi; tiket dapur tetap keluar; default kembali otomatis; reprint manual tetap ada.

---

## B. Split Bill

**Tujuan**: opsi yang sama tersedia **per sub-bill** di modal Split Bill — kasir bisa menghemat struk untuk sebagian/semua sub-bill.

1. Buat pesanan 2–3 item (termasuk item dapur) → klik **Bayar** → klik **Split Bill**.
2. Pilih mode **"Nominal Rata" (Equal)** dengan 2 bagian (atau mode per item bila ingin menguji keduanya).
3. Di **Payment Box sub-bill 1**: pastikan checkbox **"Cetak struk kasir"** **tercentang** → **Bayar Sub-Bill 1**.
   **Hasil yang diharapkan**: ✅ Struk sub-bill 1 tercetak + **tiket dapur lengkap** keluar sekali (sub-bill pertama split fresh mengirim tiket dapur penuh).
4. Di **Payment Box sub-bill 2**: **kosongkan** checkbox **"Cetak struk kasir"** → **Bayar Sub-Bill 2**.
   **Hasil yang diharapkan**: ✅ Sub-bill 2 selesai tanpa struk kasir; **tidak ada cetakan apa pun** untuk sub-bill berikutnya (struk kasir hanya); tiket dapur TIDAK dicetak ulang (sudah keluar sekali di sub-bill 1 — tidak dobel).
5. **Mode nominal berbeda**: ulangi langkah 1–4 pada mode **"Nominal Berbeda" / per item** — checkbox tersedia di Payment Box setiap sub-bill.
   **Hasil yang diharapkan**: ✅ Perilaku sama: skip struk per sub-bill, tiket dapur tetap hanya sekali di sub-bill pertama.
6. **Reset saat modal dibuka ulang**: tutup modal split → buka split bill baru.
   **Hasil yang diharapkan**: ✅ Checkbox kembali **tercentang** (default) — tidak menempel antar sesi split.

**Hasil akhir B**: ✅ Split bill mendukung skip struk per sub-bill; tiket dapur tetap keluar sekali (tidak dobel); default reset setiap modal dibuka.

---

## C. Resume Pending Payment

**Tujuan**: saat melanjutkan (resume) **Pesanan Gantung (Pending)**, kasir juga bisa memilih tidak mencetak struk — total & stok tetap konsisten seperti saat pesanan disimpan.

1. Buat pesanan 2–3 item di POS → klik **Simpan Pending** (atau simpan gantung). Catat **#antrean** pesanan.
2. Dari tombol **Daftar Pesanan Gantung** (atau halaman Pending Payment) → klik **Lanjutkan Pembayaran** pada pesanan itu.
   **Hasil yang diharapkan**: ✅ Pesanan dimuat kembali ke keranjang (item, tipe pesanan, meja, promo/voucher sesuai saat disimpan) dan modal pembayaran terbuka.
3. Di modal pembayaran, **kosongkan** checkbox **"Cetak struk kasir"** → selesaikan pembayaran (mis. dengan status **Selesai**).
   **Hasil yang diharapkan**: ✅ Transaksi selesai & **stok terpotong benar** (deduksi delta — tidak dobel dengan pemotongan saat simpan pending); **struk kasir TIDAK tercetak**; **tiket dapur TETAP keluar** bila ada item dapur.
4. **Pembayaran sebagian / sisa**: buat pending lain → resume → bayar **sebagian** (sisa tetap Pending).
   **Hasil yang diharapkan**: ✅ Opsi skip struk berlaku juga di sini — transaksi tersimpan dengan benar, sisa tetap tercatat Pending.
5. **Pending tanpa promo**: pastikan pesanan yang di-resume tanpa promo tidak memunculkan promo "hantu" (total sesuai nominal saat disimpan) — konfirmasi total di modal checkout cocok.

**Hasil akhir C**: ✅ Resume pending mendukung skip struk; finalisasi (termasuk status 'Selesai' & deduksi delta stok) tetap konsisten.

---

## D. Konsistensi & Kasus Khusus

**Tujuan**: memastikan opsi tidak bocor ke jalur lain dan perilaku batas benar.

1. **Tanpa printer aktif**: matikan auto print & printer di Settings (Metode Cetak = Nonaktif) → buka modal Bayar.
   **Hasil yang diharapkan**: ✅ Checkbox **"Cetak struk kasir" TIDAK muncul** (tidak ada cetak apa pun — opsi tidak relevan).
2. **Skip + fallback browser**: dengan printer Bluetooth **mati** → kosongkan checkbox → checkout.
   **Hasil yang diharapkan**: ✅ Tidak ada dialog print browser struk yang muncul (skip berarti skip total, bukan pindah ke browser); tiket dapur tetap lewat jalur fallback-nya; toast peringatan printer terputus tetap muncul bila relevan.
3. **Split dari Pending**: buat pending → resume → Split Bill.
   **Hasil yang diharapkan**: ✅ Checkbox muncul di modal split (alur B) dan berperilaku sama.
4. **Struk Sementara tidak terpengaruh**: dari **Daftar Pesanan Gantung**, klik **Struk Sementara** pada pending apa pun.
   **Hasil yang diharapkan**: ✅ Struk sementara tetap tercetak normal — opsi skip hanya untuk cetak final saat pembayaran selesai.

**Hasil akhir D**: ✅ Tidak ada kebocoran ke jalur lain; kasus batas (tanpa printer, fallback mati, split dari pending, struk sementara) semuanya benar.

---

## Ringkasan Hasil

| Tahap | Area | Status |
|---|---|---|
| A | Checkout normal: skip struk + tiket dapur tetap + reset default + reprint manual | ☐ |
| B | Split bill: skip per sub-bill + tiket dapur sekali (tidak dobel) | ☐ |
| C | Resume pending: skip struk + finalisasi & stok konsisten | ☐ |
| D | Konsistensi: tanpa printer (checkbox hilang), fallback mati, split dari pending, struk sementara | ☐ |

> Jika semua tahap ☐ ✅, fitur hemat struk siap digunakan. Jika ada yang gagal, catat langkah + pesan toast/error + isi Console (F12), lalu laporkan ke tim pengembangan (detail teknis di `AI-HANDOFF.md` §20 & `TO DO.md` Prioritas 15.3).

---

*Panduan lain: [`TESTING-PRADEPLOY.md`](./TESTING-PRADEPLOY.md) (verifikasi pra-deploy), [`TESTING-DEMO-SALES.md`](./TESTING-DEMO-SALES.md) (demo penjualan), [`TESTING-OPNAME.md`](./TESTING-OPNAME.md) (stock opname), [`TESTING-OFFLINE.md`](./TESTING-OFFLINE.md) (mode offline), [`TESTING-PRINTER.md`](./TESTING-PRINTER.md) (printer thermal & split printer), [`TESTING-STRUK-DIGITAL.md`](./TESTING-STRUK-DIGITAL.md) (struk WA/email).*
