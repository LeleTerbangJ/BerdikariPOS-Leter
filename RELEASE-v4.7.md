# 📣 BerdikariPOS v4.8 — Rilis Final

Versi ini menuntaskan **semua prioritas pengembangan** (stok, opname, backup, laporan, refund, struk digital, sistem **Promo & Loyalty lengkap**, **mode offline andal**, hingga **integrasi printer thermal yang andal**, **pengalaman kasir yang mulus**, **audit flow Pending + Split Bill yang aman**, dan **per-item kitchen status di KDS**). Validasi: build produksi sukses, **632/632 tes otomatis lolos**.

---

## 📢 Ringkasan Rilis v4.7 (untuk dibagikan ke klien/tim)

> Versi singkat — salin & kirim ke klien. Detail lengkap di bagian bawah dokumen ini & `CHANGELOG.md`.

**Versi 4.7 menghadirkan:**

1. **Promo & Loyalty lengkap** 🏷️ — promo per menu/kategori, BOGO (beli N gratis M), syarat minimal qty/belanja, batas pemakaian per pelanggan, promo bisa digabung atau dipilih otomatis yang terbaik, nama promo tampil di struk, dan **poin loyalty** (pelanggan mengumpulkan poin & menukarnya). Laporan performa promo siap membantu evaluasi penjualan.
2. **Laporan PPN bulanan** 🧾 — ringkasan pajak per bulan (DPP, PPN, total) + ekspor CSV/PDF, memudahkan pelaporan.
3. **Refund/retur penuh** ↩️ — pengembalian dana tercatat rapi sebagai **Kas Keluar "Refund"** di Rekap Kas (akuntabel), stok & kunjungan pelanggan otomatis dikembalikan.
4. **Struk digital** 📱 — kirim struk via **WhatsApp/email** langsung dari riwayat transaksi; bisa **auto-kirim ke WhatsApp** pelanggan setelah pembayaran (atur di Pengaturan).
5. **Backup & Restore + Auto Backup** 💾 — backup lengkap (menu, stok, transaksi, semua data) dengan jadwal otomatis harian/mingguan, bisa disimpan lokal atau **cloud**; restore mudah & aman.
6. **Stock Opname lebih aman** 📦 — mode *blind* untuk Staf Gudang (tanpa bocor selisih), otorisasi PIN **khusus Manager**, alasan penyesuaian wajib, stok negatif dicegah.
7. **Mode offline andal** 📴 — tetap berjualan walau internet putus: data tersimpan aman (IndexedDB), otomatis tersinkron saat online (≤ 30 detik), ada penanda "Belum Sync", dan daftar operasi gagal yang bisa dicoba lagi — **tidak ada data hilang**.
8. **Printer thermal & dapur andal** 🖨️ — koneksi Bluetooth tidak putus saat refresh (auto re-pair), ada opsi cetak per transaksi (struk saja / tiket dapur saja / tanpa cetak), antrean cetak & indikator status di halaman Dapur.
9. **Skenario 2 kasir & offline** 👥 — dua kasir tidak bisa menjual stok melebihi fisik (proteksi otomatis), nomor antrean tidak dobel, satu shift aktif per toko, expected cash tutup shift akurat dari semua kasir, tombol **"Catat sebagai Demo"** untuk uji coba tanpa memotong stok.
10. **Perbaikan ketelitian & kenyamanan** ✅ — ringkasan tutup shift **tidak lagi salah hitung saat ada refund** (angka penjualan bersih + keterangan Refund Tunai); semua notifikasi kini tampil rapi (toast) & semua konfirmasi memakai dialog seragam — **tidak ada popup browser lama**.

> ⚠️ **Untuk database lama, wajib menjalankan langkah SQL sekali** (lihat bagian "Langkah yang Wajib Dijalankan" di bawah — tim teknis akan membantu).

---

## ✨ Fitur Baru

