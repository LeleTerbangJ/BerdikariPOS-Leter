# 🐛 BUG & ERROR — Laporan Analisis BerdikariPOS

## Status: 🟢 Stabil — Terakhir diperbarui: 23 Juli 2026 (Refactor Bluetooth Thermal Printer Device Registry v4.0)
## Versi Codebase: v4.0 (Production)

---

## Daftar Isi
1. [Bug Kritis (Harus Diperbaiki Segera)](#-bug-kritis)
2. [Bug Menengah (Penting tapi Tidak Urgent)](#-bug-menengah)
3. [Potensi Masalah Logic (Risiko Tersembunyi)](#-potensi-masalah-logic)
4. [Masalah Keamanan](#-masalah-keamanan)
5. [Masalah Cloud Sync & Data Integrity](#-masalah-cloud-sync--data-integrity)
6. [Bug UI/UX & Printing](#-bug-uiux--printing)
7. [Catatan Teknis & Tech Debt](#-catatan-teknis--tech-debt)
8. [Bug Yang Sudah Diperbaiki (Riwayat)](#-bug-yang-sudah-diperbaiki)

---

## 🔴 Bug Kritis

*(Tidak ada bug kritis aktif saat ini. Semua temuan kritis sebelumnya telah berhasil diperbaiki.)*

---

## 🟠 Bug Menengah

### BUG-UI-STACKED-MODAL: OpenShiftModal Ter-render Dibalik CloseShiftModal Saat Tutup Shift (✅ Fixed)
- **File**: `src/App.tsx` (`ShiftGuard`), `src/components/Layout.tsx` (`CloseShiftModal`)
- **Severity**: 🟠 Medium
- **Deskripsi**: Saat Kasir mengklik tombol "Print Ringkasan & Tutup Shift", fungsi `handleCloseShift()` memanggil `closeShift()` yang mengubah state `activeShift` menjadi `null`. Komponen `ShiftGuard` di `App.tsx` langsung merespons perubahan `activeShift === null` dan secara otomatis meng-instantiate komponen `<OpenShiftModal open={true} />` ke dalam React DOM tree. Pada saat yang bersamaan, modal `CloseShiftModal` di `Layout.tsx` masih aktif ditampilkan di layar. Karena modal Buka Shift memiliki ukuran lebih lebar (`max-w-lg`) daripada modal Tutup Shift (`max-w-md`), kartu modal Buka Shift beserta tombol quick-amount modal peeking/muncul persis di belakang modal Tutup Shift.
- **Dampak**: Tampilan UI bertumpuk (stacked modal) yang membingungkan kasir, serta risiko pemicuan state modal awal secara tidak sengaja saat interaksi UI.
- **Solusi**: Tunda penutupan state `closeShift(...)` sampai proses cetak ringkasan shift dan pemanggilan printer selesai penuh, lalu lakukan penutupan modal & logout secara sinkron.

---

## 🟡 Potensi Masalah Logic

### LOGIC-ERR-01: Settings Merge Bisa Kehilangan Data Cloud yang Berubah (✅ Fixed)
- **File**: `src/store/settingsStore.ts` (baris 60-89, fungsi `loadFromCloud`)
- **Severity**: 🟡 Low-Medium
- **Deskripsi**: Logika merge settings membandingkan nilai lokal dan cloud terhadap `seedSettings`. Jika kedua perangkat mengubah field **yang sama** secara bersamaan (keduanya berbeda dari seed), cloud selalu menang (`merged[key] = cloudVal`). Ini benar untuk kebanyakan kasus, **namun**: jika Device A mengubah `storeName` menjadi "Toko Baru" lalu offline, dan Device B mengubah `storeName` menjadi "Toko Lain" lalu sync ke cloud — saat Device A kembali online, perubahannya hilang tanpa notifikasi.
- **Dampak**: Perubahan setting hilang tanpa peringatan ("silent data loss").
- **Solusi**: Tampilkan notifikasi ketika terjadi konflik merge settings.

### LOGIC-ERR-02: Discount Bisa Melebihi Subtotal (Frontend vs Backend Mismatch) (✅ Fixed)
- **File**: `src/pages/POS.tsx` (baris 356-359)
- **Deskripsi**: Discount di-cap di `finalizeTransaction()` saja: `totalDiscount = Math.min(rawTotalDiscount, subtotal)`. Namun, preview total di cart footer (`netSubtotal = Math.max(0, ...)`) bisa menampilkan Rp 0 sementara total final di checkout modal menampilkan angka berbeda jika ada pajak. Ini bukan bug fungsional, tetapi bisa membingungkan kasir.
- **Solusi**: Pastikan `taxAmount` preview menggunakan formula yang identik dengan `finalizeTransaction()`.

### LOGIC-ERR-03: `recordVisit()` Tidak Dibalikkan Saat Transaksi Di-cancel (✅ Fixed)
- **File**: `src/store/customerStore.ts`, `src/pages/Transactions.tsx`
- **Severity**: 🟡 Medium
- **Deskripsi**: Ketika transaksi di-void/cancel dari halaman Transaksi, stok inventaris direvert (`revertStock()`), tetapi `visitCount` dan `totalSpent` pelanggan **tidak dikurangi**. Akibatnya, data CRM pelanggan menjadi inflated (loyalty tier bisa salah naik).
- **Dampak**: Pelanggan bisa naik tier loyalty lebih cepat dari seharusnya.
- **Solusi**: Tambahkan fungsi `revertVisit(customerId, amount)` di `customerStore.ts` dan panggil saat void transaksi yang memiliki `customerId`.

### LOGIC-ERR-04: Offline Queue Tidak Menangani Urutan Operasi dengan Benar (✅ Fixed)
- **File**: `src/lib/offlineQueue.ts` (fungsi `flushQueue`)
- **Severity**: 🟡 Low-Medium
- **Deskripsi**: Offline queue memproses semua operasi **secara berurutan** (sequential loop), namun tidak memperhatikan urutan dependensi. Contoh: jika kasir membuat transaksi (insert) lalu langsung membatalkannya (update status → Cancel) saat offline, keduanya di-queue. Jika flush berhasil untuk transaksi tapi gagal untuk update status, transaksi akan muncul sebagai "Selesai" di cloud padahal sudah di-cancel secara lokal.
- **Dampak**: Inkonsistensi status transaksi antar device.
- **Solusi**: Deduplication sudah ada untuk upsert/update, tapi perlu ditambahkan handling khusus agar update status selalu diproses terakhir untuk record yang sama.

### LOGIC-ERR-05: `queuePreview` Menggunakan `lastQueueDate` dari State Lama (✅ Fixed)
- **File**: `src/pages/POS.tsx` (baris 284-290)
- **Severity**: 🟡 Low
- **Deskripsi**: Fungsi `queuePreview` (yang menampilkan preview nomor antrean di checkout modal) memeriksa `state.lastQueueDate !== dateStr` untuk menentukan apakah hari ini sudah ada transaksi. Namun, format tanggal yang dihasilkan (`YYYY-M-D` tanpa padding untuk satu digit) bisa berbeda dengan format `getTodayDateStr()` (`YYYY-MM-DD` dari `toISOString()`).
- **Kode Bermasalah**:
  ```typescript
  // POS.tsx — format BISA berbeda dari getTodayDateStr()
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  ```
  ```typescript
  // transactionStore.ts
  function getTodayDateStr(): string {
    return new Date().toISOString().split('T')[0]; // → YYYY-MM-DD (UTC!)
  }
  ```
- **Problem**: `toISOString()` menggunakan **UTC**, sedangkan format manual di POS.tsx menggunakan **timezone lokal**. Di Indonesia (UTC+7), transaksi yang dibuat pukul 00:00-06:59 WIB akan memiliki tanggal **kemarin** di UTC, menyebabkan `lastQueueDate` (UTC) tidak cocok dengan `dateStr` (WIB) → preview antrean salah.
- **Dampak**: Nomor antrean preview bisa menampilkan "1" padahal sudah ada transaksi hari ini (di timezone WIB).
- **Solusi**: Gunakan `getTodayDateStr()` yang sama (atau fungsi bersama) di kedua tempat, dan pertimbangkan menggunakan waktu lokal konsisten daripada UTC.

### LOGIC-ERR-06: Stok Tidak Dipotong Kembali Saat Transaksi Batal (Cancel) Diubah Kembali ke Selesai (✅ Fixed)
- **File**: `src/pages/Transactions.tsx`
- **Severity**: 🟡 Medium
- **Deskripsi**: Ketika status transaksi diubah dari `Selesai` ke `Cancel` (void), stok inventaris direvert (`revertStock()`). Namun, jika transaksi yang di-cancel tersebut diubah kembali menjadi `Selesai` oleh kasir/manager, aplikasi tidak memanggil `deductStock()`.
- **Dampak**: Stok bahan baku di inventaris tidak terpotong untuk transaksi yang berhasil tercatat sebagai "Selesai" (stok menjadi overstated).
- **Solusi**: Pada handler status change di `Transactions.tsx`, tambahkan pengecekan jika status berubah dari `Cancel` ke `Selesai`, panggil `deductStock` dengan bahan baku yang sesuai dari transaksi tersebut.

### LOGIC-ERR-07: Data `orderType` Tidak Tercakup dalam Laporan Penjualan (Reports) (✅ Fixed)
- **File**: `src/pages/Reports.tsx`
- **Severity**: 🟡 Low-Medium
- **Deskripsi**: Field `orderType` ("Dine In" / "Take Away") telah berhasil diintegrasikan pada model transaksi, kitchen screen, dan modul printer. Namun, data penting ini sama sekali tidak digunakan atau dirender pada halaman Laporan (`Reports.tsx`). Kasir/Manager tidak dapat melihat rasio penjualan Dine In dibandingkan dengan Take Away.
- **Dampak**: Keterbatasan insight bisnis bagi manajemen untuk memantau preferensi makan di tempat vs dibawa pulang.
- **Solusi**: Tambahkan metrik visual (misal Doughnut Chart) untuk distribusi tipe order (`orderType`) pada tab Laba Rugi/Transaksi di halaman Laporan.

### LOGIC-ERR-08: Stock Opname Menghasilkan Log Stok Ganda (Double Entry) (✅ Fixed)
- **File**: `src/pages/StockOpname.tsx` (fungsi `doSubmit`, baris 124-134), `src/store/inventoryStore.ts` (fungsi `updateItem`, baris 30-46)
- **Severity**: 🟡 Medium
- **Deskripsi**: Ketika stock opname disubmit, fungsi `doSubmit()` melakukan dua operasi untuk setiap item yang memiliki selisih:
  1. `addStockLog(...)` — Mencatat log stok adjust secara eksplisit dengan reason `"Stock Opname: ..."` (baris 126-132).
  2. `updateItem(item.inventoryId, { stock: item.actualStock })` — Mengupdate stok inventaris (baris 133).
  Namun, fungsi `updateItem()` di `inventoryStore.ts` memiliki **deteksi perubahan stok internal** (baris 33-46) yang juga memanggil `addStockLog()` dengan reason `"Adjustment manual"` jika `data.stock !== current.stock`.
  Akibatnya, setiap penyesuaian stok opname menghasilkan **2 entri log stok** — satu "Stock Opname" dan satu "Adjustment manual" — untuk perubahan yang sama.
- **Dampak**: Data log stok menjadi membengkak (duplikat), laporan audit stok tidak akurat (jumlah adjustment terhitung ganda).
- **Solusi**: Gunakan pendekatan salah satu:
  - Opsi A: Ubah pemanggilan di `StockOpname.tsx` menjadi update stok langsung tanpa trigger auto-log di `updateItem()` (misal: tambahkan parameter `{ skipLog: true }`).
  - Opsi B: Hapus pemanggilan `addStockLog()` eksplisit di `doSubmit()` dan biarkan `updateItem()` yang menangani logging (ubah reason default menjadi kontekstual).

### LOGIC-ERR-09: Filter Jam Shift Strict Mengabaikan Cash Movement Saat Tutup Shift (✅ Fixed)
- **File**: `src/pages/Reports.tsx`, `src/components/Layout.tsx`
- **Severity**: 🟡 Low-Medium
- **Deskripsi**: Logika pencocokan `shiftMovements` pada laporan shift menggunakan batasan waktu ketat `md >= openedAt && md <= closedAt`. Jika kasir mencatat pengeluaran kas (contoh: setor kas ke manager) persis sebelum atau saat menutup shift, jeda beberapa detik pada timestamp pencatatan lokal dapat membuat timestamp kas keluar berada sedikit di luar `closedAt`. Akibatnya, kas keluar tersebut tidak terhitung pada laporan shift (menampilkan Kas Keluar = Rp 0).
- **Dampak**: Nominal kas keluar pada laporan shift kasir menjadi Rp 0 padahal kas fisik aktual berkurang.
- **Solusi**: Utamakan pencocokan langsung berdasarkan ID Shift (`m.shiftId === sh.id`), serta berikan buffer toleransi waktu 1 menit pada perbandingan timestamp `openedAt` dan `closedAt`.

---

## 🔒 Masalah Keamanan

### SEC-01: Super Admin PIN Tidak Di-hash Saat Pertama Kali (Seed)
- **File**: `src/utils/seed.ts`
- **Severity**: 🟡 Low-Medium
- **Deskripsi**: `seedSettings.superAdminPin` disimpan sebagai plain text di seed data. Saat pertama kali digunakan, PIN ini tersimpan plain text di localStorage dan cloud. PIN baru di-hash saat user mengubahnya via Settings (`updateSettings`). Ini berarti **semua instalasi default** memiliki PIN plain text yang bisa dibaca dari localStorage/Supabase.
- **Solusi**: Hash `superAdminPin` di seed data, sama seperti yang dilakukan untuk password user di `reseedCloudData()`.

### SEC-02: Manager PIN Bisa Dibaca dari localStorage
- **File**: `src/store/settingsStore.ts`
- **Severity**: 🟡 Low (mitigated oleh bcrypt hashing)
- **Deskripsi**: Meskipun `managerPin` sudah di-hash menggunakan bcrypt, hash bcrypt itu sendiri tersimpan di localStorage (`rempah-settings`). Seseorang dengan akses fisik ke perangkat bisa mencopy hash tersebut. Namun, karena bcrypt satu arah, ini bukan kerentanan langsung — hanya risiko brute-force offline.
- **Status**: Acceptable risk untuk MVP. Pertimbangkan server-side PIN verification di masa depan.

### SEC-03: Supabase Anon Key Tersimpan di Kode Frontend
- **File**: `.env`, `src/lib/supabase.ts`
- **Severity**: 🟡 Low (by design untuk Supabase anon key)
- **Deskripsi**: `VITE_SUPABASE_ANON_KEY` terekspos di bundle JavaScript frontend. Ini sesuai desain Supabase (anon key memang publik), tetapi tanpa **Row Level Security (RLS)** yang ketat, siapa pun yang mengetahui key ini bisa membaca/menulis data semua toko.
- **Dampak**: Tanpa RLS, data klien tidak aman dari exploit.
- **Solusi**: Implementasikan Supabase RLS policies (sudah ada di roadmap Phase 1).

---

## ☁️ Masalah Cloud Sync & Data Integrity

### SYNC-01: `syncSettings()` Mengirim Semua Settings Setiap Kali Ada Perubahan Kecil
- **File**: `src/store/settingsStore.ts` (baris 36-37)
- **Severity**: 🟡 Low
- **Deskripsi**: Setiap kali `updateSettings()` dipanggil (bahkan untuk perubahan kecil seperti toggle printer), **seluruh** objek settings dikirim ke cloud via upsert. Ini termasuk `store_logo` yang bisa berupa base64 string besar (~500KB). Pada koneksi lambat, ini memperlambat sync secara signifikan.
- **Solusi**: Kirim hanya field yang berubah menggunakan `smartUpdate()` daripada `smartUpsert()` untuk field-field tertentu.

### SYNC-02: Grace Period 30 Detik Bisa Menyebabkan Zombie Data
- **File**: `src/store/transactionStore.ts` (baris 121), `src/store/customerStore.ts` (baris 66-69)
- **Severity**: 🟡 Low
- **Deskripsi**: Item lokal yang dibuat dalam 30 detik terakhir dipertahankan saat fullSync (grace period). Jika cloud sync gagal selama >30 detik, item lokal bisa di-delete oleh fullSync berikutnya karena sudah melewati grace period — padahal item tersebut valid.
- **Dampak**: Data hilang jika koneksi tidak stabil selama >30 detik setelah pembuatan.
- **Solusi**: Pertimbangkan menggunakan flag `synced: boolean` per-item daripada grace period berbasis waktu.

### SYNC-03: `loadFromCloud` Transaksi Dibatasi 500 Records
- **File**: `src/lib/cloudSync.ts` (baris 141)
- **Severity**: 🟡 Low
- **Deskripsi**: `fetchTransactionsFromCloud()` hanya mengambil 500 transaksi terbaru. Untuk toko aktif dengan >500 transaksi, data lama tidak ter-sync ke device baru. Ini mempengaruhi laporan jika kasir login dari device baru.
- **Status**: Acceptable untuk MVP, tapi perlu pagination atau filter berdasarkan rentang tanggal di masa depan.

### SYNC-04: Format ID Kasir Non-UUID (`seed-kasir-001`) Memicu Postgres Error 22P02 pada Tabel Supabase
- **File**: `src/lib/cloudSync.ts` (`syncCashMovement`, `syncShift`)
- **Severity**: 🟡 Medium
- **Deskripsi**: Kolom `cashier_id` dan `shift_id` pada skema Supabase PostgreSQL bawaan sering kali bertipe `UUID`. Ketika user akun default (seperti `seed-kasir-001` atau ID custom string) membuat transaksi/kas keluar, Supabase menolak payload dengan error `ERROR: 22P02: invalid input syntax for type uuid: "seed-kasir-001"`. Akibatnya, `smartUpsert` gagal dan catatan kas keluar hanya tersimpan di browser lokal lalu hilang saat reload/fetch dari cloud.
- **Dampak**: Sinkronisasi catatan kas antar device gagal dan data kas hilang setelah refresh.
- **Solusi**:
  1. Lakukan sanitasi UUID (`isValidUuid`) pada `cloudSync.ts` sebelum pengiriman ke Supabase.
  2. Ubah tipe kolom di Supabase via SQL `ALTER TABLE public.cash_movements ALTER COLUMN cashier_id TYPE TEXT;`.

---

## 🎨 Bug UI/UX & Printing

### UI-01: Offline Queue Tidak Terlihat di Sidebar (✅ Fixed)
- **File**: `src/components/Layout.tsx`
- **Severity**: 🟡 Low
- **Deskripsi**: Ada indikator "Cloud Sync" di sidebar, tetapi jumlah operasi yang tertunda di offline queue tidak ditampilkan dengan jelas. Kasir tidak tahu berapa banyak data yang belum ter-sync.
- **Solusi**: Tampilkan badge dengan jumlah pending operations di samping indikator cloud.

### UI-02: Error Boundary Tidak Ada di Level Halaman (✅ Fixed)
- **File**: `src/App.tsx`
- **Severity**: 🟡 Low
- **Deskripsi**: Meskipun PRD menyebutkan "Error boundary (crash handling)", tidak ada komponen `ErrorBoundary` React yang terlihat di `App.tsx` atau wrapper halaman. Jika salah satu halaman lazy-loaded crash, seluruh app bisa menampilkan blank screen.
- **Solusi**: Tambahkan `<ErrorBoundary>` React component yang membungkus `<Suspense>` atau setiap route.

### UI-03: Baris Detail Kosong pada Struk & Tiket Dapur saat Opsi Kustomisasi Kosong/Selesai (✅ Fixed)
- **File**: `src/utils/printer.ts` (fungsi `printReceiptBrowser`, `printReceiptBluetooth`, `printKitchenReceiptBrowser`, `printKitchenReceiptBluetooth`)
- **Severity**: 🟡 Low
- **Deskripsi**: Ketika item menu tidak memiliki kustomisasi suhu (`showTemperature === false`), kustomisasi gula (`showSugarLevel === false`), dan tidak memiliki addons, string detail (`tempStr`, `sugarStr`, `addonStr`) bernilai kosong. Kode cetak tetap memasukkan baris detail `lines.push("  " + tempStr + sugarStr + addonStr)` yang memicu tercetaknya baris kosong berindentasi di struk fisik/browser.
- **Dampak**: Tampilan struk belanja dan tiket dapur menjadi tidak rapi/rancu dan membuang kertas printer thermal.
- **Solusi**: Lakukan pengecekan kondisi sebelum mencetak baris kustomisasi tersebut (hanya cetak jika minimal salah satu dari sugar/temperature/addons aktif atau memiliki nilai kustom).

---

## 🔧 Catatan Teknis & Tech Debt

### TECH-01: Inkonsistensi localStorage Key Prefix
- **Semua store files**: `src/store/*.ts`
- **Deskripsi**: Semua localStorage key masih menggunakan prefix `rempah-*` (contoh: `rempah-auth`, `rempah-settings`, `rempah-cart`). Meskipun ini tidak menyebabkan bug fungsional (karena key hanya perlu konsisten), prefix lama bisa membingungkan saat debugging setelah rebranding ke BerdikariPOS.
- **Catatan**: **JANGAN** ubah key ini tanpa migrasi data, karena akan menghapus semua data pengguna yang sudah ada.
- **Solusi**: Biarkan `rempah-*` prefix untuk backward compatibility, atau buat migrasi yang menyalin data dari key lama ke key baru.

### TECH-02: `bcryptjs` Digunakan di Frontend (Blocking Main Thread)
- **Deskripsi**: `bcryptjs` operasi hash/compare bersifat sinkron dan CPU-intensive. Pada perangkat low-end (tablet murah yang umum di F&B), `bcrypt.hashSync()` dengan salt rounds 10 bisa memblokir main thread selama 100-500ms, menyebabkan UI freeze saat login atau save PIN.
- **Solusi**: Gunakan `bcrypt.hash()` (async) atau pindahkan ke Web Worker.

### TECH-03: `import { v4 as uuid } from 'uuid'` — Bundle Size
- **Deskripsi**: Library `uuid` ditambahkan sebagai dependency utuh. Untuk mengurangi bundle size, bisa diganti dengan `crypto.randomUUID()` (native browser API, didukung semua browser modern).

### TECH-04: Tidak Ada Type Safety untuk Cloud Data
- **File**: `src/lib/cloudSync.ts`
- **Deskripsi**: Semua fungsi fetch dari cloud menggunakan mapping manual dari snake_case ke camelCase. Tidak ada validasi runtime (contoh: Zod schema) untuk memastikan data cloud sesuai dengan tipe TypeScript. Jika kolom database berubah atau berisi `null` tak terduga, app bisa crash tanpa error yang jelas.

---

## ✅ Bug Yang Sudah Diperbaiki (Riwayat)

| ID | Deskripsi | Status |
|---|---|---|
| BUG-01 | Password plain text di-overwrite oleh cloud sync | ✅ Fixed (BUG-C2) |
| BUG-02 | Nomor antrean duplikat antar device | ✅ Fixed (recalculate from merged data) |
| BUG-03 | Double deduction stok di cloud | ✅ Fixed (BUG-C1) |
| BUG-M1 | Race condition queue number | ✅ Fixed (dynamic max calculation) |
| BUG-M2 | Infinite re-render karena promo/loyalty deps | ✅ Fixed (useCallback/useMemo) |
| BUG-M3 | Duplicate audit/stock log inserts offline | ✅ Fixed (deduplicate inserts) |
| BUG-M4 | Manager PIN tidak di-hash (bcrypt) | ✅ Fixed |
| BUG-M5 | Loyalty settings tidak sync antar device | ✅ Fixed |
| BUG-M7 | Delete user yang masih memiliki shift aktif | ✅ Fixed (validasi sebelum delete) |
| BUG-M8 | Offline queue membengkak (duplikat upsert) | ✅ Fixed (deduplication) |
| BUG-K2 | Password migration race condition | ✅ Fixed (migratePasswords before loadFromCloud) |
| BUG-K3 | Stok tidak direvert saat transaksi cancel | ✅ Fixed (revertStock) |
| BUG-K4 | Manager tidak diwajibkan buka shift | ✅ Fixed (ShiftGuard) |
| BUG-C2 | Cloud overwrite hashed passwords | ✅ Fixed (protect local hash) |
| BUG-C3 | Shift tidak sync multi-device | ✅ Fixed |
| BUG-C4 | Stock logs / audit logs tidak sync cloud | ✅ Fixed |
| BUG-C5 | handleCheckout re-bind setiap render | ✅ Fixed (useCallback) |
| BUG-NEW-01 | Cart sebelumnya terlihat oleh user baru | ✅ Fixed (clearCart on logout) |
| BUG-NEW-02 | PIN hash muncul di input field | ✅ Fixed (start empty) |
| BUG-NEW-03 | Re-seed cloud dengan password plain text | ✅ Fixed (hash before sync) |
| BUG-NEW-05 | Shift aktif dari device lain tidak ter-detect | ✅ Fixed |
| BUG-NEW-06 | Loyalty discount tidak tampil di mobile cart | ✅ Fixed |
| BUG-NEW-07 | Promo sync gagal karena null createdAt | ✅ Fixed |
| FEAT-NEW-01 | Pengaturan Level Gula (tampilkan/sembunyikan gula level per-produk) | ✅ Done |
| BUG-CRIT-01 | Fitur Tema Warna UI Tidak Ada di Codebase | ✅ Fixed (Telah diimplementasikan pada `theme.ts`, `SettingsPage`, dan tipe data) |
| BUG-CRIT-02 | Tidak Ada Migrasi untuk `theme_color`/`theme_shades` di `cloudSync.ts` | ✅ Fixed (Telah ditambahkan pengecekan di `runMigrations`) |
| BUG-MED-04 | `fetchSettingsFromCloud()` tidak men-sync data tema | ✅ Fixed (Telah dipetakan di `fetch` dan `sync` settings) |
| BUG-MED-01 | `clearOperationalData()` tidak await cloud delete | ✅ Fixed (await clearCloudOperationalData) |
| BUG-MED-02 | `activeShift` tidak ter-restore saat reload | ✅ Fixed (prioritaskan local / check cloud) |
| BUG-MED-03 | Race condition pada nomor antrean multi-device | ✅ Fixed (query cloud max queue number) |
| BUG-MED-05 | `activeShift` gagal di-restore saat local session kosong | ✅ Fixed (restore open shift from cloud) |
| BUG-MED-06 | `dataManager` tidak membersihkan stock opnames | ✅ Fixed (clear rempah-stock-opnames) |
| LOGIC-ERR-01 | Settings merge conflict overwrite tanpa notifikasi | ✅ Fixed (Toast warning saat cloud menang konflik) |
| LOGIC-ERR-02 | Discount preview bisa melebihi subtotal | ✅ Fixed (Cap preview discount identik dengan finalizeTransaction) |
| LOGIC-ERR-03 | `recordVisit()` tidak dibalik saat transaksi batal | ✅ Fixed (Revert customer visit count & spent) |
| LOGIC-ERR-04 | Offline queue tidak menangani urutan operasi | ✅ Fixed (Sort ops: insert → upsert → update → delete) |
| LOGIC-ERR-05 | Format `lastQueueDate` tidak konsisten | ✅ Fixed (Gunakan timezone lokal konsisten) |
| LOGIC-ERR-06 | Stok tidak dipotong saat Cancel diubah ke Selesai | ✅ Fixed (Deduct stock on re-enable) |
| LOGIC-ERR-07 | Laporan penjualan tidak menampilkan `orderType` | ✅ Fixed (Order type breakdown doughnut chart) |
| LOGIC-ERR-08 | Duplikasi log stok pada Stock Opname | ✅ Fixed (skipLog option on updateItem) |
| UI-01 | Pending queue length tidak terlihat di sidebar | ✅ Fixed (Badge counter di samping status cloud) |
| UI-02 | Halaman lazy-loaded crash memicu blank screen | ✅ Fixed (Default ErrorBoundary di level root) |
| UI-03 | Baris kosong tercetak jika tidak ada kustomisasi | ✅ Fixed (Conditional print line checks) |
| PRINT-v4.0-01 | Singleton Bluetooth Connection Crosstalk (Semua printer terikat ke 1 device global) | ✅ Fixed (Refactor ke Printer Device Registry `Map<string, BluetoothConnection>`) |
| PRINT-v4.0-02 | Gagal cetak pada 1 printer memblokir printer lain / checkout | ✅ Fixed (Error isolation menggunakan `Promise.allSettled`) |
| PRINT-v4.0-03 | Lack of Independent Test Print & Duplicate Device Detection | ✅ Fixed (UI Card Settings + Test Print per printer + warning duplicate physical device) |

---

## 📋 Ringkasan Prioritas

| Prioritas | Jumlah Aktif | Item Aktif |
|-----------|--------------|------------|
| 🔴 Kritis | 0 | - |
| 🟠 Menengah | 0 | - |
| 🟡 Logic | 0 | - |
| 🔒 Keamanan | 3 | SEC-01 s/d SEC-03 |
| ☁️ Sync | 4 | SYNC-01 s/d SYNC-04 |
| 🎨 UI/UX | 0 | - |
| 🔧 Tech Debt | 4 | TECH-01 s/d TECH-04 |

**Total temuan aktif: 11 item**
**Total yang sudah diperbaiki: 47 item**

---

*Dokumen ini akan diperbarui secara berkala setiap kali dilakukan analisis baru atau bug diperbaiki.*
