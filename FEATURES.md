# 🏪 BerdikariPOS — Daftar Fitur & Keunggulan (v4.9.3)

## Aplikasi Point of Sale Modern untuk Berbagai Jenis Usaha

---

## 🎯 Ringkasan

BerdikariPOS adalah sistem kasir berbasis web multi-purpose yang dirancang untuk berbagai jenis usaha (F&B, retail, kelontong, jasa, salon, laundry, bakery, dll). Menghubungkan kasir, bagian dapur/pemenuhan, manajemen gudang, dan manajemen eksekutif dalam satu platform terintegrasi dengan cloud sync real-time dan **Atomic Inventory Transaction Engine** setara POS enterprise.

---

## ✨ Fitur Utama

### 1. 🛒 Point of Sale (Kasir) & Atomic Checkout Engine
- Tampilan grid produk dengan foto atau inisial
- Filter kategori + pencarian cepat
- Kustomisasi pesanan: suhu (hangat/dingin), level gula, add-ons
  - Suhu dan level gula dapat dinonaktifkan per produk (misal makanan tanpa pilihan suhu)
- **Atomic Inventory Checkout Engine (Enterprise POS Standard)**:
  - **All-or-Nothing Execution**: Transaksi diproses secara atomik. Jika ada 1 bahan baku yang gagal/kurang, seluruh checkout langsung dibatalkan tanpa mengurangi stok sedikit pun.
  - **Pre-checkout Validation**: Menjamin kecukupan seluruh bahan baku utama + add-ons sebelum eksekusi mutasi.
  - **Snapshot Recipe (BOM) & Snapshot HPP**: Menyimpan histori resep dan HPP secara permanen pada saat checkout sehingga perubahan resep di masa depan tidak mempengaruhi histori transaksi lama.
  - **Transaction State Machine**: Menelusuri lifecycle transaksi (`PENDING` → `VALIDATING` → `PROCESSING` → `COMMITTED` → `SYNC_PENDING` → `SYNCED` / `ROLLED_BACK`).
  - **Idempotency Protection**: Mencegah transaksi diproses dua kali akibat double-click tombol bayar, browser refresh, atau re-sync.
  - **Automatic Rollback Engine**: Memulihkan snapshot stok inventaris secara otomatis jika terjadi error sebelum transaksi di-commit.
  - **Post-Commit Asynchronous Isolation**: Kegagalan printer atau koneksi internet tidak pernah membatalkan transaksi yang sudah berhasil di-commit (otomatis Retry Queue).
- Keranjang belanja dengan quantity controls
- **Kosongkan keranjang 1-klik** (muncul jika item ≥ 2, dengan konfirmasi)
- Diskon manual (nominal Rupiah)
- Input kode voucher atau pilih promo aktif
- Pilih pelanggan dari daftar CRM (dropdown)
- 3 metode pembayaran: Cash, QRIS, Transfer Bank
- Kalkulator kembalian otomatis + quick cash buttons
- Nomor antrean otomatis (reset harian)
- Cetak struk otomatis (browser print / Bluetooth thermal)
- Keyboard shortcut: F1 = Bayar, Esc = Batal
- Mobile: keranjang minimize/maximize (floating bar)
- **Tipe pesanan**: Dine In / Take Away (pilihan di checkout)
- **Fitur Nomor Meja**: Input nomor meja untuk pesanan Dine In
- **Floating Action Button (FAB)**: Akses cepat aksi utama
- **Perhitungan Pajak Terintegrasi (PB1 / PPN)**: Menghitung pajak secara otomatis jika fitur pajak diaktifkan di Settings

