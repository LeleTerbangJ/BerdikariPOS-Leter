# Changelog — BerdikariPOS

## v4.4.0 — Pending Payment & Split Bill

> Ringkasan untuk klien/tim. Detail teknis lengkap ada di `AI-HANDOFF.md` (§9) dan `TO DO.md` (Prioritas 1–4).

### ✨ Fitur Baru

**Pending Payment (Simpan & Gantung Pesanan)** — kasir menyimpan pesanan ke daftar gantung, dapur langsung menerima tiketnya, lalu pesanan dilunasi saat pelanggan siap:
- Simpan pending (stok terpotong 1×, nomor antrean dipertahankan, tiket dapur terkirim) → modal daftar gantung (cari, cetak struk sementara, void, lanjutkan).
- Lanjutkan (resume) dengan guard bentrok keranjang; **void pesanan gantung mengembalikan stok** yang di-reserve.

**Split Bill (Pisah Tagihan):**
- **Nominal Rata** — pembagian presisi (algoritma sisa terbesar, tanpa selisih Rp 1).
- **Per-Item** — alokasi diskon & pajak proporsional per item.
- Sub-bill dibayar berurutan (Cash/QRIS/Transfer), struk berlabel "BAGIAN N DARI M".
- Semua sub-bill lunas → transaksi induk otomatis **Selesai**.
- Laporan **tidak double-accounting** (sub-bill hanya tercatat sekali di transaksi induk).

### ⚙️ Langkah yang Wajib Dijalankan (Database Lama)

```sql
-- 1) Izinkan status 'Pending' pada CHECK constraint transaksi
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_tx_status_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_tx_status_check
  CHECK (tx_status IN ('Selesai', 'Cancel', 'Pending', 'Demo'));

-- 2) Kolom pendukung pending & split
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS table_number TEXT,
  ADD COLUMN IF NOT EXISTS customer_name TEXT,
  ADD COLUMN IF NOT EXISTS is_pending BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pending_notes TEXT,
  ADD COLUMN IF NOT EXISTS split_parent_id TEXT,
  ADD COLUMN IF NOT EXISTS split_index INT,
  ADD COLUMN IF NOT EXISTS total_split_count INT,
  ADD COLUMN IF NOT EXISTS paid_amount BIGINT;

-- 3) Kolom settings yang ditulis aplikasi
ALTER TABLE settings ADD COLUMN IF NOT EXISTS tax_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS demo_mode BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS receipt_header TEXT,
  ADD COLUMN IF NOT EXISTS receipt_footer TEXT,
  ADD COLUMN IF NOT EXISTS receipt_ascii_only BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_print_receipt BOOLEAN DEFAULT TRUE;
```

---

## v4.5.0 — Penyimpanan Lokal Tanpa Batas & Pemantapan Pending/Split

> Ringkasan untuk klien/tim. Detail teknis lengkap ada di `AI-HANDOFF.md` (§10) dan `TO DO.md` (Prioritas 5–6).

### ✨ Fitur Baru

- **Penyimpanan IndexedDB** — data transaksi & audit log disimpan di IndexedDB, tidak lagi dibatasi kuota localStorage. Kapasitas lokal praktis tidak terbatas (data lama tetap dipangkas otomatis: 300 transaksi terbaru/90 hari, audit 2.000, riwayat stok 500).
- Auto-migrasi data lama dari localStorage saat pertama kali dibuka (tanpa kehilangan data).

### 🐛 Perbaikan Bug

- **Stok split tidak terpotong ganda** saat modal ditutup di tengah sesi — reserve stok dipertahankan lintas buka/tutup & reload.
- **HPP laporan split rata tidak ter-inflasi N×** — biaya modal sub-bill kini proporsional (Σ HPP = total transaksi induk).
- **Void pesanan gantung yang sudah punya anak split** — stok tidak salah di-revert; void memakai **resep tersimpan** saat checkout (bukan resep yang diubah belakangan).
- **Promo/voucher tersimpan di transaksi** — total saat melanjutkan pending konsisten lintas device.
- Perubahan **suhu/level gula** saat resume me-reset status dapur (tiket dapur diperbarui).
- **Satu nomor antrean** untuk seluruh sesi split fresh.
- **Antrean dapur (KDS) bebas sub-bill split** — tiket dapur hanya untuk pesanan asli.
- **Agregasi menu/profitabilitas tidak ter-inflasi** untuk transaksi split rata.
- **Tutup shift tidak bisa terkunci** (deadlock) walau penyimpanan gagal; rollback transaksi tidak lagi meninggalkan transaksi "hantu" di cloud.

### ⚙️ Langkah yang Wajib Dijalankan (Database Lama)

```sql
-- Kolom promo pending (v4.5) — di-restore saat resume
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS applied_promo_id TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS voucher_code TEXT;
```

---

## v4.6.0 — Perbaikan Rekap Kas (Kas Masuk/Keluar) & Sinkronisasi Lintas Device

> Ringkasan untuk klien/tim. Detail teknis lengkap ada di `AI-HANDOFF.md` (§11) dan `TO DO.md` (Prioritas 6.6).