### 1. Promo & Loyalty Lengkap
- Promo per **menu tertentu**, **BOGO (beli N gratis M)**, dan **min-qty** (diskon hanya berlaku bila qty cukup).
- **Stacking terkontrol**: tiap promo bisa diset "boleh digabung" atau **eksklusif** — promo eksklusif otomatis memberi **diskon terbaik** (tidak pernah dobel).
- **Batas pemakaian per pelanggan** (mis. 1 voucher per orang).
- **Laporan performa promo** di Laporan — jumlah pakai, total diskon, omset per promo + export CSV.
- **Nama promo tercetak di struk** (termal & digital).
- **Poin Loyalty aktif**: pelanggan dapat poin saat checkout dan **menukarnya jadi diskon** di kasir; poin otomatis dikembalikan/dipotong saat transaksi batal atau refund.
- Validasi form promo (persentase, tanggal, minimal belanja) mencegah promo "rugi".

### 2. Laporan PPN Bulanan
Tab PPN di Laporan: ringkasan DPP/PPN, rekap per hari, detail transaksi, export **CSV & PDF** siap arsip pajak.

### 3. Refund / Retur Penuh
Stok kembali ke inventory, **Kas Keluar 'Refund' tercatat otomatis** di Rekap Kas, transaksi yang di-refund tidak dihitung sebagai penjualan, otorisasi PIN Manager, anti double-refund.

### 4. Struk Digital
Kirim struk ke **WhatsApp/email** pelanggan dari halaman Transaksi (kontak terisi otomatis dari CRM + pratinjau); opsi **auto-kirim WA** setelah checkout.

### 5. Backup & Restore + Auto Backup
Checksum anti-tamper, restore mode Merge/Replace, foto menu & struktur bundle ikut dibackup, jadwal harian/mingguan otomatis ke lokal atau **cloud (Supabase Storage)**.

### 6. Stock Opname Aman
Mode **blind** untuk Staf Gudang (tanpa bocor stok sistem), persetujuan selisih besar **hanya oleh Manager** (identitas + waktu tercatat), alasan penyesuaian wajib, stok negatif/NaN otomatis dikunci ke 0.

### 7. Kasir Lebih Cepat (UX POS)
- **Pencarian pelanggan di keranjang** — dropdown pelanggan kini bisa dicari dengan mengetik (nama / nomor HP / email); `Enter` memilih hasil pertama, `Escape` menutup, opsi "Lepaskan pelanggan".
- **Tambah pelanggan langsung dari POS** — tombol shortcut **"Baru"** di samping pemilih pelanggan → form singkat (nama/HP/email/catatan) → pelanggan **langsung terpilih** (diskon loyalty, poin, dan promo per-pelanggan langsung aktif) + tercatat di audit log — kasir tidak perlu pindah ke halaman Pelanggan.

### 8. Mode Offline Andal — tetap jalan walau internet putus
- **Antrean offline di IndexedDB** — transaksi besar tidak hilang saat kuota lokal penuh; data lama otomatis dimigrasikan.
- **Retry otomatis tiap 30 detik** + saat tab kembali terlihat; error jaringan sementara (mis. Wi-Fi tanpa internet) tidak menghabiskan batas percobaan.
- **Daftar operasi gagal** — tidak ada data yang di-drop diam-diam: badge merah → modal daftar berisi alasan error → tombol **Coba Lagi** / **Hapus** (dengan konfirmasi) + tercatat di audit log.
- **Banner status global** di semua perangkat & role (termasuk mobile): "📡 Offline", "⏳ N belum sinkron" (klik = kirim sekarang), "⚠️ N gagal".
- **Badge "Belum Sync" per transaksi** di Riwayat Transaksi — kasir langsung tahu transaksi mana yang belum terkirim; hilang otomatis saat tersinkron.
- **Peringatan perangkat baru** (cold start) — membedakan "belum pernah online" vs "koneksi putus" — dan **deteksi konflik stok** lintas device (banner kuning di Inventaris bila stok lokal tertimpa data perangkat lain).
- **PWA offline** — aplikasi tetap terbuka & bisa dipakai tanpa internet (app shell precache + NetworkFirst).
- Urutan sinkron **kronologis** — konsistensi antar tabel terjaga (mis. Rekap Kas selalu mengikuti transaksi induknya).

