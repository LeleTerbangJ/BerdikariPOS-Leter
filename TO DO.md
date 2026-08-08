# 📋 TO DO — Daftar Temuan Audit BerdikariPOS

> **Sumber**: Analisa mendalam kode & dokumen (PRD v4.4, ROADMAP v4.1, DEPLOYMENT v4.2, FEATURES, AI-HANDOFF)
> **Tanggal**: 7 Agustus 2026
> **Status**: Belum ada perubahan yang dilakukan — dokumen ini hanya rangkuman temuan.

---

## 🔴 PRIORITAS 1 — KRITIS (harus diperbaiki sebelum fitur Pending/Split dipasarkan)

### 1.1 Akses UI Modal "Daftar Pesanan Gantung" tidak ada
- **File**: `src/pages/POS.tsx` (baris 62, 66, 1442–1445), `src/components/Layout.tsx`
- **Masalah**: `setShowPendingModal(true)` tidak pernah dipanggil di mana pun; `pendingCount` dihitung tapi tidak dirender; Layout tidak punya akses ke daftar pending.
- **Aksi**:
  - [x] Render badge counter pending di header POS & topbar Layout — ✅ `POS.tsx` (badge tombol di sebelah search) & `Layout.tsx` (nav item "Pesanan Gantung" dengan badge, sidebar collapse ikut support)
  - [x] Tambahkan tombol/aksi yang memicu `setShowPendingModal(true)` — ✅ badge tombol di header POS; nav item Layout navigasi ke `/pos?openPending=1` yang dibaca POS untuk auto-buka modal
  - [x] Pastikan badge di Layout menampilkan jumlah pesanan gantung real-time — ✅ `pendingCount` dihitung reaktif dari transaction store (`txStatus === 'Pending' || isPending === true`)

  > **Cara kerja quick access**: Sidebar → "Pesanan Gantung" → `/pos?openPending=1` → POS membuka modal lalu membersihkan query param (`setSearchParams({}, { replace: true })`) sehingga refresh/back tidak membuka ulang modal.

### 1.2 Database tidak mendukung status Pending & kolom Split
- **File**: `supabase/schema.sql` (baris 77), `src/lib/cloudSync.ts` (`runMigrations`), `DEPLOYMENT.md`
- **Masalah**:
  - CHECK constraint `tx_status` hanya `('Selesai','Cancel','Demo')` → **'Pending' ditolak**
  - Kolom `is_pending`, `pending_notes`, `split_parent_id`, `split_index`, `total_split_count`, `paid_amount`, `table_name` **tidak ada** di schema maupun skrip migrasi
  - Akibat: `syncTransaction` untuk pending selalu gagal → transaksi pending **tidak pernah sampai cloud** → KDS multi-device & laporan lintas device tidak melihat pesanan gantung
- **Aksi**:
  - [x] Ubah CHECK constraint `tx_status` agar mengizinkan `'Pending'` (drop & re-create constraint) — ✅ `supabase/schema.sql`
  - [x] Tambah kolom pending/split di `CREATE TABLE transactions` + skrip migrasi `ALTER TABLE` — ✅ `supabase/schema.sql`
  - [x] Tambahkan migrasi otomatis di `runMigrations()` (termasuk `migrationNeeded.taxEnabled` yang tidak pernah diset — nomor migrasi melompat 12→14) — ✅ `src/lib/cloudSync.ts`
  - [x] Perbarui script upgrade SQL di `DEPLOYMENT.md` — ✅
  - [x] Guard `syncTransaction` agar tidak menulis kolom pending/split jika DB belum di-migrate (mencegah penumpukan offline queue) — ✅ `src/lib/cloudSync.ts`

  > ⚠️ **Catatan deploy**: Untuk database **existing**, jalankan blok migrasi v4.1 di `DEPLOYMENT.md` §3 (atau skrip `ALTER TABLE` di bagian bawah `supabase/schema.sql`) di Supabase SQL Editor. `runMigrations()` hanya mendeteksi & memberi peringatan — ALTER TABLE tetap manual karena anon key tidak punya hak DDL.
  >
  > ⚠️ **Cakupan guard**: Guard `migrationNeeded` hanya melindungi `syncTransaction` (full-row upsert). Jalur `syncTransactionTxStatus(id, 'Pending')`/`syncTransactionStatus` (smartUpdate `tx_status`/`kitchen_status`) **tidak ter-cover** — di DB yang belum di-ALTER, update status tetap gagal CHECK constraint dan masuk offline queue. Ini prasyarat manual yang wajib dijalankan sebelum fitur dipakai.

