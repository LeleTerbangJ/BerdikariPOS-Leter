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
- **Status**: ✅ SELESAI (diselesaikan bersama TO DO 5.4)
- **Aksi**: Gunakan `calculateItemDeductions(tx.items, menus)` yang memprioritaskan recipeSnapshot — ✅ `transactionStore.ts` `cancelPendingTransaction` kini memakainya; fallback `menu.ingredients` hanya untuk transaksi lama tanpa snapshot (diuji di `pendingVoid.test.ts`).

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
- **Ringkasan Pengerjaan**: ✅ Selesai (`src/components/SplitBillModal.tsx`) — Menambahkan tombol saran nominal tunai otomatis (pas, Rp5.000, Rp10.000, Rp20.000, Rp50.000, Rp100.000) dan tampilan info kembalian dinamis.

### 4.2 Duplikasi Pesanan di KDS saat Split Bill
- **Masalah**: Saat terjadi split bill, pesanan KDS terinput kembali (duplikat antrean di dapur).
- **Aksi**: 
  - [x] Pastikan sub-bill hasil split tidak memicu atau menduplikasi antrean baru di dapur (cukup tiket dapur dikelola sekali di awal sesi split).
- **Ringkasan Pengerjaan**: ✅ Selesai (`src/pages/Kitchen.tsx`) — Menambahkan filter `if (t.splitParentId) return false` agar transaksi anak hasil split bill tidak masuk antrean KDS.

### 4.3 Duplikasi Riwayat Transaksi saat Split Bill
- **Masalah**: Pesanan hasil split bill (sub-bill) masuk kembali/duplikat di Riwayat Transaksi sehingga mengacaukan riwayat data transaksi.
- **Aksi**: 
  - [x] Perbaiki logika pencatatan transaksi split bill di halaman Riwayat Transaksi agar bersih dari data duplikat/tidak perlu.
- **Ringkasan Pengerjaan**: ✅ Selesai (`src/pages/Transactions.tsx`) — Filter transaksi disesuaikan agar hanya menampilkan transaksi induk dan menyembunyikan sub-bill anak dari daftar riwayat.

### 4.4 Penghapusan Pesanan Pending Setelah Lunas / Batal
- **Masalah**: Pesanan Pending yang telah dilanjutkan pembayarannya (resume) hingga lunas atau dibatalkan (void) tidak otomatis terhapus dari daftar Pesanan Pending.
- **Aksi**: 
  - [x] Pastikan status transaksi pending di-update di store/DB sehingga terhapus dari modal "Pending Payments" saat sudah lunas atau dibatalkan.
- **Ringkasan Pengerjaan**: ✅ Selesai (`src/store/transactionStore.ts`) — Mengupdate `updateTxStatus` agar otomatis mengeset `isPending: status === 'Pending'` sehingga transaksi lunas/batal otomatis hilang dari daftar pending.

### 4.5 Penyederhanaan Judul Modal Pending
- **Masalah**: Judul modal "Daftar Pesanan Gantung (Pending Payment)" terlalu panjang.
- **Aksi**: 
  - [x] Ubah judul modal tersebut cukup menjadi "Pending Payments".
- **Ringkasan Pengerjaan**: ✅ Selesai (`src/components/PendingPaymentsModal.tsx`) — Mengubah string judul modal menjadi "Pending Payments".

### 4.6 Fix Build Error Vercel (cloudSync.ts)
- **Ringkasan Pengerjaan**: ✅ Selesai (`src/lib/cloudSync.ts`) — Memperbaiki syntax error missing closing brace `}` pada blok migrasi `if (receiptPrintMissing)` yang menyebabkan gagal build di Vercel.

---

## 🟣 PRIORITAS 5 — AUDIT END-TO-END PENDING & SPLIT (Temuan Baru, v4.5)

> Sumber: audit menyeluruh alur save/update/resume/finalize pending, split (fresh & pending, equal & item), void, dan laporan. Status: **belum dikerjakan** — semua item di bawah masih checkbox kosong.

### 5.1 Double-deduction stok saat modal Split ditutup di tengah lalu dibuka lagi (KRITIS)
- **File**: `src/components/SplitBillModal.tsx`, `src/utils/splitStockSession.ts` (baru), `src/pages/POS.tsx`
- **Masalah**: `sessionReservedRef` di-reset ke `null` di `useEffect` saat modal dibuka **dan** di `handleClose`, tapi stok yang sudah dipotong di sesi pertama tidak pernah dikembalikan penuh:
  - **Item mode**: tutup di tengah → revert hanya item belum lunas (`full − accumulated`), refs di-null-kan → buka lagi → sub-bill pertama yang dibayar dianggap sub-bill pertama → `deductStock(fullDeductions)` **lagi** → stok item yang sudah lunas di sesi 1 terpotong ganda.
  - **Equal mode**: akumulasi `sessionPaidRef` menghitung deduksi PENUH per sub-bill (semua sub-bill membawa semua item) → `full − accumulated ≤ 0` → **tidak ada revert** → buka lagi → `deductStock(full)` lagi → stok terpotong 2× padahal revenue belum lunas penuh.
  - Skenario nyata: kasir bayar 1 sub-bill, tutup modal (sibuk), buka lagi nanti, bayar sisanya → stok bocor.
- **Status**: ✅ SELESAI
- **Aksi (dieksekusi)**:
  - [x] **Modul murni `src/utils/splitStockSession.ts`** (baru): `SplitStockSession` (signature cart + reserved + paid + visitRecorded), `computeCartSignature` (menuId:qty:addons:temperature:sugar, di-sort — lebih lengkap dari signature POS 5.6), `accumulatePaidPortion` (**cap per inventoryId pada nilai reserve**), `computeUnpaidPortion` (reserved − paid, hanya positif), persistensi localStorage (recovery lintas reload PWA — sesi tidak hilang saat hard-refresh).
  - [x] **Holder session module-level singleton** (`getActiveSplitStockSession` / `setActiveSplitStockSession` / `releaseSplitReserveForCart`) — bisa diakses SplitBillModal DAN POS (POS perlu melepas reserve saat kasir beralih ke checkout normal dari cart yang sama).
  - [x] `SplitBillModal`: refs lama dihapus; sesi TIDAK lagi di-reset di `useEffect([open])` — reserve dipertahankan lintas buka/tutup → pembayaran sesi berikutnya TIDAK memotong stok lagi (`isFirstPaymentOfSession` = hanya saat sesi belum punya reserve).
  - [x] `handleClose` **tidak lagi me-revert/meng-clear** stok — sesi berlanjut; reserve dilepas hanya saat: semua sub-bill lunas (`setActiveSplitStockSession(null)` di kedua cabang all-paid) atau **isi cart berubah** (useEffect cartItems → revert `computeUnpaidPortion` → sesi baru). Bagian yang sudah lunas TIDAK di-revert (stok sudah terpakai sah).
  - [x] `POS.tsx`: `handleSavePending` & `finalizeTransaction` memanggil `releaseSplitReserveForCart(cart.items)` sebelum engine checkout — jika kasir menutup modal split di tengah lalu memilih Simpan Pending / Bayar NORMAL dari cart yang sama, sisa reserve (belum lunas) dikembalikan → engine tidak memotong full di atas reserve (double deduction tertutup di jalur ini).
  - [x] `visitRecorded` dipindah ke sesi (fresh split) + keyed by parent id (pending split) — tidak double-record lintas buka/tutup.
  - [x] Toast info di POS saat reserve sesi split dilepas (kasir melihat sesi yang belum selesai dibatalkan).
  - ✅ Validasi: tsc 0 error + 55/55 test lolos (13 test baru di `src/test/splitStockSession.test.ts`: signature stabil/sensitif suhu-gula, cap paid equal vs akumulasi item, unpaid parsial, release POS, persist holder).
  - ⚠️ **Residual (review)**: jalur "abandon split ber-porsi-lunas → checkout NORMAL penuh" (bayar sub-bill 1 → tutup modal → klik Bayar pada cart yang sama) masih double-deduct di stok: `releaseSplitReserveForCart` hanya mengembalikan bagian unpaid, lalu engine memotong full lagi → porsi yang sudah lunas terpotong 2×. Ini adalah jalur bisnis ganda (customer dibayar 2×) yang seharusnya dikonfirmasi kasir — di luar lingkup 5.1, tercatat untuk fix lanjutan (ide: blokir/konfirmasi saat `session.paid > 0` dan kasir beralih ke checkout normal).
  - ⚠️ **Residual (review)**: karena `handleClose` tidak lagi me-revert, reserve bisa tertahan tanpa jalur pembersihan jika cart tidak pernah berubah & modal tidak dibuka lagi (hanya bisa dibebaskan via cart berubah / semua lunas / reload-recovery). Saran: tombol "Batalkan Sesi Split" eksplisit di modal, atau dokumentasi penyesuaian manual via Inventory.

### 5.2 HPP split equal *fresh* ter-inflasi N× di laporan Laba Kotor & profitabilitas menu (KRITIS)
- **File**: `src/pages/Reports.tsx` (baris 149 `totalHPP = filteredTx.reduce((a,t) => a + t.hpp, 0)`), `src/pages/Dashboard.tsx` (baris 70, 287–299), `src/lib/atomicTransactionEngine.ts` (`tx.hpp = totalHpp`)
- **Masalah**: Sub-bill mode Equal membawa **semua item cart** → engine memberi `tx.hpp = HPP penuh` per sub-bill. Karena sub-bill fresh **tidak punya `splitParentId`** (tidak ada induk), semuanya dihitung laporan → `Σ hpp = N × HPP penuh`, padahal revenue hanya `total` sekali → Laba Kotor & margin jadi salah (bisa negatif palsu). Profitabilitas per-menu di Dashboard ikut ter-inflasi N×.
  - ⚠️ Catatan TO DO 1.6 *"HPP mode equal … sudah benar"* **terbukti keliru** — benar hanya untuk pending split (parent dihitung, anak diexclude) dan item mode (item disjoint).
- **Status**: ✅ SELESAI
- **Aksi (dieksekusi)**:
  - [x] Param **`scaleHpp?: number`** ditambahkan di `AtomicCheckoutParams` (`src/types/index.ts`) — engine menghitung `scaledHpp = Math.round(totalHpp * scaleHpp)` dan memakainya untuk `hpp`/`cogs`/`totalCogs`/`grossProfit` (`src/lib/atomicTransactionEngine.ts`). Tanpa param → `scaleHpp = 1` → alur normal tidak berubah.
  - [x] `SplitBillModal` menghitung **`fullHpp`** sekali (useMemo dari snapshot cart) dan mengalokasikan ke N sub-bill dengan **Largest Remainder Method** (`allocateProportional(fullHpp, 1/N)`); tiap sub-bill mengirim `scaleHpp = allocated[i] / fullHpp` → `Math.round(fullHpp * scale_i) = allocated_i` → **Σ hpp sub-bill === HPP induk persis** (tanpa selisih rupiah). Berlaku untuk equal fresh & pending (konsisten). Mode item (item disjoint) TIDAK diskalakan — HPP sudah proporsional alami.
  - [x] Verifikasi unit (test baru di `splitStockSession.test.ts`): untuk berbagai `totalHpp` × N, `Math.round(totalHpp * (allocated_i / totalHpp)) === allocated_i` dan Σ klop.
  - ✅ Validasi: tsc 0 error + 55/55 test lolos.
  - ✅ **Lanjutan diselesaikan di TO DO 5.11**: agregasi per-menu Dashboard & per-kategori Reports kini membagi kontribusi sub-bill equal dengan `totalSplitCount` (deteksi via `splitIndex` + Σ item ≠ subtotal) — qty/revenue/hpp per menu tidak lagi ter-inflasi N×.

### 5.3 Void pending yang sudah ber-anak split (dari PendingPaymentsModal) me-revert stok ganda
- **File**: `src/store/transactionStore.ts` (`cancelPendingTransaction`)
- **Masalah**: Tidak ada guard `hasSplitChildren` (Transactions.tsx punya guard serupa, jalur modal ini tidak). Pending yang di-resume lalu displit: parent tetap `Pending` selama sesi split berjalan → jika kasir void parent dari modal, stok reserve dikembalikan penuh padahal anak-anak sudah `Selesai` (revenue tercatat & makanan sudah dibuat) → stok overstated.
- **Status**: ✅ SELESAI
- **Aksi (dieksekusi)**:
  - [x] Export predicate murni `hasPendingSplitChildren(allTxs, parentId)` dari `transactionStore` (paralel pola `isPendingTransaction`) — satu sumber kebenaran guard "punya anak split".
  - [x] `cancelPendingTransaction`: jika `hasPendingSplitChildren(get().transactions, id)` → status tetap di-cancel tapi **stok TIDAK di-revert** (anak-anak sudah `Selesai`, stoknya terpakai sah — dikelola sesi split). Guard paritas dengan Transactions.tsx `onConfirmAction`/`onPinSuccess`.
  - ⚠️ Trade-off (review, perilaku sama dengan Transactions.tsx): void parent pending **di tengah sesi split** (baru sebagian sub-bill lunas) juga TIDAK me-revert porsi yang belum lunas — stok porsi itu tetap terpotong di parent. Ini trade-off desain sesi split yang sudah ada (bukan regresi 5.3); catat sebagai perilaku, bukan bug.
  - ✅ Validasi: tsc 0 error + 67/67 test lolos (test baru: split children no-revert, status tetap Cancel).

### 5.4 TO DO 2.1 belum tuntas — jalur void modal masih re-snapshot dari resep saat ini
- **File**: `src/store/transactionStore.ts` (`cancelPendingTransaction`), `src/utils/hpp.ts` (`createSnapshotForCartItems` selalu re-build snapshot)
- **Masalah**: `cancelPendingTransaction` memakai `createSnapshotForCartItems(tx.items, menus, inventory)` yang **selalu membangun ulang snapshot** dari menu/inventori saat ini (tidak menghormati `recipeSnapshot` tersimpan). Jika menu dihapus setelah pending dibuat → snapshot kosong → revert 0 → **stok bocor**. Jalur Transactions.tsx sudah benar (`calculateItemDeductions` memakai snapshot tersimpan).
- **Status**: ✅ SELESAI
- **Aksi (dieksekusi)**:
  - [x] `cancelPendingTransaction` diganti memakai **`calculateItemDeductions(tx.items, menus)`** (statis, tanpa nested dynamic import) — memprioritaskan `recipeSnapshot` tersimpan; fallback `menu.ingredients` hanya transaksi lama tanpa snapshot. Dynamic imports berlapis (hpp/menuStore/inventoryStore/inventoryEngine) dihapus — import statis aman (verifikasi: tidak ada store yang import `transactionStore`, tanpa cycle).
  - [x] Guard `deductions` kosong (semua `manual_*`/tanpa bahan) → skip revert — konsisten dengan engine yang juga skip bahan manual.
  - ✅ Validasi: tsc 0 error + 67/67 test lolos (test baru: revert tetap benar walau menu dihapus dari menuStore — bukti 5.4; fallback legacy tetap revert; tanpa item/id tidak ada revert).

### 5.5 Promo bocor ke order berikutnya & total order resume bisa berubah lintas device
- **File**: `src/pages/POS.tsx` (`handleSavePending`, `handleResumePendingOrder`), `src/types/index.ts`, `src/lib/atomicTransactionEngine.ts`, `src/lib/cloudSync.ts`, `supabase/schema.sql`, `DEPLOYMENT.md`
- **Masalah**:
  - Blok sukses `handleSavePending` **tidak memanggil `clearPromo()`** (finalizeTransaction melakukannya) → promo tetap aktif untuk keranjang berikutnya → order baru dapat diskon promo tanpa dimaksudkan.
  - Transaksi pending **tidak menyimpan** `appliedPromoId`/`voucherCode` → setelah app restart / dari device lain, resume kehilangan promo → `totalAmount` final dihitung ulang **berbeda dari nominal pending** yang tampil saat disimpan (selisih bisa membingungkan kasir/pelanggan).
- **Status**: ✅ SELESAI
- **Aksi (dieksekusi)**:
  - [x] `handleSavePending` blok sukses kini memanggil **`clearPromo()`** (menggantikan `setVoucherCode('')` saja) — `appliedPromoId` + `voucherCode` + `promoError` dibersihkan → promo tidak bocor ke keranjang berikutnya.
  - [x] **Kolom DB baru** di transactions: `applied_promo_id TEXT`, `voucher_code TEXT` — `supabase/schema.sql` (CREATE TABLE + blok ALTER migrasi + skrip migrasi komentar), `DEPLOYMENT.md` (blok upgrade), dan **Migration 17** di `runMigrations()` (deteksi + guard `migrationNeeded.appliedPromoId`/`voucherCode`).
  - [x] **Tipe**: `Transaction.appliedPromoId?/voucherCode?` + `AtomicCheckoutParams.appliedPromoId?/voucherCode?`; **engine** menyalin keduanya ke `tx` saat checkout.
  - [x] **cloudSync**: `syncTransaction` menulis `applied_promo_id`/`voucher_code` (guard migrasi); `fetchTransactionsFromCloud` memetakan keduanya → pending dengan promo tersinkron lintas device.
  - [x] **Resume**: `handleResumePendingOrder` me-restore `appliedPromoId` + `voucherCode` (setPromoError kosong) jika ada; jika pending tanpa promo → `clearPromo()` (cegah promo stale bocor ke pesanan yang di-resume). `finalizeTransaction` lalu menghitung total dengan promo yang sama → konsisten dengan nominal pending.
  - ✅ Validasi: tsc 0 error + **71/71 test lolos** (test baru di `cloudSyncMapping.test.ts`: mapping `appliedPromoId`/`voucherCode` dari cloud).
  - ⚠️ Catatan (review): (1) diskon MANUAL (Rp/%) tidak ikut disimpan di metadata pending (di luar lingkup 5.5) — jika pending dibuat dengan diskon manual, resume tetap kehilangan nominal itu; (2) jika promo yang di-restore sudah EXPIRED / minPurchase-loyalty tidak terpenuhi lagi saat resume, `calculatePromoDiscount` = 0 → total tampil berbeda dari nominal pending (kelas divergensi yang sama dengan yang 5.5 perbaiki) — perilaku wajar, kasir bisa memilih promo lain; (3) `finalizeTransaction` kini ikut menyimpan `appliedPromoId`/`voucherCode` agar atribusi promo tidak hilang pada tx `Selesai` hasil resume.

### 5.6 `pendingItemsChanged` tidak mendeteksi perubahan suhu / level gula
- **File**: `src/pages/POS.tsx` (signature `pendingItemsChanged`)
- **Masalah**: Signature hanya `menuId:quantity:addons` — ubah suhu (Hangat→Dingin) atau level gula tidak terdeteksi → `overrideKitchenStatus` mempertahankan status dapur (mis. `Processing`) → dapur bisa memasak versi lama.
- **Status**: ✅ SELESAI
- **Aksi (dieksekusi)**:
  - [x] `pendingItemsChanged` kini memakai **`computeCartSignature`** (dari `src/utils/splitStockSession.ts`) — signature `menuId:qty:addons:temperature:sugar` yang sudah menyertakan suhu & level gula (di-sort). Satu sumber kebenaran dengan sesi stok split (5.1) — menghilangkan signature duplikat yang tidak lengkap.
  - [x] Sensitivitas suhu/gula sudah di-cover unit test `splitStockSession.test.ts` (test signature dari 5.1) — tidak perlu test baru.
  - ✅ Validasi: tsc 0 error + **71/71 test lolos**.

### 5.7 `paidState` & konfigurasi mode tidak di-reset saat modal dibuka ulang
- **File**: `src/components/SplitBillModal.tsx`, `src/utils/splitStockSession.ts`
- **Masalah**: `paidState`, `mode`, `equalCount`, `itemAssignments`, `billCountCustom`, `activeBillIdx` tidak di-reset di `useEffect([open])` → state progres lama bertahan (terlihat seperti "melanjutkan sesi") dan **bersinergi memperparah 5.1** (progres tampil lunas tapi stok reserve sudah hilang).
- **Status**: ✅ SELESAI
- **Aksi (dieksekusi)** — kebijakan sesi: **resume-dalam-sesi DIDUKUNG** (5.1), jadi `paidState` di-sinkronkan dengan session, bukan sekadar di-reset:
  - [x] **Reset berbasis konteks**: `useEffect([open, parentTx?.id, cartItems])` — saat modal dibuka dengan KONTEKS berbeda (parent berubah / signature cart berubah) semua state UI di-reset (`mode/equalCount/billCountCustom/activeBillIdx/itemAssignments/paidState`). Reopen konteks SAMA = resume sesi → progress dipertahankan (bukan stale).
  - [x] **Rehydrate dari session**: `SplitStockSession` diperluas dengan `paidBills` (index → `{payMethod, cash}`), `mode`, `count`, `queueNumber`; helper murni `recordPaidBill()`. Saat reopen fresh split dengan session yang cocok: `paidState` di-restore (sub-bill lunas tetap tampil lunas → **tidak bisa dibayar dua kali** = cegah duplikasi revenue), mode/count di-restore, `activeBillIdx` diarahkan ke sub-bill belum lunas pertama. Bertahan lintas reload PWA (persist localStorage).
  - [x] **Sabuk pengaman anti re-pay** (temuan review): guard di awal `handlePaySubBill` — `!parentTx && activeSession?.paidBills?.[billIdx]` → tolak + toast, membuat pembayaran ganda mustahil walau rehydrate paidState gagal (sesi lama tanpa paidBills setelah upgrade app).
  - ⚠️ Residual (review, terdokumentasi): (1) sesi **lama pra-5.7** tanpa `paidBills` tidak bisa direkonstruksi (level stok `paid` ter-cap di `reserved` — tidak memetakan ke index bill) — sub-bill bisa di-re-pay SEKALI setelah upgrade; guard mencegahnya untuk sesi baru; (2) sesi dikunci oleh **signature cart** — dua order identik beruntun (cart sama persis) bisa mewarisi `paidBills` order sebelumnya → order kedua tampil "bill 1 lunas" (sempit, inheren desain 5.1).
  - ✅ Validasi: tsc 0 error + **74/74 test lolos** (3 test baru di `splitStockSession.test.ts`: recordPaidBill gabung/overwrite idempoten, persist-load round-trip paidBills/mode/count/queueNumber).

### 5.8 `updateTxMeta` tidak sync cloud — paymentMethod parent split tidak lintas device
- **File**: `src/store/transactionStore.ts` (`updateTxMeta`), `src/lib/cloudSync.ts` (`syncTransactionMeta` baru), `src/components/SplitBillModal.tsx` (`finalizeSplitParent`)
- **Masalah**: `updateTxMeta` hanya update lokal. Parent pending yang diubah ke paymentMethod mayoritas (mis. QRIS) tetap `'Cash'` di Supabase → device lain melihat distribusi pembayaran salah.
- **Status**: ✅ SELESAI
- **Aksi (dieksekusi)**:
  - [x] `syncTransactionMeta(id, partial)` baru di cloudSync — memetakan eksplisit field yang didukung (`paymentMethod → payment_method`), field lain diabaikan (tidak menulis kolom tak dikenal), `smartUpdate` via offline queue (offline → ter-flush).
  - [x] `updateTxMeta` kini memanggil `syncTransactionMeta(id, partial)` sebelum `set()` lokal — `finalizeSplitParent` (paymentMethod mayoritas parent split) otomatis lintas device tanpa perubahan di modal.
  - ✅ Validasi: tsc 0 error + **74/74 test lolos**.

### 5.9 Sub-bill split *fresh* memakai nomor antrean baru (N nomor untuk 1 order)
- **File**: `src/lib/atomicTransactionEngine.ts` (`getNextQueueNumber`), `src/components/SplitBillModal.tsx`, `src/utils/splitStockSession.ts`
- **Masalah**: Setiap sub-bill fresh mendapatkan nomor antrean baru → 1 pesanan menghasilkan N nomor antrean (audit/KDS struk tidak konsisten).
- **Status**: ✅ SELESAI
- **Aksi (dieksekusi)**:
  - [x] Sub-bill split FRESH kini mengirim **`overrideQueueNumber: session.queueNumber`** — nomor dikunci dari sub-bill pertama sesi yang berhasil (disimpan di `session.queueNumber` setelah commit), semua sub-bill berikutnya memakai nomor yang sama → 1 pesanan = 1 nomor antrean (struk menampilkan `#N` + label Bagian X dari M).
  - [x] Pending split TIDAK diubah (parent sudah punya nomornya; sub-bill invisible di KDS/laporan).
  - ✅ Validasi: tsc 0 error + **74/74 test lolos** (round-trip `queueNumber` di `splitStockSession.test.ts`).

### 5.10 Rekap temuan Prioritas 4 yang belum tuntas (perlu diintegrasikan)
- [x] **4.2** Filter KDS hanya `t.splitParentId` — sub-bill **split fresh** (`splitIndex` terisi, `splitParentId` undefined, `kitchenStatus: 'Waiting'`) masih masuk antrean KDS → duplikat. ✅ SELESAI — helper murni `isSplitSubBill(tx)` (`splitParentId || splitIndex !== undefined`) di `src/utils/splitAllocation.ts`; `Kitchen.tsx` filter aktifOrders memakainya (tiket dapur split fresh sudah dicetak sekali saat sub-bill pertama sesi dibayar, jadi eksklusi KDS benar). Test: `isSplitSubBill` di `splitAllocation.test.ts`.
- [x] **4.4** `updateTxStatus` set `isPending` lokal ✅ tapi `syncTransactionTxStatus` hanya sync `tx_status` → kolom `is_pending` di DB tetap `true` → device lain (via `fetchTransactionsFromCloud` mapping `row.is_pending || ...`) masih melihat order lunas/batal sebagai Pending. ✅ SELESAI — (1) `fetchTransactionsFromCloud`: `isPending: row.tx_status === 'Pending'` (tx_status otoritatif, kolom stale ditolak); (2) `syncTransactionTxStatus` kini ikut menulis `is_pending` (guard `!migrationNeeded.isPending`) agar DB konsisten ke depan. Test: `cloudSyncMapping.test.ts` (2 test — row stale `is_pending=true`/`tx_status='Selesai'` → tidak pending; pending aktif tetap terdeteksi; mapping split fresh).
  - ✅ Validasi 5.10: tsc 0 error + **70/70 test lolos** (8 file).
  - ⚠️ Catatan (review): sub-bill split fresh kini `kitchenStatus: 'Waiting'` selamanya (tersembunyi dari KDS, tidak ada yang menandai Done) — pola yang sama sudah berlaku untuk anak pending-split; `getActiveKitchenOrders()` store tetap menghitungnya jika ada consumer. Residual teoritis `isPendingTransaction` lokal masih OR `t.isPending === true`, tapi store selalu derive konsisten dengan txStatus — tidak butuh aksi. Predikat split kini 3 (isSplitSubBill / hasPendingSplitChildren / hasSplitChildren inline Transactions) — kandidat unifikasi masa depan.

### 5.11 Agregasi per-menu (Dashboard) & per-kategori (Reports) ter-inflasi N× oleh sub-bill split equal (lanjutan catatan 5.2)
- **File**: `src/pages/Dashboard.tsx` (`menuSales` Top Menu, `menuProfitability` 30-hari), `src/pages/Reports.tsx` (`categorySales`), `src/utils/splitAllocation.ts`
- **Masalah**: 5.2 memperbaiki `tx.hpp` (level transaksi), tapi agregasi **per-item** di Dashboard (Top Menu & Profitabilitas Menu) dan Reports (Penjualan per Kategori) masih menjumlah `item.quantity`/`item.subtotal`/`item.hpp` mentah. Sub-bill split **equal** membawa SEMUA item cart di tiap bagian → qty, revenue, dan HPP per menu/kategori ter-inflasi N× (Laba Kotor per menu & margin jadi salah).
- **Status**: ✅ SELESAI
- **Aksi (dieksekusi)**:
  - [x] Helper murni di `src/utils/splitAllocation.ts`: **`isEqualSplitSubBill(tx)`** (deteksi: `splitIndex` terisi + `totalSplitCount >= 2` + `|Σ item.subtotal − subtotal| >= 1` — mode item selalu Σ item = subtotal persis; toleransi >= 1 menangkap edge kasir kecil seperti subtotal 2 dibagi 2) dan **`splitContributionDivisor(tx)`** (return `totalSplitCount` untuk equal, 1 untuk semua transaksi lain — transaksi normal, pending parent, sub-bill item mode, split pending yang punya parent tetap tidak berubah).
  - [x] Dashboard `menuSales`: `qty += item.quantity / div` — Top Menu & Best Seller tidak lagi N× (tampilan qty pecahan diformat `1.5x` saat perlu).
  - [x] Dashboard `menuProfitability`: `qty/revenue/hpp += item.* / div` — profit & margin per menu pulih (Σ kontribusi N sub-bill === jumlah sebenarnya; revenue/hpp pecahan diratakan `formatRupiah` yang sudah `Math.round`).
  - [x] Reports `categorySales`: `revenue/qty += item.* / div` — Penjualan per Kategori (UI + export CSV/PDF P&L) tidak lagi N× (kelas bug identik, diperbaiki bersama agar laporan konsisten).
  - [x] Unit test `src/test/splitAllocation.test.ts` (6 test baru): deteksi equal vs item vs normal, guard `totalSplitCount` 1/undefined, edge subtotal 2÷2, dan **agregasi lintas 2 sub-bill equal** (qty 4→2, revenue 200.000→100.000, hpp 60.000→30.000 — laba tidak ter-inflasi).
  - [x] **Unifikasi deteksi** (temuan review): `buildEqualSplitReceipt` kini memakai `isEqualSplitSubBill` sebagai satu sumber kebenaran (sebelumnya strict `itemsTotal === subtotal` yang bisa divergen) — guard `<= 0` tetap sebagai hardening.
  - ⚠️ Residual patologis (didokumentasikan di JSDoc): tagihan Rp 1 dibagi 2 → alokasi [1, 0]; sub-bill bershare 0 terdeteksi equal (divisor 2), yang bershare 1 tidak (selisih 0, tak bisa dibedakan dari mode item) → agregasi over-count ≤ 0,5 rupiah hanya pada transaksi Rp 1 — diabaikan untuk pelaporan.
  - ✅ Validasi: tsc 0 error + **61/61 test lolos** (6 file).

