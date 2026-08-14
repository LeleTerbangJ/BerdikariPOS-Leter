# 🧪 Panduan Tes Manual — Fitur "Semua Dapur" (Cetak ke Semua Target Dapur) v4.7 (Prioritas 16.2)

Panduan ini memverifikasi opsi **"Semua Dapur"** di form **Edit Menu**: menu yang diatur ke "Semua Dapur" mencetak **tiket dapurnya ke semua printer dapur yang aktif** (bukan satu target saja). Ikuti urutan A → B → C → D (≈ 15–20 menit). Berlaku untuk device **Manager/Kasir** (mengatur menu & checkout) dan **Dapur/KDS** (menerima tiket).

## 0. Persiapan

- Login sebagai **Manager** (akun seed: `manager`/`manager123`) — hanya Manager yang membuka **Menu/Katalog**.
- **Setup 2 printer dapur dengan target berbeda** di **Settings → Printer → "Tambah Printer Dapur"**:
  - Printer **"Dapur Makanan"** → Target Dapur: `Makanan` → aktif.
  - Printer **"Dapur Minuman"** → Target Dapur: `Minuman` → aktif.
  - (Bisa juga memakai **Tipe = Browser Print** agar mudah diuji tanpa Bluetooth — tiket muncul di dialog cetak browser.)
- Pastikan tiap printer **Test Print** berhasil dan statusnya **aktif (enabled)**.
- Buka halaman **Menu/Katalog** dan siapkan 1 menu (mis. **"Nasi Goreng Spesial"**) dengan **kategori menu `Lainnya`** (kategori yang tidak cocok dengan target `Makanan`/`Minuman` — untuk membuktikan tetap tercetak di semua dapur).

> [!NOTE] **Ruang lingkup**: fitur ini hanya memengaruhi **routing tiket dapur** saat checkout/simpan pesanan. Struk kasir, tiket dapur target spesifik, dan print ulang manual **tidak berubah**.

---

## A. Atur Menu di Edit Menu

**Tujuan**: menu bisa diatur ke "Semua Dapur" dan nilai tersimpan dengan benar.

1. Menu/Katalog → klik **✏️ Edit** pada menu yang disiapkan (mis. "Nasi Goreng Spesial").
   **Hasil yang diharapkan**: ✅ Form Edit Menu terbuka.
2. Pada bagian **Target Dapur (kitchen target)**, pilih opsi **"Semua Dapur (Cetak ke Semua Printer Dapur)"**.
   **Hasil yang diharapkan**: ✅ Opsi tersedia (urutan: "Sama dengan Kasir (Tanpa Split)" → "Semua Dapur…" → daftar target spesifik seperti `Makanan`/`Minuman`).
3. Klik **Simpan**.
   **Hasil yang diharapkan**: ✅ Toast sukses; di **daftar menu**, badge kolom Target Dapur menampilkan **"Semua Dapur"** (bukan "ALL" mentah).
4. Buka menu tersebut lagi (**Edit**).
   **Hasil yang diharapkan**: ✅ Select tetap menampilkan **"Semua Dapur"** (nilai tersimpan persisten).

**Hasil akhir A**: ✅ Menu tersimpan dengan target "Semua Dapur" dan tampil sebagai **"Semua Dapur"** di daftar menu.

---

## B. Tiket Keluar di Semua Printer Dapur

**Tujuan**: saat checkout, item menu "Semua Dapur" dicetak sebagai tiket dapur di **setiap printer dapur aktif**.

1. Buka **POS** → tambahkan **"Nasi Goreng Spesial"** (target "Semua Dapur") ke keranjang.
   **Hasil yang diharapkan**: ✅ Badge item di keranjang menampilkan **"Semua Dapur"**.
2. Selesaikan pembayaran (checkout normal, **"Cetak tiket dapur"** tetap tercentang).
3. Periksa hasil cetak:
   - **Dapur Makanan**: ✅ menerima tiket berisi "Nasi Goreng Spesial".
   - **Dapur Minuman**: ✅ menerima tiket berisi "Nasi Goreng Spesial" juga.
   - (Bila Tipe = Browser Print: muncul **dua dialog cetak** — satu per printer.)
