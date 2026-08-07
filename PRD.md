# Product Requirements Document (PRD)

## Project Name: BerdikariPOS
## Product Version: 4.4 (Production)
## Document Status: Production Ready
## Last Updated: 27 Juli 2026
## Production URL: Deployed on Vercel
## Repository: https://github.com/Lemillion-base/rempah-story-pos

---

## 1. Product Overview

**BerdikariPOS** adalah aplikasi Point of Sale (Sistem Kasir) berbasis web multi-purpose yang dirancang untuk berbagai jenis usaha (F&B, retail, kelontong, jasa, salon, laundry, bakery, dll). Sistem ini menghubungkan pesanan dari Kasir langsung ke layar Dapur/Pemenuhan secara real-time melalui shared state, menyediakan dashboard analitik komprehensif untuk Manager, modul Rekap Kas & Stock Opname, serta fitur **Atomic Inventory Transaction Engine** setara POS enterprise (Square/Toast/Odoo) dengan State Machine, Automatic Rollback Engine, Idempotency Control, Snapshot Recipe, dan Snapshot HPP.

### 1.1. Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 18 + TypeScript |
| Build Tool | Vite 5 |
| Styling | TailwindCSS 3.4 |
| State Management | Zustand 4.5 + persist middleware (localStorage) |
| Cloud Database | Supabase (PostgreSQL + Real-time) |
| Routing | React Router v6 |
| Charts | Chart.js 4 + react-chartjs-2 |
| PDF Export | jsPDF + jspdf-autotable |
| Password Hashing | bcryptjs |
| PWA | vite-plugin-pwa (Workbox) |
| Icons | Lucide React |
| ID Generation | uuid v9 |
| Hosting | Vercel (Production) |
| Repository | GitHub |

### 1.2. Objektif

- Menyediakan antarmuka kasir yang cepat, intuitif, dan mobile-friendly.
- Menghilangkan miskomunikasi antara kasir dan dapur melalui Kitchen Display System (KDS).
- Mengotomatisasi perhitungan Harga Pokok Penjualan (HPP) berdasarkan komposisi bahan baku.
- Menyediakan laporan penjualan, inventaris, shift karyawan, rekap kas, dan kas kasir secara real-time.
- Mengelola data pelanggan (CRM) dengan fitur WhatsApp marketing.
- Menerapkan manajemen shift kasir & rekap kas dengan serah terima kas yang akuntabel.
- Menyediakan pemantau koneksi printer Bluetooth otomatis (*Printer Connection Monitor*) dengan opsi *reconnect* 1-klik.

---

## 2. User Personas & Roles (RBAC)

Sistem menggunakan Role-Based Access Control (RBAC) dengan 4 peran utama:

### 2.1. Manager (Admin)
- **Akses**: Seluruh sistem (Dashboard, POS, Dapur, Transaksi, Katalog, Inventaris, Rekap Kas, Laporan, Pelanggan, Audit Log, Settings)
- **Fokus**: Analisis dashboard, manajemen katalog & harga, laporan keuangan, otorisasi void/pembatalan/penghapusan transaksi & kas, pengaturan toko, pajak & printer

### 2.2. Kasir (Frontdesk)
- **Akses**: POS, Transaksi, Pelanggan, Rekap Kas, Settings (Pengaturan Printer Thermal)
- **Fokus**: Pembuatan pesanan, pencatatan kas masuk/keluar, serah terima kas (shift management), melihat riwayat transaksi harian, serta mengatur & memantau koneksi printer thermal
- **Wajib**: Input modal kas awal saat buka shift, input kas aktual + print ringkasan saat tutup shift

### 2.3. Acaraki (Kitchen)
- **Akses**: Dapur (KDS) saja
- **Fokus**: Mengubah status antrean pesanan (Waiting → Processing → Done)
- **Wajib**: Print ringkasan pesanan selesai saat logout (opsional skip)

### 2.4. Staf Gudang (Warehouse Staff)
- **Akses**: Inventaris (modul bahan baku & stock opname) saja
- **Fokus**: Melihat, menambah, dan mengubah detail bahan baku serta melakukan Stock Opname (rekonsiliasi fisik) dengan mode *Blind Opname*

---

## 3. Functional Requirements (Fitur Lengkap)

### 3.1. Modul Autentikasi & Sesi
- **Login**: Username + password
- **Routing otomatis**: Manager → Dashboard, Kasir → POS, Acaraki → Kitchen, Staf Gudang → Inventaris
- **Demo accounts** ditampilkan di halaman login:
  - Manager: `manager` / `manager123`
  - Kasir: `kasir` / `kasir123`
  - Acaraki: `acaraki` / `acaraki123`
  - Staf Gudang: `gudang` / `gudang123`
- **Restriksi Multi-login Device**: Setiap user dibatasi hanya boleh memiliki satu session aktif di satu perangkat. Jika user login di perangkat/browser lain, session di perangkat lama otomatis ter-logout (kicked out) secara real-time via Supabase realtime subscription.