### 🐛 Perbaikan Bug

- **Kas Masuk / Kas Keluar (Rekap Kas) tidak pernah muncul di laporan Shift Manager** — bug produksi: data tercatat di perangkat kasir tapi tidak tersinkron ke device lain.
  - **Akar masalah**: tabel `cash_movements` memiliki RLS aktif **tanpa policy**, sehingga kunci anon diblokir *diam-diam* (SELECT kosong tanpa error, INSERT ditolak) — gejala: laporan Shift Manager selalu Kas Masuk/Keluar 0.
  - **Fix**: policy `"Allow all for anon"` ditambahkan ke `schema.sql` (project baru aman) + deteksi otomatis di aplikasi (Migration 18) yang mencetak SQL perbaikan bila DB lama kena kasus yang sama.
- **Sinkronisasi Rekap Kas lebih andal**: tulis kini lewat **offline queue** (online langsung / offline antre + flush otomatis saat online) dengan fallback ke sync langsung.
- **Indikator visual baru**: badge **"⏳ Belum Sync"** per baris pencatatan kas + hitung "⚠️ N belum sync" + retry otomatis saat koneksi kembali — kasir tahu kapan datanya belum sampai ke cloud.

### ⚙️ Langkah yang Wajib Dijalankan (Database Lama)

```sql
-- RLS policy untuk cash_movements (v4.6) — WAJIB untuk DB lama
ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cash_movements'
      AND policyname = 'Allow all for anon'
  ) THEN
    CREATE POLICY "Allow all for anon" ON cash_movements FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
```

> Project baru cukup menjalankan `supabase/schema.sql` — policy sudah termasuk.

---

## v4.7.0 — Stabilitas Stok, Opname Aman, Backup Lengkap, PPN, Refund & Struk Digital

> Ringkasan untuk klien/tim. Detail teknis lengkap ada di `AI-HANDOFF.md` (§12–§22) dan `TO DO.md` (Prioritas 7–17 + P0.1/P0.2/P0.4).

### ✨ Fitur Baru

**Laporan PPN (Pajak Pertambahan Nilai):**
- Tab baru **PPN** di Laporan: kartu ringkasan (PPN Terkumpul / DPP / transaksi kena pajak / non-pajak), **rekap per hari**, dan detail transaksi kena pajak.
- Export **CSV & PDF** siap untuk arsip/perhitungan pajak. Semantik: **DPP = subtotal − diskon**, **PPN = nominal pajak** yang dibulatkan saat checkout; transaksi yang sudah di-refund otomatis tidak dihitung.

**Refund / Retur Penuh:**
- Tombol **Refund** di riwayat transaksi (`Selesai`) → konfirmasi nominal penuh + alasan (opsional) → **stok dikembalikan ke inventory**, kunjungan pelanggan di-revert, dan **Kas Keluar 'Refund' tercatat otomatis di Rekap Kas** (akuntabel).
- Transaksi yang di-refund **tidak lagi dihitung sebagai penjualan** di laporan/dashboard; badge "Refund" + info detail (nominal, waktu, oleh siapa).
- Otorisasi: Manager langsung eksekusi; role lain perlu **PIN Manager** (seperti void/delete). Anti double-refund & double-revert.

**Struk Digital (WhatsApp / Email):**
- Tombol **"Struk Digital"** di riwayat transaksi → modal kirim struk: **kontak pelanggan terisi otomatis dari CRM** (nomor WhatsApp & email, bisa diubah manual) + **pratinjau struk** sebelum kirim.
- **Kirim WhatsApp** — struk lengkap (nama toko, alamat, header/footer dari Settings, daftar item, total) otomatis terisi di `wa.me` — tinggal kirim. **Kirim Email** — struk sebagai body `mailto:`.
- **Auto-kirim pasca-checkout**: opsi di Settings (Pengaturan Struk) — setelah checkout berhasil, struk dibuka di WhatsApp dengan nomor pelanggan terisi otomatis (hanya bila transaksi memakai pelanggan dengan nomor HP valid).
- Setiap pengiriman tercatat di **audit log** (channel, tujuan, no. transaksi).

