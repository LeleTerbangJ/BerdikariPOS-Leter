# 🧪 Panduan Tes Manual — AUDIT-OX Bagian B (T1–T10)

Panduan ini menguji eksekusi **AUDIT-OX Bagian B — Temuan & Fix TINGGI**: rollback stok delta-based (T1), split bill anti double-submit + signature (T2), Rules of Hooks Layout (T3), reset flag rekonsiliasi split pending (T4), anti bocor promo/redeem pasca-split (T5), escape path Acaraki (T6), hydrate IDB anti-wipe (T7), migration `menus.description` (T8), pre-flight restore + jejak wipe (T9), dan form Stock Opname live-sync (T10).

## 0. Persiapan

**Akun default (seed):**

| Role | Username | Password |
|---|---|---|
| Manager | `manager` | `manager123` |
| Kasir | `kasir` | `kasir123` |
| Acaraki | `acaraki` | `acaraki123` |

- PIN Manager default: **`1234`**.
- Siapkan **2 device/browser profile** (Device A = Kasir, Device B = Manager) untuk tes lintas device.
- Menu uji: siapkan minimal 2 menu dengan resep bahan baku (stok diketahui, mis. Beras 100 kg).
- Printer thermal/Bluetooth **perlu** untuk tes B (escape path Acaraki); lainnya bisa tanpa printer.
- **WAJIB (DB lama)**: jalankan SQL butir 17 di Supabase SQL Editor (lihat `DEPLOYMENT.md §4`):

```sql
ALTER TABLE menus ADD COLUMN IF NOT EXISTS description TEXT;
```

- Backup dulu data uji (**Settings → Backup**) sebelum tes H (restore).

> [!TIP] **Urutan tes disarankan**: A → B → C → D → E → F → G → H → I (≈ 30–40 menit). Validasi otomatis saat pengembangan: tsc 0 error · 653/653 test · build sukses.

---

## A. Rules of Hooks Layout — Tidak Crash Saat Sesi Berganti (T3)

1. Login Kasir di Device A → buka beberapa halaman (POS, Riwayat).
2. Logout → login lagi → ulangi 5× cepat, bergantian halaman.
3. Tes *session takeover*: login akun `kasir` JUGA di Device B → Device A harus ter-kick otomatis.
4. Perhatikan layar Device A saat kick.

**Hasil yang diharapkan**:
- ✅ TIDAK ada crash "Rendered fewer hooks than expected" / layar putih di semua siklus.
- ✅ Kick sesi tetap bekerja (toast "Akun Anda telah masuk di perangkat lain…" → redirect login).
- ✅ Sidebar/menu tampil normal setelah login ulang.

> [!NOTE] Bug ini hanya muncul saat race logout — kalau dulu pernah mengalami crash layar putih saat ganti sesi, inilah fix-nya.

---

## B. Escape Path Acaraki — Printer Gagal Saat Logout (T6)

1. Device A login **`acaraki`** → KDS → selesaikan minimal 1 pesanan (status Done).
2. **Putus koneksi printer** (matikan Bluetooth / cabut printer) — pastikan cetak akan gagal.
3. Klik **Logout** di sidebar → modal "Ringkasan Dapur" muncul (non-dismissable) → klik tombol **Cetak**.

**Hasil yang diharapkan**:
- ✅ Cetak gagal → toast kuning **"Gagal mencetak ringkasan — logout tetap dilanjutkan."**
- ✅ Acaraki **tetap ter-logout** & kembali ke halaman login (TIDAK terkunci di modal).
- ✅ Pesanan Done di KDS ter-reset (tidak menumpuk untuk tes berikutnya).
- ✅ Nyalakan printer lagi → logout Acaraki normal → ringkasan tercetak seperti biasa (jalur sukses tidak berubah).

---

## C. Split Bill Anti Double-Submit + Signature Isi Bill (T2)

1. Device A (Kasir): keranjang 2 menu berbeda → **Split Bill** (mode Equal, 2 bagian).
2. **Double-klik cepat** tombol "Bayar Sub-Bill 1".

