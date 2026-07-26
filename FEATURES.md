# 🏪 BerdikariPOS — Daftar Fitur & Keunggulan (v4.2)

## Aplikasi Point of Sale Modern untuk Berbagai Jenis Usaha

---

## 🎯 Ringkasan

BerdikariPOS adalah sistem kasir berbasis web multi-purpose yang dirancang untuk berbagai jenis usaha (F&B, retail, kelontong, jasa, salon, laundry, bakery, dll). Menghubungkan kasir, bagian dapur/pemenuhan, manajemen gudang, dan manajemen eksekutif dalam satu platform terintegrasi dengan cloud sync real-time.

---

## ✨ Fitur Utama

### 1. 🛒 Point of Sale (Kasir)
- Tampilan grid produk dengan foto atau inisial
- Filter kategori + pencarian cepat
- Kustomisasi pesanan: suhu (hangat/dingin), level gula, add-ons
  - Suhu dan level gula dapat dinonaktifkan per produk (misal makanan tanpa pilihan suhu)
- Keranjang belanja dengan quantity controls
- **Kosongkan keranjang 1-klik** (muncul jika item ≥ 2, dengan konfirmasi)
- Diskon manual (nominal Rupiah)
- Input kode voucher atau pilih promo aktif
- Pilih pelanggan dari daftar CRM (dropdown)
- 3 metode pembayaran: Cash, QRIS, Transfer Bank
- Kalkulator kembalian otomatis + quick cash buttons
- Nomor antrean otomatis (reset harian)
- Cetak struk otomatis (browser print / Bluetooth thermal)
- Validasi stok sebelum checkout (warning jika bahan kurang)
- Keyboard shortcut: F1 = Bayar, Esc = Batal
- Mobile: keranjang minimize/maximize (floating bar)
- **Tipe pesanan**: Dine In / Take Away (pilihan di checkout)
- **Fitur Nomor Meja**: Input nomor meja untuk pesanan Dine In
- **Floating Action Button (FAB)**: Akses cepat aksi utama
- **Perhitungan Pajak Terintegrasi (PB1 / PPN)**: Menghitung pajak secara otomatis jika fitur pajak diaktifkan di Settings

### 2. 🍳 Kitchen Display System (KDS)
- Kanban board 3 kolom: Menunggu → Proses → Selesai
- Detail pesanan: nomor antrean, item, suhu, gula, add-ons, quantity, **tipe pesanan (Dine In/Take Away)**, dan **Nomor Meja**
- Info waktu masuk + nama kasir per pesanan
- Alert visual + suara jika pesanan menunggu > 5 menit
- Tombol 1-klik untuk pindah status
- Sound alarm custom (file .wav bisa diganti)
- Real-time sync: pesanan dari kasir langsung muncul di KDS (multi-device)
- **Hanya menampilkan transaksi hari ini** (transaksi lama tidak tampil)
- Reset tampilan saat Acaraki logout + print ringkasan

### 3. 💰 Manajemen Shift, Rekap Kas & Arus Kas
- **Buka Shift wajib**: input modal kas awal sebelum mulai kerja
- **Kas Masuk & Kas Keluar (Cash Movements)**:
  - Menu khusus `Rekap Kas` untuk mencatat pemasukan & pengeluaran kas operasional secara real-time
  - Bebas input nominal tanpa batasan
  - Pembatalan/penghapusan riwayat kas memerlukan izin & PIN Manager + tercatat di Audit Log
- **Tutup Shift wajib**:
  - Input kas aktual di laci (tidak bisa skip)
  - Formula akuntabel: $\text{Expected Cash} = \text{Modal Awal} + \text{Penjualan Tunai} + \text{Kas Masuk} - \text{Kas Keluar}$
  - Kalkulasi selisih otomatis (warna hijau/merah)
  - Print ringkasan transaksi & breakdown arus kas saat tutup shift
  - Indikator "Shift Aktif" di sidebar

### 4. 📊 Dashboard & Analitik (Manager)
- Pendapatan hari ini, jumlah transaksi, menu terlaris, laba kotor
- Grafik omset & trend profitabilitas berbasis Net Sales ($\text{subtotal} - \text{diskon}$) dikurang HPP
- Distribusi metode pembayaran & tipe pesanan (doughnut chart)
- Top 10 menu terlaris & profitabilitas menu 30 hari terakhir
- Alert stok rendah
- Laba kotor murni murni tanpa terpengaruh pajak (pajak dipisahkan sebagai liability)

