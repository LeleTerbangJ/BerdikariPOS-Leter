# 🧪 Panduan Tes Manual — Printer Thermal & Split Printer v4.7 (Prioritas 14)

Panduan ini memverifikasi **integrasi printer thermal & split printer** (Prioritas 14, 14.1–14.6): auto re-pair pasca-refresh, kebijakan fallback (tanpa dialog Bluetooth di tengah checkout), fallback browser eksplisit per printer, print queue FIFO, status lintas tab + indikator KDS, dan UX notifikasi toast. Ikuti urutan A → B → C → D → E → F (≈ 30–45 menit). Berlaku untuk device **Kasir** (struk) dan **Dapur/KDS** (tiket dapur).

## 0. Persiapan

- **Chrome atau Edge versi terbaru** — Web Bluetooth **tidak** didukung di Firefox/Safari (lihat catatan batasan di bawah).
- **Printer thermal Bluetooth** yang pernah dipairing, dalam keadaan **nyala** & berjarak dekat. (Opsional: 2 printer dapur/bar untuk menguji split print.)
- Login sebagai **Manager** atau **Kasir** (akun seed: `manager`/`manager123`, `kasir`/`kasir123`).
- **Setup awal di Settings → Printer**:
  1. **Metode Cetak** → pilih **"Bluetooth (Web Bluetooth API)"** (atau "Browser Print" bila hanya ingin menguji mode browser).
  2. **Printer Kasir** → klik **"Hubungkan Printer"** → pilih device di dialog Bluetooth → **Test Print** harus berhasil.
  3. (Opsional split print) **"Tambah Printer Dapur"** → isi nama + target (mis. `Minuman`/`Makanan`) → **Tipe = Bluetooth** → **Hubungkan** → Test Print.

> [!NOTE] **Batasan platform (bukan bug)**: Web Bluetooth butuh *user gesture* (klik) dan izin "remember device" — tidak ada koneksi ulang otomatis 100% setelah refresh. Yang aplikasi lakukan: **mencoba re-pair senyap** via `getDevices()` (tanpa dialog); bila gagal, **banner 1-klik** muncul — kasir tidak perlu pairing ulang dari awal. Di browser tanpa Web Bluetooth, mode Browser Print tetap berfungsi.

---

## A. Auto Re-pair Pasca-Refresh (14.1 P-1, P-2, P-4)

**Tujuan**: setelah refresh (yang memutus koneksi Web Bluetooth), printer tersambung kembali dengan **maksimal 1 klik** — tanpa dialog pilih device.

1. Settings → Printer → hubungkan **Printer Kasir** → Test Print berhasil.
2. **Refresh halaman (F5)**.
   **Hasil yang diharapkan**: ✅ Salah satu dari dua hal — (a) printer langsung tersambung kembali (re-pair senyap via `getDevices()`), atau (b) muncul **banner merah "Refresh memutus koneksi Printer Kasir — klik untuk menyambungkan kembali"** (tidak bisa ditutup).
3. Klik **"Sambungkan Ulang"**.
   **Hasil yang diharapkan**: ✅ Terhubung; banner berubah hijau **"Semua Printer Terhubung"** (hilang sendiri ± 4 detik); **Test Print langsung berhasil tanpa membuka dialog Bluetooth**.
4. **Multi-printer**: sambungkan 2 printer dapur → refresh → klik **"Sambungkan Semua"**.
   **Hasil yang diharapkan**: ✅ Kedua printer tersambung kembali; banner hijau menampilkan jumlah printer terhubung.
5. **Sesi dibersihkan saat putus manual**: Settings → **"Putuskan"** printer → refresh → refresh.
   **Hasil yang diharapkan**: ✅ Banner "Refresh memutus koneksi…" **TIDAK muncul** (aplikasi tahu printer sengaja diputus).

**Hasil akhir A**: ✅ Setelah refresh, printer bisa tersambung kembali dengan maksimal 1 klik — tanpa dialog pilih device.

---

## B. Tidak Ada Dialog Bluetooth di Tengah Checkout (14.1 P-3 + 14.2)

**Tujuan**: saat printer terputus di tengah transaksi, kasir **tidak diblokir** dan **tidak ada dialog Bluetooth muncul tiba-tiba** — struk/tiket dialihkan ke dialog cetak browser + notifikasi jelas.

