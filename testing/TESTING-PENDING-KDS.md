# 🧪 Panduan Tes Manual — Pesanan Pending di KDS (v4.8.2)

Panduan ini memverifikasi bahwa **pesanan pending (gantung) otomatis muncul di Kitchen Display System (KDS)** sesuai opsi pencetakan yang dipilih kasir, termasuk skenario resume edit & finalisasi pembayaran. Ikuti urutan A → B → C → D → E (≈ 15–20 menit).

---

## 0. Persiapan

- **2 perangkat**: Device 1 = Kasir (`kasir`/`kasir123`), Device 2 = Dapur/KDS (`manager`/`manager123`).
- Buka **POS** di Device 1, buka **Kitchen Display System (KDS)** di Device 2.
- Pengaturan cetak pesanan gantung: **Settings → Pengaturan Cetak → Pencetakan Pesanan Gantung → "Tanyakan Pilihan Cetak saat Simpan Pending"**.
- Siapkan **2 menu** uji (mis. Nasi Goreng Rp15.000, Es Teh Rp5.000).
- **DevTools (F12)** di kedua perangkat — tab **Console** untuk memantau log `[AtomicEngine]`.

---

## A. "Cetak Struk (Dapur) Saja" → Muncul di KDS

**Tujuan**: memastikan pesanan yang disimpan dengan opsi "Cetak Struk (Dapur) Saja" **langsung muncul di kolom Antrean Menunggu** KDS.

