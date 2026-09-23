# BerdikariPOS --- Supabase Egress Audit & AI Agent Task Brief

## 1. Tujuan Dokumen

Dokumen ini dibuat sebagai briefing untuk Agent AI yang akan melakukan
audit dan perbaikan codebase **BerdikariPOS-Leter**.

Fokus utama:

> **Mengurangi Supabase Egress secara signifikan tanpa mengubah business
> logic POS yang sudah berjalan.**

Perbaikan harus aman terhadap fitur: - POS / transaksi - Pending
Payment - Split Bill - KDS / Kitchen - Inventory / stok - Stock Opname -
Bundling / menu components - Customer - Promo - Cash Movement - Offline
queue - IndexedDB - Realtime - Printer workflow

Jangan melakukan refactor besar yang tidak diperlukan.

------------------------------------------------------------------------

# 2. Sumber Analisis

Analisis dibuat berdasarkan:

1.  **Codebase terbaru**
    -   `BerdikariPOS-Leter-main(1).zip`
2.  **Supabase API Gateway log**
    -   Data 1 hari
    -   Level 2xx / Success
3.  Informasi usage Supabase Free Plan yang tersedia:
    -   Egress: **14.681 GB / 5 GB**
    -   PostgREST Egress: **99.5%**
    -   Realtime Egress: **0.5%**

### Catatan penting

API Gateway log tidak menyediakan ukuran response dalam byte.

Karena itu, kita **tidak dapat menentukan secara presisi berapa GB yang
berasal dari setiap endpoint** hanya dari jumlah request.

Namun pola request pada log sangat konsisten dengan pola full-table read
yang ditemukan di codebase.

------------------------------------------------------------------------

# 3. Masalah Utama

## Kesimpulan

Masalah egress bukan terutama disebabkan oleh:

-   POST transaksi
-   PATCH transaksi
-   jumlah Realtime message
-   ukuran database

Sumber utama yang perlu diperiksa dan diperbaiki adalah:

> **GET / READ ke Supabase yang terlalu sering, terlalu besar, dan pada
> beberapa jalur dapat terjadi berulang atau ganda.**

Pola utamanya:

``` text
Application
    ↓
Full Table SELECT
    ↓
Supabase PostgREST
    ↓
Data JSON dikirim ke client
    ↓
Egress meningkat
```

Masalah menjadi lebih besar ketika proses tersebut dipicu oleh:

-   startup
-   Realtime event
-   reconnect
-   visibilitychange
-   subscription ganda
-   schema/feature detection

------------------------------------------------------------------------

# 4. Bukti dari API Gateway Log

Rentang log yang tersedia sekitar 1 jam 43 menit.

Total request:

``` text
1000 requests
```

Status:

``` text
200 = 935
201 = 28
101 = 25
204 = 12
```

Method:

``` text
GET     = 810
OPTIONS = 106
POST    = 72
PATCH   = 12
```

Artinya mayoritas request adalah **GET/read**.

## Endpoint dengan jumlah request tinggi

  Endpoint                       Request
  ---------------------------- ---------
  `/rest/v1/settings`                305
  `/rest/v1/transactions`            165
  `/rest/v1/menus`                   108
  `/rest/v1/inventory`                68
  `/rest/v1/customers`                65
  `/rest/v1/menu_components`          50
  `/rest/v1/promos`                   42
  `/rest/v1/cash_movements`           34
  `/rest/v1/shifts`                   26
  `/realtime/v1/websocket`            25
  `/rest/v1/audit_logs`               24
  `/rest/v1/users`                    22
  `/rest/v1/stock_opnames`            20
  `/rest/v1/stock_logs`               11

------------------------------------------------------------------------

# 5. Bukti `SELECT *`

Ditemukan sekitar:

``` text
368 request dengan SELECT *
```

Distribusinya:

``` text
settings          57
inventory         57
menus             55
customers         54
menu_components   50
cash_movements    20
shifts            15
transactions      15
audit_logs         9
stock_logs         9
stock_opnames      9
promos             9
users              9
```

Ini penting karena `SELECT *` mengambil seluruh kolom.

Untuk tabel besar seperti `transactions`, response dapat jauh lebih
besar daripada request sederhana seperti pengecekan settings.

------------------------------------------------------------------------

# 6. Full Transaction Fetch

Log menunjukkan request seperti:

``` text
/rest/v1/transactions?select=*&order=date.desc&limit=500
```

Request ini mengambil hingga:

``` text
500 transaction
```

sekaligus.

Ini berpotensi menjadi salah satu sumber egress terbesar karena tabel
transaksi memiliki banyak informasi dan dapat berkembang terus.

Catatan:

> Jumlah request transactions lebih sedikit daripada settings, tetapi
> ukuran response transactions kemungkinan jauh lebih besar.

Jangan menentukan kontribusi GB hanya berdasarkan jumlah request.

------------------------------------------------------------------------

# 7. Masalah Subscription Ganda

## App.tsx

Application-level subscription sudah membuat subscription untuk:

``` text
settings
menus
inventory
```

## POS.tsx

POS juga membuat subscription untuk:

``` text
menus
inventory
customers
settings
```

Akibatnya beberapa tabel dapat memiliki **lebih dari satu subscriber
aktif**.

Contoh:

``` text
App.tsx
   ↓
subscribeToMenus()

POS.tsx
   ↓
subscribeToMenus()
```

Hal yang sama terjadi pada inventory dan settings.

### Risiko

Satu perubahan database dapat diproses oleh beberapa listener.

Jika masing-masing listener memanggil full reload, jumlah request dapat
berlipat.

------------------------------------------------------------------------

# 8. Masalah Realtime → Full Reload

Pola yang perlu diperbaiki adalah:

``` text
Realtime event
      ↓
loadFromCloud(true)
      ↓
SELECT * seluruh tabel
```

Contoh yang ditemukan pada area menu/inventory/settings.

Ini tidak efisien.

Jika Realtime sudah memberikan:

``` text
payload.new
payload.old
eventType
```

maka aplikasi seharusnya memproses row tersebut secara langsung.

## Pola yang diinginkan

### INSERT

``` text
Realtime INSERT
      ↓
upsert new row
```

### UPDATE

``` text
Realtime UPDATE
      ↓
update row yang berubah
```

### DELETE

``` text
Realtime DELETE
      ↓
remove row
```

Tidak perlu mengambil ulang seluruh tabel.

------------------------------------------------------------------------

# 9. Transaksi Sudah Memiliki Fondasi Realtime yang Lebih Baik

Pada bagian transaction, codebase terbaru sudah memiliki pola:

``` text
Realtime payload.new
       ↓
mapCloudRowToTransaction()
       ↓
upsertTransactionFromRealtime()
```

Ini adalah pola yang baik.

Jangan mengganti mekanisme tersebut dengan full reload.

Namun masih terdapat jalur lain yang melakukan:

``` text
fetchTransactionsFromCloud()
```

terutama pada initial load / reconnect / visibility.

Jadi fokus perbaikannya adalah mengurangi full fetch yang tidak
diperlukan, bukan membongkar mekanisme Realtime transaction yang sudah
ada.

------------------------------------------------------------------------

# 10. Masalah `visibilitychange`

Pada POS ditemukan handler:

``` text
window.addEventListener('visibilitychange', handleReconnect)
```

Handler tersebut dapat melakukan:

``` text
loadFromCloud()
```

untuk beberapa store:

``` text
menus
inventory
customers
settings
```

dan juga melakukan setup subscription.

Masalahnya adalah kondisi reconnect menggunakan kombinasi:

``` text
document.visibilityState === 'visible'
||
navigator.onLine
```

Ketika device online, `navigator.onLine` biasanya bernilai true.

Akibatnya perubahan visibility dapat memicu proses yang seharusnya hanya
diperlukan ketika benar-benar terjadi reconnect.

Contoh:

``` text
User membuka POS
      ↓
Pindah ke tab lain
      ↓
Kembali ke POS
      ↓
visibilitychange
      ↓
full cloud reload
      ↓
setup subscription lagi
```

Ini berpotensi menghasilkan burst request.

------------------------------------------------------------------------

# 11. Bukti Burst Request

Dalam log ditemukan burst:

``` text
14:33 → 144 requests
15:52 → 92 requests
16:02 → 73 requests
16:11 → 58 requests
16:00 → 55 requests
15:41 → 53 requests
15:44 → 51 requests
15:53 → 49 requests
```

Pola burst seperti ini konsisten dengan kemungkinan adanya:

-   startup
-   reconnect
-   visibilitychange
-   subscription event
-   full reload

Namun log saja tidak cukup untuk membuktikan event mana yang menyebabkan
setiap burst.

Agent harus memverifikasi hubungan tersebut langsung dari code.

------------------------------------------------------------------------

