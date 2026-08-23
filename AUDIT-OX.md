# 🔍 AUDIT-OX.md — Laporan Audit & Rencana Perbaikan Aman

> **Project**: BerdikariPOS v4.8.3
> **Tanggal audit**: 22 Agustus 2026
> **Metode**: Audit statis read-only (4 area: core engine/sync, halaman UI, stores/utils, keamanan/schema). Tidak ada kode diubah saat audit.
> **Status validasi saat audit**: `npx tsc --noEmit` = 0 error · `vitest run` = 633/633 lolos · build sukses

## ⚠️ Prinsip Perbaikan Dokumen Ini

Semua solusi di bawah dipilih dengan kriteria **paling aman, tepat, dan efisien**:

1. **Additive-first** — tambah guard/parameter/kolom, bukan menulis ulang jalur yang sudah berjalan.
2. **Tidak menyentuh kontrak data** — tidak mengubah localStorage keys, nama kolom DB, atau shape interface yang sudah dipakai user produksi (sesuai aturan `AI-HANDOFF.md §5`).
3. **Fail-safe, bukan fail-silent** — perubahan hanya mempersempit kondisi gagal; jalur normal tidak berubah perilaku.
4. **Satu temuan = satu patch terisolasi** — mudah di-review, mudah di-revert.
5. Setiap item mencantumkan **langkah verifikasi** wajib sebelum merge.

---

# BAGIAN A — TEMUAN & FIX KRITIS

---

## K1. 🔴 Redeem poin loyalty tampil di preview tapi tidak di-commit ke transaksi

| | |
|---|---|
| **Lokasi** | `src/pages/POS.tsx:884`, `src/utils/discountEngine.ts:42-80` |
| **Akar masalah** | Preview & tombol bayar memakai `finalTotal` yang MENYERTAKAN diskon redeem poin (`POS.tsx:1163-1168`), tetapi `finalizeTransaction` menghitung `totalDiscount` dari `discountCalc.totalDiscount` saja — `discountEngine` tidak pernah menerima `redeemDiscount`. `handleSavePending` (`POS.tsx:269`) memakai rumus yang benar → ada 3 jalur rumus total yang tidak konsisten. |
| **Dampak** | Transaksi tercatat **lebih besar dari nominal yang dibayar**; poin pelanggan tetap terpotong; laporan P&L, promo report, dan expected cash tutup shift meleset setiap kali kasir menukar poin. |

### ✅ Solusi Aman (patch minimal)

> ✅ **SELESAI & TEREKSEKUSI** — validasi: tsc 0 error, 653/653 test, build sukses.

Tambahan hasil penelusuran ulang (sebelum eksekusi): ternyata ada **3 titik hitung totalDiscount** yang tidak konsisten, bukan hanya 2:
- `POS.tsx:269` (`handleSavePending`) — ✅ sudah benar
- `POS.tsx:884` (`finalizeTransaction`) — ❌ bug utama → **diperbaiki**
- `POS.tsx:1109` (`finalizeAsDemo`) — ❌ tanpa redeem, tetapi **SENGAJA TIDAK diubah**: demo tidak mengonsumsi poin loyalty (A13), jadi tidak boleh menerapkan diskonnya — self-consistent. Menambahkan redeem di demo justru mencatat nominal diskon tanpa pemotongan poin.
- Preview `POS.tsx:1163` — ✅ sudah benar

Yang dieksekusi:
1. `discountEngine.ts`: field opsional `redeemDiscount?: number` pada `DiscountEngineInput` — ditambahkan **DI ATAS hasil mesin** (di luar logika stacking/best-deal promo, karena redeem adalah nilai yang sudah "dibayar" pelanggan dengan poinnya), capped subtotal. Default 0 → semua pemanggil existing berperilaku identik.
2. `POS.tsx` `finalizeTransaction`: `totalDiscount = Math.min(discountCalc.totalDiscount + redeemApplied, subtotal)` — rumus identik `handleSavePending`, commit = preview = yang dibayar.
3. Test baru: 6 kasus `discountEngine.test.ts` (default identik, additive, cap subtotal, eksklusif best-deal + redeem, negatif/NaN → 0).

**Side effect yang menjadi KOREKSI (arah benar)**: struk/digital receipt, expected cash shift, Dashboard/Laporan/PPN DPP, dan poin earn kini akurat saat redeem dipakai; data historis tidak berubah; replay idempoten aman.

**Verifikasi manual tersisa**: skenario **redeem + Split Bill fresh** — pastikan alokasi sub-bill konsisten dengan total induk baru (SplitBillModal tidak memakai calculateDiscountBreakdown; alokasinya dari nilai lain).

---

## K2. 🔴 Backup mode Replace menghapus tabel cloud yang TIDAK ada isinya di file backup