### 3.2. Modul Shift Management & Rekap Kas
- **Buka Shift (Wajib)**:
  - Modal muncul otomatis setelah login Kasir. Untuk Manager, kemunculan modal ditunda hingga ia mengakses menu POS.
  - Input modal kas awal (quick amount buttons: 100rb–1jt)
  - Tidak bisa mengakses POS sebelum shift dibuka
  - Indikator "Shift Aktif" di sidebar dengan info modal awal
- **Modul Rekap Kas (Kas Masuk & Kas Keluar)**:
  - Pencatatan arus kas operasional non-transaksi (e.g. Pembelian bahan darurat, bayar galon, kas modal tambahan)
  - Nominal bebas diinput tanpa batasan
  - Pembatalan / penghapusan / pengubahan entri kas memerlukan izin & PIN Manager + tercatat di Audit Log
  - Sinkronisasi penuh ke cloud Supabase (`cash_movements` table)
- **Tutup Shift (Wajib)**:
  - Tombol "Tutup Shift" menggantikan "Keluar" di sidebar
  - Modal menampilkan ringkasan: modal awal, total penjualan, jumlah transaksi, Kas Masuk (`+`), Kas Keluar (`-`), expected cash
  - Formula: $\text{Expected Cash} = \text{Modal Awal} + \text{Penjualan Tunai} + \text{Kas Masuk} - \text{Kas Keluar}$
  - Input kas aktual di laci **WAJIB** (tidak bisa di-skip)
  - Kalkulasi selisih otomatis (warna hijau/merah)
  - **Wajib print** ringkasan transaksi & breakdown arus kas sebelum logout

### 3.3. Modul POS (Kasir)
- **Katalog Produk**: Grid card dengan gambar produk (atau inisial nama jika belum ada foto)
- **Filter**: Kategori (Semua, Best Seller, per kategori) + Search
- **Kustomisasi Pesanan (Modal)**:
  - Pilihan Suhu: Hangat / Dingin (dapat dinonaktifkan per produk)
  - Level Gula: Normal / Less / None (dapat dinonaktifkan per produk)
  - Add-ons opsional (multi-select)
  - Quantity selector
  - Pilihan Tipe Pesanan: Dine In / Take Away
  - Pilihan Nomor Meja (untuk Dine In)
- **Keranjang Belanja**:
  - Item list dengan quantity +/- controls, kustomisasi, & hapus item
  - **Mobile: Minimize/Maximize** (floating bar & overlay slide-up)
- **Perhitungan Pajak Terintegrasi (PB1 / PPN)**:
  - Dihitung dari Net Subtotal (setelah diskon) dan dibulatkan ke Rupiah terdekat jika fitur pajak diaktifkan di Settings
- **Checkout & cetak struk otomatis**:
  - Cetak struk dengan teks `DINE IN MEJA X` atau `TAKE AWAY` ukuran besar & bold
  - Validasi stok sebelum checkout

### 3.4. Modul KDS / Acaraki (Dapur)
- **Kanban Board 3 kolom**: Waiting → Processing → Done
- **Detail Tiket**: Nomor antrean, nama produk, suhu, gula, quantity, add-ons, waktu masuk, kasir, tipe pesanan (Dine In/Take Away), dan **Nomor Meja**
- **Alert 5 Menit & Sound Notification**
- **Reset KDS** saat Acaraki logout + print ringkasan

### 3.5. Modul Riwayat Transaksi & Revert Stok
- **Daftar & Detail Transaksi**: Nomor antrean, waktu, metode pembayaran, total, status, item akordeon
- **Revert Stok & Customer pada Penghapusan / Void Transaksi**:
  - Mengabaikan atau membatalkan (*Cancel*) transaksi berstatus `Selesai` secara otomatis mengembalikan stok bahan baku (`revertStock`) dan mengurangi riwayat belanja/visit pelanggan (`revertVisit`)
  - Menghapus (*Delete*) transaksi `Selesai` me-revert stok & data pelanggan secara aman sebelum data dihapus
  - Re-enable transaksi dari `Cancel → Selesai` memotong stok kembali (`deductStock`) dan merekam kunjungan pelanggan kembali
- **Keamanan**: PIN Manager untuk otorisasi void & delete transaksi

### 3.6. Modul Dashboard & Analitik
- **Stats Cards**: Pendapatan hari ini, jumlah transaksi, menu terlaris, laba kotor
- **Grafik Omset & Trend Profitabilitas (Net Sales - HPP)**: Menggunakan Pendapatan Bersih ($\text{subtotal} - \text{diskon}$) dikurang HPP agar tidak terpengaruh pajak (pajak dipisahkan sebagai liability)
- **Top Menu & Profitabilitas Menu 30 Hari Terakhir**

### 3.7. Modul Katalog & Harga (Manager)
- CRUD menu lengkap dengan foto produk & **Floating Action Buttons (FAB)**
- HPP otomatis berbasis bahan baku ATAU HPP Manual
- Add-ons per menu & toggle ketersediaan menu