### 1.3 Resume Pending → klik "Bayar" tidak memproses pembayaran
- **File**: `src/lib/atomicTransactionEngine.ts` (idempotencyRegistry), `src/pages/POS.tsx` (`finalizeTransaction`, `handleResumePendingOrder`)
- **Masalah**: `transactionId = checkoutTxId = tx.id` (id pending) sudah terdaftar di idempotencyRegistry dengan state `COMMITTED` → engine mengembalikan `idempotentReplay` dengan **objek transaksi lama**. Pembayaran tidak tercatat, status tetap Pending, cart dikosongkan.
- **Aksi**:
  - [x] Tambah `bypassIdempotency?: boolean` di `AtomicCheckoutParams` — resume/update/finalize pending diizinkan re-commit dengan ID sama, **kecuali** transaksi sudah berstatus `'Selesai'` (anti double-pay; in-flight guard VALIDATING/PROCESSING tetap berlaku untuk semua alur) — ✅ `atomicTransactionEngine.ts`
  - [x] `finalizeTransaction` mengirim `overrideTxStatus: 'Selesai'` + `overrideQueueNumber` + `overrideKitchenStatus` + `bypassIdempotency` saat `currentPendingTx` aktif — ✅ `POS.tsx`

### 1.4 Update Pending tidak memotong stok item baru
- **File**: `src/pages/POS.tsx` `handleSavePending` (baris 87–103)
- **Masalah**: `skipStockDeduction: !!currentPendingTx` diterapkan ke seluruh cart → item baru yang ditambahkan ke pesanan gantung **tidak pernah mengurangi stok**.
- **Aksi**:
  - [x] Tambah `reservedDeductions?: Record<string, number>` di `AtomicCheckoutParams` — engine menghitung **delta** (cart baru − stok yang sudah di-reserve dari pending): item baru → deduct, item dihapus → revert — ✅ `atomicTransactionEngine.ts`
  - [x] Validasi stok saat resume memakai **stok efektif** (stok saat ini + reserve) agar tidak gagal palsu — ✅ `atomicTransactionEngine.ts`
  - [x] `handleSavePending` & `finalizeTransaction` mengirim `reservedDeductions = calculateItemDeductions(currentPendingTx.items, menus)` (berbasis recipeSnapshot, tahan perubahan resep) — ✅ `POS.tsx`
  - [x] `overrideKitchenStatus` — status dapur dipertahankan jika item **tidak berubah**; di-reset ke `'Waiting'` jika item **berubah** (dapur harus melihat ulang pesanan yang dimodifikasi) — ✅ `POS.tsx` + `atomicTransactionEngine.ts`
  - [x] Guard engine: `executeCheckout` menolak `cartItems` kosong — menutup race double-click update pending yang bisa me-revert stok reserve secara salah & membuat transaksi kosong — ✅ `atomicTransactionEngine.ts`
  - [x] `handleResumePendingOrder` me-restore `orderType` (pending Take Away tidak berubah jadi Dine In) — ✅ `POS.tsx`