1. Siapkan **1 transaksi** di POS (2–3 item).
2. **Matikan printer** (atau putuskan koneksinya) — biarkan Settings terbuka agar terlihat tidak ada dialog.
3. **Checkout / bayar** (auto print ON, atau cetak struk manual setelah selesai).
   **Hasil yang diharapkan**: ✅ Transaksi **tetap selesai**; **TIDAK ada dialog Bluetooth** yang muncul; struk dicetak lewat **dialog cetak browser** (pilih printer termal di dialog OS); **toast kuning** muncul: *"Printer "Printer Kasir" terputus — struk dicetak lewat dialog browser. Klik banner printer untuk menyambungkan kembali."*
4. **Tiket dapur tidak hilang**: dengan **printer dapur mati** → checkout menu dengan target dapur (mis. `Makanan`).
   **Hasil yang diharapkan**: ✅ Tiket dapur **tetap keluar** via dialog browser + toast peringatan — dapur tidak kehilangan pesanan karena printer terputus.
5. Nyalakan printer → klik banner **"Sambungkan Ulang"** → printer kembali aktif.

**Hasil akhir B**: ✅ Tidak pernah ada dialog Bluetooth di tengah transaksi; kasir tidak terblokir; pesanan dapur tetap tercetak.

---

## C. Fallback Browser Eksplisit per Printer (14.5)

**Tujuan**: perilaku fallback bisa **dikontrol per printer** (kasir & dapur) — bukan diam-diam selalu cetak ke browser.

1. Settings → blok **Printer Kasir (Bluetooth)** → pastikan **"Fallback Browser Print bila Bluetooth gagal"** **tercentang** (default ON).
2. Matikan printer → checkout → **Hasil**: struk via dialog browser + toast (perilaku B).
3. **Nonaktifkan toggle** → matikan printer → checkout lagi.
   **Hasil yang diharapkan**: ✅ **TIDAK ada dialog cetak browser**; toast peringatan tetap muncul; status hasil cetak tercatat **error "Koneksi Bluetooth terputus dan fallback browser nonaktif"** (kasir tahu cetak gagal, bukan diam-diam).
4. **Per printer dapur**: buka kartu printer dapur (Tipe Bluetooth) → toggle **"Fallback Browser Print bila gagal"** → ulangi langkah 2–3 pada printer tersebut.
5. **Aktifkan kembali** semua toggle setelah selesai (biarkan default ON untuk operasional).

**Hasil akhir C**: ✅ Fallback bisa dimatikan per printer; saat dimatikan, kegagalan tercatat jelas (tidak ada cetak browser diam-diam).

---

## D. Print Queue — Cetak Berurutan (14.3)

**Tujuan**: banyak job cetak (struk + tiket dapur + split) yang datang bersamaan diproses **serial per printer** — tidak tumpang tindih/rusak.

1. **Cetak ulang beruntun**: halaman Transaksi → pilih transaksi → klik cetak ulang **3× berturut-turut** dengan cepat.
   **Hasil yang diharapkan**: ✅ Struk keluar **berurutan** (1, 2, 3), tidak saling menumpuk/terpotong.
2. **Checkout bersamaan kasir + dapur**: pesanan berisi menu dapur → checkout → struk kasir & tiket dapur keluar tanpa saling mengganggu (printer berbeda jalan paralel; job per printer tetap urut).
3. **Split bill**: buat pesanan 2+ item → **Split Bill** (mode Nominal Rata atau per item) → proses pembayaran sub-bill.
   **Hasil yang diharapkan**: ✅ Struk sub-bill + tiket dapur (split fresh) keluar rapi berurutan.
4. **Gangguan di tengah antrean**: matikan printer → kirim 2 cetakan → nyalakan printer.
   **Hasil yang diharapkan**: ✅ Job yang gagal di-retry 1×; antrean tidak menggantung (jika tetap gagal, job di-drop dengan peringatan di console — aplikasi tidak macet).

**Hasil akhir D**: ✅ Cetakan banyak diproses berurutan per printer; tidak ada tumpang tindih; antrean tidak menggantung.