### 3.8. Modul Inventaris & Stock Opname
- CRUD bahan baku, min. stok alert, & stock log trail
- **Stock Opname (Rekonsiliasi Fisik)**:
  - Rekonsiliasi stok fisik vs stok sistem
  - **Mode Blind Opname (Staf Gudang)**: Sembunyikan stok sistem & selisih dari Staf Gudang agar pencatatan stok fisik di lapangan murni akurat tanpa manipulasi
  - Verifikasi PIN Manager untuk selisih besar ($\ge 10\%$)

### 3.9. Modul Laporan (Manager)
- **Filter Tanggal Presisi**: Hari Ini, 7 Hari, Bulan, Custom (date range) menyaring transaksi, shift, dan arus kas secara akurat
- **5 Tab Laporan**: Laba Rugi (P&L), Transaksi, Kas Kasir, Stok Bahan, Shift Karyawan
- **Export CSV & PDF**: Format profesional dengan header toko & periode
- **Tabel Scrollable (`max-h-80`)**: Dengan sticky header untuk efisiensi ruang

### 3.10. Modul Pelanggan / CRM
- CRUD pelanggan + Floating Action Button (FAB)
- Tracking otomatis total belanja & kunjungan (dengan auto-revert jika transaksi dibatal/dihapus)
- Integrasi WhatsApp Marketing

### 3.11. Modul Printer Thermal & Background Connection Monitor
- **Split Printing (Printer Dapur & Bar)**: Mencetak pesanan makanan & minuman ke printer terpisah
- **Background Printer Connection Monitor**:
  - Polling Web Bluetooth connection status setiap 3 detik via `usePrinterMonitor.ts`
  - **UI Status Banner**: Banner top-bar aplikasi (Hijau = Terhubung, Kuning = 1 Offline, Merah = Multiple Offline) dengan tombol **[Reconnect]** 1-klik untuk reconnect otomatis jika koneksi Bluetooth terputus akibat browser refresh

### 3.12. Modul Settings & Konfigurasi Pajak
- **Tabbed Layout**: Umum & Tampilan, Printer & KDS, Pengguna & Sistem
- **Pengaturan Pajak (PB1 / PPN)**:
  - Toggle sakelar Aktif/Nonaktif fitur pajak
  - Input persentase pajak (%) + preset cepat (0%, 5%, 10%, 11%, 12%)
  - Simulasi kalkulasi tagihan live preview
- **Pengaturan Tema Warna UI**: Dynamic palette switcher dengan live preview
- **PIN Manager & User Management**

### 3.13. Modul Backup & Restore
- **3 mode backup**: `FULL` (data + media), `MASTER_DATA` (settings/menu/inventory/customers/promos), `TRANSACTION` (transaksi/kas/shift/stock opname)
- Backup ZIP + checksum SHA-256; riwayat backup dengan status & ukuran
- Auto-backup terjadwal (Harian/Mingguan) ke Local Download / Supabase Storage / Google Drive
- Restore wizard: pratinjau isi, validasi integritas, konfirmasi sebelum menimpa
- Implementasi: `src/lib/backupService.ts`, `src/store/backupStore.ts`, `src/components/backup/*`

### 3.14. Modul Bundle Menu
- Bundle menu induk berisi komponen menu lain (Paket Hemat)
- Validasi: cegah self-reference, bundle bersarang, referensi sirkular (`bundleValidation.ts`)
- Child items otomatis di cart (`isBundleChild`, harga 0) & diskalakan saat qty berubah (`bundleService.ts`)
- HPP bundle dari resep komponen; snapshot komponen permanen di transaksi
- Repositori `menu_components` dengan offline queue & cloud sync (`bundleRepository.ts`)

---

## 4. Database Schema (Supabase PostgreSQL)

```sql
-- Settings Table Schema (v4.2)
CREATE TABLE IF NOT EXISTS settings (
  id INT PRIMARY KEY DEFAULT 1,
  manager_pin TEXT DEFAULT '1234',
  store_name TEXT DEFAULT 'BerdikariPOS',
  store_logo TEXT,
  address TEXT,
  tax_enabled BOOLEAN DEFAULT false,
  tax_percent FLOAT DEFAULT 0,
  categories JSONB DEFAULT '["Jamu Murni", "Wedang", "Signature", "Segar"]',
  printer_enabled BOOLEAN DEFAULT false,
  printer_type TEXT DEFAULT 'browser',
  printer_width TEXT DEFAULT '58mm',
  auto_print_on_checkout BOOLEAN DEFAULT false,
  super_admin_pin TEXT DEFAULT '000000',
  kitchen_printers JSONB DEFAULT '[]',
  theme_color TEXT,
  theme_shades JSONB,
  table_features_enabled BOOLEAN DEFAULT false,
  available_table_numbers JSONB DEFAULT '[]'
);

-- Cash Movements Table Schema
CREATE TABLE IF NOT EXISTS cash_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('in', 'out')),
  amount FLOAT NOT NULL DEFAULT 0,
  category TEXT NOT NULL,
  notes TEXT,
  cashier_id TEXT,
  cashier_name TEXT NOT NULL,
  date TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

*PRD BerdikariPOS v4.4.*
