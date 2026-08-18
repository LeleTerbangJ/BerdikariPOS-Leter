# 🔎 ANALYSE — Audit Alur Transaksi & Pergerakan Stok (v4.7)

> **Tujuan**: analisa ulang menyeluruh alur transaksi (checkout normal, pending payment, split bill, void/cancel, refund, demo) dan pergerakan stok (deduct, revert, reserve, delta pending, sesi split) untuk menemukan potensi bug & logic yang bermasalah yang belum tertangkap prioritas 1–17.
> **Metode**: pembacaan ulang kode `AtomicTransactionEngine`, `inventoryStore`, `transactionStore`, `SplitBillModal`, `splitStockSession`, `hpp.ts`, `refund.ts`, `transactionStockActions.ts`, `Transactions.tsx`, `cloudSync` (jalur stok).
> **Branch/versi**: `develop`, v4.7 — tsc 0 error, 460/460 test, build produksi sukses.
> **Status**: 🔎 **ANALISA — belum ada perubahan kode** (temuan siap dieksekusi bertahap; prioritas diusulkan per item).

---

## Ringkasan

| # | Temuan | Severity | Area | Perlu fix? |
|---|--------|----------|------|------------|
| A1 | `skipStockDeduction` tidak pernah dipakai caller (dead param) | 🟢 Rendah | Engine | Opsional (hapus/satukan dengan `reservedDeductions`) |
| A2 | `calculateItemDeductions`: flag `hasSnapshot` global → item tanpa snapshot ikut dibuang bila 1 item punya snapshot | 🟢 Rendah | hpp.ts | Defensif (per-item fallback) |
| A3 | Rollback engine mengembalikan stok via `updateItem(skipLog)` → jejak stock log 'deduct' tanpa 'add' balasan | 🟢 Rendah | Engine | Perbaiki audit trail stok |
| A4 | Race double-refund (klik ganda) → revert stok ganda + Kas Keluar ganda | 🟠 Sedang | Transactions | Guard in-flight/store-level |
| A5 | Race sync stok multi-device saat burst (cloud bisa berakhir stale lebih tinggi) | 🟠 Sedang | cloudSync/inventory | Risiko terdokumentasi (O-7); pertimbangkan `updated_at` inventory |
| A6 | `computeCartSignature` tidak menyertakan harga add-on & kuantitas → deteksi "cart sama" bisa salah (split session / pendingItemsChanged) | 🟠 Sedang | splitStockSession/POS | Perluas signature |
| A7 | Split dari pending: sub-bill dapat nomor antrean BARU per sub-bill (N nomor) — inkonsisten dgn split fresh (1 nomor) | 🟡 INFO | SplitBillModal | Keputusan desain / seragamkan |
| A8 | Pending split: delta-0 mengasumsikan item sub-bill == item parent — bila sub-bill bisa diedit, stok bocor | 🟡 INFO | SplitBillModal | Verifikasi/guard |
| A9 | Cancel parent pending yang beranak split tidak revert bagian belum lunas (harus void sub-bill satu per satu) | 🟡 INFO | transactionStore | Perilaku terdokumentasi — perlu SOP |
| A10 | Tiket dapur bisa hilang saat resume pending item tidak berubah + printer gagal saat Simpan Pending | 🟡 INFO | POS/printer | Mitigasi queue/retry sudah ada |
| A11 | `validateStockAvailability` & `deductStock` diam-diam melewati id bahan yang sudah dihapus dari inventory | 🟢 Rendah | inventoryEngine | Tambah warning |
| A12 | `lastNegativeStockAlerts` di-reset oleh revert apa pun (bukan hanya yang relevan) | 🟢 Rendah | inventoryStore | Kosmetik |
| A13 | Demo tidak punya jalur pembuatan — hanya transisi Selesai→Demo | 🟡 INFO | POS/Transactions | Perilaku (keputusan produk) |

---

## 🔴 A. Temuan yang layak diperbaiki

