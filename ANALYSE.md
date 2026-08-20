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

## 🏬 F. MULTI OUTLET / CABANG — Analisa Kesiapan (v4.7, belum dieksekusi)

> Analisa statis untuk menjawab: **"apa saja yang harus dipersiapkan agar fitur Multi Outlet / Cabang bisa diterapkan?"** — tanpa perubahan kode. Rincian eksekusi: **Prioritas 19 di `TO DO.md`**.

### F.0 — Kondisi saat ini (single outlet implisit `'default'`)

- **Semua tabel bisnis GLOBAL tanpa `outlet_id`**: `transactions`, `inventory`, `menus`, `menu_components`, `customers`, `promos`, `shifts`, `stock_logs`, `stock_opnames`, `cash_movements`, `audit_logs`. Satu-satunya pengecualian: `queue_counters.outlet_id` (sudah ada, default `'default'`) — fondasi nomor antrean per outlet sudah benar di level DB.
- **`Transaction.outletId?: string`** sudah ada di tipe (`src/types/index.ts:175`, komentar "Multi-outlet enterprise extension") tapi **belum pernah diisi/dipakai** — hanya placeholder.
- **Settings single row** (`settings.id = 1`): `store_name`, `address`, `receipt_header/footer`, `tax_enabled/percent`, `categories`, `printer_*`, `kitchen_printers`, `table_features`, dll — **global untuk semua cabang**; struk & pajak tidak bisa berbeda per cabang.
- **Users tanpa outlet**: role hanya `Manager | Kasir | Acaraki | Staf Gudang` (tidak ada `Owner`); seorang user tidak terikat ke cabang mana pun.
- **RLS semua tabel "Allow all for anon"** (`supabase/schema.sql` baris 428–439, 486, 612) — tidak ada scoping antar cabang sama sekali.
- **`allocateQueueNumberCloud` hardcode `p_outlet: 'default'`** (`src/lib/cloudSync.ts:737`) — RPC `allocate_queue_number` sudah menerima `p_outlet`, tinggal dikirim id outlet asli.
- **Realtime global** (`postgres_changes` tanpa filter) & **semua `fetch*FromCloud` tanpa filter** — setiap device menarik SEMUA data cloud semua cabang.
- **Shift** sudah ber-model "1 shift aktif per outlet" (18.3) tapi outlet-nya implisit `'default'`.
- **Backup/Restore** mem-backup seluruh DB (manifest + checksum) — tidak mengenal cabang.

### F.1 — Keputusan produk yang HARUS diambil dulu (menentukan seluruh desain)

1. **Model master data**: (a) **independen per cabang** (tiap cabang punya menu/inventaris/resep/promo/pelanggan sendiri — paling sederhana, cocok untuk waralaba dengan menu berbeda), (b) **pusat→cabang** (katalog didorong dari pusat, cabang hanya punya stok — butuh mekanisme push/sync master + versi), atau (c) **hibrida** (menu sama, stok & harga per cabang). **Rekomendasi awal: (a) independen** untuk MVP multi-outlet — paling sedikit perubahan pada engine/resep/validasi stok yang sudah solid.
2. **Akses pengguna**: user terikat **1 cabang** (Kasir/Staf Gudang/Dapur) vs **lintas cabang** (Manager/Owner bisa pindah cabang). Perlu menambah role **Owner** (saat ini tidak ada) sebagai super-admin multi-cabang.
3. **Identitas outlet**: id stabil (UUID/TEXT), nama, alamat, dan **settings per outlet** (nama toko di struk, alamat, footer, pajak, kategori, printer — tiap cabang beda hardware printer & pajak daerah).
4. **Nomor antrean**: sudah per-outlet di DB — keputusan: nomor restart tiap hari per cabang (perilaku sekarang, tinggal plumb `outlet_id` asli) atau lanjut global.
5. **Loyalty/promo lintas cabang**: poin & batas pemakaian per pelanggan — shared antar cabang (pelanggan sama di semua cabang) vs per cabang.

### F.2 — Checklist persiapan teknis (berurutan)

**Fase 1 — Fondasi data (migrasi, satu arah):**
- [ ] Kolom `outlet_id` di SEMUA tabel bisnis + **backfill idempoten** ke `'default'` (outlet pertama) — pola Migration 27–30 (probe + ALTER/UPDATE + console warning).
- [ ] `settings` jadi per-outlet (row per `outlet_id` atau ganti PK) — migrasi nilai row 1 → outlet `'default'`.
- [ ] `users.outlet_id` (atau tabel `users_outlets` untuk multi-assignment) + tambah role `Owner` pada CHECK.
- [ ] **RLS per-outlet** menggantikan "Allow all for anon": helper `current_outlet_id()` (dari JWT claim / header) + policy `USING (outlet_id = current_outlet_id())` per tabel — termasuk `settings`, `queue_counters`, `stock_logs`, `audit_logs`.

**Fase 2 — Aplikasi (sync & alur inti):**
- [ ] `currentOutlet` di auth store: pilih cabang saat login; **switch outlet** untuk Manager/Owner; guard halaman per cabang.
- [ ] Semua `fetch*FromCloud` + realtime + offline queue payload + `loadFromCloud` di-scope `outlet_id` (queue ops membawa `outlet_id`; tombstone & freshness compare per outlet).
- [ ] `allocateQueueNumberCloud` kirim `outlet_id` asli (hapus hardcode `'default'`); guard shift 1-per-outlet memakai id asli; engine stamp `Transaction.outletId`.
- [ ] Laporan (Penjualan/PPN/Promo/Refund/Shift/Kas) & Dashboard **filter per outlet**; struk termal & digital memakai `store_name`/alamat **per cabang**; label nama cabang di header.
- [ ] Settings halaman: pilih cabang yang sedang dikonfigurasi (Manager) — pajak, kategori, printer, tabel, struk per cabang.
- [ ] Backup/Restore: manifest menyimpan `outlet_id`; **restore per cabang** (tidak menimpa cabang lain); auto backup per cabang.

**Fase 3 — Lanjutan (nilai enterprise):**
- [ ] **Transfer stok antar cabang** (stock transfer + log khusus) — kebutuhan nyata multi-outlet.
- [ ] **Laporan konsolidasi** multi-cabang untuk Owner (gabungan vs per cabang).
- [ ] Master data push pusat→cabang (bila memilih model (b)/(c)); pelanggan & loyalty lintas cabang (bila shared).
- [ ] Permission granular per outlet per role (Kasir cabang A tidak melihat cabang B).

### F.3 — Yang SUDAH siap / memudahkan

- `queue_counters.outlet_id` + RPC `allocate_queue_number(p_outlet)` — fondasi antrean per cabang **sudah ada**.
- Konsep "1 shift aktif per outlet" & `computeShiftStats` (18.3) — tinggal plumb id outlet.
- `Transaction.outletId` placeholder — tinggal diisi engine.
- Offline queue, tombstone, freshness compare (`updatedAt`), RPC atomik, backup manifest — semua **bisa di-scope per outlet** tanpa mengubah mekanisme.
- Arsitektur local-first + sync cloud (bukan SQL langsung) — penambahan kolom filter relatif aman.

### F.4 — Risiko & catatan

- **RLS per-outlet adalah titik paling sensitif**: salah policy = kebocoran data cabang lain ATAU data hilang dari pandangan (fallback anon harus tetap jalan untuk device lama). Saran: ship RLS per-outlet **setelah** semua store konsisten menyertakan `outlet_id` di tiap payload.
- **Dua cabang di device yang sama**: tidak didukung (satu device = satu outlet aktif) — perlu keputusan; solusi sederhana: logout/login pindah cabang.
- **Realtime per cabang**: subscribe dengan filter `outlet_id=eq.<id>` (bukan global) untuk hemat bandwidth & privasi.
- **KDS/dapur per cabang**: printer & antrean tiket sudah per-device; tinggal pastikan tiket hanya keluar di printer cabang yang sama.
- **Estimasi dampak**: ~25–35 file tersentuh (types, schema, cloudSync, auth, semua store filter, layout/login, settings, laporan, backup) + ~15–20 test baru. Rekomendasi: kerjakan **bertahap** (Fase 1 → 2 → 3) dengan satu migration besar di awal.

### F.5 — Deep dive 19.13: sinkronisasi katalog PUSAT → CABANG (reuse infra sync yang ada)

> Analisa mendalam untuk model **pusat→cabang** (master data didorong dari pusat). Bertujuan menjawab: *"bagaimana infrastruktur sync yang sudah ada bisa dipakai tanpa konflik?"*

**F.5.1 — Data master yang di-push** (katalog): `menus` (nama, kategori, harga, bestseller, `ingredients`, `available_addons`, `manual_hpp`, `kitchen_target`, flag gula/suhu, `is_bundle`), `menu_components` (struktur bundle/add-on), **definisi bahan** di `inventory` (nama, unit, `cost_per_unit` — TAPI `stock` & `min_stock` tetap lokal per cabang), dan `categories` (settings).

**F.5.2 — Infrastruktur yang SUDAH ADA & bisa dipakai ulang:**

| Kebutuhan push | Infra yang ada | Catatan |
|---|---|---|
| Tulis katalog dari pusat | `syncMenu` → `smartUpsert('menus')` + `bundleRepository.syncComponentToCloud` + offline queue + retry | Reuse penuh — pusat adalah satu penulis |
| Cabang terima realtime | `subscribeToMenuComponents` + subscription global (posgres_changes) | Tinggal tambah filter `outlet_id=eq.<id>` (Fase 2) |
| Cabang offline saat push | `fetchMenusFromCloud` + `loadFromCloud` saat reconnect | Perlu **watermark** (lihat F.5.3-4) |
| Merge tanpa konflik stok | LWW `updated_at` inventory (A5/Migration 29) | `stock` TIDAK ikut di-push — kolom per cabang |
| Penonaktifan menu | `is_available` + tombstone `deletedLocalIds` (O-8) | Soft-delete lebih aman daripada DELETE (CASCADE resep) |
| Backup katalog | manifest backup (7.x) `MASTER_DATA` | Tambah scope `outlet_id` (19.10) |

**F.5.3 — Masalah inti & solusinya:**