### 1.5 Split Bill dari cart fresh tidak pernah memotong stok
- **File**: `src/components/SplitBillModal.tsx` (`handlePaySubBill`)
- **Masalah**: `parentTx = null` tapi `skipStockDeduction: true` tetap dikirim → **stok tidak dipotong sama sekali** untuk split biasa. Tiket dapur juga tidak dicetak (`printSplitReceipt` hanya ke printer kasir).
- **Status**: ✅ SELESAI
- **Aksi (dieksekusi)**:
  - [x] Ganti `skipStockDeduction: true` dengan `reservedDeductions` + `suppressAutoPrint` — `SplitBillModal.tsx`
  - [x] **Reserve stok penuh SEKALI** saat sub-bill pertama split fresh dibayar (validasi penuh seluruh cart dulu via `InventoryEngine.validateStockAvailability`, lalu `deductStock(fullDeductions)`); sub-bill berikutnya kirim `reservedDeductions` = deduksi item sub-bill itu sendiri → engine menghitung delta 0 (tidak potong 2x)
  - [x] Split pending: stok sudah dipotong saat pending dibuat → sub-bill kirim `reservedDeductions` per sub-bill (delta 0), tidak pernah potong ulang
  - [x] `suppressAutoPrint` baru di `AtomicCheckoutParams` → `triggerPostCommitTasks` engine skip cetak otomatis per sub-bill (cegah struk+tiket ganda)
  - [x] Cetak tiket dapur LENGKAP (semua item cart) saat sub-bill pertama split fresh via `printSplitReceipt(subTx, null, settings, 'all', cartItems)`; mode `'kitchen'` baru di `printReceipt` (struk kasir di-skip, hanya tiket dapur)
  - [x] `handleClose`: jika modal ditutup sebelum semua sub-bill lunas (fresh), kembalikan stok item yang belum dibayar (full − akumulasi lunas); SEMUA jalur tutup (X, backdrop, selesai lunas) lewat `handleClose` + `useEffect` reset refs saat `open` jadi true — mencegah ref stale antar sesi split (bug review)
  - [x] Reserve stok penuh dipindah ke SETELAH commit sub-bill pertama sukses (gated `sessionReservedRef.current === null`) — jika attempt pertama gagal, retry tetap dianggap sub-bill pertama → tiket dapur lengkap tetap tercetak (bug review)
  - [x] `printSplitReceipt` signature: `(subTx, parentTx: Transaction | null | undefined, settings, target: 'cashier'|'all', allItems?)` — label induk opsional (split fresh tanpa parent)

### 1.6 Double Accounting (Revenue & HPP) pada Split Pending
- **File**: `src/pages/Reports.tsx` (baris 64), `src/pages/Dashboard.tsx`, `src/pages/Transactions.tsx`, `src/components/SplitBillModal.tsx`
- **Masalah**: Parent di-set `'Selesai'` saat semua sub-bill lunas, tapi laporan hanya memfilter `txStatus === 'Selesai'` **tanpa mengecualikan `splitParentId`** → parent + N sub-bill dihitung ganda (revenue & HPP). ROADMAP §4 mewajibkan eksklusi via `splitParentId`.
- **Status**: ✅ SELESAI
- **Aksi (dieksekusi)**:
  - [x] Reports: `filteredTx` exclude `t.splitParentId` (P&L, Transaksi, Shift, CSV/PDF ikut)
  - [x] Dashboard: semua filter omset (todayTx, chart daily/weekly/monthly/yearly, trend, busy hours, menu profitability) exclude `!t.splitParentId`
  - [x] Transactions: stats `completed`/`totalOmset` exclude split + **guard stok** `hasSplitChildren(tx)` — Cancel/Delete/re-enable tidak me-revert/deduct stok untuk anak split maupun induk yang punya anak (stok dikelola sesi split)
  - [x] Layout: `todayTx` & `shiftTx` (expected cash, total sales) exclude `!t.splitParentId`
  - ⚠️ Catatan: HPP mode equal memakai semua item cart di setiap sub-bill (hanya untuk preview nominal) — HPP transaksi dihitung engine per sub-bill dari item sub-bill itu (laporan pakai `t.hpp` transaksi, bukan preview); sudah benar.
  - ⚠️ Catatan: void/cancel transaksi split (anak maupun induk) TIDAK mengubah stok otomatis — penyesuaian stok manual via Inventory (dokumentasi perilaku, mencegah revert ganda)