### A1 — `skipStockDeduction` dead param (Rendah)
- **Lokasi**: `src/types/index.ts` (±226), `src/lib/atomicTransactionEngine.ts` (±188).
- **Fakta**: engine menghandle `params.skipStockDeduction` (lewatkan potong stok), tapi **tidak ada caller yang mengirimnya** — SplitBillModal memakai `reservedDeductions` (delta 0) sebagai gantinya. Param mati ini menyesatkan: caller baru yang memakai `skipStockDeduction: true` akan melewati potong stok tanpa reserve → stok bocor diam-diam.
- **Usulan**: hapus param (atau beri deprecation + validasi: tidak boleh bersamaan dengan `reservedDeductions`).

### A2 — `calculateItemDeductions`: flag `hasSnapshot` global (Rendah/defensif)
- **Lokasi**: `src/utils/hpp.ts` (`calculateItemDeductions`).
- **Fakta**: jika **satu saja** item punya `recipeSnapshot` non-kosong → `hasSnapshot = true` → SEMUA item tanpa snapshot **tidak dihitung** (fallback legacy di-skip). Di praktik aman (engine selalu membuat snapshot utuh per transaksi; item dengan snapshot kosong memang tak punya bahan), tapi rapuh: campuran snapshot/legacy dalam satu transaksi akan kehilangan deduksi item legacy.
- **Usulan**: hitung **per item** — `ing = item.recipeSnapshot?.length ? item.recipeSnapshot : fallback menu/addon(item)`, tanpa flag global.

### A3 — Rollback engine tidak meninggalkan jejak 'add' di stock log (Rendah)
- **Lokasi**: `src/lib/atomicTransactionEngine.ts` `executeRollback`.
- **Fakta**: rollback me-restore stok via `updateItem(invId, { stock }, { skipLog: true })` → stok kembali tapi **stock log menunjukkan 'deduct' tanpa 'add' balasan** → jejak audit stok tidak seimbang untuk transaksi yang gagal (log "transaksi dipotong" padahal batal).
- **Usulan**: rollback memakai `revertStock(delta, 'Rollback transaksi gagal #...')` (log 'add' + sync bulk) atau tulis log koreksi eksplisit; `updateItem(skipLog)` hanya untuk kasus lain.

### A4 — Race double-refund (Sedang)
- **Lokasi**: `src/pages/Transactions.tsx` `executeRefund` + `src/utils/refund.ts`.
- **Fakta**: guard `isRefundableTransaction(tx, ...)` memakai **salinan tx dari render** (`refunded` belum ter-update di state komponen). Dua konfirmasi cepat (klik ganda / Enter+klik) bisa lolos keduanya → **revert stok ganda + 2× Kas Keluar Refund**. `updateTxMeta` lokal sinkron, tapi jendela antar dua klik bisa melewati keduanya.
- **Usulan**: (1) cek ulang `refunded` dari **store** di awal `executeRefund` (`transactions.find(t => t.id)?.refunded`), (2) disable tombol saat `refundPending`, (3) tombol Konfirmasi pakai state "processing". Test: simulasi double-call `executeRefund`.

