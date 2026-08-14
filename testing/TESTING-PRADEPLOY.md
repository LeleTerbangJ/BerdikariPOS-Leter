# 🧪 Panduan Tes Manual — Verifikasi Pra-Deploy v4.7

Checklist ini memverifikasi kesiapan **sebelum serah terima ke klien** (dari `DEPLOYMENT.md`): migrasi SQL butir 8–11, bucket Auto Backup, sinkronisasi 2 device, dan alur offline. Ikuti urutan A → B → C → D → E (≈ 30–45 menit).

## 0. Persiapan

- Akses ke **Supabase Dashboard** project klien (SQL Editor + Storage) dengan role `postgres`/owner.
- **2 perangkat** dengan aplikasi terpasang & login: perangkat Kasir + perangkat Manager/Dapur.
- Koneksi internet stabil di kedua perangkat (kecuali saat tes offline D).
- Akun default seed: Manager `manager`/`manager123`, Kasir `kasir`/`kasir123` (PIN Manager `1234`).

> [!TIP] Jika aplikasi sudah dibuka dan ada kolom yang kurang, **console browser (F12)** otomatis mencetak SQL perbaikannya (Migration 19–26). SQL di bawah adalah versi lengkapnya — jalankan sekali di SQL Editor.

---

## A. Migrasi Database (butir 8–11) — WAJIB

**Tujuan**: memastikan semua kolom v4.7 ada sehingga fitur baru berjalan dan offline queue tidak menumpuk.

1. Buka **Supabase → SQL Editor**, jalankan blok upgrade v4.7 dari `DEPLOYMENT.md` §4 (butir 1–11) — atau minimal butir berikut:
   - **Butir 8** — kolom otorisasi opname di `stock_opnames` (approver_id/name/role, approved_at, device_id, adjustment_reason).
   - **Butir 9** — kolom refund di `transactions` (refunded, refunded_at, refunded_amount, refund_note, refunded_by_id, refunded_by_name).
   - **Butir 10** — `auto_send_digital_receipt` di `settings`.
   - **Butir 11** — kolom promo/loyalty: `promo_name`/`promo_amount` di `transactions`; `stackable`, `bogo_config`, `min_qty`, `usage_limit_per_customer`, `usage_by_customer` di `promos`; `loyalty_points` di `customers`; + relaksasi CHECK `promos.type` agar menerima `'bogo'`.
2. **Verifikasi** (opsional, di SQL Editor):
   ```sql
   SELECT column_name FROM information_schema.columns WHERE table_name = 'stock_opnames' AND column_name LIKE 'approver%';
   SELECT column_name FROM information_schema.columns WHERE table_name = 'promos' AND column_name IN ('stackable','bogo_config','min_qty','usage_limit_per_customer','usage_by_customer');
   SELECT column_name FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'loyalty_points';
   ```
   **Hasil yang diharapkan**: ✅ Semua kolom muncul; query tidak error.

3. Buka aplikasi di perangkat Kasir → buka console browser (F12) → **tidak ada** pesan migrasi merah (Migration 19–26 semuanya sudah "OK/terpenuhi").

**Hasil akhir A**: ✅ Semua kolom ada, aplikasi tidak mencetak SQL perbaikan.

---

## B. Bucket Auto Backup (Opsional) — §4b

**Tujuan**: memastikan Auto Backup ke cloud bisa berjalan (hanya jika klien memakai destinasi "Supabase Cloud Storage").

1. Di **Supabase → Storage**, pastikan bucket `backups` ada (bukan public).
2. Jika belum, jalankan SQL §4b (INSERT bucket + 2 policy anon) di SQL Editor.
3. Di aplikasi: **Settings → Backup → Auto Backup** → aktifkan, pilih **"Supabase Cloud Storage"**, atur jadwal (mis. Daily, 00:00).
4. Tunggu jadwal atau naikkan jam target ke beberapa menit berikutnya → tunggu **≤ 5 menit**.

**Hasil yang diharapkan**:
- ✅ Tidak ada error upload; di **Supabase → Storage → backups** muncul file `.json` baru.
- ✅ `lastAutoBackupAt` tercatat di Settings → Backup (keterangan "Backup terakhir: …").
- ⚠️ Jika gagal: app mencetak SQL bucket di console dan **mencoba lagi otomatis 5 menit kemudian** — periksa SQL sudah dijalankan.

**Hasil akhir B**: ✅ Backup cloud berhasil (atau sengaja dilewati — klien hanya pakai Local Download).

---

## C. Sinkronisasi 2 Device (Kasir + Dapur/Manager)

**Tujuan**: memastikan data mengalir dua arah antar perangkat — pesanan, stok, promo, Rekap Kas, pelanggan.

1. **Device 1 (Kasir)** buat data baru:
   - Tambah 1 menu + 1 bahan baku di Inventory (atau ubah harga/stock).
   - Buat **promo** baru (mis. BOGO "Beli 2 Gratis 1") di Promo & Loyalty.
   - Tambah 1 **pelanggan** baru (bisa langsung dari POS via tombol **"Baru"** di keranjang — tidak perlu ke halaman Pelanggan).
