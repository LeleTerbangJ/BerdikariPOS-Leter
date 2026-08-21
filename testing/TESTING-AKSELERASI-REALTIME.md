# ⚡ Panduan Pengujian Akselerasi Sinkronisasi Realtime & Banner Offline (v4.9.2)

Panduan ini memandu pengujian langkah-demi-langkah untuk memverifikasi bahwa:
1. **Kecepatan KDS (< 300 ms)**: Pesanan masuk dan perubahan status berpindah seketika tanpa jeda 3–8 detik.
2. **Banner UI Stabil**: Banner kuning *"N data belum tersinkron"* tidak lagi berkedip/muncul pada transaksi normal.
3. **Bulk Log Stok**: Pemotongan banyak bahan terkirim dalam 1 kali request ke cloud.
4. **Resiliensi Offline & Reconnect**: Data offline tersimpan aman dan tersinkronisasi utuh saat internet kembali terhubung.

---

## 0. Persiapan Lingkungan Uji

- **2 Perangkat / 2 Tab Browser Terpisah**:
  - **Tab/Device 1 (Kasir)**: Buka POS (`http://localhost:5173`) login sebagai `kasir` atau `manager`.
  - **Tab/Device 2 (KDS Dapur)**: Buka KDS (`http://localhost:5173/kitchen`) login sebagai `acaraki` atau `manager`.
- Buka **DevTools (F12) Console & Network** pada kedua tab untuk mengamati transmisi real-time WebSocket dan HTTP payload.
- Pastikan kedua tab dalam kondisi **Online** dan terhubung ke Supabase.

---

## ⚡ TES 1: Kecepatan Kemunculan Pesanan Baru di Layar KDS (< 300 ms)

**Tujuan**: Memastikan pesanan yang disimpan oleh Kasir langsung muncul di layar KDS secara instan tanpa perlu menunggu download 500 transaksi.

1. **Tab 1 (Kasir)**:
   - Pilih menu: **Nasi Goreng × 2** + **Es Teh × 2**.
   - Klik **Simpan Pending** → Pilih **"Cetak Struk (Dapur) Saja"**.
2. **Tab 2 (KDS Dapur)**:
   - Amati waktu respon di layar KDS saat tombol di Tab 1 diklik.
3. **Ekspektasi & Hasil**:
   - ✅ **Respon Instan (< 0.5 detik)**: Kartu pesanan langsung muncul di kolom **Antrean Menunggu** KDS.
   - ✅ **Suara Bel**: Notifikasi suara lonceng pesanan baru langsung berbunyi tepat waktu.
   - ✅ **DevTools Network (Tab 2)**: **TIDAK ADA** request besar `SELECT * FROM transactions LIMIT 500`. Layar dapur mengonsumsi data langsung dari `payload.new` WebSocket.

---

## ⚡ TES 2: Kecepatan Perubahan Status Dapur Multi-Layar (< 300 ms)

**Tujuan**: Memastikan saat koki menekan "Proses" atau "Selesai", status kartu di layar lain dan di modal Kasir ter-update seketika.

1. **Tab 2 (KDS Dapur)**:
   - Pada kartu pesanan dari Tes 1, klik tombol **🔥 Proses**.
   - Kemudian klik tombol **✅ Selesai**.
2. **Tab 1 (Kasir)**:
   - Buka modal **Pending Payments**.
3. **Ekspektasi & Hasil**:
   - ✅ Pada Tab 2, kartu pesanan langsung berpindah dari **Antrean Menunggu** $\rightarrow$ **Sedang Diproses** $\rightarrow$ **Selesai** tanpa lag.
   - ✅ Pada Tab 1 (Pending Payments), status pesanan langsung tampil **"Selesai (Siap Disajikan)"** tanpa kasir perlu me-refresh halaman.

---

## ⚡ TES 3: Verifikasi Banner UI "Data Belum Tersinkron" (Tidak Berkedip)

**Tujuan**: Memastikan mekanisme *Debounce 2.5 Detik* mencegah banner kuning muncul saat proses transaksi berjalan normal.

1. **Tab 1 (Kasir)**:
   - Masukkan 3 menu ke keranjang.
   - Lakukan pembayaran langsung (**Bayar Sekarang** $\rightarrow$ **Cash** $\rightarrow$ **Selesai**).
2. **Amati Bagian Atas Layar (Header Tab 1 & Tab 2)**:
3. **Ekspektasi & Hasil**:
   - ✅ **Tidak Ada Kedipan Banner**: Banner kuning *"N data belum tersinkron"* **SAMA SEKALI TIDAK MUNCUL / TIDAK BERKEDIP** di layar.
   - ✅ Struk tercetak dan transaksi selesai secara tenang dan bersih.