### A5 — Race sync stok multi-device saat burst (Sedang, risiko terdokumentasi)
- **Lokasi**: `src/store/inventoryStore.ts` `deductStock`/`revertStock` → `syncInventoryStock` (`src/lib/cloudSync.ts`).
- **Fakta**: `syncInventoryStock` mengirim **nilai stok pasca-mutasi lokal** (`item.stock` saat itu). Dua device memotong bahan yang sama hampir bersamaan → urutan selesai network bisa tertukar → cloud bisa berakhir dengan nilai **lebih tinggi (stale)** sampai mutasi berikutnya; fetch berikutnya (loadFromCloud inventory) bisa menimpa lokal dengan nilai stale itu. O-7 mendeteksi konflik (banner kuning) tapi **tidak mengoreksi otomatis**.
- **Usulan**: pertimbangkan kolom `updated_at`/versi di tabel `inventory` + perbandingan saat sync (last-write-wins berbasis timestamp), atau normalisasi stok cloud dari stock log (Σ log) saat load. Minimal: dokumentasikan batasan & SOP cek stok pagi.
- ✅ **SELESAI (v4.7 TO DO 18.8/A5 — last-write-wins via updatedAt)**: kolom `updated_at` sudah ada di `CREATE TABLE inventory`; ditambah **Migration 29** (ALTER idempoten self-heal DB lama + flag `inventoryUpdatedAt`). `InventoryItem.updatedAt` dipakai `isLocalNewer()` (`src/utils/inventoryFreshness.ts`): (1) SEMUA mutasi stok (deduct/revert/updateItem/applyBulkStock/import/addItem) men-stamp `updatedAt`; (2) payload sync (`syncInventoryItem`, `syncInventoryStock`, fallback absolut `adjustInventoryStockCloud`) menyertakan `updated_at`; (3) `fetchInventoryFromCloud` memetakan `updated_at`; (4) `loadFromCloud` **last-write-wins per item** — mutasi lokal yang lebih baru TIDAK ditimpa fetch cloud stale (versi cloud yang kalah tidak di-merge → anti duplikat), cloud yang lebih baru diadopsi, legacy tanpa timestamp → cloud otoritatif (perilaku lama). Sisa risiko: online-atomic RPC (18.1) sudah menutup lost-update; jalur fallback absolut tetap last-write-wins by timestamp — **SOP: cek stok pagi** tetap disarankan. +15 test.

### A6 — `computeCartSignature` tidak menyertakan harga add-on / kuantitas (Sedang)
- **Lokasi**: `src/utils/splitStockSession.ts` (`computeCartSignature`), dipakai `releaseSplitReserveForCart` (POS sebelum checkout normal) & `pendingItemsChanged` (POS).
- **Fakta**: signature = `menuId:quantity:namaAddons:temp:sugar` — **harga add-on dan kuantitas tidak masuk**. Perubahan cart yang hanya mengubah harga add-on bisa dianggap "cart sama":
  - **Split session**: sesi tidak dilepas saat seharusnya dilepas → reserve lama tersisa + checkout normal memotong penuh → **double deduction** (skenario: bill 1 lunas 1× item, harga add-on berubah, lanjut checkout normal 2× item → terpotong 3×).
  - **pendingItemsChanged**: hanya memengaruhi default cetak/status dapur (dampak kecil).
- **Usulan**: perluas signature dengan `addons.map(a => a.name + ':' + a.price)` (+qty bila add-on punya qty). Tambah test `computeCartSignature` (harga berbeda → signature beda).

---

## 🟡 B. Risiko / edge yang perlu keputusan desain

### A7 — Split dari pending: sub-bill memakai nomor antrean BARU (N nomor)
- **Lokasi**: `src/components/SplitBillModal.tsx` — `overrideQueueNumber: !parentTx ? activeSession?.queueNumber || undefined : undefined`.
- **Fakta**: split **fresh** → semua sub-bill memakai **satu nomor** (kunci dari sub-bill pertama). Split **dari pending** → `overrideQueueNumber = undefined` → engine memanggil `getNextQueueNumber()` **per sub-bill** → N sub-bill mengonsumsi N nomor antrean baru, sementara parent pending sudah punya nomornya → counter melompat & struk sub-bill bernomor beda dari parent.
- **Usulan/keputusan**: seragamkan — sub-bill split pending juga memakai nomor parent (`overrideQueueNumber: parentTx?.queueNumber`), atau dokumentasikan bahwa N sub-bill = N nomor (bila memang disengaja).
- ✅ **KEPUTUSAN & SELESAI (v4.7 TO DO 18.8/A7)**: **seragamkan 1 pesanan = 1 nomor** — helper murni `resolveSplitQueueNumber(parentTx, session)`: split pending → nomor PARENT; split fresh → nomor sesi; dipakai di `overrideQueueNumber`. Bonus: `findDuplicateQueueNumbers` kini mengecualikan sub-bill split (`splitParentId`/`splitIndex`) — nomor bersama dalam satu pesanan tidak lagi salah terbaca sebagai "#N duplikat" (juga memperbaiki false-positive latent untuk split fresh). +5 test.

