# 🚀 Panduan Deployment & Komersialisasi — BerdikariPOS v4.2

## Status: ✅ PRODUCTION LIVE
- **Hosting**: Vercel (auto-deploy)
- **Database**: Supabase (PostgreSQL + Real-time)
- **Repository**: https://github.com/Lemillion-base/rempah-story-pos
- **CI/CD**: Push ke GitHub → Vercel auto-build & deploy (1-2 menit)

## Daftar Isi
1. [Apakah Harus Produksi Dulu?](#1-apakah-harus-produksi-dulu)
2. [Cara Deploy ke Produksi](#2-cara-deploy-ke-produksi)
3. [Setup untuk Setiap Klien Baru](#3-setup-untuk-setiap-klien-baru)
4. [Model Bisnis & Pricing](#4-model-bisnis--pricing)
5. [Panduan Pemakaian untuk Klien](#5-panduan-pemakaian-untuk-klien)
6. [Checklist Sebelum Jual](#6-checklist-sebelum-jual)

---

## 1. Apakah Harus Produksi Dulu?

**✅ SUDAH PRODUCTION.** Aplikasi sudah live di Vercel dengan:
- HTTPS otomatis
- Cloud database (Supabase) aktif
- Real-time sync antar device berfungsi (100% coverage — semua tabel)
- PWA installable
- Full cloud sync: delete propagation, fullSync mode, 16 data types
- Background Printer Connection Monitor dengan status banner & 1-click reconnect

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

Setiap kali ada perubahan kode, cukup push ke GitHub:

```bash
cd "d:\Private File\Aba\VibeCoding\Aplikasi\rempah-story-pos"
git add .
git commit -m "deskripsi perubahan"
git push origin main
```

Vercel otomatis detect push dan re-deploy dalam 1-2 menit. Tidak perlu setup ulang.

### Jika Perlu Tambah/Ubah Environment Variables:
1. Buka https://vercel.com → pilih project
2. Settings → Environment Variables
3. Edit/tambah variabel
4. Klik "Redeploy" di tab Deployments

---

## 3. Setup untuk Setiap Klien Baru

Setiap klien (toko) yang beli aplikasi Anda perlu:

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

### Setup Cepat untuk 1 Klien Baru:
1. Buat Supabase project baru (gratis)
2. Jalankan `supabase/schema.sql` di SQL Editor.
   > [!NOTE]
   > Jika meng-upgrade database klien lama ke versi 4.2, jalankan perintah berikut di SQL Editor Supabase untuk mendukung fitur Pengaturan Pajak (PB1/PPN), Rekap Kas (Kas Masuk/Keluar), Fitur Meja, dan Bluetooth Printer Monitor:
   > ```sql
   > -- 1. Pengaturan Pajak & Fitur Meja
   > ALTER TABLE settings ADD COLUMN IF NOT EXISTS tax_enabled BOOLEAN DEFAULT FALSE;
   > ALTER TABLE settings ADD COLUMN IF NOT EXISTS table_features JSONB DEFAULT '{"enabled": false, "tables": ["Meja 1", "Meja 2", "Meja 3", "Meja 4", "Meja 5"]}';
   > 
   > -- 2. Detail Transaksi (Tipe Pesanan, Meja, Pajak)
   > ALTER TABLE transactions ADD COLUMN IF NOT EXISTS order_type TEXT DEFAULT 'Dine In';
   > ALTER TABLE transactions ADD COLUMN IF NOT EXISTS table_number TEXT;
   > ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tax INT DEFAULT 0;
   > 
   > -- 3. Tabel Rekap Kas (Kas Masuk & Kas Keluar)
   > CREATE TABLE IF NOT EXISTS cash_movements (
   >   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
   >   shift_id TEXT,
   >   type TEXT NOT NULL CHECK (type IN ('in', 'out')),
   >   amount FLOAT NOT NULL DEFAULT 0,
   >   category TEXT NOT NULL,
   >   notes TEXT,
   >   cashier_id TEXT,
   >   cashier_name TEXT NOT NULL,
   >   date TIMESTAMPTZ DEFAULT now(),
   >   created_at TIMESTAMPTZ DEFAULT now()
   > );
   > 
   > -- 4. Blok Aman untuk Realtime Publication
   > DO $$
   > BEGIN
   >   ALTER PUBLICATION supabase_realtime ADD TABLE cash_movements;
   > EXCEPTION WHEN duplicate_object THEN NULL;
   > END $$;
   > ```

---

## 4. Model Bisnis & Pricing

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

## 5. Panduan Pemakaian untuk Klien

### Dokumen yang Perlu Anda Siapkan:

#### A. Quick Start Guide (1 halaman)
```
PANDUAN CEPAT — [Nama Toko] POS

1. Buka [URL] di browser Chrome
2. Login:
   - Manager: [username] / [password]
   - Kasir: [username] / [password]  
   - Acaraki: [username] / [password]
   - Staf Gudang: [username] / [password]

3. Kasir: Buka shift → Buat pesanan → Bayar → Tutup shift
4. Acaraki: Lihat pesanan → Proses → Selesai
5. Manager: Lihat laporan, kelola menu, atur promo, atur pajak
6. Gudang: Stock opname mode blind

Butuh bantuan? Hubungi: [WA Anda]
```

---

## 6. Checklist Sebelum Jual

### ✅ Teknis (DONE)
- [x] Deploy ke Vercel (production URL aktif)
- [x] HTTPS aktif (otomatis di Vercel)
- [x] Cloud sync berfungsi (Supabase real-time — 100% coverage)
- [x] Background service Printer Connection Monitor + UI Status Banner
- [x] Revert stok & data customer otomatis saat transaksi dihapus
- [x] Modul Rekap Kas (Kas Masuk & Kas Keluar) + Shift breakdown
- [x] Pengaturan Pajak (PB1/PPN) toggle on/off + preset %
- [x] PWA installable
- [x] Password hashing (bcrypt)
- [x] Error boundary (crash handling)
- [x] Code-splitting (fast load)
- [x] Restriksi Multi-login Device (satu session aktif per user)

---

*Dokumen ini diperbarui untuk BerdikariPOS v4.2.*
