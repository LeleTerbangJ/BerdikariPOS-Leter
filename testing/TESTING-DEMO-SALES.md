# 🧪 Panduan Tes Manual — Quick-Start Demo Penjualan v4.7

Panduan **cepat untuk tim sales/demo** — 4 alur inti POS: (1) pesan + promo BOGO, (2) split bill, (3) pesanan gantung (Pending), (4) struk digital. Setiap alur ≤ 3 menit; total demo ≈ 15–20 menit.

> [!NOTE] Asumsi: aplikasi sudah di-setup dengan data demo (`supabase/schema.sql` v4.7 + seed), login sebagai **Kasir** (`kasir`/`kasir123`), dan koneksi cloud normal. Detail teknis ada di `TESTING-PRADEPLOY.md` / `DEPLOYMENT.md`.

---

## 0. Persiapan Demo (sekali sebelum mulai)

1. Login **Manager** (`manager`/`manager123`) → **Promo & Loyalty** → buat promo **BOGO**:
   - Nama: `BOGO Kopi` • Tipe: **BOGO / Beli N Gratis M** • Beli **2**, Gratis **1** • Berlaku untuk: **Semua menu**.
   - Ceklis **Aktif**; tanggal mulai = hari ini, selesai = +7 hari.
2. Pastikan stok bahan baku **cukup** untuk menu yang akan dipesan (Inventory → bahan baku; kalau kurang, naikkan stok via Stock Opname/adjustment).
3. (Opsional) Siapkan 1 pelanggan dengan **nomor WhatsApp** agar demo struk digital lancar — bisa dibuat langsung dari POS via tombol **"Baru"** di keranjang (tidak perlu ke halaman Pelanggan).
4. Pastikan printer/audio tidak memblokir pop-up (demo struk digital membuka jendela baru).

> [!TIP] **Hindari error di depan klien**: (a) promo berbatas per pelanggan membutuhkan **pelanggan dipilih dulu** di POS; (b) pembayaran tunai harus ≥ total (atau pakai metode non-tunai); (c) jangan pakai menu yang stok bahannya habis.

---

## A. Pesan + Promo BOGO + Checkout

**Tujuan**: menunjukkan keranjang, promo BOGO otomatis, dan checkout normal.

1. Di **POS**, klik menu favorit **2×** (mis. "Es Kopi Susu" ×2).
2. Klik **Keranjang** (kanan atas / bawah pada mobile).
   **Hasil yang diharapkan**: ✅ Keranjang menampilkan 2 item; subtotal benar.
3. Di footer keranjang, buka dropdown **"Pilih promo..."** → pilih **BOGO Kopi**.
   **Hasil yang diharapkan**:
   - ✅ Pill hijau `✓ BOGO Kopi (-Rp …)` muncul — **1 item gratis otomatis** (diambil dari item termurah).
   - ✅ Jumlah total turun sesuai harga 1 item gratis.
4. (Opsional) Pilih **pelanggan** di keranjang:
   - Klik kolom **"-- Cari pelanggan (nama/HP) --"** → **ketik sebagian nama/nomor HP** → klik hasil yang muncul (Enter memilih hasil pertama; Escape menutup).
   - Atau klik tombol **"Baru"** di sampingnya → isi form singkat → **"Tambah & Pilih"** → pelanggan langsung terpilih.
   - Jika pelanggan sudah terpilih, isi **"Tukar poin"** dengan saldo poin → lihat diskon redeem bertambah.
5. Klik **Bayar** (buka modal pembayaran) → pilih metode (mis. **Cash** dengan nominal uang pas, atau **QRIS**) → klik **Selesaikan Pesanan**.

**Hasil akhir A**: ✅ Transaksi **Selesai**; struk tercetak (bila auto-print aktif); stok bahan baku berkurang; poin pelanggan bertambah (jika ada pelanggan).

> 💡 **Tips demo**: untuk menunjukkan **promo eksklusif**, buat 1 promo dengan toggle "Boleh digabung" dimatikan → di POS muncul info *"ℹ️ Promo eksklusif — otomatis memberi diskon terbaik"*.

---

## B. Split Bill (Pisah Tagihan)

**Tujuan**: menunjukkan pembagian tagihan **Nominal Rata** dan **Per-Item**.

1. Keranjang berisi beberapa item (≥ 3 item berbeda, mis. 2 kopi + 1 kue).
2. Klik **Keranjang → Bayar** → di modal pembayaran klik **Split Bill**.
3. **Mode Nominal Rata (Equal)** (default):
   - Klik **"Split Nominal Rata (Equal)"** → pilih **"3 Orang"**.
   **Hasil yang diharapkan**: ✅ Total terbagi rata presisi (tanpa selisih Rp 1); tiap sub-bill menampilkan "Bagian N dari 3".