**Promo & Loyalty Lengkap (Prioritas 12 — P-A2–P-A8):**
- **Promo per menu** — scope "Menu Tertentu" kini bisa dipilih di form (sebelumnya hanya bisa dibuat via database).
- **Validasi form promo** — nama, persentase 1–100%, tanggal mulai ≤ selesai, target wajib, diskon tetap tidak melebihi minimal belanja (mencegah promo "rugi").
- **Laporan Performa Promo** (tab baru di Laporan) — jumlah pakai, total diskon, omset, rata-rata diskon per promo + detail transaksi ber-promo + export CSV. Snapshot `promoName`/`promoAmount` tersimpan di tiap transaksi saat checkout (tetap akurat walau promo diedit/dihapus kemudian).
- **Stacking diskon terkontrol** — opsi per promo: boleh digabung (manual + promo + loyalty) atau **Eksklusif** (otomatis **best-deal**: pelanggan mendapat diskon terbesar antara promo saja vs manual+loyalty saja — tidak pernah ganda). Satu mesin diskon untuk finalize/pending/preview: angka yang tampil = angka yang dicommit.
- **BOGO / Beli N Gratis M** — beli N dapat M gratis (diambil dari item termurah), opsi diskon % per unit gratis; dan **min-qty** (diskon hanya berlaku bila qty item ≥ ambang).
- **Batas pemakaian per pelanggan** — kuota voucher per pelanggan (mis. 1× per orang) dengan pencatatan `usageByCustomer`; promo berbatas mewajibkan pelanggan dipilih di POS.
- **Nama promo di struk** — baris `Promo: Nama (KODE)` di struk termal (browser & ESC/POS) dan struk digital WA/email; hanya tampil bila promo benar-benar memberi diskon (promo eksklusif yang kalah best-deal tidak diklaim struk).
- **Poin Loyalty aktif** — poin didapat saat checkout (poin/transaksi + 1 poin per Rp), **ditukar jadi diskon** di POS (maks dibatasi saldo & headroom agar selalu terpakai penuh), dikembalikan (clawback) saat void/cancel/refund. Konfigurasi poin kini editabel di Promo & Loyalty; saldo tampil di kartu Pelanggan.

**Kasir Lebih Cepat (UX POS):**
- **Pencarian pelanggan di keranjang** — dropdown pelanggan diganti combobox yang bisa dicari dengan mengetik (nama / nomor HP / email); `Enter` memilih hasil pertama, `Escape` menutup, opsi "Lepaskan pelanggan".
- **Tambah pelanggan langsung dari POS** — tombol shortcut "Baru" di samping pemilih pelanggan membuka form singkat (nama/HP/email/catatan); setelah disimpan pelanggan **langsung terpilih** (loyalty, poin & promo per-pelanggan langsung aktif) + tercatat di audit log.
- **Dropdown "Pilih promo..." di keranjang desktop** — sebelumnya hanya tampil di keranjang mobile; kini kasir desktop juga bisa memilih promo aktif langsung dari daftar (format sama: `Nama (12%)` / `Nama (Rp …)`), dengan indikator terpasang + tombol Batal saat promo diterapkan.

**Mode Offline Andal (Prioritas 13 — O-1 s.d. O-10):**
- **Antrean offline di IndexedDB** (bukan localStorage) — payload transaksi besar tidak lagi hilang saat kuota lokal penuh; data lama otomatis dimigrasikan.
- **Retry berkala otomatis** — selama ada data belum sinkron, aplikasi mencoba mengirim tiap 30 detik + saat tab kembali terlihat (device sleep / pindah tab); error jaringan sementara (Wi-Fi tanpa internet) tidak menghabiskan batas percobaan.
- **Daftar operasi gagal (Failed Ops)** — operasi yang gagal permanen (mis. izin/kolom database) **tidak di-drop diam-diam**: muncul badge merah di header → modal daftar dengan alasan + tombol **Coba Lagi** / **Hapus** (dengan konfirmasi tegas) + tercatat di audit log.
- **Banner status global** di semua perangkat & role (termasuk mobile): offline / N belum sinkron (klik = kirim sekarang) / N gagal.
- **Badge "Belum Sync" per transaksi** di Riwayat Transaksi + hitungan di header — hilang otomatis saat tersinkron.
- **Peringatan cold start offline** (perangkat baru yang belum pernah online) — transaksi tetap bisa dicatat & akan tersinkron.
- **Deteksi konflik stok lintas device** — banner kuning di Inventaris saat stok lokal ditimpa data cloud yang lebih besar (potensi deduksi tertimpa device lain / penambahan eksternal).
- **Tombstone penghapusan diperbesar** (cap 200 → 1000) agar transaksi yang dihapus offline tidak "ghost" muncul lagi.
- **PWA offline**: navigasi SPA jatuh ke app shell yang di-precache + runtime cache NetworkFirst untuk aset same-origin — aplikasi tetap terbuka & bisa dipakai tanpa internet.
- Urutan sinkronisasi **kronologis** (berbasis timestamp, bukan urutan jenis operasi) — konsistensi antar tabel (mis. Rekap Kas mengikuti transaksi induknya).

