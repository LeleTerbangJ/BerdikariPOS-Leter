# 📣 BerdikariPOS v4.7 — Rilis Final

Versi ini menuntaskan **semua prioritas pengembangan** (stok, opname, backup, laporan, refund, struk digital, hingga sistem **Promo & Loyalty lengkap**). Validasi: build produksi sukses, **370/370 tes otomatis lolos**.

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

---

## 🐛 Perbaikan Utama
- Stok bocor saat transaksi Demo → Selesai; hapus pesanan gantung (Pending) kini mengembalikan stok.
- Reset data (Bersihkan Data / Reset ke Default / Factory Reset) kini **benar-benar menghapus** transaksi & audit log (termasuk Rekap Kas, lokal + cloud) — sebelumnya data "ghost" bisa muncul lagi.
- Factory Reset kini **fresh start** (tanpa katalog demo ter-push ke cloud), dengan **backup otomatis + konfirmasi ketik "HAPUS SEMUA"** sebelum reset.
- Rekap Kas (Kas Masuk/Keluar) tersinkron antar device (fix RLS).
- Import CSV & Stock Opname lebih cepat (1 request batch), rename bahan tercatat dengan nama baru.
- Perbaikan stabilitas penyimpanan: transaksi & audit log di **IndexedDB** (kuota lokal tidak terbatas).

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
```

> 💡 Aplikasi **mendeteksi otomatis** kolom yang kurang saat dibuka dan mencetak SQL perbaikannya di console browser (Migration 19–26) — jadi tidak ada langkah yang bisa terlewat tanpa disadari.

**Opsional** — hanya jika memakai Auto Backup ke cloud: buat bucket `backups` + policy Storage (sekali per project Supabase; lihat `DEPLOYMENT.md` §4b).

---

## 🧪 Validasi Rilis
- `npx tsc --noEmit` → **0 error**
- `npx vitest run` → **370/370 test lolos** (31 file)
- `npm run build` → **sukses** (tsc + vite build + PWA)

---

*Ringkasan lengkap per versi (v4.4–v4.7): `CHANGELOG.md`. Detail teknis & panduan deployment: `DEPLOYMENT.md`. Riwayat pengembangan: `AI-HANDOFF.md`.*