| | |
|---|---|
| **Lokasi** | `src/lib/backupService.ts:174-191` (REPLACE_SCOPE), `:383` (audit_logs kondisional), `:676-681` (wipeCloudTables) |
| **Akar masalah** | Scope wipe ditentukan oleh `backupType` (mis. FULL = semua tabel), padahal beberapa file JSON bersifat opsional dalam ZIP (contoh: `audit_logs.json` hanya ditulis bila `includeAuditLogs !== false`). Restore backup FULL tanpa audit logs → `wipeCloudTables` menghapus seluruh `audit_logs` cloud lalu **tidak mengisi apa pun**. |
| **Dampak** | Destruksi data permanen yang tidak bisa dipulihka dari file backup itu sendiri. |

### ✅ Solusi Aman (scope wipe berbasis isi aktual ZIP)

> ✅ **SELESAI & TEREKSEKUSI** — `restoreBackup` mode replace kini memfilter scope wipe berdasarkan kehadiran data aktual di ZIP (`presentInBackup` map per tabel: transactions, cash/shifts/movements, stock/opnames/logs, audit_logs, customers, promos, menu_components, menus, inventory, users). Backup lengkap → daftar wipe identik perilaku lama; ZIP parsial/rusak → fail-safe (tabel tak disertakan tidak disentuh). Array kosong `[]` yang ADA di ZIP tetap ter-wipe (`!== undefined`).

**Verifikasi**: unit test — buat ZIP FULL tanpa `audit_logs.json`, jalankan restore replace ke mock cloud, assert tabel lain ter-replace & audit_logs **tidak tersentuh**. Test existing `backupService.test.ts` harus tetap lolos tanpa modifikasi.

---

## K3. 🔴 RLS "Allow all for anon" membuka seluruh database ke publik

| | |
|---|---|
| **Lokasi** | `supabase/schema.sql:430-441,488` — policy `FOR ALL USING (true) WITH CHECK (true)` di 13 tabel |
| **Dampak** | Anon key publik di frontend → siapa pun bisa baca/tulis/hapus transaksi, data pelanggan (PII), stok, shift kas. |

### ⚠️ SOLUSI DIREVISI (hasil analisis side-effect) — Tahap 1 lama DIBATALKAN

> **Revisi**: rencana awal "Tahap 1 revoke DELETE dari anon" **TIDAK JADI** — penelusuran kode membuktikan aplikasi **sah menggunakan anon-key DELETE di banyak alur**, revoke akan memecah fitur existing:

| Fitur Existing yang PECAH jika DELETE direvoke | Titik Kode |
|---|---|
| Hapus Transaksi | `cloudSync.ts` `deleteTransactionCloud` |
| Bersihkan Data Transaksi / Factory Reset (wipe cloud) | `dataManager.ts` `clearCloudTables` (`OPERATIONAL_WIPE_TABLES`/`FULL_WIPE_TABLES`) |
| Restore backup mode Replace (wipe cloud) | `backupService.ts` `wipeCloudTables` |
| Hapus Semua Audit Log | `auditLogStore.clearAllLogs` |

Faktanya hampir semua tabel punya jalur delete sah → **tidak ada revoke DELETE yang bisa dilakukan tanpa memindahkan jalur itu ke server-side (= pekerjaan Tahap 2 itu sendiri)**.

### ✅ Strategi Revisi

**Interim (non-breaking, bisa dilakukan hari ini tanpa ubah kode):**
- Aktifkan Supabase Daily Backup / PITR sebagai pagar pemulihan.
- Monitoring usage API Supabase (alert anomali).
- Dokumentasikan risiko ekspos pada onboarding klien sampai Tahap 2 selesai.

**Fix sesungguhnya = Tahap 2 (proyek terstruktur, bukan patch panas):**
1. Pindahkan jalur delete sah ke RPC `security definer` dengan otorisasi (pola PinModal → approver dikirim ke RPC), ATAU adopsi Supabase Auth + policy `auth.uid()`.
2. Setelah SEMUA jalur tulis/hapus lewat server-side → baru revoke DELETE/UPDATE dari anon per tabel.
3. Urutan aman: RPC dulu → verifikasi seluruh checklist `TESTING-PRADEPLOY.md` → revoke policy terakhir.

---

## K4. 🔴 Hash password & PIN manager terekspos di tabel publik (+ fallback plaintext)

| | |
|---|---|
| **Lokasi** | `src/lib/cloudSync.ts:1462-1476` (syncUser menulis kolom `password`), `:1238,1248` (PIN manager/super admin), `supabase/schema.sql:515-520` (seed plaintext), `src/store/authStore.ts:61-66` & `src/utils/pinAuth.ts:40-44` (fallback plaintext masih diterima) |
| **Dampak** | Hash bcrypt dapat dibaca anon → offline brute-force; password/PIN bisa **ditimpa** anon → account takeover Manager. |

### ⚠️ SOLUSI DIREVISI — dipisah dua bagian (hasil analisis side-effect)