### 9. Printer Thermal Andal
- **Otomatis tersambung kembali setelah refresh** — printer Bluetooth yang tadinya terhubung dicoba disambungkan ulang secara senyap (tanpa dialog); bila perlu, banner 1-klik **"Sambungkan Ulang"** muncul — kasir tidak perlu pairing manual setiap kali.
- **Tidak ada dialog Bluetooth yang muncul tiba-tiba** di tengah pembayaran — kalau printer terputus, dicetak lewat dialog browser + pemberitahuan jelas, atau status error bila fallback dimatikan.
- **Fallback browser bisa diatur per printer** (kasir & dapur) — pas untuk demo atau toko tanpa printer Bluetooth.
- **Antrean cetak** — banyak struk/tiket dapur yang datang bersamaan dicetak **berurutan** tanpa tumpang tindih.
- **Indikator printer di halaman Dapur (KDS)** — tahu printer mana yang hidup/mati + tombol Hubungkan, tanpa buka Settings.
- **Opsi "Semua Dapur" di Edit Menu** — menu bisa diatur agar tiketnya dicetak ke **semua printer dapur aktif** (tidak hanya satu target) — cocok untuk menu yang bisa dibuat di dapur mana pun.

### 10. UX Kasir Lebih Mulus (Prioritas 15)
- **Harga Add-on divalidasi (gratis diperbolehkan)** — **add-on harga 0 (gratis) SAH** untuk pilihan saus/topping yang sudah termasuk; yang diblokir hanya harga **negatif/bukan angka** (peringatan jelas, simpan diblokir); di POS label **"Gratis"**, di struk termal & digital nama add-on gratis tercetak dengan penanda **(Gratis)** tanpa menambah total; import CSV katalog ikut divalidasi (add-on invalid dilewati + dilaporkan, JSON rusak tidak menggagalkan import).
- **Daftar Pending Payment jadi carousel** — card pesanan gantung bergeser kiri/kanan (panah, dot, counter "N dari M", bisa digeser jari) — tidak memakan layar saat banyak pending.
- **Opsi cetak per-transaksi (dua toggle)** — **"Cetak struk kasir"** & **"Cetak tiket dapur"**: skip struk saja (tiket dapur **tetap keluar di awal**) atau skip keduanya (tanpa cetakan); **anti tiket dobel otomatis** saat resume pending; berlaku di checkout normal, **Split Bill**, dan **resume pending**.
- **Header Inventaris lebih rapi** — tombol bahan baku (Tambah Bahan/Min. Stok/Export/Import) hanya di tab Bahan Baku; tab Stock Opname bersih.

### 11. Edit Menu & Opsi Cetak Lebih Rapi (Prioritas 17)
- **Edit Menu tidak menumpuk** — toggle **Best Seller ⭐ / Level Gula 🍬 / Pilihan Suhu 🌡️** membentang penuh di desktop dan wrap rapi di mobile.
- **Checkbox cetak berdampingan di desktop** — **"Cetak struk kasir" & "Cetak tiket dapur"** kini sejajar (desktop) / tetap vertikal (mobile), konsisten di modal POS & Split Bill.