### A8 — Pending split: delta-0 mengasumsikan item sub-bill == item parent
- **Lokasi**: `SplitBillModal` → engine (`reservedDeductions: reservedForSubBill`).
- **Fakta**: stok parent sudah terpotong penuh saat Simpan Pending. Sub-bill memakai `reservedDeductions = deduksi sub-bill itu sendiri` → delta 0 → stok tidak disentuh. **Benar HANYA bila item sub-bill identik dengan item parent**. Bila alur pending-split memungkinkan edit item (tambah/kurangi), item baru tidak dipotong & item dihapus tidak dikembalikan → **stok bocor**.
- **Usulan**: verifikasi bahwa modal pending-split mengunci item = item parent (tidak bisa diedit); bila bisa diedit, sub-bill harus memakai delta terhadap reserved parent (`reservedDeductions = calculateItemDeductions(parent.items, menus)`).
- ✅ **KEPUTUSAN & SELESAI (v4.7 TO DO 18.8/A8)**: cart TIDAK dikunci (kasir boleh edit sebelum split) — sebagai gantinya **rekonsiliasi reserve SEKALI per parent** saat sub-bill pertama benar-benar dibayar (titik komit): helper murni `computePendingSplitReconcile(parentDeductions, currentDeductions)` menghitung delta (item dihapus → `revertStock`; item ditambah → `deductStock`) + toast info. Idempoten (selalu dari deduksi ORIGINAL parent) dan TIDAK double-adjust bila user batal split lalu finalize biasa (jalur finalize pending tetap pakai delta engine). +5 test.

### A9 — Cancel parent pending beranak split: bagian belum lunas tidak otomatis kembali
- **Lokasi**: `src/store/transactionStore.ts` `cancelPendingTransaction` (guard `hasPendingSplitChildren`).
- **Fakta**: guard mencegah double-revert (benar), tapi konsekuensinya stok bagian **belum lunas** hanya bisa kembali bila **setiap sub-bill Selesai di-void satu per satu**. Operator yang hanya membatalkan parent akan kehilangan stok bagian unpaid.
- **Usulan**: SOP/panduan (void sub-bill dulu), atau alur "Batalkan Parent + Semua Sub-bill Belum Lunas" sekali klik dengan revert gabungan yang aman.
- ✅ **KEPUTUSAN & SELESAI (v4.7 TO DO 18.8/A9)**: **SOP void satu per satu** — void parent beranak split / sub-bill memunculkan toast peringatan jelas di Transactions.tsx ("stok bagian belum lunas hanya kembali bila setiap sub-bill Selesai di-void satu per satu"). Alur sekali-klik dengan revert gabungan TIDAK dibuat (risiko double-revert & fabrikasi data) — dicatat sebagai batasan desain; SOP di-applyStockEffects + terdokumentasi.

### A10 — Tiket dapur bisa hilang saat resume pending item tidak berubah
- **Lokasi**: `POS.tsx` (default `skipKitchenPrint = !!currentPendingTx && !pendingItemsChanged`).
- **Fakta**: anti-tiket-dobel membuat tiket dapur **tidak dicetak ulang** saat finalize resume dengan item sama — benar **bila** tiket sudah keluar saat Simpan Pending. Tapi bila printer dapur **gagal/offline saat Simpan Pending** (dan retry queue juga gagal), tiket tidak pernah sampai dapur dan tidak dicetak ulang saat bayar.
- ✅ **SELESAI (v4.7 TO DO 18.8/A10)**: engine men-stamp **`kitchenTicketPrintedAt`** pada transaksi HANYA bila tiket dapur **benar-benar sukses** dicetak saat Simpan Pending (`didKitchenPrintSucceed` di `triggerPostCommitTasks`; printer gagal → tidak di-stamp). Resume memakai fakta itu via helper murni `shouldSkipKitchenPrintAtResume` (`src/utils/kitchenTicket.ts`): item berubah → cetak ulang; item sama & sudah cetak → skip (anti dobel); item sama & belum pernah cetak (printer gagal) → **cetak ulang** — tiket tidak hilang diam-diam. Kolom `kitchen_ticket_printed_at` + Migration 30 (self-heal DB lama) + mapping `syncTransaction`/`syncTransactionMeta` (lintas device). Split dari pending tetap tidak mencetak tiket (target 'cashier'). Test **566/566**.