> **Temuan penentu**: login aplikasi **bergantung pada hash di cloud** — `authStore` melakukan `fetchUsersFromCloud` lalu `bcrypt.compareSync(password, user.password)` (authStore.ts:59-66, loadFromCloud :145). Hash tersinkron adalah **mekanisme kerja** untuk: login lintas device, bootstrap device baru (fetch users pertama kali), dan **login offline** (cache lokal).

**❌ TIDAK BOLEH dilakukan sekarang (akan memecah login):**
- Menghentikan sync kolom `password` → device baru/kedua tidak bisa verifikasi login.
- Memindah verifikasi ke RPC server-side saja → **login offline mati** (butuh network) — regresi arsitektur local-first.

**✅ Bagian yang tereksekusi sekarang (aman):**
1. Tolak fallback plaintext: kredensial tanpa prefix bcrypt (`$2a$`/`$2b$`) → tolak login + toast "Password harus direset oleh Manager" (deployment yang sudah re-hash tidak terpengaruh).
2. Force re-hash saat boot bila terdeteksi plaintext (mekanisme `passwordsHashed` existing).

**⏳ Bagian ekspos hash/PIN → masuk Tahap 2 K3**: Supabase Auth atau RPC `security definer` dengan cache offline; kolom password/PIN keluar dari jangkauan anon hanya setelah jalur verifikasi baru live di semua device.

**Verifikasi bagian yang dieksekusi**: akun seed plaintext lama ditolak sampai di-reset; setelah re-hash, semua role login normal; kolom password berformat `$2*`.

---

## K5. 🔴 Audit log sepenuhnya manipulable dari client

| | |
|---|---|
| **Lokasi** | `schema.sql:437` (policy ALL pada `audit_logs`) + `cloudSync.ts:1201-1214`; idem field approver di `stock_opnames` |
| **Dampak** | Log palsu bisa dibuat, jejak fraud bisa diedit/dihapus dari browser siapa pun → "dual-control" opname hanya kosmetik. |

### ⚠️ SOLUSI DIREVISI — insert-only punya side effect, perlu keputusan sadar

> **Temuan penelusuran**: policy insert+select-only pada `audit_logs` akan mem-break 2 fitur existing:
> 1. **"Hapus Semua Log Audit"** (`auditLogStore.clearAllLogs` — `supabase.from('audit_logs').delete()`)
> 2. **Factory Reset** — `FULL_WIPE_TABLES` mencakup `audit_logs`; jika cloud tidak ikut terhapus, log lama **resurrect** saat device lain loadFromCloud (melanggar tujuan reset itu sendiri)

**Dua opsi (pilih satu secara sadar):**
- **Opsi A — terapkan sekarang + ubah SOP**: kedua aksi menjadi local-only; purge cloud dilakukan manual via SQL Editor sekali-sekali (catat di panduan klien). Keamanan log naik signifikan dengan effort minimal.
- **Opsi B — tunda sampai Tahap 2**: purge via RPC ber-otorisasi Manager, baru policy diperketat.

SQL (untuk Opsi A, saat dieksekusi):
```sql
DROP POLICY IF EXISTS "Allow all for anon" ON audit_logs;
CREATE POLICY "anon insert audit" ON audit_logs FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon select audit" ON audit_logs FOR SELECT TO anon USING (true);
-- UPDATE & DELETE: tidak diberi policy → otomatis ditolak untuk anon
```
+ masukkan blok ke `DEPLOYMENT.md §4` + deteksi di `runMigrations` (pola Migration 18) + catat perubahan perilaku clearAllLogs/factory reset di CHANGELOG.

**Verifikasi**: buat transaksi → audit log tampil; export CSV jalan; UPDATE/DELETE manual sebagai anon → ditolak; factory reset → pesan jelas bahwa purge cloud log dilakukan manual.

---

## K6. 🔴 Offline queue flush menimpa antrean — op baru saat flush hilang

| | |
|---|---|
| **Lokasi** | `src/lib/offlineQueue.ts:313` (ambil referensi queue), `:421` (`saveQueue(remaining)` menimpa seluruh memory+storage) |
| **Dampak** | Operasi yang masuk selama flush panjang (kasir terus menjual) di-persist oleh `addToQueue`, lalu **terhapus** oleh `saveQueue(remaining)` di akhir flush → transaksi tidak pernah tersync. |

### ✅ Solusi Aman (merge antrean berdasarkan kondisi terkini)

