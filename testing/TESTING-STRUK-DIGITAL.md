# 🧪 Panduan Tes Manual — Struk Digital v4.7 (P0.4)

Panduan ini menguji fitur **Struk Digital (WhatsApp / Email)** yang ditambahkan di **v4.7 (TO DO 11.2 / P0.4)**: kirim struk dari halaman Transaksi, auto-kirim WA pasca-checkout, dan sinkronisasi pengaturan lintas device.

## 0. Persiapan

**Akun default (seed):**

| Role | Username | Password |
|---|---|---|
| Manager | `manager` | `manager123` |
| Kasir | `kasir` | `kasir123` |

**Data yang perlu disiapkan:**

- **Pelanggan CRM dengan nomor HP valid** — mis. `Budi` dengan HP `0812-3456-7890` (halaman **Pelanggan** → tambah/edit). Sebaiknya juga dengan email (mis. `budi@example.com`) untuk tes email.
- **1 pelanggan tanpa nomor HP** — untuk tes syarat auto-kirim tidak terpenuhi.
- **Beberapa menu** di katalog (mis. Es Kopi Susu 15.000, Kentang Goreng 12.000, ditambah 1 menu ber-add-on/tingkat gula/suhu untuk cek detail struk).
- **WhatsApp terpasang** di perangkat tes (aplikasi desktop/HP) **atau** akses WhatsApp Web, dan **email client** (default browser) untuk menerima deep-link `wa.me` / `mailto:`.

> [!IMPORTANT] **Sifat pengiriman**: fitur ini membuka **deep-link** (`wa.me/…?text=…` / `mailto:…`) — struk sudah terisi penuh, kasir tinggal menekan kirim di aplikasi WhatsApp/email. Bukan pengiriman server-side (broadcast otomatis tetap masuk roadmap P1 — TO DO 11.3).

> [!TIP] **Urutan tes yang disarankan**: A → B → C → D → E → F → G → H (≈ 15–20 menit).

---

## A. Kirim Struk via WhatsApp dari Halaman Transaksi

**Tujuan**: struk terkirim ke WA pelanggan dengan isi lengkap, kontak terisi otomatis dari CRM, dan tercatat di Audit Log.

1. Login sebagai **`kasir`** → buat **1 transaksi** (pilih pelanggan **Budi** di checkout — ketik `Budi` di kolom "Cari pelanggan", atau pakai tombol **"Baru"** untuk pelanggan baru) → selesaikan pembayaran.
2. Buka menu **Transaksi** → cari transaksi tadi.
3. Klik tombol **💬 Struk Digital** (hijau, di samping "Cetak Ulang").

**Hasil yang diharapkan:**
- ✅ Modal **"📱 Kirim Struk Digital #<no-antrean>"** terbuka.
- ✅ Kolom **Nomor WhatsApp** terisi otomatis `0812-3456-7890` (dari CRM) dan kolom **Email** terisi `budi@example.com`.
- ✅ **Pratinjau Struk** tampil: nama toko (uppercase), alamat, header, No. antrean, tanggal, kasir, nama pelanggan, daftar item (+add-on/suhu/gula), subtotal/diskon/pajak, TOTAL, bayar/kembali, footer.

4. Klik **Kirim WhatsApp**.

**Hasil yang diharapkan:**
- ✅ WhatsApp terbuka (app/Web) dengan **pesan struk lengkap sudah terisi** dan penerima nomor **6281234567890** (format 0xx otomatis dinormalisasi ke 62).
- ✅ Toast sukses **"Struk #<no> dibuka di WhatsApp"**, modal tertutup.
- ✅ **Audit Log** (menu **Audit Log**, role Manager) mencatat **"Kirim struk digital #<no> via WhatsApp ke <nomor>"** — action `send_digital_receipt`, channel `whatsapp`.

---

## B. Kirim Struk via Email

**Tujuan**: struk terkirim via email client dengan subject & body struk.

1. Dari halaman **Transaksi**, buka **Struk Digital** untuk transaksi lain.
2. Pastikan kolom **Email** terisi (otomatis dari CRM, atau isi manual `pelanggan@email.com`).
3. Klik **Kirim Email**.

