# 🧪 Panduan Tes Manual — Mode Offline v4.7 (Prioritas 13)

Panduan ini memverifikasi **mode offline andal** (Prioritas 13, O-1–O-10): antrean IndexedDB, retry berkala, daftar operasi gagal, badge "Belum Sync", deteksi konflik stok, dan PWA offline. Ikuti urutan A → B → C → D → E → F (≈ 30–45 menit). Berlaku untuk semua device (Kasir, Dapur, Manager).

## 0. Persiapan

- **2 perangkat** dengan aplikasi terpasang & login: Device 1 (Kasir) + Device 2 (Manager/Dapur).
- Koneksi internet stabil di kedua perangkat (kecuali saat langkah offline).
- **DevTools (F12)** di kedua perangkat — tab **Console** untuk memantau log sinkronisasi & tab **Application → IndexedDB → `berdikari-pos`** untuk memeriksa antrean.
- Siapkan 1–2 menu dengan stok bahan cukup + 1 pelanggan bernomor HP.
- Akun default seed: Manager `manager`/`manager123`, Kasir `kasir`/`kasir123`.

> [!TIP] Semua perilaku di bawah otomatis — tidak ada tombol manual "sync" yang wajib ditekan. Aplikasi menyinkronkan sendiri saat online (retry 30 detik + saat tab kembali terlihat).

---

## A. Antrean Offline di IndexedDB (O-1)

**Tujuan**: memastikan operasi offline tersimpan di IndexedDB (kuota besar) dan **bertahan walau aplikasi ditutup** — bukan di localStorage yang mudah penuh.

1. **Device 1**: buka DevTools → **Application → IndexedDB → `berdikari-pos`**.
   **Hasil yang diharapkan**: ✅ database ada; store `kv` berisi kunci `rempah-offline-queue` (dan `rempah-offline-queue-failed`) — bisa kosong `[]` bila tidak ada antrean.

2. **Uji bertahan saat reload**: Device 1 offline (lihat langkah D) → catat 1 transaksi (Selesai) → **tutup aplikasi/browser sepenuhnya** → buka lagi (masih offline) → buka halaman Transaksi.
   **Hasil yang diharapkan**: ✅ Transaksi yang dicatat tadi **masih ada**; badge "Belum Sync" tetap tampil. Antrean tidak hilang saat aplikasi ditutup.

3. **Migrasi otomatis dari localStorage** (hanya bila sebelumnya pernah pakai versi lama): buka Console.
   **Hasil yang diharapkan**: ✅ Log berisi pesan migrasi antrean (legacy localStorage → IndexedDB); tidak ada data hilang.

4. **Payload besar**: Device 1 offline → buat transaksi dengan banyak item (10+ menu) → cek Console tidak ada error `QuotaExceededError`.
   **Hasil yang diharapkan**: ✅ Transaksi tersimpan & tersinkron setelah online.

**Hasil akhir A**: ✅ Operasi offline tersimpan di IndexedDB, bertahan saat reload/tutup aplikasi, tanpa error kuota.

---

## B. Retry Berkala & Sinkron Otomatis (O-2)

**Tujuan**: memastikan antrean ter-flush otomatis — termasuk kasus "Wi-Fi tersambung tapi tanpa internet" yang tidak memicu event `online`.

1. **Device 1**: matikan internet → catat **1 transaksi** + **1 Kas Masuk** di Rekap Kas.
2. Nyalakan internet kembali. **Jangan sentuh aplikasi** — tunggu hingga **≤ 30–40 detik** (satu siklus retry).
   **Hasil yang diharapkan**: ✅ Badge "Belum Sync" hilang sendiri; toast sukses muncul; Console mencatat flush antrean sukses.
3. **Device 2**: refresh halaman Transaksi & Laporan Shift → Rekap Laci Kas.
   **Hasil yang diharapkan**: ✅ Transaksi & Kas Masuk tampil di device 2 (tanpa reload device 1, tanpa tombol manual).
4. **Uji pindah tab / device sleep**: Device 1 offline → catat transaksi → buka tab lain / biarkan perangkat tidur 1 menit → kembali ke tab aplikasi.
   **Hasil yang diharapkan**: ✅ Saat kembali (event `visibilitychange`) aplikasi langsung mencoba sinkron — Console mencatat flush.
5. **Uji "Wi-Fi tanpa internet"** (simulasi): aktifkan Wi-Fi yang tidak punya akses internet → catat transaksi → ganti ke internet normal.
   **Hasil yang diharapkan**: ✅ Selama tidak ada internet, transaksi tetap tersimpan & badge tampil; setelah internet normal, **otomatis tersinkron ≤ 30 detik** — tidak menunggu event `online` (yang tidak pernah muncul di kasus ini).