> ✅ **SELESAI & TEREKSEKUSI** — implementasi final lebih kuat dari pseudocode awal: merge dilakukan dari **kondisi antrean terkini** (`getQueue()`) dibanding snapshot flush, dengan 5 aturan:
> 1. Op yang TIDAK ada di snapshot (masuk selama flush) → disimpan ✓
> 2. Op sukses lalu di-replace in-place oleh addToQueue saat flush (id sama, objek baru) → **versi terbaru diantrekan ulang** (data baru belum tersync)
> 3. Op sukses tanpa perubahan → tidak diantrekan ulang (perilaku lama)
> 4. Op gagal permanen → pindah ke failed-ops list (tidak ikut antrean)
> 5. Op transient/retries<MAX → tetap antre, memakai versi terbaru hasil replace
>
> Deteksi replace via identitas objek (`op !== snap`) — addToQueue mempertahankan id tapi membuat objek baru. Kasus tanpa konkurensi = hasil identik `saveQueue(remaining)` lama.
> + accessor read-only `getQueuedOperations()` (untuk debug/UI/test).
>
> **Test baru** `offlineQueueFlushMerge.test.ts` (3 kasus, mock supabase ber-gate): op baru mid-flush selamat; op sukses+replace diantrekan ulang versi baru; tanpa konkurensi = perilaku lama. Test existing offlineQueue* lolos tanpa modifikasi.

---

# BAGIAN B — TEMUAN & FIX TINGGI

---

## T1. Rollback stok berbasis snapshot diff global - over-revert saat checkout konkuren
> [x] **SELESAI & TEREKSEKUSI** - lihat catatan eksekusi di bawah (validasi: tsc 0 error, 653/653 test, build sukses).

- **Lokasi**: `src/lib/atomicTransactionEngine.ts:123,269-284`
- **Masalah**: rollback menghitung `originalStock − current` untuk semua item. Checkout device lain di antara snapshot & rollback ikut "dipulihkan" (deduksi orang lain dibatalkan).
- **✅ Fix aman**: simpan **delta yang engine ini sendiri terapkan** (hasil `computeDeductions` per item) saat commit, dan revert persis delta tersebut — bukan diff global. Patch lokal di engine; transaksi tunggal (jalur utama) berperilaku identik karena delta = diff ketika tidak ada konkurensi.
- **Verifikasi**: unit test rollback dengan mutasi paralel antara commit & rollback.

## T2. Double-submit Bayar Sub-Bill Split Bill mencatat dua transaksi nyata
> [x] **SELESAI & TEREKSEKUSI** - lihat catatan eksekusi di bawah (validasi: tsc 0 error, 653/653 test, build sukses).
> **Re-audit fix**: ID sub-bill kini menyertakan signature isi bill (shortHash computeCartSignature + totalAmount) - ganti mode equal/item pada indeks sama menghasilkan ID berbeda (tidak salah dianggap replay tx lama); double-click bill identik tetap satu ID (guard jalan). Residual hanya bila paidState rehydrate GAGAL dan sesi hilang bersamaan (kelas 5.7, berlapis terjaga).

- **Lokasi**: `src/components/SplitBillModal.tsx:888,431` + `atomicTransactionEngine.ts:43`
- **Masalah**: tombol tidak di-disable saat async, dan engine dipanggil **tanpa** `transactionId` → guard idempotency engine tidak pernah aktif di jalur split.
- **✅ Fix aman (dua lapis, saling melengkapi, masing-masing independen)**:
  1. Kirim ID deterministik per sub-bill ke engine: `${parentTxId ?? sessionKey}-sub-${billIndex}` — engine existing langsung memakai guardnya tanpa perubahan apa pun di engine.
  2. Tambah state `processingSubBill` lokal + disable tombol selama `handlePaySubBill` berjalan.
- **Mengapa aman**: checkout utama POS sudah memakai pola ID stabil (`checkoutTxId`) — kita hanya meniru pola yang sudah terbukti di jalur split.
- **Verifikasi**: double-click cepat tombol sub-bill → hanya SATU transaksi tercatat.

## T3. Pelanggaran Rules of Hooks di Layout - crash saat logout race
> [x] **SELESAI & TEREKSEKUSI** - lihat catatan eksekusi di bawah (validasi: tsc 0 error, 653/653 test, build sukses).

- **Lokasi**: `src/components/Layout.tsx:180` — early-return `if (!currentUser) return null` SEBELUM beberapa hook.
- **✅ Fix aman**: pindahkan early-return ke SETELAH semua hook dipanggil (tambahkan `if (!currentUser) return null;` setelah hook terakhir, hapus yang lama). Perilaku render untuk semua state normal **identik** — hanya urutan pemanggilan hook yang dikonsisten.
- **Verifikasi**: login → logout → login ulang berkali-kali; tidak ada crash "Rendered fewer hooks".

## T4. Flag pendingSplitReconciled basi - deduksi stok salah finalisasi normal
> [x] **SELESAI & TEREKSEKUSI** - lihat catatan eksekusi di bawah (validasi: tsc 0 error, 653/653 test, build sukses).

- **Lokasi**: `src/pages/POS.tsx:205,2562`
- **✅ Fix aman**: reset flag juga di `onClose` SplitBillModal dan saat `currentPendingTx` berubah/clearCart. Reset flag adalah operasi no-op bagi alur yang flag-nya memang false.
- **Verifikasi**: bayar 1 dari N sub-bill pending → tutup modal → lunasi via checkout normal → stok terpotong tepat 1×.

