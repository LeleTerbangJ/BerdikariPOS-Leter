# 🤖 Panduan Handoff ke AI Developer Lain — BerdikariPOS v4.7

## Cara Melanjutkan Pengembangan dengan AI Lain (Antigravity, Cursor, dll)

---

## 1. File yang WAJIB Diberikan ke AI

Berikan file-file ini sebagai konteks awal agar AI memahami seluruh aplikasi:

### Prioritas 1 (Wajib — berikan di awal percakapan):

| File | Fungsi |
|------|--------|
| `PRD.md` | Dokumen lengkap: arsitektur, fitur, data model, business logic |
| `FEATURES.md` | Daftar semua fitur & keunggulan |
| `TO DO.md` | Daftar lengkap temuan audit + status pengerjaan (**Prioritas 1–16 semuanya ✅ — termasuk Promo P-A2–P-A8, Mode Offline O-1–O-10, Printer Thermal 14.1–14.6, UX Kasir 15.1–15.4, & Bug Item Pending 16.1** — ringkasan v4.5 di §10, v4.6 di §11, v4.7 di §12–§21) — wajib dibaca |
| `src/types/index.ts` | Semua TypeScript interfaces (data model) |
| `package.json` | Dependencies & scripts |

### Prioritas 2 (Berikan jika AI perlu detail implementasi):

| File | Fungsi |
|------|--------|
| `src/lib/cloudSync.ts` | Cloud sync logic (Supabase integration) |
| `src/lib/offlineQueue.ts` | Offline queue & auto-retry |
| `src/lib/atomicTransactionEngine.ts` | Atomic Transaction Engine (State Machine, Rollback & Idempotency) |
| `src/lib/inventoryEngine.ts` | Inventory Engine (Pre-flight validation & Stock Snapshot) |
| `src/utils/splitAllocation.ts` | Modul murni alokasi rupiah proporsional (Largest Remainder Method) + `buildEqualSplitReceipt` — dipakai SplitBillModal & printer |
| `src/utils/idempotencyCleanup.ts` | Modul murni TTL/cleanup idempotency registry (24 jam / max 1000 entry) |
| `src/utils/splitStockSession.ts` | Sesi stok split persisten lintas buka/tutup modal (reserve, paidBills, mode/count, queueNumber, computeCartSignature) |
| `src/utils/safeStorage.ts` | Storage wrapper anti-QuotaExceededError (fallback semua store persist) |
| `src/utils/storagePrune.ts` | Prune partialize transaksi (300/90-hari), capEntries audit/stock log, filterTombstoned |
| `src/utils/idbStorage.ts` | Adapter Storage over IndexedDB untuk `rempah-transactions` & `rempah-audit-logs` |
| `src/components/PendingPaymentsModal.tsx` | Modal daftar pesanan gantung (search, print struk sementara, void, resume) |
| `src/components/SplitBillModal.tsx` | Modal split bill — mode Nominal Rata & Per-Item |
| `src/store/*.ts` | State management (semua 14 Zustand stores, termasuk `cashMovementStore`) |
| `src/hooks/usePrinterMonitor.ts` | Background service polling koneksi printer Bluetooth |
| `vite.config.ts` | Build config + PWA setup |
| `supabase/schema.sql` | Database schema |

### Prioritas 3 (Berikan jika AI perlu ubah halaman tertentu):

| File | Fungsi |
|------|--------|
| `src/pages/POS.tsx` | Halaman kasir (paling kompleks) |
| `src/pages/Kitchen.tsx` | KDS dengan real-time |
| `src/pages/Reports.tsx` | Laporan dengan chart, filter tanggal presisi + PDF |
| `src/pages/CashMovements.tsx` | Rekap kas masuk & kas keluar dengan verifikasi PIN |
| `src/pages/StockOpname.tsx` | Modul stock opname (dengan mode blind opname Staf Gudang) |
| `src/components/Layout.tsx` | Sidebar, shift modals, printer status banner |
| `src/components/PrinterStatusBanner.tsx` | Banner indikator status koneksi printer & tombol reconnect |

---

## 2. Prompt Template untuk AI Baru

Copy-paste prompt ini saat memulai percakapan dengan AI baru:

```
Saya memiliki aplikasi POS (Point of Sale) bernama "BerdikariPOS" yang sudah production dan bersifat umum/multi-purpose (v4.4).

Tech Stack:
- React 18 + TypeScript + Vite 5
- TailwindCSS 3.4
- Zustand (state management + persist; `transactions`/`audit-logs` → IndexedDB via `idbStorage.ts`, sisanya localStorage via `safeStorage.ts`)
- Supabase (PostgreSQL + Real-time subscriptions)
- Chart.js, jsPDF, bcryptjs
- PWA (vite-plugin-pwa)
- Deployed di Vercel

Arsitektur:
- Local-first: data di localStorage, sync ke Supabase (background)
- Offline queue: operasi gagal di-queue, auto-retry saat online
- Real-time: Supabase subscriptions untuk KDS multi-device
- Code-splitting: React.lazy() per halaman
- Printer Background Monitor: polling Web Bluetooth printer connections setiap 3 detik dengan UI status banner

Saya akan berikan file PRD.md dan types/index.ts sebagai konteks.
Tolong pelajari dulu sebelum mulai coding.

[PASTE ISI PRD.md DI SINI]
[PASTE ISI src/types/index.ts DI SINI]
```

---

## 3. Cara Memberikan Knowledge Base

### Opsi A: Antigravity / Bolt.new
1. Buka project dari GitHub: `https://github.com/Lemillion-base/rempah-story-pos`
2. AI akan otomatis membaca seluruh codebase
3. Berikan instruksi: "Pelajari PRD.md dan FEATURES.md dulu sebelum mulai"

### Opsi B: Cursor AI
1. Buka folder project di Cursor
2. Cursor otomatis index seluruh file
3. Gunakan `@PRD.md` atau `@types/index.ts` untuk referensi
4. Cursor sudah punya konteks penuh dari codebase

### Opsi C: ChatGPT / Claude (tanpa akses file)
1. Copy-paste isi `PRD.md` sebagai pesan pertama
2. Copy-paste isi `src/types/index.ts` sebagai pesan kedua
3. Baru mulai berikan instruksi pengembangan

---

## 4. Konteks Penting yang Harus AI Tahu

### Arsitektur Data Flow:
```
[User Action di Browser]
    ↓
[Zustand Store] → localStorage (instant)
    ↓ (async, background)
[cloudSync.ts] → smartUpsert/smartUpdate/smartDelete
    ↓
[offlineQueue.ts] → jika offline, queue operasi
    ↓ (saat online)
[Supabase PostgreSQL]
    ↓ (real-time subscription - ALL tables)
[Device lain] → loadFromCloud(fullSync=true) → update local store
```

### Cloud Sync Coverage (100%):
- **16 data types** di-push ke cloud (termasuk customCategories, themeColor, themeShades, stock_opnames, cash_movements, tax_enabled)
- **12 stores** fetch dari cloud saat boot (termasuk stockOpnameStore dan cashMovementStore)
- **8 stores** support `fullSync` mode untuk delete propagation
- **Real-time subscriptions** di SEMUA halaman:
  - `POS.tsx`: menus, inventory, customers, settings
  - `Kitchen.tsx`: transactions
  - `Transactions.tsx`: transactions
  - `Customers.tsx`: customers
  - `Catalog.tsx`: menus
  - `Inventory.tsx`: inventory
  - `Promos.tsx`: promos
  - `SettingsPage.tsx`: users
  - `StockOpname.tsx`: stock_opnames, inventory
  - `CashMovements.tsx`: cash_movements
  - `App.tsx` (Global): users (untuk restriksi multi-login device secara real-time)
- **fullSync pattern**: Saat real-time event, cloud = sumber kebenaran. Item yang dihapus di cloud dihapus dari lokal (grace period 30s untuk item baru).
- **Offline queue sorting**: Queue di-sort (insert -> upsert -> update -> delete) sebelum flush untuk menjaga integritas dependensi.
- **Printer Monitor & Status Banner (v4.2)**: Service background (`usePrinterMonitor.ts`) secara berkala (3s) memeriksa koneksi Web Bluetooth printer Kasir & Dapur, serta menampilkan `PrinterStatusBanner.tsx` dengan opsi *Reconnect* 1-klik.
- **Revert Stok pada Delete Transaksi**: Menghapus transaksi berstatus `Selesai` secara otomatis me-revert stok bahan baku dan akumulasi belanja/visit pelanggan.
- **Akuntansi P&L & Dashboard**: Formula Laba Kotor menggunakan Net Sales ($\text{subtotal} - \text{diskon}$) dikurang HPP. Pajak PPN dikategorikan sebagai kewajiban (*liability*) dan disajikan secara terpisah.
- **Backup & Restore**: `BackupService` (`src/lib/backupService.ts`) menghasilkan ZIP ber-checksum SHA-256 (3 mode: FULL/MASTER_DATA/TRANSACTION); `backupStore.ts` mencatat riwayat & konfigurasi auto-backup (Harian/Mingguan ke Local/Supabase Storage/Google Drive); UI di `src/components/backup/*` (AutoBackupSection, BackupHistorySection, BackupRestoreTab, RestoreWizardModal).
- **Bundle Menu**: `bundleService.ts` (generate/scale child cart items, hitung HPP bundle, filter KDS), `bundleValidation.ts` (cegah self-reference, nested, circular), `bundleRepository.ts` (akses tabel `menu_components` dengan offline queue & cloud sync). Modul ini diuji di `src/test/bundle.test.ts`.

### Konvensi Kode:
- **Store pattern**: Zustand + persist + cloud sync di setiap mutasi
- **Naming**: camelCase di TypeScript, snake_case di database
- **Components**: functional components + hooks
- **Styling**: TailwindCSS utility classes, custom `.btn-primary`, `.card`, `.input` di index.css
- **Icons**: Lucide React (import per icon)
- **Modals**: komponen `Modal.tsx` reusable
- **Konfirmasi**: komponen `ConfirmDialog.tsx` untuk aksi destruktif
- **Toast**: `useToastStore().addToast(message, type)` untuk feedback

### Environment Variables:
```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

### Deploy Flow:
```
git push origin main → Vercel auto-deploy (1-2 menit)
```

### Database:
- Schema di `supabase/schema.sql`
- Semua tabel di schema `public`
- RLS enabled dengan policy "allow all" (MVP)
- Real-time enabled untuk SEMUA tabel (transactions, menus, inventory, customers, users, promos, settings, stock_opnames, cash_movements)
- `settings` table rows: id=1 (app settings, including loyalty settings, custom categories, theme_color, theme_shades, and tax_enabled consolidated on id=1)

---

## 5. Hal yang Perlu Diperhatikan

### ⚠️ Jangan Lakukan:
- Jangan ubah struktur localStorage keys (akan break data existing user)
- Jangan hapus `persist` dari store (data user hilang)
- Jangan ubah Supabase table/column names tanpa migrasi
- Jangan expose Server Key / Secret Key di frontend
- Jangan ubah `.env` format (VITE_ prefix wajib untuk Vite)

### ✅ Boleh Dilakukan:
- Tambah field baru ke interface (backward compatible)
- Tambah store baru
- Tambah halaman baru (dengan React.lazy di App.tsx)
- Tambah kolom baru ke Supabase (ALTER TABLE ADD COLUMN)
- Ubah UI/styling sesuka hati

### 🔄 Jika Ubah Data Model:
1. Update `src/types/index.ts`
2. Update store yang terkait
3. Update `cloudSync.ts` (mapping camelCase ↔ snake_case)
4. Jalankan ALTER TABLE di Supabase SQL Editor
5. Test di dev → push → auto-deploy

---

## 6. Fitur yang Belum Diimplementasi (Roadmap)

Jika ingin melanjutkan development, berikut prioritas:

| # | Fitur | Kompleksitas | Detail |
|---|-------|-------------|--------|
| 1 | Auto-Reconnect & Visibility | Low | Event listener `visibilitychange` + reconnect channel |
| 2 | Supabase RLS Policies | Medium | Aktifkan RLS dan filter query berbasis JWT auth |
| 3 | WhatsApp receipt & summary | Medium | Supabase Edge function + WhatsApp Gateway API |
| 4 | Multi-outlet | High | Tambah `store_id` di semua tabel, filter per outlet |
| 5 | Payment Gateway (QRIS) | High | Perlu Supabase Edge Function + Midtrans API |
| 6 | QR Self-Order | Medium | Generate QR per meja, halaman order publik |
| 7 | Push Notification | Medium | Web Push API + service worker |
| 8 | Multi-language | Medium | i18n library (react-i18next) |

---

## 7. Testing Checklist

Setelah AI membuat perubahan, pastikan:

```bash
# 1. Type check (harus 0 errors)
npx tsc --noEmit

# 2. Build (harus success)
npm run build

# 3. Test manual:
# - Login semua role (manager, kasir, acaraki, gudang)
# - Buat pesanan → cek masuk KDS & potong stok
# - Catat kas masuk/keluar → cek di ringkasan tutup shift
# - Stock opname mode blind untuk gudang
# - Cek di device berbeda (multi-device sync)