**Hasil akhir B**: ✅ Sinkron otomatis ≤ 30 detik setelah online, termasuk kasus Wi-Fi tanpa internet.

---

## C. Daftar Operasi Gagal — Tidak Ada Data Hilang Diam-diam (O-3)

**Tujuan**: memverifikasi operasi yang gagal permanen (biasanya izin/kolom database) **tidak di-drop** — tampil di daftar dengan alasan, bisa dicoba lagi atau dihapus dengan konfirmasi.

> **Prasyarat**: perlu operasi yang gagal permanen. Cara paling mudah: buat kolom yang di-referensikan tidak ada (mis. hapus dulu kolom `promo_name` di tabel `transactions` via Supabase, lalu catat transaksi ber-promo offline) — atau gunakan akun tanpa izin tulis. **Kembalikan kolom/izin setelah pengujian.**

1. Buat kondisi gagal permanen (lihat prasyarat) → catat operasi terkait offline → online.
   **Hasil yang diharapkan**: ✅ Di header muncul **badge merah `N!`** pada tombol status cloud; **banner merah "N operasi gagal sinkron — klik untuk lihat"** tampil di semua halaman (mobile juga).
2. Klik banner/badge → **modal "⚠️ Operasi Gagal Sinkron (Permanen)"** terbuka.
   **Hasil yang diharapkan**: ✅ Daftar berisi operasi dengan **tabel**, **aksi**, **waktu gagal**, dan **alasan error** (`lastError`); teks penjelas "Data ini tidak dihapus — coba lagi setelah diperbaiki".
3. Klik **"Coba Lagi Semua"**.
   **Hasil yang diharapkan**: ✅ Toast "N operasi dipindah ke antrean & dicoba ulang"; bila masih gagal, operasi kembali ke daftar (tidak hilang). Audit log mencatat `sync_retry`.
4. Klik **"Hapus Semua"** → muncul **konfirmasi jelas** ("TIDAK akan dikirim lagi ke cloud dan bisa hilang permanen…") → **"Ya, Hapus"**.
   **Hasil yang diharapkan**: ✅ Daftar kosong; banner merah hilang; audit log mencatat `sync_failed_cleared`.
5. **Audit log**: buka halaman Audit — pastikan ada entri `sync_failed` (saat gagal pertama), `sync_retry`, dan `sync_failed_cleared` dengan detail jumlah.
6. Kembalikan kolom/izin yang diubah di prasyarat → ulangi langkah 1–2 → **"Coba Lagi Semua"**.
   **Hasil yang diharapkan**: ✅ Operasi **berhasil terkirim** dan hilang dari daftar gagal (data tidak pernah hilang).

**Hasil akhir C**: ✅ Operasi gagal selalu terlihat + bisa diulang; tidak ada data ter-drop diam-diam.

---

## D. Badge "Belum Sync" per Transaksi (O-5)

**Tujuan**: memverifikasi indikator sinkronisasi **per baris transaksi** + hitungan di header Riwayat Transaksi.

1. Device 1 offline → catat **2 transaksi** (Selesai).
2. Buka **halaman Transaksi** (masih offline).
   **Hasil yang diharapkan**: ✅ Kedua transaksi baru tampil dengan **badge "⏳ Belum Sync"**; header menampilkan **"⚠️ 2 belum sync"**; transaksi lama (sudah sync) **tanpa** badge.
3. Online → tunggu ≤ 30 detik (atau klik banner kuning "N data belum tersinkron — klik untuk kirim sekarang").
   **Hasil yang diharapkan**: ✅ Badge "Belum Sync" dan hitungan **hilang otomatis** tanpa reload.
4. **Device 2**: refresh → kedua transaksi tampil tanpa badge.
5. **Perilaku badge konsisten**: offline → transaksi baru → **jangan reload** → online → badge hilang di baris yang sama.

**Hasil akhir D**: ✅ Indikator per-transaksi akurat: tampil saat belum sync, hilang otomatis setelah tersinkron.

---

## E. Banner Offline & Konflik Stok (O-4, O-6, O-7)

**Tujuan**: memverifikasi banner status global (semua device/role), peringatan cold start, dan deteksi konflik stok lintas device.

### E1. Banner offline global
1. Device 1 offline (setelah pernah online di sesi ini) → buka halaman mana pun.
   **Hasil yang diharapkan**: ✅ Banner merah **"Offline — data tersimpan lokal, akan tersinkron otomatis"** tampil di **atas konten, semua halaman** (termasuk di mobile, tidak tersembunyi di sidebar).
2. Kembalikan internet → banner hilang ≤ 30 detik.

### E2. Peringatan cold start (perangkat baru)
1. **Perangkat baru** (belum pernah online, mis. install fresh lalu langsung offline) → buka aplikasi.
   **Hasil yang diharapkan**: ✅ Banner offline menampilkan teks khusus **"Offline sejak awal — data cloud belum dimuat (perangkat baru?); transaksi tetap bisa dicatat & akan tersinkron"** — berbeda dari banner biasa.