**Hasil yang diharapkan:**
- ✅ Email client terbuka dengan **penerima terisi**, **subject** `Struk #<no> - <nama toko>`, dan **body berisi struk lengkap**.
- ✅ Toast sukses **"Struk #<no> dibuka di email client"**.
- ✅ Audit Log mencatat **"Kirim struk digital #<no> via email ke <email>"** (channel `email`).

---

## C. Validasi Nomor & Email Tidak Valid

**Tujuan**: input salah tidak membuka apa pun dan memberi pesan jelas.

1. Buka modal **Struk Digital**, ganti kolom **Nomor WhatsApp** menjadi `123` (kurang dari 9 digit) → klik **Kirim WhatsApp**.
2. Ulangi dengan kolom **Email** diisi `bukan-email` → klik **Kirim Email**.

**Hasil yang diharapkan:**
- ✅ Toast error **"Nomor WhatsApp tidak valid. Isi minimal 9 digit."** — tidak ada window terbuka, modal tetap terbuka.
- ✅ Toast error **"Alamat email tidak valid."** — tidak ada window terbuka.
- ✅ Tidak ada entri Audit Log untuk percobaan yang gagal.

**Tes normalisasi nomor (opsional)**: isi `+62 812-3456-7890` → WA harus terbuka ke `6281234567890` (spasi/tanda hubung dibuang, awalan +62 tetap).

---

## D. Auto-Kirim Struk WA Pasca-Checkout (syarat terpenuhi)

**Tujuan**: setelah checkout sukses, WhatsApp terbuka dengan struk terisi otomatis tanpa klik tambahan.

1. **Settings** → tab **General** → bagian **Pengaturan Format & Preview Struk** → aktifkan toggle **"Kirim Struk Digital Otomatis via WhatsApp"** (kotak hijau).
2. Login sebagai **`kasir`** → di **POS**, pilih pelanggan **Budi** (punya nomor valid — ketik `Budi` di kolom "Cari pelanggan") → tambah menu → **Bayar** (Cash) → konfirmasi checkout.

**Hasil yang diharapkan:**
- ✅ Setelah toast **"Transaksi #<no> berhasil! 🎉"**, jendela WhatsApp **otomatis terbuka** dengan **struk terisi lengkap** dan penerima `6281234567890`.
- ✅ Toast **"Struk #<no> dibuka di WhatsApp — tinggal kirim ke pelanggan"**.
- ✅ Tidak ada window/popup yang diblokir (window dibuka **sebelum** proses checkout — anti popup blocker).

> [!NOTE] Jika tombol checkout tidak menghasilkan window WA: cek (a) toggle masih ON, (b) pelanggan benar-benar terpilih di checkout (bukan "Tanpa Pelanggan"), (c) nomor HP ≥ 9 digit.

---

## E. Auto-Kirim Tidak Aktif Saat Syarat Tidak Terpenuhi

**Tujuan**: tidak ada window WA yang terbuka ketika fitur mati / tanpa pelanggan / nomor tidak valid.

Uji **tiga skenario** (masing-masing checkout 1 transaksi kecil):

| Skenario | Persiapan | Hasil |
|---|---|---|
| **E1. Toggle OFF** | Matikan toggle di Settings | ✅ Checkout sukses, **tidak ada** window WhatsApp |
| **E2. Tanpa pelanggan** | Toggle ON, checkout tanpa pilih pelanggan | ✅ Checkout sukses, **tidak ada** window WhatsApp |
| **E3. Nomor tidak valid** | Toggle ON, pilih pelanggan dengan nomor kosong/pendek | ✅ Checkout sukses, **tidak ada** window WhatsApp |

**Hasil yang diharapkan** (semua skenario):
- ✅ Transaksi tetap selesai normal (stok terpotong, struk cetak tetap jalan bila printer aktif).
- ✅ Tidak ada window WhatsApp, tidak ada toast struk digital.

---

## F. Tidak Ada Struk Ganda pada Replay / Double Submit