### 1.7 Void Pending dari halaman Transaksi bocor stok
- **File**: `src/pages/Transactions.tsx` (baris 184–253, 456)
- **Masalah**: Pending → Cancel **tidak me-revert stok** (hanya untuk `txStatus === 'Selesai'`). `statusBadge` tidak punya case `'Pending'`; dropdown filter tidak ada opsi Pending.
- **Status**: ✅ SELESAI
- **Aksi (dieksekusi)**:
  - [x] `Pending → Cancel` (dan `Pending → Demo`) kini revert stok reserve via `revertStock` + guard `hasSplitChildren` di `onConfirmAction` & `onPinSuccess` — `Transactions.tsx`
  - [x] `statusBadge` + case `'Pending'` (badge amber + ikon ⏰) — `Transactions.tsx`
  - [x] Dropdown filter status + opsi `Pending (Gantung)`; stats card menampilkan jumlah gantung (predicate sama dengan store: `txStatus === 'Pending' || isPending === true`) — `Transactions.tsx`
  - [x] Konsistensi review: `Selesai → Demo` kini juga revert stok + revertVisit (kelas kebocoran yang sama); pesan konfirmasi void pending menyebutkan stok reserve akan dikembalikan — `Transactions.tsx`
  - ✅ Verifikasi: void dari PendingPaymentsModal sudah aman — `cancelPendingTransaction` di `transactionStore.ts` sudah revert stok (revertStock via dynamic import)
  - ✅ Verifikasi: Kitchen.tsx tidak punya aksi void
  - ⚠️ Catatan: `Pending → Selesai` langsung dari Transactions TIDAK memotong stok ulang (stok sudah reserve sejak pending) — perilaku benar, transaksi tetap "memiliki" stok
  - ⚠️ Catatan: `Selesai → Demo` kini revert stok + visit (ditambahkan sebagai konsistensi 1.7)
  - [ ] Tambahkan case `'Pending'` di `statusBadge`
  - [ ] Tambahkan opsi `Pending` di filter status

---

## 🟡 PRIORITAS 2 — MENENGAH

### 2.1 Revert stok Pending tidak memakai recipeSnapshot
- **File**: `src/store/transactionStore.ts` (`cancelPendingTransaction`)
- **Masalah**: Menghitung ulang snapshot dari menu/inventori saat ini, bukan dari `recipeSnapshot` yang tersimpan → jumlah revert bisa salah jika resep berubah/menu dihapus.
- **Aksi**: Gunakan `calculateItemDeductions(tx.items, menus)` yang memprioritaskan recipeSnapshot.

### 2.2 Pembulatan diskon & pajak pada Split Equal
- **File**: `src/components/SplitBillModal.tsx` (equal mode)
- **Masalah**: `Math.round(diskon/N)` per sub-bill → total diskon/pajak sub-bill ≠ induk (selisih rupiah). Hanya `totalAmount` yang memakai alokasi remainder.
- **Status**: ✅ SELESAI
- **Aksi (dieksekusi)**:
  - [x] Helper `allocateProportional` (Largest Remainder Method) di modul murni `src/utils/splitAllocation.ts` + hardening (semua ratio 0 dengan total > 0 tetap total-klop)
  - [x] Equal mode: subtotal, diskon, DAN pajak semua dialokasikan via `allocateProportional`; `totalAmount_i = subtotal_i - diskon_i + pajak_i` → Σ totalAmount_i = total induk otomatis (deps `totalAmount` mati dihapus — finalTotal POS = subtotal − diskon + pajak, semua integer — invariant terverifikasi)
  - [x] Item mode (kelas bug yang sama): diskon & pajak proporsional kini pakai `allocateProportional` (sebelumnya `Math.round(discount * ratio)` per bill → bisa selisih)
  - [x] Unit test `src/test/splitAllocation.test.ts` (5 test, import modul murni tanpa side-effect): total klop, selisih antar sub-bill ≤ 1, integer, hardening, edge cases → 12/12 test suite lolos + tsc 0 error
  - ⚠️ Catatan: TO DO 2.3 (struk equal menampilkan semua item dengan nominal 1/N) masih terbuka — tampilan struk, bukan perhitungan