**Printer Thermal Lebih Andal (Prioritas 14 — 14.1 s.d. 14.6):**
- **Tidak perlu pairing ulang manual setelah refresh** — aplikasi otomatis mencoba menyambungkan kembali printer Bluetooth yang tadinya tersambung (`navigator.bluetooth.getDevices()` + GATT, **tanpa membuka dialog**); bila gagal, banner merah 1-klik "Sambungkan Ulang".
- **Dialog Bluetooth tidak lagi muncul tiba-tiba di tengah transaksi** — setiap jalur cetak memakai kebijakan seragam: re-pair senyap → fallback browser + notifikasi → tidak pernah membuka picker tanpa klik eksplisit.
- **Fallback browser eksplisit per printer** — opsi "Fallback Browser Print bila Bluetooth gagal" (printer kasir & tiap printer dapur); bila nonaktif, kegagalan Bluetooth tercatat sebagai **status error** (bukan cetak diam-diam ke browser).
- **Antrean cetak per printer (print queue)** — struk & tiket dapur yang datang bersamaan diproses **berurutan (FIFO)** dengan retry 1× untuk error transient — mencegah tumpang tindih cetak saat banyak pesanan.
- **Status koneksi lintas tab** — peristiwa connect/disconnect dibagikan antar-tab (BroadcastChannel); halaman **Kitchen/Dapur** menampilkan indikator hijau/merah per printer dapur + tombol Hubungkan (re-pair senyap, tanpa picker).
- **UX lebih halus** — notifikasi `alert()` diganti **toast** di semua alur printer; **satu sumber kebenaran identitas device** (settings persisten > session); label tombol diseragamkan ke Bahasa Indonesia.
- **Opsi "Semua Dapur" di Edit Menu** — menu bisa diatur agar tiket dapurnya dicetak ke **semua printer dapur aktif** (mis. menu yang bisa dibuat di dapur mana pun); selain target spesifik yang sudah ada. Tampil sebagai "Semua Dapur" di daftar menu & keranjang POS.

**Pengalaman Kasir & Validasi (Prioritas 15 — 15.1 s.d. 15.4):**
- **Harga Add-on divalidasi (gratis diperbolehkan)** — **add-on harga 0 (gratis) SAH**, pas untuk pilihan saus/topping yang sudah termasuk di menu; yang diblokir hanya harga **negatif / bukan angka** (peringatan jelas + simpan dibatalkan — tidak lagi di-drop diam-diam). Di POS, add-on gratis tampil berlabel **"Gratis"** (bukan "+Rp 0"), dan di **struk termal & digital** nama add-on gratis ikut tercetak dengan penanda **(Gratis)** tanpa menambah total (unit price = harga menu + add-on berbayar saja). Import CSV katalog ikut divalidasi: add-on tidak valid dilewati + dilaporkan jumlahnya, dan kolom Addons yang JSON-nya rusak tidak lagi menggagalkan seluruh import.
- **Daftar Pending Payment jadi carousel** — card pesanan gantung bergeser kiri/kanan (panah ◀ ▶, indikator dot, label "N dari M", bisa digeser jari di mobile) — tidak lagi bertumpuk memakan layar saat banyak pesanan gantung. Pencarian, detail, struk sementara, batalkan, dan lanjutkan pembayaran tetap tersedia.
- **Opsi cetak per-transaksi — dua toggle independen**: checkbox **"Cetak struk kasir"** & **"Cetak tiket dapur"** di modal pembayaran. Kombinasi: cetak semua (default); **skip struk kasir saja** → tiket dapur **tetap keluar di awal** (kasir hemat kertas, dapur tetap dapat pesanan); **skip keduanya** → tidak ada cetakan sama sekali. **Anti tiket DOBEL otomatis**: saat resume pending dengan item tidak berubah, checkbox tiket dapur default **OFF** (tiket sudah tercetak saat Simpan Pending). Berlaku konsisten di semua jalur: checkout normal, **Split Bill** (dua checkbox di Payment Box sub-bill; checkbox dapur hanya tampil saat split fresh), dan **resume pesanan pending**.
- **Header Inventaris lebih rapi** — tombol Tambah Bahan / Min. Stok / Export / Template CSV / Import hanya tampil di tab **Bahan Baku**; tab **Stock Opname** bersih dari aksi yang tidak relevan (aksi opname dikelola halaman opname sendiri).

**Perubahan menu pada pesanan gantung kini selalu tercermin di riwayat transaksi (Prioritas 16):**
- **Tambah/kurangi menu di pesanan gantung (Pending) langsung terlihat di Riwayat Transaksi** — sebelumnya fetch data cloud (realtime/refresh/online) bisa **menimpa item lokal yang sudah benar dengan versi lama** sebelum sinkronasi selesai, sehingga menu yang ditambah/dikurangi "hilang" dari riwayat.
- **Perbandingan kesegaran per transaksi** — `loadFromCloud` kini memilih versi yang **lebih baru** antara lokal vs cloud (field baru `updatedAt`, fallback `date` untuk data lama); versi cloud yang kalah tidak lagi menghasilkan **duplikat baris** ber-ID sama.
- Berlaku juga untuk **void/batal, status dapur, dan perubahan metode bayar/refund** — jalur update yang tidak mengubah tanggal transaksi kini terlindungi dari data cloud yang basi.