1. **Device 1 (Kasir)**: tambahkan Nasi Goreng × 1 ke keranjang.
2. Klik **Simpan Pending** → muncul modal pilihan cetak.
3. Pilih **"Cetak Struk (Dapur) Saja"**.
4. **Device 2 (KDS)**: amati layar KDS.
   - **Hasil yang diharapkan**: ✅ Pesanan muncul di kolom **Antrean Menunggu** dengan badge 🆕 **Baru** pada item Nasi Goreng.
   - **Hasil yang diharapkan**: ✅ Nomor antrean (#N) dan waktu pencatatan tampil dengan benar.
   - **Console**: log `[AtomicEngine] kitchenTicketPrintedAt stamped for Tx #xxx at ... (intent-based)`.
5. Cek riwayat transaksi di Device 1.
   - **Hasil yang diharapkan**: ✅ Status transaksi = **Pending** (belum dibayar).

**Hasil akhir A**: ✅ Pending dengan "Cetak Dapur Saja" muncul di KDS — tiket dapur tercetak + visibilitas KDS aktif.

---

## B. "Cetak Struk Sekarang (Kasir & Dapur)" → Muncul di KDS

**Tujuan**: memastikan pesanan yang disimpan dengan opsi "Cetak Struk Sekarang" juga **langsung muncul di KDS**.

1. **Device 1 (Kasir)**: tambahkan Es Teh × 1 ke keranjang.
2. Klik **Simpan Pending** → pilih **"Cetak Struk Sekarang (Kasir & Dapur)"**.
3. **Device 2 (KDS)**: amati layar KDS.
   - **Hasil yang diharapkan**: ✅ Pesanan baru muncul di kolom **Antrean Menunggu** (bersama pesanan dari langkah A jika belum diproses).
   - **Hasil yang diharapkan**: ✅ Badge 🆕 **Baru** pada item Es Teh.
4. Cek Device 1.
   - **Hasil yang diharapkan**: ✅ Struk kasir tercetak / preview struk muncul.

**Hasil akhir B**: ✅ Pending dengan "Cetak Kasir & Dapur" muncul di KDS + struk kasir tercetak.

---

## C. "Simpan Tanpa Cetak" → TIDAK Muncul di KDS

**Tujuan**: memastikan pesanan yang disimpan tanpa cetak **tidak muncul di KDS**.

1. **Device 1 (Kasir)**: tambahkan Nasi Goreng × 1 ke keranjang.
2. Klik **Simpan Pending** → pilih **"Simpan Tanpa Cetak"**.
3. **Device 2 (KDS)**: amati layar KDS.
   - **Hasil yang diharapkan**: ✅ **TIDAK ada pesanan baru** muncul di KDS (hanya pesanan dari langkah A & B yang masih visible).
   - **Console**: **TIDAK** ada log `kitchenTicketPrintedAt stamped` untuk transaksi ini.
4. Buka **Pending Payments** di Device 1.
   - **Hasil yang diharapkan**: ✅ Pesanan "Simpan Tanpa Cetak" **ada di daftar** pending payment (tercatat, tapi tidak di KDS).

**Hasil akhir C**: ✅ Pending "Tanpa Cetak" tidak mengganggu KDS — hanya terlihat di daftar pending payment.

---

## D. Resume Pending (Tambah Menu) → Item Baru Muncul di KDS

**Tujuan**: memastikan saat kasir **mengedit** pesanan pending (tambah menu) dan menyimpan ulang dengan opsi cetak, **hanya item baru** yang muncul di KDS dengan badge **TAMBAHAN**.

1. **Device 1 (Kasir)**: buka **Pending Payments** → cari pesanan dari langkah A → klik **"Lanjutkan Pembayaran"**.
2. Tambahkan **Es Teh × 1** ke keranjang (menu baru yang belum ada).
3. Klik **Simpan Pending** → pilih **"Cetak Struk (Dapur) Saja"**.
4. **Device 2 (KDS)**: amati pesanan yang sedang diproses.
   - **Hasil yang diharapkan**: ✅ Item **Nasi Goreng** tetap dengan status badge yang sama (🔴 Baru / 🔵 Diproses / ✅ Selesai — tergantung status sebelumnya).
   - **Hasil yang diharapkan**: ✅ Item **Es Teh** muncul dengan badge 🆕 **Baru** (item tambahan).
   - **Hasil yang diharapkan**: ✅ Header tiket dapur menampilkan **========== ========== TAMBAHAN ==========`** (tiket delta).
5. Proses item Es Teh di KDS: klik **🔥Proses** → item berpindah ke kolom **Sedang Diproses**.
   - **Hasil yang diharapkan**: ✅ Item Nasi Goreng **tidak terpengaruh** oleh perubahan status Es Teh.

**Hasil akhir D**: ✅ Edit pending → item baru muncul di KDS dengan badge TAMBAHAN; item lama tetap pada statusnya.

---

## E. Bayar Pending → Status Berubah di KDS

**Tujuan**: memastikan saat pesanan pending **dibayar (finalisasi)**, status transaksi berubah dari Pending → Selesai dan item tetap terlihat di KDS.

1. **Device 1 (Kasir)**: buka **Pending Payments** → cari pesanan dari langkah A → klik **"Lanjutkan Pembayaran"**.
2. Pilih metode pembayaran → klik **Bayar** (atau **Cetak Struk Sekarang**).
3. **Device 2 (KDS)**: amati perubahan status.
   - **Hasil yang diharapkan**: ✅ Pesanan tetap ada di KDS (status tidak hilang mendadak).
   - **Hasil yang diharapkan**: ✅ Semua item menunjukkan status terkini (sesuai yang sudah diproses).
4. Proses semua item di KDS hingga **Selesai**.
   - **Hasil yang diharapkan**: ✅ Pesanan berpindah ke kolom **Selesai**.
5. **Device 1 (Kasir)**: buka halaman **Transaksi**.
   - **Hasil yang diharapkan**: ✅ Status transaksi = **Selesai** (bukan Pending lagi).

**Hasil akhir E**: ✅ Finalisasi pending → status berubah ke Selesai di KDS dan riwayat transaksi.

---

## F. Guard: Resume Pending "Simpan Tanpa Cetak" → Baru Muncul di KDS

**Tujuan**: memastikan pesanan yang awalnya "Simpan Tanpa Cetak" **bisa muncul di KDS** saat dikedit dan disimpan ulang dengan opsi cetak.

1. **Device 1 (Kasir)**: buka **Pending Payments** → cari pesanan dari langkah C (Simpan Tanpa Cetak) → klik **"Lanjutkan Pembayaran"**.
2. Tambahkan menu apa saja (mis. Nasi Goreng × 1).
3. Klik **Simpan Pending** → pilih **"Cetak Struk (Dapur) Saja"**.
4. **Device 2 (KDS)**: amati KDS.
   - **Hasil yang diharapkan**: ✅ Pesanan **sekarang muncul** di KDS (sebelumnya tidak ada karena "Tanpa Cetak").
   - **Hasil yang diharapkan**: ✅ Semua item ditampilkan dengan badge 🆕 **Baru** (karena pertama kali masuk KDS).
5. **Device 1 (Kasir)**: buka halaman **Transaksi**.
   - **Hasil yang diharapkan**: ✅ Status transaksi tetap **Pending** (belum dibayar, hanya status cetak berubah).

**Hasil akhir F**: ✅ Pending "Tanpa Cetak" bisa "diaktifkan" ke KDS dengan edit + simpan ulang + opsi cetak.

---

## Ringkasan Hasil

| Bagian | Skenario | Hasil yang Diharapkan |
|--------|----------|----------------------|
| A | Cetak Dapur Saja | ✅ Muncul di KDS + tiket tercetak |
| B | Cetak Kasir & Dapur | ✅ Muncul di KDS + struk kasir tercetak |
| C | Simpan Tanpa Cetak | ✅ **Tidak** muncul di KDS |
| D | Resume + Tambah Menu | ✅ Item baru badge TAMBAHAN; item lama tetap statusnya |
| E | Bayar Pending | ✅ Status berubah ke Selesai; item tetap di KDS |
| F | Aktifkan "Tanpa Cetak" | ✅ Pesanan muncul di KDS setelah edit + simpan ulang cetak |

> Bila ada langkah yang gagal, catat: **device mana, langkah mana, dan apa yang tampil** (toast/console) — lalu laporkan agar bisa diperbaiki. Detail implementasi: `atomicTransactionEngine.ts` (intent-based stamp), `Kitchen.tsx` (filter KDS), `POS.tsx` (modal opsi cetak pending).