## T5. Promo dan input redeem bocor ke order berikutnya setelah split selesai
> [x] **SELESAI & TEREKSEKUSI** - lihat catatan eksekusi di bawah (validasi: tsc 0 error, 653/653 test, build sukses).

- **Lokasi**: `src/pages/POS.tsx:2546-2559` (`onCompleteSplit`)
- **✅ Fix aman**: tambahkan `clearPromo(); setRedeemPointsInput('');` di `onCompleteSplit`. Bagi order tanpa promo, kedua panggilan ini no-op — tidak ada perubahan perilaku.
- **Verifikasi**: order A pakai promo + split bill sampai lunas → order B baru TIDAK membawa promo A.

## T6. Acaraki terkunci di modal non-dismissable jika printer gagal saat logout
> [x] **SELESAI & TEREKSEKUSI** - lihat catatan eksekusi di bawah (validasi: tsc 0 error, 653/653 test, build sukses).

- **Lokasi**: `src/components/Layout.tsx:250-270,889-894`
- **✅ Fix aman**: bungkus `await printTextRaw(...)` dengan `try { ... } catch { toast error } finally { clearKdsDoneOrders(); logout(); navigate(); }` — **replikasi persis pola 6.4 yang sudah terbukti** di `handleCloseShift` (escape path wajib). Alur sukses tidak berubah sama sekali.
- **Verifikasi**: matikan Bluetooth → logout Acaraki → tetap ter-logout dengan pesan jelas.

## T7. Hydrate offline queue: error IDB dianggap kosong - antrean bisa ter-wipe saat boot
> [x] **SELESAI & TEREKSEKUSI** - lihat catatan eksekusi di bawah (validasi: tsc 0 error, 653/653 test, build sukses).
> **Re-audit fix**: baris redundan `memoryFailed = memoryFailed ?? failedStored` dihapus (operand kiri tak pernah null) + komentar eksplisit bahwa daftar gagal runtime sengaja dipertahankan dari hasil baca parsial.

- **Lokasi**: `src/lib/offlineQueue.ts:84-104,142-145` + `src/utils/idbStorage.ts:120-122`
- **Masalah**: `idbGet` menelan error → return `null` (= kosong) → fallback localStorage yang sudah dihapus pasca-migrasi → persist `'[]'` menimpa antrean sesi sebelumnya.
- **✅ Fix aman**: bedakan dua kondisi di layer baca: `(1)` key memang kosong → `null`; `(2)` error buka/baca IDB → **throw**. Di `hydrateQueue`, tangkap throw: jangan persist hasil gabungan & jangan set `hydrated=true` secara permanen (retry hydrate di event berikutnya).
- **Mengapa aman**: jalur normal (IDB sehat) tidak berubah; hanya jalur error yang semula merusak data kini menjadi retry-aman.
- **Verifikasi**: unit test — mock `idbGet` throw saat boot dengan antrean tersimpan → assert antrean tidak tertimpa `'[]'`.

## T8. Mismatch kolom menus.description - ditulis sync tapi tidak ada di schema.sql aktif
> [x] **SELESAI & TEREKSEKUSI** - lihat catatan eksekusi di bawah (validasi: tsc 0 error, 653/653 test, build sukses).

- **Lokasi**: `cloudSync.ts:1117,1422` vs `schema.sql:29-45`
- **✅ Fix aman (murni aditif di DB)**:
  ```sql
  ALTER TABLE menus ADD COLUMN IF NOT EXISTS description TEXT;
  ```
  Tambahkan ke `schema.sql` (project baru) + blok upgrade `DEPLOYMENT.md §4` (DB lama) + guard `migrationNeeded` di `runMigrations` (pola Migration 13–21 yang sudah standar). Tidak ada perubahan kode TypeScript.
- **Verifikasi**: edit deskripsi menu → sinkron ke cloud → device lain menerima deskripsi.

## T9. Wipe cloud restore tidak atomik (kegagalan tengah jalan = kondisi campuran)
> [x] **SELESAI & TEREKSEKUSI** - lihat catatan eksekusi di bawah (validasi: tsc 0 error, 653/653 test, build sukses).
> **Re-audit fix**: `wipeCloudTables` kini mengecek `error` hasil delete - collector hanya mencatat tabel yang BENAR-BENAR terhapus (bukan sekadar dicoba), sehingga pesan kegagalan tengah jalan akurat.

- **Lokasi**: `backupService.ts:197-206,677+`
- **✅ Fix aman (tanpa restrukturisasi besar)**:
  1. Pre-flight WAJIB: parse & validasi seluruh JSON ZIP + checksum **sebelum** panggilan wipe pertama (guard eksplisit di awal `restoreBackup`).
  2. Batasi scope wipe sesuai fix K2 (jangan hapus lebih dari yang akan diisi).
  3. Catat urutan tabel yang sudah ter-wipe ke variabel lokal; bila restore gagal di tengah, tampilkan dialog dengan daftar tabel yang terkena + sarankan restore ulang (restore ulang = idempoten karena full upsert).
  - Restore atomik penuh (staging table + swap) ditunda ke roadmap — bukan patch panas.