**Edit Menu & Opsi Cetak Lebih Rapi + Anti Duplikat Transaksi (Prioritas 17):**
- **Edit Menu tidak lagi menumpuk** — baris toggle **Best Seller ⭐ / Level Gula 🍬 / Pilihan Suhu 🌡️** kini membentang penuh di form (desktop) dan wrap rapi ke baris berikutnya di layar sempit/mobile.
- **Checkbox "Cetak struk kasir" & "Cetak tiket dapur" berdampingan di desktop** (tetap vertikal di mobile) — modal pembayaran POS dan Payment Box Split Bill konsisten; catatan "(tidak ada cetakan sama sekali)" tetap di baris tersendiri.
- **Anti duplikat transaksi saat pesanan gantung diedit & dibayar** — sebelumnya, bila kasir **pindah halaman / aplikasi di-refresh** setelah resume pesanan gantung, identitas pending hilang tapi isi keranjang tetap → pembayaran memakai nomor transaksi baru → riwayat jadi **2 transaksi** (pending lama masih Pending + transaksi Selesai baru). Kini identitas pending **tersimpan bersama keranjang** dan dipulihkan otomatis saat kembali ke POS → pending yang diedit di-update ke Selesai (**1 transaksi**). Bonus: identitas pending juga dibersihkan setelah pembayaran agar tidak bocor ke order berikutnya.