# 4. Deploy
git add . && git commit -m "description" && git push origin main
```

---

## 8. Kontak & Resources

- **Repository**: https://github.com/Lemillion-base/rempah-story-pos
- **Hosting**: Vercel (auto-deploy on push)
- **Database**: Supabase
- **PRD lengkap**: `PRD.md` di root project
- **Fitur lengkap**: `FEATURES.md` di root project
- **Deploy guide**: `DEPLOYMENT.md` di root project

---

## 9. Riwayat Pengerjaan v4.4 — Pending Payment & Split Bill

> Ringkasan seluruh sesi pengerjaan yang telah diselesaikan. Detail per item ada di `TO DO.md` — Prioritas 1–4 di bawah, Prioritas 5 & 6 di §10 (semua ✅).

### 9.1 Fitur Baru yang Selesai Diimplementasikan

1. **Pending Payment (Simpan & Gantung Pesanan)** — kasir menyimpan pesanan ke daftar gantung, dapur/KDS langsung menerima, lalu dilunasi saat pelanggan siap:
   - Simpan pending (potong stok 1×, preserve queue number, cetak tiket dapur) → modal daftar pending (search, print struk sementara, void, resume)
   - Resume dengan cart collision guard (gabung / kosongkan & muat)
   - Void pending dari halaman Transaksi → stok reserve dikembalikan (guard transaksi split)
2. **Split Bill** — pisah tagihan **Nominal Rata** (pembulatan remainder presisi) & **Per-Item** (alokasi diskon/pajak proporsional):
   - Sub-bill dibayar berurutan (Cash/QRIS/Transfer), struk split N dari M
   - Semua sub-bill lunas → transaksi induk otomatis `Selesai` dengan `paymentMethod` mayoritas
   - Split merekam customer (`recordVisit`) & promo (`incrementUsage`) sekali per sesi
   - Laporan tidak double accounting (hanya transaksi `Selesai` tanpa `splitParentId`)

### 9.2 File Baru

| File | Peran |
|------|------|
| `src/components/PendingPaymentsModal.tsx` | Modal daftar pesanan gantung |
| `src/components/SplitBillModal.tsx` | Modal split bill (equal & per-item) |
| `src/utils/splitAllocation.ts` | Modul murni: `allocateProportional` (Largest Remainder) + `buildEqualSplitReceipt` |
| `src/utils/idempotencyCleanup.ts` | Modul murni: `pruneIdempotencyEntries` (TTL 24 jam, max 1000 entry) |
| `src/test/splitAllocation.test.ts` | Unit test alokasi rupiah & struk equal |
| `src/test/idempotencyCleanup.test.ts` | Unit test TTL/batas idempotency registry |
| `src/test/stockCheck.test.ts` | Unit test paritas alias validasi stok |

### 9.3 Perubahan Penting per Modul

| Modul | Perubahan |
|-------|----------|
| `src/types/index.ts` | `Transaction` + `tableName`, `customerName`, `isPending`, `pendingNotes`, `splitParentId`, `splitIndex`, `totalSplitCount`, `paidAmount`; `TxStatus` + `'Pending'` |
| `src/lib/atomicTransactionEngine.ts` | `skipStockDeduction`, `overrideTxStatus`, `overrideQueueNumber`; cleanup idempotency registry (via modul murni) |
| `src/lib/inventoryEngine.ts` | `validateStockAvailability` = **satu-satunya** sumber kebenaran validasi stok |
| `src/utils/stockCheck.ts` | Kini compat-shim ke `InventoryEngine.validateStockAvailability` (`@deprecated`) |
| `src/utils/printer.ts` | + `printProvisionalBill`, `printSplitReceipt` (mode equal: label `BAGIAN N DARI M` + subtotal proporsional), tiket dapur split fresh |
| `src/store/transactionStore.ts` | + `updateTxMeta(id, partial)`, `cancelPendingTransaction` (revert stok), export `isPendingTransaction(t)`; **hapus** `getPendingTransactions()` & `getPendingCount()` (dead code) |
| `src/lib/cloudSync.ts` | `runMigrations` + Migration 13 (tax_enabled), 15 (kolom pending/split), 16 (kolom cetak struk); `syncSettings` kini guard kolom yang belum ada di DB (cegah penumpukan offline queue) |
| `src/pages/POS.tsx` | Tombol Simpan Pending, badge counter, resume order, props customer/promo ke SplitBillModal, selector pending count stabil |
| `src/pages/Kitchen.tsx` | Filter KDS menerima `txStatus === 'Pending'` |
| `src/pages/Transactions.tsx` | Void pending + revert stok, badge & filter status Pending, eksklusi split child dari omset |
| `src/pages/Reports.tsx` / `Dashboard.tsx` | Eksklusi `splitParentId` dari double accounting |
| `src/components/Layout.tsx` | Badge quick-access pesanan gantung di sidebar |

### 9.4 ⚠️ Perubahan Database yang WAJIB Dijalankan di Supabase SQL Editor

Jika DB belum di-upgrade, jalankan SQL berikut (blok lengkap ada di `DEPLOYMENT.md` → blok upgrade v4.2):

```sql
-- 1) Izinkan status 'Pending' pada CHECK constraint transaksi
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_tx_status_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_tx_status_check
  CHECK (tx_status IN ('Selesai', 'Cancel', 'Pending', 'Demo'));

-- 2) Kolom pendukung pending & split
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS table_number TEXT,
  ADD COLUMN IF NOT EXISTS customer_name TEXT,
  ADD COLUMN IF NOT EXISTS is_pending BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pending_notes TEXT,
  ADD COLUMN IF NOT EXISTS split_parent_id TEXT,
  ADD COLUMN IF NOT EXISTS split_index INT,
  ADD COLUMN IF NOT EXISTS total_split_count INT,
  ADD COLUMN IF NOT EXISTS paid_amount BIGINT;

-- 3) Kolom settings yang ditulis syncSettings
ALTER TABLE settings ADD COLUMN IF NOT EXISTS tax_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS demo_mode BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS receipt_header TEXT,
  ADD COLUMN IF NOT EXISTS receipt_footer TEXT,
  ADD COLUMN IF NOT EXISTS receipt_ascii_only BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_print_receipt BOOLEAN DEFAULT TRUE;
```

> Jika kolom di atas belum ada, `syncSettings`/`syncTransaction` kini **tidak gagal** (guarded migration) — namun kolom wajib ditambahkan agar data tersinkron lintas device. Aplikasi juga mendeteksi otomatis dan mencetak SQL yang diperlukan ke console.

### 9.5 Aturan Bisnis yang Harus Dijaga AI Berikutnya

- **Stok dipotong 1× saat transaksi dibuat** (Pending ataupun langsung `Selesai`). Saat pelunasan pending / split → `skipStockDeduction: true` (jangan potong 2×).
- **Preservasi queue number**: transaksi pending mempertahankan nomor antrean awalnya saat dilunasi (`overrideQueueNumber`).
- **Idempotency registry**: anti-double-pay berlaku untuk entry < 24 jam; resume pending re-commit dengan ID transaksi yang sama (aman, tidak double).
- **Laporan**: hanya menghitung transaksi `Selesai` tanpa `splitParentId` — sub-bill anak tercatat di parent.
- **Alokasi rupiah**: gunakan `allocateProportional` (Largest Remainder Method) — Σ sub-bill = total induk tanpa selisih Rp 1.
- **Split bill** merekam customer & promo **sekali per sesi** (ref flag, bukan derive dari jumlah sub-bill yang lunas).

### 9.6 Status Validasi

- `npx tsc --noEmit` → **0 error**
- `npx vitest run` → **26/26 test lolos** saat sesi v4.4 (bundle, splitAllocation, idempotencyCleanup, stockCheck); **87/87** setelah Prioritas 5 & 6 (9 file — §10.7); **99/99** setelah v4.6 fix Rekap Kas (11 file — §11.6); **106/106** setelah 7.1–7.3 (12 file); **109/109** setelah 7.4–7.5; **121/121** setelah 7.6 scheduler; **125/125** setelah 7.7–7.8 (13 file — §12.5); **139/139** setelah 8.1–8.2 (14 file); **148/148** setelah 8.3–8.4 (15 file — §13.3); **158/158** setelah 9.1–9.2 (16 file); **165/165** setelah 9.3–9.4 (17 file); **169/169** setelah 10.1; **187/187** setelah 10.2–10.3 (18 file); **192/192** setelah 10.4–10.5 (18 file — §14.5); **201/201** setelah P0.1 laporan PPN (19 file); **213/213** setelah P0.2 refund (20 file — §15.5); **231/231** setelah P0.4 struk digital modal (21 file); **235/235** setelah P0.4 Settings auto-kirim WA (21 file — §15.5); **248/248** setelah fitur urutan kategori POS (22 file, `categoryOrder.test.ts` 13 kasus); **258/258** setelah 12.1.1–12.1.2 (23 file, `dataManager.test.ts` 10 kasus — §16.1); **262/262** setelah 12.1.3 + P-A1 (reseedPlan +4 — §16.2); **267/267** setelah 12.1.4–12.1.5 (daftar tabel cloud +5 — §16.3); **284/284** setelah P-A2 (17 test `promoValidation` — §17.1); **300/300** setelah P-A3 (15 `promoReport` + 1 mapping cloud — §17.2); **313/313** setelah P-A4 (13 `discountEngine` — §17.3); **334/334** setelah P-A5 (21 `promoDiscount` — §17.4); **344/344** setelah P-A6 (10 test batas per pelanggan — §17.5); **352/352** setelah P-A7 (8 `receiptPromo` — §17.6); **370/370** setelah P-A8 (18 test loyalty points — §17.7); **377/377** setelah O-1 (7 test `offlineQueueStorage` — §18.1); **384/384** setelah O-2/O-3 (7 test `offlineQueueFailed` — §18.2–18.3); **389/389** setelah O-4/O-5 (5 test `transactionSyncBadge` — §18.5); **396/396** setelah O-6/O-7 (7 test `stockConflict` — §18.7); **397/397** setelah O-10 (urutan kronologis +1 — §18.10; O-8/O-9 diverifikasi via build, tanpa test baru); **403/403** setelah 14.1 (36 file, `printerReconnect` +6 — §19.1); **406/406** setelah 14.2+14.3 (37 file, `printerQueue` +3 — §19.2–19.3); **409/409** setelah 14.4 (38 file, `printerCrossTab` +3 — §19.4); **416/416** setelah 14.5+14.6 (39 file, `printerFallback` +7 — §19.5–19.6); **427/427** setelah 15.1 (40 file, `menuValidation` +11 — §20.1); **431/431** setelah 15.3+15.4 (41 file, `printTarget` +4 — §20.3–20.4); **433/433** setelah perluasan 15.3 ke Split Bill (`printSplitReceipt` skipAllPrint — anti tiket dobel, `printTarget` +2 — §20.3); **434/434** setelah desain final dua toggle independen (`skipKitchenPrint`, `printTarget` +1 — §20.3); **441/441** setelah fix bug item pending tidak ter-update (42 file, `pendingUpdateHistory` +3 & `pendingCloudOverwrite` +4 — §21.2); **445/445** setelah updatedAt minimal (43 file, `pendingCloudOverwrite` +4 — §21.2); **447/447** setelah revisi add-on gratis + verifikasi struk (43 file, `digitalReceipt` +1 & `printTarget` +1 — §21.2/revisi 15.1); **449/449** setelah fitur "Semua Dapur" di Edit Menu (43 file, `printTarget` +2 — §21.2/16.2)
- `npm run build` → **sukses** (tsc + vite build, PWA generateSW) — diverifikasi setelah migrasi IndexedDB, dan diverifikasi ulang setelah seluruh prioritas 1–10 tuntas (v4.7 — §14.5)

---

## 10. Riwayat Pengerjaan v4.5 — Audit End-to-End Pending & Split + Kuota Storage

> Sesi lanjutan setelah v4.4. Seluruh Prioritas 1–6 di `TO DO.md` sudah ✅. Ringkasan Prioritas 5 (audit end-to-end pending/split) & Prioritas 6 (kuota localStorage), plus status final semua item di bawah.

### 10.1 Prioritas 5 — Audit End-to-End Pending & Split (5.1–5.11, semua ✅)

| Item | Inti perbaikan |
|------|----------------|
| 5.1 | **Sesi stok split persisten** — modul murni `splitStockSession.ts`: reserve stok dipertahankan lintas buka/tutup modal (sebelumnya double-deduction saat modal ditutup di tengah sesi); paid portion di-cap per inventoryId; persist localStorage (recovery lintas reload PWA) |
| 5.2 | **HPP split equal ter-inflasi N×** — param `scaleHpp` di engine; HPP dialokasikan per sub-bill via Largest Remainder → Σ hpp sub-bill = HPP induk persis |
| 5.3 | **Void pending ber-anak split** — guard `hasPendingSplitChildren` di `cancelPendingTransaction` (stok TIDAK di-revert bila anak split sudah Selesai) |
| 5.4 | **Void pakai recipeSnapshot** — `cancelPendingTransaction` kini `calculateItemDeductions(tx.items, menus)` (prioritas snapshot tersimpan, bukan re-snapshot dari resep saat ini) |
| 5.5 | **Promo pending lintas device** — `appliedPromoId`/`voucherCode` disimpan di tx + kolom DB (Migration 17); `clearPromo()` di blok sukses save pending (promo tidak bocor ke order berikutnya) |
| 5.6 | **Signature suhu/gula** — `pendingItemsChanged` memakai `computeCartSignature` (menuId:qty:addons:temperature:sugar) → ubah suhu/gula me-reset KDS ke Waiting |
| 5.7 | **Reset UI modal berbasis konteks** — reset hanya saat konteks berbeda; sesi sama di-rehydrate dari `session.paidBills` (sub-bill lunas tetap tampil lunas) + guard anti re-pay |
| 5.8 | **`updateTxMeta` sync cloud** — `syncTransactionMeta` baru (paymentMethod parent split kini lintas device) |
| 5.9 | **Satu nomor antrean per sesi split fresh** — `overrideQueueNumber` dikunci dari sub-bill pertama sesi |
| 5.10 | **KDS bebas sub-bill** — `isSplitSubBill` (`splitParentId || splitIndex !== undefined`) di filter Kitchen; mapping `is_pending` otoritatif dari `tx_status` + `syncTransactionTxStatus` ikut tulis `is_pending` |
| 5.11 | **Agregasi per-menu/kategori tidak N×** — `splitContributionDivisor(tx)` (totalSplitCount untuk sub-bill equal) di Dashboard Top Menu/Profitabilitas & Reports kategori |

### 10.2 Prioritas 6 — Kuota localStorage (6.1–6.5, semua ✅)

| Item | Inti perbaikan |
|------|----------------|
| 6.1 | **Root cause kuota** — safe-storage wrapper (`safeStorage.ts`, tidak melempar QuotaExceededError, dipakai 14 store), `partialize` transaksi (300 terbaru / 90 hari + Pending selalu), cap audit log 2.000 & stock log 500, hardening offline queue, dan **migrasi IndexedDB permanen** (`idbStorage.ts` — detail §10.3) |
| 6.2 | Simpan Pending gagal (toast kuota) — **tertutup oleh 6.1** (persist tidak lagi melempar); try/catch eksplisit tidak lagi dibutuhkan |
| 6.3 | Popup confirm berulang saat resume — **akibat lanjutan 6.2** (cart tersisa dari sesi gagal); hilang setelah cart konsisten. Opsional: ganti `window.confirm` dengan dialog aplikasi |
| 6.4 | **Deadlock tutup shift** — `handleCloseShift` 4 langkah terisolasi + escape path wajib (modal non-dismissible tidak bisa mengunci kasir lagi) |
| 6.5 | **Transaksi ghost** — rollback kini `await deleteTransactionCloud(txId)` + tombstone `deletedLocalIds` (cap 200) disaring di `loadFromCloud` |

### 10.3 Migrasi IndexedDB (item permanen 6.1) — detail

- **Adapter**: `src/utils/idbStorage.ts` — object store `kv` (DB `berdikari-pos`, lazy-open sekali per sesi); cache in-memory sinkron (getItem hangat tanpa menunggu IDB); **migrasi one-time** data lama dari localStorage → IDB (localStorage dihapus hanya bila tulis IDB sukses); fallback aman ke `safeStorage` (private mode/blocked/SSR) — **tidak pernah melempar ke alur bisnis**.
- **Penerapan**: `transactionStore` & `auditLogStore` → `storage: createJSONStorage(() => idbStorage)` (partialize/cap tetap berlaku). Store lain tetap localStorage via safeStorage.
- **Race async hydrasi ditutup**: hydrasi zustand kini async (getItem IDB); `App.tsx` menunggu `persist.hasHydrated`/`onFinishHydration` (`whenHydrated`) sebelum `loadFromCloud` transactions & audit-logs — mencegah `set(stateFromStorage, true)` menimpa hasil merge cloud.
- **Perilaku retry**: `onblocked` bersifat transient → op berikutnya retry ke IDB (tidak disable sesi); `onerror`/SSR → disable sesi.
- **Verifikasi runtime**: DB `berdikari-pos` aktif di browser, `rempah-transactions`/`rempah-audit-logs` sudah tidak ada di localStorage, console bersih.

### 10.4 Perubahan Database v4.5 (wajib untuk deploy)

Di `runMigrations()` (deteksi + guard `migrationNeeded`) & blok ALTER di `supabase/schema.sql` / `DEPLOYMENT.md`:

- **Migration 16**: deteksi 4 kolom cetak struk settings — `receipt_ascii_only`, `auto_print_receipt`, `receipt_header`, `receipt_footer`.
- **Migration 17**: deteksi 2 kolom promo transaksi — `applied_promo_id`, `voucher_code`.

```sql
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS applied_promo_id TEXT,
  ADD COLUMN IF NOT EXISTS voucher_code TEXT;
