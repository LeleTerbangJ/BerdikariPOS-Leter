# 🧪 Panduan Tes Manual — Stock Opname v4.7

Panduan ini menguji fitur opname yang diperbaiki di **v4.7 (Prioritas 10)**: mode blind, otorisasi ganda (quick-login Manager), alasan wajib pasca-PIN, clamp stok negatif, dan guard race lintas device.

## 0. Persiapan

**Akun default (seed):**

| Role | Username | Password |
|---|---|---|
| Manager | `manager` | `manager123` |
| Kasir | `kasir` | `kasir123` |
| Acaraki | `acaraki` | `acaraki123` |
| Staf Gudang | `gudang` | `gudang123` |

- PIN Manager default: **`1234`** (bisa diubah di Settings → Keamanan).
- Pastikan **akun Manager tersinkron** ke perangkat yang dipakai Staf Gudang (jika tidak ada, quick-login tidak bisa — login Manager sekali di perangkat itu dulu).
- Siapkan 2–3 bahan baku di Inventory dengan stok diketahui (mis. Beras 100 kg, Gula 50 kg, Kopi 20 kg).

> [!TIP] **Urutan tes yang disarankan**: A → B → C → D → E → F → G → H (≈ 15–20 menit).

---

## A. Alur Mode Blind (Staf Gudang) — 10.1

**Tujuan**: memastikan Staf Gudang tidak melihat stok sistem/selisih/kerugian dan tidak ada "oracle ±10%".

1. Login sebagai **`gudang` / `gudang123`** → halaman Inventory → **Stock Opname**.
2. **Harus muncul** banner kuning **"Mode Stock Opname Buta"**.
3. Kartu ringkasan: "Item Selisih" dan "Estimasi Kerugian" menampilkan **🔒 Sembunyi (Opname Buta)** — bukan angka.
4. Di tabel: kolom **Stok Sistem** = `🔒 ***`, kolom **Selisih** dan **Kerugian** = `—`.
5. Isi stok fisik Beras = **95** (stok sistem 100) → tombol **Simpan Opname**.

**Hasil yang diharapkan**:
- ✅ Banner **"Selisih Besar Terdeteksi"** **TIDAK muncul** (dulu muncul → bocor info bahwa selisih ≥ 10%).
- ✅ Langsung muncul modal **"Otorisasi Manager"** — judul generik, tanpa kata "Selisih Besar".
- ✅ Tidak ada dialog konfirmasi terpisah sebelum PIN (jalur seragam — tidak ada sinyal diferensial).

---

## B. Quick-Login Manager di Sesi Staf Gudang — 10.2

**Tujuan**: staf tidak bisa menyetujui sendiri; Manager harus login cepat dengan akunnya.

1. Lanjut dari tes A (masih sesi `gudang`, modal "Otorisasi Manager" terbuka).
2. **Harus tampil form login**: *Username Manager* + *Password Manager* (bukan kolom PIN).
3. Isi `manager` / `manager123` → klik **Otorisasi**.

**Hasil yang diharapkan**:
- ✅ Approval diterima (muncul langkah berikutnya — lihat tes D).
- ✅ Sesi tetap sebagai `gudang` (staff tetap tercatat sebagai petugas penginput; tidak "terlempar" ke sesi Manager).

---

## C. Penolakan Akun Non-Manager — 10.2 (role-gate)

**Tujuan**: Kasir/Acaraki/Staf Gudang tidak bisa menyetujui walau kredensialnya benar; PIN global tidak cukup.

1. Di modal "Otorisasi Manager" (sesi `gudang`), isi kredensial **`kasir` / `kasir123`** → **Otorisasi**.
2. **Hasil**: error merah **"Username atau password salah, atau akun bukan Manager."** — tidak ada aksi.
3. Coba username salah (`admin` / apa pun) → error yang sama.
4. **Catatan penting**: di sesi staf, **tidak ada kolom PIN** sama sekali — PIN Manager `1234` tidak bisa dipakai untuk menyetujui. (Sebelum v4.7, siapa pun yang tahu PIN bisa menyetujui.)

**Hasil yang diharapkan**: ✅ Semua percobaan di atas ditolak tanpa efek samping.

---

## D. Alasan Penyesuaian Wajib Setelah PIN Disetujui — 10.3

**Tujuan**: staf tidak bisa menyimpan selisih tanpa alasan; jejak audit kerugian lengkap.

1. Setelah approval Manager sukses (tes B), **harus muncul** dialog **"Alasan Penyesuaian (Wajib)"**.
2. Dialog menampilkan: *"PIN Manager disetujui. **N** item memiliki selisih stok."* — hanya jumlah, **tanpa nama item/nominal** (blind mode tetap aman).
3. Tombol **"Eksekusi Opname"** dalam keadaan **nonaktif** sampai alasan dipilih.
4. Klik **Batal** → tidak ada yang tersimpan (data opname batal, stok tidak berubah). Coba lagi sampai langkah 5.
5. Pilih alasan (mis. **Penyusutan**) → opsional isi detail → **Eksekusi Opname**.
6. Muncul alert "✅ Stock Opname berhasil disimpan".

