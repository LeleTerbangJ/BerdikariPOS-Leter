# 🧪 Panduan Tes Manual — Pesanan Pending & KDS dengan Sistem Order Batch (v4.9.1)

Panduan ini memverifikasi bahwa **alur Pesanan Pending (Gantung), Penambahan Menu (Order Batch), Sinkronisasi KDS Realtime, dan Hak Akses Role** berjalan 100% akurat dan deterministik. Ikuti urutan A → B → C → D → E → F → G → H (≈ 15–20 menit).

---

## 0. Persiapan & Akun Pengujian

- **2 Perangkat / 2 Tab Browser**: 
  - Device / Tab 1 = Kasir (`kasir`/`kasir123`) atau Manager (`manager`/`manager123`).
  - Device / Tab 2 = Dapur / KDS dengan akun Acaraki (`acaraki`/`acaraki123`) atau Manager.
- Buka **POS** di Device 1, buka **Kitchen Display System (KDS)** di Device 2.
- Pengaturan Cetak: **Settings → Pengaturan Cetak → Pencetakan Pesanan Gantung → "Tanyakan Pilihan Cetak saat Simpan Pending"**.
- Pengaturan Printer Dapur: Pastikan printer Dapur/Bar aktif di **Settings → Printer Dapur** (atau gunakan fallback browser print otomatis).
- Siapkan **3 menu uji**:
  1. Nasi Goreng (Rp15.000)
  2. Es Teh (Rp5.000)
  3. Ayam Bakar (Rp20.000)
- **DevTools (F12)** di kedua perangkat — tab **Console** untuk memantau log `[AtomicEngine]`, `[CloudSync]`, dan `[PrintReceipt]`.

---

## A. "Cetak Struk (Dapur) Saja" → Tiket Dapur Tercetak & Muncul di KDS (Batch 1)

**Tujuan**: Memastikan pesanan awal disimpan dengan opsi "Cetak Struk (Dapur) Saja", **tiket dapur tercetak dengan header Batch 1 (Pesanan Awal)**, dan **langsung muncul di kolom Antrean Menunggu** KDS.

1. **Device 1 (Kasir)**: Tambahkan **Nasi Goreng × 1** dan **Es Teh × 1** ke keranjang.
2. Klik **Simpan Pending** → pilih **"Cetak Struk (Dapur) Saja"**.
3. **Cek Printer / Pop-up Browser**:
   - **Hasil yang diharapkan**: ✅ Tiket dapur tercetak / preview browser print muncul.
   - **Header Tiket**: Menampilkan `[BATCH #1 - PESANAN AWAL]`.