### 2. 🍳 Kitchen Display System (KDS)
- Kanban board 3 kolom: Menunggu → Proses → Selesai
- Detail pesanan: nomor antrean, item, suhu, gula, add-ons, quantity, **tipe pesanan (Dine In/Take Away)**, dan **Nomor Meja**
- Info waktu masuk + nama kasir per pesanan
- Alert visual + suara jika pesanan menunggu > 5 menit
- Tombol 1-klik untuk pindah status
- Sound alarm custom (file .wav bisa diganti)
- Real-time sync: pesanan dari kasir langsung muncul di KDS (multi-device)
- **Hanya menampilkan transaksi hari ini** (transaksi lama tidak tampil)
- Reset tampilan saat Acaraki logout + print ringkasan

### 3. 💰 Manajemen Shift, Rekap Kas & Arus Kas
- **Buka Shift wajib**: input modal kas awal sebelum mulai kerja
- **Kas Masuk & Kas Keluar (Cash Movements)**:
  - Menu khusus `Rekap Kas` untuk mencatat pemasukan & pengeluaran kas operasional secara real-time
  - Bebas input nominal tanpa batasan
  - Pembatalan/penghapusan riwayat kas memerlukan izin & PIN Manager + tercatat di Audit Log
- **Tutup Shift wajib**:
  - Input kas aktual di laci (tidak bisa skip)
  - Formula akuntabel: $\text{Expected Cash} = \text{Modal Awal} + \text{Penjualan Tunai} + \text{Kas Masuk} - \text{Kas Keluar}$
  - Kalkulasi selisih otomatis (warna hijau/merah)
  - Print ringkasan transaksi & breakdown arus kas saat tutup shift
  - Indikator "Shift Aktif" di sidebar

### 4. 📊 Dashboard & Analitik (Manager)
- Pendapatan hari ini, jumlah transaksi, menu terlaris, laba kotor
- Grafik omset & trend profitabilitas berbasis Net Sales ($\text{subtotal} - \text{diskon}$) dikurang HPP
- Distribusi metode pembayaran & tipe pesanan (doughnut chart)
- Top 10 menu terlaris & profitabilitas menu 30 hari terakhir
- Alert stok rendah
- Laba kotor murni murni tanpa terpengaruh pajak (pajak dipisahkan sebagai liability)

### 5. 📋 Laporan Komprehensif
- **5 tab laporan**: Laba Rugi, Transaksi, Kas Kasir, Stok Bahan, Shift Karyawan
- **Filter Periode Presisi**: Hari Ini, 7 Hari, Bulan, Custom (date range) menyaring transaksi, shift, dan arus kas secara akurat
- **Export ke CSV & PDF**: Format profesional siap share ke owner/investor
- Tabel scrollable (`max-h-80`) dengan sticky header untuk efisiensi ruang

### 6. 📦 Manajemen Katalog & Harga
- CRUD menu lengkap dengan foto produk & Floating Action Button (FAB)
- Kategori dropdown (bisa tambah/hapus kategori)
- Kalkulasi HPP otomatis berdasarkan komposisi bahan ATAU input HPP Manual jika produk tidak menggunakan bahan baku
- Add-ons per menu (nama + harga)
- Toggle ketersediaan menu (aktif/nonaktif tanpa hapus)
- Import/Export CSV untuk update massal

### 7. 🏪 Inventaris Bahan Baku & Stock Opname
- CRUD bahan baku (nama, stok, unit, harga/unit, min. stok)
- Auto-deduct stok saat transaksi (berdasarkan komposisi menu)
- Revert stok otomatis saat transaksi `Selesai` dibatalkan atau dihapus
- **Stock Opname (Rekonsiliasi Fisik)**:
  - Input stok fisik aktual, otomatis hitung selisih & kerugian
  - **Mode Blind Opname (Staf Gudang)**: Sembunyikan stok sistem & selisih dari Staf Gudang agar hasil opname fisik murni akurat tanpa kecurangan
  - Verifikasi PIN Manager untuk selisih besar ($\ge 10\%$)
  - Riwayat opname tersimpan & tercatat di stock log