# 12. Schema / Feature Detection Berlebihan

Codebase menjalankan proses migration / feature detection saat startup.

Terdapat banyak query seperti:

``` text
transactions?select=kitchen_ticket_printed_at&limit=1
transactions?select=promo_name,promo_amount&limit=1
transactions?select=refunded,...&limit=1
transactions?select=applied_promo_id,...&limit=1
transactions?select=table_name,...&limit=1
transactions?select=table_number&limit=1
transactions?select=order_type&limit=1
transactions?select=tax&limit=1
...
```

Tujuannya tampaknya untuk mengecek keberadaan kolom / fitur.

Masalahnya:

``` text
Application startup
      ↓
many schema checks
      ↓
many HTTP requests
```

Jika schema database sudah stabil, pengecekan seperti ini sebaiknya
tidak dilakukan berulang setiap startup.

## Target

Gunakan migration/schema version yang jelas.

Jangan membuat aplikasi melakukan puluhan HTTP request hanya untuk
mengetahui apakah kolom database tersedia.

------------------------------------------------------------------------

# 13. Settings Memiliki Request Sangat Banyak

Log:

``` text
settings = 305 requests
```

Contoh request:

``` text
/settings?select=id&limit=1
/settings?select=*&id=eq.1
/settings?select=categories&id=eq.1
/settings?select=pending_print_option&id=eq.1
/settings?select=auto_send_digital_receipt&id=eq.1
```

Ini menunjukkan settings dibaca berkali-kali dengan berbagai SELECT
kecil.

Selain itu, perubahan settings dapat memicu:

``` text
settings
promos
menus
menu_components
```

karena flow tertentu memanggil beberapa loader sekaligus.

Target:

> Settings sebaiknya di-load sekali dan disimpan sebagai cached
> application state.

Tidak perlu membaca settings berulang kali jika belum berubah.

------------------------------------------------------------------------

# 14. Menu dan Menu Components

Log:

``` text
menus = 108
menu_components = 50
```

Dan terdapat:

``` text
menus?select=* = 55
menu_components?select=*&order=sort_order.asc = 50
```

Menu components juga ikut di-fetch bersama menu pada beberapa jalur.

Target:

``` text
Initial load
    ↓
load menu + components sekali
    ↓
cache lokal
```

Kemudian:

``` text
Realtime UPDATE
    ↓
patch row
```

bukan:

``` text
Realtime UPDATE
    ↓
reload menus
    ↓
reload menu_components
```

------------------------------------------------------------------------

# 15. Customers

Log:

``` text
customers = 65
```

Ada request:

``` text
/customers?select=*&order=created_at.desc
```

Tanpa limit yang jelas pada pola tersebut.

Risiko:

> Semakin banyak customer, semakin besar response setiap kali customer
> list diambil.

Target:

-   pagination
-   limit
-   search/filter server-side
-   selective columns
-   local cache jika sesuai kebutuhan POS

------------------------------------------------------------------------

# 16. Inventory

Inventory memiliki:

``` text
68 requests
```

dan:

``` text
inventory?select=* = 57
```

Inventory termasuk master data yang tidak perlu di-download penuh setiap
ada perubahan kecil.

Target:

``` text
Realtime inventory change
       ↓
patch row
```

bukan:

``` text
Realtime inventory change
       ↓
SELECT * inventory
```

------------------------------------------------------------------------

# 17. Arsitektur yang Disarankan

## Saat startup

Gunakan:

``` text
App start
   ↓
Load required master data
   ↓
Cache locally
   ↓
Open Realtime subscriptions
```

Bukan:

``` text
App start
   ↓
Many schema probes
   ↓
Many full table fetches
   ↓
Many subscriptions
```

------------------------------------------------------------------------

# 18. Realtime Architecture

Gunakan satu subscription owner untuk setiap domain.

Contoh:

``` text
Menu Store
    └── menus subscription

Inventory Store
    └── inventory subscription

Customer Store
    └── customers subscription

Settings Store
    └── settings subscription

Transaction Store
    └── transactions subscription
```

Hindari:

``` text
App.tsx
    └── menus subscription

POS.tsx
    └── menus subscription
```

------------------------------------------------------------------------

# 19. Data Fetch Strategy

## Master Data

Untuk:

``` text
menus
menu_components
inventory
customers
settings
promos
users
```

gunakan:

``` text
Initial fetch
      ↓
Local state/cache
      ↓
Realtime patch
```

## Transactions