4. Periksa **halaman Kitchen/Dapur (KDS)**:
   **Hasil yang diharapkan**: ✅ Pesanan tampil di antrean KDS; tidak ada tiket yang hilang.

**Hasil akhir B**: ✅ Satu menu "Semua Dapur" menghasilkan tiket di **semua** printer dapur aktif.

---

## C. Kontrol: Menu Target Spesifik Tetap Satu Printer

**Tujuan**: memastikan perilaku lama tidak berubah — menu dengan target spesifik hanya dicetak di printer tersebut.

1. Menu/Katalog → Edit menu lain (mis. **"Es Teh Manis"**) → Target Dapur pilih **`Minuman`** → Simpan.
2. POS → checkout dengan "Es Teh Manis".
3. Periksa hasil cetak:
   - **Dapur Minuman**: ✅ menerima tiket "Es Teh Manis".
   - **Dapur Makanan**: ❌ **TIDAK** menerima tiket (no-op — tidak ada dialog cetak kedua).

**Hasil akhir C**: ✅ Target spesifik tetap mengarah ke satu printer saja; fitur "Semua Dapur" tidak mengubahnya.

---

## D. Kasus Khusus & Persistensi

**Tujuan**: memverifikasi konsistensi lintas jalur (split bill, import CSV, lintas device).

1. **Split Bill**: buat pesanan dengan menu "Semua Dapur", lalu **Split Bill** (mode apa pun).
   **Hasil yang diharapkan**: ✅ Tiket dapur lengkap tetap keluar di **semua** printer dapur saat sub-bill pertama fresh (tiket tidak hilang karena split).
2. **Simpan Pending**: buat pesanan "Semua Dapur" → **Simpan Pending**.
   **Hasil yang diharapkan**: ✅ Tiket dapur keluar di semua printer dapur saat pesanan disimpan (sesuai pengaturan cetak tiap jalur).
3. **Import CSV** (opsional): export CSV katalog → kolom `kitchenTarget` berisi **`ALL`** → import ulang.
   **Hasil yang diharapkan**: ✅ Menu hasil import tetap menampilkan **"Semua Dapur"** (nilai `ALL` round-trip aman).
4. **Lintas device** (opsional): device lain membuka Menu/Katalog setelah refresh.
   **Hasil yang diharapkan**: ✅ Badge "Semua Dapur" tersinkron dari cloud (kolom `kitchen_target` TEXT).

**Hasil akhir D**: ✅ Perilaku konsisten di split bill, pending, import CSV, dan lintas device.

---

## Ringkasan Hasil

| Tahap | Yang diverifikasi | Hasil |
|-------|-------------------|-------|
| A | Opsi "Semua Dapur" di Edit Menu + tersimpan + badge daftar menu | ☐ |
| B | Tiket keluar di **semua** printer dapur aktif saat checkout | ☐ |
| C | Menu target spesifik tetap dicetak hanya di 1 printer | ☐ |
| D | Konsisten di split bill / pending / import CSV / lintas device | ☐ |

> Jika semua tahap ☐ ✅, fitur "Semua Dapur" siap dipakai di lapangan. Jika ada yang gagal, catat langkah + pesan toast/error + isi Console (F12), lalu laporkan ke tim pengembangan (detail teknis di `AI-HANDOFF.md` §21 & `TO DO.md` Prioritas 16.2).

---

*Panduan lain: [`TESTING-PRINTER.md`](./TESTING-PRINTER.md) (printer thermal & split printer), [`TESTING-CETAK-TANPA-STRUK.md`](./TESTING-CETAK-TANPA-STRUK.md) (opsi cetak tanpa struk), [`TESTING-PRADEPLOY.md`](./TESTING-PRADEPLOY.md) (verifikasi pra-deploy), [`TESTING-DEMO-SALES.md`](./TESTING-DEMO-SALES.md) (demo penjualan), [`TESTING-OPNAME.md`](./TESTING-OPNAME.md) (stock opname), [`TESTING-OFFLINE.md`](./TESTING-OFFLINE.md) (mode offline), [`TESTING-STRUK-DIGITAL.md`](./TESTING-STRUK-DIGITAL.md) (struk WA/email).*