### 8. 🎁 Promo, Voucher & Loyalty
- CRUD promo/voucher dengan masa berlaku
- Diskon persentase (%) atau nominal tetap (Rp)
- Loyalty Member System (Bronze, Silver, Gold)

### 9. 👥 CRM Pelanggan
- CRUD pelanggan + Floating Action Button (FAB)
- Tracking otomatis total belanja & jumlah kunjungan (otomatis dikurangi jika transaksi dihapus/cancel)
- WhatsApp Marketing langsung ke pelanggan

### 10. 🖨️ Printer Thermal & Background Connection Monitor
- **Browser Print & Bluetooth ESC/POS**: Web Bluetooth API untuk cetak langsung
- **Lebar kertas**: 58mm atau 80mm
- **Struk Terbaca Jelas**: Teks `DINE IN MEJA X` dan `TAKE AWAY` dicetak ekstra besar dan bold
- **Split Printing (Printer Dapur & Bar)**: Otomatis mencetak pesanan makanan & minuman ke printer terpisah
- **Background Printer Connection Monitor (v4.2)**:
  - Background service (`usePrinterMonitor.ts`) secara berkala (3 detik) memeriksa status koneksi Bluetooth seluruh printer
  - **UI Status Banner**: Banner top-bar aplikasi (Hijau = Terhubung, Kuning = 1 Offline, Merah = Multiple Offline) dilengkapi tombol **[Reconnect]** 1-klik untuk mengatasi disconnections pasca-refresh browser.

### 11. 🏷️ Pengaturan Pajak (PB1 / PPN)
- **Modul Pengaturan Pajak di Settings**:
  - Toggle sakelar Aktif/Nonaktif fitur pajak
  - Input persentase pajak (%) + preset cepat (0%, 5%, 10%, 11%, 12%)
  - Simulasi kalkulasi tagihan live preview
- Terintegrasi penuh dengan POS Kasir, Struk Thermal, & Cloud Sync Supabase

### 12. 🛡️ Keamanan & Audit
- Password hashing (bcrypt)
- PIN Manager untuk otorisasi void & hapus transaksi
- Super Admin PIN untuk akses Manajemen Data
- **Audit Revert Transaksi**: Menghapus transaksi `Selesai` mengembalikan stok bahan baku & poin pelanggan
- **Restriksi Multi-login Device**: Membatasi user agar hanya login di 1 perangkat aktif saja
- Audit Log lengkap & dapat di-export ke CSV

### 13. 💾 Backup & Restore Otomatis
- **3 Mode Backup**: `FULL` (semua data + media), `MASTER_DATA` (settings, menu, inventory, customers, promos), `TRANSACTION` (transaksi, kas, shift, stock opname)
- **Backup ZIP ber-checksum SHA-256** + validasi integritas sebelum restore
- **Riwayat Backup** dengan status sukses/gagal & ukuran file
- **Auto-Backup Terjadwal**: Harian / Mingguan ke Local Download / Supabase Storage / Google Drive
- **Restore Wizard**: pratinjau isi backup, pemilihan cakupan, konfirmasi sebelum menimpa data

### 14. 🧩 Bundle Menu (Paket Hemat)
- **Bundle Menu**: menu induk berisi komponen menu lain (mis. Paket Nasi + Ayam + Es Teh)
- **Bundle Validation Engine**: cegah self-reference, bundle bersarang, & referensi sirkular (A→B→A)
- **Child items otomatis** di-generate ke cart (harga 0, `isBundleChild`) & diskalakan saat qty bundle berubah
- **HPP bundle** dihitung dari resep komponen → akurat untuk laporan laba
- **Snapshot komponen** permanen di transaksi; filtering KDS/cetak dapur mengenali child bundle
- Repositori terpisah (`bundleRepository`) untuk tabel `menu_components` dengan offline queue & cloud sync

---

# 🚀 FUTURES — Roadmap Fitur Komersial