Jangan selalu mengambil:

``` text
500 rows
```

Gunakan sesuai kebutuhan halaman:

``` text
Dashboard
    → aggregate / summary

KDS
    → active/recent transactions

Transaction history
    → pagination

Reports
    → SQL/RPC aggregation
```

------------------------------------------------------------------------

# 20. Reporting

Jangan mengambil seluruh transaksi ke browser hanya untuk menghitung:

``` text
total omzet
jumlah transaksi
total payment
total discount
total tax
```

Jika memungkinkan gunakan:

``` text
PostgreSQL function / RPC
```

untuk melakukan agregasi di server.

Contoh konsep:

``` text
Browser
   ↓
RPC get_daily_sales_summary()
   ↓
Postgres aggregate
   ↓
small response
```

Ini jauh lebih hemat dibanding:

``` text
Browser
   ↓
SELECT * transactions
   ↓
download hundreds/thousands rows
   ↓
calculate in browser
```

------------------------------------------------------------------------

# 21. Target Perbaikan

Agent AI harus mengoptimalkan:

### Prioritas P0

1.  Hilangkan duplicate Realtime subscriptions.
2.  Jangan melakukan full-table reload setelah Realtime event.
3.  Perbaiki `visibilitychange`.
4.  Pastikan reconnect tidak membuat subscription duplicate.
5.  Pertahankan transaction realtime upsert yang sudah ada.

### Prioritas P1

6.  Kurangi `SELECT *`.
7.  Kurangi full transaction fetch.
8.  Tambahkan pagination.
9.  Cache settings.
10. Cache master data.
11. Kurangi customer full fetch.
12. Kurangi menu/components full fetch.

### Prioritas P2

13. Hilangkan schema probing berulang saat startup.
14. Gunakan migration/versioning yang eksplisit.
15. Gunakan RPC/SQL aggregation untuk laporan.
16. Audit semua `loadFromCloud()` dan `fetch*FromCloud()`.

------------------------------------------------------------------------

# 22. Aturan Penting untuk Agent AI

## JANGAN

-   Jangan menghapus fitur POS.
-   Jangan mengubah business logic transaksi.
-   Jangan mengubah struktur database tanpa alasan.
-   Jangan menghapus Realtime.
-   Jangan menghapus offline support.
-   Jangan menghapus IndexedDB.
-   Jangan mengubah Pending Payment.
-   Jangan mengubah Split Bill.
-   Jangan mengubah KDS workflow.
-   Jangan mengubah printer workflow.
-   Jangan melakukan rewrite besar-besaran.
-   Jangan mengganti semua fetch dengan cache tanpa memahami consistency
    requirement.

## WAJIB

Sebelum mengubah kode:

1.  Cari semua:

    ``` text
    loadFromCloud
    fetch*FromCloud
    select('*')
    .select('*')
    subscribe
    postgres_changes
    visibilitychange
    online
    runMigrations
    ```

2.  Buat dependency map:

    ``` text
    event
       ↓
    handler
       ↓
    function
       ↓
    Supabase query
    ```

3.  Identifikasi setiap query yang dapat berjalan:

    -   startup
    -   reconnect
    -   visibility change
    -   Realtime event
    -   user action

4.  Pastikan satu event tidak menyebabkan duplicate fetch.

5.  Setelah perubahan, lakukan build/typecheck/test.

------------------------------------------------------------------------

# 23. Acceptance Criteria

Perbaikan dianggap berhasil jika:

### Realtime

``` text
INSERT → patch row
UPDATE → patch row
DELETE → remove row
```

dan tidak menyebabkan full-table reload kecuali memang diperlukan.

### Subscription

Setiap domain memiliki maksimal satu active subscription pada lifecycle
yang sama.

### Visibility

Kembali ke tab tidak otomatis melakukan full reload semua tabel.

### Transactions

Tidak melakukan download 500 transaksi hanya karena satu transaksi baru
masuk.

### Settings

Tidak membaca settings berkali-kali dalam satu session tanpa alasan.

### Master data

Menu/inventory/customer tidak di-download ulang penuh setelah perubahan
satu row.

### Schema

Tidak melakukan puluhan schema-detection request setiap startup jika
schema sudah diketahui.

### Build

``` text
npm run build
```

harus tetap berhasil.

Jika project memiliki test/typecheck:

``` text
npm run typecheck
npm test
```

jalankan juga sesuai script yang tersedia.

------------------------------------------------------------------------