4. Klik **Bayar Sub-Bill 1** → selesaikan pembayaran sub-bill 1 → ulangi untuk sub-bill 2 dan 3.
   **Hasil yang diharapkan**: ✅ Setelah sub-bill terakhir, toast **"Seluruh Split Bill berhasil dilunasi! 🎉"**; struk sub-bill (ringkasan item proporsional + label bagian) tercetak; stok terpotong **sekali** (tidak dobel).
5. Ulangi dengan **"Split Per-Item (Custom)"** (alokasikan tiap item ke bill tertentu) bila waktu mengizinkan.

**Hasil akhir B**: ✅ Semua sub-bill lunas; stok benar; laporan tidak menghitung sub-bill ganda.

> 💡 **Tips demo**: jangan tutup modal Split di tengah lalu checkout normal — sesi split otomatis dibatalkan dan sisa reserve stok dikembalikan (toast info muncul; itu perilaku normal, bukan error).

---

## C. Pesanan Gantung (Pending) → Lanjutkan

**Tujuan**: menunjukkan Simpan & Gantung pesanan, lalu melanjutkan pembayaran.

1. Isi keranjang (mis. 2 item) → klik **Simpan Pending** di footer keranjang.
   **Hasil yang diharapkan**: ✅ Toast sukses; badge counter **Pending** bertambah di POS; tiket dapur terkirim (bila dapur aktif).
2. Klik badge/daftar **Pending** → modal **Daftar Pesanan Gantung** menampilkan pesanan dengan nomor antrean.
3. Klik **Lanjutkan** pada pesanan itu → konfirmasi keranjang kosong (atau ganti isi keranjang).
   **Hasil yang diharapkan**: ✅ Keranjang terisi ulang persis (item, qty, promo, diskon, pelanggan); total konsisten.
4. Klik **Bayar → Selesaikan Pesanan**.
   **Hasil yang diharapkan**: ✅ Transaksi final **Selesai** dengan nomor antrean **sama** seperti saat digantung; stok tidak terpotong ganda.

**Hasil akhir C**: ✅ Pending → final mulus, tanpa transaksi ganda, stok benar.

> 💡 **Tips demo**: jangan buat Pending untuk item yang stoknya tipis — stok di-reserve saat digantung; kalau stok habis, resume bisa memicu peringatan stok (klik "Lanjutkan Tetap" hanya bila ingin demo).

---

## D. Struk Digital (WA / Email)

**Tujuan**: menunjukkan kirim struk ke pelanggan dari riwayat transaksi.

1. Buka halaman **Riwayat Transaksi** → cari transaksi **Selesai** yang memakai pelanggan ber-nomor HP.
2. Klik tombol **"Struk Digital"** pada transaksi tersebut.
   **Hasil yang diharapkan**: ✅ Modal terbuka dengan **kontak pelanggan terisi otomatis** (WhatsApp & email) + **pratinjau struk** (nama toko, alamat, item, promo, total).
3. Klik **Kirim WhatsApp** → jendela `wa.me` terbuka dengan nomor & struk terisi → kirim.
   **Hasil yang diharapkan**: ✅ Struk lengkap di WhatsApp; pengiriman tercatat di **audit log**.
4. (Opsional) Klik **Kirim Email** → aplikasi email terbuka dengan struk sebagai body.
5. (Opsional, auto-kirim) Di **Settings → Pengaturan Struk**, aktifkan **"Kirim Struk Digital Otomatis via WhatsApp"** → checkout dengan pelanggan ber-nomor HP → jendela WA terbuka otomatis berisi struk.

**Hasil akhir D**: ✅ Struk terkirim (WA/email); auto-kirim bekerja tanpa struk ganda.

---

## Ringkasan Cepat Demo (30 detik)

| Urutan | Aksi | Tombol Kunci |
|---|---|---|
| 1 | Pesan item ×2 → pilih promo BOGO | Keranjang → "Pilih promo..." |
| 2 | Pilih/tambah pelanggan (opsional) | Ketik nama/HP di "Cari pelanggan" atau tombol **Baru** |
| 3 | Bayar normal | **Selesaikan Pesanan** |
| 4 | Split 3 orang | **Split Bill** → "3 Orang" → Bayar Sub-Bill |
| 5 | Gantung pesanan | **Simpan Pending** → Pending → Lanjutkan |
| 6 | Kirim struk WA | Riwayat Transaksi → **Struk Digital** → Kirim WhatsApp |

> Jika ada langkah yang gagal: catat pesan error + langkah, lalu cek `TESTING-PRADEPLOY.md` (SQL/migrasi) atau laporkan ke tim pengembangan. Detail teknis: `AI-HANDOFF.md`, `DEPLOYMENT.md`.