1. **Referensi antar-tabel (masalah TERBESAR)**: `menu_components.child_id`, `menus.ingredients`, `available_addons` mereferensikan id menu/bahan. Bila cabang memakai id lokal sendiri (random/UUID), resep pusat yang mereferensikan **id pusat tidak cocok** → resep rusak, HPP salah, stok tidak terpotong. **Solusi: id master data dibuat DETERMINISTIK oleh pusat** (satu id yang sama di semua cabang; cabang hanya menerima, tidak menciptakan). Ini menghilangkan kebutuhan mapping id per cabang.
2. **Dua lapis inventory**: `name`/`unit`/`cost_per_unit` = definisi (master pusat); `stock`/`min_stock` = kondisi lokal per cabang. Push katalog **tidak menyentuh `stock`** → konflik stok antar device cabang yang sama tetap ditangani A5 LWW (sudah ada).
3. **Konflik tulis (satu arah vs dua arah)**:
   - **Opsi A — catalog READ-ONLY di cabang (rekomendasi MVP)**: cabang tidak bisa edit nama/harga/resep/bahan — hanya `stock`, `min_stock`, dan `is_available` (buka/tutup jual) yang lokal. Hanya 1 penulis (pusat) → LWW aman **by construction**, tidak ada konflik sama sekali. UI Edit Menu di cabang men-disable field master + label "Dikelola pusat".
   - **Opsi B — override per-field (lanjutan, bila cabang butuh harga/menu beda)**: kolom `source` ('center'/'branch') + `branch_override` + `updated_at`; merge rule: field yang di-override cabang & lebih baru → cabang menang (tandai untuk review pusat); selain itu pusat menang. Butuh UI deteksi konflik + resolusi manual.
4. **Watermark pull (hemat bandwidth & anti-timpa)**: `menus` & `menu_components` **belum punya `updated_at`** — tambah (pola A5). Cabang yang offline saat push → saat reconnect `fetch` hanya `WHERE updated_at > last_catalog_sync` + merge; stok lokal tidak ikut tertimpa karena kolom terpisah.
5. **Bulk push / event storm**: push 100 menu = 100 realtime event per cabang. Skala kecil OK; skala besar → **RPC `push_catalog_batch`** atau pull-based watermark (rekomendasi: pull-based lebih aman untuk bulk).
6. **Penghapusan**: `DELETE` menu pusat → `menu_components` ON DELETE CASCADE → resep hilang permanen. **Rekomendasi: soft-disable** (`is_available=false` + tombstone O-8 untuk cabang offline); DELETE nyata hanya lewat jalur khusus/backup.

**F.5.4 — Alur yang diusulkan (semua memakai infra yang ada):**

1. **Pusat ubah menu** → `smartUpsert('menus', {... source:'center', updated_at})` + komponen via `bundleRepository` (persis jalur `syncMenu` sekarang, + kolom baru).
2. **Cabang online** → realtime event → `loadFromCloud` merge (pola A5 LWW: `updated_at` pusat lebih baru → adopsi; `stock`/`is_available` lokal dipertahankan karena merge field-wise / kolom terpisah).
3. **Cabang offline saat push** → tidak terima realtime → saat reconnect: `fetchMenusFromCloud(watermark)` → merge → toast "Katalog diperbarui dari pusat (N menu)".
4. **Stok cabang** → tidak tersentuh push → antar device cabang yang sama tetap A5 LWW (sudah ada).

**F.5.5 — Perubahan yang dibutuhkan (untuk nanti di TO DO):**
- `menus` + `outlet_id`, `source`, `updated_at` (+ opsional `branch_override`); `menu_components` + `outlet_id`, `updated_at`; `inventory` + `outlet_id`, `source`.
- RLS per outlet (19.4) menutup akses antar cabang; settings per outlet (19.2) untuk kategori per cabang.
- Guard UI read-only di cabang (Opsi A) — field master disabled.
- Estimasi: +3 kolom per tabel, ~10–15 file (types, schema, cloudSync watermark, menuStore merge, Catalog guard, Layout/backup), ~10 test (merge catalog, watermark pull, read-only guard, push batch).

**F.5.6 — Trade-off & rekomendasi:**
- **MVP: Opsi A (read-only catalog, id deterministik dari pusat, definisi bahan shared + stok lokal)** — konflik = nol, reuse penuh infra sync yang ada, paling cepat ship.
- **Upgrade path: Opsi B** (override per-field) bila kebutuhan nyata muncul (cabang beda harga/menu) — butuh kolom `source` + merge rule + UI konflik.
- Keputusan penting yang belum diambil: apakah **harga bahan** (`cost_per_unit`) di-push (HPP sama semua cabang) atau per cabang (HPP beda per daerah — rekomendasi: per cabang, karena biaya bahan berbeda-beda).

### F.6 — Deep dive 19.13g: skema ID DETERMINISTIK untuk master data pusat→cabang

> Analisa mendalam: *"bagaimana meng-generate id menu/bahan yang stabil & unik global tanpa collision antar cabang yang offline?"*

**F.6.1 — Kondisi saat ini**: `menus` & `inventory` memakai **UUID v4 acak yang dibuat lokal** (`Catalog.tsx:175` `editId || uuid()`, `inventoryStore.ts:36/109/143/200` `id: uuid()`; `menu_components.id` memakai komposit `${parentMenuId}-comp-${idx}-${childId}`). UUID v4 = 122 bit acak → **secara statistik tidak akan bertabrakan antar cabang offline** (masalah "collision" tidak nyata). Masalah sebenarnya ada di **identitas logika lintas cabang**: dua cabang yang membuat item yang sama secara independen menghasilkan **id berbeda** → pusat tidak bisa tahu itu item yang sama → dedupe/merge butuh mapping manual.

**F.6.2 — Opsi skema id yang dipertimbangkan:**

| Opsi | Mekanisme | Kelebihan | Kekurangan |
|---|---|---|---|
| **1. UUID v4 + id dibawa push** (status quo) | Pusat buat, id ikut di-push | Sudah dipakai, nol perubahan, nol collision | Item yang sama dibuat independen di 2 cabang = 2 id beda; dedupe butuh mapping nama |
| **2. UUID v5 (deterministik)** ⭐ | `v5(NAMESPACE_tipe, key_bisnis)` — input sama → id sama di mana pun, offline-capable | Id sama lintas cabang **tanpa koordinasi**; dedupe & deteksi konflik by identity; cabang offline membuat item → id = id yang akan dibuat pusat | Rename mengubah id (butuh `key` stabil, id immutable); butuh migrasi data lama |
| **3. Komposit ber-awalan asal** (`center:menu:…` / `cabang-b:menu:…`) | Id membawa asal + tipe | Asal jelas, bantu RLS/traceability | Referensi anak jadi tergantung asal — resep pusat yang mereferensikan id center tetap valid, tapi item buatan cabang beda namespace → membingungkan untuk merge |
| **4. Urutan dari pusat (RPC counter)** | Alokasi id via counter (pola `queue_counters`) | Ringkas, terurut | Cabang offline butuh id → harus reservasi batch; tambah dependensi jaringan saat kreasi — **overkill untuk master data** |

**Rekomendasi: Opsi 2 (UUID v5 berbasis business key), paket `uuid` sudah ada di project (v5 tersedia).**

**F.6.3 — Desain rekomendasi (UUID v5 + `key` stabil):**

1. **Namespace per tipe**: `NAMESPACE_MENU`, `NAMESPACE_INVENTORY`, `NAMESPACE_COMPONENT` — `v5(MENU_NS, key)` tidak akan bertabrakan dengan `v5(INV_NS, key)` meski key sama.
2. **Business key = `key` (slug/SKU), BUKAN nama tampilan**: nama bisa berubah ("Es Teh Manis" → "Es Teh"); rename akan mengubah id bila key = nama → refs rusak. **`id` bersifat immutable; `key` adalah identitas dedupe** (pola seperti username/email pada akun): rename mengubah `key` + `name`, `id` tetap.
   - Aturan key: lowercase, tanpa aksen/spasi (slug), panjang dibatasi; bila ada **SKU/kode item** manual di form → SKU prioritas; fallback slug(nama).
3. **Validasi keunikan key saat kreasi** (pola validasi promo P-A2): cek key belum dipakai di store/cloud sebelum simpan; tabrakan → toast + saran SKU unik (bukan diam-diam menimpa).
4. **Kreasi offline di cabang**: cabang membuat item → `v5(NS, key)` dihitung lokal → id SAMA dengan yang akan dihasilkan pusat → saat sync naik (model B) pusat melihat id sama → **tidak ada duplikat**; beda isi → konflik = item logika sama → resolusi via `source`/`updated_at` (Opsi B F.5.3-3).
5. **Referensi tetap stabil**: `menu_components.child_id` & kunci `ingredients` (id bahan) kini deterministik → **dua cabang offline menyusun resep untuk bahan yang sama menghasilkan referensi yang sama** → resep buatan cabang kompatibel saat di-push ke pusat/cabang lain. Ini kemenangan inti opsi 2.
6. **Skala & tabrakan key**: risiko bergeser dari "collision id" (nol) ke **tabrakan key** (dua item berbeda punya slug sama) — ditangani: SKU prioritas, suffix numerik `-2` bila slug bentrok, validasi kreasi.

**F.6.4 — Migrasi data lama (penting):**
- Tambah kolom `key TEXT` (nullable) di `menus` & `inventory`; **backfill** `key = slug(name)` untuk yang unik, `slug(name)-2/-3…` untuk duplikat, kosong bila tak bisa disimpulkan.
- **Id lama TIDAK ditulis ulang** (jangan rewrite UUID v4 → v5): transaksi/stock log/resep snapshot menyimpan referensi id lama; rewrite = refs patah. Id lama tetap dipakai selamanya.
- Push pusat→cabang melakukan **adopsi by key**: item lama yang key-nya sama tapi id beda (legacy buatan cabang) → hanya di-adopt untuk item BARU; item legacy dibiarkan kecuali ada aksi eksplisit "adopsi katalog pusat" (mapping `key → id` dicatat di tabel lookup bila perlu).
- Komponen (`menu_components`) memakai id induk deterministik untuk item baru; item legacy memakai id lama — tidak masalah karena referensi mengikuti id induk yang ada.