# 24. Monitoring Setelah Fix

Setelah deployment, bandingkan API Gateway log sebelum dan sesudah.

Yang perlu diperhatikan:

``` text
GET requests
SELECT * requests
transactions SELECT *
menus SELECT *
inventory SELECT *
customers SELECT *
settings requests
menu_components requests
Realtime reconnects
burst requests/minute
```

Tujuan utamanya bukan sekadar mengurangi jumlah request.

Yang lebih penting:

> **Kurangi total bytes yang keluar dari Supabase.**

Karena billing egress berdasarkan data yang ditransfer, bukan hanya
jumlah HTTP request.

------------------------------------------------------------------------

# 25. Expected Architecture

Arsitektur target:

``` text
                 ┌─────────────────┐
                 │   Supabase      │
                 │ PostgreSQL      │
                 └────────┬────────┘
                          │
                    Realtime events
                          │
                          ▼
                 ┌─────────────────┐
                 │ Single Store    │
                 │ Subscription    │
                 └────────┬────────┘
                          │
                INSERT / UPDATE / DELETE
                          │
                          ▼
                 ┌─────────────────┐
                 │ Local State     │
                 │ Zustand         │
                 └────────┬────────┘
                          │
                          ▼
                 ┌─────────────────┐
                 │ POS / KDS / UI  │
                 └─────────────────┘
```

Untuk data yang cocok:

``` text
Supabase
   ↓
Initial fetch
   ↓
Local cache
   ↓
Realtime patch
   ↓
UI
```

Bukan:

``` text
Supabase
   ↓
Realtime event
   ↓
SELECT entire table
   ↓
Download everything again
   ↓
UI
```

------------------------------------------------------------------------

# 26. Instruksi Singkat untuk Agent

> Audit codebase BerdikariPOS-Leter berdasarkan dokumen ini. Fokus utama
> adalah mengurangi Supabase PostgREST Egress tanpa mengubah business
> logic.
>
> Prioritaskan duplicate subscriptions, Realtime → full reload,
> visibilitychange reconnect, schema probing, SELECT \*, full
> transaction fetch, dan caching master data.
>
> Jangan melakukan rewrite besar.
>
> Sebelum coding, petakan semua jalur yang memanggil `loadFromCloud()`,
> `fetch*FromCloud()`, Supabase `.select('*')`, Realtime subscriptions,
> `visibilitychange`, `online`, dan `runMigrations()`.
>
> Untuk Realtime, gunakan row-level patch dari `payload.new` /
> `payload.old` jika memungkinkan.
>
> Pertahankan offline queue, IndexedDB, Pending Payment, Split Bill,
> KDS, inventory, bundling, printer workflow, dan transaction realtime
> upsert.
>
> Setelah perubahan, jalankan build/typecheck/test yang tersedia dan
> laporkan: 1. file yang diubah, 2. masalah yang ditemukan, 3. perubahan
> yang dilakukan, 4. query yang dikurangi, 5. risiko consistency yang
> mungkin muncul, 6. hasil build/test.

------------------------------------------------------------------------

# 27. Kesimpulan

Codebase terbaru menunjukkan bahwa BerdikariPOS sudah memiliki beberapa
fondasi yang baik, khususnya:

-   IndexedDB
-   offline support
-   transaction realtime upsert
-   Supabase Realtime
-   local state

Masalah utama ada pada **cara aplikasi melakukan cloud read**.

Prioritas perbaikan:

``` text
STOP:
Realtime → full reload

STOP:
duplicate subscriptions

STOP:
visibility → full reload

REDUCE:
SELECT *

REDUCE:
transactions LIMIT 500

REDUCE:
startup schema probes

ADD:
local cache

ADD:
pagination

ADD:
row-level realtime patch

ADD:
RPC aggregation
```

Target akhirnya:

``` text
1 perubahan data
       ↓
1 realtime event
       ↓
1 local state update
       ↓
0 full-table reload
```

Bukan:

``` text
1 perubahan data
       ↓
2+ subscriptions
       ↓
2+ full reload
       ↓
many SELECT *
       ↓
large JSON responses
       ↓
high Supabase Egress
```

**Catatan:** angka egress per endpoint belum dapat dihitung secara
presisi dari API Gateway CSV karena log tidak menyertakan response byte
size. Hubungan antara pola request dan egress adalah analisis berbasis
kombinasi log + codebase dan tetap perlu divalidasi melalui monitoring
setelah perbaikan.