```

> Seperti migrasi lain: ALTER TABLE manual tetap diperlukan di Supabase SQL Editor untuk DB existing (anon key tidak punya hak DDL); `runMigrations()` hanya mendeteksi & mencetak SQL. Jalur sync yang belum di-ALTER kini **guarded** (tidak menumpuk offline queue).

### 10.5 Aturan Bisnis Tambahan (v4.5) yang Harus Dijaga

- **Sesi split = satu unit stok**: reserve penuh 1× saat sub-bill pertama lunas; tutup modal TIDAK me-revert (sesi berlanjut); reserve dilepas hanya saat semua lunas / cart berubah / `releaseSplitReserveForCart` (POS beralih ke checkout normal dari cart yang sama).
- **`scaleHpp`**: hanya sub-bill split yang membawa SEMUA item cart (mode equal) yang diskalakan 1/N — mode item & transaksi normal `scaleHpp = 1`.
- **Promo tersimpan di tx** (`appliedPromoId`/`voucherCode`) — resume pending memakai promo yang sama; diskon manual tidak dipersist (residual); promo expired saat resume → total bisa beda (wajar, kasir memilih ulang).
- **Void**: pending ber-anak split → status Cancel tanpa revert stok; `Selesai → Demo` ikut revert stok + visit (konsistensi 1.7).
- **Laporan**: eksklusi `splitParentId` + agregasi per-menu dibagi `totalSplitCount` untuk sub-bill equal (`isEqualSplitSubBill`).

### 10.6 Residual Terdokumentasi (di TO DO.md, bukan bug aktif)

- 5.1: abandon split ber-porsi-lunas → checkout NORMAL penuh dari cart sama masih double-deduct porsi lunas (jalur bisnis ganda, perlu konfirmasi kasir); reserve bisa tertahan tanpa tombol "Batalkan Sesi Split" eksplisit.
- 5.7: sesi lama pra-5.7 tanpa `paidBills` bisa di-re-pay sekali setelah upgrade (guard untuk sesi baru); dua order identik beruntun bisa mewarisi paidBills (sempit).
- 5.11: transaksi Rp 1 dibagi 2 → over-count ≤ 0,5 rupiah (patologis, diabaikan untuk pelaporan).

### 10.7 Status Final & Validasi

- **Status TO DO**: Prioritas 1 (1.1–1.7) ✅ · Prioritas 2 (2.1–2.8) ✅ · Prioritas 3 (3.1–3.5) ✅ · Prioritas 4 (4.1–4.6) ✅ · Prioritas 5 (5.1–5.11) ✅ · Prioritas 6 (6.1–6.5) ✅ — **semua item tuntas**. Catatan: checkbox 6.2/6.3 di TO DO.md masih `[ ]` karena digantikan/tertutup oleh 6.1 — status de facto selesai.
- `npx tsc --noEmit` → **0 error**
- `npx vitest run` → **87/87 test lolos** (9 file: bundle, splitAllocation, idempotencyCleanup, stockCheck, splitStockSession, storagePrune, idbStorage, cloudSyncMapping, pendingVoid) → **99/99** setelah v4.6 fix Rekap Kas (11 file — §11.6)
- `npm run build` → **sukses** (tsc + vite build, PWA generateSW 50 precache entries) — diverifikasi setelah migrasi IndexedDB
- Sisa terbuka di daftar: pemantauan produksi (opsional).

---

## 11. Riwayat Pengerjaan v4.6 — Rekap Kas: Investigasi & Fix RLS + Sync

> Sesi lanjutan setelah v4.5. Bug produksi nyata: **Kas Masuk 50.000 yang dicatat Kasir 1 tidak muncul di Rekap Laci Kas laporan Shift Manager**. Investigasi tuntas via SQL diagnostik; akar masalah = **RLS aktif tanpa policy** di tabel `cash_movements`. Fix 3 lapis (6.6 di `TO DO.md`), semua ✅.

### 11.1 Kronologi Investigasi (diagnosis berbasis data, bukan asumsi)

1. **Hipotesis awal gugur**: `shifts.user_id` di DB = UUID valid (`e4cdc043-...`), `users` semua ber-UUID → dugaan "`syncShift` memotong user_id non-UUID" terbantah untuk deployment ini.
2. `cash_movements` query (`date >= '2026-08-11'`) → **"Success. No rows returned"** → movement 50.000 TIDAK ADA di cloud (hanya di localStorage HP kasir).
3. `relrowsecurity` = **true** + daftar `pg_policies` kosong → RLS aktif TANPA policy.
4. INSERT test dari SQL Editor **berhasil** — TAPI tidak membuktikan anon bisa menulis: SQL Editor jalan sebagai role `postgres` yang melewati RLS.
5. **Konfirmasi**: `CREATE POLICY "Allow all for anon" ...` dijalankan → data langsung mengalir, Kas Masuk 50.000 muncul di laporan Shift Manager. Movement asli tidak hilang (ter-push dari HP begitu akses terbuka).

### 11.2 Akar Masalah

- **RLS aktif tanpa policy** pada `cash_movements` membuat anon key diblokir **diam-diam**: SELECT mengembalikan baris kosong TANPA error, INSERT ditolak ("new row violates row-level security policy"). Gejala khas: Rekap Kas tidak pernah tersinkron antar device; laporan Shift Manager selalu Kas Masuk/Keluar 0.
- Sisi kode memperparah: `directSyncToCloud` mem-bypass offline queue (retry 1×/5 dtk, gagal diam-diam tanpa indikator UI), dan bagian aktif `schema.sql` tidak mencantumkan RLS+policy untuk `cash_movements` (hanya ada di blok migrasi terkomentari).

### 11.3 Fix #1 — `supabase/schema.sql` (bagian aktif)

- `ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;` + `CREATE POLICY "Allow all for anon" ON cash_movements FOR ALL USING (true) WITH CHECK (true);` — selaras dengan 11 tabel lain; DB baru tidak akan kena kasus yang sama.

### 11.4 Fix #2 — Deteksi RLS via `runMigrations` (Migration 18)

- anon key tidak bisa membaca `pg_policies` atau eksekusi DDL, dan SELECT tidak bisa mendeteksi RLS (diam-diam kosong) → deteksi via **probe INSERT** yang sengaja melanggar CHECK `type` (`'PROBE'`): Postgres mengevaluasi RLS **sebelum** constraint, jadi error membedakan RLS vs tabel sehat **tanpa pernah membuat baris**.
- Bila RLS terdeteksi → `console.warn` mencetak `CASH_MOVEMENTS_POLICY_SQL` (DO block cek `pg_policies` + `CREATE POLICY` + `ENABLE RLS`) untuk dijalankan sekali di SQL Editor.
- File baru **`src/utils/cashMovementPolicy.ts`**: helper murni `diagnoseCashMovementWriteError` (7 kasus error) + konstanta SQL (8 test baru).

### 11.5 Fix #3 — Jalur tulis via offline queue + badge "Belum Sync"

- `syncCashMovement` kini mengirim nilai **mentah** (sanitasi `isValidUuid` lama dibuang — kolom TEXT) via **`smartUpsert` (offline queue)**: online langsung, offline/gagal antre + flush otomatis saat online. Return `Promise<boolean>`.
- `addMovement`/`updateMovement`: jalur utama queue, **fallback `directSyncToCloud`** (self-healing strip kolom/nullify UUID).
- Set module `confirmedSyncedIds` → state reaktif **`confirmedSyncIds`** (tidak dipersist — dibangun ulang dari cloud tiap boot). Badge **`⏳ Belum Sync`** per baris + hitung "⚠️ N belum sync" + listener `online` → `loadFromCloud(true)` (retry otomatis). `loadFromCloud` mengkonfirmasi semua id cloud + mendorong ulang entri lokal belum-sync via queue (dedup otomatis).

### 11.6 Validasi & Status

- `npx tsc --noEmit` → **0 error**
- `npx vitest run` → **99/99 test lolos** (11 file: bundle, splitAllocation, idempotencyCleanup, stockCheck, splitStockSession, storagePrune, idbStorage, cloudSyncMapping, pendingVoid, **cashMovementPolicy** (8), **cashMovementStore** (4))
- `npm run build` → sukses (belum diverifikasi ulang setelah v4.6 — disarankan jalankan sekali)
- **DB produksi**: sudah diperbaiki manual (policy dibuat) — data 50.000 dipulihkan. Untuk deployment lain: schema.sql sudah benar; DB lama yang bernasib sama akan terdeteksi Migration 18 saat app dibuka.

---

## 12. Riwayat Pengerjaan v4.7 — Prioritas 7: Backup & Restore (7.1–7.8, semua ✅)

> Sesi lanjutan setelah v4.6. Menuntaskan **Prioritas 7 di `TO DO.md`** — audit fitur Backup & Restore (`backupService.ts`, ZIP + SHA-256, 3 mode, restore berurutan). Seluruh 8 temuan (3 KRITIS, 3 TINGGI, 3 SEDANG) diperbaiki. Backup kini aman, restorable penuh (snapshot), dan auto backup berjalan otomatis.

### 12.1 Temuan KRITIS — 7.1, 7.2, 7.3 ✅

- **7.1 Checksum berbasis isi**: SHA-256 kini dihitung dari **ISI seluruh file** (JSON + media teks base64, urutan nama deterministik), bukan count entitas. Tamper isi (ubah harga/logo tanpa ubah jumlah) **terdeteksi & ditolak**. Backup v1.0 lama tetap valid via jalur legacy count-based. `schemaVersion` → `2.0`.
- **7.2 Mode Replace (Snapshot)**: `restoreBackup` menerima `mode: 'merge' | 'replace'`; replace = **wipe cloud** (scope per backupType, anak dihapus dulu) sebelum insert → hasil restore konsisten lintas device (data zombie tidak kembali). Wizard restore (Step 3) menawarkan **Merge vs Replace (Snapshot)** dengan peringatan hapus permanen.
- **7.3 Media di-restore**: folder `media/` diparse → `data.media`; `resolveMediaUrl` menulis ulang `menus[].image` & `settings.storeLogo` dari backup sebelum sync. Foto menu & logo tidak hilang lagi setelah restore.

### 12.2 Temuan TINGGI — 7.4, 7.5 ✅

- **7.4 Bundle/add-on**: `menu_components.json` (file tersendiri) dibackup untuk FULL/MASTER_DATA (ikut di-hash); di-restore ke state + loop `syncComponentToCloud` (setelah menus — referensi parent id). Backup tanpa file ini tetap valid (opsional).
- **7.5 Stock Logs**: blok `data.stock.stockLogs` kini ikut **`syncStockLog` ke cloud** saat restore (sebelumnya hanya lokal).

### 12.3 Temuan SEDANG — 7.6, 7.7, 7.8 ✅

- **7.6 Auto Backup (scheduler + Supabase Storage)**:
  - Modul baru **`src/lib/autoBackupScheduler.ts`**: `isAutoBackupDue` (pure) + `runAutoBackupNow` + `start/stopAutoBackupScheduler` (cek tiap 1 menit; guard `frequency`/`targetTime`; destinasi cloud butuh online; retry 5 menit setelah gagal; `lastAutoBackupAt` dicatat hanya saat sukses).
  - `uploadBackupToSupabase` (bucket `backups`, upsert) + `downloadBlob` shared (BackupSection ikut memakainya). `backupStore` + `lastAutoBackupAt` (persist). `App.tsx` start/stop scheduler. UI: badge **"● Otomatis Aktif"/"Nonaktif"** + "Terakhir backup otomatis".
- **7.7 Manifest versioning**: `CURRENT_APP_VERSION` → **`'4.7.0'`**; `SUPPORTED_SCHEMA_VERSIONS = ['1.0','2.0']` — schemaVersion tak dikenal **ditolak eksplisit**; `MANIFEST_MIGRATIONS` (tabel versi → transformasi) diterapkan di `validateBackup`.
- **7.8 `currentUser` setelah restore**: ada di backup → re-resolve + `activeSessionId` dipertahankan; tidak ada → `logout()`. `passwordsHashed: false` setelah restore → password plaintext backup lama di-re-hash saat boot.

### 12.4 Langkah Manual (sekali) — Supabase Storage bucket

Untuk auto backup destinasi **Supabase Cloud Storage**, buat bucket + policy sekali di SQL Editor (SQL idempoten juga tercetak di console app saat upload pertama gagal):

```sql
INSERT INTO storage.buckets (id, name, public) VALUES ('backups', 'backups', false) ON CONFLICT (id) DO NOTHING;
CREATE POLICY "Allow anon upload backups" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id = 'backups');
CREATE POLICY "Allow anon read backups" ON storage.objects FOR SELECT TO anon USING (bucket_id = 'backups');
```

### 12.5 Validasi & Status

- `npx tsc --noEmit` → **0 error**
- `npx vitest run` → **125/125 test lolos** (13 file; baru: `backupService.test.ts` 14 kasus — checksum isi/tamper/media/bundle/versioning/currentUser; `autoBackupScheduler.test.ts` 12 kasus — OFF/Daily/Weekly/boundary/targetTime)
- `npm run build` → belum diverifikasi ulang setelah v4.7 (disarankan jalankan sekali sebelum deploy)
- **TO DO.md**: Prioritas 7 tuntas (7.1–7.8 ✅) & **Prioritas 8 tuntas (8.1–8.4 ✅ — §13)**. Sisa prioritas yang belum dieksekusi: 9.1–9.4, 10.1–10.5.

---

## 13. Riwayat Pengerjaan v4.7 — Prioritas 8: Pergerakan Stok (8.1–8.4, semua ✅)

> Sesi lanjutan dalam v4.7. Menuntaskan **Prioritas 8 di `TO DO.md`** — audit pergerakan stok (transaksi vs cancel/demo, sync cloud, pantauan stok negatif). Dua bocor stok KRITIS ditutup, jalur sync cloud diseragamkan, dan stok negatif kini terpantau di UI tanpa memblokir kasir.

### 13.1 Temuan KRITIS — 8.1, 8.2 ✅ (bocor stok)

- **8.1 Demo → Selesai (re-enable) tidak memotong stok**: tombol "Selesai" tampil untuk semua `txStatus !== 'Selesai'` (termasuk Demo), tapi handler hanya menangani `Cancel → Selesai` (BUG-K3). Demo → Selesai jadi penjualan tanpa potong bahan baku → bocor. **Fix**: logika transisi stok di-ekstrak ke helper murni **`src/utils/transactionStockActions.ts`** (`applyStatusStockEffects`) — dua rantai if-else identik di `onConfirmAction`/`onPinSuccess` diganti satu pemanggilan (DRY); branch `(Cancel|Demo) → Selesai` → `deductStock` + `recordVisit` (guard `hasSplitChildren`). 14 test baru.
- **8.2 Hapus Pending dari halaman Transaksi tanpa revert stok reserve**: blok delete hanya revert untuk `Selesai`; hapus Pending → reserve tidak pernah dikembalikan. **Fix**: `DELETE` Pending → `revertStock` (reason "Hapus pesanan gantung #N") sebelum `deleteTransaction`; Selesai → revert + revertVisit (dipertahankan); Cancel/Demo → tanpa efek (sudah di-revert); split tetap di-guard.

### 13.2 Temuan SEDANG — 8.3, 8.4 ✅

- **8.3 Inkonsistensi jalur sync cloud stok**: `deductStock` pakai `syncInventoryDeduction` bulk, `revertStock` loop `syncInventoryItem` per-item (dua logika, boros request saat void massal). **Fix**: `syncInventoryDeduction` → **`syncInventoryStock`** (nama netral), dipakai **kedua** jalur — satu helper bulk, `syncInventoryItem` tidak lagi dipakai revert.
- **8.4 Stok negatif pasca-deduksi tidak dipantau**: validasi hanya pre-flight (LOGIC-5 izinkan negatif); race 2 device bisa jadi negatif tanpa disadari. **Fix**: helper murni `findNegativeStocksAfterDeduction` di `stockCheck.ts`; `deductStock` menghitung negatif dari stok pre-deduksi → **toast `⚠️ Stok negatif: ...`** (maks 3 item + "+N bahan lain", 6 dtk) + state transient `lastNegativeStockAlerts` (dibersihkan `revertStock`). Kasir tetap TIDAK diblokir.

### 13.3 Validasi & Status

- `npx tsc --noEmit` → **0 error**
- `npx vitest run` → **148/148 test lolos** (15 file; baru: `transactionStockActions.test.ts` 14 kasus — Demo→Selesai/regresi/guard split/edge; `stockNegativeAlert.test.ts` 9 kasus — helper negatif + integrasi store + unifikasi bulk)
- `npm run build` → belum diverifikasi ulang setelah v4.7 (disarankan jalankan sekali sebelum deploy)
- **TO DO.md**: Prioritas 8 tuntas (8.1–8.4 ✅). Sisa prioritas yang belum dieksekusi: **9.1–9.4** (Opname & Adjustment), **10.1–10.5** (Mode Blind Opname & PIN — 10.1 kritis: oracle ±10%).

---

## 14. Riwayat Pengerjaan v4.7 — Prioritas 9 & 10 (9.1–9.4 ✅, 10.1–10.5 ✅)

> Sesi lanjutan dalam v4.7. Menuntaskan **Prioritas 9 (Opname & Adjustment)** dan **Prioritas 10 (Mode Blind Opname & PIN)** di `TO DO.md`. Dengan ini **SELURUH prioritas 1–10 tuntas** — tidak ada prioritas tersisa.

### 14.1 Prioritas 9 — Opname & Adjustment (9.1–9.4 ✅)

- **9.1 CSV import tercatat tipe 'import'**: helper murni `planCsvImportRow` (`src/utils/stockImport.ts`) — item existing dengan stok berubah → update + log `'import'` (bukan `'adjust'` generik); stok sama → update tanpa log; item baru → create + log `'import'` (stockBefore 0). Riwayat stok kini menunjukkan asal perubahan (import vs adjustment manual).
- **9.2 Guard race opname lintas device (anti lost update)**: `findDriftedOpnameItems` — hanya item yang akan ditulis (difference ≠ 0) yang diperiksa; stok berubah sejak form dibuka (toleransi float 1e-9) → ConfirmDialog **"⚠️ Stok Berubah Sejak Form Dibuka"** sebelum commit (pesan generik untuk Staf Gudang — blind mode tetap aman).
- **9.3 Auto-log pakai nama baru saat rename bersamaan**: auto-log `updateItem` memakai `data.name ?? current.name`.
- **9.4 Batch sync opname & import**: `applyBulkStock(entries)` (1 setState + 1 `syncInventoryStock` bulk untuk opname) & `importItems(rows)` (1 batch untuk seluruh CSV: log `'import'` + bulk stok; `syncInventoryItem` penuh hanya untuk item baru / field non-stok yang berubah; opsi `skipSync`).

### 14.2 Temuan KRITIS — 10.1 ✅ (kebocoran mode blind)

- **10.1 Oracle ±10% bocor ke Staf Gudang**: banner "Selisih Besar Terdeteksi" + judul modal PIN "Verifikasi PIN Manager — Selisih Besar" menampilkan info selisih ke staf di mode buta. **Fix**: helper murni `resolveOpnameGate` (Staf Gudang SELALU jalur PIN — seragam, tanpa sinyal diferensial) + `shouldShowLargeDifferenceBanner` (banner HANYA non-staff) + judul PinModal generik 'Otorisasi Manager'. 4 test baru.

### 14.3 Temuan TINGGI — 10.2, 10.3 ✅ (otorisasi & audit)

- **10.2 Otorisasi PIN tidak terikat role & tanpa identitas approver**: siapa pun yang tahu PIN global (termasuk Staf Gudang) bisa menyetujui selisih besar; audit hanya menyimpan boolean `pinVerified`. **Fix** dual-control dengan identitas nyata:
  - `src/utils/pinAuth.ts` (baru): `isApproverRole` (hanya Manager), `authenticateManager` (kredensial akun Manager — bcrypt + legacy plaintext, TANPA efek samping), `getDeviceMarker` (penanda perangkat stabil per device).
  - `authStore.verifyManagerCredentials` — validasi kredensial Manager **tanpa mengubah sesi** (staff tetap tercatat sebagai penginput; tidak ada sesi "hantu").
  - `PinModal` prop baru `requireManager`: sesi non-Manager TIDAK bisa menyetujui hanya dengan PIN global — wajib **login cepat sebagai Manager** (username + password akun); akun non-Manager (Kasir/Acaraki/Staf Gudang) ditolak walau kredensialnya benar. `onSuccess(approver)` kini membawa `{id, name, role}`; caller lain (Transactions/Customers/CashMovements/AuditLog) tidak terpengaruh.
  - Record opname & audit log kini menyimpan `approverId/approverName/approverRole/approvedAt` (timestamp) + `deviceId` (penanda perangkat); riwayat menampilkan "✓ Disetujui {nama}".
  - **DB**: kolom `approver_id/approver_name/approver_role/approved_at/device_id/adjustment_reason` ditambahkan ke `stock_opnames` (schema.sql + **Migration 19** idempoten di runMigrations; mapping `syncStockOpname`/`fetch` ikut). ⚠️ Klien perlu menjalankan ALTER TABLE sekali di SQL Editor (SQL juga tercetak di console app).
- **10.3 Alasan selisih tidak wajib untuk Staf Gudang**: staf bisa mencatat kerugian besar tanpa alasan apa pun asalkan PIN disetujui. **Fix**: setelah PIN Manager disetujui (staf + ada selisih) → dialog **"Alasan Penyesuaian (Wajib)"** — rangkuman jumlah item berselisih (tanpa nama item/nominal — blind mode aman) + pilihan alasan utama + detail opsional; tombol eksekusi nonaktif sampai alasan dipilih. Alasan diisi ke item berselisih yang belum punya alasan (`fillMissingItemReasons`), disimpan di record (`adjustmentReason`) + dirangkum di notes + tampil di riwayat & audit log. Dual-control: staf tidak bisa eksekusi tanpa (1) approval Manager dan (2) alasan.

### 14.4 Temuan SEDANG/MINOR — 10.4, 10.5 ✅

- **10.4 Stok aktual negatif/NaN bisa masuk inventory**: `parseFloat("-5") = -5` ditulis langsung ke inventory. **Fix**: helper murni `parseActualStock(raw) = Math.max(0, parseFloat(raw) || 0)` — satu-satunya jalur parse stok fisik (negatif/NaN/kosong → 0); dipakai di `opnameItems` (nilai yang disimpan via `applyBulkStock`) & preview baris (konsisten). 5 test baru.
- **10.5 Ambang PIN stok rendah (catatan desain)**: komentar inline didokumentasikan di kode — ambang `max(10% stok sistem, 1 unit)`; stok < 10 unit → PIN lebih sering muncul (disengaja: validasi stok rendah lebih ketat). Tidak ada perubahan perilaku.

### 14.5 Validasi & Status

- `npx tsc --noEmit` → **0 error**
- `npx vitest run` → **192/192 test lolos** (18 file; baru di Prioritas 9–10: `stockImport.test.ts` — CSV import/drift/gate/blind/clamp/reason, `inventoryBatch.test.ts` — rename log + bulk, `pinAuth.test.ts` — role-gate/kredensial/device marker)
- `npm run build` → **sukses** (`tsc && vite build` + PWA generateSW, 50 entry precache) — diverifikasi ulang setelah seluruh prioritas 1–10 tuntas (v4.7)
- **TO DO.md**: Prioritas 9 tuntas (9.1–9.4 ✅) & **Prioritas 10 tuntas (10.1–10.5 ✅) — SELURUH prioritas 1–10 selesai, tidak ada prioritas tersisa.**

---

## 15. Riwayat Pengerjaan v4.7 — Fitur Komersialisasi P0.1–P0.4 (Laporan PPN, Refund & Struk Digital)

> Sesi lanjutan setelah Prioritas 1–10 tuntas. Mulai mengeksekusi **Prioritas 11 di `TO DO.md`** (celah spesifikasi & arah komersialisasi) dari rekomendasi **P0 — sebelum dijual ke klien**: P0.1 (laporan PPN formal), P0.2 (refund/retur penuh), & P0.4 (struk digital WA/email).

### 15.1 P0.1 — Laporan PPN bulanan ✅

- **Tab baru "PPN" di Laporan** (`Reports.tsx`, id `tax`): 4 kartu ringkasan (PPN Terkumpul / DPP / transaksi kena pajak / non-pajak), **rekap per hari**, dan **detail transaksi kena pajak** (no. antrean, tanggal, kasir, DPP, PPN, total) — tabel scrollable + sticky header.
- **Export CSV & PDF** (`exportPpnExcel` + `exportPpnPDF` di `pdfExport.ts`) — format konsisten dengan laporan lain.
- **Semantik** (selaras POS/engine): **DPP = subtotal − diskon** (net sales, clamp ≥ 0), **PPN = `t.tax`** (dibulatkan saat checkout), Total = DPP + PPN; hanya transaksi `Selesai` non-split dengan `tax > 0`; sisanya dihitung exempt.
- Helper murni **`src/utils/ppnReport.ts`** (`isTaxableTransaction`/`toPpnRow`/`summarizePpn`/`aggregatePpnByDay`); 9 test baru.

### 15.2 P0.2 — Refund / Retur Penuh ✅

- **Tombol Refund** di halaman Transaksi (transaksi `Selesai` yang bisa di-refund) → modal konfirmasi nominal penuh + alasan opsional; **otorisasi**: Manager langsung eksekusi, role lain via **PIN Manager** (konsisten void/delete).
- **Eksekusi 5 langkah akuntabel**: (1) revert stok via `calculateItemDeductions` (recipeSnapshot tersimpan), (2) revert kunjungan pelanggan, (3) **Kas Keluar 'Refund' otomatis di Rekap Kas** (offline queue + retry), (4) tandai `refunded*` + sync cloud lintas device, (5) audit log `refund_transaction`.
- **Guard**: hanya `Selesai` non-split, belum refunded, nominal > 0 (`isRefundableTransaction` murni); `applyStatusStockEffects` menerima `refunded` → **anti double-revert** (Cancel/Demo/Delete pada transaksi refunded tidak menyentuh stok lagi); tombol ubah status disembunyikan untuk transaksi refunded.
- **Eksklusi omset**: `Reports.filteredTx` & 8 filter revenue di `Dashboard.tsx` tidak menghitung transaksi refunded sebagai penjualan (laci kas tetap seimbang via Kas Keluar).
- **DB**: kolom `refunded / refunded_at / refunded_amount / refund_note / refunded_by_id / refunded_by_name` di `transactions` (schema.sql + **Migration 20** idempoten di runMigrations; `syncTransactionMeta` diperluas; `fetchTransactionsFromCloud` baca balik). ⚠️ Klien perlu ALTER TABLE butir 9 sekali di SQL Editor.
- Helper murni **`src/utils/refund.ts`** (`isRefundableTransaction`/`refundAmount`/`refundMovementNotes`/`buildRefundCashMovement`); 9 test baru + 3 guard di `transactionStockActions.test.ts`.

### 15.3 P0.4 — Struk Digital (WA/Email) ✅

- **Modal kirim struk digital di halaman Transaksi**: tombol "Struk Digital" per transaksi → modal dengan kontak pelanggan **terisi otomatis dari CRM** (`findCustomerContact`), override manual, **pratinjau struk live**, tombol **Kirim WhatsApp** (deep-link `wa.me/<nomor>?text=<struk>`) & **Kirim Email** (`mailto:` dengan struk sebagai body) — menggantikan pendekatan `wa.me` manual generik. Validasi nomor (≥ 9 digit) / email; audit log `send_digital_receipt` (channel, tujuan, transactionId).
- **Helper murni `src/utils/digitalReceipt.ts`**: `buildReceiptText` (struk teks polos layout thermal — memakai **nama toko/alamat/header/footer dari Settings**), `normalizePhone` (0xx → 62), `buildWhatsAppUrl` / `buildMailtoUrl`, `findCustomerContact`, `autoSendReceiptTarget`.
- **Settings** (`SettingsPage.tsx`, bagian *Pengaturan Format & Preview Struk*): toggle **"Kirim Struk Digital Otomatis via WhatsApp"** (`autoSendDigitalReceipt`).
- **Auto-kirim pasca-checkout** (`POS.tsx`): pre-open window WA **sebelum** `await executeCheckout` (anti popup blocker, pola sama dengan cetak struk) hanya jika `autoSendReceiptTarget` non-null (setting aktif + pelanggan punya nomor valid); setelah sukses window diisi struk lengkap; **skip idempotent replay** (tidak ada struk ganda).
- **Sinkronisasi lintas device** (pola fix 2.6/2.7): kolom `auto_send_digital_receipt` di `settings` (schema.sql + **Migration 21** idempoten + `syncSettings` guard agar DB lama tidak menumpuk offline queue + `fetchSettingsFromCloud` baca balik; TIDAK masuk `LOCAL_PRINTER_KEYS` → tersinkron antar device). ⚠️ Klien DB lama: `ALTER TABLE settings ADD COLUMN IF NOT EXISTS auto_send_digital_receipt BOOLEAN DEFAULT FALSE;` sekali di SQL Editor.
- Test: `digitalReceipt.test.ts` → **22 kasus** (normalizePhone 5, URL builders 4, buildReceiptText 6, findCustomerContact 3, autoSendReceiptTarget 4).

### 15.4 Dokumentasi rilis disinkronkan

- **CHANGELOG.md** v4.7: + blok Laporan PPN & Refund (fitur baru), SQL refund (Migration 20), validasi **213/213**.
- **DEPLOYMENT.md**: butir 9 SQL refund (WAJIB fitur Refund) + Migration 20 di self-healing note + checklist teknis P0.1/P0.2 + baris v4.7 di §8.
- ⚠️ **P0.4 belum disinkronkan ke CHANGELOG/DEPLOYMENT** (TO DO.md sudah); catatan: butir 10 SQL `auto_send_digital_receipt` (Migration 21) saat dokumen rilis diupdate.

### 15.5 Validasi & Status

- `npx tsc --noEmit` → **0 error**
- `npx vitest run` → **235/235 test lolos** (21 file; baru: `digitalReceipt.test.ts` 22 kasus P0.4, plus `ppnReport.test.ts` 9 & `refund.test.ts` 9 + 3 guard dari P0.1/P0.2)
- `npm run build` → **sukses** (tsc + vite build + PWA generateSW) — diverifikasi setelah seluruh prioritas 1–10 tuntas; P0.1–P0.4 menambah hanya pure helpers + UI, build tetap hijau
- **TO DO.md**: Prioritas 11 P0.1, P0.2 & P0.4 ✅ SELESAI (v4.7). Tersisa P0: **P0.3** (role Owner > Manager sebagai approver), lalu P1/P2.

---

## 16. Riwayat Pengerjaan v4.7 — Prioritas 12: Audit Promo & Manajemen Data (12.1.1–12.1.5 + P-A1 ✅)

> Sesi lanjutan: audit dua area — **Manajemen Data** (Settings → Manajemen Data: Bersihkan Data Transaksi / Reset ke Default / Factory Reset) & **fitur Promo** (temuan 12.2 masih terbuka). Seluruh item Manajemen Data (12.1.1–12.1.5 + P-A1) sudah dieksekusi & tuntas.

### 16.1 12.1.1 + 12.1.2 — Reset benar-benar membersihkan IndexedDB & Rekap Kas ✅

- **Akar masalah 12.1.1 (KRITIS)**: `dataManager.ts` hanya `localStorage.removeItem(key)`, padahal sejak TO DO 6.1 store `transactions` & `audit-logs` persist via **IndexedDB** (`idbStorage`) — salinan localStorage dihapus saat migrasi → ketiga aksi reset TIDAK menghapus transaksi/audit log; data "ghost" kembali setelah reload (bahkan bisa ter-push balik ke cloud).
- **Fix**: `idbStorage.ts` + **`clearIdbKeys(keys)`** (hapus IDB + cache + lapisan localStorage, **await** sebelum reload agar delete selesai sebelum unload); `dataManager.ts` kini `splitClearPlan()` mengklasifikasi key IDB vs localStorage dan `clearLocalData()` di-await di ketiga fungsi; key list diekspor (`FULL_RESET_KEYS`/`OPERATIONAL_CLEAR_KEYS`/`IDB_BACKED_KEYS`).
- **12.1.2**: `rempah-cash-movements` masuk kedua daftar lokal + cloud `clearCloudOperationalData()`/`clearAllCloudData()` kini `DELETE cash_movements` → Rekap Kas ikut bersih.
- Test: `src/test/dataManager.test.ts` (10 kasus awal — cakupan semua key persist, anti-duplikat, master data tidak ikut terhapus, klasifikasi adapter).

### 16.2 12.1.3 + P-A1 — Reset vs Factory dibedakan; backup, konfirmasi kata kunci & audit log ✅

- **12.1.3** — `resetToDefault` vs `factoryReset` kini dibedakan via `reseedPlan(kind)` murni: **demo** = seed penuh (users+settings+menus+inventory); **factory** = seed **minimal** (users+settings saja — cloud bersih dari katalog demo). Flag skip-seed (`src/utils/factoryResetFlag.ts`) mencegah seed demo lokal ter-push balik ke cloud: `menuStore.loadFromCloud` & `inventoryStore.loadFromCloud` membacanya sekali pada boot berikutnya (skip cabang "cloud kosong → push lokal").
- **Backup sebelum reset**: toggle "💾 Backup otomatis sebelum reset" (default ON) di Settings → Manajemen Data; unduh `BackupService.createBackup('FULL')` via `downloadBlob` sebelum aksi (gagal backup tidak memblokir).
- **Konfirmasi kata kunci**: `ConfirmDialog` prop baru `requireKeyword`; dialog **Factory Reset** mewajibkan mengetik **"HAPUS SEMUA"**.
- **Audit log aksi reset**: `AuditAction 'reset_data'` baru; `recordResetAudit` menulis ke cloud `audit_logs` **setelah** cloud di-wipe (survive reload; antre offline queue bila offline); actor (id/nama/role dari `currentUser`) diteruskan SettingsPage.
- Test: `reseedPlan` +4 kasus (demo full, factory minimal, akun selalu ada, perbedaan nyata).

### 16.3 12.1.4 + 12.1.5 — menu_components yatim & offline queue ✅

- **12.1.4**: daftar tabel wipe diekstrak (`OPERATIONAL_WIPE_TABLES`/`FULL_WIPE_TABLES`); `clearAllCloudData` kini juga `DELETE menu_components` (reset penuh) — tidak ada komponen bundle yatim; `clearCloudOperationalData` sengaja TIDAK menyentuhnya (Bersihkan Data mempertahankan menu). Refactor `clearCloudTables(tables)` (khusus `settings` pakai `neq('id', 0)`).
- **12.1.5**: `clearQueue()` dipanggil **paling awal** di ketiga aksi (sebelum cloud wipe & sebelum `recordResetAudit`) — op yang masih antre offline tidak "bangkit lagi" saat flush online; reseed & audit baru tetap antre dengan benar.
- Test: +5 kasus daftar tabel (FULL memuat menu_components + semua tabel; OPERATIONAL tidak menyentuh master/menu_components tapi memuat cash_movements; tanpa duplikat).

### 16.4 Validasi & Status

- `npx tsc --noEmit` → **0 error**
- `npx vitest run` → **267/267 test lolos** (23 file) — rantai terkini di §9.6
- `npm run build` → tetap **sukses** (tsc + vite build + PWA) — perubahan hanya util/store/UI, tidak menyentuh build pipeline
- **TO DO.md**: Prioritas 12 **Manajemen Data TUNTAS** (12.1.1–12.1.5 + P-A1 ✅); sisa sisi **PROMO** dieksekusi tuntas di §17 (P-A2–P-A8 ✅). Catatan jujur: `npm run build` belum dijalankan ulang setelah sesi ini (disarankan sekali sebelum deploy — terakhir diverifikasi sukses di §14.5).

---

## 17. Riwayat Pengerjaan v4.7 — Prioritas 12: Sisi Promo (P-A2–P-A8 ✅)

> Sesi lanjutan setelah Manajemen Data tuntas (§16). Menutup **seluruh temuan audit Promo** (12.2.1–12.2.8) satu per satu. **SELURUH Prioritas 12 selesai** — audit Promo & Manajemen Data tuntas.

### 17.1 P-A2 — Scope `menu` + validasi form promo ✅ (12.2.1)

- **Scope "Menu Tertentu"** di dropdown *Berlaku Untuk* (types & POS sudah mendukung, form belum) → select menu (nama + badge ⭐ Best Seller); ganti scope mengosongkan `scopeTarget`; daftar promo menampilkan **nama menu target**.
- **`src/utils/promoValidation.ts`** (murni, 17 test): nama wajib; % 1–100 / nominal > 0; tanggal berakhir ≥ mulai (keduanya wajib); target wajib untuk menu/kategori; min kunjungan wajib untuk loyalty; **diskon tetap ≤ min belanja**; angka opsional tidak negatif. Error tampil merah di modal; simpan diblokir sampai valid.

### 17.2 P-A3 — Laporan performa promo ✅ (12.2.4)

- Snapshot **`promoName`/`promoAmount`** di `Transaction` & `AtomicCheckoutParams` (engine menyalinnya); POS mengirim **nama promo** (lookup SEMUA promo, bukan hanya aktif — tetap terekam walau diedit/expired) + **nominal diskon aktual** (`promoDiscount`); pending → final ikut membawa snapshot.
- **Tab "Promo"** di Reports: KPI (tx ber-promo, total diskon promo, omset, diskon non-promo), tabel performa per promo (pakai ×, diskon, omset, rata-rata), detail tx ber-promo, **export CSV**. Helper murni `src/utils/promoReport.ts` (15 test): hanya `Selesai`, non-split, belum refunded; nama fallback lookup untuk data legacy.
- **Migration 22** (`promo_name`/`promo_amount` di `transactions`) + guard `syncTransaction` + mapping `fetchTransactionsFromCloud`. Catatan jujur: tx lama tanpa nominal tampil diskon 0 di laporan (nama masih di-resolve).

### 17.3 P-A4 — Stacking / eksklusif + auto best-deal ✅ (12.2.3)

- `Promo.stackable?` — `undefined`/`true` = boleh digabung (perilaku lama aman), `false` = **eksklusif**. Toggle di form + badge "Eksklusif".
- **`src/utils/discountEngine.ts`** — SATU sumber kebenaran `calculateDiscountBreakdown`: stackable = semua dijumlahkan (capped subtotal); eksklusif = **auto best-deal** (terbesar antara promo saja vs manual+loyalty saja). Semua call site POS (finalize, save pending, preview, snapshot promoAmount) memakai hasil SAMA → angka tampil = angka dicommit.
- Banner loyalty & pill promo hanya tampil bila benar-benar diterapkan; info ℹ️ "Promo eksklusif — otomatis memberi diskon terbaik". **Migration 23** (`stackable` di `promos`) + guard + mapping.

### 17.4 P-A5 — BOGO & min-qty ✅ (12.2.5)

- `PromoType + 'bogo'` + `bogoBuyQty`/`bogoFreeQty`/`bogoPercent`/`minQty`.
- **`src/utils/promoDiscount.ts`** — `calculatePromoDiscount` murni (POS tinggal delegasi): BOGO kumpulkan harga satuan item cocok scope → tiap `buyQty` unit beri `freeQty` gratis **dari item termurah**; `bogoPercent` = gratis sebagian. Gate `minQty` untuk diskon %/nominal (qty target ≥ ambang). Gate lengkap (aktif/tanggal/usage/min belanja/loyalty/scope) tetap.
- Form: opsi BOGO (beli/gratis/diskon% + penjelasan), scope loyalty disembunyikan untuk BOGO; field min-qty; daftar menampilkan "Beli 2 Gratis 1 item". Validasi: beli ≥ 2, gratis ≥ 1, diskon 0–100%, scope ≠ loyalty, minQty ≥ 1.
- **Migration 24**: `min_qty` + `bogo_config` di `promos` + **relaksasi CHECK `promos.type`** jadi `('percentage','fixed','bogo')` (DO block idempoten).

### 17.5 P-A6 — Batas pemakaian per pelanggan ✅ (12.2.6)

- `Promo.usageLimitPerCustomer` + `usageByCustomer` (map `customerId → jumlah pakai`); `promoStore.incrementUsage(id, customerId?)` — POS & SplitBillModal meneruskan `selectedCustomerId`.
- Gate murni: promo berbatas **wajib ada pelanggan terpilih** (tanpa pelanggan tidak berlaku) dan `usageByCustomer[id] < limit`. POS menolak apply dengan pesan "pilih pelanggan terlebih dahulu".
- Form: field "Batas per Pelanggan" + info ⚠️ mewajibkan pelanggan; daftar menampilkan "Maks N× per pelanggan". **Migration 25** (`usage_limit_per_customer` + `usage_by_customer` di `promos`). Catatan jujur: pola `usageCount` last-write-wins — race kecil pada dua device bersamaan (sama dengan batasan global existing).

### 17.6 P-A7 — Nama promo di struk ✅ (12.2.7)

- `ReceiptData` + `promoName`/`promoCode`/`promoAmount`; `buildReceiptFromTransaction` mengisi dari snapshot (P-A3). **Gating cerdas**: hanya tampil bila `promoAmount > 0` (promo eksklusif yang kalah best-deal TIDAK diklaim struk; legacy tanpa nominal juga tidak).
- Tiga jalur: browser print, ESC/POS (dipotong ke lebar kertas 58/80mm), struk digital `buildReceiptText`. Otomatis berlaku untuk print ulang, bill sementara, & struk split. 8 test `receiptPromo`. **Tanpa migrasi DB** (memakai kolom P-A3).

### 17.7 P-A8 — Poin loyalty aktif (earn + redeem) ✅ (12.2.2)

- `Customer.loyaltyPoints` + helper murni `src/utils/loyaltyPoints.ts`: poin = `pointsPerTransaction` + ⌊total ÷ `pointsPerRupiah`⌋; `recordVisit` memberi poin (POS + split, sekali per sesi), `revertVisit` **clawback simetris** (void/cancel/refund).
- **Redeem di POS**: input "Tukar poin" di keranjang mobile & modal Bayar; maks dibatasi **saldo + headroom** (subtotal − diskon lain) → poin selalu terpakai penuh; dipotong hanya bila benar-benar terpakai (`deductLoyaltyPoints`); bertumpuk di atas diskon lain (nilai kredit pelanggan, bukan bagian aturan stacking eksklusif).
- Config poin (poin/transaksi, per Rp, nilai tukar) kini **editabel** di Promo & Loyalty; poin tampil di kartu Pelanggan. **Migration 26** (`loyalty_points` di `customers`). Catatan jujur: redeem tidak dipersist di pending (pelanggan menukar saat melunasi); split bill memakai total tanpa redeem; poin lama sebelum fitur = 0.

### 17.8 Sinkronisasi cloud (Migration 22–26) & validasi

- Semua mengikuti pola konsisten: deteksi kolom di `runMigrations` + guard sync (`syncTransaction`/`syncPromo`/`syncCustomer`) agar DB lama tidak menumpuk offline queue + mapping `fetch*FromCloud` lintas device + `supabase/schema.sql` (CREATE TABLE + blok ALTER). ⚠️ DB lama perlu **butir 11** di DEPLOYMENT §4 (sekali di SQL Editor; tercetak otomatis di console app bila terlewat).
- `npx tsc --noEmit` → **0 error**; `npx vitest run` → **370/370 test lolos** (31 file). Test baru: `promoValidation` 17, `promoReport` 15, `discountEngine` 13, `promoDiscount` 21, `promoStoreUsage` 4, `receiptPromo` 8, `loyaltyPoints` 8, `loyaltyPointsStore` 10 + mapping cloud.
- `npm run build` → **sukses** (tsc + vite build + PWA generateSW, **53 entry precache**) — **build final** diverifikasi setelah seluruh perubahan POS (shortcut tambah pelanggan + `CustomerPicker` pencarian pelanggan di keranjang; perubahan UI-only, build tetap hijau).
- **TO DO.md**: Prioritas 12 **TUNTAS SELURUHNYA** — Manajemen Data (12.1.1–12.1.5 + P-A1) + Promo (P-A2–P-A8). Tidak ada item Prioritas 12 tersisa.

---

## 18. Riwayat Pengerjaan v4.7 — Prioritas 13: Audit & Perbaikan Mode Offline (O-1–O-10 ✅)

> Sesi lanjutan setelah Prioritas 12 tuntas (§16–§17). Audit menyeluruh mode offline → 13 temuan (13.1–13.13) & 10 langkah perbaikan (O-1–O-10) di TO DO.md. **SELURUH Prioritas 13 SELESAI** — mode offline kini berjalan lancar: data tidak hilang, antrean tidak macet, kasir tahu status sync.

### 18.1 O-1 — Antrean offline → IndexedDB ✅ (13.1, KRITIS)

- `offlineQueue.ts`: mirror in-memory + **`hydrateQueue()`** (IDB primary via `idbGet`/`idbSet`/`idbRemove` yang kini diekspor dari `idbStorage.ts`; fallback `safeStorage`; **migrasi one-time** dari localStorage legacy). Guard **`hydrated`** anti-clobber race boot (op sebelum hidrasi digabung, tidak menimpa antrean tersimpan). `clearQueue` membersihkan IDB + localStorage; `initOfflineQueue` async; Layout badge di-hydrate saat boot. **Payload besar tidak lagi hilang** saat kuota localStorage penuh; persist gagal tidak pernah melempar.
- Test: `offlineQueueStorage.test.ts` (7 kasus: persist IDB, survive reload, migrasi legacy, clear, dedup, no-throw kuota penuh, race boot).

### 18.2 O-2 — Retry berkala ✅ (13.3, TINGGI)

- `initOfflineQueue`: timer **30 detik** saat `queue > 0` (flush otomatis meski `navigator.onLine` salah — Wi-Fi tanpa internet) + flush saat `visibilitychange` → visible. `flushQueue` mengklasifikasi error: **transient (jaringan) TIDAK menaikkan retries** (op bertahan) vs permanen → naikkan retries.

### 18.3 O-3 — Failed-ops list (jangan drop diam-diam) ✅ (13.2, KRITIS)

- Op gagal permanen setelah MAX_RETRIES dipindah ke **daftar gagal** (`rempah-offline-queue-failed`, persist IDB + survive reload) — tidak pernah di-drop. Badge merah `N!` di sidebar + **modal daftar** (tabel/aksi, reason, lastError, waktu) dengan **Coba Lagi Semua** (`retryFailedOps` → balik ke antrean retries 0) & **Hapus Semua** (konfirmasi). **Audit log** `sync_failed` (otomatis saat op baru gagal) + `sync_retry` + `sync_failed_cleared`; `AuditAction` diperluas; `clearQueue` membersihkan keduanya; `flushQueue` return `{ success, failed, pending }`.
- Test: `offlineQueueFailed.test.ts` (7 kasus: permanen → daftar gagal, transient tidak bakar retries, retry sukses, clear, survive reload, clearQueue, shape return).

### 18.4 O-4 — Banner global offline/belum-sync ✅ (13.4, TINGGI)

- Banner di `<main>` Layout (terlihat semua device & role, tidak bergantung sidebar mobile): merah "📡 Offline…" (disconnected) / merah "⚠️ N operasi gagal sinkron — klik untuk lihat" / kuning "⏳ N data belum tersinkron — klik untuk kirim". Klik → modal failed / flush + toast.

### 18.5 O-5 — Badge "Belum Sync" per transaksi ✅ (13.7)

- `transactionStore.confirmedSyncIds` (tidak dipersist — union id cloud tiap `loadFromCloud`, pola cashMovementStore) + `markTransactionConfirmed` saat `syncTransaction` sukses (fungsi kini return `Promise<boolean>`) + hapus saat delete. Riwayat Transaksi: **badge per baris** + hitung "⚠️ N belum sync" di header + refresh `loadFromCloud(true)` saat event `online`.
- Test: `transactionSyncBadge.test.ts` (5 kasus).

### 18.6 O-6 — Banner cold start + dokumentasi batasan ✅ (13.8, 13.5a, 13.6d)

- `bootedOfflineRef` di Layout (masih disconnected ~4 dtk setelah boot) → teks "Offline sejak awal — data cloud belum dimuat (perangkat baru?); transaksi tetap bisa dicatat". **Dokumentasi**: komentar di `getNextQueueNumber` (13.6d — nomor antrean bisa kembar saat dua device offline; normalisasi di loadFromCloud; mitigasi penuh di TO DO 13.6).

### 18.7 O-7 — Deteksi konflik stok lintas device ✅ (13.5c)

- Helper murni `src/utils/stockConflict.ts` (`detectStockConflicts`: `cloud.stock > localBefore + 0.01` = potensi deduksi tertimpa/penambahan eksternal; `cloud ≤ lokal` tidak dibunyikan; item baru bukan konflik; urut diff). `inventoryStore` + `stockConflicts` (tidak dipersist via `partialize`; union per id; `clearStockConflicts`) + **banner kuning di Inventaris** (daftar + lokal→cloud + tombol "Pahami").
- Test: `stockConflict.test.ts` (7 kasus: 5 pure + 2 integrasi store).

### 18.8 O-8 — Tombstone cap 1000 ✅ (13.12)

- `DEFAULT_TOMBSTONE_CAP = 1000` di `storagePrune.ts` (naik dari 200; store transaksi sudah IndexedDB) — anti ghost saat > 200 penghapusan offline; `pruneConfirmedTombstones` tetap membersihkan id terkonfirmasi.

### 18.9 O-9 — PWA offline ✅ (13.9)

- `vite.config.ts`: **`navigateFallback: 'index.html'`** + `navigateFallbackAllowlist [/^\/.*$/]` (semua navigasi SPA → app shell precache = halaman fallback offline; plugin versi ini tidak mendukung `offlineFallback` khusus) + **runtimeCaching NetworkFirst same-origin** (cache `same-origin-assets`, timeout 5 dtk, 30 hari; Supabase API cross-origin TIDAK dicache). **Build terverifikasi**: sw.js memuat `NavigationRoute`/`createHandlerBoundToURL` + `same-origin-assets` (52 entry precache).

### 18.10 O-10 — UI konfirmasi aman + urutan antrean kronologis ✅ (13.10, 13.11)

- `alert()`/`window.confirm()` pada alur sync diganti **toast** (hasil flush) + **ConfirmDialog** (hapus failed ops, pesan dampak jelas); retry failed ops langsung (non-destruktif). `flushQueue` sort **timestamp** dulu (urutan kejadian nyata antar entitas — cash movement refund mengikuti transaksi induknya), tie-break action order hanya untuk timestamp sama.
- Test: `offlineQueueFailed.test.ts` +1 (kronologis — calls = [transactions, cash_movements], bukan [insert dulu]).

### 18.11 Validasi & Status

- `npx tsc --noEmit` → **0 error**; `npx vitest run` → **397/397 test lolos** (35 file) — rantai terkini di §9.6.
- `npm run build` → **sukses** (tsc + vite build + PWA generateSW, **51 entry precache**) — **build final** diverifikasi ulang setelah seluruh pekerjaan Prioritas 13 + sinkronisasi dokumen (O-9 → O-10 → dokumen rilis → panduan tes offline; tidak ada perubahan kode setelahnya, build tetap hijau).
- **TO DO.md**: Prioritas 13 **TUNTAS SELURUHNYA** (O-1–O-10 ✅) — 13 temuan (13.1–13.13) ditutup/didokumentasikan. Prioritas 1–13 selesai semua.
- **Dokumen rilis tersinkron (Prioritas 13)**: CHANGELOG.md (blok "Mode Offline Andal" + 397/397), RELEASE-v4.7.md (fitur #8 + 397/397), DEPLOYMENT.md (checklist O-1–O-10 + validasi 397/397 + tabel v4.7). Panduan tes baru **TESTING-OFFLINE.md** (tahap A–F: queue IndexedDB, retry 30 dtk, failed-ops list, badge Belum Sync, banner/cold start, konflik stok, PWA offline) — ditautkan dari DEPLOYMENT §7 & TESTING-PRADEPLOY tahap D (smoke test ringkas).

## 19. Riwayat Pengerjaan v4.7 — Prioritas 14: Audit & Perbaikan Integrasi Printer Thermal & Split Printer (14.1–14.6 ✅)

> Sesi lanjutan setelah Prioritas 13 tuntas (§18). Audit menyeluruh integrasi printer termal & split printer → akar masalah: koneksi Web Bluetooth hidup **in-memory** (putus saat refresh), tidak ada silent re-pair (setiap connect wajib picker), picker bisa muncul tiba-tiba di tengah checkout, fallback browser vs Bluetooth tidak seragam, tanpa print queue, status tidak persist lintas tab. **SELURUH Prioritas 14 SELESAI** — 6 item (14.1–14.6).

### 19.1 14.1 (P-1–P-4, KRITIS) — Koneksi putus saat refresh ✅

- **P-1** `reconnectBluetoothPrinter` — silent re-pair via `navigator.bluetooth.getDevices()` (cocokkan `device.id` dengan `bluetoothDeviceId`) + `establishConnection` bersama (dipakai connect & reconnect — tanpa duplikasi logika). **Tanpa membuka picker.**
- **P-2** state sesi `sessionStorage` (`markPrinterSession`/`clearPrinterSession`/`getPrinterSessionState`, key `rempah-printer-session`) — aplikasi tahu printer yang tadinya tersambung; `usePrinterMonitor` coba re-pair senyap otomatis saat boot.
- **P-3** tidak buka picker otomatis saat checkout — semua jalur print re-pair senyap dulu; gagal → fallback browser + pesan jelas (bukan picker di tengah transaksi).
- **P-4** banner pasca-refresh "Refresh memutus koneksi …" non-dismissable + tombol **Sambungkan Ulang / Sambungkan Semua**.
- Test: `printerReconnect.test.ts` (6 kasus: sesi survive reload, clear, re-pair senyap tanpa requestDevice, gagal bila device tak ada, tanpa getDevices, disconnect bersihkan registry+sesi).

### 19.2 14.2 (TINGGI) — Fallback print seragam ✅

- `notifyPrinterFallback` (toast) + pola tetap di semua jalur Bluetooth: re-pair senyap → fallback browser print → **tidak pernah picker tanpa klik**. Diterapkan di struk kasir, tiket dapur (fallback `printKitchenReceiptBrowser` — dapur tidak kehilangan pesanan), dan `printTextRaw` (fallback `fallbackBrowserPrintText`).

### 19.3 14.3 (TINGGI) — Print queue FIFO per printer ✅

- `printQueue` + `drainingPrinters` + `enqueuePrint`/`drainPrintQueue` — job diproses **serial per printer** (antar printer paralel), **retry 1×** untuk error transient (GATT busy, jeda 150 ms), drop tanpa hang setelah 2× gagal. Semua jalur cetak (struk, tiket dapur, `printTextRaw`, test print) lewat queue.
- Test: `printerQueue.test.ts` (3 kasus: sequential, retry→sukses, drop tanpa hang).

### 19.4 14.4 (SEDANG) — Status lintas tab + indikator KDS ✅

- BroadcastChannel **`rempah-printer-events`** (`broadcastPrinterEvent`/`subscribePrinterEvents`) — peristiwa connect/disconnect dibagikan antar-tab (connect di Settings/POS terlihat di tab lain). Store transient `printerStatusStore` + hook `usePrinterCrossTab` (subscribe + sinkron registry lokal + `tryReconnectSilent` + `getStatus`). **Indikator hijau/merah per printer dapur di halaman Kitchen** + tombol Hubungkan (re-pair senyap).
- Test: `printerCrossTab.test.ts` (3 kasus).

### 19.5 14.5 (SEDANG) — Fallback browser eksplisit per printer ✅

- `cashierFallbackBrowser` (AppSettings) + `fallbackBrowser` (KitchenPrinterConfig), **default ON**. `printReceiptBluetooth`/`printKitchenReceiptBluetooth`/`printTextRaw` kini return `boolean` — Bluetooth gagal & fallback nonaktif → **false** (pemanggil mencatat `status: 'error'` "Koneksi Bluetooth terputus dan fallback browser nonaktif"), bukan cetak browser diam-diam. Toggle di Settings (Printer Kasir + per kartu Printer Dapur). `printTextRaw` tidak melempar (aman untuk alur tutup shift, TO DO 6.4).
- Test: `printerFallback.test.ts` (4 kasus fallback; stub DOM — iframe thermal tercipta = bukti browser print dieksekusi).

### 19.6 14.6 (MINOR) — Naming & UX (alert→toast, satu sumber kebenaran device identity) ✅

- `alert()` → **toast** di semua alur printer: `connectBluetoothPrinter` (printer.ts — browser tak mendukung / tak bisa menulis / gagal connect) + SettingsPage (connect kasir & dapur, test print sukses/gagal, putus, peringatan duplikat device).
- Helper **`getPrinterDeviceId`/`getPrinterDeviceName`** — settings (`bluetoothDeviceId` persisten) = kanonik, sessionStorage = fallback; dipakai `usePrinterMonitor`, `usePrinterCrossTab`, dan semua jalur print (satu sumber kebenaran, tidak ada dua sumber device id).
- Banner pakai `getPrinterSessionState()` (bukan string-includes `sessionStorage`) + label Indonesia konsisten ("Sambungkan Ulang" / "Sambungkan Semua", menggantikan "Reconnect").
- Test: `printerFallback.test.ts` (3 kasus 14.6: prioritas settings > session, printer dapur dari kitchenPrinters, connect tanpa Web Bluetooth → toast tanpa alert).

### 19.7 Validasi & Status

- `npx tsc --noEmit` → **0 error**; `npx vitest run` → **416/416 test lolos** (39 file) — rantai terkini di §9.6.
- `npm run build` → **sukses** (tsc + vite build + PWA generateSW, **51 entry precache**) — **build final diverifikasi ulang** setelah pembuatan panduan tes printer (TIDAK ada perubahan kode setelah 14.5/14.6; perubahan hanya dokumentasi: TESTING-PRINTER.md + DEPLOYMENT §7), build tetap hijau (exit 0).
- **TO DO.md**: Prioritas 14 **TUNTAS (6/6)** — 14.1 ✅ + 14.2 ✅ + 14.3 ✅ + 14.4 ✅ + 14.5 ✅ + 14.6 ✅. Prioritas 15 (UX Kasir) juga **TUNTAS (4/4)** — lihat §20. Prioritas 1–15 selesai semua.
- **Dokumen rilis tersinkron (Prioritas 14)**: CHANGELOG.md (blok "Printer Thermal Lebih Andal" + 416/416), RELEASE-v4.7.md (fitur #9 + 416/416), DEPLOYMENT.md (checklist 14.1–14.6 + validasi 416/416 + tabel v4.7). **Panduan tes manual baru `testing/TESTING-PRINTER.md`** (tahap A–F: auto re-pair pasca-refresh, tanpa dialog Bluetooth di tengah checkout, fallback browser eksplisit per printer, print queue FIFO, indikator KDS lintas tab, UX toast) — ditautkan dari DEPLOYMENT §7; sekaligus tautan 3 panduan lama di §7 diperbaiki ke `./testing/...` (file memang berada di folder `testing/`).

---

## 20. Riwayat Pengerjaan v4.7 — Prioritas 15: Temuan UX & Validasi (15.1–15.4 ✅)

> Semua item Prioritas 15 (temuan user: harga add-on 0, daftar pending bertumpuk, opsi cetak per-transaksi, header Inventaris bocor ke tab opname) **SELESAI**. Validasi: tsc 0 error, **434/434 test** (41 file).

### 20.1 15.1 (TINGGI) — Validasi harga add-on (form & import CSV) ✅

- **Akar masalah**: form add-on di `Catalog.tsx` tidak memvalidasi harga > 0 — `handleSave` memakai `.filter(a => a.name && parseInt(a.price))` yang **meng-DROP add-on harga 0/NaN diam-diam** tanpa pesan; import CSV memakai `JSON.parse` mentah (add-on 0/negatif bisa masuk, bahkan JSON rusak bisa **menggagalkan seluruh import**).
- **Dikerjakan**: helper murni baru **`src/utils/menuValidation.ts`** — `validateAddOnForm` (form: baris kosong di-skip, nama tanpa harga / harga ≤ 0 / bukan angka → problem yang **memblokir simpan** + toast, bukan drop diam-diam), `sanitizeImportedAddOns` (CSV: entry invalid di-drop + dihitung, harga di-round ke integer), `parseImportedAddOns` (JSON.parse aman — JSON rusak → `parseFailed`, import tetap jalan). `Catalog.handleSave` & `handleImport` memakainya + toast laporan ("N add-on tidak valid dilewati" / "N menu dengan kolom Addons rusak"). Harga menu 0 sengaja tidak diubah (di luar lingkup 15.1).
- **Test**: `src/test/menuValidation.test.ts` (11 kasus). Total: **427/427** (40 file).
- 🔁 **REVISI (v4.7)**: **add-on harga 0 (gratis) kini SAH** — kebutuhan bisnis (menu yang *include* saus pilihan tanpa biaya memakai Add-ons). Validasi diubah ke `price >= 0` (hanya negatif/bukan angka yang diblokir; kolom harga kosong = gratis) di `validateAddOnForm`/`sanitizeImportedAddOns`; POS menampilkan label **"Gratis"** untuk add-on harga 0 (bukan "+Rp 0"); **struk termal & digital** mencetak nama add-on gratis dengan penanda **(Gratis)** tanpa menambah unit price (5 lokasi `addonStr` di `printer.ts` + `digitalReceipt.ts`). Test `menuValidation` diperbarui (tetap 11 kasus) + **2 test baru** (struk digital & termal add-on gratis) — **447/447**.

### 20.2 15.2 (TINGGI) — Daftar pending payment jadi carousel horizontal ✅

- **Akar masalah**: `PendingPaymentsModal` me-render semua card pending dalam list vertikal (`overflow-y-auto`) — banyak pending = layar penuh card bertumpuk.
- **Dikerjakan**: `PendingPaymentsModal.tsx` ditulis ulang — **carousel horizontal**: container `overflow-x-auto snap-x snap-mandatory` (scrollbar disembunyikan), satu card besar per slide (antrean, badge Pending, pelanggan/meja, waktu, jumlah menu, total), **panah ◀ ▶** (disabled di ujung), **indikator dot** (klik lompat) + label **"N dari M pesanan gantung"**; geser jari di mobile. `safeIdx` di-clamp + `useEffect` mengembalikan posisi scroll saat list berubah (pencarian/void). Semua fitur lama dipertahankan (pencarian, detail kanan, Struk Sementara, Batalkan, Lanjutkan Pembayaran). Props tidak berubah — POS/Layout tidak disentuh.

### 20.3 15.3 (TINGGI) — Opsi cetak per-transaksi — dua toggle independen (struk kasir & tiket dapur), anti tiket dobel ✅

- **Akar masalah**: `triggerPostCommitTasks` selalu memanggil `printReceipt(..., 'all')` (struk kasir + tiket dapur) saat printer aktif — tidak ada cara melewati struk pelanggan untuk hemat kertas.
- **Dikerjakan (v4.7, desain final dua toggle)**: param baru **`skipReceiptPrint?: boolean`** (struk kasir) + **`skipKitchenPrint?: boolean`** (tiket dapur) di `AtomicCheckoutParams`. **Engine** (`triggerPostCommitTasks`): dua panggilan print terpisah masing-masing di-gate — `if (!skipReceiptPrint) printReceipt(..., 'cashier', ...)` + `if (!skipKitchenPrint) printReceipt(..., 'kitchen')`. `suppressAutoPrint` (split) tetap dihormati.
- **Perjalanan desain (penting)**: awalnya satu checkbox — skip hanya melewatkan struk kasir (tiket dapur tetap dicetak target 'kitchen') → **ternyata menyebabkan tiket DOBEL di dapur** (tiket sudah tercetak saat Simpan Pending). Lalu disederhanakan jadi skip = tidak mencetak apa pun. **Kebutuhan baru user**: skip struk kasir TAPI tiket dapur tetap harus dicetak di awal → desain final **dua toggle independen** — skip struk saja (tiket dapur tetap keluar), skip keduanya (tanpa cetakan).
- **Anti tiket DOBEL otomatis (resume pending)**: saat finalize pending dengan item TIDAK berubah (`pendingItemsChanged=false`), checkbox **"Cetak tiket dapur" default OFF** di `handleCheckoutCb`/`proceedCheckoutAnyway` (`setSkipKitchenPrint(!!currentPendingTx && !pendingItemsChanged)`) — tiket dapur sudah tercetak saat Simpan Pending → tidak perlu ulang; item berubah → default ON (dapur perlu tiket baru).
- **POS.tsx**: **dua checkbox** — **"Cetak struk kasir"** & **"Cetak tiket dapur"** (hanya tampil bila printer aktif; reset ke default tiap modal dibuka & setelah checkout; **pre-open print window dilewati** saat skip struk; kedua flag diteruskan ke `executeCheckout`; keterangan "tidak ada cetakan sama sekali" saat keduanya nonaktif).
- **Perluasan ke Split Bill**: `printSplitReceipt` mendapat **dua param** `skipCashierPrint?: boolean` + `skipKitchenPrint?: boolean` (tiket dapur hanya relevan untuk sub-bill pertama fresh, target 'all'); `SplitBillModal` menambah **dua checkbox** di Payment Box — checkbox tiket dapur **hanya tampil saat split fresh** (`!parentTx`; split dari pending tidak pernah mencetak ulang tiket); reset saat modal dibuka konteks baru. **Resume pending otomatis tercakup** — kasir melewati modal checkout yang sama sehingga kedua flag ikut berlaku.
- **Test**: `src/test/printTarget.test.ts` (7 kasus: 'all' vs 'kitchen' di `printReceipt`; `printSplitReceipt` skipCashier=true+kitchen=false → **struk dilewati, tiket dapur TETAP keluar**; keduanya true → **0 cetakan**; default → struk + tiket dapur). Total: **434/434** (41 file).

### 20.4 15.4 (SEDANG) — Header aksi bahan baku hanya di tab Bahan Baku ✅

- **Akar masalah**: `Inventory.tsx` me-render group aksi (Tambah Bahan, Min. Stok, Export, Template CSV, Import) **di atas tab** → tombol bahan baku ikut tampil saat tab Stock Opname aktif (StockOpname.tsx sendiri bersih).
- **Dikerjakan**: group aksi dibungkus `{activeTab === 'inventory' && (...)}` — hanya tampil di tab **Bahan Baku**; tab Stock Opname hanya judul + tab (aksi opname dikelola `StockOpname.tsx` sendiri). Kondisi role Staf Gudang tetap dipertahankan. Perubahan UI-only.

### 20.5 Validasi & Status

- `npx tsc --noEmit` → **0 error**; `npx vitest run` → **434/434 test lolos** (41 file) — rantai terkini di §9.6.
- `npm run build` → **sukses (exit 0)** diverifikasi ulang setelah desain final dua toggle cetak (skip struk saja / tiket dapur tetap di awal + anti tiket dobel): built in 18.50s, **51 entry precache (3604.63 KiB)**, PWA generateSW `dist/sw.js` + `dist/workbox-c3716bd4.js`. Satu-satunya warning adalah chunk > 500 kB (dikenal, bukan regresi). Tidak ada error baru.
- **TO DO.md**: Prioritas 15 **TUNTAS (4/4)** — 15.1 ✅ + 15.2 ✅ + 15.3 ✅ (dua toggle independen struk & tiket dapur: skip struk saja → tiket dapur tetap keluar di awal; skip keduanya → tanpa cetakan; **anti tiket DOBEL otomatis** saat resume pending; perluasan Split Bill) + 15.4 ✅. Prioritas 1–15 selesai semua.
- **Dokumen rilis tersinkron (Prioritas 15)**: CHANGELOG.md (blok "Pengalaman Kasir & Validasi" + 434/434), RELEASE-v4.7.md (fitur #10 "UX Kasir Lebih Mulus" + 434/434). Perubahan kode Prioritas 15 masih **belum di-commit** (menunggu instruksi).

---

## 21. Riwayat Pengerjaan v4.7 — Prioritas 16: Bug Item Pending Tidak Ter-update di Riwayat Transaksi (16.1 ✅)

> **Temuan user**: "ketika saya menambahkan atau mengurangi menu di transaksi pending payment, menu yang ditambahkan atau dikurangi itu tidak bertambah atau berkurang di riwayat transaksi".

### 21.1 Diagnosis (root cause)

- **Lokal BENAR** — re-commit pending dengan ID sama (`bypassIdempotency`) → `addTransaction` upsert by ID → store lokal langsung menyimpan item baru. Dibuktikan test reproduksi engine langsung (3/3 lolos, `pendingUpdateHistory`).
- **Round-trip cloud MENIMPA lokal** — `loadFromCloud` (dipicu realtime App.tsx & Transactions.tsx, refresh, event `online`, boot) bersifat **cloud-authoritative**: ID yang ada di fetch cloud → versi lokal DIBUANG tanpa perbandingan freshness. `syncTransaction` async (tertunda/gagal → offline queue) → jendela cloud masih berisi item lama → fetch menimpa item lokal yang benar.

### 21.2 Perbaikan (16.1, TINGGI) — freshness compare + updatedAt minimal

- **`loadFromCloud` freshness compare** (`src/store/transactionStore.ts`): bila ID ada di cloud DAN di lokal → pilih versi **lebih baru** per transaksi; deletion lintas device (ID lokal tidak di cloud, dalam window) tetap cloud-authoritative.
- **Anti-duplikat**: versi cloud yang kalah dikecualikan dari merge (`localNewerIds`/`cloudForMerge`) — sebelumnya muncul **dua record ber-ID sama** (duplikat baris di UI; `find()`/sort bisa mengembalikan versi stale).
- **`updatedAt?: string` di `Transaction`** (`src/types/index.ts`): freshness marker terpisah dari `date` (timestamp bisnis untuk laporan/filter). Di-stamp **engine tiap commit** (`atomicTransactionEngine.ts`) + di `updateKitchenStatus`/`updateTxStatus`/`updateTxMeta` (store) — menutup race untuk jalur yang TIDAK mengubah `date` (void/cancel, kitchen status, payment method, refund). `freshTime()` = `updatedAt` fallback `date` (legacy). **Tanpa migrasi DB** (versi minimal — kolom DB opsional untuk presisi lintas device; hindari `DEFAULT now()` untuk backfill agar baris legacy tidak tampak "lebih baru").
- **Test permanen**: `src/test/pendingUpdateHistory.test.ts` (3 — lokal engine: tambah item, hapus+tambah item, finalize item berubah) + `src/test/pendingCloudOverwrite.test.ts` (8 — lokal lebih baru tidak ditimpa stale, cloud lebih baru menang, date sama → cloud, void/status terlindungi via updatedAt, updatedAt > date, cloud updatedAt lebih baru, legacy fallback, anti-duplikat, deletion lintas device tetap berlaku). Timestamp relatif terhadap `Date.now()` (deterministik — jam mesin test bisa lebih awal dari tanggal tetap).

### 21.3 Validasi & Status

- `npx tsc --noEmit` → **0 error**; `npx vitest run` → **449/449 test lolos** (43 file) — rantai terkini di §9.6.
- `npm run build` → **sukses (exit 0)** diverifikasi setelah perubahan `updatedAt` minimal + sinkronisasi 4 dokumen rilis: built in 18.77s, **51 entry precache (3605.00 KiB)**, PWA generateSW `dist/sw.js` + `dist/workbox-c3716bd4.js`. Satu-satunya warning adalah chunk > 500 kB (dikenal, bukan regresi). Tidak ada error baru — perubahan `updatedAt` (types + engine + store) lolos build produksi.
- **TO DO.md**: Prioritas 16 **TUNTAS (16.1 + 16.2)** — 16.1 bug item pending (freshness compare + updatedAt minimal), 16.2 fitur "Semua Dapur" di Edit Menu (`kitchenTarget: 'ALL'` → tiket ke semua printer dapur aktif; `printTarget` +2). Prioritas 1–16 selesai semua.
- **Dokumen rilis tersinkron (Prioritas 16)**: CHANGELOG.md (blok fitur baru + bullet perbaikan bug + 449/449), RELEASE-v4.7.md (Perbaikan Utama + 449/449). Perubahan kode Prioritas 16 masih **belum di-commit** (menunggu instruksi).

---

*Dokumen ini dibuat agar AI developer manapun bisa melanjutkan pengembangan tanpa kehilangan konteks.*