- **Verifikasi**: simulate network drop mid-restore → pesan jelas + restore ulang berhasil membersihkan kondisi campuran.

## T10. Form Stock Opname memakai snapshot stok basi dari mount time
> [x] **SELESAI & TEREKSEKUSI** - lihat catatan eksekusi di bawah (validasi: tsc 0 error, 653/653 test, build sukses).
> **Re-audit fix**: toast agregat (debounce 3 dtk, anti double-fire StrictMode) bila perubahan stok mengenai baris yang SUDAH diisi kasir - pratinjau selisih bergeser tidak lagi tanpa kabar.

- **Lokasi**: `src/pages/StockOpname.tsx:51-57`
- **✅ Fix aman**: sinkronkan field `systemStock` baris saat store `inventory` berubah (via `useEffect` merge), **sambil mempertahankan input `actualStock` yang sedang diketik kasir**. Guard drift yang ada (`findDriftedOpnameItems`) tetap jalan sebagai lapisan kedua.
- **Mengapa aman**: hanya field read-only (stok sistem & preview selisih) yang diperbarui; input manual kasir tak tersentuh. Tanpa perubahan inventory, efeknya nol.
- **Verifikasi**: buka form opname → buat transaksi POS di device lain (stok berubah) → nilai "Stok Sistem" di form ikut update, input fisik tidak hilang.

---

# BAGIAN C — TEMUAN SEDANG (fix aman ringkas)

| # | Temuan | Lokasi | ✅ Fix Aman Ringkas |
|---|--------|--------|---------------------|
| **S1** ✅ | Escape/F1 mengganggu modal pembayaran in-flight | `POS.tsx:542-565` | Tambah guard di awal handler keyboard: abaikan Escape/F1 bila `finalizeTransaction` in-flight atau modal lain terbuka. Jalur normal (modal tertentu aktif → shortcut bekerja) tidak berubah. |
| **S2** ✅ | Upsert parsial settings bisa membuat row id=1 sparse | `cloudSync.ts:1337-1344` | Sebelum upsert parsial, pastikan row id=1 ada: bila `fetchSettingsFromCloud` null → jalankan `syncSettings` penuh dulu. Additive; settings yang sudah ada tidak tersentuh. |
| **S3** ✅ | Fallback absolut stok saat offline = lost-update lintas device | `cloudSync.ts:1039-1054` | Saat result `degraded`, dorong penanda rekonsiliasi (set flag/banner stok konflik yang **sudah ada** di Inventaris — reuse `stockConflict`). Tanpa perubahan logika tulis. |
| **S4** ✅ | Riwayat backup "Success" sebelum upload diketahui | `backupService.ts:421-430` | Pindahkan pencatatan history ke pemanggil setelah result diketahui, ATAU tambahkan `updateBackupHistoryEntry(id, status)` dan panggil setelah upload. Entri lama tidak tersentuh. |
| **S5** ✅ | Auto-backup Local Download diblokir browser tanpa user gesture | `autoBackupScheduler.ts:100` | Untuk scheduler, prioritaskan destinasi Supabase Storage; bila target "Local", tandai status "Siap diunduh — klik untuk simpan" (toast + badge) alih-alih klaim sukses. |
| **S6** ✅ | Persist split stock session gagal diam-diam saat kuota penuh | `splitStockSession.ts:172-182` | Saat persist gagal → tolak MEMULAI split FRESH baru (fail-closed, toast jelas). Sesi yang sudah jalan tetap berlanjut di memori. Tidak memengaruhi checkout normal. |
| **S7** ✅ | Diskon cart manual menerima nilai negatif | `cartStore.ts:134` | `setDiscount(Math.max(0, Math.floor(amount \|\| 0)))` — clamp satu baris; nilai valid (≥0) berperilaku identik. |
| **S8** ✅ | Promo `usageCount` kalah last-write-wins lintas device | `promoStore.ts:216-221` | Saat merge, hitung ulang `usageCount` dari union `usageKeys` (data sumbernya sudah di-union dengan benar). Additive di jalur merge saja. |
| **S9** ✅ | CHECK `payment_method` & `tax INT` berisiko gagal sync | `schema.sql:75,85` | SQL idempoten: relaksasi CHECK payment method (DO block pola promos.type yang sudah terbukti) + `ALTER TABLE transactions ALTER COLUMN tax TYPE FLOAT` (atau biarkan INT bila pembulatan rupiah memang disengaja — verifikasi dulu semantik). |
| **S10** ✅ | Index database hilang untuk query rutin | `schema.sql` | Murni additive, tanpa risiko: `CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date DESC); idx_cm_date ON cash_movements(date DESC); idx_al_ts ON audit_logs(timestamp DESC); idx_sl_date ON stock_logs(date DESC); idx_cust_created ON customers(created_at DESC);` |
| **S11** 🟡 PARSIAL (DOMPurify ter-fix via npm audit fix; react-router v7 & uuid v14 = major breaking, ditunda tugas khusus - uuid advisory tidak menyentuh pemakaian v4) Dependency usang (react-router open redirect, DOMPurify XSS ×5) | `package.json` | `npm audit fix` + upgrade `react-router-dom` (minor/major sesuai breaking changes — uji routing) & `dompurify`. Tidak menyentuh kode aplikasi bila API kompatibel. |
| **S12** ✅ | Sesi multi-login pakai `Math.random`, enforcement client-only | `authStore.ts:181-191` | Ganti generator ke `crypto.randomUUID()` (drop-in, entropy lebih baik, tanpa perubahan mekanisme). Enforcement server-side masuk Tahap 2 K3. |
| **S13** ✅ | Op update/delete offline tanpa filter dihitung sukses | `offlineQueue.ts:370-379` | Bila `op.filter` undefined → klasifikasikan sebagai error permanen (masuk failed-ops list yang sudah ada) alih-alih success. Jalur normal (filter selalu ada) tidak berubah. |
| **S14** ✅ | Delete→update offline pada record sama: edit lenyap | `offlineQueue.ts:241-267` | Di `addToQueue('update'/'upsert')`, bila ada delete pending untuk recordId sama → hapus delete-op tsb (record dibuat ulang oleh upsert). Hanya menyentuh kombinasi yang saat ini rusak. |
| **S15** ✅ | Belasan catch kosong di fetcher cloud | `cloudSync.ts:1352…1758` | Tambah `console.warn('[cloudSync]', err?.message)` di tiap catch — zero behavioral change, besar manfaat diagnosa lapangan. |
| **S16** ✅ | Dashboard chart basi lintas tengah malam + agregat tak memoized | `Dashboard.tsx:64,109-170` | Memoize `todayTx`/chartData + ticker `Date.now()` interval 1-menit (clear di unmount). Angka untuk periode berjalan identik. |
| **S17** ✅ | BroadcastChannel leak per broadcast; listener GATT menumpuk | `printer.ts:161-169,387-392` | Cache singleton module-level untuk channel; `removeEventListener` sebelum add (atau AbortController). Perilaku broadcast/re-pair tidak berubah. |