---

## 🟢 C. Temuan kecil / kosmetik

- **A11** — `validateStockAvailability` & `deductStock` melewati id bahan yang sudah tidak ada di inventory (`if (!inv) continue` / `if (item && amount > 0)`): resep dengan id bahan yang sudah dihapus tidak memberi peringatan apa pun. Usulan: tambah warning "bahan {id} tidak ditemukan" di validasi.
  - ✅ **SELESAI (v4.7 TO DO 18.8/A11)**: `InventoryEngine.validateStockAvailability` kini melaporkan bahan yang direferensikan resep tapi **sudah dihapus** sebagai warning `missing: true` (`ingredientName` = id, `available: 0`) — checkout terblokir dengan peringatan (bisa "Lanjutkan Tetap", perilaku sama dengan stok kurang). Modal peringatan stok POS menampilkan pesan khusus "Bahan tidak ditemukan (ID: …) — resep memakai bahan ini tapi sudah dihapus dari Inventaris". +2 test (`stockCheck.test.ts`).
- **A12** — `revertStock` me-reset `lastNegativeStockAlerts` untuk revert apa pun (tidak hanya yang memperbaiki item negatif) → banner hilang lebih cepat. Kosmetik.
  - ✅ **SELESAI (v4.7 TO DO 18.8/A12)**: `revertStock` kini **memfilter** alert: item yang MASIH negatif pasca-revert dipertahankan (stok terbaru); alert hanya hilang bila revert benar-benar mengeluarkan item dari negatif. Revert item lain yang tidak relevan tidak lagi menghapus peringatan. +3 test (`stockNegativeAlert.test.ts`).