**Verifikasi jejak audit**:
- Buka tab **Riwayat** (halaman Stock Opname) → record baru menampilkan **"✓ Disetujui Admin Manager"** (nama approver, bukan "PIN Verified" generik).
- Muncul baris **"Alasan penyesuaian: Penyusutan"**.
- Buka **Audit Log** → entri `stock_opname` berisi **"Disetujui oleh Admin Manager"** + metadata approver.

---

## E. Clamp Stok Negatif / NaN — 10.4

**Tujuan**: stok fisik negatif/NaN tidak pernah masuk ke inventory.

1. Login sebagai `manager` (atau `gudang`) → Stock Opname → isi stok fisik Beras = **`-5`**.
2. Perhatikan kolom **Selisih/Kerugian**: dihitung dari **0** (bukan -5) — pratinjau konsisten dengan nilai yang akan disimpan.
3. Simpan (jalur Manager, PIN `1234`; atau jalur staf + approval).
4. Cek **Inventory → Beras**: stok menjadi **0**, **tidak pernah negatif**.
5. Uji juga nilai `0` (tetap 0) dan angka normal `12.5` (tetap 12.5).

**Hasil yang diharapkan**: ✅ Tidak ada stok negatif di inventory dalam kondisi apa pun.

---

## F. Sesi Manager Langsung (Jalur PIN) — 10.2

**Tujuan**: Manager yang sudah login tetap memakai jalur PIN cepat (tanpa quick-login).

1. Login sebagai **`manager`** → Stock Opname → isi selisih besar (mis. Beras 100 → 50).
2. Klik Simpan → modal otorisasi menampilkan **kolom PIN** (bukan form login).
3. Masukkan PIN salah (`0000`) → **"PIN salah. Coba lagi."**
4. Masukkan PIN benar (**`1234`**) → opname tersimpan.

**Verifikasi**: riwayat menampilkan **"✓ Disetujui Admin Manager"** — identitas approver = sesi Manager saat itu.

---

## G. Alur Non-Staff dengan Selisih Kecil — 9.2/10.3 (regresi)

1. Login sebagai `manager` → isi selisih **kecil** (mis. Gula 50 → 49,9) → Simpan.
2. **Harus muncul** dialog **"Konfirmasi Stock Opname"** biasa (tanpa PIN — selisih kecil tidak butuh otorisasi).
3. Coba simpan dengan selisih **tanpa alasan** → alert **"N item dengan selisih belum diisi alasannya"** (alasan per-item wajib untuk non-staff).
4. Pilih alasan di baris → konfirmasi → tersimpan.

---

## H. Guard Race Lintas Device — 9.2

**Tujuan**: stok yang berubah di perangkat lain sejak form dibuka tidak ditimpa diam-diam.

1. Buka Stock Opname di **perangkat A** (form terbuka, stok sistem tercatat).
2. Di **perangkat B** (atau perangkat yang sama via menu lain), buat transaksi yang mengurangi stok Beras (mis. 100 → 90).
3. Kembali ke perangkat A → isi stok fisik Beras → Simpan.
4. **Harus muncul** dialog **"⚠️ Stok Berubah Sejak Form Dibuka"** (untuk staff: pesan generik tanpa angka stok).
5. Klik **Lanjutkan** → opname menulis stok fisik (dengan kesadaran penuh). Klik **Batal** → tidak ada yang di-commit.

---

## ✅ Ringkasan Hasil yang Diharapkan

| # | Tes | Kriteria lulus |
|---|---|---|
| A | Blind mode | Banner buta tampil; stok/selisih/kerugian disembunyikan; tanpa banner "Selisih Besar"; judul modal generik |
| B | Quick-login Manager | Form username+password; approval sukses; sesi tetap staf |
| C | Penolakan non-Manager | Kasir/Acaraki/staf & username salah ditolak; tidak ada jalur PIN di sesi staf |
| D | Alasan wajib | Dialog wajib muncul pasca-PIN; tombol nonaktif tanpa alasan; riwayat/audit menampilkan approver + alasan |
| E | Clamp negatif | `-5` → 0 di inventory; pratinjau konsisten |
| F | Manager langsung | Jalur PIN; PIN salah ditolak; identitas approver tercatat |
| G | Selisih kecil non-staff | ConfirmDialog biasa; alasan per-item wajib |
| H | Guard race | Dialog peringatan muncul; batal = aman |

> [!NOTE] **Syarat cloud (jika menguji lintas device)**
> Jalankan dulu SQL kolom otorisasi opname di Supabase SQL Editor (butir 8 di `DEPLOYMENT.md` §4), supaya record approver tersinkron ke device lain:
> ```sql
> ALTER TABLE stock_opnames ADD COLUMN IF NOT EXISTS approver_id TEXT;
> ALTER TABLE stock_opnames ADD COLUMN IF NOT EXISTS approver_name TEXT;
> ALTER TABLE stock_opnames ADD COLUMN IF NOT EXISTS approver_role TEXT;
> ALTER TABLE stock_opnames ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
> ALTER TABLE stock_opnames ADD COLUMN IF NOT EXISTS device_id TEXT;
> ALTER TABLE stock_opnames ADD COLUMN IF NOT EXISTS adjustment_reason TEXT;
> ```