### 12. Skenario 2 Kasir & Offline (Prioritas 18 — 18.1 s.d. 18.8)
- **Stok tidak bisa "oversell" antar kasir** — deduksi stok lewat **RPC atomik database** (`adjust_inventory_stock`, Migration 27): dua kasir memotong bahan yang sama bersamaan, yang kedua **ditolak** di level database (bukan stok negatif diam-diam) → stok dikoreksi + peringatan jelas. Bila RPC belum ada/offline, fallback aman otomatis.
- **Nomor antrean tidak kembar antar kasir** — alokasi via counter cloud **`queue_counters` + RPC `allocate_queue_number`** (Migration 28): dua kasir online mustahil dapat #N sama. Offline tetap jalan (fallback max+1) dengan **badge "#N duplikat"** bila nomor kembar terdeteksi.
- **Satu shift aktif per outlet** — shift kedua ditolak; device lain otomatis **melanjutkan shift yang sama**; `loadFromCloud` me-restore shift terbuka paling awal — laporan Shift Manager tidak lagi punya dua shift "aktif".
- **Expected cash tutup shift dari data tersinkron** — saat tutup shift, aplikasi flush + tarik ulang dari cloud lalu menghitung dari **semua kasir**, dengan **peringatan bila masih ada data belum tersinkron**.
- **Banner "Laporan belum final"** di Laporan & Dashboard — mengingatkan saat masih ada transaksi belum tersinkron (angka bisa berubah setelah sinkron).
- **Catat transaksi Demo langsung dari POS** — tombol **"Catat sebagai Demo (tidak memotong stok)"** untuk pelatihan kasir: tanpa potong stok, tanpa nomor antrean (label DEMO), tanpa cetak, tidak masuk laporan; bisa diubah ke Selesai nanti.
- **Promo usage dilindungi dari race** — pemakaian promo dicatat atomik dari store saat commit + ledger id transaksi (replay tidak menggandakan); replay transaksi tidak lagi menggandakan kunjungan/poin loyalty.
- **Tiket dapur tidak hilang saat resume pesanan gantung** — status cetak tiket dicatat di transaksi (`kitchenTicketPrintedAt`, Migration 30): resume hanya melewati cetak bila tiket benar-benar sudah keluar; printer gagal → dicetak ulang.
- **Bahan resep yang sudah dihapus tidak lolos diam-diam** — validasi stok memperingatkan "bahan tidak ditemukan" sebelum checkout.

---