### 5. 📋 Laporan Komprehensif
- **5 tab laporan**: Laba Rugi, Transaksi, Kas Kasir, Stok Bahan, Shift Karyawan
- **Filter Periode Presisi**: Hari Ini, 7 Hari, Bulan, Custom (date range) menyaring transaksi, shift, dan arus kas secara akurat
- **Export ke CSV & PDF**: Format profesional siap share ke owner/investor
- Tabel scrollable (`max-h-80`) dengan sticky header untuk efisiensi ruang

### 6. 📦 Manajemen Katalog & Harga
- CRUD menu lengkap dengan foto produk & Floating Action Button (FAB)
- Kategori dropdown (bisa tambah/hapus kategori)
- Kalkulasi HPP otomatis berdasarkan komposisi bahan ATAU input HPP Manual jika produk tidak menggunakan bahan baku
- Add-ons per menu (nama + harga)
- Toggle ketersediaan menu (aktif/nonaktif tanpa hapus)
- Import/Export CSV untuk update massal

### 7. 🏪 Inventaris Bahan Baku & Stock Opname
- CRUD bahan baku (nama, stok, unit, harga/unit, min. stok)
- Auto-deduct stok saat transaksi (berdasarkan komposisi menu)
- Revert stok otomatis saat transaksi `Selesai` dibatalkan atau dihapus
- **Stock Opname (Rekonsiliasi Fisik)**:
  - Input stok fisik aktual, otomatis hitung selisih & kerugian
  - **Mode Blind Opname (Staf Gudang)**: Sembunyikan stok sistem & selisih dari Staf Gudang agar hasil opname fisik murni akurat tanpa kecurangan
  - Verifikasi PIN Manager untuk selisih besar ($\ge 10\%$)
  - Riwayat opname tersimpan & tercatat di stock log

### 8. 🎁 Promo, Voucher & Loyalty
- CRUD promo/voucher dengan masa berlaku
- Diskon persentase (%) atau nominal tetap (Rp)
- Loyalty Member System (Bronze, Silver, Gold)

### 9. 👥 CRM Pelanggan
- CRUD pelanggan + Floating Action Button (FAB)
- Tracking otomatis total belanja & jumlah kunjungan (otomatis dikurangi jika transaksi dihapus/cancel)
- WhatsApp Marketing langsung ke pelanggan

### 10. 🖨️ Printer Thermal & Background Connection Monitor
- **Browser Print & Bluetooth ESC/POS**: Web Bluetooth API untuk cetak langsung
- **Lebar kertas**: 58mm atau 80mm
- **Struk Terbaca Jelas**: Teks `DINE IN MEJA X` dan `TAKE AWAY` dicetak ekstra besar dan bold
- **Split Printing (Printer Dapur & Bar)**: Otomatis mencetak pesanan makanan & minuman ke printer terpisah
- **Background Printer Connection Monitor (v4.2)**:
  - Background service (`usePrinterMonitor.ts`) secara berkala (3 detik) memeriksa status koneksi Bluetooth seluruh printer
  - **UI Status Banner**: Banner top-bar aplikasi (Hijau = Terhubung, Kuning = 1 Offline, Merah = Multiple Offline) dilengkapi tombol **[Reconnect]** 1-klik untuk mengatasi disconnections pasca-refresh browser.

### 11. 🏷️ Pengaturan Pajak (PB1 / PPN)
- **Modul Pengaturan Pajak di Settings**:
  - Toggle sakelar Aktif/Nonaktif fitur pajak
  - Input persentase pajak (%) + preset cepat (0%, 5%, 10%, 11%, 12%)
  - Simulasi kalkulasi tagihan live preview
- Terintegrasi penuh dengan POS Kasir, Struk Thermal, & Cloud Sync Supabase

### 12. 🛡️ Keamanan & Audit
- Password hashing (bcrypt)
- PIN Manager untuk otorisasi void & hapus transaksi
- Super Admin PIN untuk akses Manajemen Data
- **Audit Revert Transaksi**: Menghapus transaksi `Selesai` mengembalikan stok bahan baku & poin pelanggan
- **Restriksi Multi-login Device**: Membatasi user agar hanya login di 1 perangkat aktif saja
- Audit Log lengkap & dapat di-export ke CSV

---

*Fitur lengkap BerdikariPOS v4.2.*