**F.6.5 — Ringkasan keputusan:**
- Pakai **UUID v5** (`v5(NAMESPACE_tipe, key)`), id **immutable**, `key` = identitas dedupe (SKU prioritas / slug fallback).
- Validasi keunikan key saat kreasi + suffix bentrok.
- Migrasi: tambah `key`, backfill slug, **jangan rewrite id lama**; adopsi by key hanya untuk item baru.
- Dampak: ~6–8 file (types, `idgen.ts` baru, Catalog/Inventory kreasi, validasi, migrasi) + ~8–10 test (v5 deterministik per tipe, key collision, rename immutability, migrasi legacy).

### F.7 — Deep dive 19.13h: adopsi item LEGACY (key sama, id berbeda) — skenario, risiko refs, tabel lookup

> Analisa mendalam: *"bagaimana menangani item lama yang key-nya sama dengan katalog pusat tapi id-nya berbeda saat adopsi, tanpa mematahkan referensi?"*

**F.7.1 — Peta referensi id di runtime (yang bisa "patah"):**

| Referensi | Lokasi | Jenis |
|---|---|---|
| `menus.ingredients` (kunci = id bahan) | JSONB di row `menus` | **Aktif** (hot path deduksi stok) |
| `AddOn.ingredients` (kunci = id bahan) | JSONB `available_addons` | **Aktif** |
| `menu_components.child_id` (→ menu/bahan) | tabel relasional | **Aktif** (engine bundle) |
| Recipe snapshot transaksi (`RecipeIngredientSnapshot.inventoryId`) | JSONB di `transactions` | **Historis** (audit, tidak boleh diubah) |
| `StockLogEntry.inventoryId` (`stockLogStore.ts:11`) | riwayat stok | **Historis** |
| `StockOpnameItem.inventoryId` | riwayat opname | **Historis** |
| Split reserve session (kunci per `inventoryId`, `splitStockSession.ts`) | localStorage | **Aktif sementara** |
| Keranjang POS (`CartItem.menuId`) | store sesi | **Aktif sementara** |

> Catatan: `manual_` prefixed pseudo-id (`hpp.ts:53/93`) bersifat sintetis — tidak perlu di-adopt.

**F.7.2 — Skenario yang mungkin terjadi:**

- **S1 — Item masih dipakai resep aktif**: menu lokal memakai bahan A (`ingredients: {A: 2}`); adopsi A→B. Bila `ingredients` tidak di-rewrite → `calculateItemDeductions` tidak menemukan bahan → **stok tidak terpotong** (bocor) + warning A11 "bahan tidak ditemukan". **Harus rewrite aktif.**
- **S2 — Item sudah dipakai transaksi masa lalu**: snapshot lama menyimpan `inventoryId: A` + `inventoryName` (tersimpan). **Jangan rewrite** — itu jejak audit; tampilan laporan tetap benar karena nama ada di snapshot. Risiko hanya pada lookup stok-by-id (join ke inventory gagal → perlakukan sebagai "bahan dihapus", pola A11).
- **S3 — Dua cabang legacy A1 & A2, key sama, stok terpisah**: adopsi keduanya → B. Stok A1+A2 harus digabung/dipindah EKSPLISIT (keputusan: gabung otomatis vs pindah manual) — salah gabung = selisih stok nyata.
- **S4 — Item dipakai keranjang / split reserve AKTIF**: reserve session keyed by A → setelah adopsi, cap tidak cocok → **double deduction** (kelas masalah A6). **Guard: tolak adopsi saat ada cart/reserve aktif memakai item** (atau lakukan di luar jam operasional).
- **S5 — Bundle**: `menu_components.child_id` bisa menunjuk menu lain; adopsi child menu → rewrite berantai (urut: child dulu, parent belakangan) ATAU resolve-at-read membuat urutan tidak penting.
- **S6 — Item murni lokal cabang (tidak ada di pusat)**: **tidak di-adopt** — tidak disentuh sama sekali.

**F.7.3 — Risiko refs patah (terinci):**
- **Hot path (checkout)**: `ingredients`/`child_id` salah → deduksi stok bocor/keliru, bundle tidak terurai, HPP salah. **Tidak boleh terjadi** → wajib rewrite terkontrol.
- **Historis**: snapshot/log/opname dengan id A — tampilan tetap OK (nama tersimpan); hanya lookup by-id yang gagal → perlu fallback (pola A11).
- **Sesi aktif**: keranjang & reserve split — guard operasional + resolve-at-read saat baca sesi lama.
- **Kesalahan umum yang harus dihindari**: (1) rewrite snapshot historis (merusak audit), (2) rewrite id di row yang sedang dipakai transaksi berjalan (race), (3) menghapus item A (harus tombstone, bukan DELETE), (4) mengabaikan penggabungan stok A1+A2.

**F.7.4 — Tabel lookup yang aman (`item_identity`):**

```sql
CREATE TABLE IF NOT EXISTS item_identity (
  item_id TEXT PRIMARY KEY,      -- id item yang dipakai di referensi (lama atau baru)
  key TEXT NOT NULL,             -- business key (slug/SKU) — identitas dedupe
  kind TEXT NOT NULL CHECK (kind IN ('menu','inventory')),
  canonical_id TEXT,             -- NULL = dirinya kanonik; terisi = di-adopt ke id ini
  outlet_id TEXT NOT NULL DEFAULT 'default',
  adopted_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_item_identity_key ON item_identity(key, kind);
```

- **Aturan invariant**: (1) `canonical_id` hanya satu arah (legacy → kanonik, TIDAK boleh rantai: canonical menunjuk item yang juga punya canonical — guard saat tulis); (2) item kanonik = `canonical_id NULL`; (3) satu `(key, kind)` hanya satu baris kanonik per outlet (unique index).
- **Resolve saat baca**: `resolveRef(refId) = COALESCE(canonical_id, item_id)` — dipakai di lookup inventory/child (hot path TETAP memakai id hasil rewrite sehingga cepat; resolve hanya untuk histori/laporan & sesi lama).
- **Mengapa aman**: refs historis (A) tetap tersimpan apa adanya; rewrite fisik HANYA untuk data aktif yang berubah (menus.ingredients, menu_components) lewat migrasi terkontrol; item_identity menjadi jejak pemetaan + fallback lookup — bukan pengganti rewrite.

**F.7.5 — Strategi adopsi bertahap yang aman (rekomendasi):**

1. **Identifikasi** (Fase 0): scan item aktif vs katalog pusat by key → daftar calon adopsi (key sama, id beda) + item murni lokal (dikecualikan).
2. **Guard operasional**: tolak bila ada cart aktif / split reserve session memakai item (device sedang transaksi); rekomendasi eksekusi di luar jam operasional.
3. **Rewrite aktif terkontrol** (Fase 1): ganti kunci `menus.ingredients` & `AddOn.ingredients` (A→B) + `menu_components.child_id` (A→B, urut child→parent untuk bundle); **gabungkan stok** A+B → B (keputusan eksplisit: otomatis vs manual); tulis `item_identity` untuk setiap pasangan.
4. **Tombstone A** (Fase 2): `is_available=false` + `deletedLocalIds` (O-8) — device lain ikut tahu; **JANGAN DELETE** (histori & refs lama tetap valid).
5. **Snapshot historis dibiarkan** (Fase 3): transaksi/log/opname lama tetap A + nama tersimpan → laporan normal; lookup by-id via `item_identity.resolveRef` bila perlu.
6. **Sesi lama** (Fase 4): `splitStockSession`/keranjang lama di-reconcile via resolve-at-read — sesi yang tersimpan sebelum adopsi tetap aman.
7. **Push model**: pusat menulis `item_identity` saat adopsi → cabang menerima via realtime/watermark → resolve konsisten di semua device.

**F.7.6 — Risiko residual terdokumentasi:**
- Rewrite aktif tidak bisa 100% dijamin bebas race (guard mengurangi, tidak menghilangkan) — mitigasi: eksekusi di luar jam operasional + backup sebelum adopsi (reuse backupService 7.x).
- Penggabungan stok A1+A2 lintas cabang harus eksplisit (keputusan bisnis, bukan otomatis diam-diam).
- Item legacy yang TIDAK di-adopt (murni lokal) — tetap berjalan seperti sekarang (tidak terpengaruh).
- Dampak implementasi: ~4–5 file (migrasi SQL + `itemIdentity.ts` baru + resolve di lookup + guard adopsi) + ~10 test (invariant rantai, resolve, rewrite menu/bundle, guard sesi aktif, gabung stok).

### F.8 — Deep dive 19.13h2: aturan PENGABUNGAN STOK saat adopsi A1+A2 → B

> Analisa mendalam: *"otomatis vs manual, nasib riwayat stock log yang tetap di A1/A2, dan dampak ke laporan selisih opname."*

**F.8.1 — Klarifikasi model (penting): stok PER CABANG.**

Dalam model multi-outlet, `stock` adalah kolom per outlet (per cabang). Maka skenario "A1 + A2" perlu dipecah menjadi DUA situasi yang berbeda:
- **Lintas cabang**: cabang 1 punya A1 (stok 5), cabang 2 punya A2 (stok 3) → keduanya di-adopt ke B. **TIDAK ada penggabungan stok lintas cabang** — tiap cabang mempertahankan stoknya sendiri di bawah id terpadu B (B di cabang 1 = 5, B di cabang 2 = 3). Ini aman by design dan tidak menimbulkan pertanyaan.
- **Dalam satu cabang** (kasus yang benar-benar perlu aturan): cabang memiliki A (legacy) DAN B (hasil push pusat) secara bersamaan dengan stok di keduanya → di sinilah keputusan gabung otomatis vs manual berlaku.

**F.8.2 — Aturan rekomendasi: otomatis bila salah satu nol, manual bila keduanya > 0.**

| Kondisi stok dalam cabang | Aturan | Alasan |
|---|---|---|
| `B.stock = 0` (baru di-push, belum pernah dipakai) | **Otomatis**: `B.stock += A.stock`, tombstone A | Tidak ada konflik — B kosong, A satu-satunya sumber stok nyata |
| `A.stock = 0` (A sudah habis) | **Otomatis**: adopsi id saja, tanpa perpindahan stok | Tidak ada stok yang perlu dipindah |
| **Keduanya > 0** | **Manual** — dialog per item: (1) gabung (`B += A`), (2) pindah manual dengan nominal, (3) jadikan item terpisah (A tidak di-adopt) | Dua sumber stok nyata = kemungkinan key-collision palsu (dua item beda yang slug-nya sama) ATAU stok ganda yang memang harus digabung — keputusan bisnis, bukan otomatis diam-diam |
| Stok A negatif/aneh | **Manual + peringatan** (pola clamp 10.4) | Jangan pernah menggabung nilai abnormal tanpa konfirmasi |

