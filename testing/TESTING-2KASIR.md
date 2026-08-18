# 🧪 Panduan Tes Manual — Skenario 2 Kasir & Offline v4.7 (Prioritas 18)

Panduan ini memverifikasi proteksi **dua kasir berjalan bersamaan** (Prioritas 18, 18.1–18.6 + A13): stok tidak bisa oversell (RPC atomik), nomor antrean tidak duplikat (RPC counter), satu shift aktif per outlet dengan expected cash tersinkron, banner "Laporan belum final", dan pencatatan transaksi **Demo** tanpa memotong stok. Ikuti urutan A → B → C → D → E (≈ 30–45 menit).

## 0. Persiapan

- **2 perangkat** dengan aplikasi terpasang & login **bersamaan**: Device 1 = Kasir (`kasir`/`kasir123`), Device 2 = Kasir atau Manager (`manager`/`manager123`).
- Koneksi internet stabil di kedua perangkat (kecuali langkah offline tertentu).
- **Prasyarat SQL**: jalankan **Migration 27** (RPC `adjust_inventory_stock`) & **Migration 28** (tabel `queue_counters` + RPC `allocate_queue_number`) dari `DEPLOYMENT.md` §4 (butir 12–13). Tanpa ini aplikasi memakai fallback aman (perilaku lama) — sebagian proteksi tidak aktif. Bila kolom/RPC belum ada, **console browser (F12)** mencetak SQL perbaikannya saat app dibuka.
- Siapkan **2 menu** dengan stok bahan cukup (mis. stok bahan X = 10) + 1 pelanggan.
- **DevTools (F12)** di kedua perangkat — tab **Console** untuk memantau log sinkronisasi & pesan koreksi stok.

> [!TIP] Semua proteksi di bawah berjalan otomatis — tidak ada tombol manual "periksa ulang" yang wajib ditekan; aplikasi memakai RPC database saat online dan fallback aman saat offline.

---

## A. Stok Tidak Bisa Oversell — 2 Kasir Menjual Menu Sama (18.1)

**Tujuan**: memastikan dua kasir yang menjual menu berbahan sama **tidak bisa memotong stok melebihi fisik** — yang kedua ditolak di level database, bukan memotong hingga negatif.

1. Pastikan stok bahan menu uji = **10** (Inventaris → Bahan Baku).
2. **Device 1 & Device 2**: buka POS, tambahkan menu uji (kebutuhan 1 bahan = 3) ke keranjang masing-masing. Siapkan pembayaran **tanpa klik Simpan dulu**.
3. **Bersamaan** (selisih < 1 detik): Device 1 klik **Simpan/Bayar** → langsung Device 2 klik **Simpan/Bayar**.
   - **Hasil yang diharapkan**: ✅ Kedua transaksi **Selesai** (tidak ada yang gagal), tetapi **total stok tidak pernah negatif**: deduksi berjalan 10 → 7 → 4. Tidak ada stok < 0.
4. **Kasus penolakan** (ulangi sampai stok habis): lanjutkan berjualan dari kedua device sampai stok hanya cukup untuk satu pesanan lagi, lalu checkout bersamaan lagi.
   - **Hasil yang diharapkan**: ✅ Transaksi pertama sukses; yang **kedua tetap Selesai** tapi muncul toast peringatan **"Stok … dikoreksi: kemungkinan sudah terjual perangkat lain. Periksa stok fisik."** dan stok lokal dikoreksi ke nilai cloud — kasir tidak diblokir, pesanan tidak hilang.
5. **Sinkron lintas device**: setelah langkah 3–4, buka Inventaris di device yang tidak menjual.
   - **Hasil yang diharapkan**: ✅ Stok tampil sama di kedua device (nilai cloud) tanpa reload manual.
6. **Offline (fallback aman)**: Device 1 matikan internet → jual 1 menu (stok lokal turun) → nyalakan internet → biarkan ≤ 30 detik.
   - **Hasil yang diharapkan**: ✅ Transaksi tetap tercatat; stok tersinkron otomatis; tidak ada error atau transaksi gagal (offline memakai deduksi lokal, lalu disinkronkan).

**Hasil akhir A**: ✅ Dua kasir tidak bisa oversell; penolakan dikoreksi + diperingatkan; offline tetap jalan aman.

---

## B. Nomor Antrean Unik — Checkout Bersamaan (18.2)

**Tujuan**: memastikan dua kasir yang menyelesaikan pembayaran bersamaan mendapat nomor antrean **berbeda** (RPC `allocate_queue_number`), dan bila fallback offline menghasilkan duplikat, aplikasi menandainya dengan badge **"#N duplikat"**.