### 2.3 Struk sub-bill mode Equal tidak konsisten
- **File**: `src/components/SplitBillModal.tsx`, `src/utils/printer.ts` (`printSplitReceipt`)
- **Masalah**: Sub-bill berisi semua item dengan subtotal penuh, tapi total = 1/N → jumlah item ≠ total pada struk.
- **Status**: ✅ SELESAI
- **Aksi (dieksekusi)**:
  - [x] `buildEqualSplitReceipt(subTx)` di modul murni `src/utils/splitAllocation.ts`: deteksi mode equal (`Σ subtotal item ≠ subtotal sub-bill`), label `BAGIAN N DARI M (NOMINAL RATA)`, subtotal per item proporsional via `allocateProportional` → Σ item === subtotal bagian tanpa selisih; null untuk mode item / subtotal 0
  - [x] `printSplitReceipt`: header equal menggantikan `[SPLIT BILL]` (tidak duplikat) + baris ringkasan `Pesanan: N item — Total Rp Y` sebagai konteks; mode item tetap pakai `[SPLIT BILL N OF M]`
  - [x] Tiket dapur (target 'all' / split fresh) TIDAK ikut diskalakan — `allItems` asli tetap dicetak lengkap untuk dapur
  - ✅ Validasi: tsc 0 error + 16/16 test suite lolos (4 test baru: equal 3 arah Σ klop, mode item → null, subtotal 0 guard, selisih ≤ 1)
  - ⚠️ Catatan: bundle child (subtotal 0) di mode equal mendapat porsi 0 dan dirender tanpa nominal — tidak memengaruhi konsistensi total

### 2.4 Idempotency Registry tidak pernah dibersihkan
- **File**: `src/lib/atomicTransactionEngine.ts`
- **Masalah**: `Map` statis tanpa pembersihan → memory leak ringan + akar masalah 1.3/1.4 (resume memakai id sama).
- **Status**: ✅ SELESAI
- **Aksi (dieksekusi)**:
  - [x] Modul murni `src/utils/idempotencyCleanup.ts`: `pruneIdempotencyEntries(entries, now, ttlMs, maxSize)` + `IDEMPOTENCY_TTL_MS = 24 jam` + `MAX_IDEMPOTENCY_ENTRIES = 1000` (test tanpa side-effect store/supabase)
  - [x] `cleanupIdempotencyRegistry()` dipanggil di awal `registerState`; throttle: sweep tiap 50 panggilan ATAU saat size > MAX (prune menetapkan size = MAX sehingga throttle kembali normal — tidak sort tiap panggilan)
  - ✅ Keamanan: resume pending memakai `checkoutTxId = tx.id` (re-commit ID sama). Jika entry sudah lewat TTL → tidak ada blokir idempotensi → `addTransaction` replace transaksi lama (aman, tidak dobel). Anti-double-pay `txStatus === 'Selesai'` tetap aktif untuk entry berumur < 24 jam (komentar trade-off ditambahkan di samping TTL)
  - ✅ Unit test `src/test/idempotencyCleanup.test.ts` (7 test): TTL hapus, boundary persis TTL, batas ukuran buang tertua, boundary size === maxSize, kombinasi TTL+ukuran, in-flight muda aman, TTL 0 → 23/23 test suite lolos + tsc 0 error

### 2.5 Duplikasi logika validasi stok
- **File**: `src/utils/stockCheck.ts` vs `src/lib/inventoryEngine.ts`
- **Masalah**: Dua implementasi identik yang bisa divergen.
- **Status**: ✅ SELESAI
- **Aksi (dieksekusi)**:
  - [x] `src/utils/stockCheck.ts` jadi compat-shim: `checkStockAvailability` → delegasi ke `InventoryEngine.validateStockAvailability(...).warnings`; `StockWarning` di-derive dari `InventoryValidationResult['warnings'][number]` (satu sumber kebenaran di level tipe juga); JSDoc `@deprecated` + catatan unifikasi
  - [x] POS.tsx TIDAK diubah — API lama (return array warnings) tetap kompatibel; AtomicTransactionEngine & SplitBillModal sudah memakai engine langsung
  - ✅ Unit test `src/test/stockCheck.test.ts` (3 test): hasil alias identik dengan engine, deteksi stok kurang, stok cukup tanpa warning → 26/26 test suite lolos + tsc 0 error
  - ⚠️ Catatan: `calculateItemDeductions` fallback memakai `menu.ingredients` (Record), bukan `menu.recipe` — perilaku existing, tidak diubah