4. **Device 2 (KDS)**: Amati layar KDS.
   - **Hasil yang diharapkan**: ✅ Pesanan muncul di kolom **Antrean Menunggu** dengan badge 🆕 **Baru** pada setiap item.
   - **Hasil yang diharapkan**: ✅ Nomor antrean (#N) dan waktu pencatatan tampil dengan benar.
5. Cek **Pending Payments** di Device 1.
   - **Hasil yang diharapkan**: ✅ Transaksi tercatat di daftar pending dengan status **Pending**.

**Hasil akhir A**: ✅ Batch 1 tercatat, tiket dapur tercetak dengan label `[BATCH #1 - PESANAN AWAL]`, dan pesanan muncul di Antrean Menunggu KDS.

---

## B. Proses Pesanan di Dapur (KDS)

**Tujuan**: Memindahkan item Batch 1 dari status Menunggu ke Sedang Diproses dan Selesai.

1. **Device 2 (KDS)**:
   - Pada kartu pesanan langkah A, klik tombol **🔥 Proses** pada **Nasi Goreng** dan **Es Teh**.
   - **Hasil yang diharapkan**: ✅ Item berpindah ke kolom **Sedang Diproses** dengan badge 🔵 **Diproses**.
2. Klik tombol **✅ Selesai** pada kedua item.
   - **Hasil yang diharapkan**: ✅ Item berpindah ke kolom **Selesai** dengan teks tercoret dan badge 🟢 **Selesai**.
   - **Hasil yang diharapkan**: ✅ Di background, mutasi `kitchenItemStatus: 'done'` dan `updatedAt` tersinkronisasi ke cloud database.

**Hasil akhir B**: ✅ Seluruh item Batch 1 sudah berstatus **Selesai** di KDS.

---

## C. Resume Pending & Tambah Menu (Order Batch 2)

**Tujuan**: Memastikan saat kasir menambah menu baru ke pesanan pending:
1. Item lama (Batch 1) **TETAP di kolom Selesai** di KDS (tidak terulang ke Antrean Menunggu).
2. Item baru otomatis masuk ke **Batch 2 (Tambahan 1)** dengan status 🆕 **Baru**.
3. Tiket dapur **HANYA mencetak item Batch 2** dengan header `[BATCH #2 - TAMBAHAN #1]`.

1. **Device 1 (Kasir)**: 
   - Buka **Pending Payments** → cari pesanan dari langkah A → klik **"Lanjutkan Pembayaran"**.
   - Muncul notifikasi toast: `Pesanan gantung #N dimuat ke keranjang (Kloter #2 siap untuk menu tambahan)`.
2. Tambahkan menu baru: **Ayam Bakar × 1**.
3. Klik **Simpan Pending** → pilih **"Cetak Struk (Dapur) Saja"**.
4. **Cek Printer Dapur**:
   - **Hasil yang diharapkan**: ✅ Tiket dapur **HANYA mencetak Ayam Bakar × 1**.
   - **Hasil yang diharapkan**: 🚫 Nasi Goreng dan Es Teh **TIDAK ikut tercetak ulang** (anti-tiket dobel).
   - **Header Tiket**: Menampilkan `[BATCH #2 - TAMBAHAN #1]`.
5. **Device 2 (KDS)**: Amati layar KDS.
   - **Hasil yang diharapkan**: ✅ **Nasi Goreng & Es Teh (Batch 1)**: TETAP berada di kolom **Selesai** (tidak di-reset ke Menunggu).
   - **Hasil yang diharapkan**: ✅ **Ayam Bakar (Batch 2)**: Muncul di kolom **Antrean Menunggu** dengan badge ungu **Kloter #2** dan badge 🆕 **Tambahan**.
   - **Hasil yang diharapkan**: ✅ Kartu di kolom Antrean Menunggu menampilkan badge **🔄 Pesanan Tambahan**.

**Hasil akhir C**: ✅ Sistem Order Batch mengisolasi Batch 1 dan Batch 2 secara sempurna. Dapur hanya menerima tiket dan antrean untuk menu tambahan baru.

---

## D. "Simpan Tanpa Cetak" → TIDAK Muncul di KDS

**Tujuan**: Memastikan pesanan pending yang disimpan tanpa opsi cetak tidak mengotori antrean KDS.

1. **Device 1 (Kasir)**: Tambahkan **Nasi Goreng × 1** ke keranjang baru.
2. Klik **Simpan Pending** → pilih **"Simpan Tanpa Cetak"**.
3. **Device 2 (KDS)**:
   - **Hasil yang diharapkan**: ✅ **TIDAK ada pesanan baru** yang masuk ke KDS.
4. **Device 1**: Buka **Pending Payments**.
   - **Hasil yang diharapkan**: ✅ Pesanan tersimpan di daftar pending payment.

**Hasil akhir D**: ✅ Pending "Tanpa Cetak" aman tersimpan tanpa memicu tiket dapur atau antrean KDS.

---

## E. Bayar Pesanan Pending (Finalisasi Transaksi)

**Tujuan**: Memastikan saat transaksi pending dibayar lunas di Kasir:
1. Status transaksi berubah menjadi **Selesai** (lunas).
2. Seluruh batch (Batch 1 + Batch 2) terkonsolidasi menjadi 1 struk pembayaran kasir lengkap.
3. Transaksi **TETAP berstatus Selesai di KDS dan TIDAK PERNAH muncul kembali ke Antrean Menunggu**.

1. **Device 2 (KDS)**: Klik **🔥 Proses** lalu **✅ Selesai** pada item **Ayam Bakar (Batch 2)** sehingga seluruh item pada pesanan telah selesai dimasak.
2. **Device 1 (Kasir)**:
   - Buka **Pending Payments** → cari pesanan meja tersebut → klik **"Lanjutkan Pembayaran"**.
   - Klik **Bayar** → pilih metode pembayaran (mis. Tunai) → selesaikan pembayaran.
3. **Cek Struk Kasir**:
   - **Hasil yang diharapkan**: ✅ Struk kasir mencetak rincian lengkap seluruh pesanan (Nasi Goreng × 1, Es Teh × 1, Ayam Bakar × 1).
4. **Device 2 (KDS)**: Amati layar KDS.
   - **Hasil yang diharapkan**: ✅ Transaksi **TETAP berada di kolom Selesai**.
   - **Hasil yang diharapkan**: 🚫 Transaksi yang sudah lunas **TIDAK PERNAH muncul kembali** di kolom Antrean Menunggu.
5. **Device 1 (Kasir)**: Buka riwayat **Transaksi**.
   - **Hasil yang diharapkan**: ✅ Status transaksi = **Selesai** (lunas) dengan rincian semua kloter.

**Hasil akhir E**: ✅ Transaksi lunas berkonsolidasi bersih, struk lengkap, dan status KDS tidak mengalami regresi ke Antrean Menunggu.

---

## F. Pengujian Multi-Kloter Bertahap (Batch 1 → Batch 2 → Batch 3)

**Tujuan**: Menguji ketahanan sistem terhadap penambahan pesanan berulang kali (dine-in bertahap).

1. **Order Awal**: Pesan Nasi Goreng × 1 → Simpan Pending (Cetak Dapur) $\rightarrow$ **Batch 1**.
2. **KDS**: Masak Batch 1 hingga **Selesai**.
3. **Tambah Pesanan 1**: Resume Pending → Tambah Es Teh × 1 → Simpan Pending (Cetak Dapur) $\rightarrow$ **Batch 2**.
   - Tiket keluar: `[BATCH #2 - TAMBAHAN #1]`.
4. **KDS**: Masak Batch 2 hingga **Selesai**.
5. **Tambah Pesanan 2**: Resume Pending → Tambah Kerupuk × 2 → Simpan Pending (Cetak Dapur) $\rightarrow$ **Batch 3**.
   - Tiket keluar: `[BATCH #3 - TAMBAHAN #2]`.
   - Di KDS: Nasi Goreng & Es Teh tetap di **Selesai**, Kerupuk muncul di **Antrean Menunggu** dengan badge **Kloter #3**.
6. **Finalize**: Kasir menyelesaikan pembayaran.
   - Struk kasir memuat Batch 1, Batch 2, dan Batch 3 secara rapi.
   - KDS mempertahankan seluruh item pada status **Selesai**.

**Hasil akhir F**: ✅ Multi-kloter berjalan dinamis tanpa batas dan selalu akurat.

---

## G. Pengujian Sinkronisasi Lintas Perangkat (Cloud Sync Realtime)

**Tujuan**: Memastikan data Order Batch dan status item tersinkronisasi realtime antara Kasir dan KDS.

1. **Device 1 (Kasir)**: Simpan Pending dengan Cetak Dapur Saja.
2. **Device 2 (KDS)**: Pesanan muncul di Antrean Menunggu dalam **< 5–10 detik**.
3. **Device 2 (KDS)**: Klik "Selesai" pada salah satu item.
4. **Device 1 (Kasir)**: Resume pesanan tersebut → sistem membaca status terbaru dari cloud (dengan `updatedAt` yang akurat) sehingga item yang sudah selesai tidak ter-reset saat kasir menambah menu baru.

---

## H. Pengujian Hak Akses Banner Printer Offline (Role-Based)

**Tujuan**: Memastikan banner peringatan *Printer Offline* hanya muncul pada user yang relevan (Manager dan Kasir) dan tidak mengganggu layar operasional Dapur/Barista (Acaraki).

1. **Login sebagai Kasir / Manager**:
   - Jika ada printer bluetooth terkonfigurasi namun belum tersambung / offline, banner `[Nama Printer] Offline [Sambungkan Ulang]` tampil di bagian atas layar.
2. **Login sebagai Acaraki (Dapur / Barista)**:
   - **Hasil yang diharapkan**: ✅ Banner printer offline di bagian atas aplikasi **TIDAK MUNCUL sama sekali**.
   - **Hasil yang diharapkan**: ✅ Header KDS tetap menampilkan tombol indikator printer senyap mandiri tanpa mengganggu operasional memasak.

---

## 📊 Matriks Verifikasi Fitur (Checklist)

| Skenario | Ekspektasi Tiket Dapur | Ekspektasi KDS | Status |
| :--- | :--- | :--- | :---: |
| **Simpan Pending (Batch 1)** | Header `[BATCH #1 - PESANAN AWAL]` tercetak | Item masuk ke **Antrean Menunggu** (Badge Baru) | ✅ Pass |
| **Proses di KDS** | - | Item berpindah: Menunggu $\rightarrow$ Diproses $\rightarrow$ Selesai | ✅ Pass |
| **Tambah Menu (Batch 2)** | Header `[BATCH #2 - TAMBAHAN #1]` (Hanya item baru) | Item Batch 1 **tetap Selesai**, item Batch 2 masuk **Menunggu** (Badge Kloter #2) | ✅ Pass |
| **Simpan Tanpa Cetak** | Tidak mencetak apapun | **Tidak muncul** di KDS | ✅ Pass |
| **Finalisasi / Bayar** | Struk kasir mencetak semua item dari seluruh Batch | Transaksi tetap di **Selesai** (tidak kembali ke Menunggu) | ✅ Pass |
| **Multi-Batch (Batch 3+)** | Header `[BATCH #3 - TAMBAHAN #2]` | Kloter lama tetap pada statusnya, kloter baru masuk Menunggu | ✅ Pass |
| **Role Acaraki (Dapur)** | - | Banner "Printer Offline" **tidak muncul** pada user Dapur | ✅ Pass |

---

> 💡 **Tips Pengujian**:
> Jika printer fisik Bluetooth belum terhubung saat pengujian, sistem otomatis menggunakan dialog **Browser Print** sebagai fallback sehingga Anda tetap dapat memverifikasi isi tiket dapur dan label Batch secara visual.