- **A13** — Demo tidak punya jalur **pembuatan** (hanya transisi status Selesai→Demo). Bila produk ingin tombol "Catat Transaksi Demo" dari POS, belum ada. Keputusan produk.
  - ✅ **SELESAI (v4.7 TO DO 18.8/A13 — keputusan produk: dibuat)**: tombol **"Catat sebagai Demo (tidak memotong stok)"** di modal checkout POS → `overrideTxStatus: 'Demo'` + `suppressAutoPrint`. Engine: demo **tidak memotong stok** (bukan penjualan nyata), **queueNumber = 0** (tidak konsumsi nomor antrean RPC; Demo dikecualikan hitungan/laporan), tidak mencetak struk/tiket dapur, tidak merekam kunjungan/promo/loyalty. Riwayat Transaksi menampilkan label **DEMO** (bukan #0) & bisa dicari "demo"; demo hasil konversi Selesai→Demo tetap memakai nomor aslinya. Bila demo diubah ke Selesai, `applyStatusStockEffects` men-deduct stok + merekam kunjungan (perilaku 8.1 yang sudah ada). +3 test (`demoTransaction.test.ts`).

---

## ✅ D. Yang sudah benar (hasil verifikasi audit ini)

- **Engine delta pending** — `reservedDeductions` memakai **recipeSnapshot tersimpan** (bukan menu saat ini) → delta tambah/kurang item konsisten walau resep berubah. `calculateItemDeductions` memakai snapshot bila ada; fallback legacy hanya untuk transaksi lama.
- **Split fresh** — stok dipotong **sekali** (sub-bill pertama sesi, reserve penuh), `accumulatePaidPortion` di-cap pada `reserved` (mode Equal tidak mengakumulasi berulang), sesi dibersihkan saat semua lunas / cart berubah; HPP equal diskala (Σ hpp sub-bill = HPP induk).
- **Split dari pending** — parent tetap menahan deduksi stok; sub-bill delta-0; saat semua lunas, parent di-mark Selesai tanpa potong ulang.
- **Status stock effects** (`transactionStockActions.ts`) — satu jalur untuk semua transisi: Selesai→Cancel/Demo (revert), Pending→Cancel/Demo (revert reserve), Cancel/Demo→Selesai (deduct, termasuk Demo→Selesai), Delete Selesai/Pending (revert), guard `isSplit` & `refunded` (anti double revert).
- **Refund** — `isRefundableTransaction` menolak sub-bill split / induk beranak split, double-refund, nominal 0; revert stok via snapshot; Kas Keluar 'Refund' akuntabel; tandai `refunded` + sync cloud.
- **Unifikasi validasi stok** (TO DO 2.5) — `checkStockAvailability` hanya alias `InventoryEngine.validateStockAvailability`; engine & split memakai satu sumber kebenaran.
- **Sync stok bulk** (TO DO 8.3) — `deductStock`/`revertStock` memakai `syncInventoryStock` yang hanya mengirim **nilai pasca-mutasi** (tidak mengurangi lagi → tidak ada double deduction cloud); `applyBulkStock`/`importItems` batch 1 request.
- **17.3** — identitas pending persist (`resumeContext`) → tidak ada transaksi duplikat setelah pindah halaman/refresh; identity dibersihkan pasca-finalize.
- **Anti-duplikat transaksi cloud** — freshness compare (`updatedAt` fallback `date`) + eksklusi versi kalah (Prioritas 16).

---

## 🧩 E. SKENARIO 2 KASIR BERSAMAAN (termasuk mode offline)

> **Pertanyaan analisa**: bila 2 kasir login & bertransaksi bersamaan (masing-masing di device sendiri), masalah transaksi apa yang bisa muncul — nomor antrian, KDS, stok, laporan? Berlaku juga saat keduanya offline.
> **Kesimpulan utama**: sebagian besar aman karena sinkronisasi by-ID + realtime (KDS, laporan), tetapi ada **4 titik rawan nyata**: (E1) nomor antrean duplikat, (E2) lost-update stok, (E3) shift & expected cash, (E4) reserve split per-device. Semua memburuk saat offline.

### E1 — Nomor antrean DUPLIKAT (🟠 Tinggi; offline: 🔴 lebih parah)
- **Lokasi**: `src/store/transactionStore.ts` `getNextQueueNumber` (±70–125) + `loadFromCloud` (normalisasi `nextQueueNumber`).
- **Fakta**: nomor antrean dihitung **check-then-act** — fetch `max(queue_number)` dari cloud → `max(cloudMax, localMax) + 1`. Dua kasir yang memproses di saat bersamaan **bisa membaca cloudMax yang sama** lalu keduanya mendapat nomor yang sama → **dua transaksi berlabel #N kembar**. Tidak ada penguncian/lock/sequence atomik (mis. `nextval()` atau alokasi range per device). `loadFromCloud` hanya menormalkan **penghitung berikutnya** dari data hasil merge — label duplikat yang **sudah terlanjur dibuat tetap kembar** (tidak di-renumber).
- **Offline**: tidak ada fetch cloud → keduanya memakai `localMax + 1` dari baseline yang sama → **duplikat hampir pasti** setelah keduanya online & merge (dibatasi dokumentasi TO DO 13.6).
- **Dampak**: struk/kuitansi nomor kembar, laporan shift & KDS membingungkan (2 order #N), pelanggan komplain nomor antrean.
- **Usulan**: (1) alokasi **range per device** (mis. device id → offset 1000), (2) atau simpan counter terakhir di tabel cloud + **insert dengan verifikasi & retry** (bila nomor sudah dipakai → naikkan), (3) atau renumber ringan saat deteksi duplikat pasca-merge (dengan audit log). Minimal: tambah badge "#N (duplikat)" agar tidak membingungkan.

### E2 — Stok: LOST-UPDATE validate-then-deduct (🔴 Tinggi; offline: 🔴 parah)
- **Lokasi**: `AtomicTransactionEngine.executeCheckout` (validasi → `deductStock`), `inventoryStore.deductStock`.
- **Fakta**: validasi stok dan pemotongan adalah **dua langkah terpisah tanpa atomisitas lintas device**. Dua kasir melihat stok bahan = 5; keduanya lolos validasi; keduanya memotong 5 → **terpakai 10 dari 5**. Lokal masing-masing = 0, cloud = nilai yang menulis terakhir (0) → **stok sebenarnya −5, tampil 0** → selisih 5 unit **hilang tanpa terdeteksi** (alert negatif tidak muncul karena tidak ada device yang lokalnya negatif). O-7 mendeteksi konflik hanya saat nilai cloud > lokal (bukan kasus ini).
- **Offline**: baseline stok terakhir sama → **lost-update hampir pasti** untuk bahan yang laris; drift menumpuk sampai Stock Opname.
- **Usulan**: (1) deduksi dengan **optimistic concurrency** — `UPDATE ... SET stock = stock - X WHERE id = ... AND stock >= X` + retry/peringatan bila gagal (Supabase RPC/`update` dengan filter), (2) atau deduksi via **satu RPC atomik** yang juga mengembalikan stok aktual, (3) minimal: setelah commit, bandingkan stok hasil vs ekspektasi & catat selisih ke stock log (jejak audit), (4) dokumentasikan SOP "cek stok sebelum shift" untuk mode offline.

### E3 — Shift & Expected Cash: perangkat-perangkat (🟠 Sedang; offline: 🔴)
- **Lokasi**: `src/store/shiftStore.ts` — `activeShift` **tunggal global** per store/device, `openShift` **tanpa guard** (kasir kedua menimpa `activeShift` device-nya), `closeShift` menerima `totalSales`/`expectedCash` dari **komputasi lokal** device.
- **Fakta**: kasir A buka shift di device A, kasir B buka shift di device B → dua shift berbeda, masing-masing device hanya tahu shift-nya sendiri. **Expected cash saat tutup shift dihitung dari transaksi LOKAL device itu saja** → bila laci fisik dipakai bersama, selisih kas (cash difference) **salah** (kurang transaksi device lain). Riwayat shift lintas device tersedia (`loadFromCloud`), tapi **active shift tidak dibagikan** — laporan Shift Manager bisa menampilkan 2 shift "aktif" (dari 2 device) seperti kasus yang pernah Anda laporkan.
- **Offline**: expected cash makin tidak akurat (hanya transaksi lokal + queue offline belum ter-flush).
- **Usulan**: (1) pilih **1 shift aktif per outlet** (bukan per device) — tentukan prioritas (mis. shift pertama yang dibuka) atau kunci per kombinasi tanggal+device; (2) expected cash tutup shift dihitung dari **semua transaksi Selesai yang tersinkron** (query cloud) bukan hanya lokal, dengan peringatan bila masih ada queue belum sync; (3) peringatan bila tutup shift saat masih ada "N belum sinkron" (badge O-5 sudah ada — tautkan ke alur tutup shift).

### E4 — Reserve stok SPLIT hanya diketahui device pembuatnya (🟠 Sedang)
- **Lokasi**: `src/utils/splitStockSession.ts` — sesi reserve disimpan **localStorage per device** (`rempah-split-stock-session`).
- **Fakta**: kasir A memulai split (stok item di-reserve penuh di device A). Kasir B di device lain **tidak tahu** reserve itu → bisa menjual item yang sama → stok terpakai melebihi fisik (bagian dari kelas E2). Sesi split juga tidak bisa di-resume dari device lain.
- **Offline**: sama (reserve tidak pernah dibagikan).
- **Usulan**: dokumentasikan batasan (split = sesi di satu device) + warning di UI split "stok ini di-reserve hanya di device ini"; jangka panjang: simpan reserve sebagai transaksi status Pending/split-reserve di cloud.

### E5 — KDS / Dapur (🟢 Aman, catatan kecil)
- **Fakta**: `updateKitchenStatus` sync ke cloud + realtime → kedua device KDS melihat status sama. Split filter (`splitParentId`/`splitIndex`, Prioritas 5.10) konsisten lintas device. Tiket dapur dicetak di **printer masing-masing device** (tidak ada tiket ganda dari 2 kasir karena printer terpisah).
- **Catatan offline**: perubahan status dapur saat offline masuk offline queue (O-10 urutan kronologis) → ter-flush saat online ✓. Alarm KDS (5 menit) & mute bersifat per-device (kosmetik).
- **Satu catatan**: dua kasir membuka KDS bersamaan tidak saling mengunci (tidak ada masalah — status last-write-wins).

### E6 — Laporan & Akuntansi (🟢 Aman setelah sync, catatan transisi)
- **Fakta**: `loadFromCloud` merge **by ID** + freshness compare (Prioritas 16) → **tidak ada transaksi ganda** di laporan; dashboard/PPN/shift report menghitung dari daftar transaksi hasil merge. Split sub-bill sudah dieksklusi dari double accounting (`splitParentId`, Prioritas 1.6/5.2). Rekap Kas memakai `cashierId` → Kas Masuk/Keluar per kasir akurat.
- **Catatan transisi**: sebelum sync, **laporan lokal dua device berbeda** (normal — masing-masing baru tahu datanya sendiri); setelah keduanya online, realtime menyamakan. Offline: laporan device A tidak memuat penjualan device B sampai sync — bila Manager melihat laporan dari device yang belum sync, angkanya belum final.
- **Usulan kecil**: beri indikator "laporan belum final — N transaksi belum sinkron" di header laporan saat ada queue (reuse badge O-5).

### E7 — Promo usage & Loyalty (🟢/🟠 minor)
- `incrementUsage(promoId, customerId)` & `recordVisit`/poin loyalty **tanpa guard race** → dua kasir memakai voucher yang sama hampir bersamaan bisa **double-increment** (usage limit per pelanggan terlewati). Dampak kecil (nominal promo), tapi untuk voucher berbatas 1× per orang bisa lolos 2×.
- ✅ **SELESAI (v4.7 TO DO 18.8/E7)**: (1) **`reservePromoUsage(id, customerId, usageKey)`** di promoStore — cek batas (global & per pelanggan) dari **STORE saat commit** (bukan salinan render) + naikkan **atomik** dalam satu functional `set` (dua panggilan berurutan di device sama tidak bisa lolos ganda) + **ledger `usageKeys` id unik transaksi** → replay/re-commit transaksi yang sama (idempotentReplay) TIDAK menaikkan usage dua kali (sebelumnya `incrementUsage` jalan lagi saat replay → voucher berbatas 1× bisa terpakai 2×). (2) **Replay guard efek samping** di POS finalize: `recordVisit`/`deductLoyaltyPoints` (dan usage promo) kini hanya jalan bila `!result.idempotentReplay` — sebelumnya replay double-click mencatat **kunjungan ganda + poin loyalty terpotong 2×**. (3) **Merge ledger lintas device**: `loadFromCloud` menggabungkan `usageKeys` UNION (monotonik — key yang tercatat di mana pun adalah pemakaian nyata), bukan ditimpa last-write-wins. POS & SplitBillModal memakai `reservePromoUsage(subTx.id)` + toast peringatan bila batas tercapai (transaksi tetap diproses). **Residual terdokumentasi**: dua device OFFLINE memakai voucher sama hampir bersamaan tetap bisa lolos batas (sync promo LWW per record) — proteksi penuh lintas device butuh RPC counter (pola 18.2); kunjungan/loyalty lintas device juga LWW.

---

### 🎯 Prioritas eksekusi yang disarankan (A + E)
1. **E2** (lost-update stok) — paling berdampak operasional; mulai dari optimistic-concurrency / RPC atomik.
2. **E1** (nomor antrean duplikat) — alokasi range per device atau verifikasi+retry saat insert.
3. **E3** (shift & expected cash) — 1 shift aktif per outlet + expected cash dari data tersinkron.
4. **A4** (double-refund), **A6** (signature cart), **E4** (reserve split per-device → dokumentasi/UI warning).
5. **A7/A8/A9/A10** (konsistensi split pending & tiket) → **A1–A3** (pembersihan) → **E7** (promo race) ✅ SELESAI.

---

*Dokumen ini adalah hasil analisa statis + penelusuran kode pada v4.7 (branch `develop`). Belum ada perubahan kode yang diterapkan — temuan siap dieksekusi bertahap sesuai prioritas (A + E di atas).*