- **Ambiguitas yang membuat "keduanya > 0" harus manual**: slug collision palsu (mis. "Gula" vs "Gula Merah" → slug `gula` vs `gula-merah` sebenarnya beda, tapi "Gula Aren" & "Gula" bisa bentrok bila slug dipotong); harga/cost per unit A ≠ B (bahan beda sebenarnya); A & B sudah punya riwayat penjualan masing-masing.
- **Tulis stok gabungan dengan DELTA, bukan set absolut**: `B.stock += A.stock` lewat `adjust_inventory_stock` (RPC atomik 18.1/Migration 27) — dua device cabang yang sama meng-adopsi bersamaan tidak bisa double-count (RPC delta + row-lock).

**F.8.3 — Riwayat stock log yang tetap di A1/A2 (tidak di-rewrite):**

- `StockLogEntry` menyimpan `inventoryId`, `inventoryName`, `stockBefore`, `stockAfter`, `type`, `reason` (`stockLogStore.ts:9–19`) — riwayat A **dibiarkan utuh** (audit; konsisten F.7.3).
- **Catatan adopsi**: tambah 1 entry di B (`type: 'add'`, amount = +A.stock, reason "Adopsi katalog pusat: gabung stok dari {nama A}") + 1 entry di A (`type: 'adjust'`, `stockAfter: 0`, reason "Di-adopsi ke {B}") — jejak lengkap di kedua sisi.
- **Dampak ke UI riwayat**: `getLogsByItem(B)` hanya menampilkan log B → riwayat lama A hilang dari pandangan. **Solusi rekomendasi: resolve-at-read saat menampilkan riwayat** — lookup B → sertakan log A (via `item_identity`) dengan label "sebelum adopsi: {nama A}". Alternatif lebih sederhana: tampilkan log B + entry adopsi saja (riwayat A tetap ada di DB, bisa diakses via filter id lama).
- **Dampak ke laporan stok** (laporan yang mengagregasi stock log): agregasi per id akan memisah A (historis) & B (baru) — wajar; agregasi per `key` (bila laporan memakai key) otomatis menyatukan.

**F.8.4 — Dampak ke laporan selisih OPNAME (paling sensitif):**

- `StockOpnameItem` menyimpan `inventoryId` + `systemStock` **saat opname dibuka** (`StockOpname.tsx:52`), `difference = actual − systemStock`, `lossValue = abs(diff) × costPerUnit` (baris 84–90); laporan loss mengagregasi `lossValue` per reason (`Reports.tsx:1675–1677`).
- **Bila adopsi terjadi DI TENGAH opname aktif**: A di-tombstone (`stock` → 0/terpindah) → `systemStock` A (nilai saat buka, mis. 5) jadi selisih −5 (seolah kehilangan) PADAHAL stoknya pindah ke B; B muncul dengan stok gabungan → laporan opname jadi bingung (loss A + gain B palsu).
- **Mitigasi (wajib)**: **guard adopsi menolak saat ada opname AKTIF** (pola yang sama dengan guard cart/split reserve F.7.2-S4) — opname harus diselesaikan dulu, atau adopsi dilakukan di luar jam operasional.
- **Opname yang sudah selesai (historis)**: tetap memakai id & cost A (tersimpan di item) → laporan loss historis TIDAK berubah (audit utuh).
- **Opname baru setelah adopsi**: memakai B (id baru, `costPerUnit` B per cabang — F.5.6) → normal.
- **Catatan biaya**: `lossValue` memakai `costPerUnit` yang tersimpan per item opname — beda cost A vs B tidak mengubah laporan historis.

**F.8.5 — Alur eksekusi yang disarankan (dalam satu cabang):**

1. Guard: tolak bila ada cart aktif / split reserve / **opname aktif** memakai item (F.7.2-S4 + F.8.4).
2. Klasifikasi per item: otomatis (salah satu nol) vs manual (keduanya > 0 — dialog per item).
3. Otomatis: `adjust_inventory_stock(B, +A.stock)` (RPC delta) → rewrite refs aktif (F.7.5-3) → entry log di A & B → tombstone A → tulis `item_identity`.
4. Manual: dialog per item → gabung / pindah nominal / jadikan terpisah (tidak di-adopt); sisanya sama seperti langkah 3.
5. Backup dulu (reuse `backupService` 7.x) — adopsi adalah operasi sekali-jalan yang mengubah stok.

**F.8.6 — Risiko residual terdokumentasi:**
- Gabung otomatis "salah satu nol" tetap punya risiko bila A negatif atau B ternyata bukan item sama (key collision) — diperkecil oleh klasifikasi di F.8.2.
- Race dua device cabang sama meng-adopsi bersamaan — ditutup RPC delta (18.1); sisanya guard sesi.
- Riwayat log A tidak muncul di filter id B tanpa resolve — keputusan UX (resolve vs cukup entry adopsi).
- Estimasi: +2 file (dialog gabung manual + logika klasifikasi), ~6–8 test (klasifikasi 4 kasus, RPC delta, guard opname aktif, entry log A&B, resolve riwayat, opname historis tidak berubah).

### F.9 — Deep dive 19.13h2e/f: SPESIFIKASI dialog gabung manual per item

> Spesifikasi implementable untuk dialog "Adopsi Katalog Pusat — item perlu keputusan" (dipicu saat klasifikasi **manual** di F.8.2: stok A & B keduanya > 0, atau A negatif/aneh). Konvensi UI mengikuti modal yang ada (`SplitBillModal.tsx`: `rounded-xl`, slate/amber banner, `formatRupiah` dari `src/utils/format`).

**F.9.1 — Konteks & akses:**
- Muncul per item dalam alur adopsi (F.7.5), hanya untuk item klasifikasi **manual**; item otomatis TIDAK lewat dialog ini (langsung dieksekusi + masuk ringkasan).
- **Role-gate**: hanya **Manager/Owner** (pola PIN 10.2) — dialog menolak Kasir/Staf Gudang.
- **Guard sebelum muncul**: bila ada opname aktif / cart aktif / split reserve yang memakai A atau B → dialog tidak bisa dikonfirmasi (tombol disabled + teks alasan), bukan hanya peringatan.

**F.9.2 — Layout dialog (list per item, bukan wizard per item):**
- **Header**: judul + ringkasan "N item memerlukan keputusan" + tombol "Otomatiskan sisanya" (menerapkan aturan F.8.2 ke semua item yang memenuhi syarat otomatis).
- **Baris per item** (scrollable):
  - Kolom kiri: nama A (label "Item lama · id {A}") vs nama B (label "Katalog pusat · id {B}"), badge **key sama** (`key = {slug}`), badge bendera bila **nama A ≠ nama B** atau **cost A ≠ cost B**.
  - Kolom stok: `A: {x} | B: {y}` → pratinjau live `→ A: {x'} | B: {y'}` per opsi terpilih.
  - **3 opsi radio** (kartu):
    1. **Gabung stok** (default) — `B.stock += A.stock`, A di-tombstone (rewrite refs aktif + `item_identity` + entry log di A & B, F.8.3).
    2. **Pindah sebagian** — input nominal `X` (0 ≤ X ≤ A.stock, default A.stock): `B += X`, `A.stock = A.stock − X`; **A tetap hidup** sebagai item mandiri → otomatis diberi `key` baru (`{slug}-lokal`, SKU baru) agar tidak bentrok dengan B; A **tidak di-adopt**.
    3. **Jadikan terpisah** — A **tidak di-adopt** sama sekali; stok A tetap di A; A diberi `key` baru (`{slug}-lokal`) + tidak disentuh refs-nya.
- **Footer**: tombol **Batal** (kembali tanpa perubahan) + **Konfirmasi (N item)** — disabled saat ada guard aktif.

**F.9.3 — Pratinjau dampak (live, sebelum konfirmasi):**
- **Stok**: tabel sebelum → sesudah per opsi (A/B/unit), total gabungan. Warning bila hasil negatif/NaN (clamp, pola 10.4).
- **Menu terdampak (rewrite refs)**: hitung jumlah menu yang `ingredients`/`AddOn.ingredients`/`menu_components.child_id` mereferensikan A (dari store) → "N menu akan diarahkan ke B".
- **Dampak HPP (kunci, karena cost A ≠ B)**: untuk setiap menu terdampak hitung HPP sebelum (pakai cost A) vs sesudah (pakai cost B) via `hpp.ts:17` (`costPerUnit * amount`) / `calculateBundleHPP` (`bundleService.ts:96`) — tampilkan daftar menu yang **berubah** dengan delta Rp (naik/turun) + total dampak margin; menu dengan `manualHpp > 0` dicatat "HPP manual — tidak terpengaruh".
- **Dampak lain**: jumlah bundle (child A), riwayat stock log A yang akan di-label ulang (count), item_identity yang akan ditulis.
- **Pratinjau dihitung ulang** saat opsi/nominal berubah — murni dari data store (helper murni `previewAdoption(item, option, x)` untuk unit test).

**F.9.4 — Peringatan risiko key-collision (banner amber, pola `SplitBillModal` baris 576):**
- Tampil bila salah satu: `costPerUnit` A vs B selisih > **10%**; nama A ≠ nama B (hanya key sama); stok A > 2× stok B; atau A pernah punya riwayat penjualan signifikan (jumlah transaksi memakai A).
- Teks: *"Kemungkinan dua item berbeda yang kebetulan memiliki key sama. Periksa sebelum menggabung."* + tombol **"Periksa manual"** → buka form edit item (detail A & B berdampingan) — tanpa menutup dialog.
- Setiap item yang memicu warning tetap bisa dikonfirmasi (keputusan tetap di Manager), tapi tercatat di audit log adopsi sebagai `flagged`.

**F.9.5 — Konfirmasi & eksekusi:**
- Sebelum eksekusi: **backup otomatis** (reuse `backupService` 7.x, manifest + `outlet_id`) — sekali untuk batch.
- Eksekusi per item sesuai opsi: RPC delta `adjust_inventory_stock(B, +X)` (F.8.2), rewrite refs aktif (F.7.5-3), entry log A & B (F.8.3), tombstone atau `key` baru, tulis `item_identity`, tulis audit log (role, jumlah item, `flagged`).
- **Idempoten**: item yang sudah punya baris `item_identity` tidak muncul lagi; double-click konfirmasi di-guard (pola A4 in-flight).
- **Toast ringkasan**: "Adopsi selesai — 3 digabung, 1 dipindah sebagian, 2 terpisah, 5 otomatis".
- **Tidak ada undo otomatis** (operasi sekali-jalan) — pemulihan via restore backup; catatan ini tampil di footer dialog.