---

# BAGIAN D — RENDAH (backlog, tidak mendesak)

| Temuan | Lokasi | Catatan fix saat dieksekusi |
|---|---|---|
| Idempotency registry in-memory hilang pasca-reload | `atomicTransactionEngine.ts:36` | Persist registry ke IDB (pola `idbStorage`) — backlog; jendela risiko sempit. |
| Probe migrasi bisa meninggalkan baris `'MIGRATION-PROBE'` | `cloudSync.ts:524-539` | Bersihkan by-category saat boot berikutnya (idempoten). |
| Mapping asimetris `promoAmount: row.promo_amount \|\| undefined` | `cloudSync.ts:797` | `\|\|` → `??`. Satu karakter, nol efek untuk nilai non-zero. |
| Tombstone cap 1000 + fetch 500 → ghost teoretis | `storagePrune.ts:19` | Trade-off terdokumentasi; naikkan cap bila perlu. |
| Merge-mode restore tanpa freshness check | `backupService.ts:685-843` | Dokumentasikan "merge = backup menang"; LWW universal di roadmap. |
| `downloadCSV` tanpa revoke object URL | `Reports.tsx:590-594` | Tambah `URL.revokeObjectURL` setelah click. |
| CustomerPicker tanpa outside-click/ARIA | `POS.tsx:107-177` | A11y pass (listbox role, aria-expanded, blur-close). |
| Duplikasi JSX keranjang mobile/desktop ~700 baris (sudah drift) | `POS.tsx:1320-2081` | Ekstrak komponen `CartPanel` — proyek refactor terpisah, bukan patch panas. |
| Initial fetch KDS race dengan subscription | `Kitchen.tsx:57-64` | Refetch ringkan setelah subscribe aktif. |
| Listener/interval `initOfflineQueue` tak bisa dibersihkan | `offlineQueue.ts:470-493` | Simpan referensi + sediakan `disposeOfflineQueue()` (untuk test/HMR). |
| Seed bcrypt rounds tidak konsisten (8 vs 10) | `seed.ts` | Samakan lewat konstanta bersama saat re-hash berikutnya. |
| Tanpa CSP/security headers | `index.html`, `vite.config.ts` | Tambah `<meta CSP>` allowlist supabase.co + fonts; matikan `allowedHosts` ngrok di build produksi. |

---

# BAGIAN E — REKOMENDASI MAKSIMALISASI (Roadmap, bukan patch panas)

Diurutkan dari impact ÷ effort:

1. **Satu sumber kebenaran total keranjang** — hook `useCartTotals()` (subtotal, manual+promo+loyalty+redeem, tax, finalTotal) yang dipakai preview + save-pending + finalize + split. Menutup permanen kelas bug seperti K1. *(Effort: sedang — impact: sangat tinggi)*
2. **Outbox pattern + ledger `sync_ops(op_id PK)` server-side** dengan RPC idempoten — replay aman by-design; menggantikan dedup heuristik client & registry in-memory. *(Effort: tinggi — impact: sangat tinggi)*
3. **Supabase Auth / Edge Function gateway** (Tahap 2 K3/K4/K5) — prasyarat komersialisasi multi-klien. *(Effort: tinggi — impact: sangat tinggi)*
4. **Mapping deklaratif camelCase↔snake_case** — satu definisi per tabel membangkitkan sync dua arah; memangkas ~600 baris mapping manual & kelas bug asimetri. *(Effort: sedang)*
5. **Tabel `schema_migrations` + RPC bootstrap** menggantikan ±30 probe console.warn per startup — startup lebih cepat, migrasi tak lagi bergantung admin membaca console. *(Effort: sedang)*
6. **LWW universal** (`updated_at` di settings/menus/customers/promos) — merge cloud & restore merge konsisten. *(Effort: rendah–sedang)*
7. **RPC kondisional shift** (`open_shift`/`close_shift ... WHERE status='open'`) — hilangkan TOCTOU multi-device tanpa trust client. *(Effort: rendah)*
8. **Test integrasi jalur uang & stok** — simulasi konkurensi (flush paralel + addToQueue, rollback + commit simultan, hydrate dengan IDB error, restore ZIP parsial). Semua temuan KRITIS/TINGGI dokumen ini lolos dari unit test murni — inilah pengaman regresi terpenting. *(Effort: sedang — impact: tinggi, preventif)*
9. **Pecah komponen raksasa** (POS.tsx 129KB, SettingsPage 94KB, Reports 93KB, cloudSync 84KB) + hook realtime bersama `useRealtimeSync(tables)`. *(Effort: tinggi, bertahap)*
10. **Snapshot `earnedPoints` per transaksi** — clawback deterministik + fondasi partial refund per item. *(Effort: rendah)*

---

# BAGIAN F — URUTAN EKSEKUSI YANG DISARANKAN

> **REVISI**: setelah analisis side-effect (lihat revisi K3/K4/K5 di Bagian A), cluster keamanan tidak bisa dipatch lokal tanpa memecah fitur — strateginya digabung ke Tahap 2 terstruktur.

```
✅ SELESAI (dieksekusi & tervalidasi — tsc 0 error, 653/653 test, build sukses):
   KRITIS : K1, K2, K6
   TINGGI : T1–T10 (seluruhnya)
   SEDANG : S1, S7, S9, S10, S12, S13, S14, S15, S16, S17
   S11    : 🟡 PARSIAL (DOMPurify ter-fix; react-router v7 & uuid v14 = major → tugas khusus)

✅ TAMBAHAN (S2–S6, S8 + cherry-pick D — dieksekusi & tervalidasi: tsc 0 error, 654/654 test, build sukses):
   S2 probe settings row · S3 konflik sintetis degraded · S4 historyId+update status
   S5 auto-backup local jujur · S6 gerbang fail-closed split · S8 usageCount=max(union)
   D: promoAmount ?? (nilai 0 sah) · downloadCSV revokeObjectURL (delay 1 dtk)
   [bcrypt rounds: temuan STALE — seed plaintext by-design, re-hash boot konsisten rounds 10]

📋 BAGIAN D (backlog pasca-penjualan): CartPanel refactor · A11y pass · CSP headers ·
   disposeOfflineQueue · persist idempotency registry · LWW universal

🗺️ BAGIAN E (roadmap pasca-penjualan): prioritas E3 (Tahap 2 Keamanan) + E8
   (test integrasi konkurensi); lainnya setelah pilot berjalan.

Tahap 2 KEAMANAN (proyek terstruktur — K3+K4+K5 final):
   1. RPC security definer untuk jalur delete sah (delete tx, wipe/reset, clear logs)
      + verifikasi login via RPC dengan cache offline
   2. Verifikasi penuh TESTING-PRADEPLOY.md
   3. BARU revoke DELETE/UPDATE dari anon per tabel
```

**Prosedur tiap patch** (sesuai konvensi project):
1. Kerja di branch `develop` → `npx tsc --noEmit` → `npx vitest run` → `npm run build`
2. Test manual per checklist verifikasi item terkait (+ `testing/TESTING-PRADEPLOY.md`)
3. Bila ada SQL: jalankan di Supabase SQL Editor (idempoten) + catat di `DEPLOYMENT.md §4` + `CHANGELOG.md`
4. Merge ke `main` → Vercel auto-deploy

---

*Laporan ini dihasilkan dari audit statis read-only. Tidak ada file kode yang dimodifikasi. Semua referensi file:baris terverifikasi langsung dari source pada versi v4.8.3.*