### 2.6 Migrasi DB untuk tax_enabled & pending/split tidak otomatis
- **File**: `src/lib/cloudSync.ts` (`runMigrations`)
- **Masalah**: Tidak ada deteksi untuk kolom pending/split; `migrationNeeded.taxEnabled` tidak pernah diset.
- **Status**: ✅ SELESAI (mayoritas sudah di TO DO 1.2 — diverifikasi ulang)
- **Aksi (dieksekusi)**:
  - [x] Migration 13 (tax_enabled) & Migration 15 (7 kolom pending/split) — sudah ada sejak TO DO 1.2 ✅ diverifikasi
  - [x] Migration 5 (kitchen_printers) & 11 (table_features) — sudah ada ✅
  - [x] Blok ALTER migrasi schema.sql kini mencakup SEMUA kolom settings yang ditulis syncSettings: + `tax_enabled`, `demo_mode`, `receipt_header`, `receipt_footer`, `receipt_ascii_only`, `auto_print_receipt` (sebelumnya hanya kitchen_printers/theme_color/theme_shades/table_features)
  - [x] DEPLOYMENT.md blok upgrade v4.2: + kolom `receipt_ascii_only` & `auto_print_receipt` (1b)

### 2.7 syncSettings tanpa guard migrasi untuk sebagian kolom
- **File**: `src/lib/cloudSync.ts` (`syncSettings`)
- **Masalah**: `receipt_ascii_only`/`auto_print_receipt` ditulis tanpa guard migrasi (berbeda dengan kolom lain) → potensi gagal upsert pada DB lama.
- **Status**: ✅ SELESAI
- **Aksi (dieksekusi)**:
  - [x] Migration 16 baru: deteksi 4 kolom cetak struk (`receipt_ascii_only`, `auto_print_receipt`, `receipt_header`, `receipt_footer`) di settings (satu query gabungan, pola sama dengan Migration 15) → set flag + cetak SQL lengkap ke console (selaras dengan blok migrasi schema.sql)
  - [x] `syncSettings`: keempat kolom kini hanya ditulis jika kolom ada di DB (`if (!migrationNeeded.receiptAsciiOnly)` dst) — konsisten dengan pola tax_enabled/kitchen_printers/theme_* — mencegah penumpukan offline queue
  - [x] `migrationNeeded` + 4 key baru
  - ✅ Validasi: tsc 0 error + 26/26 test suite lolos

### 2.8 Split Bill tidak merekam customer/promo
- **File**: `src/components/SplitBillModal.tsx`
- **Masalah**: Sub-bill tidak merekam `recordVisit` customer & tidak menaikkan `usageCount` promo; parent pending tetap menyimpan `paymentMethod: 'Cash'` meski dibayar QRIS/Transfer.
- **Status**: ✅ SELESAI
- **Aksi (dieksekusi)**:
  - [x] POS.tsx meneruskan `selectedCustomerId`, `selectedCustomerName`, `appliedPromoId` ke SplitBillModal
  - [x] Setiap sub-bill merekam customer via engine params `selectedCustomerId`/`selectedCustomerName` → tx.customerId/customerName tercatat (CRM & laporan per-customer akurat)
  - [x] `recordVisit(customerId, totalAmount)` + `incrementUsage(appliedPromoId)` dipanggil SEKALI pada sub-bill pertama yang lunas via ref flag `sessionVisitRecordedRef` (bukan derive dari map deductions — sub-bill bisa lunas tanpa deduksi bahan → mencegah double-fire record/promo; fix dari review) — paralel dengan finalizeTransaction di checkout normal
  - [x] Parent pending saat semua lunas: `finalizeSplitParent` — status `'Selesai'` + `paymentMethod` MAYORITAS (by total nominal sub-bill lunas) via store `updateTxMeta` baru — laporan distribusi pembayaran tidak lagi selalu 'Cash' untuk split QRIS/Transfer
  - [x] `transactionStore.updateTxMeta(id, partial)` — update metadata lokal tanpa menyentuh status/cloud (status tetap via `updateTxStatus` yang sync)
  - ✅ Validasi: tsc 0 error + 26/26 test suite lolos
  - ⚠️ Catatan: recordVisit memakai totalAmount (seluruh tagihan) di sub-bill pertama; jika split dibatalkan di tengah, visit tercatat penuh (trade-off kecil, konsisten dengan checkout normal)
  - ⚠️ Catatan: `usageCount` promo pada checkout normal sebenarnya juga sudah dipanggil di finalizeTransaction (baris 578) — split kini menutup celahnya