**Skenario 2 Kasir & Offline (Prioritas 18 — 18.1 s.d. 18.8):**
- **Stok tidak bisa "oversell" antar kasir (RPC atomik, Migration 27)** — deduksi stok kini lewat fungsi database `adjust_inventory_stock` yang mengubah stok secara **atomik berbasis delta** dengan guard `stock >= kebutuhan` di level database: dua kasir yang membaca stok sama lalu memotong bersamaan, yang kedua **ditolak** (bukan memotong hingga negatif di luar kesadaran). Penolakan → stok lokal dikoreksi ke nilai cloud + log koreksi + peringatan "kemungkinan sudah terjual perangkat lain". Bila RPC belum dibuat / offline, aplikasi memakai fallback aman (perilaku lama) — tidak ada transaksi yang gagal.
- **Nomor antrean tidak kembar antar kasir (RPC atomik, Migration 28)** — alokasi nomor antrean kini lewat counter cloud `queue_counters` + fungsi `allocate_queue_number` (row-lock upsert) — dua kasir online **mustahil mendapat #N yang sama**. Floor `max(cloud, lokal)` mencegah nomor menabrak data lama; offline tetap fallback max+1 dengan **badge "#N duplikat"** di Riwayat Transaksi & Pending Payments bila nomor kembar terdeteksi.
- **Satu shift aktif per outlet** — membuka shift baru ditolak bila sudah ada shift terbuka (dicek lokal + cloud); device lain otomatis **melanjutkan shift yang sama** (banner "Lanjutkan Shift Ini" tanpa input kas ulang); `loadFromCloud` me-restore shift terbuka **paling awal** — tidak ada lagi dua shift "aktif" di laporan Shift Manager.
- **Expected cash tutup shift dari SEMUA transaksi tersinkron** — saat membuka modal tutup shift, aplikasi flush antrean → tarik ulang transaksi/shift/Rekap Kas dari cloud → expected cash dihitung dari data gabungan semua kasir, dengan **peringatan bila masih ada data belum tersinkron** + tombol "Kirim & Muat Ulang".
- **Banner "Laporan belum final"** di header **Laporan & Dashboard** — saat ada transaksi belum tersinkron (badge O-5) atau operasi antrean, banner kuning mengingatkan bahwa angka di bawah dapat berubah setelah sinkron selesai.
- **Catat transaksi Demo langsung dari POS** — tombol **"Catat sebagai Demo (tidak memotong stok)"** di modal pembayaran: cocok untuk pelatihan kasir — **tidak memotong stok**, **tidak mengonsumsi nomor antrean** (label DEMO, bukan #0), tidak mencetak struk/tiket dapur, tidak masuk laporan & tidak merekam kunjungan/promo/poin; tetap bisa diubah ke Selesai nanti (stok otomatis dipotong).
- **Promo usage dilindungi dari race (E7)** — pemakaian promo dicatat via `reservePromoUsage`: cek batas (global & per pelanggan) dari **store saat commit** + increment atomik + **ledger id transaksi unik** — re-commit/replay transaksi yang sama tidak menaikkan pemakaian dua kali; **replay idempoten tidak lagi mencatat kunjungan ganda / poin loyalty terpotong dua kali**; ledger digabung UNION lintas device.
- **Tiket dapur tidak hilang saat resume pesanan gantung (A10)** — status cetak tiket dapur kini **dicatat di transaksi** (`kitchenTicketPrintedAt`, Migration 30): resume dengan item sama **hanya melewati cetak bila tiket benar-benar sudah keluar**; bila printer gagal saat Simpan Pending, resume otomatis **mencetak ulang** (tiket tidak hilang diam-diam).
- **Bahan resep yang sudah dihapus tidak lagi lolos diam-diam (A11)** — validasi stok melaporkan "bahan tidak ditemukan (ID: …)" dengan peringatan jelas sebelum checkout; alert stok negatif tidak lagi dihapus oleh revert yang tidak relevan (A12).

(Settings → Backup):
- Backup **FULL / MASTER_DATA** dengan **checksum berbasis isi** — file yang diubah (harga menu, logo, dll.) walau jumlah item sama akan **ditolak** saat restore (anti-tamper).
- Restore **2 mode**: **Merge** (gabung dengan data lama) atau **Replace/Snapshot** (sinkron penuh — data zombie tidak kembali lintas device).
- Foto menu & logo toko ikut di-backup & di-restore (tidak lagi hilang).
- Struktur menu **bundle/add-on** ikut di-backup, di-restore, & disinkronkan.
- Riwayat mutasi stok (Stock Logs) ikut di-restore & di-sync ke cloud.
- **Auto Backup otomatis**: jadwal harian/mingguan + jam target; kirim ke **Local Download** atau **Supabase Storage** (bucket `backups`). Jika gagal, otomatis dicoba lagi 5 menit kemudian.
- Restore memvalidasi versi backup — backup dari versi aplikasi yang lebih baru ditolak dengan pesan jelas (bukan gagal diam-diam).

**Stock Opname lebih aman & akurat:**
- Mode **opname buta (Staf Gudang)** kini benar-benar buta — tidak ada lagi petunjuk/banner selisih besar (±10%) yang bisa membocorkan stok sistem.
- **Otorisasi ganda (dual-control)**: hanya akun **Manager** yang dapat menyetujui selisih besar — staf wajib login cepat sebagai Manager; identitas approver, waktu, dan penanda perangkat **tercatat** di riwayat opname & audit log.
- Staf Gudang **wajib memilih alasan** penyesuaian setelah PIN disetujui (jejak audit penyebab kerugian).
- Stok fisik **negatif/NaN dikunci ke 0** — tidak bisa masuk ke inventory.
- Peringatan bila stok berubah di perangkat lain sejak form dibuka (anti lost update / data tertimpa).

### 🐛 Perbaikan Bug

- **Stok bocor saat transaksi Demo diubah menjadi Selesai** — stok bahan baku kini terpotong dengan benar (sebelumnya jadi penjualan tanpa potong stok).
- **Hapus pesanan gantung (Pending) tidak mengembalikan stok** — stok reserve kini dikembalikan ke inventory.
- **Import CSV** tercatat sebagai **"Import CSV"** di riwayat stok (bukan "adjust" generik); rename bahan tercatat dengan **nama baru** di riwayat.
- **Sinkronisasi stok lebih cepat**: Stock Opname & Import CSV memakai **1 request batch** (sebelumnya N request per item).
- **Peringatan stok negatif** setelah transaksi (mis. dua device checkout bahan terakhir bersamaan) — kasir **tidak diblokir**, hanya diberi tahu via notifikasi.
- Otorisasi opname tidak lagi bisa dilakukan oleh siapa pun yang sekadar tahu PIN global — wajib akun Manager.
- **Item pesanan gantung yang diubah (tambah/kurangi menu) kini selalu muncul di riwayat transaksi** — sinkronisasi realtime/refresh tidak lagi menimpa update lokal dengan versi cloud yang basi; perbandingan kesegaran per transaksi (`updatedAt` fallback `date`) + anti duplikat baris ber-ID sama.
- **Tidak ada lagi transaksi ganda saat pesanan gantung diedit lalu dibayar setelah pindah halaman/refresh** — identitas pesanan gantung kini tersimpan bersama keranjang dan dipulihkan otomatis, sehingga pembayaran meng-update pending yang sama (bukan membuat transaksi baru); identitas juga dibersihkan pasca-bayar agar tidak bocor ke order berikutnya.
- **Nomor antrean di pagi buta (00:00–07:00 WIB) tidak lagi salah hitung** — perbandingan tanggal memakai **tanggal lokal** (bukan prefix UTC) di floor nomor antrean, deteksi duplikat, dan range query cloud — transaksi pagi-pagi tidak terlewat (nomor antrean tidak menabrak #N yang sudah ada).
- **Replay/double-click transaksi tidak lagi menggandakan efek samping** — kunjungan pelanggan, pemakaian promo, dan penukaran poin loyalty hanya dijalankan sekali per transaksi (idempotent replay dilewati).
- **Alert stok negatif lebih akurat** — revert kecil yang tidak memperbaiki item negatif tidak lagi menghapus peringatan yang masih relevan.
- **Ringkasan tutup shift tidak lagi overstated saat ada refund (Prioritas 20.1)** — Total Penjualan & Total Transaksi mengecualikan transaksi yang sudah di-refund (konsisten dengan Dashboard/Laporan/Riwayat); expected cash tetap akurat (penjualan tunai yang di-refund dinetralkan dengan Kas Keluar Refund — tidak ada double-subtract), dengan baris **"Refund Tunai (Dikembalikan)"** di modal & struk ringkasan shift.
- **Struk ringkasan shift lebih informatif** — tambah baris **Jam Mulai/Jam Tutup** shift, **Total Item Terjual**, daftar **Penjualan Menu per item** (Qty x Harga = Jumlah, diurutkan terlaris), dan rumusan formula expected cash dihapus (karena sudah jelas dari komponennya).
- **Semua notifikasi `alert()` diganti toast (Prioritas 20.2)** — 21 titik di App, Audit Log, Rekap Kas, Katalog, Settings, Stock Opname & auth (session takeover) kini memakai `addToast` yang konsisten (sukses/warning/error).
- **Semua konfirmasi memakai dialog kustom (Prioritas 20.3)** — 4 `window.confirm` terakhir (tutup shift selisih kas > 10%, void transaksi gantung, resume pending saat keranjang berisi, hapus user) diganti **ConfirmDialog** (modal + ikon + tombol Batal/Ya) agar UX konfirmasi seragam; **tidak ada dialog browser native (`alert`/`confirm`) tersisa di kode produksi**.
- **Filter tanggal custom Laporan & Riwayat Transaksi tidak lagi melewatkan transaksi pagi buta (Prioritas 20.4)** — `new Date('YYYY-MM-DD')` (tanpa `T`) di-parse sebagai UTC tengah malam (= 07:00 WIB), sehingga transaksi 00:00–07:00 pada tanggal awal tidak masuk range custom; kini helper `buildCustomDateRange` mem-parse **lokal** (`'T00:00:00'` s.d. `'T23:59:59.999'`) di 3 titik (filter transaksi Reports, range opname/movement Reports, filter Riwayat Transaksi) — konsisten dengan fix tanggal lokal lainnya (18.3).
- **Audit flow Pending + Tambah Item + Split Bill (Prioritas 21, 21.1–21.5)** — tiket dapur saat finalisasi pending yang diedit kini hanya mencetak **item baru** (delta) sehingga tidak ada tiket dobel untuk item lama; tiket dapur saat split dari pending otomatis **skip** (`skipSplitKitchen = true`); **guard rekonsiliasi ganda** (`onReconcile` callback + `pendingSplitReconciled` flag) mencegah stok di-adjust dua kali; badge **"✓ Diupdate"** di kartu Pending Payments; badge **"🔄 Diupdate"** + background biru di KDS untuk pesanan Done→Waiting + timer overdue restart dari `updatedAt`.

> Project **baru** cukup menjalankan `supabase/schema.sql` v4.7 — selesai, tidak perlu SQL tambahan.

Untuk database yang **sudah ada**, jalankan di Supabase SQL Editor (aman diulang):

```sql
-- Kolom otorisasi Stock Opname (v4.7) — WAJIB
ALTER TABLE stock_opnames ADD COLUMN IF NOT EXISTS approver_id TEXT;
ALTER TABLE stock_opnames ADD COLUMN IF NOT EXISTS approver_name TEXT;
ALTER TABLE stock_opnames ADD COLUMN IF NOT EXISTS approver_role TEXT;
ALTER TABLE stock_opnames ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE stock_opnames ADD COLUMN IF NOT EXISTS device_id TEXT;
ALTER TABLE stock_opnames ADD COLUMN IF NOT EXISTS adjustment_reason TEXT;

-- Kolom Refund transaksi (v4.7 — P0.2) — WAJIB bila memakai fitur Refund
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refunded BOOLEAN DEFAULT FALSE;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refunded_amount FLOAT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refund_note TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refunded_by_id TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refunded_by_name TEXT;

-- Kolom Struk Digital (v4.7 — P0.4) — WAJIB bila memakai fitur auto-kirim WA
ALTER TABLE settings ADD COLUMN IF NOT EXISTS auto_send_digital_receipt BOOLEAN DEFAULT FALSE;

-- Kolom Promo & Loyalty (v4.7 — P-A3 s.d. P-A8) — WAJIB bila memakai fitur Promo/Loyalty
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS promo_name TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS promo_amount FLOAT;
ALTER TABLE promos ADD COLUMN IF NOT EXISTS stackable BOOLEAN DEFAULT TRUE;
ALTER TABLE promos ADD COLUMN IF NOT EXISTS bogo_config JSONB;
ALTER TABLE promos ADD COLUMN IF NOT EXISTS min_qty INT;
ALTER TABLE promos ADD COLUMN IF NOT EXISTS usage_limit_per_customer INT;
ALTER TABLE promos ADD COLUMN IF NOT EXISTS usage_by_customer JSONB DEFAULT '{}';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS loyalty_points INT DEFAULT 0;
-- Perluas tipe promo agar menerima 'bogo' (idempoten — hapus CHECK lama bila ada)
DO $$ DECLARE cname TEXT; BEGIN
  SELECT conname INTO cname FROM pg_constraint
  WHERE conrelid = 'promos'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%percentage%';
  IF cname IS NOT NULL THEN EXECUTE format('ALTER TABLE promos DROP CONSTRAINT %I', cname); END IF;
END $$;
ALTER TABLE promos ADD CONSTRAINT promos_type_check CHECK (type IN ('percentage', 'fixed', 'bogo'));

-- ============================================================
-- 12. ⚠️ v4.7 WAJIB (Prioritas 18) — RPC atomik stok (Migration 27) — proteksi oversell 2 kasir
-- ============================================================
CREATE OR REPLACE FUNCTION adjust_inventory_stock(p_id TEXT, p_delta FLOAT)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_stock FLOAT;
BEGIN
  SELECT stock INTO v_stock FROM inventory WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'stock', NULL::FLOAT, 'reason', 'not_found');
  END IF;
  IF p_delta < 0 AND v_stock < -p_delta THEN
    RETURN jsonb_build_object('ok', false, 'stock', v_stock, 'reason', 'insufficient');
  END IF;
  UPDATE inventory SET stock = v_stock + p_delta, updated_at = now() WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'stock', v_stock + p_delta, 'reason', 'ok');
END;
$$;

-- ============================================================
-- 13. ⚠️ v4.7 WAJIB (Prioritas 18) — counter nomor antrean atomik (Migration 28)
-- ============================================================
CREATE TABLE IF NOT EXISTS queue_counters (
  outlet_id TEXT NOT NULL DEFAULT 'default',
  date TEXT NOT NULL,
  last_number INT NOT NULL DEFAULT 0,
  PRIMARY KEY (outlet_id, date)
);
ALTER TABLE queue_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for anon" ON queue_counters FOR ALL USING (true) WITH CHECK (true);
CREATE OR REPLACE FUNCTION allocate_queue_number(p_date TEXT, p_outlet TEXT DEFAULT 'default', p_min INT DEFAULT 0)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_next INT;
BEGIN
  INSERT INTO queue_counters (outlet_id, date, last_number)
  VALUES (p_outlet, p_date, GREATEST(0, p_min) + 1)
  ON CONFLICT (outlet_id, date)
  DO UPDATE SET last_number = GREATEST(queue_counters.last_number + 1, p_min + 1)
  RETURNING last_number INTO v_next;
  RETURN v_next;
END;
$$;

-- ============================================================
-- 14. ⚠️ v4.7 WAJIB (Prioritas 18 — A5) — kolom updated_at inventory (Migration 29, last-write-wins)
-- ============================================================
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- ============================================================
-- 15. ⚠️ v4.7 WAJIB (Prioritas 18 — A10) — kolom status cetak tiket dapur (Migration 30)
-- ============================================================
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS kitchen_ticket_printed_at TIMESTAMPTZ;
```

Opsional — **hanya jika memakai Auto Backup dengan destinasi Supabase Cloud Storage**:

```sql
INSERT INTO storage.buckets (id, name, public) VALUES ('backups', 'backups', false) ON CONFLICT (id) DO NOTHING;
CREATE POLICY "Allow anon upload backups" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id = 'backups');
CREATE POLICY "Allow anon read backups" ON storage.objects FOR SELECT TO anon USING (bucket_id = 'backups');
```

> **Catatan**: aplikasi otomatis mendeteksi kolom yang kurang saat dibuka dan mencetak SQL perbaikannya di console browser (Migration 19 — opname, Migration 20 — refund, Migration 21 — struk digital, Migration 22–26 — fitur promo & loyalty, **Migration 27 — RPC `adjust_inventory_stock` (proteksi stok), Migration 28 — tabel `queue_counters` + RPC `allocate_queue_number` (proteksi nomor antrean), Migration 29 — `updated_at` inventory, Migration 30 — `kitchen_ticket_printed_at` transaksi**) — jadi tidak ada langkah yang bisa terlewat tanpa disadari.

### 🔧 Perbaikan Bug (v4.8.1 — Fix 24.1–24.5 + Fix 25.1–25.4)

- **24.1 (KRITIS)**: Sync `kitchenItemStatus` per-item ke cloud — `syncTransactionMeta` kini memproses field `items` (JSONB) → status item sinkron lintas device.
- **24.2**: Tombol "Selesai Semua" di KDS hanya menandai item `processing` (bukan `new`) sebagai done.
- **24.3 + 24.4**: `mergeKitchenItemStatus` cek quantity/specs/addons berubah → status `new` untuk item yang berubah. `calculateDeltaKitchenItems` mempertahankan logika delta.
- **24.5**: Filter KDS menampilkan transaksi di SEMUA kolom yang relevan (Waiting jika ada `new`, Processing jika ada `processing`). Filter items sesuai kolom.
- **25.1**: `mergeKitchenItemStatus` hanya quantity NAIK yang dianggap berubah (bukan `!==`).
- **25.2**: `updateItemKitchenStatus` sync cloud dengan await + try/catch + console.warn.
- **25.3**: Filter KDS transaksi muncul di kolom DOMINAN saja (Priority: Waiting > Processing > Done).
- **25.4**: Filter items sesuai kolom: Waiting = 'new', Processing = 'processing', Done = all.

### 🧪 Validasi Rilis

- `npx tsc --noEmit` → **0 error**
- `npx vitest run` → **632/632 test lolos** (61 file)
- `npm run build` → **sukses** (18.70s, 50 chunks, PWA v1.3.0)

---

*Changelog ini disusun untuk rilis v4.8.1. Rincian teknis & riwayat lengkap: `AI-HANDOFF.md`, `TO DO.md`, `DEPLOYMENT.md`.*