2. **Device 2 (Dapur/Manager)**: refresh / buka halaman terkait.
   **Hasil yang diharapkan**: ✅ Menu baru, stok, promo, dan pelanggan **muncul di device 2** (tanpa restart berulang).
3. **Device 2 (Dapur)** proses pesanan → **Device 1 (Kasir)** cek halaman Transaksi.
   **Hasil yang diharapkan**: ✅ Pesanan tampil; stok bahan di kedua device berkurang sama.
4. **Rekap Kas lintas device**: di Device 1 (Kasir) catat **Kas Masuk 50.000** (menu Rekap Kas) → di Device 2 (Manager) buka **Laporan Shift** → Rekap Laci Kas.
   **Hasil yang diharapkan**: ✅ Kas Masuk 50.000 tampil di laporan Manager (ini regresi fix RLS v4.6 — harus selalu lolos).
5. **Promo lintas device**: device 1 buat promo, device 2 cek daftar promo & coba pakai di POS → diskon berjalan (termasuk BOGO & poin loyalty bila diuji).

**Hasil akhir C**: ✅ Semua data sinkron dua arah; stok konsisten; Rekap Kas tidak pernah hilang.

---

## D. Uji Offline (Anti-Gagal Saat Internet Putus)

**Tujuan**: memastikan transaksi tetap jalan saat offline dan tersinkron otomatis saat online.

> 📖 **Uji offline lengkap** (antrean IndexedDB, retry 30 dtk, failed-ops list, badge "Belum Sync" per transaksi, banner offline/cold start, konflik stok, PWA offline): **[`TESTING-OFFLINE.md`](./TESTING-OFFLINE.md)** — tahap A–F. Di bawah ini **smoke test ringkas** (≈ 5 menit) yang cukup untuk verifikasi pra-deploy.

1. **Device 1 (Kasir)**: matikan internet (airplane mode / cabut Wi-Fi).
2. Buat **transaksi** (Selesai) dan catat **Kas Masuk/Keluar** di Rekap Kas.
   **Hasil yang diharapkan**: ✅ Transaksi sukses; di halaman Transaksi/Rekap Kas muncul badge **"Belum Sync"** di item baru; banner **"Offline — data tersimpan lokal, akan tersinkron otomatis"** tampil di atas konten (semua device/role, termasuk mobile).
3. Nyalakan kembali internet → tunggu **≤ 30–40 detik** (auto-retry berkala — tidak perlu tombol manual).
   **Hasil yang diharapkan**: ✅ Badge "Belum Sync" & banner hilang otomatis; di **Device 2** data muncul setelah refresh.
4. **Uji pesanan gantung**: offline → Simpan Pending → **tutup aplikasi** → buka lagi (offline) → online → resume/lunasi → tidak ada transaksi ganda (idempotency) — sekaligus membuktikan antrean tersimpan di IndexedDB (tidak hilang saat aplikasi ditutup).
5. Periksa **offline queue** tidak menumpuk: console browser tanpa error berulang setelah online; bila ada operasi gagal permanen, badge merah `N!` + banner "N operasi gagal sinkron" muncul (bukan data hilang diam-diam) — detail pemulihannya di `TESTING-OFFLINE.md` tahap C.

**Hasil akhir D**: ✅ Transaksi & Rekap Kas offline tersinkron otomatis, tanpa duplikat; antrean bertahan saat aplikasi ditutup.

---

## E. Final Checks Sebelum Serah Terima

- [ ] **Ganti password default** semua akun (Manager, Kasir, Gudang, dll.) — jangan tinggalkan `manager123`.
- [ ] Supabase project menggunakan **env vars klien yang benar** (bukan milik developer).
- [ ] **Backup database aktif** di Supabase (Database → Backups) — selain fitur Backup app.
- [ ] Auto Backup app dikonfigurasi (lokal **atau** cloud) sesuai kesepakatan klien.
- [ ] Konsol browser kedua device **bebas error migrasi** (Migration 19–26).
- [ ] Versi aplikasi = **v4.7** (tampil di halaman About/Settings).

---

## Ringkasan Hasil

| Tahap | Area | Status |
|---|---|---|
| A | Migrasi SQL butir 8–11 | ☐ |
| B | Bucket backups + Auto Backup cloud (opsional) | ☐ / N/A |
| C | Sync 2 device (pesanan, stok, promo, Rekap Kas) | ☐ |
| D | Uji offline (badge Belum Sync → sync otomatis) | ☐ |
| E | Final checks (password, env, backup DB) | ☐ |

> Jika semua tahap ☐ ✅, aplikasi **siap serah terima**. Jika ada yang gagal, catat langkah yang gagal + pesan error, lalu laporkan ke tim pengembangan (detail teknis di `DEPLOYMENT.md` & `AI-HANDOFF.md`).