**F.9.6 — Estimasi implementasi:**
- 1 komponen baru `AdoptionMergeDialog.tsx` + helper murni `adoptionPreview.ts` (klasifikasi, pratinjau, key baru, warning flags).
- ~10–12 test: klasifikasi + pratinjau (gabung/pindah/terpisah, HPP naik/turun, manualHpp), warning flags (cost >10%, nama beda, stok 2×), guard (opname/cart/split aktif), idempotensi (item_identity sudah ada), RPC delta dipanggil benar, audit log `flagged`.

### F.10 — Deep dive 19.13h2g/h: alur adopsi OTOMATIS (tanpa item manual) — batch, toast, audit log

> Analisa mendalam: *"bagaimana eksekusi batch, ringkasan toast, dan laporan ke audit log harus terlihat oleh Manager agar seluruh adopsi dapat diaudit."*

**F.10.1 — Alur batch eksekusi (semua item klasifikasi otomatis, F.8.2):**

1. **Pre-flight**: guard (opname/cart/split reserve aktif → batal dengan alasan); **backup otomatis** (reuse `backupService` 7.x, sekali per batch) → simpan `backupId`; bangun **rencana batch** (daftar item + opsi + delta stok + jumlah menu rewrite) dan simpan sebelum eksekusi (bahan rekonsiliasi & audit).
2. **Eksekusi berurutan per item** (anti race & idempoten): RPC delta `adjust_inventory_stock` → rewrite refs aktif → entry stock log A & B → tombstone/key baru → tulis `item_identity` → audit log. **Idempoten**: item yang sudah punya `item_identity` di-skip (retry aman).
3. **Kegagalan per item TIDAK membatalkan batch** (pola best-effort): item gagal dicatat + dilaporkan, bisa di-retry (idempoten). Gagal di level batch hanya bila backup/pre-flight gagal → batal total sebelum eksekusi apa pun.
4. **Verifikasi pasca-batch**: jumlah `item_identity` baru == jumlah dieksekusi; stok B == `B.awal + Σ delta`; **scan sisa refs aktif yang masih menunjuk A** (menus.ingredients / menu_components / addons) → bila ada sisa, warning + daftar.

**F.10.2 — Toast ringkasan (via `toastStore`, pola 14.6 alert→toast):**
- **Sukses** (hijau): *"Adopsi selesai — 12 item: 8 digabung, 2 dipindah, 2 terpisah (10 otomatis)"* + aksi sekunder "Lihat Audit" → halaman Audit Log.
- **Sebagian gagal** (amber): *"Adopsi selesai sebagian — 10 berhasil, 2 gagal (lihat detail)"* — item gagal tampil di daftar failed-ops / audit log untuk retry.
- **Gagal total** (merah): alasan (guard/backup) + tombol coba ulang (idempoten).
- Ringkasan selalu menyebut jumlah per aksi — Manager tahu persis apa yang terjadi tanpa membuka detail.

**F.10.3 — Audit log yang harus terlihat Manager (paling penting):**

- **Action baru `'catalog_adopt'`** di `AuditAction` (`types/index.ts:477`) + muncul di **filter dropdown** halaman Audit Log (`AuditLog.tsx:53`) — Manager bisa filter "Adopsi Katalog" dan melihat riwayat semua adopsi (per outlet).
- **Granularity (rekomendasi: 1 entry batch + per-item hanya untuk flagged)**:
  - **1 entry BATCH** (hemat cap audit log 1000, pola 6.1): `action: 'catalog_adopt'`, `detail: "Adopsi katalog pusat — 12 item: 8 digabung, 2 dipindah, 2 terpisah"`, `metadata: { outletId, mode: 'otomatis'|'campuran', backupId, total, merged, partial, separate, failed, flagged, verified, remainingRefs, startedAt, finishedAt, durationMs, items: [{itemA, itemB, key, option, stockDelta, costDelta}] }` — detail per item tersimpan dalam satu row (auditable tapi hemat kuota).
  - **1 entry PER ITEM hanya untuk item flagged/abnormal/gagal**: `metadata: { itemA, itemB, key, reason, flagged }` — item bermasalah mudah dicari tanpa membuka metadata batch.
- **Keterhubungan backup**: `backupId` di metadata batch menghubungkan adopsi ke backup otomatis pra-eksekusi → Manager bisa restore ke kondisi sebelum adopsi (karena tidak ada undo otomatis, F.9.5).
- **Audit lintas device**: `addLog` sudah `syncAuditLog` ke cloud (`auditLogStore.ts:38`) → riwayat adopsi terlihat di device mana pun (Manager/Owner), konsisten dengan model sync yang ada.

**F.10.4 — Dukungan UI untuk audit:**
- Halaman Audit Log: aksi "Adopsi Katalog" bisa di-filter & di-search; entry batch bisa dibuka (expand) menampilkan `items` metadata (daftar A→B, opsi, delta stok, delta cost, flagged).
- Tambahan opsional: blok ringkas di halaman Settings/Inventaris "Riwayat Adopsi Terakhir" (N terakhir, per outlet) dengan tombol "Lihat Audit Log" — memudahkan Manager tanpa harus filter manual.

**F.10.5 — Keputusan & estimasi:**
- 1 action baru + filter Audit Log otomatis (perlu cek daftar filter statis vs dinamis di `AuditLog.tsx` — bila statis, tambahkan); helper murni `buildAdoptionSummary(items)` + `buildAdoptionAuditMeta(...)` untuk unit test; toast ringkasan via `toastStore`.
- ~6–8 test: ringkasan counts benar, metadata batch (items array + backupId), flagged → entry per-item, batch sebagian gagal (retry idempoten via item_identity), verifikasi sisa refs, pesan toast.

## 🔍 G. AUDIT FITUR EKSISTING PASCA-PRIORITAS 18 (v4.7, belum dieksekusi)

> Audit menyeluruh fitur yang sudah ada: baseline 588/588 test hijau + scan pola bug + penelusuran logika area berisiko. Rincian eksekusi: **Prioritas 20 di `TO DO.md`**.

### G.1 — Temuan bug

**G-1 (🟠 SEDANG) — `computeShiftStats` tidak mengecualikan transaksi refunded** (`src/utils/shiftStats.ts:46-51`):
- `shiftTx` = `Selesai && !splitParentId && date >= openedAt` — **tanpa `!t.refunded`** → Total Penjualan & Total Transaksi di ringkasan tutup shift **overstated** saat ada refund. Dashboard (`Dashboard.tsx:65-66`), Reports (`filteredTx` baris 72-78), Transactions (`:195`) semuanya sudah exclude `!refunded` — **inkonsisten**.
- **Analisa netting expected cash** (penting, jangan asal fix): `expectedCash = opening + cashSales + cashIn − cashOut` di mana movement Refund ('out') ikut dihitung. Untuk **refund tunai**: sale refunded tetap di cashSales (+50k) dan movement (−50k) → net 0 → expectedCash benar. Bila refunded di-exclude dari cashSales TANPA menyesuaikan movement → double-subtract (expectedCash `opening − 50k` — salah).
- **Fix yang benar**: `totalSales`/`totalTx` dari subset non-refunded; `cashSales`/expectedCash pertahankan netting; residual kasus silang metode (sale tunai di-refund via QRIS: movement 'out' dicatat padahal uang tidak keluar laci → understated) — fix penuh butuh field `refundMethod` (enhancement).
- ✅ **SELESAI (v4.7 TO DO 20.1)**: `salesTx` (non-refunded) = basis laporan; **`refundedCashSales`** di-add-back ke expected cash (netting netral — secara matematis setara formula lama: `opening + cashSales_incl_refunded + cashIn − cashOut`); UI menampilkan baris "Refund Tunai (Dikembalikan)" bila > 0. +5 test, **593/593**.

**G-2 (🟢 MINOR/UX) — `alert()` tersisa di halaman non-printer** (~15 titik di AuditLog, CashMovements, Catalog, SettingsPage, App) — inkonsisten dengan konvensi toast (14.6).
- ✅ **SELESAI (v4.7 TO DO 20.2)**: 21 `alert()` → toast termasuk 4 temuan tambahan (StockOpname ×3, authStore ×1); kode produksi 0 `alert()` tersisa; `window.confirm` dipertahankan.

**G-3 (🟠 SEDANG) — Filter tanggal CUSTOM pakai UTC untuk tanggal awal (Laporan & Riwayat Transaksi)** (audit agregasi Laporan/Dashboard):
- `new Date(customDateFrom)` format `"YYYY-MM-DD"` tanpa `T` = **UTC tengah malam = 07:00 WIB**; `new Date(customDateTo + 'T23:59:59')` = lokal → transaksi **00:00–07:00 pada hari awal tidak masuk** range custom. Titik: `Reports.tsx:101`, `Reports.tsx:139`, `Transactions.tsx:153`. Kelas bug sama dengan fix 18.3 (pagi buta) yang sudah diterapkan di `queueNumber`/`transactionStore`/`cloudSync` — filter custom Laporan/Riwayat terlewat.
- ✅ **SELESAI (v4.7 TO DO 20.4)**: helper murni **`buildCustomDateRange(fromStr, toStr)`** di `src/utils/format.ts` — `from` parse **lokal** (`'T00:00:00'`), `to` lokal `'T23:59:59.999'`, fallback epoch/now; dipakai di 3 titik (Reports `filteredTx` + `dateFrom` opname/movement, Transactions custom). Test +5 (`dateRange.test.ts`): lokal midnight di zona mana pun, transaksi **03:00 lokal tanggal awal masuk**, 23:59:59.500 hari akhir masuk, batas ter-exclude, fallback. Validasi **598/598** (57 file), `tsc` 0 error.