---

## E. Status Lintas Tab + Indikator KDS (14.4)

**Tujuan**: status koneksi printer **terlihat di semua tab** — terutama di halaman **Kitchen/Dapur (KDS)** — dan bisa disambungkan ulang dari sana tanpa dialog.

1. Buka **halaman Kitchen (KDS)** di tab 1 dan **Settings** di tab 2 (login dapur/kasir sesuai role).
2. Di **Settings (tab 2)**: hubungkan printer dapur.
   **Hasil yang diharapkan**: ✅ Di **KDS (tab 1)**, tanpa refresh, chip printer berubah **hijau** (ikon printer + nama + titik hijau).
3. Di **Settings (tab 2)**: klik **"Putus"** pada printer dapur itu.
   **Hasil yang diharapkan**: ✅ Chip di KDS berubah **merah** (tanpa refresh) dan menampilkan tombol **"Hubungkan"**.
4. Klik **"Hubungkan"** langsung di KDS.
   **Hasil yang diharapkan**: ✅ Re-pair **senyap** (tanpa dialog pilih device) → chip kembali hijau. (Bila gagal karena izin browser, kasir diminta 1 klik di Settings — bukan dari tengah operasional dapur.)

**Hasil akhir E**: ✅ Status printer sinkron lintas tab; dapur langsung tahu printer mana yang hidup/mati dan bisa menghubungkan ulang dari halaman KDS.

---

## F. UX — Notifikasi Toast & Label Konsisten (14.6)

**Tujuan**: semua umpan balik printer memakai **toast** (bukan `alert()`), dan label tombol konsisten Bahasa Indonesia.

1. Settings → **Test Print** (kasir & dapur) dengan printer tersambung.
   **Hasil yang diharapkan**: ✅ Toast hijau **"Test Print Kasir berhasil!"** / **"Test Print "X" berhasil!"** (bukan popup alert).
2. **Test Print dengan printer mati** → toast merah error (mis. *"Test Print gagal: …"*).
3. **Putuskan** printer → toast info **"Printer Kasir diputus."** / **"X" diputus.**.
4. **Peringatan duplikat device**: hubungkan 2 printer ke device fisik yang sama → toast kuning peringatan bahwa device dipakai printer lain.
5. **Label konsisten**: tombol banner & KDS berbahasa Indonesia — **"Sambungkan Ulang"** / **"Sambungkan Semua"** / **"Hubungkan"** / **"Menghubungkan..."** (tidak ada "Reconnect").

**Hasil akhir F**: ✅ Semua notifikasi via toast; label konsisten Bahasa Indonesia di banner, Settings, dan KDS.

---

## Ringkasan Hasil

| Tahap | Area | Status |
|---|---|---|
| A | Auto re-pair pasca-refresh (silent via `getDevices()` + banner 1-klik) | ☐ |
| B | Tidak ada dialog Bluetooth di tengah checkout; fallback browser + toast | ☐ |
| C | Fallback browser eksplisit per printer (toggle kasir & dapur) | ☐ |
| D | Print queue FIFO per printer (urutan, retry, tanpa tumpang tindih) | ☐ |
| E | Status lintas tab (BroadcastChannel) + indikator & Hubungkan di KDS | ☐ |
| F | Notifikasi toast + label Bahasa Indonesia konsisten | ☐ |

> Jika semua tahap ☐ ✅, integrasi printer siap digunakan di lapangan. Jika ada yang gagal, catat langkah + pesan toast/error + isi Console (F12), lalu laporkan ke tim pengembangan (detail teknis di `AI-HANDOFF.md` §19 & `TO DO.md` Prioritas 14).

---

*Panduan lain: [`TESTING-PRADEPLOY.md`](./TESTING-PRADEPLOY.md) (verifikasi pra-deploy), [`TESTING-DEMO-SALES.md`](./TESTING-DEMO-SALES.md) (demo penjualan), [`TESTING-OPNAME.md`](./TESTING-OPNAME.md) (stock opname), [`TESTING-OFFLINE.md`](./TESTING-OFFLINE.md) (mode offline), [`TESTING-STRUK-DIGITAL.md`](./TESTING-STRUK-DIGITAL.md) (struk WA/email).*