---

## 🟢 PRIORITAS 3 — MINOR / PERBAIKAN KUALITAS

### 3.1 Selector `getPendingCount()` tidak stabil (POS.tsx)
- **File**: `src/pages/POS.tsx` — juga `src/components/Layout.tsx` (badge quick-access)
- **Masalah**: `useTransactionStore((s) => s.getPendingCount())` — selector memanggil method store yang memakai `get()` (bukan akses state langsung) & mem-filter seluruh array setiap store change.
- **Status**: ✅ SELESAI
- **Aksi (dieksekusi)**:
  - [x] Selector **primitive** `(s) => s.transactions.filter(isPendingTransaction).length` — hasil number → re-render HANYA saat count berubah. (Catatan review: pendekatan `s.transactions` + useMemo justru re-render pada tiap mutasi transaksi termasuk `updateKitchenStatus` dari KDS → diganti primitive selector)
  - [x] Berlaku juga di `Layout.tsx` (badge counter quick-access)
  - [x] Helper bersama `isPendingTransaction(t)` di-export dari `transactionStore` — satu sumber kebenaran predicate (dipakai POS, Layout, PendingPaymentsModal, Transactions)
  - ✅ Validasi: tsc 0 error

### 3.2 PendingPaymentsModal tidak reaktif terhadap store
- **File**: `src/components/PendingPaymentsModal.tsx`
- **Masalah**: `getPendingTransactions()` dipanggil langsung saat render (memakai `get()`, bukan subscription) → daftar tidak re-render saat transaksi pending berubah; destructuring seluruh store juga memicu re-render berlebihan.
- **Status**: ✅ SELESAI
- **Aksi (dieksekusi)**:
  - [x] `useTransactionStore((s) => s.transactions)` (selector stabil — referensi array hanya berubah saat array diganti) + `useMemo` filter pakai `isPendingTransaction`; `cancelPendingTransaction` via selector terpisah
  - [x] **Dead code cleanup** (temuan review): `getPendingTransactions()` & `getPendingCount()` dihapus dari interface + implementasi store — tidak ada pemanggil aktif lagi (verifikasi grep); `Transactions.tsx` kini memakai helper `isPendingTransaction` (baris 152)
  - ✅ Validasi: tsc 0 error + 26/26 test lolos

### 3.3 Sinkronisasi versi dokumen
- **Masalah**: PRD v4.4 vs ROADMAP v4.1 vs DEPLOYMENT v4.2 — inkonsisten.
- **Status**: ✅ SELESAI
- **Aksi (dieksekusi)**:
  - [x] ROADMAP.md: header `v4.4` + status `✅ IMPLEMENTED` (fitur Pending & Split selesai, rujuk TO DO.md) + footer v4.4
  - [x] DEPLOYMENT.md: header & footer v4.4
  - [x] PRD.md: footer `v4.2` → v4.4
  - [x] FEATURES.md: footer `v4.2` → v4.4
  - [x] AI-HANDOFF.md: paragraf ringkas `v4.2` → v4.4
  - [x] Verifikasi grep: tidak ada lagi referensi `BerdikariPOS v4.0–v4.3` yang salah

### 3.4 Dokumentasi modul Backup & Bundle Menu
- **Masalah**: Modul Backup & Bundle belum terdokumentasi di PRD/FEATURES/AI-HANDOFF.
- **Status**: ✅ SELESAI
- **Aksi (dieksekusi)**:
  - [x] FEATURES.md: fitur **13. 💾 Backup & Restore Otomatis** (3 mode, checksum SHA-256, riwayat, auto-backup terjadwal, restore wizard) + **14. 🧩 Bundle Menu (Paket Hemat)** (validasi, child items, HPP, snapshot, repository)
  - [x] PRD.md: requirement **3.13 Modul Backup & Restore** + **3.14 Modul Bundle Menu** dengan pointer file implementasi
  - [x] AI-HANDOFF.md: blok konteks Backup & Bundle di section 4 (file kunci, cakupan, rujukan test `bundle.test.ts`)
  - ✅ Berdasarkan audit kode aktual: `BackupService` (ZIP + SHA-256, 3 mode), `backupStore` (history + autoBackupConfig), `components/backup/*` (5 komponen); bundleService/bundleValidation/bundleRepository