---

## 🟠 PRIORITAS 6 — QUOTA LOCALSTORAGE PENUH (Error Berantai di Produksi, KRITIS)

> Sumber: insiden live di perangkat mobile — toast `Failed to execute 'setItem' on 'Storage': Setting the value of 'rempah-transactions' exceeded the quota`, popup confirm saat resume pending, dan shift tidak bisa ditutup. Status: **belum dikerjakan**.

### 6.1 Root cause — kuota localStorage habis (~5MB di browser mobile)
- **File**: semua store (persist zustand), `src/lib/cloudSync.ts` (`fetchTransactionsFromCloud` limit 500), `src/store/auditLogStore.ts` (cap 10.000), `src/store/stockLogStore.ts`, `src/utils/imageUpload.ts` (base64 fallback)
- **Masalah**: Seluruh 12+ store dipersist ke localStorage dengan total payload besar:
  - `rempah-transactions`: `loadFromCloud` menarik **500 transaksi cloud** + lokal; tiap transaksi membawa `items[]` + `recipeSnapshot` (inventoryName/unit/unitCost/subtotalCost/dll) + addons + bundle snapshot → 1 transaksi ±2–6KB → bisa >1–3MB sendirian.
  - `rempah-audit-logs`: cap **10.000 entri** (`.slice(0, 10000)`) — tiap checkout/void/menu/login di-log → bisa 2MB+.
  - `rempah-stock-logs`: 500 entri cloud. Plus gambar menu **base64** (fallback imageUpload) yang sangat besar.
- **Bukti perilaku zustand 4.5**: persist dengan storage sinkron **MELEMPAR error** (bukan menelan) — terverifikasi di `node_modules/zustand/system/middleware.development.js` baris ~472–483: `api.setState` → `void setItem()` → `storage.setItem` sinkron → `QuotaExceededError` **propagasi ke pemanggil `set()`**.
- **Status**: ✅ SELESAI (langkah cepat) — item IndexedDB permanen tetap terbuka
- **Aksi (dieksekusi)**:
  - [x] **Safe-storage wrapper** — `src/utils/safeStorage.ts` (baru): Storage-compliant wrapper yang TIDAK melempar QuotaExceededError (console.warn + data tetap aman di memory & cloud). Diterapkan ke **SEMUA 14 store persist** via `storage: createJSONStorage(() => safeStorage)`. Bukti zustand 4.5 melempar sinkron: `node_modules/zustand/system/middleware.development.js` (void setItem()).
  - [x] **`partialize` transactions store** — persist hanya jendela 90 hari ATAU 300 terbaru (mana lebih kecil) + Pending selalu dipertahankan; payload tersimpan TERBATAS. Helper murni `src/utils/storagePrune.ts` (`pruneTransactionsForStorage`, `capEntries`) + 12 test (prune 6, capEntries 3, safeStorage 3). Satu-pass tanpa sort ulang (memakai invariant urutan store) agar partialize di tiap `set()` tidak berat.
  - ⚠️ **Catatan trade-off offline**: setelah reload di perangkat OFFLINE, data lama di luar 300/90-hari tidak tampil lokal (cloud tidak bisa di-fetch) — laporan/riwayat kembali lengkap saat online (loadFromCloud fetch 500 terbaru). Konsekuensi yang diterima untuk menghentikan error kuota.
  - [x] Kurangi cap **audit log 10.000 → 2.000** (`capEntries`, `DEFAULT_AUDIT_LOG_CAP`) — addLog & loadFromCloud.
  - [x] Auto-clear **stock log 5.000 → 500** (`capEntries`, `DEFAULT_STOCK_LOG_CAP`) — selaras limit fetch cloud 500.
  - [x] Hardening `offlineQueue.saveQueue` — try/catch kuota agar `addToQueue`/smartUpsert tidak melempar.
  - [x] (Permanen) **Migrasi IndexedDB** — ✅ SELESAI: adapter `src/utils/idbStorage.ts` (baru) — Storage over IndexedDB untuk `rempah-transactions` & `rempah-audit-logs` via `createJSONStorage` — kuota jauh lebih besar dari localStorage.
    - **Desain**: object store `kv` (DB `berdikari-pos`, lazy-open sekali per sesi); cache in-memory sinkron (getItem hangat tanpa menunggu IDB); **migrasi one-time** — data lama di localStorage disalin ke IDB saat getItem pertama lalu dihapus dari localStorage (kuota lega); **fallback aman** ke `safeStorage` bila IDB gagal dibuka (private mode/blocked/SSR) → tidak pernah melempar ke alur bisnis.
    - **Store**: `transactionStore` & `auditLogStore` kini `storage: createJSONStorage(() => idbStorage)` (partialize/cap tetap berlaku).
    - **Race async hydrasi ditutup**: hydrasi zustand kini ASYNC (getItem IDB) dan middleware persist melakukan `set(stateFromStorage, true)` — bisa MENIMPA hasil merge cloud bila fetch selesai lebih dulu. `App.tsx` kini menunggu hydrasi selesai sebelum `loadFromCloud` transactions & audit-logs (`whenHydrated` via `persist.onFinishHydration`/`hasHydrated`).
    - **Dampak**: payload transaksi ±2–6KB × 300/90-hari & audit 2.000 entri yang dulu memenuhi kuota ~5MB kini tersimpan di IndexedDB (kapasitas mengikuti ruang disk, bukan batas tetap) — akar masalah kuota hilang permanen tanpa mengorbankan data.
    - **Temuan review (dieksekusi)**: `onblocked` (tab lain menahan koneksi) bersifat TRANSIENT — tidak lagi men-disable IDB untuk sesi; `dbPromise` di-reset agar operasi berikutnya retry ke IDB (test: tulis saat blocked → localStorage; tulis berikutnya → masuk IDB). `onerror`/SSR tetap disable sesi (aman, tanpa spam warning).
    - ✅ Validasi: `vitest` → **87/87 test lolos** (9 file; 13 test baru di `src/test/idbStorage.test.ts` — round-trip, overwrite, remove, cache sinkron, upgrade store, fail-open → fallback, blocked → fallback, migrasi one-time, tanpa IDB, kuota penuh tidak melempar, reset), `npx tsc --noEmit` → **0 error**.
  - ✅ Validasi: `vitest` → **38/38 test lolos** (5 file), `npx tsc --noEmit` → **0 error**.

### 6.2 Simpan Pending gagal dengan toast kuota (Gambar 1)
- **File**: `src/pages/POS.tsx` (`handleSavePending`), `src/lib/atomicTransactionEngine.ts` (try/catch + rollback)
- **Masalah**: `handleSavePending` → `executeCheckout` → `addTransaction(tx)` → zustand `set` → persist `setItem` → **QuotaExceededError dilempar sinkron** → tertangkap try/catch engine → rollback (stok di-restore) → `addToast(result.error)` menampilkan pesan mentah browser. Cart TIDAK di-clear (hanya di-clear saat sukses) → state cart tidak konsisten.
- **Status**: ✅ SELESAI — **superseded oleh 6.1** (safe-storage + IndexedDB): persist tidak lagi melempar ke alur bisnis, sehingga aksi di bawah tidak diperlukan (konsisten dengan AI-HANDOFF §10.2).
- **Aksi**:
  - [x] ~~Setelah 6.1 (safe storage), tambahkan try/catch eksplisit di `handleSavePending` & `finalizeTransaction` agar kegagalan persist tidak pernah memicu rollback bisnis yang salah.~~ — **TIDAK dieksekusi (tidak diperlukan)**: `safeStorage`/`idbStorage` tidak pernah melempar QuotaExceededError; rollback engine kini hanya terjadi untuk kegagalan bisnis sungguhan.

### 6.3 Popup confirm berulang saat lanjutkan pembayaran (Gambar 2–3)
- **File**: `src/pages/POS.tsx` (`handleResumePendingOrder`)
- **Masalah**: `window.confirm` native *"Keranjang saat ini berisi N item. Kosongkan keranjang & muat pesanan gantung #1?"* — guard anti-collision yang **bekerja normal**, bukan bug baru. Muncul berulang karena cart masih berisi item dari sesi gagal / sisa (akibat 6.2), sehingga resume selalu terhalang.
- **Status**: ✅ SELESAI — **superseded oleh 6.1/6.2**: cart konsisten setelah persist tidak gagal, jadi guard collision hanya muncul saat benar-benar ada item di cart (konsisten dengan AI-HANDOFF §10.2).
- **Aksi**:
  - [x] ~~Setelah 6.1/6.2 (state cart konsisten), guard ini tidak lagi mengganggu.~~ — **TIDAK dieksekusi (tidak diperlukan)**: akar masalah (cart tersisa dari sesi gagal) hilang sejak persist aman. Opsional masa depan: ganti `window.confirm` native dengan dialog aplikasi (Gabungkan / Kosongkan & Muat / Batal) — per ROADMAP Cart Collision Guard.

### 6.4 Deadlock tutup shift — kasir terkunci di modal (Gambar 4)
- **File**: `src/components/Layout.tsx` (`handleCloseShift`), `src/store/auditLogStore.ts` (`addLog`), `src/store/shiftStore.ts` (`closeShift`)
- **Masalah**: `handleCloseShift` memanggil `addLog(...)` dulu → auditLogStore `set` → persist `rempah-audit-logs` → **QuotaExceededError dilempar** → `handleCloseShift` **tanpa try/catch** → `closeShift(...)` tidak pernah tercapai → shift tetap aktif. Modal "Tutup Shift" dibuat `dismissible={false}` + `onClose={() => {}}` → **kasir terkunci total** (tidak bisa tutup modal, tidak bisa tutup shift).
  - Catatan: Ringkasan shift "Total Penjualan Rp 0" itu BENAR — memang tidak ada transaksi `Selesai` hari itu (semua gagal/terjebak).
- **Status**: ✅ SELESAI
- **Aksi (dieksekusi)**:
  - [x] `handleCloseShift` (`Layout.tsx`) di-restrukturisasi menjadi 4 langkah terisolasi: (1) audit log best-effort (try/catch), (2) cetak ringkasan best-effort (try/catch — printer gagal TIDAK menggagalkan tutup shift), (3) `closeShift` selalu dijalankan, (4) **escape path wajib**: `setShowCloseShift(false)` + `logout()` + `navigate('/')` dijalankan dalam SEMUA kasus — modal non-dismissible tidak bisa lagi mengunci kasir.
  - [x] Jika `closeShift` sendiri gagal (kuota persist), kasir tetap dilepas + toast error ("coba tutup shift lagi") — shift tersisa bisa dikoreksi via data cloud.
  - ✅ Validasi: tsc 0 error + 38/38 test lolos.

### 6.5 Transaksi "ghost" muncul kembali walau save gagal
- **File**: `src/store/transactionStore.ts` (`addTransaction` → `syncTransaction` SEBELUM `set`), `src/lib/atomicTransactionEngine.ts` (`executeRollback` → `deleteTransaction` → `deleteTransactionCloud` tidak di-await), `src/lib/offlineQueue.ts`
- **Masalah**: `addTransaction` memanggil `syncTransaction(tx)` (cloud upsert) **sebelum** `set()` lokal. Saat persist lokal gagal → engine rollback → `deleteTransaction` → `deleteTransactionCloud(id)` **tidak di-await** (fire-and-forget) → bisa masuk offline queue / gagal → baris cloud TETAP ADA → setelah reload / device lain, `loadFromCloud` menarik kembali transaksi yang "gagal" itu (terlihat di daftar Pending meski save error).
- **Status**: ✅ SELESAI
- **Aksi (dieksekusi)**:
  - [x] `executeRollback` (`atomicTransactionEngine.ts`) kini **async + di-await** dari catch `executeCheckout`; setelah hapus lokal (`deleteTransaction`), rollback **`await deleteTransactionCloud(txId)`** (offline → smartDelete masuk offline queue → ter-flush saat online) — baris cloud tidak tersisa lagi.
  - [x] **Tombstone anti-ghost** di `transactionStore`: state baru `deletedLocalIds` (cap 200) — `deleteTransaction` menambah tombstone, `addTransaction` membatalkan tombstone untuk re-commit ID sama (resume pending), `loadFromCloud` **menyaring transaksi yang di-tombstone** dari data cloud + **membersihkan tombstone otomatis** saat id-nya sudah tidak ada di cloud (penghapusan cloud dikonfirmasi). Dipersist via partialize (tetap bertahan lintas reload). Logika disaring ke helper murni `filterTombstoned` & `pruneConfirmedTombstones` di `storagePrune.ts` (4 test baru).
  - [x] **Guard wipe lokal** (temuan review): jika `cloudTxFiltered` kosong (fetch kosong / semua tertombstone), `fullSync` tidak lagi membuang SEMUA transaksi lokal (sebelumnya `oldestCloudTime = 0` → wipe).
  - [x] `deleteTransactionLocal` (event DELETE realtime di App.tsx) tidak di-tombstone — benar, karena cloud sudah menghapusnya.
  - ✅ Validasi: tsc 0 error + **42/42 test lolos**.

### 6.6 Rekap Kas (Kas Masuk/Kas Keluar) tidak pernah tersinkron antar device — RLS aktif tanpa policy
- **File**: `supabase/schema.sql`, `src/lib/cloudSync.ts` (`runMigrations`), `src/utils/cashMovementPolicy.ts` (baru), `src/store/cashMovementStore.ts` (`directSyncToCloud`)
- **Masalah**: RLS aktif di `cash_movements` **tanpa policy** → anon key diblokir diam-diam (SELECT kosong tanpa error, INSERT ditolak "new row violates row-level security policy") → movement hanya di localStorage device pembuat; laporan Shift Manager selalu menampilkan Kas Masuk/Keluar 0 meski kasir sudah mencatat. **Terkonfirmasi di produksi**: `relrowsecurity = true` + `pg_policies` kosong; setelah `CREATE POLICY "Allow all for anon"` dijalankan, data langsung mengalir ke laporan.
- **Status**: ✅ SELESAI
- **Aksi (dieksekusi)**:
  - [x] **schema.sql bagian aktif**: `ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;` + `CREATE POLICY "Allow all for anon" ON cash_movements FOR ALL USING (true) WITH CHECK (true);` — sebelumnya hanya ada di blok migrasi yang dikomentari, sehingga DB baru rawan kena kasus yang sama.
  - [x] **`runMigrations` Migration 18**: deteksi RLS-tanpa-policy via **probe INSERT** yang sengaja melanggar CHECK `type` (`'PROBE'`) — Postgres mengevaluasi RLS SEBELUM constraint, jadi error membedakan RLS vs tabel sehat **tanpa pernah membuat baris**; bila RLS terdeteksi → `console.warn` mencetak `CASH_MOVEMENTS_POLICY_SQL` (DO block cek `pg_policies` + `CREATE POLICY` + `ENABLE RLS`) untuk dijalankan sekali di SQL Editor (anon key tidak bisa eksekusi DDL). Logika diagnosis dipisah ke helper murni `diagnoseCashMovementWriteError` di `src/utils/cashMovementPolicy.ts` (8 test baru: 7 kasus error + validasi isi SQL).
  - [x] SQL warning "tabel hilang" diselaraskan: `id UUID` + CHECK `type` + policy bernama `"Allow all for anon"` (sebelumnya `"Allow all"` tanpa `WITH CHECK` — inkonsisten dengan schema).
  - [x] **Fix #3 — jalur tulis via offline queue + badge "Belum Sync"** (`cashMovementStore.ts`, `cloudSync.ts`, `CashMovements.tsx`):
    - `syncCashMovement` kini mengirim nilai mentah (tanpa sanitasi `isValidUuid` yang membuang data non-UUID — kolom schema TEXT) via **`smartUpsert` (offline queue)**: online langsung, offline/gagal antre + flush otomatis saat online (retry berkelanjutan). Return `Promise<boolean>`.
    - `addMovement`/`updateMovement`: jalur utama queue, **fallback `directSyncToCloud`** (self-healing strip kolom/nullify UUID) bila tidak langsung sukses.
    - Set module `confirmedSyncedIds` diganti state reaktif **`confirmedSyncIds: string[]`** (tidak dipersist via `partialize` — dibangun ulang dari cloud tiap boot). Badge **`⏳ Belum Sync`** di baris Riwayat Pencatatan Kas + hitung "⚠️ N belum sync" di header + listener `online` → `loadFromCloud(true)` (retry otomatis saat koneksi pulih). `loadFromCloud` juga mengkonfirmasi semua id cloud + mendorong ulang entri lokal belum-sync via queue (dedup otomatis).
  - ✅ Validasi: tsc 0 error + **99/99 test lolos** (12 baru: 8 `cashMovementPolicy` + 4 `cashMovementStore`).

---

## 🟤 PRIORITAS 7 — BACKUP & RESTORE DATABASE (Audit, v4.6)

> Sumber: audit fitur Backup & Restore — `src/lib/backupService.ts` (ZIP + SHA-256, 3 mode, restore berurutan), `src/store/backupStore.ts` (history cap 100 + autoBackupConfig), `src/components/backup/*` (5 komponen). Status: **7.1–7.8 SELESAI (v4.7) — Prioritas 7 tuntas**.

### 7.1 (KRITIS) Checksum tidak melindungi isi data
- **File**: `src/lib/backupService.ts` (`calculateChecksum`, `createBackup`, `validateBackup`)
- **Masalah**: Checksum dihitung dari `JSON.stringify({ settings, usersCount, menusCount, inventoryCount, txCount, shiftsCount })` — hanya JUMLAH entitas, bukan isi. Mengubah isi file JSON (harga menu, jumlah transaksi, data pelanggan) TANPA mengubah count tidak terdeteksi → file backup bisa dimodifikasi/dirusak sebagian tanpa ketahuan.
- **Status**: ✅ **SELESAI (v4.7)** — checksum kini SHA-256 berbasis ISI seluruh file (JSON + media teks base64), deterministik (nama diurutkan); legacy v1.0 count-based tetap divalidasi agar backup lama tidak ditolak.
- **Aksi (tereksekusi)**:
  - [x] `createBackup`: kumpulkan `{nama, isi}` tiap file JSON + media → `buildChecksumPayload` → SHA-256 (schemaVersion dinaikkan `2.0`).
  - [x] `validateBackup`: verifikasi ulang berbasis isi (raw content sebelum parse); v1.0 → jalur legacy count-based.
  - [x] Test: tamper isi JSON tanpa ubah count → INVALID; tamper media → INVALID; v2 valid; legacy v1 valid (`src/test/backupService.test.ts`).

### 7.2 (KRITIS) Restore tidak "reset" cloud — data zombie kembali lintas device
- **File**: `src/lib/backupService.ts` (`restoreBackup`)
- **Masalah**: Restore menimpa state lokal + upsert data backup, tapi TIDAK menghapus entitas cloud yang tidak ada di backup (transaksi lama, menu yang dihapus, user lama, dll). Setelah reload/device lain/`loadFromCloud`, data itu "hidup lagi" → hasil restore inkonsisten antar device; backup tidak berfungsi sebagai snapshot penuh.
- **Status**: ✅ **SELESAI (v4.7)** — `restoreBackup` menerima parameter `mode: 'merge' | 'replace'`; mode replace = wipe cloud (scope per backupType, anak dihapus dulu) sebelum insert → hasil restore konsisten lintas device.
- **Aksi (tereksekusi)**:
  - [x] `REPLACE_SCOPE` per `BackupType` (FULL/MASTER_DATA/TRANSACTION) — urutan hapus anak (transactions/cash/stock/audit) sebelum induk (users/menus/inventory).
  - [x] `wipeCloudTables`: `supabase.from(t).delete().neq('id','')` per tabel, gagal satu tabel tidak menghentikan proses.
  - [x] `RestoreWizardModal` Step 3: pilihan **Merge vs Replace (Snapshot)** + peringatan hapus permanen (teks menyesuaikan backupType); mode diteruskan ke `restoreBackup`.

### 7.3 (KRITIS) Media (foto menu & logo) dibackup tapi tidak pernah di-restore
- **File**: `src/lib/backupService.ts` (`createBackup` — `extractMedia` menulis folder `media/`; `validateBackup` & `restoreBackup` tidak membaca folder)
- **Masalah**: Gambar ditulis ke `media/` di ZIP saat backup, tapi `validateBackup` hanya mem-parse file JSON dan `restoreBackup` tidak menangani `data.media`. Setelah restore, foto menu & logo hilang (field image menunjuk `media/menu-xxx.png` yang tidak pernah dimuat ulang).
- **Status**: ✅ **SELESAI (v4.7)** — folder `media/` kini diparse dan foto menu & logo di-resolve ulang saat restore.
- **Aksi (tereksekusi)**:
  - [x] `createBackup`: media disimpan sebagai teks base64 (bukan biner) → deterministik untuk checksum & restore.
  - [x] `validateBackup`: parse folder `media/` → `data.media: Record<filename, base64>` (khusus schemaVersion ≥ 2.0; v1.0 tetap diabaikan).
  - [x] `restoreBackup`: `resolveMediaUrl` menulis ulang `menus[].image` & `settings.storeLogo` dari `data.media` sebelum `setState` + sync.
  - [x] `resolveMediaUrl` diekspor + di-test (referensi media → data URL; non-media & undefined aman).

### 7.4 (TINGGI) Struktur bundle/add-on (`menu_components`) tidak di-sync saat restore
- **File**: `src/store/menuStore.ts` (`menuComponents`), `src/lib/cloudSync.ts` (`syncMenu` tanpa `menu_components`), `src/lib/backupService.ts`
- **Masalah**: `menus.json` hanya membawa field `components` denormalized di objek menu; state `menuComponents` dan tabel cloud `menu_components` TIDAK dibackup/di-restore/di-sync. Bundle bisa rusak/inkonsisten setelah restore lintas device.
- **Status**: ✅ **SELESAI (v4.7)** — struktur bundle kini dibackup/di-restore/di-sync penuh.
- **Aksi (tereksekusi)**:
  - [x] `createBackup`: `menu_components.json` (file sendiri) untuk tipe FULL & MASTER_DATA — ikut di-hash checksum berbasis isi.
  - [x] `validateBackup`: parse `menu_components.json` → `data.menuComponents` + `entityCounts.menuComponents` (opsional — backup lama tanpa file tetap valid).
  - [x] `restoreBackup`: setState `menuComponents` + loop `syncComponentToCloud` (urutan setelah menus karena referensi parent id).
  - [x] Test end-to-end: create → validasi checksum lolos + menu_components ter-parse; zip tanpa file → undefined (tidak crash).

### 7.5 (TINGGI) Stock Logs hanya restore lokal, tidak di-sync cloud
- **File**: `src/lib/backupService.ts` (`restoreBackup` — blok `data.stock.stockLogs` hanya `setState`)
- **Masalah**: Semua entitas lain di-sync ke cloud saat restore; `stockLogs` tidak (import `syncStockLog` tidak dipakai) → device lain tidak melihat riwayat stok hasil restore.
- **Status**: ✅ **SELESAI (v4.7)** — Stock Logs kini ikut di-sync ke cloud saat restore.
- **Aksi (tereksekusi)**: [x] Loop `syncStockLog` di blok `data.stock.stockLogs` (import `syncStockLog` dari cloudSync) — konsisten dengan entitas lain.

### 7.6 (SEDANG) Auto Backup = UI stub (tidak ada scheduler; Supabase Storage tidak diimplementasi)
- **File**: `src/store/backupStore.ts` (`autoBackupConfig`), `src/components/backup/AutoBackupSection.tsx` (badge "UI Config (Pengembangan)"), `src/components/backup/BackupSection.tsx` (satu-satunya pemanggil `createBackup`)
- **Masalah**: Konfigurasi tersimpan tapi tidak ada scheduler (cek `targetTime`/`frequency`/`navigator.onLine`); `createBackup` hanya dipanggil manual. Destinasi "Supabase Storage" bisa dipilih tapi tidak ada implementasi upload; Google Drive dikunci "Masa Depan".
- **Status**: ✅ **SELESAI (v4.7)** — scheduler aktif + upload ke Supabase Storage berfungsi.
- **Aksi (tereksekusi)**:
  - [x] Modul baru `src/lib/autoBackupScheduler.ts`: `isAutoBackupDue` (pure, testable) + `runAutoBackupNow` + `start/stopAutoBackupScheduler` (cek tiap 1 menit; guard `frequency`/`targetTime`; destinasi cloud butuh online + retry 5 menit setelah gagal; `lastAutoBackupAt` dicatat HANYA saat sukses).
  - [x] `backupService.ts`: `uploadBackupToSupabase` (bucket `backups`, upsert) + `downloadBlob` shared; `BackupSection` memakai `downloadBlob`.
  - [x] `backupStore.ts`: state `lastAutoBackupAt` (persist) + `setLastAutoBackupAt`.
  - [x] `App.tsx`: `startAutoBackupScheduler()` saat boot + `stopAutoBackupScheduler()` saat unmount.
  - [x] `AutoBackupSection.tsx`: badge "● Otomatis Aktif"/"Nonaktif" (bukan lagi UI Config) + tampilan "Terakhir backup otomatis".
  - [x] Test `src/test/autoBackupScheduler.test.ts` (12 kasus: OFF, Daily, Weekly, boundary minggu, targetTime default/rusak, lastRunAt invalid).
  - [ ] (Sisi server) Buat bucket `backups` + policy anon — SQL idempoten dicetak ke console saat upload pertama gagal (anon key tidak bisa buat bucket).

### 7.7 (SEDANG) Manifest versioning usang & tanpa migrasi backup lama
- **File**: `src/lib/backupService.ts` (`CURRENT_APP_VERSION = '4.4.0'`, `CURRENT_SCHEMA_VERSION = '1.0'`)
- **Masalah**: Versi app tidak sinkron (sekarang v4.6); `schemaVersion` statis; restore backup versi lama tidak punya jalur migrasi → field baru hilang diam-diam (self-heal strip kolom) atau gagal.
- **Status**: ✅ **SELESAI (v4.7)**
- **Aksi (tereksekusi)**:
  - [x] `CURRENT_APP_VERSION = '4.7.0'` (sinkron dengan versi fitur aktual; sebelumnya usang '4.4.0').
  - [x] `SUPPORTED_SCHEMA_VERSIONS = ['1.0', '2.0']` — schemaVersion TIDAK dikenal → backup DITOLAK eksplisit dengan pesan jelas (bukan restore dengan field hilang diam-diam).
  - [x] `MANIFEST_MIGRATIONS` (tabel versi → transformasi data; 1.0 & 2.0 passthrough saat ini, entri baru ditambahkan tiap format berubah) + diterapkan di `validateBackup` sebelum restore.
  - [x] Test: konstanta sinkron; schema 3.0 ditolak dengan pesan jelas.

### 7.8 (SEDANG) `currentUser` tidak diperbarui setelah restore users
- **File**: `src/lib/backupService.ts` (`restoreBackup` — `useAuthStore.setState({ users })` tanpa update `currentUser`)
- **Masalah**: User yang sedang login bisa tidak ada di daftar user hasil restore → sesi berperilaku aneh (otorisasi PIN/role diambil dari objek lama).
- **Status**: ✅ **SELESAI (v4.7)**
- **Aksi (tereksekusi)**:
  - [x] User login ADA di backup → `currentUser` re-resolve dari daftar baru + `activeSessionId` lokal dipertahankan (tidak ter-logout paksa lintas device).
  - [x] User login TIDAK ada di backup → `logout()` (tidak ada sesi "hantu" dengan role/PIN dari objek lama).
  - [x] `passwordsHashed: false` setelah restore → password plaintext dari backup lama di-re-hash otomatis saat boot berikutnya (aman untuk BUG-K2).
  - [x] Test: found → data baru + session dipertahankan; not-found → currentUser null.

---

## 🟤 PRIORITAS 8 — PERGERAKAN STOK: TRANSAKSI vs CANCEL/DEMO (Audit, v4.6)

> Sumber: audit pergerakan stok bahan baku — jalur checkout (`atomicTransactionEngine`), status change & delete (`Transactions.tsx`), `inventoryStore` (deductStock/revertStock), `hpp.ts` (calculateItemDeductions via recipeSnapshot). Status: **8.1–8.4 SELESAI (v4.7) — Prioritas 8 tuntas**.