**Tujuan**: transaksi yang sudah diproses tidak mengirim struk digital dua kali.

1. Toggle auto-kirim **ON**, pelanggan dengan nomor valid.
2. Di checkout, klik tombol bayar **dua kali cepat** (atau tekan Enter ganda) sehingga engine mendeteksi idempotent replay.

**Hasil yang diharapkan:**
- ✅ Hanya **1 window WhatsApp** yang terbuka (skip `idempotentReplay` — tidak ada struk ganda).
- ✅ Toast replay: **"Transaksi #<no> sudah diproses sebelumnya."** dan **tidak ada** window WA kedua.

---

## G. Konsistensi Isi Struk dengan Pengaturan Toko

**Tujuan**: struk digital memakai pengaturan yang sama dengan struk cetak.

1. **Settings → General → Store Settings / Receipt Customization**: ubah **nama toko**, **alamat**, **header** (mis. "Terima kasih sudah order 🙏"), dan **footer** (mis. "IG: @berdikaripos").
2. Kirim struk digital (modal di Transaksi) untuk transaksi baru.

**Hasil yang diharapkan:**
- ✅ Struk digital menampilkan **nama toko (uppercase)** di baris pertama, alamat, header persis seperti di Settings, dan **footer** di bagian bawah.
- ✅ Struk yang dikirim via **WA dan email isinya identik** (sumber sama: `buildReceiptFromTransaction` + `buildReceiptText`).
- ✅ Detail item lengkap: add-on ditampilkan `+NamaAddOn`, tingkat gula `/Gula`, suhu — sesuai item yang di-order.

---

## H. Sinkronisasi Pengaturan Lintas Device

**Tujuan**: toggle auto-kirim tersinkron ke perangkat lain (satu pengaturan untuk semua kasir).

**Prasyarat (sekali, DB lama):**
```sql
ALTER TABLE settings ADD COLUMN IF NOT EXISTS auto_send_digital_receipt BOOLEAN DEFAULT FALSE;
```
(Project baru cukup `schema.sql` v4.7. Jika kolom belum ada, app otomatis mendeteksi via **Migration 21** dan mencetak SQL di console.)

1. **Perangkat A** (kasir 1): aktifkan toggle auto-kirim. Tunggu sinkron (online / refresh).
2. **Perangkat B** (kasir 2, login akun berbeda atau device lain): buka **Settings → General**.

**Hasil yang diharapkan:**
- ✅ Toggle di Perangkat B ikut **ON** (tersinkron — setting ini bukan `LOCAL_PRINTER_KEYS`, jadi ikut sync cloud, bukan per-hardware).
- ✅ Matikan di Perangkat A → setelah sync, Perangkat B ikut OFF.
- ✅ Tidak ada penumpukan antrean offline saat kolom DB belum ada (guard `syncSettings` hanya menulis bila kolom tersedia).

---

## ✅ Ringkasan Hasil yang Diharapkan

| # | Kasus | Lulus bila |
|---|---|---|
| A | Kirim WA dari Transaksi | WA terbuka + struk lengkap + audit log `whatsapp` |
| B | Kirim email | Email client terbuka + subject/body struk + audit log `email` |
| C | Nomor/email tidak valid | Toast error, tanpa window, tanpa audit log |
| D | Auto-kirim pasca-checkout | Window WA terbuka otomatis + struk terisi |
| E | Auto-kirim syarat gagal (E1/E2/E3) | Tidak ada window WA, transaksi tetap normal |
| F | Double submit | Hanya 1 struk, toast replay, tanpa WA kedua |
| G | Konsistensi Settings | Nama/alamat/header/footer ikut struk, WA=email |
| H | Sync lintas device | Toggle tersinkron A↔B, tanpa penumpukan queue |

**Catatan jujur**: pengiriman masih berbasis **deep-link** (`wa.me`/`mailto`) — struk terisi penuh dan tinggal dikirim manual di aplikasi WA/email. Broadcast/pengiriman otomatis server-side memerlukan WA Gateway API dan tercatat sebagai **P1 (TO DO 11.3)**.