## 🐛 Perbaikan Utama
- Stok bocor saat transaksi Demo → Selesai; hapus pesanan gantung (Pending) kini mengembalikan stok.
- Reset data (Bersihkan Data / Reset ke Default / Factory Reset) kini **benar-benar menghapus** transaksi & audit log (termasuk Rekap Kas, lokal + cloud) — sebelumnya data "ghost" bisa muncul lagi.
- Factory Reset kini **fresh start** (tanpa katalog demo ter-push ke cloud), dengan **backup otomatis + konfirmasi ketik "HAPUS SEMUA"** sebelum reset.
- Rekap Kas (Kas Masuk/Keluar) tersinkron antar device (fix RLS).
- Import CSV & Stock Opname lebih cepat (1 request batch), rename bahan tercatat dengan nama baru.
- Perbaikan stabilitas penyimpanan: transaksi & audit log di **IndexedDB** (kuota lokal tidak terbatas).
- **Perubahan menu pada pesanan gantung (tambah/kurangi) kini selalu muncul di riwayat transaksi** — sinkronisasi antar perangkat tidak lagi menimpa item yang baru diubah dengan versi lama (perbandingan kesegaran per transaksi, termasuk void/batal & perubahan metode bayar).
- **Tidak ada lagi transaksi ganda saat pesanan gantung diedit lalu dibayar setelah pindah halaman/refresh** — identitas pending tersimpan bersama keranjang & dipulihkan otomatis → pembayaran meng-update pending yang sama (1 transaksi), bukan membuat transaksi baru; identitas dibersihkan pasca-bayar.
- **Nomor antrean di pagi buta (00:00–07:00 WIB) tidak lagi salah hitung** — perbandingan tanggal kini memakai tanggal lokal, transaksi pagi tidak terlewat (tidak menabrak #N yang sudah ada).
- **Replay/double-click transaksi tidak lagi menggandakan kunjungan/promo/poin** — efek samping hanya dijalankan sekali per transaksi.
- **Alert stok negatif lebih akurat** — revert kecil yang tidak memperbaiki item negatif tidak lagi menghapus peringatan yang masih relevan.
- **Ringkasan tutup shift tidak lagi overstated saat ada refund (Prioritas 20.1)** — Total Penjualan & Total Transaksi kini mengecualikan transaksi yang sudah di-refund (konsisten dengan Dashboard/Laporan/Riwayat); expected cash tetap akurat karena penjualan tunai yang di-refund dinetralkan dengan Kas Keluar Refund (tanpa double-subtract), dilengkapi baris "Refund Tunai (Dikembalikan)" di modal & struk ringkasan shift.
- **Struk ringkasan shift lebih informatif** — tambah Jam Mulai/Jam Tutup, Total Item Terjual, daftar Penjualan Menu per item (Qty x Harga = Jumlah, terlaris di atas), rumusan formula dihapus.
- **Semua notifikasi kini memakai toast (Prioritas 20.2)** — 21 `alert()` diganti `addToast` di seluruh aplikasi (App/session, Audit Log, Rekap Kas, Katalog, Settings, Stock Opname).
- **Semua konfirmasi memakai dialog kustom (Prioritas 20.3)** — 4 `window.confirm` terakhir (tutup shift selisih kas > 10%, void transaksi gantung, resume pending saat keranjang berisi, hapus user) diganti **ConfirmDialog** yang seragam; **tidak ada dialog browser native (`alert`/`confirm`) tersisa** di kode produksi.
- **Filter tanggal custom tidak lagi melewatkan transaksi pagi buta (Prioritas 20.4)** — tanggal awal range custom kini dip-parse **lokal** (`'T00:00:00'`, bukan UTC tengah malam = 07:00 WIB) di Laporan & Riwayat Transaksi, sehingga transaksi 00:00–07:00 pada hari pertama tetap masuk laporan.
- **Audit flow Pending + Tambah Item + Split Bill (Prioritas 21)** — tiket dapur saat finalisasi pending hanya mencetak item baru (delta); tiket dapur saat split dari pending otomatis skip; guard rekonsiliasi ganda mencegah stok di-adjust dua kali; badge "✓ Diupdate" di kartu Pending Payments; badge "🔄 Diupdate" + background biru di KDS + timer overdue restart.

---

## ⚠️ Langkah yang Wajib Dijalankan (Database Lama — sekali saja)

> Project **baru** cukup menjalankan `supabase/schema.sql` v4.7 — selesai.

Untuk database yang sudah ada, jalankan di **Supabase SQL Editor** (aman diulang):

```sql
-- Otorisasi Stock Opname (mode blind + approver Manager)
ALTER TABLE stock_opnames ADD COLUMN IF NOT EXISTS approver_id TEXT;
ALTER TABLE stock_opnames ADD COLUMN IF NOT EXISTS approver_name TEXT;
ALTER TABLE stock_opnames ADD COLUMN IF NOT EXISTS approver_role TEXT;
ALTER TABLE stock_opnames ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE stock_opnames ADD COLUMN IF NOT EXISTS device_id TEXT;
ALTER TABLE stock_opnames ADD COLUMN IF NOT EXISTS adjustment_reason TEXT;

-- Refund transaksi
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refunded BOOLEAN DEFAULT FALSE;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refunded_amount FLOAT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refund_note TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refunded_by_id TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refunded_by_name TEXT;

-- Struk Digital (auto-kirim WA)
ALTER TABLE settings ADD COLUMN IF NOT EXISTS auto_send_digital_receipt BOOLEAN DEFAULT FALSE;

-- Promo & Loyalty (P-A3 s.d. P-A8)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS promo_name TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS promo_amount FLOAT;
ALTER TABLE promos ADD COLUMN IF NOT EXISTS stackable BOOLEAN DEFAULT TRUE;
ALTER TABLE promos ADD COLUMN IF NOT EXISTS bogo_config JSONB;
ALTER TABLE promos ADD COLUMN IF NOT EXISTS min_qty INT;
ALTER TABLE promos ADD COLUMN IF NOT EXISTS usage_limit_per_customer INT;
ALTER TABLE promos ADD COLUMN IF NOT EXISTS usage_by_customer JSONB DEFAULT '{}';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS loyalty_points INT DEFAULT 0;
-- Perluas tipe promo agar menerima 'bogo' (idempoten)
DO $$ DECLARE cname TEXT; BEGIN
  SELECT conname INTO cname FROM pg_constraint
  WHERE conrelid = 'promos'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%percentage%';
  IF cname IS NOT NULL THEN EXECUTE format('ALTER TABLE promos DROP CONSTRAINT %I', cname); END IF;
END $$;
ALTER TABLE promos ADD CONSTRAINT promos_type_check CHECK (type IN ('percentage', 'fixed', 'bogo'));

-- ============================================================
-- 12. ⚠️ WAJIB (Prioritas 18) — RPC atomik stok (Migration 27) — proteksi oversell 2 kasir
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
-- 13. ⚠️ WAJIB (Prioritas 18) — counter nomor antrean atomik (Migration 28)
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
-- 14. ⚠️ WAJIB (Prioritas 18 — A5) — kolom updated_at inventory (Migration 29, last-write-wins)
-- ============================================================
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- ============================================================
-- 15. ⚠️ WAJIB (Prioritas 18 — A10) — kolom status cetak tiket dapur (Migration 30)
-- ============================================================
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS kitchen_ticket_printed_at TIMESTAMPTZ;
```

> 💡 Aplikasi **mendeteksi otomatis** kolom yang kurang saat dibuka dan mencetak SQL perbaikannya di console browser (Migration 19–30 — termasuk **27: RPC stok atomik, 28: counter nomor antrean, 29: `updated_at` inventory, 30: `kitchen_ticket_printed_at`**) — jadi tidak ada langkah yang bisa terlewat tanpa disadari.

**Opsional** — hanya jika memakai Auto Backup ke cloud: buat bucket `backups` + policy Storage (sekali per project Supabase; lihat `DEPLOYMENT.md` §4b).

---

## 🧪 Validasi Rilis
- `npx tsc --noEmit` → **0 error**
- `npx vitest run` → **632/632 test lolos** (61 file — Prioritas 20: +10 test; **Prioritas 21: +4 test**; **Prioritas 23: +30 test** — per-item kitchen status, KDS filter, tombol per-item, sync cloud, logging)
- `npm run build` → **✅ BERHASIL (diverifikasi 20 Agt 2026, setelah seluruh Prioritas 23 tuntas)**: `✓ built in 19.14s` tanpa error TypeScript/rollup; **PWA v1.3.0** `generateSW` → **50 precache entries (3643.50 KiB)**, `dist/sw.js` + `dist/workbox-c3716bd4.js` digenerate. Satu-satunya catatan: warning chunk > 500 kB (kosmetik, bukan error) — build produksi **v4.8 final terverifikasi**.
- **Mode offline**: transaksi & Rekap Kas tetap tercatat tanpa koneksi, tersinkron otomatis saat online, tanpa kehilangan data.

---

## 🛠️ Apa artinya untuk operasional sehari-hari

- **Internet putus bukan lagi alasan berhenti jualan** — kasir tetap mencatat pesanan, Rekap Kas, dan pesanan gantung; semuanya tersinkron otomatis saat koneksi kembali (tanpa tombol manual, tanpa duplikat).
- **Aplikasi tidak "hilang" saat offline** — tetap terbuka & bisa dipakai (PWA), dan data tidak hilang walau aplikasi ditutup di tengah offline (IndexedDB).
- **Tidak ada lagi data raib diam-diam** — setiap operasi yang gagal tersinkron selalu terlihat (badge/banner + daftar dengan alasan) dan bisa dicoba lagi.
- **Printer thermal tidak bikin antrean berhenti** — saat printer terputus (mis. setelah refresh), aplikasi mencoba menyambungkan ulang otomatis atau mencetak lewat dialog browser; kasir tidak diblokir dan pesanan dapur tidak hilang.
- **Panduan verifikasi**: [`TESTING-OFFLINE.md`](./testing/TESTING-OFFLINE.md) — 6 tahap uji (≈ 30–45 menit) untuk memastikan semua perilaku di atas bekerja di perangkat Anda.

---

*Ringkasan lengkap per versi (v4.4–v4.7): `CHANGELOG.md`. Detail teknis & panduan deployment: `DEPLOYMENT.md`. Riwayat pengembangan: `AI-HANDOFF.md`.*
