# 📌 ROADMAP & ARCHITECTURE SPECIFICATION — BerdikariPOS v4.4

## 🎯 STATUS: ✅ IMPLEMENTED (v4.4)
**Fitur Utama** (selesai diimplementasikan — status tiap item ada di `TO DO.md`):
1. **Pending Payment (Simpan & Gantung Pesanan)** — 1.1–1.4, 1.7, 2.6/2.7 ✅
2. **Split Bill (Pisah Pembayaran Per-Item & Nominal Rata)** — 1.5, 1.6, 2.2, 2.3, 2.8 ✅

---

## 📑 DAFTAR ISI
1. [Hasil Audit & Resolusi Logic System (Technical Audit)](#-hasil-audit--resolusi-logic-system)
2. [Fitur 1: Pending Payment (Simpan & Gantung Pesanan)](#-fitur-1-pending-payment-simpan--gantung-pesanan)
3. [Fitur 2: Split Bill (Pisah Pembayaran Per-Item & Nominal)](#-fitur-2-split-bill-pisah-pembayaran-per-item--nominal)
4. [Integrasi Alur Kerja (End-to-End Workflow)](#-integrasi-alur-kerja-end-to-end-workflow)
5. [Spesifikasi Perubahan Codebase (Files to Modify / Create)](#-spesifikasi-perubahan-codebase)
6. [Aturan Keuangan & Presisi Pembulatan Rupiah (Rounding)](#-aturan-keuangan--presisi-pembulatan-rupiah)
7. [Rencana Validasi & Skenario Testing Manual](#-rencana-validasi--skenario-testing-manual)
8. [Riwayat Release (v4.0 Handoff Status)](#-riwayat-release-v40)

---

## 🔍 HASIL AUDIT & RESOLUSI LOGIC SYSTEM

Berdasarkan audit mendalam pada arsitektur existing (`AtomicTransactionEngine`, `Kitchen.tsx`, `transactionStore`, `cloudSync`), berikut adalah 5 potensi bug kritis yang telah diidentifikasi dan disolusikan dalam plan v4.1 ini:

| Potensi Bug / Flaw Existing | Akar Masalah | Solusi & Resolusi Arsitektur v4.1 |
|-----------------------------|--------------|-----------------------------------|
| **1. KDS Makanan Tidak Muncul** | `Kitchen.tsx` baris 85 memfilter ketat `if (t.txStatus !== 'Selesai') return false;`. | **Ubah Filter KDS**: Perbarui kondisi menjadi `if (t.txStatus !== 'Selesai' && t.txStatus !== 'Pending') return false;` agar pesanan gantung tetap muncul dan dapat dimasak oleh dapur. |
| **2. Double Deduction Stok Bahan Baku** | `AtomicTransactionEngine` memotong stok inventaris saat checkout. Jika pending diproses ulang/displit, stok terpotong 2x. | **Flag `skipStockDeduction`**: Saat transaksi Pending dibuat, stok dipotong 1x (reserve). Saat pelunasan/split, lewati pemotongan stok (`skipStockDeduction: true`). |
| **3. Nomor Antrean Berubah / Ganda** | `getNextQueueNumber()` men-generate nomor baru saat checkout. | **Preservasi Queue Number**: Transaksi Pending memiliki Queue Number tetap sejak dibuat. Saat pelunasan, transaksi mempertahankan Queue Number awalnya. |
| **4. Tabrakan Cart Kasir (Cart Overwrite)** | Jika Kasir mengklik "Lanjutkan Pending" saat cart terisi item lain, data cart hilang. | **Cart Collision Guard**: Tampilkan dialog konfirmasi: *"Gabungkan Cart"*, *"Kosongkan & Muat Pending"*, atau *"Simpan Cart Saat Ini dahuu"*. |
| **5. Selisih Pembulatan Pecahan Rupiah pada Split Equal** | Pembagian nominal (misal Rp 100.000 / 3 = Rp 33.333,33) menyebabkan selisih Rp 1. | **Remainder Allocation Algorithm**: Pembulatan integer Rupiah presisi. Sub-bill 1 & 2 = Rp 33.333, Sub-bill 3 (terakhir) = Rp 33.334 (Total 100% klop). |

---

## 📦 FITUR 1: PENDING PAYMENT (Simpan & Gantung Pesanan)

### 1.1 Latar Belakang & Objective
Pada operasional F&B (Restoran / Kafe / Kedai Kopi), pelanggan Dine In sering memesan makanan dulu dan membayar saat pulang.
Fitur **Pending Payment** memungkinkan kasir menyimpan transaksi saat ini ke daftar pesanan gantung, langsung mengirimkan pesanan ke dapur/KDS agar dapat dimasak, dan memuat kembali tagihan saat pelanggan siap melakukan pelunasan.

### 1.2 User Flow & UX Diagram
```
[ POS Page / Cart ] 
        │
        ├─► User isi Cart + Informasi Meja / Nama Pelanggan
        │
        ├─► Klik Tombol [ ⏳ Simpan Pending ]
        │        │
        │        ├─► Validasi Cart tidak kosong & Meja/Nama terisi
        │        ├─► Generasi Transaction ID & Queue Number (#042)
        │        ├─► Set txStatus = 'Pending', kitchenStatus = 'Waiting'
        │        ├─► Potong Stok Inventaris 1x via AtomicEngine (Reserve Stock)
        │        ├─► Trigger Split Printing ke Dapur / KDS (Status 'Pending' diterima)
        │        ├─► Simpan ke transactionStore & Supabase Realtime
        │        └─► Clear Cart Kasir (Siap melayani pesanan berikutnya)
        │
[ Modal / Drawer "Daftar Pesanan Pending" ] (Akses via Header Badge / POS)
        │
        ├─► Tampilkan list transaksi dengan status 'Pending' (Badge Kuning)
        ├─► Filter berdasarkan Nomor Antrean / Nama Pelanggan / Meja / Waktu
        │
        ├── Action A: [ 💳 Lanjutkan Pembayaran ]
        │        └─► Muat kembali item & metadata ke Cart POS -> Checkout & Lunas
        │
        ├── Action B: [ ✏️ Edit / Tambah Pesanan ]
        │        └─► Buka di Cart POS, kasir dapat tambah menu -> Update Pending
        │
        ├── Action C: [ 🖨️ Cetak Struk Sementara ]
        │        └─► Cetak Provisional Bill (Bill Tagihan tanpa Kembalian)
        │
        └── Action D: [ ❌ Batalkan Pending / Void ]
                 └─► Revert stok inventaris & set txStatus = 'Cancel'
```

### 1.3 Schema & State Interface
Di `src/types/index.ts`:
```typescript
export interface Transaction {
  // Properti existing
  id: string;
  queueNumber: number;
  date: string;
  items: CartItem[];
  subtotal: number;
  discount: number;
  tax?: number;
  totalAmount: number;
  paymentMethod: PaymentMethod;
  kitchenStatus: KitchenStatus;
  txStatus: TxStatus; // 'Selesai' | 'Cancel' | 'Pending' | 'Demo'
  cashierId: string;
  cashierName: string;
  
  // Properti Baru v4.1 (Pending & Split)
  tableName?: string;            // Nomor Meja (contoh: "Meja 05")
  customerName?: string;         // Nama Pelanggan / Catatan Pemesan
  isPending?: boolean;           // Helper flag
  pendingNotes?: string;         // Catatan khusus gantung
  splitParentId?: string;        // ID transaksi induk jika hasil split bill
  splitIndex?: number;           // Urutan split (misal: 1 dari 2)
  totalSplitCount?: number;      // Total bagian split (misal: 2)
  paidAmount?: number;           // Nominal yang sudah dibayar pada partial split
}
```

---

## 🍕 FITUR 2: SPLIT BILL (Pisah Pembayaran Per-Item & Nominal)

### 2.1 Latar Belakang & Objective
Ketika sekelompok pelanggan makan bersama, mereka sering kali ingin membayar secara terpisah.
Fitur **Split Bill** memberikan fleksibilitas penuh kepada kasir untuk membagi tagihan menjadi 2 mode:
1. **Mode A: Split Nominal Rata (Split Equal)** — Contoh: Total Rp 300.000 dibagi rata ke 3 orang (@ Rp 100.000 per orang).
2. **Mode B: Split Per-Item (Split Custom)** — Contoh: Pembayar A membayar Kopi + Roti, Pembayar B membayar Nasi Goreng + Es Teh.

### 2.2 User Flow & UX Diagram
```
[ POS Checkout Modal ] ──► Klik Tombol [ ✂️ Split Bill ]
                                  │
      ┌───────────────────────────┴───────────────────────────┐
      ▼                                                       ▼
[ MODE A: Split Nominal Rata ]              [ MODE B: Split Per-Item ]
      │                                                       │
  1. Input Jumlah Orang (2-10)                            1. Buat Sub-Bill (Bill 1, Bill 2, dst)
  2. Alokasi Pembulatan Remainder                          2. Drag / Select Item ke masing-masing Bill
  3. Tampilkan List Sub-Bill 1..N                         3. Alokasikan Diskon & Pajak proporsional
      │                                                       │
      └───────────────────────────┬───────────────────────────┘
                                  │
                                  ▼
                    [ Alur Pembayaran Sub-Bill ]
                                  │
             ├── Sub-Bill 1: Pilih Cash Rp 50k ──► Cetak Struk Split 1/2
             ├── Sub-Bill 2: Pilih QRIS Rp 50k ──► Cetak Struk Split 2/2
             │
             ▼
[ Pelunasan Otomatis ]
  - Jika seluruh Sub-Bill lunas ──► Transaksi Induk `txStatus = 'Selesai'`
  - Stok Inventaris HANYA dipotong 1x saat transaksi awal dibuat.
```

---

## 🔄 INTEGRASI ALUR KERJA (END-TO-END WORKFLOW)

```
                       ┌─────────────────────────┐
                       │   POS Cart (Kasir)      │
                       └────────────┬────────────┘
                                    │
                  ┌─────────────────┴─────────────────┐
                  ▼                                   ▼
        [ Klik "Simpan Pending" ]              [ Klik "Bayar / Checkout" ]
                  │                                   │
                  ▼                                   ▼
       Simpan ke Pending List                 Modal Checkout Biasa
       Status: 'Pending'                              │
       Print Tiket Dapur & KDS                        ├──► Bayar Langsung Lunas (Selesai)
                  │                                   │
                  ▼                                   └──► Klik [ ✂️ Split Bill ]
       Buka dari Pending List                              │
       (Saat Pelanggan Mau Bayar)                          ▼
                  │                                  Pilih Mode Split:
                  └───────────────────────────────►  - Equal (Rata)
                                                     - Per-Item
                                                           │
                                                           ▼
                                                    Proses Sub-Bills
                                                    (Cash / QRIS / Transfer)
                                                           │
                                                           ▼
                                                    Semua Sub-Bill Lunas
                                                    Status: 'Selesai'
```

---

## 🛠️ SPESIFIKASI PERUBAHAN CODEBASE

| Component / File | Rencana Perubahan | Risk / Dampak |
|------------------|-------------------|---------------|
| [src/types/index.ts](file:///d:/Private%20File/Aba/VibeCoding/Client/LeleTerbang/BerdikariPOS-Leter/src/types/index.ts) | Tambah properti `tableName`, `customerName`, `isPending`, `pendingNotes`, `splitParentId`, `splitIndex`, `totalSplitCount` pada `Transaction`. Tambah tipe `TxStatus = 'Selesai' \| 'Cancel' \| 'Pending' \| 'Demo'`. | 🟢 Low (Extension interface) |
| [src/store/transactionStore.ts](file:///d:/Private%20File/Aba/VibeCoding/Client/LeleTerbang/BerdikariPOS-Leter/src/store/transactionStore.ts) | Tambah handler `addPendingTransaction`, `resumePendingTransaction`, `cancelPendingTransaction`, dan `finalizeSplitTransactions`. Pastikan Queue Number di-preserve. | 🟡 Medium (Core State Management) |
| [src/lib/atomicTransactionEngine.ts](file:///d:/Private%20File/Aba/VibeCoding/Client/LeleTerbang/BerdikariPOS-Leter/src/lib/atomicTransactionEngine.ts) | Tambah dukungan `skipStockDeduction: true` pada `AtomicCheckoutParams` untuk mencegah pemotongan stok berulang saat pelunasan/split. | 🟡 Medium (Transaction Integrity) |
| [src/pages/Kitchen.tsx](file:///d:/Private%20File/Aba/VibeCoding/Client/LeleTerbang/BerdikariPOS-Leter/src/pages/Kitchen.tsx) | Perbarui filter KDS baris 85 agar pesanan bertipe `txStatus === 'Pending'` tetap muncul dan dapat diproses dapur. | 🟢 Low (KDS Display Filter) |
| [src/pages/POS.tsx](file:///d:/Private%20File/Aba/VibeCoding/Client/LeleTerbang/BerdikariPOS-Leter/src/pages/POS.tsx) | Tambahkan tombol **[Simpan Pending]** di Cart Footer, Badge counter Pending di Header, dan integrasi tombol **[Split Bill]** di Modal Checkout. | 🟡 Medium (UI Cart & Checkout) |
| [src/components/PendingPaymentsModal.tsx](file:///d:/Private%20File/Aba/VibeCoding/Client/LeleTerbang/BerdikariPOS-Leter/src/components/PendingPaymentsModal.tsx) | **[NEW]** Komponen Modal/Drawer untuk melihat daftar transaksi pending, filter meja/nama, tombol Lanjutkan Pembayaran, Edit, Print Pre-Bill, dan Void. | 🟢 Low (Komponen Baru) |
| [src/components/SplitBillModal.tsx](file:///d:/Private%20File/Aba/VibeCoding/Client/LeleTerbang/BerdikariPOS-Leter/src/components/SplitBillModal.tsx) | **[NEW]** Komponen Modal interaktif untuk Split Bill: Toggle Mode Equal vs Per-Item, Selector Item, Kalkulasi Otomatis, dan Alur Pembayaran Sub-Bill Berurutan. | 🟢 Low (Komponen Baru) |
| [src/utils/printer.ts](file:///d:/Private%20File/Aba/VibeCoding/Client/LeleTerbang/BerdikariPOS-Leter/src/utils/printer.ts) | Tambah template `printProvisionalBill()` (Struk Tagihan Sementara) dan `printSplitReceipt()` (Struk Sub-Bill Split 1/N). | 🟢 Low (Printing Template) |
| [src/components/Layout.tsx](file:///d:/Private%20File/Aba/VibeCoding/Client/LeleTerbang/BerdikariPOS-Leter/src/components/Layout.tsx) | Tambah Quick Access Badge Pending Payment di Top Navigation Bar agar kasir dapat melihat total pesanan gantung dari halaman mana saja. | 🟢 Low (UI Header Navigation) |
| [src/lib/cloudSync.ts](file:///d:/Private%20File/Aba/VibeCoding/Client/LeleTerbang/BerdikariPOS-Leter/src/lib/cloudSync.ts) | Peta kolom `table_number`, `customer_name`, `is_pending`, `split_parent_id` secara aman pada `syncTransaction` dan `fetchTransactionsFromCloud`. | 🟡 Medium (Cloud Sync Mapping) |

---

## 💰 ATURAN KEUANGAN & PRESISI PEMBULATAN RUPIAH

1. **Pencegahan Double Deduction Stok**:
   - Pemotongan stok dilakukan **1x** saat transaksi dibuat (baik status `'Pending'` maupun langsung `'Selesai'`).
   - Saat transaksi `Pending` dilunasi atau displit, flag `skipStockDeduction = true` dilewatkan ke `finalizeTransaction` sehingga stok inventaris tidak terpotong dua kali.
2. **Algoritma Alokasi Pembulatan Remainder (Split Equal)**:
   - Formula: `baseAmount = Math.floor(totalAmount / N)`.
   - `remainder = totalAmount - (baseAmount * N)`.
   - Sub-bill $1$ s/d $N-1$ mendapat `baseAmount`.
   - Sub-bill terakhir ($N$) mendapat `baseAmount + remainder`.
   - Hasil: Total seluruh sub-bill **100% sama dengan Total Transaksi Induk** tanpa selisih Rp 1 pun.
3. **Alokasi Diskon & Pajak Proporsional (Split Per-Item)**:
   - Diskon & pajak tiap item pada sub-bill dihitung proporsional terhadap total diskon/pajak induk:
     $$\text{SubBillTax} = \text{Math.round}\left(\frac{\text{SubBillSubtotal}}{\text{ParentSubtotal}} \times \text{ParentTax}\right)$$
4. **Integrasi Laporan Penjualan (No Double Accounting)**:
   - Laporan Penjualan (`Reports.tsx`) hanya menghitung omset dari transaksi yang berstatus `'Selesai'`. Sub-bill hasil split bill yang bertindak sebagai child transaction terhubung via `splitParentId` sehingga omset toko tidak terhitung ganda.

---

## 🧪 RENCANA VALIDASI & SKENARIO TESTING MANUAL

### Skenario 1: Pending Payment (Simpan & KDS Check)
1. Kasir memasukkan 3 produk ke Cart di POS.
2. Klik **[Simpan Pending]**, masukkan Nama: "Pak Budi", Meja: "Meja 04".
3. Cart POS otomatis bersih. Dapur (KDS) langsung menampilkan pesanan Pak Budi dengan badge `Waiting` / `Pending`.
4. Buka Modal **Pending Payments** → Pesanan Pak Budi "Meja 04" terlihat dengan badge kuning `Pending`.
5. Klik **[Lanjutkan Pembayaran]** → Cart terisi kembali. Lakukan Checkout Cash → Transaksi `Selesai` & Struk Pelanggan dicetak.

### Skenario 2: Split Bill Mode Equal (Nominal Rata)
1. Buat transaksi senilai Rp 100.000.
2. Di Modal Checkout, pilih **[Split Bill]** → Mode: **Nominal Rata** → Input 3 Orang.
3. Sub-Bill 1 = Rp 33.333 (Bayar Cash Rp 33.333) → Cetak Struk Split 1/3.
4. Sub-Bill 2 = Rp 33.333 (Bayar QRIS Rp 33.333) → Cetak Struk Split 2/3.
5. Sub-Bill 3 = Rp 33.334 (Bayar Transfer Rp 33.334) → Cetak Struk Split 3/3.
6. Transaksi utama berubah status menjadi `Selesai`. Total Laporan Penjualan tercatat tepat Rp 100.000 (tidak ada selisih).

### Skenario 3: Split Bill Mode Per-Item
1. Buat transaksi: 2x Nasi Goreng (@ Rp 25k) + 2x Kopi Susu (@ Rp 15k) = Total Rp 80.000.
2. Di Modal Checkout, pilih **[Split Bill]** → Mode: **Per-Item**.
3. Pindahkan 2x Kopi Susu ke Bill 1 (Rp 30k), 2x Nasi Goreng ke Bill 2 (Rp 50k).
4. Bayar Bill 1 (Kopi Susu) via QRIS → Sukses.
5. Bayar Bill 2 (Nasi Goreng) via Cash → Sukses.
6. Cek Stok Inventaris: Bahan baku Nasi Goreng & Kopi Susu hanya berkurang 1x.

---

## 📜 RIWAYAT RELEASE (v4.0 HANDOFF STATUS)

### 🚀 RINGKASAN IMPLEMENTASI (v4.0)
1. **Printer Device Registry (`Map<string, BluetoothConnection>`)**:
   - Seluruh koneksi Bluetooth kini dikelola secara independen per-printer ID (`__cashier__`, `kp.id`).
   - Masalah *crosstalk* akibat global singleton telah diperbaiki sepenuhnya.

2. **Error Isolation (`Promise.allSettled`)**:
   - Kegagalan satu printer tidak menggagalkan transaksi atau printer kasir/bar lainnya.

3. **Settings UI (Card-based Layout & Live Status Indicator)**:
   - Printer Dapur beralih dari tabel menjadi card-based layout yang responsif dan mobile-friendly.

---

*Dokumen ini merupakan spesifikasi arsitektur resmi BerdikariPOS v4.4.*