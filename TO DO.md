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
5. **Prioritas 7 (Backup & Restore)**: **7.1–7.8 SELESAI (v4.7) — tuntas**; backup kini aman (checksum isi), restore snapshot (Replace), media & bundle utuh, auto backup berjalan.
6. **Prioritas 8 (Stok vs Cancel/Demo)**: **8.1–8.4 SELESAI (v4.7) — tuntas**; stok tidak bocor lagi (Demo→Selesai & hapus Pending), sync cloud konsisten (satu helper bulk), stok negatif terpantau di UI.
7. **Prioritas 9 (Opname & Adjustment)**: **9.1–9.4 SELESAI (v4.7) — tuntas**; log 'import' aktif, guard race opname lintas device, nama baru di log, opname/import batch.
8. **Prioritas 10 (Mode Blind Opname & PIN)**: 10.1 (kritis — kebocoran mode buta), 10.2 (role-gate PIN + identitas approver), 10.3 (alasan wajib staff), 10.4 (clamp stok aktual), 10.5 (catatan desain ambang PIN) **SELESAI (v4.7) — Prioritas 10 tuntas**.

---

*Dokumen dibuat berdasarkan analisa statis kode — belum ada perubahan yang diterapkan.*