2. Online → data cloud termuat → banner hilang.

### E3. Deteksi konflik stok lintas device
> **Skenario konflik**: dua device offline memproses stok terakhir bahan yang sama → deduksi salah satu device "tertimpa" cloud (last-write-wins).

1. Siapkan bahan dengan stok kecil (mis. **5**).
2. **Device 1 & Device 2** sama-sama offline → masing-masing jual menu yang memakai bahan itu (deduksi dari **5** di kedua device).
3. **Device 2** online duluan → deduksi tersimpan ke cloud (stok cloud = 5−1 = **4**).
4. **Device 1** online → deduksi lokalnya (5→4) di-merge dengan cloud **4** → **tidak ada konflik** (nilai sama) — ini normal.
   **Hasil yang diharapkan**: ✅ Tidak ada banner bising untuk skenario sama-nilai.
5. **Buat konflik nyata**: Device 1 offline, lalu di **Device 2 (online)** lakukan **adjustment manual stok +3** (stok cloud naik). Device 1 online → `loadFromCloud` melihat **cloud > stok lokal** sebelum merge.
   **Hasil yang diharapkan**: ✅ Di halaman **Inventaris (Device 1)** muncul **banner kuning "Stok berubah di perangkat lain (N bahan)"** dengan daftar bahan (nilai lokal → cloud, +diff) + penjelasan "Nilai cloud lebih tinggi dari stok lokal sebelum sinkron — bisa berarti deduksi dari perangkat ini tertimpa…".
6. Klik **"Pahami"**.
   **Hasil yang diharapkan**: ✅ Banner hilang (hanya untuk sesi ini); tidak muncul lagi hingga ada konflik baru. Stok sistem tetap memakai nilai cloud (sinkron, tidak dobel).

**Hasil akhir E**: ✅ Banner offline tampil di semua device; cold start terdeteksi; konflik stok terlihat & bisa dipahami tanpa menghalangi operasional.

---

## F. PWA Offline (O-9)

**Tujuan**: memverifikasi aplikasi **terbuka & tetap bisa dipakai tanpa internet** (app shell precache + navigasi fallback + cache aset NetworkFirst).

1. Device 1: pastikan pernah online (service worker ter-registrasi) → **tutup semua tab aplikasi** → **matikan internet** → buka URL aplikasi.
   **Hasil yang diharapkan**: ✅ Aplikasi **terbuka** (bukan halaman error browser); halaman login/pos tampil dari cache; banner offline muncul; **navigasi antar halaman (POS, Transaksi, Inventaris) tetap berfungsi**.
2. (Opsional) DevTools → **Application → Service Workers**: status `activated & running`; **Application → Cache Storage** berisi precache (`index.html`, aset) + cache `same-origin-assets`.
3. Catat transaksi dalam kondisi ini → online → tersinkron (langkah B).
4. **Catatan penting**: aset yang **belum pernah dimuat** saat online (mis. chunk halaman yang belum dibuka) mungkin tidak tersedia saat offline pertama — buka semua halaman yang penting sekali saat online agar ter-cache.

**Hasil akhir F**: ✅ Aplikasi terbuka & berfungsi tanpa internet; data tercatat dan tersinkron saat online.

---

## Ringkasan Hasil

| Tahap | Area | Status |
|---|---|---|
| A | Antrean IndexedDB (bertahan reload, migrasi, payload besar) | ☐ |
| B | Retry berkala 30 dtk + visibilitychange + Wi-Fi tanpa internet | ☐ |
| C | Failed-ops list (badge merah, modal, Coba Lagi, Hapus + audit log) | ☐ |
| D | Badge "Belum Sync" per transaksi + hitungan header | ☐ |
| E | Banner offline global + cold start + deteksi konflik stok | ☐ |
| F | PWA offline (buka tanpa internet, navigasi tetap jalan) | ☐ |

> Jika semua tahap ☐ ✅, mode offline siap digunakan di lapangan. Jika ada yang gagal, catat langkah + pesan error + isi Console, lalu laporkan ke tim pengembangan (detail teknis di `AI-HANDOFF.md` §17.9 & `TO DO.md` Prioritas 13).

---

*Panduan lain: [`TESTING-PRADEPLOY.md`](./TESTING-PRADEPLOY.md) (verifikasi pra-deploy), [`TESTING-DEMO-SALES.md`](./TESTING-DEMO-SALES.md) (demo penjualan), [`TESTING-OPNAME.md`](./TESTING-OPNAME.md) (stock opname), [`TESTING-STRUK-DIGITAL.md`](./TESTING-STRUK-DIGITAL.md) (struk WA/email).*