### 8.1 (KRITIS) Demo → Selesai (re-enable) tidak memotong stok — penjualan tercatat tanpa bahan baku
- **File**: `src/pages/Transactions.tsx` (`onConfirmAction` & `onPinSuccess`, baris ~227/295)
- **Masalah**: Tombol "Selesai" tampil untuk semua baris `txStatus !== 'Selesai'` — termasuk transaksi **Demo** (baris ~624–630). Handler hanya menangani `status === 'Selesai' && tx.txStatus === 'Cancel'` (re-enable BUG-K3); `Demo → Selesai` tidak memicu `deductStock`. Padahal saat menjadi Demo stok sudah direvert → transaksi jadi Selesai (tercatat penjualan) TANPA bahan baku terpotong → **stok bocor**. Pola identik BUG-K3 yang sudah difix untuk Cancel, kasus Demo terlewat.
- **Status**: ✅ **SELESAI (v4.7)** — Demo → Selesai kini memotong stok & mencatat kunjungan (pola BUG-K3 lengkap).
- **Aksi (tereksekusi)**:
  - [x] Logika transisi stok di-ekstrak ke helper murni **`src/utils/transactionStockActions.ts`** (`applyStatusStockEffects`) — dua rantai if-else identik di `onConfirmAction` & `onPinSuccess` diganti satu pemanggilan (DRY, tidak ada lagi celah "kasus terlewat").
  - [x] Branch `(Cancel|Demo) → Selesai` → `deductStock` + `recordVisit` (guard `hasSplitChildren`).
  - [x] 14 test baru di `src/test/transactionStockActions.test.ts` (termasuk Demo→Selesai, regresi transisi lama, guard split, edge tanpa customerId/queueNumber).

### 8.2 (KRITIS) Hapus transaksi Pending dari halaman Transaksi tidak me-revert stok reserve — bocor
- **File**: `src/pages/Transactions.tsx` (blok delete `onConfirmAction`/`onPinSuccess`, baris ~245/313)
- **Masalah**: Tombol "Hapus" tampil tanpa syarat status (baris ~648). Blok delete hanya `revertStock` bila `tx.txStatus === 'Selesai'`; menghapus **Pending** → `deleteTransaction` langsung tanpa revert → stok yang di-reserve saat simpan pending tidak pernah dikembalikan. (Jalur PendingPaymentsModal sudah aman via `cancelPendingTransaction` — yang bocor jalur halaman Transaksi.)
- **Status**: ✅ **SELESAI (v4.7)** — hapus Pending dari halaman Transaksi kini me-revert stok reserve.
- **Aksi (tereksekusi)**:
  - [x] `DELETE` di `applyStatusStockEffects`: `Pending` → `revertStock` (reason "Hapus pesanan gantung #N") sebelum `deleteTransaction`; `Selesai` → revert + revertVisit (dipertahankan); `Cancel`/`Demo` → tanpa efek (sudah di-revert saat transisi).
  - [x] Guard `hasSplitChildren` tetap berlaku (transaksi split tidak disentuh).
  - [x] Test: DELETE Pending revert tanpa revertVisit; DELETE Selesai revert+visit; DELETE Cancel/Demo tanpa efek.

### 8.3 (SEDANG) Inkonsistensi jalur sync cloud stok: deduct bulk vs revert per-item
- **File**: `src/store/inventoryStore.ts` (`deductStock` → `syncInventoryDeduction` bulk; `revertStock` → loop `syncInventoryItem`)
- **Masalah**: Dua jalur berbeda; pada revert banyak bahan, tiap item di-upsert terpisah (lebih banyak request). Fungsional, tapi tidak konsisten dan boros request saat void massal.
- **Status**: ✅ **SELESAI (v4.7)** — satu helper bulk untuk kedua jalur.
- **Aksi (tereksekusi)**:
  - [x] `syncInventoryDeduction` → **`syncInventoryStock`** (nama netral: kirim nilai stok post-mutasi dari items untuk setiap id) di `cloudSync.ts`.
  - [x] `deductStock` & `revertStock` sama-sama memanggil `syncInventoryStock(deductions, updatedItems)` — loop `syncInventoryItem` di revert dihapus.
  - [x] Test: deduct & revert sama-sama 1× panggilan bulk dengan stok post-mutasi; `syncInventoryItem` tidak dipakai revert.

### 8.4 (SEDANG) Stok negatif pasca-deduksi tidak diperiksa (hanya pre-flight)
- **File**: `src/lib/atomicTransactionEngine.ts`, `src/lib/inventoryEngine.ts` (LOGIC-5 izinkan negatif)
- **Masalah**: Validasi hanya pre-flight (`validateStockAvailability`); race 2 device checkout bahan terakhir bersamaan bisa menghasilkan stok negatif tanpa peringatan setelah kejadian. Diterima sebagai trade-off (kasir tidak diblokir), tapi perlu dipantau.
- **Status**: ✅ **SELESAI (v4.7)** — stok negatif kini terpantau di UI (tetap tidak memblokir kasir).
- **Aksi (tereksekusi)**:
  - [x] Helper murni `findNegativeStocksAfterDeduction` di `stockCheck.ts` — item yang stoknya jatuh < 0 oleh deduksi (dari stok PRE-deduksi).
  - [x] `deductStock`: setelah mutasi, hitung negatif → **toast `⚠️ Stok negatif: ...`** (maks 3 item + "+N bahan lain", type warning 6 dtk) + state transient `lastNegativeStockAlerts` (dibersihkan `revertStock`).
  - [x] Test: helper murni (habis pas 0 = bukan negatif, multi-item, amount 0/unknown) + integrasi store (alert terisi, toast, revert bersih).

---

## 🟤 PRIORITAS 9 — AUDIT STOK: OPNAME & ADJUSTMENT MANUAL (v4.6)

> Sumber: audit pergerakan stok pada Stock Opname (`StockOpname.tsx` doSubmit), Adjustment manual (`Inventory.tsx` edit/CSV import), `stockLogStore`, `inventoryStore.updateItem` (auto-log). Jalur utama sudah benar & tersync — temuan di bawah adalah celah pelabelan & race. Status: **9.1–9.4 SELESAI (v4.7) — Prioritas 9 tuntas**.

### 9.1 (SEDANG) Tipe log `'import'` mati — CSV import tidak bisa dibedakan dari adjustment manual
- **File**: `src/store/stockLogStore.ts` (`StockLogType = 'deduct' | 'add' | 'adjust' | 'import'`), `src/pages/Inventory.tsx` (CSV import → `updateItem` auto-log)
- **Masalah**: Tipe `'import'` didefinisikan tapi TIDAK pernah dipakai. CSV import untuk item yang sudah ada jatuh ke auto-log `updateItem` → `'adjust'` dengan reason generik `"Adjustment manual"`; item baru hasil import (`addItem`) tidak dicatat sama sekali. Riwayat stok tidak menunjukkan asal perubahan (import vs penyesuaian manual).
- **Status**: ✅ **SELESAI (v4.7)**
- **Aksi (tereksekusi)**:
  - [x] Helper murni `planCsvImportRow` di **`src/utils/stockImport.ts`**: existing + stok berubah → `update` + log `'import'` (reason `Import CSV`); existing + stok sama → update tanpa log; baru → `create` + log `'import'` (stockBefore 0).
  - [x] `Inventory.tsx handleImport`: pakai helper; `updateItem(..., { skipLog: true })` untuk hindari auto-log `'adjust'`, lalu `addStockLog` eksplisit tipe `'import'`.
  - [x] Test `src/test/stockImport.test.ts` (4 kasus: berubah/tetap/baru/turun).
  - [ ] (Opsional, ditunda) Badge tipe di riwayat stok per item — UI riwayat per-item belum ada (hanya Dashboard konsumsi); tambah nanti bila halaman riwayat stok dibuat.

### 9.2 (SEDANG) Stock Opname menulis stok ABSOLUT → race lintas device (lost update)
- **File**: `src/pages/StockOpname.tsx` (form menangkap `systemStock` saat dibuka, baris ~41–44; `updateItem(id, { stock: actualStock })` baris 140)
- **Masalah**: Bila perangkat lain menjual/merubah stok antara form dibuka dan submit, `updateItem` menimpa hasil perubahan itu (lost update) — log opname mencatat `stockBefore/stockAfter` dari snapshot lama, jadi selisihnya tidak terlihat. Contoh: form buka `susu=100`, device lain jual 5 (stok 95), opname submit 100 → 5 unit "dihidupkan" tanpa jejak.
- **Status**: ✅ **SELESAI (v4.7)**
- **Aksi (tereksekusi)**:
  - [x] Helper murni `findDriftedOpnameItems` di `stockImport.ts` — item yang akan DITULIS (difference ≠ 0) dengan `currentStock ≠ systemStock` snapshot → daftar drift.
  - [x] `handleSubmitAttempt`: deteksi drift → **ConfirmDialog "⚠️ Stok Berubah Sejak Form Dibuka"** sebelum PIN/konfirmasi; lanjut = tulis stok fisik, batal = tidak commit. Untuk Staf Gudang pesannya generik (hanya jumlah, tanpa angka stok — aman untuk blind mode).
  - [x] Test (6 kasus: drift terdeteksi, sama→tanpa alert, difference 0 dilewati, item hilang, toleransi float 1e-9, multi-item).
  - [ ] (Opsional, ditunda) Tulis opname sebagai delta + guard non-negatif — peringatan konfirmasi sudah menutup lost update tanpa mengubah semantik opname.

### 9.3 (MINOR) Auto-log edit memakai nama lama saat rename bersamaan
- **File**: `src/store/inventoryStore.ts` (`updateItem` auto-log memakai `current.name`)
- **Masalah**: Edit yang sekaligus mengganti nama bahan → log stok menampilkan nama lama (kosmetik, menyulitkan pencarian riwayat).
- **Status**: ✅ **SELESAI (v4.7)**
- **Aksi (tereksekusi)**: [x] Auto-log kini memakai `data.name ?? current.name` — nama baru saat rename bersamaan, fallback nama lama. Test: rename+stok → log nama baru; tanpa rename → nama lama.

### 9.4 (MINOR) Banyak request cloud per item pada opname/import
- **File**: `src/pages/StockOpname.tsx` (loop `updateItem` → `syncInventoryItem` per item), `src/pages/Inventory.tsx` (CSV import loop)
- **Masalah**: Opname/import dengan banyak item → 1 request cloud per item. Fungsional tapi boros request (terkait 8.3 — seragamkan jalur bulk).
- **Status**: ✅ **SELESAI (v4.7)** — opname & import kini batch.
- **Aksi (tereksekusi)**:
  - [x] `inventoryStore.applyBulkStock(entries)`: SATU setState + SATU `syncInventoryStock` bulk — dipakai `StockOpname.doSubmit` (ganti loop `updateItem` per item).
  - [x] `inventoryStore.importItems(rows)`: 1 setState semua baris + log `'import'` (9.1) + 1 `syncInventoryStock` bulk untuk stok + `syncInventoryItem` penuh HANYA untuk item baru / yang field non-stok berubah. `updateItem`/`addItem` dapat opsi `skipSync`.
  - [x] `Inventory.tsx handleImport` hanya parse CSV → `importItems(rows)`.
  - [x] Test `src/test/inventoryBatch.test.ts` (7 kasus: rename-log, bulk stock 1 panggilan, import batch log+sync, tanpa upsert penuh bila hanya stok berubah, empty no-op).

---

## 🟤 PRIORITAS 10 — AUDIT MODE BLIND STOCK OPNAME & OTORISASI PIN (v4.6)

> Sumber: audit alur mode blind opname untuk Staf Gudang (`StockOpname.tsx`), otorisasi PIN (`PinModal.tsx`, `settingsStore.verifyPin`), akses halaman (`App.tsx`/`Inventory.tsx`). Masking kolom & akses role sudah benar; temuan di bawah = kebocoran informasi mode buta & kelemahan otorisasi PIN. Status: **10.1–10.5 SELESAI (v4.7) — Prioritas 10 tuntas**.

### 10.1 (KRITIS) Mode buta bocor: banner "Selisih Besar" + judul modal PIN menampilkan info selisih untuk Staf Gudang
- **File**: `src/pages/StockOpname.tsx` (banner baris ~312 tidak di-guard `isWarehouseStaff`; judul `PinModal` baris ~408 `"Verifikasi PIN Manager — Selisih Besar"`)
- **Masalah**: Banner peringatan selisih ≥10% dan judul modal PIN tampil untuk SEMUA role termasuk Staf Gudang. Staff bisa memakai banner sebagai oracle: input fisik → banner muncul = selisih ≥10%, tidak muncul = dalam ±10% → dengan iterasi, stok sistem terbaca dengan presisi 10% — persis manipulasi yang ingin dicegah mode buta (PRD 2.4). Perbedaan jalur PIN modal vs ConfirmDialog juga mengungkap batas 10% walau banner disembunyikan.
- **Status**: ✅ **SELESAI (v4.7)** — oracle ±10% tertutup penuh (bukan hanya banner/judul).
- **Aksi (tereksekusi)**:
  - [x] Helper murni `resolveOpnameGate` & `shouldShowLargeDifferenceBanner` di `stockImport.ts`.
  - [x] Banner "Selisih Besar Terdeteksi" HANYA untuk non-staff (`shouldShowLargeDifferenceBanner`).
  - [x] Staf Gudang SELALU lewat jalur PIN (`resolveOpnameGate` → 'pin' walau selisih kecil) — tanpa banner & tanpa ConfirmDialog diferensial → tidak ada sinyal apa pun yang mengungkap batas ±10%.
  - [x] Judul modal PIN generik `"Otorisasi Manager"` untuk Staf Gudang (non-staff tetap "Verifikasi PIN Manager — Selisih Besar").
  - [x] Test `stockImport.test.ts` (4 kasus: staff+selisih kecil → tetap PIN; staff+besar → PIN; non-staff gate normal; banner hanya non-staff+besar).

### 10.2 (TINGGI) Otorisasi PIN tidak terikat role & tidak ada identitas approver — ✅ SELESAI (v4.7)
- **File**: `src/utils/pinAuth.ts` (BARU — `isApproverRole`/`authenticateManager`/`getDeviceMarker`), `src/store/authStore.ts` (`verifyManagerCredentials` non-mutating), `src/components/PinModal.tsx` (`requireManager` + quick-login), `src/pages/StockOpname.tsx` (record + audit log), `src/types/index.ts` (field approver), `src/lib/cloudSync.ts` (Migration 19 + mapping), `supabase/schema.sql`
- **Masalah**: Siapa pun yang tahu PIN Manager (termasuk Staf Gudang) bisa menyetujui selisih besar; tidak ada cek role user yang mengetik. Audit hanya menyimpan boolean `pinVerified` — tanpa identitas approver maupun timestamp, jadi tidak ada jejak siapa yang menyetujui. Catatan: karena PIN bersifat shared dan biasanya diketik di perangkat staff (manager mengetik PIN-nya), mencatat `currentUser` akan salah identitas.
- **Status**: ✅ SELESAI (v4.7)
- **Aksi (rencana)**:
  - [x] Role-gate: `PinModal` kini menerima `requireManager` — sesi non-Manager TIDAK bisa menyetujui hanya dengan PIN global; wajib login cepat sebagai Manager (username + password akun). Akun non-Manager (Kasir/Acaraki/Staf Gudang) ditolak walau kredensialnya benar.
  - [x] Identitas approver: `verifyManagerCredentials` (authStore) memvalidasi kredensial akun Manager TANPA mengubah sesi (staff tetap tercatat sebagai penginput). `onSuccess(approver)` membawa `{id, name, role}`.
  - [x] Minimal: record opname & audit log kini menyimpan `approverId`/`approverName`/`approverRole`/`approvedAt` (timestamp) + `deviceId` (penanda perangkat via `getDeviceMarker`, stabil per device) — jejak audit lengkap siapa/menyetujui/kapan/dari mana.
  - [x] DB: kolom `approver_id/approver_name/approver_role/approved_at/device_id` ditambahkan ke `stock_opnames` (schema.sql + Migration 19 di runMigrations dengan SQL idempoten; mapping syncStockOpname/fetch ikut).
  - [x] Test: `src/test/pinAuth.test.ts` (13 kasus) — role-gate, kredensial Manager (bcrypt + legacy plaintext), penanda perangkat stabil/fallback.

### 10.3 (TINGGI) Alasan selisih tidak wajib untuk Staf Gudang → audit penyebab kerugian lemah — ✅ SELESAI (v4.7)
- **File**: `src/pages/StockOpname.tsx` (dialog alasan pasca-PIN), `src/utils/stockImport.ts` (`fillMissingItemReasons`), `src/types/index.ts` (`adjustmentReason`), `supabase/schema.sql`
- **Masalah**: Staf Gudang bisa mencatat kerugian besar (mis. stok 100 → 0, `Basi`) tanpa alasan apa pun, asalkan PIN disetujui. Namun staff memang tidak tahu item mana yang berselisih (mode buta) — mewajibkan alasan per-item tidak praktis.
- **Status**: ✅ SELESAI (v4.7)
- **Aksi (rencana)**: [x] Setelah PIN Manager disetujui (Staf Gudang + ada selisih), tampilkan dialog **"Alasan Penyesuaian (Wajib)"** — rangkuman jumlah item berselisih (tanpa nama item/nominal — blind mode tetap aman) + pilihan alasan utama (Basi/Bahan Rusak/Salah Input/Tercecer/Penyusutan/Lainnya) + detail opsional. Tombol "Eksekusi Opname" nonaktif sampai alasan dipilih. Alasan diterapkan ke item berselisih yang belum punya alasan (`fillMissingItemReasons`), disimpan di record (`adjustmentReason`) + dirangkum di notes, dan tampil di riwayat & audit log. Dual-control: staff TIDAK bisa eksekusi tanpa (1) approval Manager dan (2) alasan.

### 10.4 (SEDANG) Stok aktual negatif/NaN bisa masuk ke inventory — ✅ SELESAI (v4.7)
- **File**: `src/utils/stockImport.ts` (`parseActualStock`), `src/pages/StockOpname.tsx` (opnameItems + preview baris), `src/test/stockImport.test.ts` (5 kasus)
- **Masalah**: `parseFloat("-5") = -5` → `updateItem(id, { stock: -5 })` → stok inventory jadi negatif tanpa validasi.
- **Status**: ✅ SELESAI (v4.7)
- **Aksi (rencana)**: [x] Helper murni `parseActualStock(raw) = Math.max(0, parseFloat(raw) || 0)` — SATU-SATUNYA jalur parse stok fisik: negatif → 0, NaN/teks/kosong → 0. Dipakai di `opnameItems` (yang ditulis ke inventory via `applyBulkStock`) DAN di preview baris (diff/kerugian konsisten dengan nilai yang akan disimpan). Test: "-5" → 0, "-0.5" → 0, "abc"/"" → 0, "0" → 0, positif dipertahankan.

### 10.5 (MINOR) Ambang PIN ketat untuk stok rendah — catatan desain — ✅ DIDOKUMENTASIKAN (v4.7)
- **File**: `src/pages/StockOpname.tsx` (baris ~78–83: `Math.max(systemStock × 0.1, 1)`)
- **Masalah**: Untuk item dengan stok sistem < 10, selisih ≥ 1 unit (mis. stok 5, selisih 1 = 20%) langsung memicu PIN — ketat tapi sah; catatan agar perilaku ini tidak mengejutkan saat muncul.
- **Status**: 🔵 Catatan desain — komentar inline ditambahkan di kode (ambang = max(10% stok sistem, 1 unit); stok rendah → PIN lebih sering muncul, disengaja). Tidak ada perubahan perilaku.

---

## 🟤 PRIORITAS 11 — CELAH SPESIFIKASI & ARAH KOMERSIALISASI (Analisa Fitur, v4.7)

> Sumber: analisa fitur POS (PRD.md §3, FEATURES.md, ROADMAP.md vs kode v4.7). Baseline 14 modul PRD ~92% terimplementasi (Prioritas 1–10 tuntas); sisanya = 6 celah spesifikasi (11.1) + rekomendasi P0/P1/P2 (11.2–11.4). Status: **dokumentasi analisa — belum dieksekusi (urutan ditentukan arah komersialisasi: 1 outlet mendalam vs SaaS multi-klien)**.

### 11.1 Celah Spesifikasi (tertulis di PRD/FEATURES tapi belum ada)