### 3.5 `statusBadge` case `'Pending'`
- **Status**: ✅ SUDAH SELESAI (bagian dari 1.7) — `Transactions.tsx` baris 341-342: case `'Pending'` dengan badge amber + ikon Clock. Diverifikasi ulang.


---

## 🔵 PRIORITAS 4 — PERBAIKAN v4.5 (Pending Payment & Split Bill Refinements)

### 4.1 Saran Nominal & Kembalian di Split Bill
- **Masalah**: Modal Split Bill tidak memiliki tombol cepat untuk nominal pembayaran tunai (quick cash) dan info kembalian.
- **Aksi**: 
  - [x] Tambahkan tombol cepat saran nominal di modal Split Bill (mendekati tagihan sub-bill).
  - [x] Tampilkan selisih kembalian jika nominal pembayaran tunai yang dimasukkan melebihi total sub-bill.

### 4.2 Duplikasi Pesanan di KDS saat Split Bill
- **Masalah**: Saat terjadi split bill, pesanan KDS terinput kembali (duplikat antrean di dapur).
- **Aksi**: 
  - [x] Pastikan sub-bill hasil split tidak memicu atau menduplikasi antrean baru di dapur (cukup tiket dapur dikelola sekali di awal sesi split).

### 4.3 Duplikasi Riwayat Transaksi saat Split Bill
- **Masalah**: Pesanan hasil split bill (sub-bill) masuk kembali/duplikat di Riwayat Transaksi sehingga mengacaukan riwayat data transaksi.
- **Aksi**: 
  - [x] Perbaiki logika pencatatan transaksi split bill di halaman Riwayat Transaksi agar bersih dari data duplikat/tidak perlu.

### 4.4 Penghapusan Pesanan Pending Setelah Lunas / Batal
- **Masalah**: Pesanan Pending yang telah dilanjutkan pembayarannya (resume) hingga lunas atau dibatalkan (void) tidak otomatis terhapus dari daftar Pesanan Pending.
- **Aksi**: 
  - [x] Pastikan status transaksi pending di-update di store/DB sehingga terhapus dari modal "Pending Payments" saat sudah lunas atau dibatalkan.

### 4.5 Penyederhanaan Judul Modal Pending
- **Masalah**: Judul modal "Daftar Pesanan Gantung (Pending Payment)" terlalu panjang.
- **Aksi**: 
  - [x] Ubah judul modal tersebut cukup menjadi "Pending Payments".

---

## ✅ YANG SUDAH BENAR (jangan diubah)

- **Atomic Engine**: rollback engine, snapshot resep/HPP permanen, error isolation printing, validasi all-or-nothing — solid untuk alur normal.
- **Offline Queue**: self-healing strip kolom, dedup, sorting dependensi — desain baik.
- **KDS**: filter `Selesai` + `Pending` sudah sesuai ROADMAP; alert 5 menit + mute + auto-reconnect bekerja.
- **Shift & expected cash**: hanya menghitung transaksi `Selesai` → pending tidak mencemari laci kas.
- **Printer Device Registry** (v4.0) + status banner polling 3 detik: rapi.
- **Queue number**: pending ikut mengonsumsi nomor antrean; `loadFromCloud` menangkal duplikasi lintas device.

---

## 🎯 Urutan Eksekusi yang Disarankan

1. **DB layer dulu** (1.2) — tanpa ini, fitur lain tidak bisa sync lintas device.
2. **Alur pending inti** (1.1, 1.3, 1.4) — akses UI + finalize yang benar.
3. **Alur split** (1.5, 1.6, 1.7) — stok & akuntansi.
4. **Pemolesan** (2.x, 3.x).

---

*Dokumen dibuat berdasarkan analisa statis kode — belum ada perubahan yang diterapkan.*