1. Catat nomor antrean terakhir hari ini (halaman Transaksi, kolom #).
2. **Device 1 & Device 2**: siapkan masing-masing 1 transaksi berbeda → klik **Simpan/Bayar bersamaan** (selisih < 1 detik).
   - **Hasil yang diharapkan**: ✅ Nomor antrean **berbeda dan berurutan** (mis. #21 & #22) — tidak ada nomor yang sama. Counter lanjut dari nomor tertinggi, tidak melompat mundur.
3. Cek di Supabase (opsional): tabel `queue_counters` baris `(outlet, tanggal)` memiliki `last_number` = nomor tertinggi.
   - **Hasil yang diharapkan**: ✅ `last_number` sesuai transaksi terakhir — RPC berjalan atomik.
4. **Pengecualian split bill**: buat 1 pesanan → **Split Bill** (mis. 2 sub-bill) → selesaikan.
   - **Hasil yang diharapkan**: ✅ Semua sub-bill memakai **nomor yang sama** (1 pesanan = 1 nomor) dan **tidak** muncul badge duplikat — sub-bill split sengaja dikecualikan dari deteksi duplikat.
5. **Fallback offline + badge duplikat** (simulasi): Device 1 offline → checkout → nomor memakai `max+1` lokal. Lalu Device 2 (online) checkout dengan nomor yang sama secara kebetulan → setelah sync, buka halaman **Transaksi** di device 2.
   - **Hasil yang diharapkan**: ✅ Transaksi dengan nomor sama ditandai **"#N duplikat"** (ikon peringatan) — kasir tahu ada dua pesanan bernomor sama dan bisa meluruskan manual.

**Hasil akhir B**: ✅ Nomor antrean unik antar kasir via RPC; duplikat (offline) terlihat jelas, tidak tersembunyi.

---

## C. Satu Shift Aktif per Outlet + Expected Cash Tersinkron (18.3)

**Tujuan**: memastikan hanya **1 shift aktif** per outlet (kasir kedua diarahkan resume, bukan buka shift baru) dan expected cash tutup shift dihitung dari **semua transaksi Selesai tersinkron** + peringatan bila masih ada data belum sync.

1. **Device 1**: buka shift (menu Kasir → Buka Shift), masukkan kas awal (mis. 100.000).
   - **Hasil yang diharapkan**: ✅ Shift aktif tampil di header Device 1.
2. **Device 2**: buka menu Buka Shift.
   - **Hasil yang diharapkan**: ✅ Tidak bisa membuka shift kedua — muncul pesan kebijakan **"Sesuai kebijakan 1 shift aktif per outlet…"** dengan opsi **Resume shift yang sudah terbuka** (data shift Device 1 diambil dari cloud). Setelah resume, kedua device memakai shift yang sama.
3. **Expected cash lintas device**: Device 1 jual 1 menu tunai (50.000), Device 2 jual 1 menu tunai (25.000) → keduanya Selesai & tersinkron.
4. **Device 1**: buka modal **Tutup Shift** (jangan langsung tutup — periksa angkanya).
   - **Hasil yang diharapkan**: ✅ **Expected Cash = 100.000 + 50.000 + 25.000 = 175.000** — menghitung transaksi dari KEDUA device (bukan hanya kasir device ini); Total Penjualan & Total Transaksi juga gabungan.
5. **Peringatan belum sync**: Device 2 matikan internet → jual 1 menu tunai → **tanpa menunggu sync**, Device 1 buka modal Tutup Shift.
   - **Hasil yang diharapkan**: ✅ Muncul peringatan **"N data belum tersinkron … expected cash di bawah bisa belum lengkap (transaksi dari perangkat lain belum terhitung)"** + tombol **"Kirim & Muat Ulang"**.
6. Klik **Kirim & Muat Ulang** → Device 2 nyalakan internet → tunggu ≤ 30 detik → buka modal Tutup Shift lagi.
   - **Hasil yang diharapkan**: ✅ Peringatan hilang; expected cash kini **termasuk** transaksi Device 2 yang tadi offline.

**Hasil akhir C**: ✅ 1 shift per outlet (kasir kedua resume); expected cash = semua transaksi tersinkron; peringatan jelas bila data belum sync.

---

## D. Banner "Laporan belum final" (18.6)

**Tujuan**: memastikan header **Laporan** & **Dashboard** memberi tahu kasir/manager bahwa angka yang tampil **belum final** selama masih ada transaksi belum tersinkron atau antrean sinkron.

1. **Semua tersinkron** (buka Laporan & Dashboard di kedua device).
   - **Hasil yang diharapkan**: ✅ Tidak ada banner — laporan dianggap final.
2. **Device 1** matikan internet → catat **1 transaksi Selesai** → buka **Laporan** (semua tab: Penjualan, PPN, Promo, dll.) dan **Dashboard**.
   - **Hasil yang diharapkan**: ✅ Banner amber tampil di header: **"⚠️ Laporan belum final — N transaksi belum tersinkron ke cloud …"** (N sesuai jumlah transaksi offline + operasi antrean lain). Angka di bawahnya tetap tampil tapi ditandai bisa berubah.
3. **Device 2** (online, data belum menerima transaksi Device 1): buka Laporan.
   - **Hasil yang diharapkan**: ✅ Banner juga tampil di sisi lain selama data cloud belum lengkap — kedua device sadar laporannya belum final.
4. Nyalakan internet Device 1 → tunggu ≤ 30 detik (retry otomatis) → buka kembali Laporan/Dashboard di kedua device.
   - **Hasil yang diharapkan**: ✅ Banner hilang sendiri setelah semua data tersinkron (tanpa reload manual); angka laporan kini identik di kedua device.

**Hasil akhir D**: ✅ Setiap kali ada data belum sinkron, laporan/dashboard menampilkan peringatan "belum final" — tidak ada angka yang terlihat final padahal belum.

---

## E. Catat sebagai Demo — Tanpa Potong Stok (A13)

**Tujuan**: memastikan kasir bisa mencatat transaksi **demo** langsung dari POS (mis. uji coba menu ke pelanggan) **tanpa memotong stok**, tanpa nomor antrean, dan tanpa cetak — serta tidak tersedia saat resume pending.

1. **Device 1 (Kasir)**: POS → tambahkan beberapa menu ke keranjang → klik **Bayar** → di modal pembayaran klik **"Catat sebagai Demo (tidak memotong stok)"**.
   - **Hasil yang diharapkan**: ✅ Transaksi tercatat **Selesai/Demo**; tidak ada dialog cetak struk/tiket dapur yang muncul; stok bahan **TIDAK berkurang** (cek Inventaris sebelum & sesudah — sama).
2. Buka **Transaksi**.
   - **Hasil yang diharapkan**: ✅ Baris transaksi demo menampilkan label **DEMO** (bukan "#nomor") dan bisa ditemukan dengan pencarian kata "demo".
3. **Tidak memakai nomor antrean**: checkout 1 transaksi normal setelah demo.
   - **Hasil yang diharapkan**: ✅ Nomor antrean transaksi normal **tidak melompat** — demo tidak mengonsumsi nomor.
4. **Konversi Demo → Selesai** (opsional): di halaman Transaksi, ubah status transaksi demo menjadi Selesai.
   - **Hasil yang diharapkan**: ✅ Kini stok **baru terpotong** (perilaku 8.1) dan kunjungan pelanggan tercatat — stok tidak pernah bocor diam-diam.
5. **Guard resume pending**: buat **Pending Payment** → buka menu Pending → **Lanjutkan Pembayaran** → buka modal pembayaran.
   - **Hasil yang diharapkan**: ✅ Tombol **"Catat sebagai Demo" TIDAK tampil** (stok pending sudah terpotong — mengubahnya jadi demo akan membocorkan deduksi). Kasir hanya bisa lanjut bayar normal atau void.

**Hasil akhir E**: ✅ Demo tercatat tanpa stok/antrean/cetak, label DEMO jelas, dan tidak bisa dipakai untuk "menghilangkan" transaksi yang sudah memotong stok.

---

## Ringkasan Hasil

| Bagian | Fitur | Hasil yang Diharapkan |
|---|---|---|
| A | RPC stok atomik (18.1) | Tidak oversell; penolakan dikoreksi + peringatan |
| B | Nomor antrean unik (18.2) | # berbeda antar kasir; duplikat offline ber-badge |
| C | Shift tunggal + expected cash (18.3) | Resume shift; expected = semua transaksi tersinkron + peringatan belum-sync |
| D | Banner laporan belum final (18.6) | Tampil saat ada data belum sync di Laporan/Dashboard |
| E | Catat Demo (A13) | Tanpa stok/antrean/cetak; label DEMO; tidak saat resume pending |

> Bila ada langkah yang gagal, catat: device mana, langkah mana, dan apa yang tampil (toast/console) — lalu laporkan agar bisa diperbaiki. Detail implementasi & keputusan desain: `ANALYSE.md` Bagian E & Prioritas 18 di `TO DO.md`.