- **2.1 WhatsApp Marketing** (PRD 3.10, FEATURES #9) — hanya deep-link `wa.me` manual per pelanggan (`Customers.tsx` `openWhatsApp`); belum ada campaign/broadcast. Perlu Edge Function + WA Gateway API.
- **2.2 Google Drive backup** (PRD 3.13, FEATURES #13) — opsi `destination: 'Google Drive'` + UI "Coming Soon" (`AutoBackupSection.tsx`) tanpa OAuth2/upload.
- **2.3 QRIS Gateway** (FEATURES #1) — QRIS metode bayar **manual** (kasir input/scan); belum integrasi Midtrans/Duitku/QRIS terverifikasi.
- **2.4 Multi-outlet** (PRD 1.2 & pricing Pro Rp 399k/bulan) — hanya field `outletId?: string` di `Transaction`; tanpa pemilihan/filter outlet per device.
- **2.5 RLS ber-JWT** — schema punya 13 policy `"Allow all for anon"` (tanpa auth); aman untuk 1 outlet, **tidak aman untuk SaaS multi-klien** (roadmap #2).
- **2.6 Diskon per item** — hanya diskon manual nominal per transaksi; tanpa diskon per baris (umum di POS retail).

### 11.2 Rekomendasi P0 — Sebelum dijual ke klien (KRITIS)

- [x] **Laporan PPN formal (P0.1 — ✅ SELESAI v4.7)** — tab baru **PPN** di Laporan + export CSV/PDF. File: `src/utils/ppnReport.ts` (murni: `isTaxableTransaction`/`toPpnRow`/`summarizePpn`/`aggregatePpnByDay`), `src/utils/pdfExport.ts` (`exportPpnPDF`), `src/pages/Reports.tsx` (tab `tax`, kartu ringkasan, rekap per hari, detail transaksi), `src/test/ppnReport.test.ts` (9 kasus). Semantik: **DPP = subtotal − diskon (net sales)**, **PPN = `t.tax`** (dibulatkan saat checkout), Total = DPP + PPN; hanya transaksi `Selesai` non-split kena pajak (tax > 0); non-pajak dihitung sebagai exempt. Total test: **201/201**.
- [x] **Refund/retur penuh (P0.2 — ✅ SELESAI v4.7)** — alur refund transaksi `Selesai` dari halaman Transaksi. File: `src/utils/refund.ts` (murni: `isRefundableTransaction`/`refundAmount`/`refundMovementNotes`/`buildRefundCashMovement`), `src/pages/Transactions.tsx` (tombol Refund + modal alasan + PIN Manager untuk role non-Manager, badge "Refund", info refund di detail, statistik eksklusi), `src/utils/transactionStockActions.ts` (guard `refunded` — anti double-revert), `src/types/index.ts` (field `refunded*` + AuditAction `refund_transaction`), `src/lib/cloudSync.ts` (Migration 20 + syncTransactionMeta refund fields + fetch mapping), `supabase/schema.sql`, `src/pages/Reports.tsx` & `src/pages/Dashboard.tsx` (refunded TIDAK dihitung sebagai penjualan). Alur: revert stok (recipeSnapshot) + revert kunjungan + **Kas Keluar 'Refund' di Rekap Kas** (akuntabel, online/offline queue) + tandai refunded (sync lintas device) + audit log. Guard: hanya `Selesai` non-split, belum refunded, nominal > 0; transaksi refunded tidak bisa diubah status lagi. Test: `src/test/refund.test.ts` (9) + `transactionStockActions.test.ts` (3 guard). Total test: **213/213**.
- [ ] **Refund/retur penuh** — sekarang hanya Cancel/Void/Delete (revert stok); tanpa alur refund + arus kas keluar tercatat akuntabel.
- [ ] **Role Owner terpisah** — hierarki Owner > Manager (otorisasi opname 10.2 sudah kuat, tapi approver hanya Manager).
- [x] **Struk digital (WA/email) (P0.4 — ✅ SELESAI v4.7)** — kirim struk dari halaman Transaksi + Settings. File: `src/utils/digitalReceipt.ts` (murni: `buildReceiptText`/`normalizePhone`/`buildWhatsAppUrl`/`buildMailtoUrl`/`findCustomerContact`/`autoSendReceiptTarget`), `src/pages/Transactions.tsx` (tombol "Struk Digital" + modal kirim WA/email: kontak terisi otomatis dari CRM, override manual, pratinjau struk), `src/pages/SettingsPage.tsx` (toggle "Kirim Struk Digital Otomatis via WhatsApp" di Pengaturan Format & Preview Struk), `src/pages/POS.tsx` (auto-kirim pasca-checkout: pre-open window WA sebelum await anti popup blocker, isi struk setelah sukses, skip idempotent replay), `src/types/index.ts` (AuditAction `send_digital_receipt` + setting `autoSendDigitalReceipt`), `src/lib/cloudSync.ts` (Migration 21 + guard syncSettings + fetch mapping), `supabase/schema.sql` (kolom `auto_send_digital_receipt`). Alur: struk diformat teks polos (layout thermal, memakai nama toko/alamat/header/footer dari Settings) → deep-link `wa.me`/`mailto` dengan struk sudah terisi (bukan pesan generik manual) → audit log tercatat; auto-kirim WA hanya bila setting aktif + pelanggan punya nomor valid. Total test: **235/235**.
  - ⚠️ SQL sekali di Supabase SQL Editor (DB lama): `ALTER TABLE settings ADD COLUMN IF NOT EXISTS auto_send_digital_receipt BOOLEAN DEFAULT FALSE;` (tercetak otomatis via Migration 21).
- [x] **Urutan badge kategori POS bisa diatur (fitur baru — ✅ SELESAI v4.7)** — seret-and-lepas badge kategori di halaman POS untuk menentukan posisi awal/akhir. File: `src/utils/categoryOrder.ts` (murni: `buildCategoryTabs` — tab sistem 'Semua'/'Best Seller' tetap di depan, urutan `customCategories` didahulukan, kategori menu lain menyusul; `reorderTabs` — pindah item ke slot target), `src/store/menuStore.ts` (`reorderCategories` — simpan urutan ke `customCategories` + sync cloud via `syncCustomCategories` settings id=1, konsisten lintas device), `src/pages/POS.tsx` (drag-and-drop native HTML5 di badge row: `dragCat`/`dropCat` state, highlight ring saat drop target, cursor grab, `dataTransfer.setData` untuk Firefox), `src/test/categoryOrder.test.ts` (13 kasus). Total test: **248/248**. Tanpa migrasi DB — urutan memakai kolom `categories` yang sudah ada.

### 11.3 Rekomendasi P1 — Fase berikutnya (diferensiasi)

- [ ] **QRIS payment gateway** (menutup 2.3 — Midtrans/Duitku).
- [ ] **Pembelian/restok + supplier (PO)** — alur beli → terima → stok naik (sekarang stok masuk hanya via opname/adjust/import).
- [ ] **Harga khusus & diskon per item** (menutup 2.6 — grosir/member/price-list).
- [ ] **QR Self-Order per meja** (roadmap #6).
- [ ] **Multi-outlet fungsional** (menutup 2.4 — janji paket Pro).
- [ ] **RLS ber-JWT + auth** (menutup 2.5 — prasyarat SaaS multi-klien).
- [ ] **Push notification** (stok kritis, laporan harian — roadmap #7).

### 11.4 Rekomendasi P2 — Nice-to-have

- [ ] i18n multi-bahasa (roadmap #8)
- [ ] Integrasi delivery (GoFood/Grab/Shopee) manual
- [ ] Absensi karyawan
- [ ] Ekspor ke software akuntansi (Excel/Jurnal)
- [ ] Backup Google Drive (menutup 2.2)
- [ ] Auto-reconnect & visibility (roadmap #1)

### 11.5 Catatan Arah

- Aplikasi sudah melampaui PRD dari sisi keandalan (atomic engine, pending/split, backup, opname aman). Yang tersisa: menutup 6 celah spesifikasi + memilih arah komersialisasi: **1 outlet mendalam (P0 + laporan)** vs **multi-tenant SaaS (butuh RLS JWT + multi-outlet + gateway)**. Keputusan ini menentukan urutan eksekusi P1.

---

## 🔴 PRIORITAS 12 — AUDIT PROMO & MANAJEMEN DATA (Analisa, v4.7)

### 12.1 Temuan Manajemen Data (Settings → Manajemen Data) — KRITIS

- [x] **12.1.1 (KRITIS) IndexedDB bocor dari semua reset — ✅ SELESAI (v4.7)** — akar masalah: `dataManager.ts` hanya `localStorage.removeItem(key)`, padahal store `transactions` & `audit-logs` persist via `idbStorage` (IndexedDB). Fix: `src/utils/idbStorage.ts` tambah `clearIdbKeys(keys)` (hapus IDB + cache + lapisan localStorage, **await** sebelum reload agar delete selesai sebelum unload), `src/utils/dataManager.ts` kini hapus via adapter yang benar — `splitClearPlan()` klasifikasi key IDB vs localStorage, `clearLocalData()` di-await di ketiga fungsi (resetToDefault/clearOperationalData/factoryReset), key list diekspor (`FULL_RESET_KEYS`/`OPERATIONAL_CLEAR_KEYS`/`IDB_BACKED_KEYS`). Test: `src/test/dataManager.test.ts` (10 kasus — cakupan semua key persist, anti-duplikat, master data tidak ikut terhapus, klasifikasi adapter). Total test: **258/258**.
- [x] **12.1.2 (TINGGI) Rekap Kas (cash_movements) bocor — ✅ SELESAI (v4.7)** — `rempah-cash-movements` ditambahkan ke `FULL_RESET_KEYS` & `OPERATIONAL_CLEAR_KEYS`; cloud `clearCloudOperationalData()` & `clearAllCloudData()` kini juga `DELETE` tabel `cash_movements`. Rekap Kas ikut bersih di ketiga aksi (lokal + cloud).
- [x] **12.1.3 (SEDANG) `resetToDefault` & `factoryReset` identik — ✅ SELESAI (v4.7)** — kini dibedakan: `reseedPlan(kind)` murni — `resetToDefault` = seed DEMO penuh (users+settings+menus+inventory); `factoryReset` = seed MINIMAL (users+settings saja, cloud BERSIH dari katalog demo). Flag skip-seed (`src/utils/factoryResetFlag.ts`) mencegah seed demo lokal ter-push balik ke cloud pada boot berikutnya (dikonsumsi di `menuStore.loadFromCloud` & `inventoryStore.loadFromCloud`).
- [x] **12.1.4 (SEDANG) `menu_components` yatim — ✅ SELESAI (v4.7)** — daftar tabel wipe diekstrak (`OPERATIONAL_WIPE_TABLES`/`FULL_WIPE_TABLES`); `clearAllCloudData` kini juga `DELETE menu_components` (reset penuh) — komponen bundle tidak tersisa di cloud. `clearCloudOperationalData` sengaja TIDAK menyentuhnya (Bersihkan Data mempertahankan menu).
- [x] **12.1.5 (SEDANG) Offline queue awareness — ✅ SELESAI (v4.7)** — `clearQueue()` (dari offlineQueue) dipanggil PALING AWAL di ketiga aksi reset, sebelum cloud di-wipe & sebelum `recordResetAudit` — op yang masih antre (transaksi/pelanggan lama) tidak "bangkit lagi" saat flush ulang online; reseed & audit baru tetap antre dengan benar.
- [x] **12.1.6 (MINOR) Super Admin PIN default `000000`** — ✅ SELESAI (v4.8)** — fix: field `superAdminPinChanged?: boolean` di Settings type; saat user buka Manajemen Data, jika PIN belum pernah diganti (`superAdminPinChanged` falsy), tampil forced PIN change form (amber banner + input PIN baru + konfirmasi + batal). PIN berhasil → set `superAdminPinChanged: true` + unlock. Tombol "Ubah Super Admin PIN" di section PIN juga set flag. User existing yang sudah ganti PIN tidak terdampak. Test: `tsc` 0 error, **613/613**.
- [ ] **12.1.7 (ENHANCEMENT) Tidak ada backup sebelum reset destruktif** — padahal fitur Backup (7.x) sudah ada; tidak ada konfirmasi ketik kata kunci (mis. "HAPUS") dan tidak ada audit log aksi reset.
- [x] **12.1.8 (KRITIS) Cloud delete gagal diam-diam — data “bangkit lagi” setelah Bersihkan Data Transaksi** — ✅ SELESAI (v4.8)** — akar masalah: `clearCloudTables()` memanggil `supabase.from(table).delete().neq()` tanpa cek error response (Supabase returns `{data, error}` bukan throw). Jika delete gagal (RLS/network/auth), error ditelan → local clear + reload → `loadFromCloud` mengambil data lama dari cloud → data “bangkit lagi” di Riwayat Kasir & Laporan Shift. **Fix**: `clearCloudTables()` kini return `Promise<boolean>` + cek `error` per tabel + `console.error`. `clearOperationalData()` / `resetToDefault()` / `factoryReset()` kini **cloud delete DULU** → cek success → jika gagal, `alert()` & return (TIDAK clear lokal, TIDAK reload) → data lokal tetap utuh agar user bisa coba lagi. Jika sukses, baru clear lokal + reload. Test: `tsc` 0 error, **613/613 test**.

### 12.2 Temuan Fitur Promo (Promos.tsx / promoStore / POS)

- [ ] **12.2.1 (TINGGI) Scope promo `menu` tidak bisa dibuat di UI** — types & validasi POS mendukung (`scope === 'menu'` + `scopeTarget` menu id), tapi dropdown form Promos.tsx hanya `all`/`category`/`loyalty`.
- [x] **12.2.2 (TINGGI) Konfigurasi poin loyalty mati** — ✅ **SELESAI (P-A8, v4.7)**: poin kini benar-benar dipakai — earn saat checkout (`recordVisit`) + redeem jadi diskon di POS (`loyaltyPoints.ts` + UI tukar poin), config editabel di Loyalty, poin tampil di kartu pelanggan, clawback saat void. Lihat P-A8 di bawah.
- [ ] **12.2.3 (SEDANG) Diskon menumpuk tanpa aturan** — `rawPreviewDiscount = manual + promo + loyalty` (capped subtotal); tidak ada opsi stacking (mis. voucher tidak boleh digabung loyalty) atau auto best-deal.
- [ ] **12.2.4 (SEDANG) Tidak ada laporan performa promo** — transaksi hanya simpan `appliedPromoId` + `voucherCode` (bukan `promoName`/`promoAmount`); Reports.tsx tidak punya bagian promo → efektivitas tiap promo tidak terukur, dan akurasinya rusak bila promo diedit/dihapus.
- [ ] **12.2.5 (SEDANG) Tidak ada BOGO / min qty / free item** — promo hanya persentase atau nominal.
- [ ] **12.2.6 (MINOR) `usageLimit` global tanpa batas per pelanggan** — tidak ada "1 voucher per pelanggan" (padahal transaksi punya `customerId`, tinggal dicek).
- [ ] **12.2.7 (MINOR) Struk digital/cetak hanya tampilkan "Diskon" agregat** — nama promo tidak tercetak di struk.
- [ ] **12.2.8 (ENHANCEMENT) Tidak ada auto-apply promo terbaik** — kasir harus pilih manual / ketik kode voucher.

### 12.3 Rekomendasi Perbaikan (prioritas eksekusi)

- [x] **P-A1 — ✅ SELESAI (v4.7)** — `dataManager` hapus via adapter benar (12.1.1) + `cash_movements` lokal & cloud (12.1.2) + bedakan reset vs factory (12.1.3). Tambahan: **backup otomatis sebelum reset** (toggle "💾 Backup otomatis sebelum reset" default ON di Settings → Manajemen Data → unduh `BackupService.createBackup('FULL')` sebelum aksi), **konfirmasi ketik kata kunci** "HAPUS SEMUA" di dialog Factory Reset (`ConfirmDialog` prop `requireKeyword`), **audit log aksi reset** ke cloud (`AuditAction 'reset_data'` + `recordResetAudit` — ditulis SETELAH cloud di-wipe agar survive reload; antre via offline queue bila offline). Test: `src/test/dataManager.test.ts` +4 (`reseedPlan`). Total test: **262/262**.
- [x] **P-A2 — ✅ SELESAI (v4.7)** — scope `menu` ditambahkan di dropdown form Promos.tsx + select menu (nama + badge ⭐ Best Seller), daftar promo kini menampilkan nama menu target. Validasi form via helper murni `src/utils/promoValidation.ts` (`validatePromoForm`): nama wajib, persentase 1–100% / nominal > 0, tanggal berakhir ≥ mulai, target wajib utk scope menu/kategori, min kunjungan wajib utk loyalty, diskon tetap ≤ min belanja, angka opsional ≥ 0 — error ditampilkan merah di modal (tombol simpan tetap ada tapi aksi dicegah). Test: `src/test/promoValidation.test.ts` (17 kasus). Total test: **284/284**.
- [x] **P-A3 — ✅ SELESAI (v4.7)** — Simpan snapshot **`promoName` + `promoAmount`** di transaksi saat checkout (POS `finalizeTransaction` + `handleSavePending` → engine `AtomicTransactionEngine`; lookup nama dari SEMUA promo agar tetap terekam walau expired/diubah). **Tab baru "Promo" di Laporan (Reports)**: KPI (transaksi ber-promo, total diskon promo, omset promo, diskon non-promo), tabel performa per promo (jumlah pakai ×, total diskon, total omset, rata-rata diskon/tx — urut diskon tertinggi), detail transaksi ber-promo, + export CSV. Logika murni `src/utils/promoReport.ts` (filter: Selesai & bukan split child & bukan refunded; fallback nama ke lookup utk data legacy; catatan jujur: legacy tanpa promoAmount = 0). Sinkronisasi cloud: **Migration 22** (`promo_name`/`promo_amount`) + guard syncTransaction + mapping fetch; `supabase/schema.sql` + blok ALTER. Test: `src/test/promoReport.test.ts` (15 kasus) + mapping cloud (+1). Total test: **300/300**.
- [x] **P-A4 — ✅ SELESAI (v4.7)** — Opsi stacking per promo + auto best-deal. `Promo.stackable` baru (undefined = legacy = boleh digabung). **Mesin diskon POS terpusat** `src/utils/discountEngine.ts` (`calculateDiscountBreakdown`): promo stackable → manual+promo+loyalty dijumlahkan (capped subtotal, perilaku lama); promo **eksklusif** (`stackable=false`) → **auto best-deal** — pelanggan mendapat yang LEBIH BESAR antara promo saja vs manual+loyalty saja (tidak pernah keduanya), capped subtotal. Semua call site POS (`finalizeTransaction`, `handleSavePending`, preview, promoAmount snapshot P-A3) memakai hasil yang SAMA → angka tampil = angka dicommit (menutup duplikasi `rawTotalDiscount` di 3 tempat). UI: toggle "Boleh digabung dengan diskon lain (manual/loyalty)" di form Promo + badge "Eksklusif" di daftar + info ℹ️ di checkout saat promo eksklusif; banner loyalty/promo hanya tampil bila benar-benar diterapkan. Sinkronisasi cloud: **Migration 23** (`stackable BOOLEAN DEFAULT TRUE` di promos) + guard syncPromo + mapping fetch; `supabase/schema.sql` + blok ALTER. Test: `src/test/discountEngine.test.ts` (13 kasus: stacking, cap, legacy default, eksklusif promo-menang/manual-menang/seri/cap/alokasi display). Total test: **313/313**.
- [x] **P-A5 — ✅ SELESAI (v4.7)** — BOGO & min-qty. `PromoType` + `'bogo'`; field baru `bogoBuyQty` (beli N), `bogoFreeQty` (gratis M), `bogoPercent` (diskon % per unit gratis, 0 = gratis penuh), `minQty` (gate diskon %/nominal bila total qty item target ≥ N). **Mesin diskon promo terpusat** `src/utils/promoDiscount.ts` (`isPromoApplicable` + `calculatePromoDiscount` + `calculateBogoDiscount` — murni, SATU sumber kebenaran yang dipakai `calculatePromoDiscount` di POS): BOGO menghitung harga satuan (base+addon) item yang cocok scope, setiap `buyQty` unit → `freeQty` unit gratis diambil dari item TERMURAH (kebijakan standar), `bogoPercent>0` → gratis sebagian. Gate lengkap (aktif/tanggal/usage/min belanja/loyalty/scope/minQty). Form Promo: opsi "BOGO / Beli N Gratis M (per item)" + field Beli/Gratis/Diskon% (scope loyalty disembunyikan utk BOGO) + field "Min. Qty Item"; daftar menampilkan "Beli N Gratis M / diskon % utk M item" + "Min N item"; validasi (`promoValidation.ts`) BOGO: beli ≥ 2, gratis ≥ 1, diskon 0–100%, scope ≠ loyalty; minQty ≥ 1. Sinkronisasi cloud: **Migration 24** (`min_qty INT`, `bogo_config JSONB`, relax CHECK promos.type jadi include 'bogo' — pola DO block idempoten) + guard syncPromo + mapping fetch; `supabase/schema.sql`. Test: `src/test/promoDiscount.test.ts` (21 kasus: regresi %/fixed, gate, BOGO termurah/scope/qty/percent/addon/insufficient). Total test: **334/334**.
- [x] **P-A6 — ✅ SELESAI (v4.7)** — Batas pemakaian PER pelanggan. `Promo.usageLimitPerCustomer` (mis. 1 = "1 voucher per pelanggan") + `Promo.usageByCustomer` (map customerId → jumlah pakai, disinkronkan bersama promo — pola sama dengan usageCount). `promoStore.incrementUsage(id, customerId?)` kini mencatat global + per pelanggan; POS & SplitBillModal meneruskan `selectedCustomerId`. Gate di mesin promo murni (`promoDiscount.ts`): promo berbatas per pelanggan WAJIB ada pelanggan terpilih (tanpa pelanggan → tidak berlaku) dan `usageByCustomer[customerId] < limit`. UX POS: saat apply voucher/select promo berbatas tanpa pelanggan → pesan "pilih pelanggan terlebih dahulu". Form Promo: field "Batas per Pelanggan" + info ⚠️ mewajibkan pelanggan; daftar menampilkan "Maks N× per pelanggan"; validasi ≥ 1. Sinkronisasi cloud: **Migration 25** (`usage_limit_per_customer INT`, `usage_by_customer JSONB`) + guard syncPromo + mapping fetch; `supabase/schema.sql`. Test: `src/test/promoStoreUsage.test.ts` (4) + gate promoDiscount (+4) + validasi (+2). Total test: **344/344**.
- [x] **P-A7 — ✅ SELESAI (v4.7)** — Nama promo/voucher kini tercetak di struk. `ReceiptData` + `promoName`/`promoCode`/`promoAmount`; `buildReceiptFromTransaction` mengisi dari `tx` (snapshot P-A3) **hanya bila promo benar-benar memberi diskon** (`promoAmount > 0` — promo eksklusif yang kalah best-deal TIDAK tampil agar tidak menyesatkan; data legacy tanpa promoAmount juga tidak tampil). Rendering di 3 jalur: struk **browser** (`printReceiptBrowser` — baris "Promo" antara Diskon & Pajak), **Bluetooth ESC/POS** (`buildReceiptESCPOS` — baris `Promo: Nama (KODE)`, dipotong ke lebar kertas), dan **struk digital** (`buildReceiptText` WA/email — baris `Promo: Nama (KODE)`). Otomatis berlaku juga untuk print ulang, bill sementara, dan struk split (karena semua lewat `buildReceiptFromTransaction`). Test: `src/test/receiptPromo.test.ts` (8 kasus: gating promoAmount, baris teks dgn/tanpa kode, urutan Diskon→Promo→Pajak, tanpa promo, bukan HTML). Total test: **352/352**.
- [x] **P-A8 — ✅ SELESAI (v4.7)** — Fitur poin loyalty DIHIDUPKAN (earn + redeem). `Customer.loyaltyPoints` + helper murni `src/utils/loyaltyPoints.ts` (`calculateEarnedPoints` = pointsPerTransaction + floor(total ÷ pointsPerRupiah; `calculateRedeemDiscount` = poin × redeemPointsValue; `calculateMaxRedeemablePoints` = min(saldo, headroom÷nilai)). **Earn**: `customerStore.recordVisit` memberi poin saat checkout (SplitBillModal ikut — sekali per sesi, sesuai guard yang ada); `revertVisit` melakukan clawback simetris (void/cancel/refund). **Redeem di POS**: input "Tukar poin" di keranjang mobile & modal Bayar (saldo + maks poin + nilai rupiah live); maks dibatasi saldo & headroom (subtotal − diskon lain) sehingga poin yang ditukar SELALU terpakai penuh; poin dipotong hanya bila benar-benar terpakai (`deductLoyaltyPoints`), redeem **bertumpuk di atas diskon lain** (nilai setara kredit pelanggan, bukan bagian aturan stacking promo). Split bill memakai total TANPA redeem (mencegah diskon gratis tanpa potong poin); pending tidak menyimpan redeem (hanya saat pembayaran). Config poin kini **editabel** di Promo & Loyalty (Poin/Transaksi, 1 poin per Rp, nilai tukar) + poin tampil di kartu Pelanggan. Sinkronisasi cloud: **Migration 26** (`loyalty_points INT` di customers) + guard syncCustomer + mapping fetch; `supabase/schema.sql`. Test: `src/test/loyaltyPoints.test.ts` (12) + `loyaltyPointsStore.test.ts` (6). Total test: **370/370**. Catatan jujur: redeem tidak dipersist di pending (pelanggan menukar poin saat melunasi).

---

## 🔴 PRIORITAS 13 — AUDIT MODE OFFLINE (Analisa, v4.7) — mode offline adalah fitur penting & harus jalan lancar

> Audit menyeluruh alur offline: offline queue, deteksi koneksi, persist lokal (IndexedDB/localStorage), indikator UI, PWA, realtime & reconnect. **Belum ada perubahan kode** — hanya analisa + rekomendasi bertahap.

### 13.0 Arsitektur saat ini (yang sudah benar)

- **Semua tulis cloud lewat offline queue** (`offlineQueue.ts`): `smartUpsert`/`smartUpdate`/`smartInsert`/`smartDelete` — offline (atau fetch gagal) → otomatis masuk antrean. Dedup per record, sorting dependensi (insert→upsert→update→delete), self-healing strip kolom yang belum ada di DB.
- **Persist lokal**: transaksi & audit log di **IndexedDB** (`idbStorage`); store lain di localStorage via `safeStorage` (anti QuotaExceededError).
- **Indikator**: status cloud via `useCloudStatus` (`checkConnection` SELECT settings, cek tiap 30 dtk) + badge jumlah antrean di sidebar Layout; Rekap Kas punya badge **"⏳ Belum Sync"** per baris (`confirmedSyncIds`).
- **Realtime + reconnect**: KDS subscribe transaksi; POS subscribe menu/inventory/customers/settings; halaman Transaksi subscribe transaksi; reconnect di event `online` + `visibilitychange` (POS/Kitchen/Transactions).
- **PWA**: app shell di-precache (`generateSW`, 53 entry) → app bisa dibuka saat offline.
- **Tombstone** `deletedLocalIds` (cap 200) anti transaksi ghost re-hidrasi dari cloud.

### 13.1 (🔴 KRITIS) — Antrean offline di localStorage; payload besar bisa HILANG diam-diam

- `offlineQueue.saveQueue` menulis ke `localStorage` (≈5 MB). Transaksi dengan banyak item/bundle/add-on bisa mendekati kuota; saat `setItem` melempar QuotaExceededError, fungsi **hanya console.warn** — operasi TIDAK dipersist dan **hilang saat reload** (data transaksi/Kas bisa hilang tanpa kabar).
- **Fix**: migrasikan queue ke **IndexedDB** (pola `idbStorage` yang sudah ada) atau minimal ke `safeStorage`; tambah ukuran/penyimpanan statistik; jangan pernah buang op.

### 13.2 (🔴 KRITIS) — Retry habis (MAX_RETRIES=5) → data di-DROP tanpa notifikasi

- `flushQueue` menaikkan `retries`; setelah 5 percobaan op **dibuang diam-diam** (tidak ada UI/audit log). Error permanen (RLS/constraint/unik, kolom yang tak bisa di-strip) = kehilangan transaksi/Rekap Kas/perubahan master.
- **Fix**: op yang gagal permanen dipindah ke daftar **"gagal sync"** (badge merah + bisa di-retry manual / dihapus sadar + audit log `sync_failed`); jangan auto-drop.

### 13.3 (🟠 TINGGI) — `navigator.onLine` tidak reliabel + TIDAK ADA retry berkala

- `navigator.onLine` tetap `true` saat perangkat terhubung Wi-Fi/LAN **tanpa internet** (router/modem mati). Tulis gagal → masuk queue (OK), tapi flush hanya dipicu **event `online`** (tidak pernah), boot, atau klik manual — antrean menggantung tanpa batas sampai event online tiba.
- **Fix**: timer flush berkala (mis. tiap 30–60 dtk) saat `queue > 0` dan `checkConnection()` = connected; tambah flush saat `visibilitychange` → visible.

### 13.4 (🟠 TINGGI) — Indikator antrean/status TERSEMBUNYI di mobile (sidebar collapsed)

- Tombol status cloud & badge antrean di Layout hanya dirender saat **sidebar terbuka** (`!sidebarCollapsed`); di mobile (sidebar collapse) kasir **tidak tahu** ada data belum sync / sedang offline.
- **Fix**: banner global (header/bottom bar) saat offline atau `queue > 0` — "⚠️ N data belum tersinkron" + status online/offline; berlaku semua role.

### 13.5 (🟠 TINGGI) — Konflik merge = last-write-wins penuh, tanpa `updated_at`

- Semua sync master/stok memakai whole-record overwrite; dua device mengubah item/stok/promo yang sama saat offline → **tulis terakhir menang**; deduksi stok dari device lain bisa tertimpa (stok drift). Alert stok negatif hanya mendeteksi, tidak mencegah.
- **Fix bertahap**: (a) dokumentasi batasan; (b) merge berbasis `updated_at` per record; (c) **deteksi konflik stok** saat sync (bandingkan stok lokal vs nilai cloud yang dihitung ulang) + laporan/deviasi.

### 13.6 (🟠 TINGGI) — Nomor antrean bisa DUPLIKAT antar device saat offline

- `getNextQueueNumber` fallback ke max lokal saat offline → dua device offline memberi nomor antrean yang sama; setelah sync ada duplikat (struk/bill referensi nomor yang sama).
- **Fix**: opsi (a) alokasi range per device, (b) prefix device + display gabungan, (c) deteksi & renumber saat merge, atau (d) dokumentasi batasan + deteksi duplikat di `loadFromCloud`.

### 13.7 (🟡 SEDANG) — Badge "Belum Sync" hanya untuk Rekap Kas, belum untuk transaksi/audit

- Pola `confirmedSyncIds` (v4.6) hanya di `cashMovementStore`; kasir tidak tahu transaksi tertentu belum sampai cloud (hanya hitung global di sidebar yang tersembunyi di mobile).
- **Fix**: ekstensi pola yang sama ke **transaksi** (badge per baris di Riwayat Transaksi + hitung header) & opsi audit log.

### 13.8 (🟡 SEDANG) — Cold start offline di device baru = data kosong tanpa pesan jelas

- Device baru yang pertama dibuka saat offline: `loadFromCloud` gagal → store hanya berisi seed lokal; tidak ada banner "mode offline — data cloud belum dimuat".
- **Fix**: banner mode offline global + info bahwa data mungkin belum lengkap; pastikan UI tetap bisa dipakai (read-only data lokal).

### 13.9 (🟡 SEDANG) — PWA: tidak ada runtime caching tambahan / halaman fallback offline

- App shell ter-precache (OK), tapi tidak ada strategi NetworkFirst untuk aset dinamis & tidak ada fallback page khusus offline; belum ada verifikasi installability di desktop.
- **Fix**: `runtimeCaching` NetworkFirst untuk `same-origin` + halaman fallback offline + cek manifest/icon di semua platform.

### 13.10 (🟡 SEDANG) — UI flush manual memakai `alert()`/`confirm()` & menawarkan "bersihkan antrean"

- Layout menawarkan `clearQueue()` (hapus antrean) via `window.confirm` — risiko data hilang permanen bila kasir klik tanpa paham. Pesan error teknis tidak menjelaskan dampak.
- **Fix**: UI konfirmasi yang jelas (apa yang dihapus, apa akibatnya); retry per kategori; tombol hapus hanya untuk op yang **gagal permanen** (13.2).

### 13.11 (🟡 SEDANG) — Urutan flush global by action bisa memutus kronologis antar entitas

- Sorting `insert→upsert→update→delete` global: operasi pada entitas berbeda (transaksi, kas, audit) tidak selalu dalam urutan kronologis — kas keluar refund bisa terkirim sebelum transaksi induknya.
- **Fix**: sort per-dependency (timestamp) atau simpan `dependsOn` hint; pertahankan urutan dalam satu entitas.

### 13.12 (🟡 SEDANG) — Tombstone `deletedLocalIds` cap 200

- Lebih dari 200 penghapusan offline → tombstone tertua dibuang → transaksi yang dihapus bisa **re-hidrasi (ghost)** dari cloud.
- **Fix**: simpan tombstone di IndexedDB + cap lebih besar (atau TTL berbasis tanggal).

### 13.13 (🟢 RENDAH) — Lain-lain

- `checkConnection` hanya SELECT settings limit 1 (tidak mengukur latensi) — cukup, namun status "connected" tidak menjamin semua tabel bisa ditulis (RLS per tabel) — dokumentasikan.
- Tidak ada pull berkala master data saat dua device aktif bersamaan — realtime sudah menutupi saat online; offline device menerima saat reconnect — OK, cukup dokumentasi.
- Audit log & Rekap Kas saat offline tidak punya badge "Belum Sync" (lihat 13.7).

### 13.14 Rekomendasi eksekusi bertahap (urutan saran)

- [x] **O-1 — ✅ SELESAI (v4.7)** — Antrean offline kini dipersist ke **IndexedDB** (`src/lib/offlineQueue.ts`: mirror in-memory + `hydrateQueue()` async; primary `idbSet`/`idbGet`/`idbRemove` dari `idbStorage.ts`, fallback `safeStorage`; **migrasi one-time** dari localStorage legacy; guard `hydrated` anti-clobber race boot — op sebelum hidrasi digabung, tidak menimpa; `clearQueue` bersihkan IDB + localStorage; `initOfflineQueue` async + `Layout` badge di-hydrate saat boot). Payload besar tidak lagi hilang saat kuota localStorage penuh & persist gagal tidak pernah melempar (op tetap hidup di memory). Test: `src/test/offlineQueueStorage.test.ts` (7 kasus: persist IDB, survive reload, migrasi legacy, clear, dedup, no-throw kuota penuh, race boot). Total test: **377/377** (32 file).
- [x] **O-2 — ✅ SELESAI (v4.7)** — Retry berkala di `initOfflineQueue`: timer **30 detik** saat `queue > 0` (flush otomatis meski `navigator.onLine` salah — Wi-Fi tanpa internet) + flush saat `visibilitychange` → visible. `flushQueue` kini mengklasifikasi error: **transient (jaringan) tidak menaikkan retries** (op bertahan, dicoba lagi tiap tick) vs permanen (RLS/constraint/kolom) → naikkan retries. (13.3)
- [x] **O-3 — ✅ SELESAI (v4.7)** — **Failed-ops list** (bukan auto-drop): op yang gagal permanen setelah MAX_RETRIES dipindah ke daftar gagal (`rempah-offline-queue-failed`, persist IDB + survive reload), badge merah `N!` di sidebar + **modal daftar** (tabel, reason, lastError, waktu) dengan **Coba Lagi Semua** (`retryFailedOps` → balik ke antrean, retries 0) & **Hapus Semua** (konfirmasi jelas) + **audit log** `sync_failed`/`sync_retry`/`sync_failed_cleared`. `clearQueue` (reset data) juga membersihkan daftar gagal. `flushQueue` return `{ success, failed, pending }`. (13.2) Test: `src/test/offlineQueueFailed.test.ts` (7 kasus). Total test: **384/384** (33 file).
- [x] **O-4 — ✅ SELESAI (v4.7)** — **Banner global** di `<main>` Layout (di bawah PrinterStatusBanner, **terlihat semua device & role — tidak bergantung sidebar** yang bisa collapsed di mobile): merah "📡 Offline — data tersimpan lokal, akan tersinkron otomatis" (cloudStatus disconnected) / merah "⚠️ N operasi gagal sinkron — klik untuk lihat" (failedCount) / kuning "⏳ N data belum tersinkron — klik untuk kirim sekarang" (queueLength); klik → modal failed / flush + toast. (13.4)
- [x] **O-5 — ✅ SELESAI (v4.7)** — Badge **"⏳ Belum Sync" per transaksi** di Riwayat Transaksi: `transactionStore.confirmedSyncIds` (TIDAK dipersist — union dari cloud tiap `loadFromCloud`, pola cashMovementStore) + `markTransactionConfirmed` saat `syncTransaction` sukses (return boolean baru) + hapus dari set saat delete; halaman Transaksi: badge per baris + hitung "⚠️ N belum sync" di header + refresh `loadFromCloud(true)` saat event `online` (badge hilang setelah queue ter-flush). (13.7) Test: `src/test/transactionSyncBadge.test.ts` (5 kasus). Total test: **389/389** (34 file).
- [x] **O-6 — ✅ SELESAI (v4.7)** — Banner offline kini **membedakan cold start**: `bootedOfflineRef` di Layout (masih disconnected ~4 dtk setelah boot) → teks "📡 Offline sejak awal — data cloud belum dimuat (perangkat baru?); transaksi tetap bisa dicatat & akan tersinkron" (vs "Offline — data tersimpan lokal" saat koneksi putus di tengah). **Dokumentasi batasan**: komentar di `getNextQueueNumber` (13.6d — dua device offline bisa memberi nomor antrean sama; loadFromCloud menormalkan nextQueueNumber, mitigasi penuh di TO DO 13.6) + catatan merge last-write-wins (13.5a — lihat O-7). (13.8)
- [x] **O-7 — ✅ SELESAI (v4.7)** — **Deteksi konflik stok lintas device** saat sync: helper murni `src/utils/stockConflict.ts` (`detectStockConflicts` — `cloud.stock > localBefore + 0.01` = potensi deduksi tertimpa/penambahan eksternal; `cloud ≤ lokal` = normal, tidak bising; item baru bukan konflik; urut diff terbesar). `inventoryStore` + `stockConflicts` (TIDAK dipersist — `partialize`; union per id; `clearStockConflicts`) diisi tiap `loadFromCloud`; **banner kuning di halaman Inventaris** (daftar bahan + lokal→cloud + tombol "Pahami"). (13.5c) Test: `src/test/stockConflict.test.ts` (7 kasus: 5 pure + 2 integrasi store). Total test: **396/396** (35 file).
- [x] **O-8 — ✅ SELESAI (v4.7)** — Cap tombstone `deletedLocalIds` dinaikkan **200 → 1000** (`DEFAULT_TOMBSTONE_CAP` di storagePrune; store transaksi sudah IndexedDB sehingga kuota bukan kendala) — anti ghost saat > 200 penghapusan offline sebelum konfirmasi cloud; `pruneConfirmedTombstones` tetap membersihkan id yang sudah terkonfirmasi di tiap loadFromCloud. (13.12)
- [x] **O-9 — ✅ SELESAI (v4.7)** — PWA offline: `navigateFallback: 'index.html'` + `navigateFallbackAllowlist [/^\/.*$/]` (semua navigasi SPA → app shell yang di-precache = **halaman fallback offline** — plugin versi ini tidak mendukung `offlineFallback` khusus, index.html precache berfungsi sebagai gantinya; banner offline O-4/O-6 tampil di dalamnya) + **runtimeCaching NetworkFirst** untuk aset same-origin (cache `same-origin-assets`, timeout 5 dtk, 30 hari; Supabase API cross-origin TIDAK dicache). **Build terverifikasi**: `npm run build` sukses — sw.js memuat `NavigationRoute`/`createHandlerBoundToURL` (navigate fallback) + cache `same-origin-assets`. (13.9)
- [x] **O-10 — ✅ SELESAI (v4.7)** — (a) **UI flush manual lebih aman**: `alert()`/`window.confirm()` diganti — hasil flush → **toast** (sukses/tersisa/offline/failed→modal), hapus failed ops → **ConfirmDialog** dengan pesan dampak jelas (data tidak akan terkirim lagi), retry failed ops → langsung (non-destruktif) + toast. (b) **Urutan antrean kronologis**: `flushQueue` kini sort **timestamp** dulu (urutan kejadian nyata antar entitas — mis. cash movement refund setelah transaksi induknya, bukan didahulukan karena action `insert`), tie-break action order hanya untuk timestamp sama. (13.10, 13.11) Test: `offlineQueueFailed.test.ts` +1 (urutan kronologis — calls = [transactions, cash_movements] bukan [insert dulu]). Total test: **397/397** (35 file).

---

## 🔴 PRIORITAS 14 — AUDIT INTEGRASI PRINTER THERMAL & SPLIT PRINTER (Analisa, v4.7)

> **Sumber audit**: `src/utils/printer.ts` (Printer Device Registry v4.0 — `connectBluetoothPrinter`, `printReceipt`/`printSplitReceipt`/`printKitchenReceiptBluetooth`), `src/hooks/usePrinterMonitor.ts` (polling 3 dtk), `src/components/PrinterStatusBanner.tsx`, `src/pages/SettingsPage.tsx` (UI Hubungkan/Ganti/Test Print/Putus).

**Arsitektur saat ini (yang benar):**
- **Registry per-logika-printer**: `printerRegistry` = Map in-memory (`__cashier__` → struk kasir; `<kitchen-printer-uuid>` → printer dapur/bar) — setiap printer punya binding Bluetooth independen.
- **Split print**: `printReceipt(targetPrinter)` memfilter item per `kitchenTarget` → printer dapur yang cocok; `printSplitReceipt` mencetak struk sub-bill (kasir) + tiket dapur lengkap saat `target 'all'` (split fresh, sub-bill pertama — dapur belum terima tiket).
- **Monitor**: `usePrinterMonitor` polling 3 dtk + banner status (hijau/kuning/merah) dengan tombol Reconnect per printer / Reconnect Semua.
- **Penyimpanan deviceId**: settings menyimpan `cashierBluetoothDeviceId`/`cashierBluetoothDeviceName` + `kitchenPrinters[].bluetoothDeviceId/Name` (persisten).

### 14.1 (🔴 KRITIS) — Koneksi Bluetooth PUTUS SAAT REFRESH — tidak ada auto-reconnect

> ✅ **SELESAI (v4.7) — P-1 + P-2 + P-3 + P-4 dieksekusi** (lihat catatan di bawah).

- **Akar masalah**: koneksi hidup di `printerRegistry` (Map in-memory) → **hilang total saat page refresh**. Web Bluetooth (`navigator.bluetooth.requestDevice`) **wajib user gesture** dan selalu membuka **device picker** — tidak bisa reconnect diam-diam setelah refresh. `bluetoothDeviceId` tersimpan di settings **tidak pernah dipakai** untuk re-pair (tidak ada panggilan `getDevices()`/`gatt.connect` ke device tersimpan).
- **Akibat**: setelah refresh, banner muncul (polling 3 dtk) tapi tombol Reconnect membuka picker lagi; kasir harus pairing ulang manual tiap refresh. Lebih parah: `printReceiptBluetooth`/`printTextRaw` yang menemukan printer terputus **memanggil `connectBluetoothPrinter` saat checkout** → picker Bluetooth muncul di tengah transaksi (kalau tidak diklik, print gagal diam-diam).
- **Yang sudah dikerjakan (v4.7)**:
  - **P-1 ✅** — `reconnectBluetoothPrinter(printerId, expectedDeviceId)` baru di `src/utils/printer.ts`: `navigator.bluetooth.getDevices()` → cocokkan `device.id` dengan `bluetoothDeviceId` tersimpan → `gatt.connect()` + discovery service/characteristic via helper bersama `establishConnection` (dipakai juga oleh `connectBluetoothPrinter` — tanpa duplikasi logika). **Senyap, tanpa picker**. Dipanggil otomatis saat boot (`usePrinterMonitor` useEffect untuk printer yang tadinya tersambung) + saat print menemukan printer terputus.
  - **P-2 ✅** — State sesi di `sessionStorage` (`rempah-printer-session`, key = printerId → deviceId/deviceName/connectedAt): `markPrinterSession` (saat connect/re-pair sukses), `clearPrinterSession` (saat user memutus manual), `getPrinterSessionState`. Setelah refresh, `usePrinterMonitor` tahu printer mana yang tadinya tersambung dan mencoba re-pair senyap dulu; bila gagal → banner **agresif non-dismissable**.
  - **P-3 ✅** — **Picker tidak lagi terbuka otomatis saat checkout**: `printReceiptBluetooth` & `printTextRaw` menggantikan `connectBluetoothPrinter` (picker) dengan re-pair senyap; gagal → throw error dengan pesan "klik banner printer untuk menyambungkan kembali" (struk kasir: hasil error masuk `PrintJobResult` tanpa memblokir transaksi — engine tetap commit; `printTextRaw`: fallback browser print). `printKitchenReceiptBluetooth` juga coba re-pair senyap sebelum throw (tiket dapur tidak membuka picker di tengah checkout).
  - **P-4 ✅** — `PrinterStatusBanner`: bila ada printer yang tersambung di sesi sebelumnya tapi kini terputus → banner merah **"Refresh memutus koneksi … — klik untuk menyambungkan kembali"** + tombol **Sambungkan Ulang / Sambungkan Semua** (tidak bisa di-dismiss sampai tersambung). Handler dipindah sebelum early-return (fix TS2448).
- **Test**: `src/test/printerReconnect.test.ts` (6 kasus: state sesi survive reload, clear, re-pair senyap tanpa requestDevice, gagal bila device tidak ada, tanpa dukungan getDevices, disconnect membersihkan registry+sesi). Total test: **403/403** (36 file).
- **Catatan batasan**: `getDevices()` hanya berisi device yang dipairing dengan izin "remember"; butuh user activation minimal sekali per sesi di beberapa browser — bila gagal, fallback tetap picker via tombol banner (1 klik).

### 14.2 (🟠 TINGGI) — Fallback print saat printer terputus tidak konsisten

> ✅ **SELESAI (v4.7)** — lihat catatan di bawah.

- `printReceiptBluetooth` (struk kasir) & `printTextRaw` memanggil `connectBluetoothPrinter` saat terputus → **picker muncul di tengah checkout** (mengganggu alur). `printKitchenReceiptBluetooth` sebaliknya **melempar error** (tidak ada fallback) → tiket dapur gagal diam-diam (hanya `console.error` di `printReceipt`, hasil error dibungkus `Promise.allSettled`).
- **Yang dikerjakan (v4.7)**: satu kebijakan `notifyPrinterFallback` + fallback di semua jalur — printer Bluetooth terputus → (a) **re-pair senyap** via `getDevices()`; (b) gagal → **fallback browser print** (struk kasir `printReceiptBrowser`, tiket dapur `printKitchenReceiptBrowser`, teks `fallbackBrowserPrintText`) + **toast peringatan** "Printer X terputus — struk dicetak lewat dialog browser. Klik banner printer untuk menyambungkan kembali"; (c) tidak pernah membuka picker tanpa klik eksplisit (P-3).

### 14.3 (🟠 TINGGI) — Belum ada antrean print (print queue)

> ✅ **SELESAI (v4.7)** — lihat catatan di bawah.

- Saat banyak pesanan masuk bersamaan (KDS + struk + split), `sendToBluetoothPrinter` menulis langsung ke characteristic — tanpa antrean, bisa saling tumpang tindih/gagal; tidak ada retry jika GATT busy.
- **Yang dikerjakan (v4.7)**: **print queue FIFO per printer** di `src/utils/printer.ts` — `printQueue` + `drainingPrinters` + `enqueuePrint`/`drainPrintQueue`; `sendToBluetoothPrinter` kini mengantre & menunggu job selesai (serial per printer, printer lain tetap paralel). **Retry 1×** untuk error transient (GATT busy / disconnect sesaat, jeda 150 ms); gagal kedua → job di-drop dengan `console.warn` (tidak menggantung). Semua jalur cetak (struk, tiket dapur, `printTextRaw`, `testPrintBluetooth`) lewat queue ini.
- **Test**: `src/test/printerQueue.test.ts` (3 kasus: dua job sequential tanpa tumpang tindih, retry 1× sukses, drop tanpa menggantung). Total test: **406/406** (37 file).

### 14.4 (🟡 SEDANG) — Status koneksi tidak dipersist & tidak sinkron lintas tab/device

> ✅ **SELESAI (v4.7)** — lihat catatan di bawah.

- `getBluetoothStatus` hanya dari registry in-memory; setelah refresh UI "Connected" hilang walau device fisik masih menyala. Tidak ada indikasi di KDS/kitchen page apakah printer dapur tersambung (hanya banner global).
- **Yang dikerjakan (v4.7)**: **BroadcastChannel `rempah-printer-events`** di `printer.ts` (`broadcastPrinterEvent`/`subscribePrinterEvents`) — peristiwa connect/disconnect dibagikan antar-tab (connect di Settings/POS terlihat di tab lain). **Store ringan `printerStatusStore`** (transient) + **hook `usePrinterCrossTab`** (subscribe channel + sinkron registry lokal + `tryReconnectSilent` + `getStatus` fallback lokal→store). **Indikator di halaman Kitchen/Dapur**: chip hijau/merah per printer dapur (ikon printer + nama + titik status) + tombol **Hubungkan** (re-pair senyap tanpa picker) saat terputus — dapur langsung tahu printer mana yang hidup/mati tanpa buka Settings.
- **Test**: `src/test/printerCrossTab.test.ts` (3 kasus: applyEvent connect/disconnect, subscribePrinterEvents lintas-tab ke store via BroadcastChannel, setConnected). Total test: **409/409** (38 file).

### 14.5 (🟡 SEDANG) — Print fallback browser vs Bluetooth tidak seragam

> ✅ **SELESAI (v4.7)** — lihat catatan di bawah.

- `printerType: 'browser'` memakai `window.print()`; mode Bluetooth tidak punya fallback ke browser secara otomatis. Untuk demo/klien tanpa printer Bluetooth, fallback harus eksplisit & mulus (termasuk tiket dapur).
- **Yang dikerjakan (v4.7)**: fallback kini **opsi eksplisit per printer** — `cashierFallbackBrowser` (AppSettings) & `fallbackBrowser` (KitchenPrinterConfig), default ON (true saat undefined):
  - `printReceiptBluetooth` / `printKitchenReceiptBluetooth` / `printTextRaw` → return `boolean`; bila Bluetooth gagal & fallback nonaktif → **return false** (pemanggil mencatat status error), bukan cetak browser diam-diam.
  - `printReceipt` orchestrator: printer dapur BT fallback OFF → hasil `status: 'error'` dengan pesan "Koneksi Bluetooth terputus dan fallback browser nonaktif"; fallback ON → `status: 'success'` + tiket keluar via `printKitchenReceiptBrowser`.
  - `printTextRaw` tidak melempar (aman untuk tutup shift, TO DO 6.4) — return false + toast bila fallback nonaktif.
  - **UI Settings**: toggle "Fallback Browser Print bila Bluetooth gagal" di blok Printer Kasir (Bluetooth) + toggle "Fallback Browser Print bila gagal" per kartu Printer Dapur (tipe Bluetooth).
  - Test: `src/test/printerFallback.test.ts` (4 kasus fallback; via stub DOM — iframe thermal tercipta = bukti browser print dieksekusi).

### 14.6 (🟢 MINOR) — Naming & UX kecil

> ✅ **SELESAI (v4.7)** — lihat catatan di bawah.

- Tombol "Hubungkan Printer" di Settings memakai `alert()` (konsisten lama, tapi bisa diganti toast); banner Reconnect tidak menyebut bahwa refresh yang memutus koneksi.
- `sessionStorage` vs settings `bluetoothDeviceId` — pastikan satu sumber kebenaran device identity.
- **Yang dikerjakan (v4.7)**:
  - **alert() → toast** di semua alur printer: `connectBluetoothPrinter` (printer.ts — browser tak mendukung / tak bisa menulis / gagal connect) + SettingsPage (connect kasir, test print sukses/gagal, putus, duplikat device, connect printer dapur).
  - **Satu sumber kebenaran device identity**: helper `getPrinterDeviceId(printerId, settings)` / `getPrinterDeviceName` di `printer.ts` — settings (`bluetoothDeviceId` persisten) = kanonik, sessionStorage = fallback. Dipakai di `usePrinterMonitor.reconnectSilent` + boot re-pair, `usePrinterCrossTab.tryReconnectSilent`, dan jalur print Bluetooth.
  - **Banner Reconnect**: cek state sesi via `getPrinterSessionState()` (bukan string-includes `sessionStorage`) + label diseragamkan ke Bahasa Indonesia: "Sambungkan Ulang" / "Sambungkan Semua" (sebelumnya campuran "Reconnect").
  - Test: `src/test/printerFallback.test.ts` (3 kasus 14.6: prioritas settings > session, printer dapur dari kitchenPrinters, connect tanpa Web Bluetooth → toast tanpa alert).

---

## 🔴 PRIORITAS 15 — TEMUAN UX & VALIDASI (Analisa, v4.7)

> **Sumber temuan**: laporan user (3 isu) — `src/pages/Catalog.tsx` (form add-on & import CSV), `src/components/PendingPaymentsModal.tsx` (daftar pending), `src/pages/POS.tsx` + `src/lib/atomicTransactionEngine.ts` (alur checkout & cetak otomatis). Belum ada perubahan kode — analisa dulu, eksekusi bertahap.

### 15.1 (🟠 TINGGI) — Harga Add-on bisa bernilai 0 / tidak divalidasi (`Catalog.tsx`)

> ✅ **SELESAI (v4.7)** — lihat catatan di bawah.
> 🔁 **REVISI (v4.7)**: **add-on harga 0 (gratis) kini SAH** — kebutuhan bisnis: banyak menu yang *include* pilihan saus ekstra tanpa biaya dan ingin memakai Add-ons untuk itu. Yang diblokir hanya harga **negatif / bukan angka** (bukan harga 0). Form & import CSV diperbarui (`validateAddOnForm`/`sanitizeImportedAddOns` — `price >= 0` valid; kolom harga kosong = 0/gratis). Di POS, add-on gratis tampil berlabel **"Gratis"** (bukan "+Rp 0"), dan di **struk termal & digital** nama add-on gratis ikut tercetak dengan penanda **(Gratis)** tanpa menambah total/unit price (5 lokasi `addonStr` di `printer.ts` + `digitalReceipt.ts`; +2 test). Test `menuValidation` diperbarui (tetap 11 kasus — harga 0 valid, negatif/NaN/nama kosong diblokir/di-drop).

- **Gejala**: harga add-on pada menu dapat bernilai 0 → di POS add-on tampil "+Rp 0" (gratis) atau malah **hilang diam-diam** dari daftar add-on menu tanpa peringatan.
- **Akar masalah** (2 jalur):
  - **Form**: input harga add-on hanya membatasi digit (`replace(/\D/g, '')`) — tidak ada validasi harga > 0. Saat simpan, `handleSave` memakai `.filter((a) => a.name && parseInt(a.price))` → add-on dengan harga `0`/`NaN` di-**DROP tanpa pesan** (kasir tidak tahu kenapa add-onnya hilang setelah disimpan).
  - **Import CSV** (`handleImport`): `availableAddons: JSON.parse(clean(parts[5] || '[]'))` — di-parse mentah **tanpa validasi** → add-on harga 0/negatif/NaN bisa masuk ke katalog via import.
- **Rencana perbaikan**: (a) validasi harga add-on **harus > 0** di form (warning/toast saat simpan, jangan drop diam-diam); (b) saat import CSV, validasi tiap add-on (drop baris invalid + laporkan jumlah yang dibuang); (c) opsional: validasi juga harga menu `parseInt(formPrice) || 0` (harga 0) dan add-on tanpa nama — konsisten di semua jalur masuk data (form, import, seed).
- **Yang dikerjakan (v4.7)**:
  - **Helper murni baru `src/utils/menuValidation.ts`**: `validateAddOnForm` (form — baris kosong di-skip; nama tanpa harga / harga ≤ 0 / bukan angka → problem yang MENGAMBLOK simpan, bukan drop diam-diam), `sanitizeImportedAddOns` (CSV — entry invalid di-drop + dihitung, harga di-round ke integer), `parseImportedAddOns` (JSON.parse aman — JSON rusak tidak menggagalkan seluruh import, ditandai `parseFailed`).
  - **`Catalog.handleSave`**: pakai `validateAddOnForm` — bila ada masalah → **toast warning** "Add-on \"X\": harga tidak boleh negatif atau bukan angka." (+ jumlah masalah lain) dan **simpan dibatalkan**; baris kosong tetap di-skip. **Revisi**: harga 0 diterima (gratis).
  - **`Catalog.handleImport`**: pakai `parseImportedAddOns` per menu — add-on invalid (harga ≤ 0 / nama kosong / non-objek) dilewati; kolom addons yang JSON-nya rusak tidak lagi menggagalkan seluruh import; hasilnya dilaporkan via **toast warning** ("N add-on tidak valid dilewati" / "N menu dengan kolom Addons rusak"), toast sukses hanya bila tidak ada masalah.
  - (c) harga menu `parseInt(formPrice) || 0` sengaja TIDAK diubah — di luar lingkup 15.1 (fokus add-on); dicatat untuk tinjauan berikutnya bila diperlukan.
- **Test**: `src/test/menuValidation.test.ts` (11 kasus: form valid/baris kosong, **harga 0/empty = gratis SAH**, negatif/NaN diblokir, nama wajib, round desimal, kumpulan masalah; import valid, **add-on harga 0 dipertahankan**, dropped dihitung, non-array, JSON rusak → parseFailed). Total test: **427/427** (40 file) — **diperbarui (tetap 11 kasus) setelah revisi add-on gratis**.

### 15.2 (🟠 TINGGI) — Daftar Pending Payment berupa card bertumpuk (memakan space layar) → ubah jadi carousel

> ✅ **SELESAI (v4.7)** — lihat catatan di bawah.

- **Gejala**: list pesanan gantung di `PendingPaymentsModal` tampil sebagai card berjajar vertikal (scroll list) — dengan banyak pending, space layar habis & navigasi berat.
- **Akar masalah**: kolom kiri modal (lebar 5/12, tinggi `h-[520px]`) me-render semua card pending dalam `overflow-y-auto` — semakin banyak pending semakin panjang daftar (bukan paginasi/carousel).
- **Rencana perbaikan**: ubah daftar pending menjadi **carousel horizontal** (geser kiri/kanan):
  - Satu card besar aktif + preview card berikutnya (atau scroll-snap horizontal) — tidak menumpuk vertikal; space modal bisa dipersingkat.
  - Navigasi: tombol panah ◀ ▶ + indikator dot + label "3 dari 12"; dukungan swipe (touch/scroll-snap) di mobile.
  - Pertahankan fitur yang ada: pencarian (meja/antrean/nama), pilih card → detail di kanan, cetak struk sementara, batalkan (void, dengan konfirmasi + revert stok), lanjutkan pembayaran.
  - Catatan: bila jumlah pending sedikit (≤ 3), carousel tetap rapi (tidak perlu list vertikal panjang).
- **Yang dikerjakan (v4.7)**: `PendingPaymentsModal.tsx` ditulis ulang — daftar vertikal diganti **carousel horizontal**:
  - Container `overflow-x-auto snap-x snap-mandatory` (scrollbar disembunyikan via arbitrary properties) → **geser jari di mobile** & scroll-snap rapi; satu card besar per slide (`w-full shrink-0 snap-center`) menampilkan #antrean, badge Pending, pelanggan/meja, waktu, jumlah menu & total.
  - **Navigasi**: tombol panah ◀ ▶ (disabled di ujung), **indikator dot** (klik untuk lompat) + label **"N dari M pesanan gantung"**; `scrollToIndex`/`handleScroll` menyinkronkan index aktif dari posisi scroll (panah & geser konsisten).
  - `safeIdx` di-clamp saat daftar berubah (pencarian / void menghapus item) + `useEffect` mengembalikan posisi scroll — tidak ada index liar.
  - Semua fitur lama dipertahankan: pencarian, detail order di kanan mengikuti card aktif, **Struk Sementara** (`printProvisionalBill`), **Batalkan** (konfirmasi + revert stok), **Lanjutkan Pembayaran** (`onResumeOrder`). Props komponen tidak berubah (POS/Layout tidak perlu diubah).
  - Perubahan UI-only; tsc 0 error, test tetap **431/431** (41 file).

### 15.4 (🟡 SEDANG) — Tombol "Tambah Bahan" & "Min. Stok" muncul juga di tab Stock Opname (`Inventory.tsx`)

> ✅ **SELESAI (v4.7)** — lihat catatan di bawah.

- **Gejala**: di halaman Inventaris, saat tab **Stock Opname** aktif, tombol **"Tambah Bahan"** dan **"Min. Stok"** (juga Export/Template CSV/Import) masih tampil di header — padahal aksi itu hanya relevan untuk tab **Bahan Baku**.
- **Akar masalah**: `Inventory.tsx` me-render header aksi (baris ~226–252) **di luar/atas tab** (`activeTab: 'inventory' | 'opname'`), sehingga tombol-tombol bahan baku tampil di kedua tab. `StockOpname.tsx` sendiri bersih (tidak ada tombol Tambah Bahan / min stok) — semua berasal dari header induk.
- **Rencana perbaikan**: (a) tampilkan group aksi header (Tambah Bahan, Min. Stok, Export, Template CSV, Import) **hanya saat `activeTab === 'inventory'`** — pindahkan ke dalam blok tab Bahan Baku, atau bungkus dengan kondisional `activeTab === 'inventory' && (...)`; (b) saat tab Stock Opname aktif, header cukup judul + tab (dan tombol aksi opname yang memang ada di `StockOpname.tsx`, mis. Mulai Opname/History — biarkan komponen StockOpname mengelola aksinya sendiri); (c) pastikan tombol Min. Stok tetap tersembunyi untuk role Staf Gudang sesuai kondisi yang ada.
- **Yang dikerjakan (v4.7)**: group aksi header di `Inventory.tsx` (Tambah Bahan, Min. Stok, Export, Template CSV, Import) dibungkus `{activeTab === 'inventory' && (...)}` — **hanya tampil di tab Bahan Baku**; saat tab Stock Opname aktif, header hanya judul "📦 Inventaris" + tab (aksi opname dikelola `StockOpname.tsx` sendiri). Kondisi role Staf Gudang (Min. Stok & Import/Template tersembunyi) tetap dipertahankan. Perubahan UI-only; test tetap **431/431** (41 file), tsc 0 error.

### 15.3 (🟠 TINGGI) — Tidak ada opsi "cetak tanpa struk" saat menyelesaikan pembayaran

> ✅ **SELESAI (v4.7)** — lihat catatan di bawah.

- **Gejala**: saat checkout, struk selalu dicetak bila `printerEnabled` / `autoPrintOnCheckout` aktif — tidak ada cara memilih **tidak mencetak struk** untuk menghemat kertas (mis. pelanggan tidak mau struk / struk duplikat).
- **Akar masalah**: `AtomicTransactionEngine.triggerPostCommitTasks` memanggil `printReceipt(receiptData, settings, 'all', ...)` (struk kasir + tiket dapur) bila setting printer aktif; satu-satunya bypass `suppressAutoPrint` hanya dipakai sub-bill split (yang mencetak sendiri). Tidak ada opsi per-transaksi.
- **Rencana perbaikan**:
  - **UI**: checkbox di modal pembayaran (POS) — mis. **"Cetak struk kasir"** (default ON mengikuti setting) — bila dimatikan → transaksi selesai tanpa mencetak struk.
  - **Engine**: tambah param `skipReceiptPrint?: boolean` di `AtomicCheckoutParams`. Jangan pre-open `preOpenedPrintWindow` di POS bila skip.
  - **Pertimbangan**: opsi yang sama idealnya juga ada di alur Split Bill (sub-bill mencetak `printSplitReceipt` sendiri) dan saat resume pending — dokumentasikan agar perilaku konsisten.
- **Yang dikerjakan (v4.7, desain dua toggle independen + anti dobel tiket)**:
  - **`AtomicCheckoutParams`** (`src/types/index.ts`): param baru **`skipReceiptPrint?: boolean`** (struk kasir dilewati) + **`skipKitchenPrint?: boolean`** (tiket dapur dilewati).
  - **Engine** (`triggerPostCommitTasks`): dua panggilan print terpisah, masing-masing di-gate — `if (!skipReceiptPrint) printReceipt(..., 'cashier', ...)` + `if (!skipKitchenPrint) printReceipt(..., 'kitchen')`. `suppressAutoPrint` (split) tetap dihormati.
  - **POS.tsx**: **dua checkbox** — **"Cetak struk kasir"** & **"Cetak tiket dapur"** (hanya tampil bila `printerEnabled`/`autoPrintOnCheckout` aktif; saat keduanya nonaktif ada keterangan "tidak ada cetakan sama sekali"); state di-reset ke default (cetak semua) setiap modal dibuka (handleCheckoutCb + proceedCheckoutAnyway) dan setelah checkout sukses; **pre-open print window dilewati** saat skip struk; kedua flag diteruskan ke `executeCheckout`.
  - **Anti tiket DOBEL (resume pending)**: saat finalize pending dengan item TIDAK berubah (`pendingItemsChanged=false`), checkbox **"Cetak tiket dapur" default OFF** — tiket dapur sudah tercetak saat Simpan Pending → tidak perlu ulang. Item berubah → default ON (dapur perlu tiket baru). Ini menutup bug dobel tiket dari sisi desain.
  - **Perluasan ke Split Bill & resume pending (selesai)**: `printSplitReceipt` mendapat **dua param** `skipCashierPrint?: boolean` + `skipKitchenPrint?: boolean` (struk & tiket dapur dilewati independen; tiket dapur hanya relevan untuk sub-bill pertama fresh, target 'all'). `SplitBillModal` menambah **dua checkbox** di Payment Box (checkbox tiket dapur hanya tampil saat split fresh — split dari pending tidak pernah mencetak ulang tiket); reset saat modal dibuka konteks baru. **Resume pending otomatis tercakup** — kasir melewati modal checkout yang sama (15.3) sehingga kedua flag ikut berlaku saat finalisasi pending. Test `printTarget` (7 kasus) → total **434/434** (41 file).
- **Test**: `src/test/printTarget.test.ts` (7 kasus — target `'all'` → struk kasir keluar via window.open; target `'kitchen'` tanpa printer dapur → 0 print; target `'kitchen'` dengan printer dapur browser → tiket dapur keluar via iframe; `'all'` dengan printer dapur → struk kasir + tiket dapur; `printSplitReceipt` skipCashier=true + kitchen=false → **struk dilewati, tiket dapur TETAP keluar**; keduanya true → 0 cetakan; default → keduanya). Total test: **434/434** (41 file).

---

## 🔴 PRIORITAS 16 — BUG: ITEM PENDING TIDAK TER-UPDATE DI RIWAYAT TRANSAKSI (v4.7)

> **Sumber temuan**: laporan user — "ketika saya menambahkan atau mengurangi menu di transaksi pending payment, menu yang ditambahkan atau dikurangi itu tidak bertambah atau berkurang di riwayat transaksi".
> **Status**: ✅ **SELESAI (v4.7)** — lihat catatan di bawah.

### 16.1 (🟠 TINGGI) — Item pending yang di-update tidak tercermin di riwayat transaksi

- **Gejala**: tambah/kurangi menu pada pesanan gantung (resume → ubah cart → Simpan Pending lagi / Lanjutkan Pembayaran) tidak terlihat di riwayat transaksi — menu lama tetap tampil, menu baru hilang.
- **Akar masalah (2 lapis)**:
  1. **Lokal BENAR** — re-commit pending dengan ID sama (`bypassIdempotency`) → `addTransaction` melakukan **upsert by ID** (`filter(t.id !== tx.id)` + prepend) → store lokal langsung menyimpan item baru. Dibuktikan test reproduksi engine langsung (3/3 lolos).
  2. **Round-trip cloud MENIMPA lokal** — `loadFromCloud` (dipicu realtime App.tsx & Transactions.tsx, refresh halaman, event `online`, boot) bersifat **cloud-authoritative**: bila ID ada di hasil fetch cloud, versi lokal DIBUANG tanpa perbandingan freshness. Karena `syncTransaction` berjalan **async fire-and-forget** (bisa tertunda / gagal → offline queue), ada jendela di mana cloud masih berisi item LAMA → fetch menimpa item lokal yang benar.
- **Perbaikan (2 lapis)**:
  1. **Freshness compare di `loadFromCloud`** (`src/store/transactionStore.ts`) — bila ID ada di cloud DAN di lokal, pilih versi yang **lebih baru** per transaksi; deletion lintas device (ID lokal tidak ada di cloud, di dalam window) tetap cloud-authoritative.
  2. **Anti-duplikat** — versi cloud yang kalah TIDAK boleh ikut merge (`localNewerIds`/`cloudForMerge`) — sebelumnya muncul **dua record ber-ID sama** (duplikat baris di UI; `find()`/sort bisa mengembalikan versi cloud stale).
  3. **`updatedAt` minimal (hasil evaluasi desain)** — jalur update yang TIDAK mengubah `date` (void/cancel, kitchen status, payment method/refund via `updateTxStatus`/`updateKitchenStatus`/`updateTxMeta`) tidak terlindungi perbandingan `date` saja. Tambah field **`updatedAt?: string`** di `Transaction`: di-stamp **engine tiap commit** + **3 fungsi update store**; `loadFromCloud` memakai `freshTime()` = `updatedAt` fallback `date` (legacy). **Tanpa migrasi DB** (versi minimal — kolom DB opsional untuk presisi lintas device; hindari `DEFAULT now()` untuk backfill agar baris legacy tidak tampak "lebih baru").
- **File**: `src/types/index.ts` (+`updatedAt`), `src/lib/atomicTransactionEngine.ts` (stamp tiap commit), `src/store/transactionStore.ts` (stamp 3 fungsi update + freshness compare + anti-duplikat), test `src/test/pendingUpdateHistory.test.ts` (baru) + `src/test/pendingCloudOverwrite.test.ts` (baru).
- **Test**: 11 kasus — `pendingUpdateHistory` (3: update tambah item, hapus+tambah item, finalize dengan item berubah — membuktikan alur LOKAL engine benar) + `pendingCloudOverwrite` (8: lokal lebih baru tidak ditimpa stale, cloud lebih baru menang, date sama → cloud, **void/status terlindungi** (updatedAt), updatedAt lebih unggul dari date, cloud updatedAt lebih baru, legacy fallback date, **anti-duplikat**, deletion lintas device tetap berlaku). Timestamp relatif terhadap `Date.now()` agar deterministik. Total test: **445/445** (43 file) — **447/447** setelah +2 test add-on gratis di struk (revisi 15.1) — **449/449** setelah fitur "Semua Dapur" (16.2, `printTarget` +2).

### 16.2 (🟢 MINOR/FITUR) — Edit Menu: opsi cetak ke SEMUA Target Dapur ("Semua Dapur")

> ✅ **SELESAI (v4.7)** — lihat catatan di bawah.

- **Kebutuhan**: ada menu yang harus dicetak di semua dapur (mis. menu umum yang bisa dibuat di dapur mana pun) — sebelumnya `kitchenTarget` hanya bisa satu target spesifik (cocokkan `item.kitchenTarget === kp.targetCategory`), atau kosong (tanpa split / tidak ke printer dapur mana pun).
- **Yang dikerjakan (v4.7)**:
  - **Form Edit Menu** (`Catalog.tsx`): pilihan baru **"Semua Dapur (Cetak ke Semua Printer Dapur)"** di select Target Dapur → nilai tersimpan `kitchenTarget: 'ALL'` (string, sync cloud aman via kolom `kitchen_target` TEXT — tanpa migrasi).
  - **Routing dapur** (`printer.ts` `printReceipt` — satu-satunya tempat routing, dipakai juga `printSplitReceipt`): `itemTarget` `'all'`/`'semua dapur'`/`'*'` → item dikirim ke **SEMUA printer dapur aktif**. Target spesifik tetap seperti sebelumnya.
  - **Tampilan**: badge daftar menu (`Catalog.tsx`) & badge item di cart POS (`POS.tsx`) menampilkan **"Semua Dapur"** untuk `kitchenTarget === 'ALL'`.
  - Bundle: `kitchenTarget` 'ALL' mengalir ke child (bundleService) tanpa perubahan khusus.
- **Test**: `printTarget.test.ts` +2 — item `kitchenTarget: 'ALL'` + 2 printer (Makanan & Minuman) → **keduanya mencetak** (2 iframe, hasil sukses); item target spesifik `'Makanan'` + 2 printer → hanya printer Makanan yang benar-benar mencetak (1 iframe). Total test: **449/449** (43 file).

## 🔴 PRIORITAS 17 — TEMUAN UX EDIT MENU, CHECKBOX CETAK & DUPLIKAT TRANSAKSI PENDING (Analisa, v4.7)

> **Sumber temuan**: laporan user (3 case) — (1) tampilan Edit Menu bagian Best Seller / Level Gula / Pilihan Suhu menumpuk; (2) checkbox Cetak Struk Kasir & Cetak Tiket Dapur atas-bawah (ingin berdampingan di desktop); (3) pending payment yang diedit (tambah/kurangi menu) lalu dibayar → riwayat transaksi jadi **2**: 1 pending lama (masih status Pending) + 1 transaksi Selesai (hasil edit).
> **Status**: ✅ **17.1 + 17.2 SELESAI (v4.7)** — 17.3 masih 🔎 ANALISA (belum dieksekusi).

### 17.1 (🟢 UI/UX) — Edit Menu: Best Seller / Level Gula / Pilihan Suhu menumpuk

> ✅ **SELESAI (v4.7)** — lihat catatan di bawah.

- **Gejala**: di modal Edit/Tambah Menu (`Catalog.tsx`), tiga checkbox `Best Seller ⭐` / `Level Gula 🍬` / `Pilihan Suhu 🌡️` berada dalam satu baris `flex items-center gap-4 h-full pt-6` yang merupakan **anak langsung grid** `grid grid-cols-1 sm:grid-cols-2 gap-4` → di desktop baris checkbox hanya mengisi **satu kolom grid (½ lebar modal)** sehingga label panjang saling mendesak & wrap tidak rapi ("menumpuk"); di mobile (1 kolom) lebar penuh tapi tetap rawan wrap tidak konsisten.
- **Yang dikerjakan (v4.7)**: baris checkbox → `flex flex-wrap items-center gap-x-5 gap-y-2 h-full pt-6 sm:col-span-2` — **`sm:col-span-2`** membentang penuh di grid 2 kolom (desktop) sehingga tiga checkbox sejajar horizontal tanpa saling mendesak; **`flex-wrap` + `gap-y-2`** membuat wrap rapi ke baris berikutnya di layar sempit/mobile. Tanpa perubahan logika form.
- **File**: `src/pages/Catalog.tsx`.
- **Validasi**: tsc 0 error, **449/449 test** (43 file).

### 17.2 (🟢 UI/UX) — Checkbox Cetak Struk Kasir & Cetak Tiket Dapur berdampingan di desktop

> ✅ **SELESAI (v4.7)** — lihat catatan di bawah.

- **Gejala**: di modal pembayaran POS (`POS.tsx` ±1939–1958) dua checkbox tersusun **vertikal** (`flex flex-col gap-1`) → memakan tinggi modal; di desktop lebih optimal **berdampingan**.
- **Yang dikerjakan (v4.7)**: container dua checkbox → `flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-6` — **vertikal di mobile, horizontal (berdampingan) di desktop**; catatan "(tidak ada cetakan sama sekali)" diberi `sm:basis-full` agar tetap di baris tersendiri (wrap ke bawah) saat mode row. **Diterapkan konsisten di dua tempat**: modal pembayaran POS (`POS.tsx`) dan Payment Box Split Bill (`SplitBillModal.tsx`, termasuk label tiket dapur yang hanya tampil saat split fresh `!parentTx`).
- **File**: `src/pages/POS.tsx`, `src/components/SplitBillModal.tsx`.
- **Validasi**: tsc 0 error, **449/449 test** (43 file).

### 17.3 (🔴 KRITIS) — Duplikat transaksi: pending diedit & dibayar → muncul 2 transaksi (pending lama + selesai baru)

> ✅ **SELESAI (v4.7)** — lihat catatan di bawah.

- **Gejala**: buat pending payment → resume (Lanjutkan Pembayaran) → edit cart (tambah/kurangi menu) → bayar (Selesaikan) → riwayat transaksi berisi **2 baris**: (a) pending lama **masih berstatus Pending dengan item sebelum edit**, (b) transaksi **Selesai dengan item hasil edit**. Pending lama tidak pernah di-update/dihapus.
- **Akar masalah**: identitas pending hidup di **component state POS.tsx** — `currentPendingTx` (line 162) & `checkoutTxId` (line 425). Keduanya **hilang saat POS di-unmount**: POS adalah route (`App.tsx` line 267) → pindah halaman (mis. buka Riwayat Transaksi) atau refresh akan me-reset keduanya (`checkoutTxId` = UUID baru, `currentPendingTx` = null). Sementara **cartStore PERSIST** (`name: 'rempah-cart'`, IndexedDB) → item hasil resume tetap ada di keranjang. Saat bayar, `finalizeTransaction` memakai `transactionId: checkoutTxId` (line 788) yang sudah UUID **baru** → engine membuat **transaksi baru** (upsert by ID tidak kena, karena ID berbeda) → pending lama (item lama) tidak pernah disentuh → **2 transaksi**.
- **Bukti di kode**: engine & store sudah benar (re-commit ID sama → upsert by ID → 1 transaksi; dibuktikan test `pendingUpdateHistory` 3/3); `loadFromCloud` sudah ada freshness compare (Prioritas 16). Satu-satunya celah: **ID yang dipakai finalize tidak sama dengan ID pending** setelah remount karena state hilang.
- **Solusi yang direncanakan (persist resume context)**:
  1. `cartStore` (persisted): tambah `resumeContext?: { id: string; queueNumber?: number; kitchenStatus?: string } | null` + setter `setResumeContext` / clear di `clearCart`.
  2. `handleResumePendingOrder` → simpan `resumeContext` (setelah `clearCart`).
  3. `finalizeTransaction` & `handleSavePending` → `transactionId = currentPendingTx?.id ?? resumeContext?.id ?? checkoutTxId`; `overrideQueueNumber` & `overrideKitchenStatus` fallback dari `resumeContext`.
  4. **Restore saat mount POS**: bila `resumeContext` ada & cart berisi item → cari tx di store → `setCurrentPendingTx(tx)` + `setCheckoutTxId(tx.id)` agar logika turunan (`pendingItemsChanged`, `parentTx` split, kitchen status, skip tiket dapur default) konsisten seperti tanpa remount.
  5. Bersihkan context saat: `clearCart` manual (abandon), sukses `handleSavePending`, sukses `finalize`, `onCompleteSplit`, `handleDropOrder`.
  6. Kasus tepi: pending di-void device lain → tx tidak ditemukan saat restore → dilewati (transaksi baru = perilaku benar).
- **Test yang direncanakan**: (a) `cartStore` — `setResumeContext` persist & `clearCart` membersihkan; (b) alur remount — simulasikan save pending → resume → state hilang → finalize: **tanpa fix = 2 transaksi (reproduksi bug)**, **dengan fix = 1 transaksi** (pending di-update ke Selesai).
- **File**: `src/store/cartStore.ts`, `src/pages/POS.tsx`, `src/utils/pendingResume.ts` (baru), test `src/test/pendingResumeContext.test.ts` (baru).
- **Yang dikerjakan (v4.7)**:
  1. **`cartStore`** — field baru **`resumeContext?: { id, queueNumber?, kitchenStatus? } | null`** + `setResumeContext(ctx)`; PERSIST (IndexedDB, ikut `rempah-cart`). **Bersih otomatis**: `clearCart()` (menutup abandon, sukses save/finalize, onCompleteSplit) & `removeItem` saat keranjang jadi **kosong** (semua item dihapus = resume dibatalkan → order baru tidak salah me-restore pending lama).
  2. **`src/utils/pendingResume.ts`** (baru) — helper murni **`resolveResumeRestore(ctx, cartItems, transactions)`**: tanpa konteks → jangan restore; tx tidak ditemukan / sudah **Selesai** (dibayar/dibatalkan di device lain) → **STALE** (bersihkan konteks); keranjang kosong → jangan restore (bukan stale); tx masih **Pending** + keranjang berisi → restore.
  3. **`POS.tsx`** — `handleResumePendingOrder` menyimpan `resumeContext` (id + queueNumber + kitchenStatus); **efek mount** memanggil `resolveResumeRestore` → bila sah, `setCurrentPendingTx(tx)` + `setCheckoutTxId(tx.id)` sehingga semua logika turunan (`pendingItemsChanged`, `parentTx` split, status dapur, default skip tiket dapur) konsisten seperti tanpa remount; konteks basi dibersihkan.
  4. **Bonus (bug laten se-area)**: blok sukses `finalizeTransaction` kini memanggil **`setCurrentPendingTx(null)`** — sebelumnya identity pending bocor ke order berikutnya (order BARU ikut `overrideQueueNumber`/`reservedDeductions` lama → stok terpotong salah; `handleSavePending` bisa memakai ID transaksi yang sudah Selesai).
- **Test** (`pendingResumeContext.test.ts`, 11 kasus): (1) **reproduksi bug** — save pending → resume → state hilang (UUID baru) → finalize → **2 transaksi** (pending lama + selesai baru) ❌; (2) **dengan fix** — restore ID → finalize → **1 transaksi** (pending di-update ke Selesai) ✅; (3) dengan fix + item ditambah → 1 transaksi berisi item hasil edit; (4) `resolveResumeRestore` 5 aturan (tanpa konteks / Pending+cart / Selesai→stale / tidak ditemukan→stale / cart kosong); (5) siklus hidup `resumeContext` di cartStore (set & clearCart / hapus item terakhir → bersih / hapus sebagian → dipertahankan). Total test: **460/460** (44 file; +11).

---

## 🧩 PRIORITAS 18 — SKENARIO 2 KASIR BERSAMAAN & MODE OFFLINE (Analisa, v4.7)

> **Sumber temuan**: `ANALYSE.md` **Bagian E** — analisa bila 2 kasir login & bertransaksi bersamaan di device masing-masing (nomor antrian, KDS, stok, laporan; termasuk saat keduanya offline).
> **Status**: ✅ **18.1 + 18.2 + 18.3 + 18.4 SELESAI (v4.7)** — 18.5–18.7 catatan aman, 18.8 daftar temuan A.
> **Catatan eksekusi**: temuan ini dieksekusi **bersama temuan A** (A1–A13 di `ANALYSE.md` — daftar ringkas di blok 18.8 di bawah). Prioritas usulan: **E2 → E1 → E3** (operasional) → A4/A6/E4 → sisanya.
> **Kesimpulan utama**: sebagian besar aman (sync by-ID + realtime menangani KDS & laporan), tapi ada **4 titik rawan nyata** — E1 (nomor antrean duplikat), E2 (lost-update stok), E3 (shift & expected cash), E4 (reserve split per-device). Semua **memburuk saat offline**.

### 18.1 (🔴 KRITIS; offline: 🔴 parah) — Stok LOST-UPDATE validate-then-deduct

> ✅ **SELESAI (v4.7)** — lihat catatan di bawah.

- **Lokasi**: `AtomicTransactionEngine.executeCheckout` (validasi → `deductStock`), `src/store/inventoryStore.ts` `deductStock`.
- **Fakta**: validasi stok & pemotongan adalah **dua langkah terpisah tanpa atomisitas lintas device**. Dua kasir melihat stok bahan = 5; keduanya lolos validasi; keduanya memotong 5 → **terpakai 10 dari 5**. Lokal tiap device = 0, cloud = nilai penulis terakhir (0) → **stok sebenarnya −5 tampil 0** → selisih **hilang tanpa terdeteksi** (alert negatif tidak muncul karena tidak ada device yang lokalnya negatif). O-7 hanya mendeteksi konflik saat cloud > lokal (bukan kasus ini). **Offline**: baseline sama → lost-update hampir pasti untuk bahan laris; drift menumpuk sampai Stock Opname.
- **Yang dikerjakan (v4.7)**:
  1. **RPC atomik `adjust_inventory_stock(p_id, p_delta)`** (di `supabase/schema.sql` + **Migration 27** di `runMigrations`): penyesuaian stok cloud berbasis **DELTA** — `UPDATE inventory SET stock = stock + p_delta, updated_at = now()` dengan **guard `stock >= -p_delta`** untuk deduksi (delta < 0). Dua kasir yang membaca baseline sama: kasir A berhasil (5→2), kasir B **DITOLAK** (cloud 2 < 3) → **oversell mustahil di level cloud**. Delta positif (revert) selalu diizinkan. Mengembalikan JSONB `{ok, stock, reason}` (ok / insufficient + stok aktual / not_found).
  2. **`adjustInventoryStockCloud(adjustments, items)`** di `cloudSync.ts` — deductStock (delta negatif) & revertStock (delta positif) kini memakai jalur atomik ini; **fallback ABSOLUT (perilaku lama, di-queue bila offline)** saat offline / RPC belum dibuat di DB (flag `migrationNeeded.inventoryStockRpc`, degraded=true).
  3. **Penanganan konflik (oversell)** di `inventoryStore` (`handleStockAdjustmentConflicts`): deduksi yang ditolak cloud → **stok lokal dikoreksi ke nilai cloud** (sumber kebenaran lintas device) + jejak **stock log tipe 'adjust'** (audit trail) + **toast warning** "kemungkinan sudah terjual perangkat lain — periksa stok fisik".
- **SQL yang wajib dijalankan SEKALI di Supabase SQL Editor** (DB lama; fungsi tidak bisa dibuat via anon key): `CREATE OR REPLACE FUNCTION adjust_inventory_stock(p_id TEXT, p_delta FLOAT) RETURNS JSONB LANGUAGE plpgsql ...` — persis dicetak oleh console saat Migration 27 terdeteksi (idempoten, `CREATE OR REPLACE`). Deploy baru otomatis dapat dari `schema.sql`.
- **File**: `supabase/schema.sql`, `src/lib/cloudSync.ts`, `src/store/inventoryStore.ts`.
- **Test** (`stockAtomicDeduct.test.ts` 7 unit + `stockDeductConflict.test.ts` 5 integrasi; total +12): skenario **2 kasir** (kasir B ditolak + konflik berisi stok aktual), revert delta positif selalu ok, fallback PGRST202/offline/tanpa konfigurasi, not_found, campuran ok+konflik+error; integrasi koreksi stok lokal + log adjust + toast (1, 3 konflik, tanpa konflik). Assertion `syncInventoryStock` lama di `stockNegativeAlert.test.ts` diganti ke `adjustInventoryStockCloud` (delta ±).
- **Validasi**: tsc 0 error, **472/472 test** (46 file; +12).

### 18.1b (📌 SOP / batasan yang tersisa) — mode offline & RPC belum dibuat

- Saat **offline** atau DB **belum di-upgrade** (RPC belum ada), fallback absolut tetap rawan lost-update — atomicity hanya mungkin lewat RPC. Dijaga: (a) fallback otomatis aktif bila flag migrasi; (b) konflik tetap terdeteksi di merge berikutnya oleh O-7; (c) **SOP "cek stok sebelum shift"** untuk mode offline tetap disarankan (dari ANALYSE E2 usulan #4).

### 18.2 (🔴 KRITIS; offline: 🔴 parah) — Nomor antrean DUPLIKAT antar kasir

> ✅ **SELESAI (v4.7)** — lihat catatan di bawah.

- **Lokasi**: `src/store/transactionStore.ts` `getNextQueueNumber` (±70–125) + `loadFromCloud` (normalisasi `nextQueueNumber`).
- **Fakta**: nomor antrean dihitung **check-then-act** — `max(queue_number)` cloud → `max(cloudMax, localMax) + 1`. Dua kasir bersamaan bisa membaca cloudMax sama → **dua transaksi #N kembar**. Tidak ada lock/sequence atomik (mis. `nextval()` / alokasi range per device). `loadFromCloud` hanya menormalkan penghitung berikutnya — label duplikat yang **sudah terlanjur dibuat tetap kembar**. **Offline**: keduanya pakai `localMax` dari baseline sama → duplikat hampir pasti.
- **Yang dikerjakan (v4.7)**:
  1. **RPC `allocate_queue_number(p_date, p_outlet, p_min)`** (`supabase/schema.sql` + **Migration 28** di `runMigrations`): counter persisten **`queue_counters (outlet_id, date, last_number)`** di cloud yang dinaikkan **ATOMIK** via row-lock upsert — dua kasir ONLINE yang memproses bersamaan **mustahil mendapat nomor sama** (nomor pertama = `floor + 1`; berikutnya = `GREATEST(last + 1, p_min + 1)`). `p_min` = floor `max(cloudMax, localMax)` → nomor tidak menabrak transaksi yang sudah ada (data lama / device lama yang belum pakai RPC).
  2. **`fetchMaxQueueNumberCloud(date)`** + **`allocateQueueNumberCloud(date, floor)`** di `cloudSync.ts` (query max + panggil RPC; konsisten pola 18.1). **`getNextQueueNumber`** di `transactionStore` kini: floor → alokasi RPC → fallback `floor + 1` bila offline / RPC belum dibuat (flag `queueCounterRpc`).
  3. **Badge "#N duplikat"** (fallback visibilitas) — helper murni **`findDuplicateQueueNumbers`** (`src/utils/queueNumber.ts`): deteksi nomor yang muncul > 1× di hari yang sama (Demo/Cancel dikecualikan; nomor reset harian dihormati). Badge merah ditampilkan di **Riwayat Transaksi** (Transactions.tsx, di samping badge "Belum Sync") dan **card Pending Payments** (PendingPaymentsModal.tsx).
  4. **Renumber TIDAK dilakukan** (keputusan desain): struk/kuitansi yang sudah tercetak tidak bisa diubah — pencegahan (RPC) + visibilitas (badge) adalah scope yang tepat.
- **SQL yang wajib dijalankan SEKALI di Supabase SQL Editor** (DB lama; fungsi/tabel tidak bisa dibuat via anon key): `CREATE TABLE IF NOT EXISTS queue_counters ...` + policy + `CREATE OR REPLACE FUNCTION allocate_queue_number ...` — persis dicetak oleh console saat Migration 28 terdeteksi (idempoten). Deploy baru otomatis dapat dari `schema.sql`.
- **File**: `supabase/schema.sql`, `src/lib/cloudSync.ts`, `src/store/transactionStore.ts`, `src/utils/queueNumber.ts` (baru), `src/pages/Transactions.tsx`, `src/components/PendingPaymentsModal.tsx`.
- **Test** (`queueNumber.test.ts` 9 + `queueNumberAllocation.test.ts` 6 + kontrak RPC 4; total +19): helper lokal max & deteksi duplikat (hari sama / beda hari / Demo-Cancel / 0); `getNextQueueNumber` — RPC teralokasi dipakai, floor hormati lokal #7 & cloudMax > lokal, fallback RPC-null = max+1, offline = localMax+1, kosong = 1; **kontrak RPC** (simulasi semantik SQL: pertama = floor+1, 2 kasir floor sama → 6,7,8 unik, floor > counter → lompat, reset harian).
- **Validasi**: tsc 0 error, **491/491 test** (48 file; +19).

### 18.3 (🟠 TINGGI; offline: 🔴) — Shift & Expected Cash bersifat per-device

- **Lokasi**: `src/store/shiftStore.ts` — `activeShift` **tunggal global per store/device**, `openShift` **tanpa guard** (kasir kedua menimpa active shift device-nya), `closeShift` menerima `totalSales`/`expectedCash` dari **komputasi lokal** device.
- **Fakta**: kasir A & B buka shift di device masing-masing → dua shift berbeda; tiap device hanya tahu shift sendiri. **Expected cash tutup shift dihitung dari transaksi LOKAL device saja** → bila laci fisik dipakai bersama, cash difference **salah**. Riwayat shift lintas device tersedia (`loadFromCloud`), tapi **active shift tidak dibagikan** → laporan Shift Manager bisa menampilkan 2 shift "aktif" (kasus yang pernah dilaporkan user). **Offline**: makin tidak akurat (hanya lokal + queue belum flush).
- **Usulan fix**: (1) **1 shift aktif per outlet** (prioritas: shift pertama / kunci tanggal+device); (2) expected cash dari **semua transaksi Selesai tersinkron** (query cloud) bukan hanya lokal, dengan peringatan bila ada queue belum sync; (3) peringatan saat tutup shift bila masih ada "N belum sinkron" (tautkan badge O-5).

- **Status (v4.7 TO DO 18.3):** ✅ **SELESAI** — (1) guard **1 shift aktif per outlet**: `openShift` kini async + menolak bila sudah ada shift terbuka (lokal hasil `loadFromCloud` & verifikasi cloud `fetchShiftsFromCloud`; offline → diizinkan 1 per device), `resumeExistingShift()` untuk lanjut shift yang dibuka kasir lain, dan `loadFromCloud` me-restore **shift terbuka PALING AWAL** (siapa pun kasirnya) agar semua device menyatu ke shift yang sama. OpenShiftModal mendeteksi shift terbuka → banner **"Lanjutkan Shift Ini"** (tanpa input modal kas ulang) + audit log `resume_shift` (tipe ditambahkan di `AuditAction`). (2) **Expected cash dari semua transaksi Selesai tersinkron**: helper murni `computeShiftStats` (`src/utils/shiftStats.ts`) menghitung SEMUA kasir dalam window shift (bukan hanya lokal device), dipakai Layout; saat buka modal tutup shift, Layout **flush antrean + fetch ulang transaksi/shift/cash movements dari cloud** lalu muat ulang store. (3) **Peringatan belum sync**: banner kuning/merah di modal Tutup Shift saat masih ada "N belum tersinkron / gagal" + tombol **Kirim & Muat Ulang**. Cetak ringkasan shift juga window-based (semua kasir).
- **Fix bonus (ditemukan saat validasi, bug 18.2)**: pembanding tanggal `t.date.startsWith(todayStr)` SALAH untuk transaksi jam 00:00–07:00 WIB (`date` = ISO UTC, `today` = tanggal lokal) → floor nomor antrean & deteksi duplikat bisa meleset. Helper baru `toLocalDateKey()` dipakai di `localMaxQueueNumber`/`findDuplicateQueueNumbers`, `addTransaction`, normalisasi `loadFromCloud`, dan range query `fetchMaxQueueNumberCloud` (tengah malam lokal → ISO UTC).
- **Catatan**: shift terbuka ganda **legacy** (sudah terlanjur di cloud) tidak di-auto-close (menghindari fabrikasi data kas) — hanya shift paling awal yang diaktifkan + `console.warn`; tutup manual disarankan. Laporan Shift (Reports) tetap memakai nilai `expectedCash` tersimpan yang otoritatif.

### 18.4 (🟠 SEDANG) — Reserve stok SPLIT hanya diketahui device pembuat

- **Lokasi**: `src/utils/splitStockSession.ts` — sesi reserve di **localStorage per device** (`rempah-split-stock-session`).
- **Fakta**: kasir A memulai split (stok item di-reserve penuh di device A). Kasir B di device lain **tidak tahu** reserve itu → bisa menjual item yang sama → stok terpakai melebihi fisik (bagian dari kelas E2). Sesi split juga tidak bisa di-resume dari device lain. **Offline**: sama.
- **Usulan fix**: dokumentasikan batasan (split = sesi satu device) + warning UI "stok di-reserve hanya di device ini"; jangka panjang: simpan reserve sebagai transaksi status Pending/split-reserve di cloud.
- **Status (v4.7 TO DO 18.4):** ✅ **SELESAI** — batasan didokumentasikan di header `splitStockSession.ts` (reserve = localStorage device pembuat; split FRESH = sesi satu device; selesaikan di device yang sama; jangka panjang simpan reserve ke cloud sebagai Pending/split-reserve — belum dikerjakan). **Warning UI** di `SplitBillModal`: banner amber "**Stok item di-reserve hanya di device ini** — kasir lain di device berbeda tidak mengetahui reserve ini" via helper murni baru `isFreshSplitReserveActive(parentTx, session)` (hanya split FRESH; split PENDING tidak — stoknya sudah dipotong saat pending dibuat & terlihat lintas device). +3 test.

### 18.5 (🟢 AMAN, catatan kecil) — KDS / Dapur

- **Fakta**: `updateKitchenStatus` sync + realtime → kedua device melihat status sama; filter split (`splitParentId`/`splitIndex`, Prioritas 5.10) konsisten; tiket dapur dicetak di **printer masing-masing device** (tidak ada tiket ganda karena printer terpisah). **Offline**: perubahan status masuk offline queue (O-10 urutan kronologis) → flush saat online ✓. Alarm KDS (5 menit) & mute per-device (kosmetik).
- ✅ **SELESAI (v4.7) — REVIEW, tidak ada fix wajib**: catatan aman dikonfirmasi — status dapur last-write-wins (tidak saling mengunci), tiket dapur per-printer device (tidak ada tiket ganda), offline queue kronologis (O-10). Tidak ada perubahan kode yang diperlukan untuk item ini.

### 18.6 (🟢 AMAN setelah sync, catatan transisi) — Laporan & Akuntansi

- **Fakta**: `loadFromCloud` merge **by ID** + freshness compare (Prioritas 16) → **tidak ada transaksi ganda**; split sub-bill sudah dieksklusi dari double accounting (Prioritas 1.6/5.2); Rekap Kas memakai `cashierId` → Kas Masuk/Keluar per kasir akurat. **Catatan transisi**: sebelum sync, laporan lokal dua device berbeda (normal); offline → laporan device A tidak memuat penjualan device B sampai sync.
- ✅ **SELESAI (v4.7 TO DO 18.6)**: komponen **`SyncFreshnessBanner`** (`src/components/SyncFreshnessBanner.tsx`) — banner amber **"Laporan belum final — N transaksi belum tersinkron ke cloud (+M operasi lain dalam antrean sinkron)"** di header **Laporan (semua tab)** & **Dashboard**. Sinyal: (1) `unsyncedTx` dari mekanisme badge O-5 (`confirmedSyncIds`) — reaktif via zustand; (2) jumlah operasi antrean dibaca saat mount + interval 30 dtk + saat tab kembali terlihat (sengaja TIDAK memakai `setQueueChangeListener` — satu slot listener global dipegang Layout/O-4, akan saling menimpa). Logika murni `computeSyncFreshness` diuji unit (6 kasus: semua sync → tidak tampil; sebagian belum sync → tampil; tanpa transaksi → tidak tampil; antrean saja → tampil; campuran; Demo/Cancel ikut dihitung). Test **588/588**.

### 18.7 (🟢/🟠 MINOR) — Promo usage & Loyalty race

- **Lokasi**: `incrementUsage(promoId, customerId)` & `recordVisit`/poin loyalty.
- **Fakta**: **tanpa guard race** → dua kasir memakai voucher sama hampir bersamaan bisa **double-increment** (usage limit per pelanggan terlewati; voucher 1× per orang bisa lolos 2×).
- ✅ **SELESAI (v4.7 TO DO 18.8/E7)** — item ini superseded oleh eksekusi **E7** di blok 18.8: `reservePromoUsage` (cek dari store saat commit + ledger usageKeys id unik + increment atomik), replay guard efek samping (recordVisit/deductLoyaltyPoints), dan merge ledger UNION lintas device. Test **582/582**.

### 18.8 — Temuan A (ANALYSE.md) yang dieksekusi bertahap bersama E

> Ringkas (detail lengkap di `ANALYSE.md` Bagian A–C). Prioritas usulan: **A4 → A6 → A7/A8/A9/A10 → A1–A3 → E7**. Status: **A1 ✅ A2 ✅ A3 ✅ A4 ✅ A5 ✅ A6 ✅ A7 ✅ A8 ✅ A9 ✅ A10 ✅ A11 ✅ A12 ✅ A13 ✅ E7 ✅ — SELURUH TEMUAN A + E7 TUNTAS**.

- **A1 (🟢)** `skipStockDeduction` dead param — tidak ada caller; hapus/deprecate agar tidak menyesatkan (stok bisa bocor bila dipakai tanpa reserve).
  - ✅ **SELESAI (v4.7 TO DO 18.8/A1)**: param DIHAPUS dari `AtomicCheckoutParams` + cabang `if (params.skipStockDeduction)` di engine (branch kosong) dihapus — jalur delta `reservedDeductions` tetap satu-satunya cara melewati deduksi penuh (aman, ada reserve).
- **A2 (🟢)** `calculateItemDeductions` flag `hasSnapshot` global — hitung **per item** (snapshot per item, fallback legacy) agar campuran snapshot/legacy tidak kehilangan deduksi.
  - ✅ **SELESAI (v4.7 TO DO 18.8/A2)**: `hpp.ts` ditulis ulang **per item** (`continue` setelah snapshot; item tanpa snapshot → fallback menu+addons) — flag global dihapus. +6 test baru (`hpp.test.ts`): campuran snapshot/legacy KEDUANYA dihitung, snapshot murni (manual_ dikecualikan), legacy murni, snapshot kosong → fallback, addon, akumulasi.
- **A3 (🟢)** Rollback engine mengembalikan stok via `updateItem(skipLog)` → stock log 'deduct' tanpa 'add' balasan; pakai `revertStock(..., 'Rollback ...')`.
  - ✅ **SELESAI (v4.7 TO DO 18.8/A3)**: `executeRollback` menghitung delta dari snapshot (`original − current`) lalu memakai `revertStock(delta, 'Rollback transaksi gagal (stok dikembalikan)')` — log **'add'** balasan + sync bulk; `updateItem(skipLog)` tidak lagi dipakai untuk rollback. +2 test (`engineRollback.test.ts`): injeksi kegagalan di `addTransaction` → stok kembali 10 + log seimbang (deduct −2 → add +2, reason 'Rollback').
- **A4 (🟠 SEDANG)** Race **double-refund** — `isRefundableTransaction` memakai salinan render; fix: cek ulang `refunded` dari store + disable tombol saat processing.
  - ✅ **SELESAI (v4.7 TO DO 18.8/A4)**: helper murni `canExecuteRefund(tx, storeTransactions, hasSplitChildren, inFlight)` di `refund.ts` — cek ulang `refunded` dari STORE (bukan salinan render) + guard in-flight + split guard, mengembalikan target terbaru; `executeRefund` (Transactions.tsx) memakainya + `refundingRef`; tombol Konfirmasi ber-state **"Memproses…"** (disabled) & tombol Refund row disabled saat PIN pending/processing. +6 test (`canExecuteRefund`: klik kedua cepat → null, fallback store bersih, in-flight, split).
- **A5 (🟠 SEDANG)** Race sync stok burst multi-device — `syncInventoryStock` mengirim nilai pasca-mutasi; urutan network bisa tertukar → cloud stale lebih tinggi; pertimbangkan `updated_at` inventory / normalisasi dari stock log.
  - ✅ **SELESAI (v4.7 TO DO 18.8/A5 — last-write-wins)**: kolom `updated_at` sudah ada di CREATE TABLE inventory + **Migration 29** (ALTER idempoten + flag `inventoryUpdatedAt`). `InventoryItem.updatedAt` + helper murni `isLocalNewer` (`src/utils/inventoryFreshness.ts`): semua mutasi stok stamp `updatedAt`; payload sync (`syncInventoryItem`/`syncInventoryStock`/fallback absolut) kirim `updated_at`; `fetchInventoryFromCloud` baca `updated_at`; `loadFromCloud` **LWW per item** (lokal lebih baru → dipertahankan, versi cloud yang kalah tidak di-merge anti duplikat; legacy tanpa timestamp → cloud otoritatif). RPC atomik 18.1 tetap menutup lost-update online. **SOP cek stok pagi tetap disarankan** (fallback absolut tetap LWW-by-time). +15 test.
- **A6 (🟠 SEDANG)** `computeCartSignature` tidak menyertakan **harga add-on & kuantitas** → deteksi "cart sama" bisa salah (split session tidak dilepas → **double deduction**; pendingItemsChanged minor). Perluas signature + test.
  - ✅ **SELESAI (v4.7 TO DO 18.8/A6)**: signature kini menyertakan **harga add-on** (`a.name:a.price`; add-on tidak punya qty di model). Helper `cartSignatureMatches(stored, items)` mencocokkan format baru ATAU **legacy** (sesi tersimpan pra-18.8 — PWA auto-update di tengah sesi tidak boleh membuat reserve tidak ter-release → double deduction) — dipakai di `releaseSplitReserveForCart`, efek deteksi cart berubah & rehydrate di SplitBillModal. +5 test.
- **A7 (🟡 INFO)** Split dari pending: sub-bill dapat nomor antrean **BARU** per sub-bill (N nomor) vs split fresh 1 nomor — seragamkan / dokumentasikan.
  - ✅ **SELESAI (v4.7 TO DO 18.8/A7)**: seragamkan **1 pesanan = 1 nomor** — `resolveSplitQueueNumber` (split pending → nomor PARENT; fresh → nomor sesi) dipakai di `overrideQueueNumber`; `findDuplicateQueueNumbers` mengecualikan sub-bill split (fix false-positive latent split fresh). +5 test.
- **A8 (🟡 INFO)** Pending split delta-0 mengasumsikan item sub-bill == parent; bila bisa diedit → stok bocor; verifikasi/guard.
  - ✅ **SELESAI (v4.7 TO DO 18.8/A8)**: cart tidak dikunci (edit sebelum split diizinkan) — **rekonsiliasi reserve SEKALI per parent** saat sub-bill pertama dibayar: `computePendingSplitReconcile` (item dihapus → revert, ditambah → deduct) + toast info; idempoten & tanpa double-adjust. +5 test.
- **A9 (🟡 INFO)** Cancel parent pending beranak split tidak revert bagian belum lunas — void sub-bill satu per satu (perlu SOP).
  - ✅ **SELESAI (v4.7 TO DO 18.8/A9)**: **SOP void satu per satu** — toast peringatan jelas saat void transaksi ber-anak split di Transactions.tsx (alur sekali-klik revert gabungan sengaja TIDAK dibuat — risiko double-revert & fabrikasi data).
- **A10 (🟡 INFO)** Tiket dapur bisa hilang saat resume item sama + printer gagal saat Simpan Pending — tambah `kitchenTicketPrintedAt`.
  - ✅ **SELESAI (v4.7 TO DO 18.8/A10)**: engine men-stamp **`kitchenTicketPrintedAt`** HANYA bila tiket dapur benar-benar sukses (`didKitchenPrintSucceed` di `triggerPostCommitTasks`; printer gagal → tidak di-stamp). Helper murni `shouldSkipKitchenPrintAtResume` (`src/utils/kitchenTicket.ts`) dipakai di default modal checkout (POS `handleCheckoutCb` & `proceedCheckoutAnyway`): item berubah → cetak ulang; item sama & sudah cetak → skip (anti dobel); item sama & **belum pernah cetak** → **cetak ulang** (tiket tidak hilang). Kolom `kitchen_ticket_printed_at` (schema.sql + ALTER idempoten) + **Migration 30** (probe + flag) + mapping `syncTransaction`/`syncTransactionMeta` (lintas device). +9 test (`kitchenTicketPrint.test.ts`). Test **566/566**.
- **A11 (🟢)** Validasi/dedukt stok diam-diam melewati id bahan yang sudah dihapus — tambah warning.
  - ✅ **SELESAI (v4.7 TO DO 18.8/A11)**: `InventoryEngine.validateStockAvailability` melaporkan bahan resep yang sudah dihapus sebagai warning `missing: true` (checkout terblokir sementara, bisa "Lanjutkan Tetap") + pesan khusus di modal peringatan stok POS. +2 test.
- **A12 (🟢)** `lastNegativeStockAlerts` di-reset oleh revert apa pun — kosmetik.
  - ✅ **SELESAI (v4.7 TO DO 18.8/A12)**: `revertStock` hanya membersihkan alert bila revert benar-benar mengeluarkan item dari negatif; item masih negatif dipertahankan (stok terbaru). +3 test.
- **A13 (🟡 INFO)** Demo tidak punya jalur pembuatan (hanya transisi Selesai→Demo) — keputusan produk.
  - ✅ **SELESAI (v4.7 TO DO 18.8/A13 — keputusan: dibuat)**: tombol **"Catat sebagai Demo (tidak memotong stok)"** di modal checkout POS — engine `overrideTxStatus: 'Demo'` **tanpa potong stok**, **queueNumber 0** (tidak konsumsi nomor antrean), `suppressAutoPrint`, tanpa kunjungan/promo/loyalty; Riwayat menampilkan **DEMO** (bukan #0) + pencarian "demo". Konversi Demo→Selesai tetap deduct stok (8.1). +3 test.
- **E7 (🟢/🟠)** Promo usage & loyalty race lintas kasir.
  - ✅ **SELESAI (v4.7 TO DO 18.8/E7)**: **`reservePromoUsage(id, customerId, usageKey)`** — cek batas (global & per pelanggan) dari **STORE saat commit** + increment **atomik** (functional set) + **ledger `usageKeys` id unik transaksi** (replay idempoten tidak double-increment); **replay guard efek samping** di POS finalize (`recordVisit`/`deductLoyaltyPoints`/usage hanya jalan bila `!idempotentReplay` — fix kunjungan ganda & poin terpotong 2× saat double-click); **merge ledger UNION lintas device** di `loadFromCloud`; POS & SplitBillModal pakai `reservePromoUsage(subTx.id)` + toast bila batas tercapai. Residual: 2 device offline hampir bersamaan tetap bisa lolos (LWW) — RPC counter opsional (pola 18.2). +8 test (`promoStoreUsage.test.ts`).

## 🔵 PRIORITAS 19 — MULTI OUTLET / CABANG (Analisa kesiapan, v4.7 — BELUM DI-EKSEKUSI)

> **Sumber analisa**: `ANALYSE.md` Bagian F. Fitur ini **belum ada di project** — seluruh aplikasi berjalan single outlet implisit `'default'` (tabel global tanpa `outlet_id`, RLS "Allow all for anon", settings satu baris, user tanpa cabang). Dikerjakan **bertahap**: Fase 1 (fondasi data) → Fase 2 (aplikasi/sync) → Fase 3 (nilai enterprise). Sebelum mulai, ambil **keputusan produk F.1** (model master data: independen vs pusat→cabang vs hibrida — rekomendasi: **independen** untuk MVP).

### 🎯 Keputusan produk yang harus diambil dulu (F.1)

- [ ] **F.1a** Model master data: independen per cabang / pusat→cabang / hibrida.
- [ ] **F.1b** Akses user: 1 cabang (Kasir/Staf Gudang) vs lintas cabang (Manager/Owner); tambah role **Owner** (saat ini hanya Manager/Kasir/Acaraki/Staf Gudang).
- [ ] **F.1c** Identitas outlet: id + nama + alamat + **settings per outlet** (nama toko struk, alamat, footer, pajak, kategori, printer — tiap cabang beda hardware & pajak).
- [ ] **F.1d** Nomor antrean: restart harian per cabang (perilaku sekarang, tinggal plumb `outlet_id` asli).
- [ ] **F.1e** Loyalty/promo lintas cabang: shared (pelanggan sama) vs per cabang.

### 🔴 Fase 1 — Fondasi Data (migrasi, satu arah)

- [ ] **19.1 (KRITIS)** Kolom `outlet_id` di SEMUA tabel bisnis (`transactions`, `inventory`, `menus`, `menu_components`, `customers`, `promos`, `shifts`, `stock_logs`, `stock_opnames`, `cash_movements`, `audit_logs`) + **backfill idempoten** ke `'default'` (outlet pertama) — pola Migration 27–30 (probe + ALTER/UPDATE + console warning).
- [ ] **19.2 (TINGGI)** `settings` jadi per-outlet (row per `outlet_id` / ganti PK `id=1`) + migrasi nilai row 1 → outlet `'default'`.
- [ ] **19.3 (TINGGI)** `users.outlet_id` (atau `users_outlets` untuk multi-assignment) + tambah role `Owner` pada CHECK constraint.
- [ ] **19.4 (KRITIS)** **RLS per-outlet** menggantikan "Allow all for anon": helper `current_outlet_id()` (JWT claim / header) + policy `USING (outlet_id = current_outlet_id())` per tabel (termasuk `settings`, `queue_counters`, `stock_logs`, `audit_logs`). ⚠️ Titik paling sensitif: salah policy = bocor data cabang lain ATAU data hilang dari pandangan (device lama harus tetap jalan — ship setelah semua store konsisten mengirim `outlet_id`).

### 🟠 Fase 2 — Aplikasi & Sync

- [ ] **19.5 (TINGGI)** `currentOutlet` di auth store: pilih cabang saat login + **switch outlet** untuk Manager/Owner + guard halaman per cabang.
- [ ] **19.6 (KRITIS)** Scope sync per outlet: semua `fetch*FromCloud` + realtime (`outlet_id=eq.<id>`) + offline queue payload membawa `outlet_id` + `loadFromCloud` filter; tombstone & freshness compare (`updatedAt`) per outlet.
- [ ] **19.7 (TINGGI)** `allocateQueueNumberCloud` kirim `outlet_id` asli (hapus hardcode `'default'` di `src/lib/cloudSync.ts:737`); guard shift 1-per-outlet pakai id asli; engine stamp `Transaction.outletId` (placeholder sudah ada di tipe).
- [ ] **19.8 (TINGGI)** Laporan (Penjualan/PPN/Promo/Refund/Shift/Kas) & Dashboard **filter per outlet**; struk termal & digital pakai `store_name`/alamat per cabang; label nama cabang di header.
- [ ] **19.9 (SEDANG)** Halaman Settings: pilih cabang yang dikonfigurasi (Manager) — pajak, kategori, printer, tabel, struk per cabang.
- [ ] **19.10 (SEDANG)** Backup/Restore: manifest menyimpan `outlet_id`; **restore per cabang** (tidak menimpa cabang lain); auto backup per cabang.

### 🟡 Fase 3 — Nilai Enterprise (setelah Fase 1–2 stabil)

- [ ] **19.11** Transfer stok antar cabang (stock transfer + log khusus).
- [ ] **19.12** Laporan konsolidasi multi-cabang untuk Owner (gabungan vs per cabang).
- [ ] **19.13** Master data push pusat→cabang — **desain rekomendasi di `ANALYSE.md` F.5** (id master data **deterministik dari pusat**, definisi bahan shared + `stock` lokal, **Opsi A read-only catalog** di cabang → konflik nol by construction):
  - [ ] **19.13a** Kolom `source` + `updated_at` di `menus`/`menu_components` (+ `source` di `inventory`); `menus.updated_at` & `menu_components.updated_at` belum ada (pola A5/Migration 29).
  - [ ] **19.13b** **Watermark pull** saat reconnect cabang: `fetch ... WHERE updated_at > last_catalog_sync` + merge LWW; toast "Katalog diperbarui dari pusat (N menu)"; realtime + filter `outlet_id`.
  - [ ] **19.13c** Guard UI read-only di cabang (Opsi A): field master (nama/harga/resep/bahan) disabled + label "Dikelola pusat"; hanya `stock`/`min_stock`/`is_available` yang lokal.
  - [ ] **19.13d** Soft-disable menu (is_available=false + tombstone O-8) — JANGAN `DELETE` (CASCADE `menu_components` merusak resep); bulk push via RPC `push_catalog_batch` / pull-based untuk skala besar.
  - [ ] **19.13e** (Lanjutan, bila cabang butuh harga/menu beda) **Opsi B override per-field**: `source`/`branch_override` + merge rule (cabang menang bila lebih baru & di-flag, pusat menang selain itu) + UI deteksi/resolusi konflik.
  - [ ] **19.13f** Keputusan `cost_per_unit`: di-push (HPP sama) vs per cabang (rekomendasi: **per cabang** — biaya bahan beda per daerah).
  - [ ] **19.13g** Skema id deterministik — **desain di `ANALYSE.md` F.6**: UUID v5 (`v5(NAMESPACE_tipe, key)`, paket `uuid` sudah ada) — id **immutable**, `key` = identitas dedupe (SKU prioritas / slug fallback); kreasi offline di cabang menghasilkan id SAMA dengan pusat → tanpa duplikat; referensi `menu_components.child_id`/`ingredients` stabil lintas cabang offline.
  - [ ] **19.13h** Adopsi item legacy (key sama, id beda) — **desain lengkap di `ANALYSE.md` F.7**:
  - [ ] **19.13h1** Tabel **`item_identity`** (item_id PK, key, kind menu/inventory, canonical_id NULL=kanonik, outlet_id, adopted_at; unique (key,kind); invariant: canonical satu arah TANPA rantai) + `resolveRef(refId)=COALESCE(canonical_id,item_id)` untuk lookup histori/sesi lama.
  - [ ] **19.13h2** **Rewrite aktif terkontrol** (BUKAN rewrite historis): kunci `menus.ingredients` & `AddOn.ingredients` A→B + `menu_components.child_id` A→B (urut child→parent untuk bundle); **guard**: tolak saat cart/split reserve **/ opname aktif** memakai item (eksekusi di luar jam operasional + backup dulu — reuse backupService). **Aturan gabung stok di `ANALYSE.md` F.8** (stok PER CABANG — tidak ada gabung lintas cabang; hanya dalam satu cabang):
  - [ ] **19.13h2a** **Klasifikasi gabung**: otomatis bila `B.stock=0` atau `A.stock=0` (tidak konflik); **manual** (dialog per item: gabung / pindah nominal / jadikan item terpisah-tidak di-adopt) bila **keduanya > 0** (potensi key-collision palsu) atau stok A negatif/aneh.
  - [ ] **19.13h2b** Tulis stok gabungan via **RPC delta** `adjust_inventory_stock(B, +A.stock)` (bukan set absolut — anti double-count saat 2 device cabang sama adopsi bersamaan, pola 18.1).
  - [ ] **19.13h2c** **Riwayat stock log A dibiarkan utuh** + entry adopsi di kedua sisi (B: `type:'add'` amount +A.stock reason "Adopsi katalog pusat: gabung stok dari {A}"; A: `type:'adjust'` stockAfter 0 "Di-adopsi ke {B}"); UI riwayat B via resolve-at-read sertakan log A dengan label "sebelum adopsi" (atau cukup entry adopsi — keputusan UX).
  - [ ] **19.13h2d** **Dampak opname**: guard tolak adopsi saat opname AKTIF (systemStock A menjadi −5 palsu bila adopsi di tengah opname — laporan loss bingung); opname historis & lossValue (costPerUnit tersimpan) TIDAK berubah.
  - [ ] **19.13h2e** **Dialog gabung manual** — **spesifikasi lengkap di `ANALYSE.md` F.9**: list per item (bukan wizard) + 3 opsi radio (Gabung stok default / Pindah sebagian dengan input nominal X → A tetap hidup ber-key baru `{slug}-lokal` / Jadikan terpisah → A tidak di-adopt + key baru); role-gate Manager/Owner (PIN 10.2); guard disabled saat opname/cart/split reserve aktif; backup otomatis (backupService) + idempoten via item_identity + in-flight guard (pola A4); toast ringkasan per aksi; tanpa undo (restore via backup).
  - [ ] **19.13h2f** **Pratinjau dampak live**: stok sebelum→sesudah per opsi; jumlah menu terdampak (rewrite refs); **dampak HPP** (cost A ≠ B → delta Rp per menu via `hpp.ts:17`/`calculateBundleHPP`, menu manualHpp dicatat tidak terpengaruh); **banner amber key-collision** bila cost selisih >10% / nama beda / stok A > 2× B / A punya riwayat penjualan — tombol "Periksa manual" (buka form edit berdampingan), item flagged tercatat di audit log; helper murni `previewAdoption(item, option, x)` untuk unit test.
  - [ ] **19.13h2g** **Alur batch otomatis** — **desain di `ANALYSE.md` F.10**: pre-flight guard + backup otomatis (simpan `backupId`) + rencana batch disimpan sebelum eksekusi; eksekusi berurutan per item (idempoten via item_identity); kegagalan per item tidak membatalkan batch (best-effort, retry idempoten); **verifikasi pasca-batch** (item_identity == dieksekusi, stok B == awal+Σdelta, scan sisa refs aktif menunjuk A → warning).
  - [ ] **19.13h2h** **Toast ringkasan & audit log** — toast via `toastStore` (sukses hijau/sebagian amber/gagal merah + tombol "Lihat Audit"; ringkasan selalu menyebut jumlah per aksi); **action baru `'catalog_adopt'`** di `AuditAction` + filter dropdown Audit Log (`AuditLog.tsx:53`); **1 entry batch** (metadata: outletId, mode, backupId, counts, verified, remainingRefs, items[] A→B/opsi/delta) + **1 entry per-item hanya untuk flagged/gagal** (mudah dicari); audit tersync ke cloud (`syncAuditLog`) → terlihat lintas device; opsional blok "Riwayat Adopsi Terakhir" di Settings.
  - [ ] **19.13h3** **Tombstone A** (`is_available=false` + deletedLocalIds O-8) — JANGAN DELETE (histori & refs lama tetap valid); snapshot transaksi/log/opname lama dibiarkan (nama tersimpan → laporan normal, lookup by-id via resolveRef).
  - [ ] **19.13h4** Sesi lama (`splitStockSession`/keranjang pra-adopsi) di-reconcile via resolve-at-read; pusat menulis `item_identity` saat adopsi → cabang terima via realtime/watermark (resolve konsisten lintas device).
  - [ ] **19.13h5** Item murni lokal (tidak ada di pusat) **tidak di-adopt** — tidak disentuh; estimasi ~4–5 file + ~10 test (invariant rantai, resolve, rewrite menu/bundle, guard sesi aktif, gabung stok).
  - [ ] Pelanggan & loyalty lintas cabang (bila shared) — putuskan di F.1e.
- [ ] **19.14** Permission granular per outlet per role (Kasir cabang A tidak melihat cabang B).

### ✅ Yang SUDAH siap memudahkan (F.3)

- `queue_counters.outlet_id` + RPC `allocate_queue_number(p_outlet)` — fondasi antrean per cabang **sudah ada**.
- Konsep "1 shift aktif per outlet" & `computeShiftStats` (18.3) — tinggal plumb id outlet.
- `Transaction.outletId` placeholder — tinggal diisi engine.
- Offline queue, tombstone, freshness compare, RPC atomik, backup manifest — semua bisa di-scope per outlet tanpa mengubah mekanisme.

### ⚠️ Risiko & catatan (F.4)

- **RLS per-outlet** paling sensitif (lihat 19.4).
- **Satu device = satu outlet aktif** (tanpa multi-tab cabang) — keputusan: logout/login untuk pindah cabang.
- Realtime per cabang via filter (bukan global) — hemat bandwidth & privasi.
- KDS/dapur: tiket hanya keluar di printer cabang yang sama.
- Estimasi dampak: ~25–35 file (types, schema, cloudSync, auth, semua store filter, layout/login, settings, laporan, backup) + ~15–20 test baru — kerjakan bertahap dengan satu migration besar di awal.

---

## 🔴 PRIORITAS 20 — AUDIT FITUR EKSISTING PASCA-PRIORITAS 18 (Analisa, v4.7)

> **Sumber audit**: audit menyeluruh fitur yang sudah ada (baseline 588/588 test hijau). Detail lengkap: `ANALYSE.md` Bagian G.

### Temuan

- [x] **20.1 (🟠 SEDANG) — `computeShiftStats` tidak mengecualikan transaksi refunded** (`src/utils/shiftStats.ts:46-51`): `shiftTx` menyertakan `t.refunded` → **Total Penjualan & Total Transaksi di ringkasan tutup shift overstated** saat ada refund (Dashboard/Reports/Transactions sudah exclude `!refunded` — inkonsisten).
  - ✅ **SELESAI (v4.7 TO DO 20.1)**: `salesTx = shiftTx.filter(t => !t.refunded)` menjadi basis laporan (`totalSales`/`totalTx`/`cashSales`/`qrisSales`/`transferSales`); field baru **`refundedCashSales`** (sale tunai yang di-refund dalam window) di-**add-back** ke formula expected cash → netting tetap netral (sale refunded + movement 'out' Refund saling meniadakan; meng-exclude dari cashSales TANPA add-back akan double-subtract → `opening − refund`). UI: baris **"Refund Tunai (Dikembalikan)"** ditampilkan di modal tutup shift & struk ringkasan bila > 0 (Layout.tsx) agar angka bersih bisa dijelaskan.
  - **Residual terdokumentasi**: kasus silang metode pembayaran (sale tunai di-refund via QRIS → movement 'out' tetap dicatat padahal uang tidak keluar laci → expectedCash understated; hasil identik dengan perilaku lama — TIDAK regresi). Fix penuh butuh field **metode refund** (`refundMethod`) di transaksi + movement (enhancement, bukan bug aktif).
  - **Test (+5)** di `shiftStats.test.ts`: refund tunai → totalSales/totalTx bersih & expectedCash net 0 (`opening`); campuran sale aktif + refunded; refund sale QRIS dari laci → expectedCash `opening − refund`; lintas metode → tidak regresi; refunded tanpa movement → tidak double-count. Test **593/593** (56 file).

- [x] **20.2 (🟢 MINOR/UX) — `alert()` tersisa di halaman non-printer** (~15 titik): `AuditLog.tsx:68/70`, `CashMovements.tsx:158/243`, `Catalog.tsx:537/599`, `SettingsPage.tsx:82/98/175/252/276/303/328/793`, `App.tsx:190` — inkonsisten dengan konvensi toast (Prioritas 14.6 baru menyentuh alur printer). Migrasi `alert()` → `useToastStore().addToast` di halaman-halaman tersebut.
  - ✅ **SELESAI (v4.7 TO DO 20.2)**: **21 `alert()` → toast** (5 file target + **4 temuan tambahan** yang terpotong scan awal): `App.tsx` (warning, via `useToastStore.getState()` di callback subscription), `AuditLog.tsx` (success/warning clear logs), `CashMovements.tsx` (warning nominal ≤ 0 ×2), `Catalog.tsx` (error foto / warning komponen), `SettingsPage.tsx` (10 titik: warning validasi pajak/meja/file/username/shift aktif + success simpan/tema/PIN), **`StockOpname.tsx`** (warning isi item/alasan + success simpan), **`authStore.ts`** (warning session takeover, via getState). `window.confirm` sengaja dipertahankan (bukan target). Kode produksi **0 `alert()` tersisa**. Test **593/593** (56 file).

- [x] **20.3 (🟢 MINOR/UX) — `window.confirm` tersisa (4 titik) → ConfirmDialog** (audit lanjutan konfirmasi UX): `Layout.tsx:826` (tutup shift selisih kas > 10%), `PendingPaymentsModal.tsx:88` (void pending), `POS.tsx:279` (resume pending saat keranjang berisi), `SettingsPage.tsx:1562` (hapus user).
  - ✅ **SELESAI (v4.7 TO DO 20.3)**: semua diganti **ConfirmDialog** (komponen kustom dengan Modal + ikon + tombol Batal/Ya) — UX konfirmasi seragam di seluruh aplikasi. `Layout` reuse pola `confirmState` yang sudah ada; `PendingPaymentsModal`/`POS`/`SettingsPage` tambah state target + render ConfirmDialog. Perilaku sama (batal = tidak ada aksi; ya = aksi lama); label & pesan dipertahankan. **Kode produksi 0 `window.confirm` & 0 `alert()` tersisa.** Test **593/593** (56 file).

- [x] **20.4 (🟠 SEDANG) — Filter tanggal CUSTOM di Laporan & Riwayat Transaksi memakai UTC untuk tanggal AWAL** (audit agregasi Laporan/Dashboard): `new Date(customDateFrom)` dengan format `"YYYY-MM-DD"` (tanpa `T`) di-parse sebagai **UTC tengah malam = 07:00 WIB** → transaksi **00:00–07:00** pada tanggal awal **tidak masuk** range custom; sementara `new Date(customDateTo + 'T23:59:59')` di-parse **lokal** → inkonsisten.
  - **Titik**: `Reports.tsx:101` (`filteredTx`), `Reports.tsx:139` (`dateFrom` untuk tab opname/movement), `Transactions.tsx:153`.
  - **Kelas bug sama dengan fix 18.3** (pagi buta — `toLocalDateKey` di queueNumber/transactionStore/cloudSync) **tapi Reports/Transactions filter custom terlewat** — dampak nyata untuk outlet buka 24 jam/pagi buta: laporan custom tanggal awal kehilangan transaksi dini hari.
  - ✅ **SELESAI (v4.7 TO DO 20.4)**: tambah helper murni **`buildCustomDateRange(fromStr, toStr)`** di `src/utils/format.ts` — parse **lokal** `from = 'T00:00:00'`, `to = 'T23:59:59.999'` (fallback epoch/now); dipakai di 3 titik (Reports `filteredTx` + `dateFrom` opname/movement, Transactions filter custom). Test **`dateRange.test.ts` (+5)**: start = lokal midnight di zona waktu mana pun, transaksi **03:00 lokal tanggal awal MASUK range** (regresi utama G-3), transaksi 23:59:59.500 hari akhir masuk, sebelum/ sesudah ter-exclude, fallback kosong. Validasi: `tsc` 0 error, **598/598** (57 file).

### ✅ Yang diperiksa & dinyatakan AMAN (jangan diubah)

- **Mesin diskon promo** (`discountEngine.ts` + `promoDiscount.ts`): stacking vs eksklusif auto best-deal, cap subtotal di semua mode, BOGO gratis dari unit termurah — terpusat & teruji.
- **`promoAmount` yang direkam di transaksi memakai nilai TER-APLIKASI (capped)** (`discountCalc.promoApplied`) — laporan performa promo akurat (fixed promo > subtotal tidak overstate).
- **Refund flow** (`refund.ts` + `Transactions.tsx`): guard anti double-refund A4, revert stok via `calculateItemDeductions`, revert kunjungan, Kas Keluar 'Refund', sync `refunded` ke cloud, audit log — solid.
- **Auto-kirim struk WA** (`POS.tsx:803-923`): guard `!result.idempotentReplay` (tidak kirim ganda), pre-open window popup blocker, hanya transaksi baru; tanpa pelanggan/HP tidak pre-open.
- **Dashboard & Reports** filter konsisten `txStatus==='Selesai' && !splitParentId && !refunded`; laporan PPN & promo memakai `filteredTx` yang sudah exclude refunded.
- **`catch {}`** di cloudSync/printer/shift semuanya intentional fallback (offline) — bukan swallow error.
- **Baseline**: `npx vitest run` → **588/588 test hijau** (56 file), tsc 0 error.

---

## ✅ YANG SUDAH BENAR (jangan diubah)

- **Atomic Engine**: rollback engine, snapshot resep/HPP permanen, error isolation printing, validasi all-or-nothing — solid untuk alur normal.
- **Offline Queue**: self-healing strip kolom, dedup, sorting dependensi — desain baik.
- **KDS**: filter `Selesai` + `Pending` sudah sesuai ROADMAP; alert 5 menit + mute + auto-reconnect bekerja.
- **Shift & expected cash**: hanya menghitung transaksi `Selesai` → pending tidak mencemari laci kas.
- **Printer Device Registry** (v4.0) + status banner polling 3 detik: rapi.
- **Queue number**: pending ikut mengonsumsi nomor antrean; `loadFromCloud` menangkal duplikasi lintas device.

---

## 🔴 PRIORITAS 21 — AUDIT FLOW PENDING + TAMBAH ITEM + SPLIT BILL (Analisa, v4.7)

> **Sumber audit**: `src/pages/POS.tsx` (handleSavePending, handleResumePendingOrder, finalize), `src/components/SplitBillModal.tsx` (finalizeSplitParent, computePendingSplitReconcile), `src/utils/kitchenTicket.ts` (shouldSkipKitchenPrintAtResume), `src/lib/atomicTransactionEngine.ts` (delta stok).

### ✅ 21.1 (🟠 SEDANG) — Tiket Dapur Cetak Ulang SEMUA Item Saat Finalisasi Pending yang Diedit

- **Kondisi**: Kasir resume pending → tambah 1 item → bayar (finalisasi)
- **Masalah**: `overrideKitchenStatus: pendingItemsChanged ? 'Waiting' : ...` → tiket dapur dicetak ULANG untuk SEMUA item (4 item), bukan hanya item baru (1 item)
- **Dampak**: Dapur menerima tiket dobel untuk 3 item yang sudah selesai/diantar
- **Fix diterapkan (v4.7)**: 
  - `AtomicCheckoutParams` dapat `deltaKitchenItems?: CartItem[]`
  - `atomicTransactionEngine.ts`: jika `deltaKitchenItems` ada, cetak tiket HANYA item baru (`receiptData.items = deltaKitchenItems`)
  - `POS.tsx`: hitung `deltaKitchenItems = cart.items.filter(ci => !parentTx.items.some(pi => pi.lineId === ci.lineId))` saat finalisasi pending dengan `pendingItemsChanged = true`
  - Test `kitchenTicketPrint.test.ts`: 4 test case baru (filtering item baru, tanpa parentTx, items sama, qty berubah)
- **Status**: ✅ SELESAI — tsc 0 error, 602/602 test (57 file)

### ✅ 21.2 (🟠 SEDANG) — Tiket Dapur Dobel Saat Split dari Pending

- **Kondisi**: Split bill dari pending yang sudah ditambah item
- **Masalah**: `skipSplitKitchen` default = false → tiket dapur dicetak lagi untuk semua item di sub-bill (meski sudah tercetak saat Simpan Pending)
- **Dampak**: Dapur menerima tiket dobel untuk item yang sama
- **Fix diterapkan (v4.7)**:
  - `SplitBillModal.tsx`: `setSkipSplitKitchen(!!parentTx)` saat modal dibuka konteks baru — split dari pending otomatis skip tiket dapur
  - Split fresh tetap cetak tiket dapur (`parentTx = null → skipSplitKitchen = false`)
- **Status**: ✅ SELESAI — tsc 0 error, 602/602 test (57 file)

### ✅ 21.3 (🟡 SEDANG) — Rekonsiliasi Ganda: Pending + Split

- **Kondisi**: Kasir resume pending → tambah item → buka Split → bayar sub-bill pertama (rekonsiliasi jalan) → tutup Split → bayar normal (finalisasi pending)
- **Masalah**: Rekonsiliasi stok bisa jalan 2x (SplitBillModal line 368 + POS.tsx line 816-822)
- **Dampak**: Toast误导 ("stok disesuaikan" 2x), meski idempoten tidak merusak data
- **Fix diterapkan (v4.7)**: 
  - `SplitBillModalProps` dapat `onReconcile?: () => void`
  - `SplitBillModal`: panggil `onReconcile?.()` setelah rekonsiliasi stok selesai
  - `POS.tsx`: state `pendingSplitReconciled` — jika true, `reservedDeductions = undefined` saat finalisasi pending (skip delta engine)
  - Reset `pendingSplitReconciled = false` saat `onCompleteSplit` (selesai split)
- **Status**: ✅ SELESAI — tsc 0 error, 602/602 test (57 file)

### ✅ 21.4 (🟢 MINOR) — Indikator Visual Pending yang Diedit

- **Kondisi**: Tidak ada badge/indikator di PendingPaymentsModal yang menunjukkan "ada item baru ditambahkan"
- **Dampak**: Kasir mungkin lupa bahwa pesanan sudah diedit sebelumnya
- **Fix diterapkan (v4.7)**:
  - Badge **"✓ Diupdate"** (biru) muncul di kartu pending jika `updatedAt > date + 5 detik` — deteksi otomatis tanpa field tambahan
  - Reset saat `onCompleteSplit` agar tidak tampil di sesi berikutnya
- **Status**: ✅ SELESAI — tsc 0 error, 602/602 test (57 file)

### ✅ 21.5 (🟠 SEDANG) — KDS: Tidak Ada Indikator "UPDATED" Saat Pesanan Selesai Ditambah Item

- **Sumber**: `src/pages/Kitchen.tsx` (filter, `isOverdue`, rendering kartu), `src/pages/POS.tsx` (overrideKitchenStatus)
- **Kondisi**: Pesanan sudah "Done" di KDS → pelanggan tambah item → `kitchenStatus` reset ke `Waiting` → pesanan MUNCUL LAGI di kolom "Antrean Menunggu" **tanpa badge/tanda bahwa ini UPDATE, bukan pesanan baru**
- **Masalah 1 — Tidak ada indikator UPDATED**: Dapur tidak tahu pesanan ini sudah pernah diproses → bisa proses ulang item lama yang sudah diantar
- **Masalah 2 — Semua item ditampilkan tanpa highlight**: KDS menampilkan SEMUA item (3 lama + 1 baru) tanpa menandai mana yang BARU → dapur bingung harus proses yang mana
- **Masalah 3 — Waktu antrean salah**: `isOverdue` dihitung dari `order.date` (waktu awal pesanan), bukan waktu update → pesanan bisa langsung muncul "overdue" meski baru diupdate beberapa detik lalu
- **Masalah 4 — Clear KDS tidak konsisten**: Jika kasir sudah clear pesanan lama (`lastKdsClearTime`), pesanan update muncul lagi di "Waiting" tanpa notifikasi "Pesanan diperbarui"
- **Dampak**: Dapur kebingungan, proses ulang item lama, atau mengabaikan item baru karena mengira itu pesanan lama
- **Fix diterapkan (v4.7)**:
  - (a) **Badge "🔄 Diupdate"** (biru) di kartu KDS saat `isUpdatedOrder()` (deteksi via `updatedAt > date + 5 detik`) — menandai pesanan yang di-update
  - (b) **Background kartu biru** untuk pesanan update (`bg-blue-50/60 border-blue-300`) — visual distinction dari pesanan baru
  - (c) **`isOverdue` & `getWaitingMinutes` dari `updatedAt`** untuk pesanan update — timer restart saat order muncul kembali di KDS
  - (d) **Catatan "🔄 Pesanan diperbarui — periksa item baru di atas"** di bawah daftar item
  - (e) **Label waktu "X mnt (sejak update)"** untuk pesanan update yang belum overdue
- **Status**: ✅ SELESAI — tsc 0 error, 602/602 test (57 file)

### ✅ Yang Sudah Benar (jangan diubah)

- **Delta stok pending**: `calculateItemDeductions` membandingkan parentTx.items vs cartItems → hanya selisih yang dipotong/dikembalikan
- **Rekonsiliasi split pending**: `computePendingSplitReconcile` adjust stok SEKALI saat sub-bill pertama dibayar, idempoten via `reconciledPendingSplitRef`
- **Tiket dapur resume**: `shouldSkipKitchenPrintAtResume`: items berubah → cetak ulang; items sama & sudah cetak → skip; items sama & belum cetak → cetak
- **Nomor antrean split pending**: `resolveSplitQueueNumber(parentTx, ...)` pakai nomor parent (seragam)
- **Finalize parent**: `finalizeSplitParent` update status parent → 'Selesai' + paymentMethod mayoritas
- **Anti double deduction**: `reconciledPendingSplitRef` idempoten — rekonsiliasi hanya sekali per parent

---

## 🎯 Urutan Eksekusi yang Disarankan

1. **DB layer dulu** (1.2) — tanpa ini, fitur lain tidak bisa sync lintas device.
2. **Alur pending inti** (1.1, 1.3, 1.4) — akses UI + finalize yang benar.
3. **Alur split** (1.5, 1.6, 1.7) — stok & akuntansi.
4. **Pemolesan** (2.x, 3.x).
5. **Prioritas 7 (Backup & Restore)**: **7.1–7.8 SELESAI (v4.7) — tuntas**; backup kini aman (checksum isi), restore snapshot (Replace), media & bundle utuh, auto backup berjalan.
6. **Prioritas 8 (Stok vs Cancel/Demo)**: **8.1–8.4 SELESAI (v4.7) — tuntas**; stok tidak bocor lagi (Demo→Selesai & hapus Pending), sync cloud konsisten (satu helper bulk), stok negatif terpantau di UI.
7. **Prioritas 9 (Opname & Adjustment)**: **9.1–9.4 SELESAI (v4.7) — tuntas**; log 'import' aktif, guard race opname lintas device, nama baru di log, opname/import batch.
8. **Prioritas 10 (Mode Blind Opname & PIN)**: 10.1 (kritis — kebocoran mode buta), 10.2 (role-gate PIN + identitas approver), 10.3 (alasan wajib staff), 10.4 (clamp stok aktual), 10.5 (catatan desain ambang PIN) **SELESAI (v4.7) — Prioritas 10 tuntas**.
9. **Prioritas 11 (Celah Spesifikasi & Arah Komersialisasi)**: terdokumentasi (v4.7) — 6 celah (WhatsApp marketing, Google Drive, QRIS gateway, multi-outlet, RLS JWT, diskon per item) + P0/P1/P2. Eksekusi: **P0 selesai 3/4** — P0.1 laporan PPN ✅, P0.2 refund ✅, P0.4 struk digital ✅; tersisa **P0.3 (role Owner)** → P1 bertahap → P2; arah komersialisasi (1 outlet vs SaaS) menentukan prioritas P1.
10. **Prioritas 12 (Audit Promo & Manajemen Data)**: terdokumentasi (v4.7) — **MANAJEMEN DATA TUNTAS ✅** (12.1.1–12.1.5 + P-A1) + **P-A2 ✅** (scope `menu` + validasi, 17 test) + **P-A3 ✅** (laporan performa promo, 15 test + mapping) + **P-A4 ✅** (stacking/eksklusif, 13 test) + **P-A5 ✅** (BOGO & min-qty, 21 test) + **P-A6 ✅** (batas per pelanggan, 10 test) + **P-A7 ✅** (nama promo di struk, 8 test) + **P-A8 ✅** (poin loyalty earn+redeem, 18 test). **SELURUH PRIORITAS 12 TUNTAS ✅** (Manajemen Data + Promo P-A1–P-A8) — angka test terkini **370/370**.
11. **Prioritas 13 (Audit Mode Offline)**: **SELURUHNYA TUNTAS ✅ (v4.7)** — O-1 ✅ (queue → IndexedDB) + O-2 ✅ (retry berkala 30 dtk + visibilitychange) + O-3 ✅ (failed-ops list + badge + modal + audit log) + O-4 ✅ (banner global) + O-5 ✅ (badge "Belum Sync" transaksi) + O-6 ✅ (banner cold start + dokumentasi batasan) + O-7 ✅ (deteksi konflik stok) + O-8 ✅ (tombstone cap 1000) + O-9 ✅ (PWA navigateFallback + NetworkFirst) + O-10 ✅ (UI konfirmasi aman + urutan antrean kronologis) — angka test **397/397** (35 file) + build sukses.
12. **Prioritas 14 (Audit Printer Thermal & Split Printer)**: **14.1 ✅ + 14.2 ✅ + 14.3 ✅ + 14.4 ✅ + 14.5 ✅ + 14.6 ✅ (v4.7) — TUNTAS (6/6)** — P-1 ✅ (silent re-pair via `getDevices()` + `establishConnection` bersama), P-2 ✅ (state sesi `sessionStorage`), P-3 ✅ (tidak buka picker otomatis saat checkout), P-4 ✅ (banner "Refresh memutus koneksi" non-dismissable) + **14.2 ✅** (fallback seragam: re-pair senyap → browser print + toast `notifyPrinterFallback`) + **14.3 ✅** (print queue FIFO per printer + retry 1× + drop tanpa hang) + **14.4 ✅** (BroadcastChannel `rempah-printer-events` + `printerStatusStore` + `usePrinterCrossTab` + indikator KDS dengan tombol Hubungkan senyap) + **14.5 ✅** (fallback EKSPLISIT per printer: `cashierFallbackBrowser` / `kp.fallbackBrowser`, return boolean, status error bila nonaktif, toggle di Settings) + **14.6 ✅** (alert→toast semua alur printer, satu sumber kebenaran device identity via `getPrinterDeviceId/Name`, banner pakai `getPrinterSessionState` + label Indonesia konsisten) — test **416/416** (39 file; +7 `printerFallback`). **Prioritas 14 TUNTAS.**
13. **Prioritas 15 (Temuan UX & Validasi)**: **SELURUHNYA TUNTAS ✅ (v4.7)** — **15.1 ✅** validasi harga add-on > 0 (form blok simpan + toast; import CSV drop invalid + laporan; helper `menuValidation.ts`, 11 test) + **15.2 ✅** daftar pending payment jadi **carousel horizontal** (scroll-snap + geser mobile, panah ◀ ▶ + dot + counter "N dari M", clamp index saat list berubah; semua fitur lama dipertahankan) + **15.3 ✅** opsi cetak per-transaksi **dua toggle independen** — "Cetak struk kasir" (`skipReceiptPrint`) & "Cetak tiket dapur" (`skipKitchenPrint`): skip struk saja → tiket dapur **tetap keluar di awal** (kebutuhan kasir hemat struk tapi dapur tetap dapat tiket); skip keduanya → tidak ada cetakan; **anti tiket DOBEL otomatis** saat resume pending item tidak berubah (tiket dapur default OFF, sudah tercetak saat Simpan Pending); **diperluas ke Split Bill** via `printSplitReceipt(skipCashierPrint, skipKitchenPrint)` + dua checkbox di Payment Box `SplitBillModal`; **resume pending otomatis tercakup** via modal checkout yang sama; 7 test `printTarget`) + **15.4 ✅** header aksi bahan baku (Tambah Bahan/Min. Stok/Export/Template CSV/Import) hanya di tab Bahan Baku (UI-only). **Prioritas 15 TUNTAS** — test **434/434** (41 file), tsc 0 error.
14. **Prioritas 16 (Bug Item Pending Tidak Ter-update di Riwayat + Fitur Semua Dapur)**: **SELESAI ✅ (v4.7)** — **16.1 ✅** freshness compare di `loadFromCloud` (pilih versi lebih baru per transaksi; **anti-duplikat** — versi cloud yang kalah tidak ikut merge) + **`updatedAt` minimal** (stamp engine tiap commit & `updateKitchenStatus`/`updateTxStatus`/`updateTxMeta`; fallback `date` untuk legacy; tanpa migrasi DB) — menutup race item pending (tambah/kurangi menu) DAN jalur void/cancel/status/meta. Test permanen `pendingUpdateHistory` (3) + `pendingCloudOverwrite` (8) + **16.2 ✅** opsi "Semua Dapur" di Edit Menu (`kitchenTarget: 'ALL'` → tiket ke semua printer dapur aktif; `printTarget` +2) — test **449/449** (43 file), tsc 0 error.
15. **Prioritas 17 (UX Edit Menu, Checkbox Cetak & Duplikat Transaksi Pending)**: **SELURUHNYA SELESAI ✅ (v4.7)** — **17.1 ✅** baris checkbox Best Seller/Level Gula/Pilihan Suhu `sm:col-span-2` + wrap rapi; **17.2 ✅** checkbox cetak berdampingan di desktop (POS + SplitBillModal, catatan "tidak ada cetakan" wrap ke baris sendiri); **17.3 ✅ (KRITIS)** duplikat transaksi saat pending diedit & dibayar setelah remount — persist `resumeContext` di cartStore + restore via `resolveResumeRestore` saat mount POS + bersihkan identity saat finalize sukses (bonus bug laten: `setCurrentPendingTx(null)`). Test **460/460** (44 file; +11 `pendingResumeContext`).
16. **Prioritas 18 (Skenario 2 Kasir & Offline)**: **18.1–18.8 SELURUHNYA TUNTAS ✅ (v4.7)** — 18.1 lost-update stok ditutup via **RPC atomik `adjust_inventory_stock`** (Migration 27); **18.2 nomor antrean duplikat via RPC `allocate_queue_number`** (Migration 28) + badge "#N duplikat"; **18.3 shift**: guard 1 shift/outlet + `resumeExistingShift` + restore shift terbuka paling awal, expected cash dari semua transaksi Selesai tersinkron (flush + fetch cloud saat tutup shift), peringatan belum-sync di modal, plus **fix tanggal lokal UTC-vs-pagi-buta** (`toLocalDateKey` di queueNumber/transactionStore/cloudSync); **18.4** batasan reserve split per-device terdokumentasi + warning UI; **18.5** KDS aman (review, tanpa fix wajib); **18.6** banner **"Laporan belum final — N transaksi belum sinkron"** (`SyncFreshnessBanner` di Laporan & Dashboard, reuse badge O-5); **18.7** promo race → superseded E7; **18.8** temuan A **SELURUHNYA TUNTAS (A1–A13)** + **E7 TUNTAS** (A5 LWW `updatedAt` + Migration 29; A10 `kitchenTicketPrintedAt` + Migration 30; A11 warning bahan hilang; A12 alert negatif presisi; A13 jalur pembuatan Demo; E7 `reservePromoUsage` + ledger usageKeys + replay guard + merge UNION). **WAJIB jalankan SQL Migration 27–30 sekali** di Supabase SQL Editor. Test **588/588** (56 file; +6 dari 582). **Prioritas 18 TUNTAS.**
17. **Prioritas 22 (Promo Bundling & Diskon Per Menu)**: **22.2 ✅ SELESAI** (diskon per menu: `itemDiscount` di CartItem + UI tombol Tag + struk + 11 test); **22.1** promo bundling (tipe baru `'bundle'`, deteksi otomatis di POS) + **22.3** verifikasi loyalty toggle (tanpa kode baru) + **22.4** struk & laporan untuk bundle. Angka test **613/613** (58 file).

---

## 🟡 PRIORITAS 22 — PROMO BUNDLING & DISKON PER MENU (Analisa, v4.7)

> **Sumber analisa**: `ANALYSE.md` section I — audit fitur promo, loyalty, & diskon per menu.

### 22.1 (🟠 SEDANG) — Promo Bundling: Tipe Promo Baru "Beli Item A+B = Diskon"

- **Masalah**: Saat ini promo hanya mendukung `percentage`, `fixed`, `bogo`. Tidak ada cara membuat promo "Beli Nasi + Ayam = Diskon Rp 5.000" atau "Beli 2 minuman = Diskon 10%". Bundle MENU sudah ada (`Menu.isBundle`) tapi tidak fleksibel untuk promo sesaat.
- **Solusi**: Tambah tipe promo baru `'bundle'` dengan:
  - `bundleItems: Array<{menuId: string; quantity: number}>` — item yang harus ada di keranjang
  - `bundleDiscountType: 'fixed' | 'percent'` — tipe diskon
  - `bundleDiscountValue: number` — nilai diskon (Rp atau %)
  - Deteksi otomatis di POS: jika keranjang mengandung SEMUA item bundle, diskon diterapkan
  - Simpan di field `meta` JSON yang sudah ada di tabel `promos` (tanpa migrasi)
- **File terdampak**: `types/index.ts`, `promoValidation.ts`, `discountEngine.ts`, `Promos.tsx`, `POS.tsx`
- **Dampak**: +1 tipe promo, +~15 test, +form UI di Promos.tsx

### 22.2 (🟠 SEDANG) — Diskon Per Menu di POS — ✅ SELESAI (v4.7)

- **Fix diterapkan**:
  - **CartItem type**: `itemDiscount?: number` ditambahkan di `types/index.ts`
  - **cartStore**: `setItemDiscount(lineId, discount)` — update subtotal = `max(0, unitPrice * qty - disc)`
  - **UI POS**: Tombol `Tag` di samping item → input inline diskon Rp dengan tombol OK/Hapus; badge amber saat diskon aktif; coret harga lama
  - **Struk termal**: Baris "Diskon item -Rp X" per item (warna amber)
  - **Struk digital**: Baris "Diskon item -Rp X" per item
  - **Test**: 11 test `itemDiscount.test.ts` (setType, setItemDiscount, clamp, merge, addons, quantity, getSubtotal)
- **Status**: ✅ SELESAI — tsc 0 error, 613/613 test (58 file)

### 22.3 (🟢 MINOR) — Validasi End-to-End Loyalty Points Toggle

- **Temuan**: Toggle `loyaltySettings.enabled` sudah ada di `Promos.tsx` (baris 267) dan berfungsi — earn & redeem hanya jalan jika enabled.
- **Tindakan**: Verifikasi manual bahwa:
  - Toggle OFF → tidak ada input redeem di POS, poin tidak di-earn saat checkout
  - Toggle ON → redeem muncul, poin di-earn
  - Sinkronisasi cloud (`syncLoyaltySettings`) tetap jalan
- **Tidak perlu perubahan kode** — hanya verifikasi manual.

### 22.4 (🟡 SEDANG) — Promo Bundling: Struk & Laporan

- **Masalah**: Jika 22.1 dieksekusi, struk perlu menampilkan "Promo Bundle: -Rp 5.000" secara terpisah dari diskon lain.
- **Solusi**: Tampilkan promo bundle di struk sebagai baris terpisah (sudah didukung oleh format struk saat ini yang menampilkan promo per-baris).
- **Laporan**: Tambah filter "Promo Bundle" di laporan performa promo (sudah ada field `promoName`/`promoAmount` di transaksi).

---

*Dokumen dibuat berdasarkan analisa statis kode — belum ada perubahan yang diterapkan.*