**Hasil yang diharapkan**:
- ✅ Klik kedua diabaikan: tombol langsung **disabled** dengan label **"Memproses pembayaran…"** selama eksekusi.
- ✅ Riwayat Transaksi: hanya **SATU** sub-bill tercatat (bukan dua); stok tidak terpotong dobel.

3. Lanjutkan sampai seluruh sub-bill lunas.
4. **Tes mode switch** (sesi baru): cart baru → Split Bill → mode Equal → bayar sub-bill 1 saja → tutup modal → buka lagi → ganti ke **mode Item** → assign item → bayar.

**Hasil yang diharapkan**:
- ✅ Pembayaran mode Item diproses NORMAL — tidak salah ditolak/dianggap replay dari transaksi lama (ID memakai signature isi bill).
- ✅ Tidak ada duplikasi revenue di laporan; Σ sub-bill = total induk.

---

## D. Reset Flag Rekonsiliasi + Anti Bocor Promo/Redeem (T4 + T5)

### D1 — Split pending dibayar sebagian → tutup modal → finalisasi normal

1. Simpan **Pesanan Gantung** (mis. 2× Menu A — catat stok bahan sebelum mulai).
2. Resume pending → edit cart (tambah 1 Menu B) → **Split Bill** → bayar sub-bill 1 dari 2 → **tutup modal** (jangan selesaikan split).
3. Finalisasi sisa via checkout normal (lunasi penuh).

**Hasil yang diharapkan**:
- ✅ Stok bahan AKHIR = dasar awal − deduksi total cart aktual (Menu A×2 + Menu B×1). Tidak ada potongan ganda maupun kekurangan.
- ✅ Tidak ada toast stok negatif palsu; kartu pending wajar setelah lunas.

### D2 — Promo/redeem tidak bocor ke order berikutnya

1. Cart baru + pilih pelanggan ber-poin → terapkan **promo** dan/atau isi **tukar poin** → Split Bill → lunasi SEMUA sub-bill.
2. Setelah modal tertutup, periksa keranjang untuk order baru.

**Hasil yang diharapkan**:
- ✅ Keranjang baru **bersih**: tidak ada promo terpasang, input tukar poin kosong.
- ✅ Transaksi berikutnya tanpa promo tidak membawa atribusi promo (laporan performa promo tetap akurat).

---

## E. Rollback Delta Engine — Regresi Jalur Sukses Stok (T1)

Rollback hanya jalan saat checkout GAGAL di tengah proses (jarang terjadi alami). Fokus verifikasi bahwa refactor TIDAK mengubah jalur sukses:

1. Checkout normal 1 menu berbahan → cek Inventaris: stok terpotong tepat 1× resep; riwayat stok ada log 'deduct'.
2. Resume pending yang diedit (tambah menu) → lunasi → stok: hanya TAMBAHAN yang dipotong (delta).
3. (Opsional — melihat rollback bekerja) DevTools → Network **Offline** persis saat menekan Bayar pada kondisi yang memaksa engine gagal → toast kegagalan muncul & stok kembali persis seperti sebelum percobaan.

**Hasil yang diharapkan**:
- ✅ Semua angka stok identik dengan perilaku sebelum refaktor.
- ✅ Unit test `atomicTransactionEngine` & `transactionStockActions` lolos (653/653 saat pengembangan).

---

## F. Hydrate Antrean Offline Anti-Wipe (T7)

1. **Matikan internet** Device A → catat 2 transaksi + 1 Rekap Kas → badge "⏳ belum sinkron" muncul.
2. **Refresh browser** (F5) saat masih offline → buat 1 transaksi lagi setelah refresh.
3. **Nyalakan internet** → tunggu auto-sync (≤ 30 detik / klik banner sinkron).

**Hasil yang diharapkan**:
- ✅ SEMUA transaksi — termasuk yang dibuat SETELAH refresh — tersinkron ke Device B. Tidak ada yang hilang.
- ✅ Console bersih dari `[OfflineQueue] IDB gagal transien…` saat kondisi normal.
- ✅ (Negatif, opsional) Buka tab kedua, refresh bergantian berkali-kali saat offline → antrean tidak pernah tiba-tiba kosong sendiri.