---

## ⚡ TES 4: Verifikasi Bulk Insert Log Stok Bahan Baku

**Tujuan**: Memastikan pemotongan stok bahan dari resep menu dikirimkan sekaligus dalam 1 request batch, bukan N request terpisah.

1. **Tab 1 (Kasir)**:
   - Buka DevTools (F12) $\rightarrow$ tab **Network** $\rightarrow$ filter: `stock_logs`.
   - Pilih menu yang memiliki resep banyak bahan (misal Paket Komplit dengan 3-5 bahan).
   - Klik **Bayar Sekarang** $\rightarrow$ selesaikan transaksi.
2. **Amati Permintaan Network**:
3. **Ekspektasi & Hasil**:
   - ✅ **Hanya 1 Request `POST /rest/v1/stock_logs`**: Seluruh log bahan terbungkus dalam format JSON Array `[ { ... }, { ... }, { ... } ]`.
   - ✅ Beban HTTP berkurang hingga 70%, mempercepat proses checkout.

---

## ⚡ TES 5: Uji Ketahanan Mode Offline & Reconnection Otomatis (Safety Net)

**Tujuan**: Memastikan sistem tetap berjalan 100% lancar saat internet terputus, dan seluruh data tersinkronisasi otomatis saat internet kembali.

1. **Simulasi Offline**:
   - Pada Tab 1 (Kasir), buka DevTools (F12) $\rightarrow$ tab **Network** $\rightarrow$ ubah Throttling menjadi **Offline** (atau matikan Wi-Fi).
2. **Cek Banner Offline**:
   - ✅ Banner merah langsung muncul seketika: *"Offline — data tersimpan lokal, akan tersinkron otomatis"*.
3. **Buat Transaksi Saat Offline**:
   - Tambahkan menu dan klik **Simpan Pending** atau **Bayar**.
   - ✅ Transaksi berhasil dicatat di lokal, struk tercetak normal, nomor antrean bertambah.
4. **Simulasi Internet Pulih (Online Kembali)**:
   - Ubah kembali Throttling ke **No throttling** (atau nyalakan Wi-Fi).
5. **Ekspektasi & Hasil**:
   - ✅ Sistem otomatis mengeksekusi `flushQueue()` dan mengirim seluruh data tertunda.
   - ✅ Sistem menjalankan **Safety Net Full Sync 1× (`fetchTransactionsFromCloud`)** untuk merekonsiliasi seluruh data.
   - ✅ Banner offline otomatis menghilang dan KDS di Tab 2 langsung menerima pesanan offline tersebut.

---

## ⚡ TES 6: Uji Multi-Kasir Simultan & Anti-Ghosting (Tombstone Guard)

**Tujuan**: Memastikan pembatalan/penghapusan transaksi di satu perangkat tidak memunculkan kembali transaksi hantu (*ghost order*).

1. **Tab 1 (Kasir)**:
   - Buka **Riwayat Transaksi** $\rightarrow$ cari salah satu transaksi pending $\rightarrow$ klik **Batalkan / Hapus Transaksi**.
2. **Tab 2 (KDS Dapur)**:
   - Amati layar KDS.
3. **Ekspektasi & Hasil**:
   - ✅ Kartu pesanan di KDS langsung terhapus seketika via event `DELETE`.
   - ✅ Sinyal WebSocket tidak membangkitkan transaksi kembali (*Tombstone Guard aktif*).

---

## 📊 Lembar Checklist Hasil Uji

| No | Pengujian | Target Waktu / Respon | Hasil Pengujian |
|---|---|---|---|
| 1 | Pesanan baru masuk ke KDS | $< 300 \text{ ms}$ (Instan) | [ ] Lulus / [ ] Gagal |
| 2 | Perubahan status KDS di semua tab | $< 300 \text{ ms}$ (Instan) | [ ] Lulus / [ ] Gagal |
| 3 | Banner *"N data belum sync"* saat normal | Tidak Muncul / Tenang | [ ] Lulus / [ ] Gagal |
| 4 | Pengiriman log stok bahan resep | 1 Request Batch Insert | [ ] Lulus / [ ] Gagal |
| 5 | Transaksi Offline + Auto Reconnect | Data tersinkron utuh | [ ] Lulus / [ ] Gagal |
| 6 | Hapus transaksi (Anti-Ghosting) | Hilang di semua layar | [ ] Lulus / [ ] Gagal |
