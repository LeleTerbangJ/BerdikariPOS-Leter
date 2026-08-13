# 🚀 Panduan Deployment & Komersialisasi — BerdikariPOS v4.7

## Status: ✅ PRODUCTION LIVE
- **Hosting**: Vercel (auto-deploy)
- **Database**: Supabase (PostgreSQL + Real-time)
- **Repository**: https://github.com/LeleTerbangJ/BerdikariPOS-Leter.git
- **Branch produksi**: `main` (Vercel auto-deploy dari `main`)
- **CI/CD**: Push/merge ke `main` → Vercel auto-build & deploy (1–2 menit)
- **Changelog rilis**: [`CHANGELOG.md`](./CHANGELOG.md) — riwayat v4.4 → v4.7 (fitur baru, perbaikan, SQL wajib)

## Daftar Isi
1. [Apakah Harus Produksi Dulu?](#1-apakah-harus-produksi-dulu)
2. [Cara Deploy Update](#2-cara-deploy-update)
3. [Setup untuk Setiap Klien Baru](#3-setup-untuk-setiap-klien-baru)
4. [Perubahan Database yang WAJIB Dijalankan (DB Lama)](#4-perubahan-database-yang-wajib-dijalankan-db-lama)
5. [Model Bisnis & Pricing](#5-model-bisnis--pricing)
6. [Panduan Pemakaian untuk Klien](#6-panduan-pemakaian-untuk-klien)
7. [Checklist Sebelum Jual / Komersialisasi](#7-checklist-sebelum-jual--komersialisasi)
8. [Changelog Rilis](#8-changelog-rilis)

---

## 1. Apakah Harus Produksi Dulu?

**✅ SUDAH PRODUCTION.** Aplikasi sudah live di Vercel dengan:
- HTTPS otomatis
- Cloud database (Supabase) aktif
- Real-time sync antar device berfungsi (100% coverage — semua tabel)
- PWA installable (bisa dipasang di HP/desktop seperti aplikasi native)
- Full cloud sync: delete propagation, fullSync mode, 16 data types
- Background Printer Connection Monitor dengan status banner & 1-click reconnect
- **Rekap Kas (Kas Masuk/Keluar) tersinkron lintas device** (fix v4.6 — RLS + offline queue + badge "Belum Sync")
- Penyimpanan lokal IndexedDB untuk transaksi & audit log (kuota tidak lagi jadi batas)
- **Stock Opname aman (v4.7)** — mode blind tanpa kebocoran oracle, otorisasi dual-control Manager, alasan penyesuaian wajib, clamp stok aktual negatif/NaN
- **Struk Digital (v4.7)** — kirim struk via WhatsApp/email dari riwayat transaksi + opsi auto-kirim WA pasca-checkout

### Arsitektur Production:
```
[Vercel] ← auto-deploy ← [GitHub repo]
    ↕ HTTPS
[Browser/PWA di device manapun]
    ↕ Real-time
[Supabase PostgreSQL + Real-time subscriptions]
```

---

## 2. Cara Deploy Update

Setiap kali ada perubahan kode:

```bash
cd "D:\Private File\Aba\VibeCoding\Client\LeleTerbang\BerdikariPOS-Leter"

# Kerja di branch develop
git add .
git commit -m "deskripsi perubahan"
git push origin develop

# Setelah teruji di develop → merge ke main (produksi)
git checkout main
git pull origin main
git merge develop
git push origin main
```

Vercel otomatis detect push ke `main` dan re-deploy dalam 1–2 menit. Tidak perlu setup ulang.

> [!WARNING]
> **JANGAN commit file `.freebuff/*`** — itu database lokal milik aplikasi Freebuff Desktop (bukan kode project, isinya berubah terus). Sudah ada di `.gitignore`, tapi karena pernah ter-track di history, `git add .` masih ikut men-stage perubahannya. Bersihkan sekali:
> ```bash
> git rm --cached .freebuff/desktop-v2.db .freebuff/desktop-v2.db-shm .freebuff/desktop-v2.db-wal
> ```

### Sebelum merge ke produksi, pastikan:
- `npx tsc --noEmit` → 0 error
- `npx vitest run` → semua test lolos (saat ini **192/192**)
- `npm run build` → sukses
- Perubahan database (jika ada) sudah dijalankan di Supabase SQL Editor — lihat §4

### Jika Perlu Tambah/Ubah Environment Variables:
1. Buka https://vercel.com → pilih project
2. Settings → Environment Variables
3. Edit/tambah variabel (lihat §3 untuk daftar)
4. Klik "Redeploy" di tab Deployments

---

## 3. Setup untuk Setiap Klien Baru

Setiap klien (toko) yang membeli aplikasi ini perlu:

### Opsi A: Shared Database (Mudah, tapi data campur)
- Semua klien pakai 1 Supabase project
- Tambahkan field `store_id` di setiap tabel untuk pisahkan data
- **Pro**: Mudah manage, 1 deployment
- **Con**: Perlu modifikasi kode, risiko data bocor

### Opsi B: Separate Database per Klien (Rekomendasi)
- Setiap klien punya Supabase project sendiri
- Anda deploy 1 frontend, tapi env variables berbeda per klien
- **Pro**: Data 100% terpisah, aman
- **Con**: Perlu manage banyak project

### Opsi C: Multi-tenant (Skala besar)
- 1 database, tapi dengan Row Level Security per tenant
- Perlu Supabase Auth + custom claims
- **Pro**: Scalable
- **Con**: Kompleks, perlu development lanjutan

### Setup Cepat untuk 1 Klien Baru (Opsi B):
1. Buat Supabase project baru (paket gratis sudah cukup untuk 1 outlet).
2. **Jalankan `supabase/schema.sql` (v4.7) di SQL Editor** — file ini sudah lengkap: semua tabel, kolom v4.1–v4.7 (termasuk kolom otorisasi Stock Opname), RLS + policy, dan publication realtime. **Project baru TIDAK perlu SQL tambahan.**
3. Deploy frontend (Vercel) dengan env vars klien tersebut:

| Variabel | Nilai | Dari mana |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://xxxx.supabase.co` | Supabase → Settings → API |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbGciOi...` (anon key) | Supabase → Settings → API |

4. Login pertama (akun default, **segera ganti password**):
   - Manager: `manager` / `manager123`
   - Kasir: `kasir` / `kasir123`
   - Acaraki: `acaraki` / `acaraki123`
   - Staf Gudang: `gudang` / `gudang123`

> [!IMPORTANT] **Keamanan anon key**
> `VITE_SUPABASE_ANON_KEY` adalah kunci **publik** (terbaca siapa pun dari browser). Perlindungan data 100% bergantung pada **Row Level Security (RLS)** di tiap tabel — pastikan policy `"Allow all for anon"` ada di SEMUA tabel (sudah termasuk di `schema.sql`).
> **JANGAN PERNAH** menaruh `service_role` key di frontend/env publik — siapa pun yang mendapatkannya bisa membaca/menulis SEMUA data tanpa RLS.

> [!WARNING] **Bug produksi yang sudah diperbaiki (v4.6)**
> Tabel `cash_movements` pernah aktif RLS **tanpa policy** → Rekap Kas tidak pernah tersinkron antar device (Kas Masuk/Keluar tidak muncul di laporan Shift Manager) karena anon key diblokir diam-diam. `schema.sql` v4.6 sudah menyertakan policy-nya. Untuk DB lama, lihat §4 butir 7.

---

## 4. Perubahan Database yang WAJIB Dijalankan (DB Lama)

> Project **baru** cukup menjalankan `supabase/schema.sql` (v4.7) — selesai.
> Untuk **meng-upgrade database yang sudah ada** ke v4.7, jalankan seluruh blok berikut di Supabase SQL Editor. Aman dijalankan berulang (`IF NOT EXISTS` / DO block idempoten).
> **v4.7 menambah lima hal**: (a) butir 8 — kolom otorisasi opname (WAJIB untuk semua DB yang memakai Stock Opname), (b) butir 9 — kolom Refund transaksi (WAJIB bila memakai fitur Refund/Retur), (c) butir 10 — kolom `auto_send_digital_receipt` di `settings` (WAJIB bila memakai fitur Struk Digital / auto-kirim WA), (d) butir 11 — kolom Promo & Loyalty (WAJIB bila memakai fitur Promo/Loyalty), dan (e) §4b — bucket Storage untuk Auto Backup cloud (opsional).

```sql
-- ============================================================
-- UPGRADE DB LAMA → v4.7
-- ============================================================

-- 1. Pengaturan Pajak & Fitur Meja (v4.2)
ALTER TABLE settings ADD COLUMN IF NOT EXISTS tax_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS table_features JSONB DEFAULT '{"enabled": false, "tables": ["Meja 1", "Meja 2", "Meja 3", "Meja 4", "Meja 5"]}';

-- 1b. Kolom cetak struk (v4.4 TO DO 2.7) — ditulis syncSettings; wajib ada agar upsert tidak gagal pada DB lama
ALTER TABLE settings ADD COLUMN IF NOT EXISTS receipt_ascii_only BOOLEAN DEFAULT FALSE;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS auto_print_receipt BOOLEAN DEFAULT FALSE;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS receipt_header TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS receipt_footer TEXT;

-- 2. Detail Transaksi (Tipe Pesanan, Meja, Pajak)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS order_type TEXT DEFAULT 'Dine In';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS table_number TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tax INT DEFAULT 0;

-- 3. Tabel Rekap Kas (Kas Masuk & Kas Keluar)
CREATE TABLE IF NOT EXISTS cash_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('in', 'out')),
  amount FLOAT NOT NULL DEFAULT 0,
  category TEXT NOT NULL,
  notes TEXT,
  cashier_id TEXT,
  cashier_name TEXT NOT NULL,
  date TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Blok Aman untuk Realtime Publication
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE cash_movements;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 5. Fitur Pending Payment & Split Bill (v4.1) — izinkan status 'Pending' & kolom pendukung
DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'transactions'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%tx_status%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE transactions DROP CONSTRAINT %I', cname);
  END IF;
END $$;
ALTER TABLE transactions ADD CONSTRAINT transactions_tx_status_check CHECK (tx_status IN ('Selesai', 'Cancel', 'Pending', 'Demo'));
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS table_name TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_pending BOOLEAN DEFAULT FALSE;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS pending_notes TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS split_parent_id TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS split_index INT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS total_split_count INT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS paid_amount FLOAT;

-- 6. Promo Pending (v4.5 TO DO 5.5) — di-restore saat resume agar total konsisten lintas device
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS applied_promo_id TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS voucher_code TEXT;

-- 7. ⚠️ v4.6 WAJIB — RLS policy untuk cash_movements (idempoten)
-- Tanpa policy ini, anon key diblokir diam-diam → Rekap Kas TIDAK PERNAH tersinkron antar device
-- (Kas Masuk/Keluar tidak muncul di laporan Shift Manager). Ini bug produksi yang sudah diperbaiki.
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
ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;

-- 8. ⚠️ v4.7 WAJIB — kolom otorisasi Stock Opname (TO DO 10.2/10.3)
-- Identitas approver (Manager), jejak audit (timestamp + penanda perangkat), dan alasan
-- penyesuaian wajib untuk Staf Gudang. Ditulis syncStockOpname — wajib ada agar upsert
-- tidak gagal pada DB lama (mencegah penumpukan offline queue).
ALTER TABLE stock_opnames ADD COLUMN IF NOT EXISTS approver_id TEXT;
ALTER TABLE stock_opnames ADD COLUMN IF NOT EXISTS approver_name TEXT;
ALTER TABLE stock_opnames ADD COLUMN IF NOT EXISTS approver_role TEXT;
ALTER TABLE stock_opnames ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE stock_opnames ADD COLUMN IF NOT EXISTS device_id TEXT;
ALTER TABLE stock_opnames ADD COLUMN IF NOT EXISTS adjustment_reason TEXT;

-- 9. ⚠️ v4.7 WAJIB (fitur Refund) — kolom refund transaksi (TO DO 11.2 / P0.2)
-- updateTxMeta menulis refunded/refunded_at/refunded_amount/refund_note/refunded_by_id/
-- refunded_by_name — wajib ada agar smartUpdate pada DB lama tidak gagal (anti offline queue).
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refunded BOOLEAN DEFAULT FALSE;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refunded_amount FLOAT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refund_note TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refunded_by_id TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refunded_by_name TEXT;

-- 10. ⚠️ v4.7 WAJIB (fitur Struk Digital) — auto-kirim struk via WhatsApp (TO DO 11.2 / P0.4)
-- syncSettings menulis auto_send_digital_receipt — wajib ada agar upsert pada DB lama tidak
-- gagal (anti offline queue). Fitur ini menutup celah "struk digital" sebagian (pengiriman
-- masih via deep-link wa.me/mailto dengan struk terisi otomatis, bukan server broadcast).
ALTER TABLE settings ADD COLUMN IF NOT EXISTS auto_send_digital_receipt BOOLEAN DEFAULT FALSE;

-- 11. ⚠️ v4.7 WAJIB (fitur Promo & Loyalty) — kolom promo/loyalty (TO DO 12.2 / P-A3 s.d. P-A8)
-- syncTransaction menulis promo_name/promo_amount; syncPromo menulis stackable/bogo_config/
-- min_qty/usage_limit_per_customer/usage_by_customer; syncCustomer menulis loyalty_points.
-- Wajib ada agar upsert pada DB lama tidak gagal (anti penumpukan offline queue).
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
```

> [!NOTE] **Self-healing di sisi app**
> `runMigrations()` dijalankan otomatis setiap app dibuka:
> - Mendeteksi kolom yang kurang dan mencetak SQL perbaikannya di console (Migration 1–17).
> - **Migration 18 (v4.6)** mendeteksi RLS-aktif-tanpa-policy di `cash_movements` via probe INSERT tanpa side-effect, lalu mencetak SQL idempoten untuk dijalankan sekali di SQL Editor.
> - **Migration 19 (v4.7)** mendeteksi kolom otorisasi opname yang kurang di `stock_opnames` (approver_id / approver_name / approver_role / approved_at / device_id / adjustment_reason) dan mencetak SQL butir 8.
> - **Migration 20 (v4.7)** mendeteksi kolom refund yang kurang di `transactions` (refunded / refunded_at / refunded_amount / refund_note / refunded_by_id / refunded_by_name) dan mencetak SQL butir 9.
> - **Migration 21 (v4.7)** mendeteksi kolom `auto_send_digital_receipt` yang kurang di `settings` dan mencetak SQL butir 10.
> - **Migration 22 (v4.7)** mendeteksi kolom `promo_name`/`promo_amount` yang kurang di `transactions`; **Migration 23** — `stackable` di `promos`; **Migration 24** — `min_qty`/`bogo_config` di `promos` (+ relaksasi CHECK `promos.type` agar menerima `'bogo'`); **Migration 25** — `usage_limit_per_customer`/`usage_by_customer` di `promos`; **Migration 26** — `loyalty_points` di `customers`. Semuanya mencetak SQL butir 11.
> Jadi jika ada yang terlewat, console browser akan menunjukkan persis apa yang perlu dijalankan.

### 4b. (v4.7) Supabase Storage — bucket untuk Auto Backup cloud

> Diperlukan **HANYA jika klien memakai Auto Backup** dengan destinasi **Supabase Cloud Storage** (Settings → Backup → Auto Backup). Bucket + policy dibuat **sekali per project Supabase** — anon key tidak bisa membuat bucket sendiri. Aman dijalankan berulang (`ON CONFLICT DO NOTHING`). Jika klien hanya memakai "Local Download", langkah ini bisa dilewati.

```sql
-- Bucket penyimpanan backup
INSERT INTO storage.buckets (id, name, public)
VALUES ('backups', 'backups', false)
ON CONFLICT (id) DO NOTHING;

-- Policy: app (anon key) boleh UPLOAD & BACA file backup
CREATE POLICY "Allow anon upload backups"
  ON storage.objects FOR INSERT TO anon
  WITH CHECK (bucket_id = 'backups');
CREATE POLICY "Allow anon read backups"
  ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'backups');
```

> [!NOTE] **Self-healing di sisi app (v4.7)**
> Scheduler auto backup (`src/lib/autoBackupScheduler.ts`) mengecek jadwal tiap 1 menit (guard `frequency`/`targetTime`/online). Jika bucket belum dibuat, upload pertama gagal → app mencetak SQL di atas ke console browser dan **mencoba lagi otomatis 5 menit kemudian**. `lastAutoBackupAt` dicatat hanya saat sukses, jadi tidak ada backup yang terlewat karena kegagalan sementara.

---

## 5. Model Bisnis & Pricing

### Model SaaS (Langganan Bulanan) — Rekomendasi

| Paket | Harga/bulan | Fitur |
|-------|-------------|-------|
| **Starter** | Rp 99.000 | 1 outlet, 2 user, basic reports |
| **Business** | Rp 199.000 | 1 outlet, unlimited user, full reports + PDF |
| **Pro** | Rp 399.000 | Multi-outlet, priority support, custom branding |

### Model Lisensi (Bayar Sekali)

| Paket | Harga | Fitur |
|-------|-------|-------|
| **Basic** | Rp 1.500.000 | Aplikasi + setup + 1 bulan support |
| **Premium** | Rp 3.000.000 | + training + 6 bulan support + custom menu |
| **Enterprise** | Rp 5.000.000+ | + custom fitur + unlimited support |

---

## 6. Panduan Pemakaian untuk Klien

### Dokumen yang Perlu Anda Siapkan:

#### A. Quick Start Guide (1 halaman)
```
PANDUAN CEPAT — [Nama Toko] POS

1. Buka [URL] di browser Chrome → pasang sebagai aplikasi (PWA)
2. Login:
   - Manager: [username] / [password]
   - Kasir: [username] / [password]
   - Acaraki: [username] / [password]
   - Staf Gudang: [username] / [password]

3. Kasir: Buka shift → Buat pesanan → Bayar → Tutup shift
4. Acaraki: Lihat pesanan → Proses → Selesai
5. Manager: Lihat laporan, kelola menu, atur promo, atur pajak
6. Gudang: Stock opname mode blind

Catatan penting:
- Saat offline, data tetap tersimpan di device (badge "Belum Sync" muncul di Rekap Kas)
  dan otomatis tersinkron saat online kembali.
- Perubahan menu/stok dari satu device otomatis terlihat di device lain (real-time).

Butuh bantuan? Hubungi: [WA Anda]
```

#### B. Persiapan untuk Klien
- 1 device kasir + 1 device dapur (bisa HP/tablet/PC)
- Chrome versi terbaru (PWA)
- Printer thermal Bluetooth/network (untuk struk & tiket dapur)
- Koneksi internet stabil (offline masih bisa, tapi sync tertunda)

---

## 7. Checklist Sebelum Jual / Komersialisasi

### ✅ Teknis (DONE)
- [x] Deploy ke Vercel (production URL aktif)
- [x] HTTPS aktif (otomatis di Vercel)
- [x] Cloud sync berfungsi (Supabase real-time — 100% coverage)
- [x] Background service Printer Connection Monitor + UI Status Banner
- [x] Revert stok & data customer otomatis saat transaksi dihapus
- [x] Modul Rekap Kas (Kas Masuk & Kas Keluar) + Shift breakdown
- [x] **Rekap Kas tersinkron lintas device (v4.6)** — fix RLS + offline queue + badge "Belum Sync"
- [x] Pengaturan Pajak (PB1/PPN) toggle on/off + preset %
- [x] PWA installable
- [x] Password hashing (bcrypt)
- [x] Error boundary (crash handling)
- [x] Code-splitting (fast load)
- [x] Restriksi Multi-login Device (satu session aktif per user)
- [x] Penyimpanan IndexedDB (v4.5) — transaksi & audit log tidak lagi dibatasi kuota localStorage
- [x] **Backup & Restore aman (v4.7)** — checksum berbasis isi (tamper terdeteksi), restore mode Replace (snapshot penuh), media/bundle/StockLogs ikut di-restore & di-sync
- [x] **Auto Backup berjalan otomatis (v4.7)** — scheduler Daily/Weekly + upload ke Supabase Storage bucket `backups` (opsional)
- [x] **Stock Opname aman & lengkap (v4.7)** — Prioritas 9 & 10: log import CSV, guard race lintas device (anti lost update), batch sync, mode blind tanpa kebocoran oracle ±10%, otorisasi PIN dual-control (hanya Manager — identitas approver + penanda perangkat tercatat), alasan penyesuaian wajib untuk Staf Gudang, clamp stok aktual negatif/NaN
- [x] **Laporan PPN bulanan (v4.7 — P0.1)** — tab PPN di Laporan: ringkasan DPP/PPN, rekap harian, detail transaksi, export CSV & PDF
- [x] **Refund/Retur penuh (v4.7 — P0.2)** — revert stok + kunjungan, Kas Keluar 'Refund' otomatis di Rekap Kas, eksklusi dari penjualan, anti double-refund, otorisasi PIN Manager
- [x] **Struk Digital (v4.7 — P0.4)** — kirim struk ke WhatsApp/email pelanggan dari halaman Transaksi (kontak CRM otomatis + pratinjau + audit log); toggle Settings "auto-kirim WA" pasca-checkout (pre-open window anti popup blocker, skip idempotent replay)
- [x] **Promo lengkap (v4.7 — P-A2 s.d. P-A8)** — scope menu di form, validasi form, laporan performa promo (snapshot `promoName`/`promoAmount` + tab di Laporan + CSV), stacking/eksklusif dengan auto best-deal, BOGO & min-qty, batas pemakaian per pelanggan, nama promo di struk termal & digital, poin loyalty (earn + redeem + clawback)
- [x] Validasi otomatis: tsc 0 error, **370/370 test** (31 file), build produksi sukses (diverifikasi v4.7)

> **Panduan tes terperinci** (langkah + hasil yang diharapkan untuk setiap item di bawah): **[`TESTING-PRADEPLOY.md`](./TESTING-PRADEPLOY.md)**. Panduan demo penjualan cepat untuk tim sales (alur POS: promo BOGO, split bill, pending, struk digital): **[`TESTING-DEMO-SALES.md`](./TESTING-DEMO-SALES.md)**.

### 🔲 Sebelum Serah Terima ke Klien
- [ ] Ganti password default semua akun
- [ ] Buat Supabase project terpisah per klien (Opsi B) dan isi env vars yang benar
- [ ] Jalankan `supabase/schema.sql` v4.7 di project klien (atau blok upgrade §4 — termasuk butir 8 kolom otorisasi opname, butir 9 kolom Refund, butir 10 kolom Struk Digital, & butir 11 kolom Promo/Loyalty — + §4b bucket Auto Backup untuk DB lama)
- [ ] (Opsional) Buat bucket `backups` + policy Storage (§4b) bila klien memakai Auto Backup cloud
- [ ] Verifikasi sync antar 2 device (kasir + dapur): pesanan, stok, promo, Rekap Kas
- [ ] Uji offline: matikan internet → catat kas/transaksi → badge "Belum Sync" → online → data muncul di device lain
- [ ] Backup database (Supabase → Database → Backups) aktif
- [ ] Siapkan SLA/support & kontak darurat

---

## 8. Changelog Rilis

Riwayat lengkap setiap rilis — **fitur baru, perbaikan bug, dan langkah SQL yang wajib dijalankan** — ada di **[`CHANGELOG.md`](./CHANGELOG.md)**:

| Versi | Ringkasan |
|---|---|
| **v4.7** | Stabilitas stok, Stock Opname aman (mode blind + otorisasi ganda + alasan wajib), Backup & Restore lengkap + Auto Backup cloud, **Laporan PPN**, **Refund penuh**, **Struk Digital (WA/email + auto-kirim)** & **Promo/Loyalty lengkap (laporan performa, stacking/eksklusif, BOGO, batas per pelanggan, promo di struk, poin loyalty)** |
| **v4.6** | Fix Rekap Kas (Kas Masuk/Keluar) — RLS policy + offline queue + badge "Belum Sync" |
| **v4.5** | Penyimpanan IndexedDB (kuota lokal tak terbatas) + pemantapan Pending/Split |
| **v4.4** | Pending Payment (Simpan & Gantung) & Split Bill |

> **Prosedur rilis berikutnya**: tambahkan bagian baru di `CHANGELOG.md` → perbarui blok upgrade DB di §4 dokumen ini → jalankan validasi (tsc, vitest, build) → merge ke `main`.

> **Rilis v4.7**: ringkasan siap-dikirim ke klien (fitur + perbaikan + langkah SQL) ada di **[`RELEASE-v4.7.md`](./RELEASE-v4.7.md)**.

---

*Dokumen ini diperbarui untuk BerdikariPOS v4.7 (repositori: LeleTerbangJ/BerdikariPOS-Leter).*