**G-4 — Hasil audit agregasi Laporan & Dashboard yang AMAN (diverifikasi):**
- `filteredTx` mengecualikan `refunded` + `splitParentId` (sub-bill pending); sub-bill split FRESH (splitIndex tanpa parent) tetap masuk dengan kontribusi dibagi `splitContributionDivisor` (5.11) — benar untuk qty/revenue per kategori & menu (`categorySales`, Dashboard `menuSales`).
- **Per-kasir report** mengagregasi **uang riil per transaksi** (`t.totalAmount` per sub-bill fresh = 1/N, Σ = penuh) — **tidak perlu divisor** (benar).
- **P&L**: `netRevenue = Σsubtotal − Σdiskon`, HPP sub-bill equal proporsional (5.2: Σ hpp = hpp induk) → gross profit tidak ter-inflasi; `netProfit` termasuk opname loss (BUG-02).
- **PPN & promo report** memakai `filteredTx` (exclude refunded); tax per sub-bill fresh = 1/N → Σ = penuh.
- **Chart Dashboard** (revenue/laba harian, busy hours, bulanan) filter `Selesai && !splitParentId && !refunded` + agregasi uang riil — tanpa divisor (benar). Dashboard tidak punya input tanggal custom (hanya today/trend period) → tidak terkena G-3.

### G.2 — Yang diperiksa & dinyatakan AMAN (hasil verifikasi)

- **Mesin diskon promo** (`discountEngine.ts` + `promoDiscount.ts`): stacking (jumlah) vs eksklusif (auto best-deal: promo saja vs manual+loyalty saja), cap subtotal di semua mode; BOGO (beli N gratis M dari unit termurah, `bogoPercent` diskon sebagian); min-qty gate; usage limit global & per pelanggan (cek dari store saat commit — E7) — terpusat, teruji.
- **`promoAmount` = `discountCalc.promoApplied`** (nilai TER-APLIKASI/terkapit, `POS.tsx:245/847`) — laporan performa promo tidak overstate (fixed promo > subtotal aman).
- **Refund flow** (`refund.ts` + `Transactions.tsx:351-395`): `canExecuteRefund` cek ulang dari store + in-flight guard (A4); revert stok via `calculateItemDeductions` (recipeSnapshot); `revertVisit` kunjungan; `addMovement('out', Refund)` akuntabel; `updateTxMeta(refunded)` sync cloud; audit log — solid.
- **Auto-kirim struk WA** (`POS.tsx:803/915-931`): pre-open window hanya saat fitur aktif + pelanggan punya HP valid; **guard `!result.idempotentReplay`** — replay/double-click tidak kirim struk ganda; hanya transaksi baru.
- **Dashboard & Reports**: filter konsisten `Selesai && !splitParentId && !refunded`; PPN (`summarizePpn`) & promo report memakai `filteredTx` (exclude refunded) — akurat.
- **`catch {}`** di `cloudSync`/`usePrinterMonitor`/`OpenShiftModal` semuanya intentional fallback offline — bukan error swallow.
- **console.log** hanya diagnostik sync/engine (bukan debug leftover).
- Baseline: **588/588 test hijau** (56 file), tsc 0 error.

---

### H — Audit Flow Pending + Tambah Item + Split Bill + KDS

**Ringkasan**: Flow "Makan Dulu Bayar Nanti + Tambah Pesanan + Split Bill" sudah **didukung secara fungsional** (delta stok, rekonsiliasi, nomor antrean, finalize parent), tapi ada **5 temuan yang perlu diperbaiki** agar tidak terjadi tiket dapur dobel, rekonsiliasi ganda, dan kebingungan di KDS:

**Temuan:**

1. ✅ **Tiket Dapur Cetak Ulang Semua Item (21.1) — SELESAI**: `AtomicCheckoutParams` dapat `deltaKitchenItems`; engine cetak tiket HANYA item baru jika ada; POS.tsx hitung delta saat finalize pending dengan `pendingItemsChanged = true`. Test +4.

2. ✅ **Tiket Dapur Dobel saat Split dari Pending (21.2) — SELESAI**: `SplitBillModal` set `skipSplitKitchen = !!parentTx` saat modal dibuka → split dari pending otomatis skip tiket dapur (anti dobel); split fresh tetap cetak.

3. ✅ **Rekonsiliasi Ganda (21.3) — SELESAI**: `SplitBillModal` panggil `onReconcile?.()` setelah rekonsiliasi stok; `POS.tsx` track `pendingSplitReconciled` → jika true, `reservedDeductions = undefined` saat finalisasi (skip delta engine). Reset saat `onCompleteSplit`.

4. ✅ **Indikator Visual Pending (21.4) — SELESAI**: Badge **"✓ Diupdate"** (biru) di kartu pending jika `updatedAt > date + 5 detik` — deteksi otomatis, tidak perlu field tambahan.

5. ✅ **KDS: Tidak Ada Indikator "UPDATED" (21.5) — SELESAI**: `isUpdatedOrder()` deteksi via `updatedAt > date + 5 detik`; badge "🔄 Diupdate" + background biru di kartu; `isOverdue`/`getWaitingMinutes` pakai `updatedAt` untuk order update (timer restart); catatan "Pesanan diperbarui — periksa item baru" di bawah daftar item; label waktu "X mnt (sejak update)".

**Yang Sudah Benar**: delta stok, rekonsiliasi idempoten, `shouldSkipKitchenPrintAtResume`, nomor antrean seragam, finalize parent, anti double deduction, filter KDS (hanya `Selesai`/`Pending` + hari ini + bukan split), clear KDS `lastKdsClearTime`.

Rincian eksekusi: `TO DO.md` Prioritas 21.

Baseline: **613/613 test hijau** (58 file), tsc 0 error. (+11 test `itemDiscount` — TO DO 22.2 diskon per menu)

---

---

## I — Audit Fitur Promo, Loyalty, & Diskon Per Menu (v4.7)

**Ringkasan**: 3 area yang perlu peningkatan — (1) Loyalty Points sudah punya toggle tapi butuh validasi end-to-end, (2) Promo Bundling belum ada (hanya bundle menu), (3) Diskon Per Menu belum ada di POS.

### I.1 — Loyalty Points: Toggle Enabled Sudah Ada, Validasi End-to-End

**Temuan:**

- **Toggle `loyaltySettings.enabled`** sudah ada di `Promos.tsx` (baris 267) — ON/OFF poin earn + redeem.
- **Earn**: `calculateEarnedPoints(totalAmount, loyaltySettings)` di `loyaltyPoints.ts` — `pointsPerTransaction + floor(total/pointsPerRupiah)`. Dipanggil saat checkout成功 via `customerStore.recordVisit`.
- **Redeem**: Input "Tukar poin" di POS (keranjang mobile + modal Bayar) hanya muncul jika `loyaltySettings.enabled = true`. `calculateMaxRedeemablePoints` membatasi poin yang ditukar (tidak melebihi saldo & headroom diskon).
- **Clawback**: `revertVisit` di cancelPendingTransaction / void — poin dikembalikan simetris.
- **Cloud sync**: `syncLoyaltySettings` + `fetchLoyaltySettingsFromCloud` sudah ada.

**Kesimpulan**: Fitur loyalty earn & redeem sudah fungsional dengan toggle ON/OFF. **Tidak ada bug yang ditemukan.** Cukup pastikan klien tahu cara mengaktifkan/menonaktifkan di menu Promo → tab Pelanggan & Loyalitas.

### I.2 — Promo Bundling: BELUM ADA (Hanya Bundle Menu)

**Temuan:**

- **Bundle MENU** (`Menu.isBundle = true`, `MenuComponent[]`) sudah ada — ini adalah menu yang dikemas dari beberapa komponen (mis. "Paket Lele + Es Teh" = komponen dari 2 menu). Harga bundle diatur manual di form Edit Menu.
- **Promo Bundling sebagai tipe diskon** belum ada — yaitu "beli item A + item B bersamaan = diskon X%". Saat ini, promo hanya mendukung: `percentage`, `fixed`, `bogo`.

**Dampak**:
- Klien tidak bisa membuat promo "Beli Nasi + Ayam = Diskon Rp 5.000" atau "Beli 2 minuman = Diskon 10%"
- Satu-satunya cara adalah membuat bundle menu (tidak fleksibel untuk promo sesaat)

**Solusi yang Direkomendasikan:**

Tambah tipe promo baru `'bundle'` dengan:
- `bundleItems: Array<{menuId: string; quantity: number}>` — item yang harus ada di keranjang
- `bundleDiscountType: 'fixed' | 'percent'` — tipe diskon
- `bundleDiscountValue: number` — nilai diskon (Rp atau %)
- Deteksi otomatis di POS: jika keranjang mengandung SEMUA item bundle, diskon diterapkan
- **Tidak perlu Migration** — simpan di field `meta` JSON yang sudah ada di tabel `promos`

**File yang terdampak:**
- `src/types/index.ts` — tambah tipe `'bundle'` di `PromoType` + field bundle di `Promo`
- `src/utils/promoValidation.ts` — validasi field bundle saat simpan promo
- `src/utils/discountEngine.ts` — deteksi bundle + hitung diskon bundle
- `src/pages/Promos.tsx` — form bundle (pilih item + qty + diskon)
- `src/pages/POS.tsx` — deteksi bundle saat cart berubah

### I.3 — Diskon Per Menu di POS: ✅ SELESAI (TO DO 22.2)

**Temuan:**

- **Diskon manual** saat ini hanya di CART level (`discountInput` + `discountType` di POS.tsx) — kasir memasukkan diskon Rp atau % dari subtotal keseluruhan.
- **CartItem** tidak punya field `itemDiscount` — tidak ada cara memberi diskon per item.
- **Dampak ke struk**: Struk hanya menampilkan total diskon, bukan per item.
- **Dampak ke laporan**: Revenue sudah dari `subtotal` yang sudah dipotong diskon — tidak ada perubahan signifikan.

**Solusi yang Direkomendasikan:**

Tambah field `itemDiscount?: number` di `CartItem` + UI kecil di keranjang POS:

1. **CartItem type**: Tambah `itemDiscount?: number` (default 0)
2. **UI**: Tombol ikon `Tag` kecil di samping setiap item di keranjang → when diklik, muncul input inline (Rp atau %) — cukup 1 input sederhana
3. **Kalkulasi**: `itemSubtotal = (basePrice + sumAddons) * qty - itemDiscount` (clamp ≥ 0)
4. **Cart subtotal**: `Σ itemSubtotal` (sudah benar karena `cart.getSubtotal()` pakai `item.subtotal`)
5. **Struk**: Tampilkan diskon per item (contoh: `Es Teh x2 = Rp 12.000 - Rp 2.000 = Rp 10.000`)
6. **Laporan**: Tidak perlu perubahan — revenue sudah dari subtotal yang benar