---

## G. Migration `menus.description` (T8)

1. Edit salah satu menu → isi kolom **Deskripsi** → simpan.
2. Cek **Supabase → Table Editor → menus** → kolom `description` terisi untuk menu tsb.
3. Device B → buka Katalog → deskripsi tampil.

**Hasil yang diharapkan**:
- ✅ Deskripsi tersinkron lintas device.
- ✅ (DB lama belum ALTER) Console mencetak `[Migration] Kolom "description" belum ada…` + SQL butir 17; edit/simpan menu TETAP berhasil (field description di-skip otomatis — offline queue TIDAK menumpuk); setelah ALTER dijalankan → deskripsi ikut tersinkron.

---

## H. Pre-flight Restore + Jejak Wipe (T9 + regresi K2)

1. Buat **backup FULL** dari kondisi data uji (Settings → Backup) → unduh.
2. Restore ulang file yang sama dengan mode **Replace** → harus sukses penuh, data konsisten lintas device.
3. **Uji pre-flight**: ekstrak ZIP backup → ubah isi `users.json` menjadi teks biasa (bukan array) → zip ulang → coba restore.

**Hasil yang diharapkan**:
- ✅ Backup rusak **DITOLAK DI AWAL** dengan pesan `"Backup tidak valid: field "users" harus berupa array"` — cloud TIDAK disentuh sama sekali (data utuh di device lain).
- ✅ (Opsional — simulasi gagal tengah) Putus internet persis setelah wizard mode Replace mulai → bila gagal, pesan error menyebut daftar tabel yang sudah dikosongkan + instruksi restore ulang; restore ulang file sama → pulih sempurna.

---

## I. Form Stock Opname Live-Sync (T10)

1. Device A → **Inventaris → Stock Opname** → form terbuka (stok sistem tampil).
2. Isi **stok fisik untuk 1 item** (JANGAN simpan dulu).
3. Device B: buat 1 transaksi POS yang memotong bahan item tsb (atau Manager edit stoknya).
4. Kembali ke Device A — TANPA refresh.

**Hasil yang diharapkan**:
- ✅ Kolom **Stok Sistem** baris tsb berubah OTOMATIS mengikuti nilai terbaru.
- ✅ Input **stok fisik** milik kasir TIDAK hilang.
- ✅ Toast info: *"Stok sistem 1 item berubah selagi form terbuka — pratinjau selisih diperbarui…"* (maks 1× per 3 detik walau banyak item berubah).
- ✅ Pratinjau selisih/kerugian dihitung dari dasar TERBARU; dialog drift "Stok Berubah Sejak Form Dibuka" (guard 9.2) kini jarang muncul/false-positive hilang — tetap ada sebagai lapisan kedua.

---

## ✅ Checklist Ringkasan

| # | Tes | Pass |
|---|-----|------|
| A | Hooks — tidak crash saat race logout/kick sesi | ☐ |
| B | Acaraki — printer gagal tetap logout (escape path) | ☐ |
| C | Split bill — anti double-submit + mode switch aman | ☐ |
| D1 | Split pending sebagian → finalize normal — stok tepat | ☐ |
| D2 | Promo/redeem tidak bocor ke order berikutnya | ☐ |
| E | Rollback delta — regresi jalur sukses stok | ☐ |
| F | Offline queue — tidak ada op hilang lintas refresh | ☐ |
| G | menus.description tersinkron (+ self-heal DB lama) | ☐ |
| H | Restore — pre-flight tolak ZIP rusak SEBELUM wipe | ☐ |
| I | Opname — stok sistem live-sync + toast, input aman | ☐ |

> [!NOTE] **SQL wajib DB lama**: butir 17 (`menus.description`) — tanpa itu tes G gagal di bagian sinkronisasi (app tetap jalan, field description di-skip otomatis oleh guard).