## 15. 🔐 Sistem Lisensi & Langganan Tahunan (Licensing Engine)

> Fitur untuk mengkomersialkan BerdikariPOS secara berkelanjutan: setiap instalasi klien diikat oleh **license key** dengan masa berlaku tahunan (subscription), lengkap dengan grace period offline dan mode read-only — dirancang khusus untuk arsitektur local-first aplikasi ini.

### 15.1 — Prinsip Desain (mengikuti arsitektur local-first + model deployment Opsi B)

| Prinsip | Alasan |
|---------|--------|
| **Truth di server VENDOR, bukan di DB klien** | Model deployment Opsi B = klien memegang Supabase-nya sendiri → baris lisensi di DB klien bisa diedit bebas. Verifikasi harus ke License Server milik vendor (Supabase project terpisah / Edge Function) |
| **Signed response, bukan plain JSON** | Payload lisensi ditandatangani HMAC-SHA256 (secret hanya di Edge Function vendor); app memverifikasi via public key/secret derivasi — klien tidak bisa memalsukan `valid_until` |
| **Offline-first dengan grace period** | POS wajib terus jalan tanpa internet → hasil validasi di-cache lokal bertanda waktu; expired saat offline tetap diberi masa tenggang |
| **Tidak pernah hard-block di tengah operasional** | Blokir = reputasi hancur & kesiapan operasional klien terganggu. Degradasi halus: banner → peringatan → read-only |
| **Clock-tamper resistant** | Simpan `maxSeenValidUntil` monotonik lokal; mundurkan tanggal perangkat tidak memperpanjang lisensi |

### 15.2 — Cara Kerja (Alur & State Machine)

**Aktivasi:**
1. Klien menerima `LICENSE-KEY` unik (dibuat dari portal vendor).
2. Manager memasukkan key di Settings → Aktivasi (sekali per instalasi; key terikat pada `installationId` + nama outlet).
3. App memanggil Vendor License Server (`POST /activate`) → server memvalidasi key, mencatat aktivasi, mengembalikan **payload bertanda tangan**: `{ plan, issuedAt, validUntil, outletName, features }`.

**Siklus berjalan:**
4. Hasil validasi dicache lokal (zustand persist, pola sama dengan store lain): `{ payload, signature, lastVerifiedAt, maxSeenValidUntil }`.
5. Saat online: re-validate **harian** (silent, non-blocking). Saat offline: gunakan cache.
6. State machine lisensi:

| State | Kondisi | Perilaku App |
|-------|---------|--------------|
| ✅ `ACTIVE` | validUntil > now − 30 hari | Normal penuh |
| ⚠️ `EXPIRING` | sisa ≤ 30 hari | Banner kuning + tombol "Perpanjang" (link WA/portal vendor) |
| 🟠 `GRACE` | expired, offline/tidak terverifikasi ≤ 14 hari | Transaksi tetap jalan + banner merah "Lisensi kedaluwarsa — segera perpanjang" |
| 🔒 `READ_ONLY` | expired > 14 hari tanpa verifikasi ulang | POS/KDS diblokir transaksi baru; **laporan, riwayat & export data tetap bisa** (data klien tidak disandera — etis & mengurangi resistensi perpanjang) |
| ✅ kembali `ACTIVE` | pembayaran dikonfirmasi → `validUntil` diperpanjang di server | Otomatis pulih saat re-validate |

**Renewal tahunan:** vendor perpanjang `validUntil` di portal → app otomatis pulih pada siklus re-validate berikutnya (tanpa reinstall).

### 15.3 — Komponen Teknis