**File yang terdampak:**
- `src/types/index.ts` — tambah `itemDiscount?: number` di `CartItem`
- `src/pages/POS.tsx` — UI input diskon per item + update subtotal saat diskon berubah
- `src/store/cartStore.ts` — update subtotal calculation
- `src/utils/printer.ts` — tampilkan diskon per item di struk
- `src/utils/digitalReceipt.ts` — tampilkan diskon per item di struk digital

---

*Dokumen ini adalah hasil analisa statis + penelusuran kode pada v4.7 (branch `main`). Belum ada perubahan kode yang diterapkan — temuan siap dieksekusi bertahap sesuai prioritas (A + E di atas; **F = analisa kesiapan Multi Outlet, rincian eksekusi di `TO DO.md` Prioritas 19**; **G = audit fitur eksisting, rincian eksekusi di `TO DO.md` Prioritas 20**; **H = audit flow pending+tambah+split, rincian eksekusi di `TO DO.md` Prioritas 21**; **I = audit promo/loyalty/diskon per menu, rincian eksekusi di `TO DO.md` Prioritas 22**; **M = audit tiket dapur + KDS per-item, rincian eksekusi di `TO DO.md` Prioritas 23**).*

---

## 🔴 J. Analisis Error Fitur "Bersihkan Data Transaksi" (Cloud Data Wipe Failure)

### J.1 — Deskripsi Masalah & Tangkapan Layar Error
Saat pengguna menjalankan fitur **"Bersihkan Data Transaksi"** (`clearOperationalData`) dari menu Manajemen Data, muncul dialog peringatan dari browser:

> **Gagal menghapus data dari cloud. Data lokal dipertahankan.**
> Coba lagi setelah koneksi stabil, atau jalankan manual dari Supabase SQL Editor:
> `DELETE FROM cash_movements WHERE id != '';`
> `DELETE FROM shifts WHERE id != '';`
> `DELETE FROM transactions WHERE id != '';`

Data lokal dengan sengaja dipertahankan (tidak dihapus dan aplikasi tidak di-reload) sebagai mekanisme keamanan, agar data tidak mendadak "bangkit kembali" dari cloud saat sinkronisasi berikutnya.

---

### J.2 — Akar Penyebab Teknis (Technical Root Causes)

Setelah dilakukan penelusuran kode pada `src/utils/dataManager.ts` dan struktur database Supabase di `supabase/schema.sql`, ditemukan **3 akar penyebab utama** mengapa operasi hapus tabel di cloud mengalami kegagalan:

#### 1. Inkompatibilitas Tipe Data PostgreSQL (`UUID` vs `TEXT ''`)
- **Lokasi Kode**: `src/utils/dataManager.ts` fungsi `clearCloudTables` (baris 285).
- **Penjelasan**: 
  Fungsi `clearCloudTables` mengirimkan query hapus Supabase SDK:
  `supabase.from(table).delete().neq('id', '')`
  Query ini diterjemahkan oleh PostgREST menjadi klausa SQL: `DELETE FROM table WHERE id != ''`.
- **Inkompatibilitas**:
  Di `supabase/schema.sql`, kolom `id` pada tabel `transactions`, `shifts`, `cash_movements`, `customers`, `audit_logs`, `stock_logs`, `promos`, dan `stock_opnames` didefinisikan sebagai tipe data **`UUID`** (`id UUID PRIMARY KEY DEFAULT gen_random_uuid()`).
  Sedangkan nilai `''` (string kosong) bertipe **`TEXT`**.
- **Dampak**: 
  PostgreSQL menolak query tersebut dan mengembalikan error sintaks tipe data:
  `ERROR: invalid input syntax for type uuid: ""` atau `ERROR: operator does not exist: uuid <> text`.
  Akibatnya, Supabase API mengembalikan objek `error`, menyebabkan `clearCloudTables` bernilai `false`.

#### 2. Pelanggaran Constraint Foreign Key (FK Violation & Urutan Penghapusan)
- **Lokasi Kode**: `src/utils/dataManager.ts` konstanta `OPERATIONAL_WIPE_TABLES` (baris 252).
- **Penjelasan**: 
  Array `OPERATIONAL_WIPE_TABLES` mengeksekusi penghapusan dengan urutan:
  `['transactions', 'shifts', 'customers', 'audit_logs', 'stock_logs', 'promos', 'stock_opnames', 'cash_movements']`.
- **Masalah Relasi DB**:
  - `stock_logs` memiliki referensi data ke `transactions`.
  - `cash_movements` memiliki referensi `shift_id` ke `shifts`.
  - `transactions` memiliki referensi `customer_id` ke `customers` dan `shift_id` ke `shifts`.
- **Dampak**:
  Saat `clearCloudTables` mencoba menghapus tabel induk (`transactions` / `shifts`) terlebih dahulu sebelum tabel anak (`stock_logs` / `cash_movements`), PostgreSQL menolak transaksi hapus dengan error relasi: `update or delete on table "shifts" violates foreign key constraint "cash_movements_shift_id_fkey" on table "cash_movements"`.

#### 3. Kebijakan Row Level Security (RLS) & Filter Mandatori PostgREST
- **Penjelasan**:
  Supabase / PostgREST melarang eksekusi query `DELETE` tanpa klausa `WHERE` untuk mencegah terhapusnya seluruh isi tabel secara tidak sengaja.
- **Masalah Filter**:
  Menggunakan filter `.neq('id', '')` pada kolom `UUID` menyebabkan error casting Postgres di atas. Filter yang valid secara sintaks untuk tipe `UUID` adalah `.not('id', 'is', null)` atau `.neq('id', '00000000-0000-0000-0000-000000000000')` atau filter berbasis timestamp `.gt('created_at', '1970-01-01')`.

---

### J.3 — Solusi & Langkah Perbaikan yang Direkomendasikan

1. **Perbaikan Filter Query Supabase SDK di `src/utils/dataManager.ts`**:
   Ubah pembuat filter pada `clearCloudTables` agar mendukung kolom bertipe `UUID`:
   ```ts
   // Menggunakan filter not null yang valid untuk tipe UUID maupun TEXT/INT
   const { error } = await supabase
     .from(table)
     .delete()
     .not('id', 'is', null);
   ```

2. **Perbaikan Urutan Penghapusan Tabel (`OPERATIONAL_WIPE_TABLES`)**:
   Urutkan tabel anak (child tables) terlebih dahulu sebelum tabel induk (parent tables):
   ```ts
   export const OPERATIONAL_WIPE_TABLES = [
     'stock_logs',       // anak dari inventory & transactions
     'cash_movements',   // anak dari shifts
     'stock_opnames',    // anak dari users/inventory
     'audit_logs',       // log audit
     'transactions',     // anak dari shifts & customers
     'shifts',           // induk dari cash_movements & transactions
     'customers',        // induk dari transactions
     'promos',           // promo
   ];
   ```

3. **Perbaikan Pesan Skrip Manual SQL di Alert UI**:
   Sediakan sintaks SQL yang valid pada instruksi fallback SQL Editor:
   ```sql
   DELETE FROM cash_movements WHERE id IS NOT NULL;
   DELETE FROM transactions WHERE id IS NOT NULL;
   DELETE FROM shifts WHERE id IS NOT NULL;
   ```

---

## 🔴 K. Temuan v4.8: KDS & Pembaruan Pesanan Pending

### K.1 — Pemetaan `kitchenTicketPrintedAt` Terlewat pada `fetchTransactionsFromCloud` (Tinggi)
- **Lokasi**: `src/lib/cloudSync.ts` (`fetchTransactionsFromCloud`).
- **Masalah**: Kolom database `kitchen_ticket_printed_at` tidak dipetakan ke properti `kitchenTicketPrintedAt` pada objek transaksi frontend saat mengambil data dari cloud. Akibatnya, setiap kali sinkronisasi real-time atau fetch manual terjadi, properti `kitchenTicketPrintedAt` pada lokal diset kembali menjadi `undefined`. Hal ini menyebabkan filter KDS `t.txStatus === 'Pending' && !t.kitchenTicketPrintedAt` menganggap transaksi pending tersebut belum dicetak dan menyembunyikannya dari KDS secara salah. Di sisi lain, jika data lokal belum ditimpa, pesanan yang disimpan lewat "Simpan Tanpa Cetak" bisa masuk ke KDS secara salah.
- **Solusi**: Tambahkan pemetaan `kitchenTicketPrintedAt: row.kitchen_ticket_printed_at || undefined` pada data mapper `fetchTransactionsFromCloud`.

### K.2 — Status KDS Reset Menjadi 'Waiting' pada Pengurangan/Penghapusan Menu Pending (Sedang)
- **Lokasi**: `src/pages/POS.tsx` (`pendingItemsChanged` & `overrideKitchenStatus`).
- **Masalah**: Saat ini, jika kasir mengedit pesanan pending dan mengubah isinya (baik menambah maupun **mengurangi** menu), `pendingItemsChanged` mendeteksi perbedaan signature dan me-reset status KDS (`kitchenStatus`) menjadi `'Waiting'`. Akibatnya, pesanan pending yang sebenarnya sudah selesai dimasak oleh dapur (`'Done'`) akan muncul kembali di KDS sebagai antrean baru meskipun kasir hanya menghapus/mengurangi menu (tidak ada menu baru yang perlu dimasak).
- **Solusi**:
  1. Buat helper `hasNewKitchenItems(cartItems: CartItem[], pendingItems: CartItem[]): boolean` untuk memeriksa apakah ada item baru yang ditambahkan, kuantitas item yang meningkat, atau perubahan spesifikasi item (suhu, level gula, addons). Jika hanya terjadi pengurangan/penghapusan item, fungsi mengembalikan `false`.
  2. Gunakan helper ini untuk menetapkan `overrideKitchenStatus` di POS: status hanya di-reset ke `'Waiting'` jika ada item baru/tambahan yang perlu dimasak. Jika tidak, pertahankan status dapur saat ini (`currentPendingTx.kitchenStatus`).