| Komponen | Lokasi | Isi |
|----------|--------|-----|
| **Vendor License Server** | Project Supabase vendor terpisah + Edge Function | Tabel `licenses` (key, plan, valid_until, status, outlet_name, device_limit, activated_at, last_seen_at); Edge Function `/activate` & `/validate` (HMAC sign + cek status) |
| **licenseStore** | `src/store/licenseStore.ts` (zustand persist) | Cache payload+signature, state machine, `maxSeenValidUntil`, aksi `activate()` / `refreshLicense()` / `computeLicenseState()` |
| **LicenseGuard** | Boot di `App.tsx` (setelah hydration, pola `whenHydrated`) + banner global | Re-validate harian; banner reuse pola `SyncFreshnessBanner`; gate checkout di POS (`finalizeTransaction` cek state) |
| **Env baru** | `.env` | `VITE_LICENSE_SERVER_URL`, `VITE_LICENSE_PUBLIC_SECRET` (verifikasi), `VITE_INSTALLATION_ID` |
| **Trial Mode** | Plan `TRIAL` | 14 hari fitur penuh, countdown banner — funnel demo → jadi pelanggan |

### 15.4 — Step Implementasi (bertahap, aman terhadap alur existing)

**Fase 1 — Fondasi (MVP komersial):**
- [ ] Setup Vendor License Server: tabel `licenses` + Edge Function `/activate` & `/validate` (HMAC-SHA256 signing; rate-limit per key).
- [ ] `src/store/licenseStore.ts`: persist cache + `computeLicenseState()` (pure, mudah dites) + integrasi boot di `App.tsx`.
- [ ] UI Aktivasi di Settings (input key, status badge lisensi, link perpanjang) + banner global per-state.
- [ ] Gate transaksi: blok `executeCheckout`/Simpan Pending HANYA di state `READ_ONLY`; shift aktif berjalan tidak pernah diinterupsi.
- [ ] Clock-guard: `maxSeenValidUntil` monotonik; bandingkan offset server-time vs lokal (>24 jam drift → pakai server time).
- [ ] Unit test `computeLicenseState` (semua transisi state, tamper signature, clock rollback) — pola test murni seperti `discountEngine`.

**Fase 2 — Ketahanan & Operasional:**
- [ ] Grace period konfigurabel (default 14 hari) + perilaku offline panjang terdokumentasi di panduan klien.
- [ ] Portal admin vendor sederhana: buat/revoke/extend key, lihat last_seen per instalasi (deteksi penggunaan ilegal/multi-instalasi satu key).
- [ ] Audit log lokal: event aktivasi/gagal-validasi tercatat (jejak diagnostik saat support).
- [ ] Sinkronisasi dengan model bisnis `DEPLOYMENT.md §5`: mapping paket Starter/Business/Pro → field `plan` + `features` (mis. Pro = multi-outlet nanti).

**Fase 3 — Lanjutan (pasca-pilot):**
- [ ] Self-service renewal (payment gateway QRIS → auto-extend `validUntil`).
- [ ] Feature-flag per plan (modul yang bisa on/off per paket: multi-outlet, laporan konsolidasi).
- [ ] Notifikasi perpanjangan proaktif via WhatsApp ke owner (H-30/H-7/H-1).

### 15.5 — Batasan & Keputusan yang Sadar

- Enforcement utama ada di frontend (kode minified di Vercel vendor) + signature anti-forgery — **cukup untuk melawan manipulasi kasual klien**, bukan melawan penyerang yang reverse-engineer serius. Untuk itu kombinasi terkuat tetap: lisensi + nilai layanan berkelanjutan (support/update) + data hidup di ekosistem vendor.
- Grace period = kompromi sadar antara proteksi revenue dan kontinuitas bisnis klien (POS mati saat jam sibuk = churn).
- Integrasi alami dengan Tahap 2 Keamanan (`AUDIT-OX.md` K3): bila nanti adopsi Supabase Auth, lisensi bisa turut diverifikasi server-side di jalur RPC yang sama.

---

*Fitur lengkap BerdikariPOS v4.9.3 — segmen Futures: Licensing Engine (belum dieksekusi, siap masuk TO DO sebagai Prioritas berikutnya).*