### K.3 — Sinkronisasi KDS saat Simpan Pending Tanpa Cetak (Sedang)
- **Masalah**: Jika kasir mengedit pesanan pending dan memilih **"Simpan Tanpa Cetak"**, status dapur saat ini tidak boleh di-reset ke `'Waiting'` (karena belum dikirim/dicetak ke dapur).
- **Solusi**: Pada `handleSavePending` di `POS.tsx`, jika `skipKitchenPrint` bernilai `true`, pertahankan status dapur saat ini `currentPendingTx.kitchenStatus` alih-alih me-reset ke `'Waiting'`.

### K.4 — Peningkatan Kuantitas pada Cetak Tiket Dapur Delta (Sedang)
- **Masalah**: Fungsi cetak tiket dapur delta saat ini hanya membandingkan `lineId` yang belum pernah ada. Jika kasir meningkatkan kuantitas item yang sama (mis. "Pecel Lele x1" menjadi "Pecel Lele x3"), item tersebut dilewati dari pencetakan delta tiket dapur karena `lineId`-nya sudah ada, sehingga dapur tidak tahu ada penambahan porsi.
- **Solusi**: Buat helper `calculateDeltaKitchenItems(cartItems: CartItem[], pendingItems: CartItem[]): CartItem[]` untuk menghitung delta kuantitas item yang meningkat serta perubahan spesifikasi sebagai item delta yang akan dicetak di dapur.

---

## 🔴 L. Temuan v4.9: Custom Non-Pelanggan & Isu Overwrite Tiket Dapur Simultan

### L.1 — Kebutuhan Memasukkan Nama Pelanggan Tanpa Menyimpan ke Database (Rendah/Fitur)
- **Masalah**: Beberapa pelanggan tidak ingin mendaftar sebagai anggota (pelanggan tetap), namun kasir tetap perlu mencatat nama mereka di keranjang transaksi untuk keperluan antrean/panggilan dan struk. POS saat ini hanya mendukung pemilihan pelanggan dari database atau menambahkan pelanggan baru secara permanen.
- **Solusi**:
  1. Tambahkan state `customCustomerName` di POS.
  2. Perbarui komponen pembantu `CustomerPicker` agar menyediakan opsi *"✨ Gunakan nama: [Input] (Non-Pelanggan)"* saat kasir mengetik nama yang tidak terdaftar.
  3. Jika dipilih, set `selectedCustomerId = null` dan simpan nama tersebut ke `customCustomerName`.
  4. Kirim nama manual ini sebagai `selectedCustomerName` ke `AtomicTransactionEngine.executeCheckout` saat simpan pending maupun finalisasi pembayaran.

### L.2 — Tiket Dapur Ter-overwrite saat Cetak Simultan ke Banyak Printer (Tinggi)
- **Lokasi**: `src/utils/printer.ts` (`printHtmlInIframe`).
- **Masalah**: Fungsi `printHtmlInIframe` mencari iframe menggunakan ID global tunggal `'thermal-print-iframe'`. Saat pesanan gantung dicetak menggunakan "Cetak Struk (Dapur) Saja", sistem memproses cetak ke printer makanan dan minuman secara bersamaan (secara asinkron via `Promise.all`). Cetak kedua langsung menulis ke iframe yang sama sebelum dialog cetak pertama dipicu (karena ada `setTimeout` 250ms), sehingga isi tiket printer pertama tertimpa oleh tiket printer kedua. Akibatnya, printer kedua mencetak tiketnya sebanyak 2 kali sedangkan printer pertama tidak mencetak sama sekali.
- **Solusi**: Ubah `printHtmlInIframe` agar selalu membuat iframe baru dengan ID unik (menggunakan UUID/random string) untuk setiap proses pencetakan, dan bersihkan iframe tersebut dari DOM setelah selesai (misalnya setelah 60 detik).

---

## 🔴 M. Analisis Tiket Dapur & Kitchen Display System (KDS) Per-Item Status (v4.8)

### M.1 — Masalah Inti: Tidak Ada Status Per-Item di KDS

**Temuan**: Saat ini `kitchenStatus` hanya ada di level **transaksi** (`Transaction.kitchenStatus`), bukan per-item (`CartItem`). Akibatnya:

1. **KDS menampilkan SEMUA item** dari transaksi — tidak ada cara membedakan mana yang sudah diproses, mana yang baru.
2. **Saat pending di-update** (kasir tambah menu), `overrideKitchenStatus = 'Waiting'` diterapkan ke **seluruh transaksi** → semua item muncul kembali di kolom "Menunggu" di KDS, termasuk yang sudah selesai.
3. **Dapur bingung**: melihat pesanan yang sudah dihidangkan muncul kembali di antrean.

### M.2 — Flow Cetak Tiket Dapur (Printer Level) — Sudah Benar (Delta-Only)

**Simpan Pending BARU** (`currentPendingTx = null`):
```
handleSavePending → engine.executeCheckout → printReceipt(data, settings, 'kitchen')
→ SEMUA item dicetak ke printer dapur ✅ (pesanan baru)
→ kitchenTicketPrintedAt stamped
```

**Update Pending** (`currentPendingTx` ada):
```
handleSavePending → calculateDeltaKitchenItems(cart.items, currentPendingTx.items)
→ HANYA item baru/tambahan yang dicetak ke printer dapur ✅
```

Delta detection di `kitchenTicket.ts` sudah benar:
- Item baru (belum ada di pending) → masuk delta
- Item yang qty-nya naik → delta = selisih qty
- Item yang spesifikasi berubah (suhu/gula/addons) → masuk delta
- Item yang dikurangi/dihapus → TIDAK masuk delta

### M.3 — Masalah di KDS (Display Level)

**Root cause**: KDS filter & render di `Kitchen.tsx`:

```tsx
// Filter transaksi level — tampilkan jika Selesai/Pending + kitchenTicketPrintedAt terisi
const activeOrders = transactions.filter((t) => {
  if (t.txStatus !== 'Selesai' && t.txStatus !== 'Pending') return false;
  if (t.txStatus === 'Pending' && !t.kitchenTicketPrintedAt) return false;
  // ... filter lain
  return true;
});

// Render SEMUA item tanpa status per-item
{order.items.filter((item) => !item.isBundle).map((item) => (
  <div key={item.lineId}>
    <p>{item.name}</p>  // ← SEMUA item, tidak ada badge
    <p>x{item.quantity}</p>
  </div>
))}
```

**Alur bug saat pending di-update:**
1. Kasir tambah menu ke pending yang sudah `Done` di KDS
2. `handleSavePending` → `overrideKitchenStatus = 'Waiting'` (seluruh transaksi)
3. Transaksi di-sync ulang ke cloud dengan `kitchenStatus = 'Waiting'`
4. KDS realtime: transaksi pindah dari kolom "Selesai" → "Menunggu"
5. KDS render: **SEMUA item** muncul di "Menunggu" — termasuk yang sudah dihidangkan
6. Dapur: "Ini sudah selesai, kenapa muncul lagi?"

### M.4 — Masalah Kedua: Tidak Ada Badge "Tambahan" di Tiket Cetak

Saat update pending, tiket dapur hanya mencetak item delta tanpa konteks:
```
=== TIKET PESANAN ===
#5 - Meja 3
Nasi Putih x1     ← item baru, tapi tidak ada label "TAMBAHAN"
Es Teh x1         ← item baru, tapi tidak ada label "TAMBAHAN"
```

Dapur tidak tahu ini adalah pesanan TAMBAHAN dari #5 yang sudah selesai, bukan pesanan baru yang terpisah.

### M.5 — Solusi yang Direkomendasikan

**Konsep: Per-Item Kitchen Status**

```
CartItem.kitchenItemStatus: 'new' | 'processing' | 'done'

Saat Simpan Pending BARU:
  → Semua item: kitchenItemStatus = 'new'

Saat Update Pending (tambah menu):
  → Item LAMA yang sudah 'done': PERTAHANKAN status 'done'
  → Item BARU / qty tambahan: kitchenItemStatus = 'new'
  → Item yang spesifikasi berubah: kitchenItemStatus = 'new'

Saat Dapur klik "Proses" per-item:
  → Item 'new' → 'processing'

Saat Dapur klik "Selesai" per-item:
  → Item 'processing' → 'done'
```

**Di KDS:**
```tsx
{order.items.filter(item => !item.isBundle).map(item => (
  <div className={item.kitchenItemStatus === 'done' ? 'opacity-50 line-through' : ''}>
    <p>{item.name}</p>
    {item.kitchenItemStatus === 'done' && <span className="badge green">✅ Selesai</span>}
    {item.kitchenItemStatus === 'new' && <span className="badge amber">🆕 Tambahan</span>}
    {item.kitchenItemStatus === 'processing' && <span className="badge blue">👨‍🍳 Diproses</span>}
  </div>
))}
```

**Di Tiket Dapur:**
- Tambah header "=== TAMBAHAN ===" untuk item delta saat update pending
- Atau tambah prefix "[TAMBAHAN]" di nama item

**Di KDS Filter:**
- Transaksi tetap ditampilkan jika ADA item dengan status 'new' atau 'processing'
- Jika semua item 'done', transaksi bisa dipindah ke kolom "Selesai" atau disembunyikan

### M.6 — Estimasi Dampak

| File | Perubahan |
|------|----------|
| `types/index.ts` | Tambah `kitchenItemStatus?: 'new' \| 'processing' \| 'done'` di `CartItem` |
| `kitchenTicket.ts` | Set `kitchenItemStatus` saat delta detection + tambah header "TAMBAHAN" di tiket |
| `atomicTransactionEngine.ts` | Pertahankan status item lama saat commit pending update |
| `Kitchen.tsx` | Render badge per-item + filter per-item status + tombol Proses/Selesai per-item |
| `POS.tsx` | Set `kitchenItemStatus = 'new'` untuk item baru di cart |
| `cartStore.ts` | Sync field baru |

### M.7 — Keterkaitan dengan Temuan Sebelumnya

- **K.1** (`kitchenTicketPrintedAt` tidak di-sync) → menyebabkan Bug 1 (KDS Acaraki tidak melihat pending). Perlu diperbaiki bersamaan.
- **K.2** (Status reset ke Waiting saat kurang menu) → sudah diperbaiki di Prioritas 21.2 (`hasNewKitchenItems`), tapi masih mempengaruhi seluruh transaksi level.
- **L.2** (Tiket ter-overwrite saat cetak simultan) → masalah cetak fisik, terpisah dari masalah display KDS.



