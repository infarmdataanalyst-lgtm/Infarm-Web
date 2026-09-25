# Pergudangan (Gudang Cabang)

> Dipecah dari `CLAUDE.md` (2026-08-14). Isi dipindahkan APA ADANYA, tanpa pemangkasan.
> Kembali ke ringkasan: [CLAUDE.md](../CLAUDE.md)

## Pergudangan — GUDANG CABANG (multi-gudang) adalah mode resmi sistem

**Keputusan bisnis (2026-08-11, final): infarm beroperasi dengan GUDANG CABANG.** Mode multi bukan
opsi atau rencana.

**Mode disimpan di DATABASE, bukan env** (2026-08-12): baris `store_settings.warehouse_mode`, diubah
lewat **toggle di OMS → Gudang**. Berlaku SEKETIKA tanpa redeploy — itu inti tujuannya: toko
dijalankan satu developer, jadi tuas rollback harus bisa ditarik kapan saja. Env `WAREHOUSE_MODE`
sudah **dihapus**; jangan dihidupkan lagi (dua sumber kebenaran).

Gagal membaca setting (DB down / baris belum ada) → `'multi'`, konsisten dengan mode resmi. Aman
karena query stok per gudang juga gagal saat itu sehingga pemilihan jatuh ke gudang default.
Nilai `single` = rollback darurat: sistem memakai gudang default saja, tanpa query stok/ongkir.

Konsekuensi saat menulis kode baru: **jangan pernah berasumsi hanya ada satu gudang**, dan jangan
membaca stok/origin di luar `src/lib/warehouse.ts`.

**Yang harus diisi admin agar gudang cabang benar-benar bermanfaat** (bukan prasyarat teknis —
sistem tetap jalan tanpanya, hanya jatuh ke gudang default):
1. Gudang cabang dibuat di OMS → Gudang dengan **`mengantar_origin_id` terisi**. Itu satu-satunya
   field yang menentukan hasil: tanpa origin id, gudang itu tak bisa dibandingkan ongkirnya.
2. `latitude`/`longitude` **TIDAK perlu diisi** — pemilihan gudang memakai perbandingan ongkir riil,
   bukan jarak. Kolomnya tetap ada untuk keperluan peta di masa depan (keduanya masih `null`).
3. Stok tiap produk dialokasikan per gudang lewat **OMS → Gudang → Kelola Stok**. Gudang tanpa baris
   stok dianggap tak memenuhi apa pun, jadi tak ikut dibandingkan ongkirnya.
4. **Produk bervarian sudah didukung**: stok per gudang per varian diatur dari matrix Kelola Stok
   (baris produk dibuka `▸`). Tak perlu lagi jalur SQL manual.

- **Tabel** (migration `20260811120000_init_warehouses.sql`):
  - `warehouses` — `nama`, `alamat`, `mengantar_origin_id`, `latitude`/`longitude`, `is_default`,
    `is_active`. Hanya BOLEH satu default (dijaga index partial `warehouses_single_default_idx`).
  - `product_stock_per_warehouse` — `product_id`, **`variant_id` (nullable)**, `warehouse_id`, `stok`.
    Keunikan dijaga DUA index partial (`variant_id is null` vs `is not null`) karena Postgres
    menganggap NULL selalu berbeda sehingga UNIQUE biasa tak mencegah baris ganda.
  - `orders.warehouse_id` (nullable) — gudang pemenuh; NULL untuk pesanan sebelum migration.
  - RLS aktif TANPA policy publik di kedua tabel (origin_id & stok per gudang = data operasional).
- **Kolom stok lama TETAP ADA & tidak boleh dihapus**: `products.stock` dan `product_variants.stok`.
  Statusnya kini **fallback**, bukan sumber kebenaran. Semua jalur baca/tulis punya penanganan bila
  tabel gudang belum di-apply (kode `PGRST205`/`PGRST204`/`42P01`/`42703` → anggap belum ada).
- **SATU pintu akses: `src/lib/warehouse.ts`** (server-only). Komponen/route **JANGAN** membaca
  setting mode, `*MENGANTAR_ORIGIN_ID`, atau kolom stok mentah sendiri:
  - `getWarehouseMode()` / `isMultiWarehouse()` — **async** (baca `store_settings`); default
    `'multi'`. Semua pemanggil WAJIB `await` — tanpa await nilainya Promise dan mode diam-diam
    dianggap salah (bug ini pernah terjadi di `/api/warehouses/list`)
  - `setWarehouseMode(mode)` — dipakai toggle OMS lewat `PATCH /api/settings/warehouse-mode`
  - `getDefaultWarehouse()`
  - `resolveWarehouseForOrder(items)` — **FALLBACK saja** (bukan jalur utama): mode single → gudang
    default tanpa query; mode multi → gudang ber-stok cukup, default didahulukan. **Tanpa jarak.**
  - `getEffectiveStock(productId, {variantId, warehouseId})` — single: JUMLAH semua gudang; multi:
    stok gudang tertentu. **`getEffectiveStockMaps(ids)` = versi batch, WAJIB dipakai untuk daftar**
    (per-produk = N+1 query)
  - `writeEffectiveStock(...)`, `returnStockToWarehouse(...)`, `getOriginIdForWarehouse(id)`
- **Pemilihan gudang = PERBANDINGAN ONGKIR RIIL, bukan jarak** (`src/lib/warehouse-shipping.ts`):
  - `resolveShippingOptions(items, destinationId, weight)` — gudang aktif ber-stok cukup → panggil
    `allEstimatePublic` **paralel** (`Promise.allSettled`, timeout 4,5s/gudang) → gabungkan semua
    kurir + tandai `warehouseId` → urut termurah. Gudang yang gagal/timeout **dilewati**, tidak
    menggagalkan yang lain.
  - Hasilnya di-cache in-memory 10 menit (`getCachedShippingOptions`) — bukan untuk performa, tapi
    agar `orders/create` bisa jatuh ke opsi termurah berikutnya **tanpa memanggil Mengantar lagi**.
  - **Haversine SUDAH DIHAPUS.** Kolom `latitude`/`longitude` tetap ada tapi TIDAK boleh jadi dasar
    keputusan gudang — jarak lurus bukan ukuran biaya kirim. Bukti pada data infarm (tujuan sama,
    1kg): JNE dari Gudang Utama Rp10.900, dari Gudang Jakarta Rp8.000.
  - Endpoint checkout: `POST /api/mengantar/shipping/options` (POST karena isi keranjang ikut
    dikirim). `GET .../shipping/estimate` (satu gudang) dipertahankan untuk pemanggil lama.
- **Data layer sudah diarahkan**: `readProducts`/`getProductById` menimpa field `stock` dengan stok
  efektif (`applyEffectiveStock`, batch) → **seluruh storefront & OMS otomatis** memakai stok gudang
  tanpa mengubah komponen. `updateProduct` **tidak lagi menulis `products.stock`** (hanya menulis ke
  gudang; kolom lama diisi ulang HANYA bila penulisan gudang gagal). `saveProduct`/`createVariant`
  mengisi baris gudang + kolom lama sebagai cadangan awal.
- **Gudang order = ikut kurir pilihan buyer**, lalu **diverifikasi ulang di server**
  (`orders/create` → `pickVerifiedWarehouse`): gudang harus ada, aktif, dan stoknya masih cukup
  (data fresh). Gagal → opsi termurah berikutnya dari cache perbandingan → `resolveWarehouseForOrder`.
  Ini guard race condition: stok bisa habis di antara buyer melihat ongkir dan menekan bayar.
  Client mengirim `warehouseId` + `weight`, keduanya **tidak dipercaya mentah**.
- **Checkout tetap atomik**: RPC `create_order_with_items` dapat param `p_warehouse_id` dan
  mengurangi `product_stock_per_warehouse` (dikunci `FOR UPDATE`) **plus mirror** ke kolom lama.
  Bila baris gudang tak ada, RPC otomatis kembali ke perilaku lama. `saveOrder` punya fallback:
  RPC versi lama (`PGRST202`/`42883`) → kirim ulang tanpa param gudang.
- **Cek ongkir** (`/api/mengantar/shipping/estimate`) mengambil `origin_id` dari
  `getOriginIdForWarehouse()`, bukan env langsung. Param opsional
  `items=<productId>:<qty>[:<variantId>],…` dipakai memilih gudang asal di mode multi; **diabaikan**
  di mode single.
- **Gudang terlihat & bisa difilter di halaman Pesanan OMS**: kolom **Gudang** (setelah kolom Status)
  + filter **MULTI-SELECT** (checkbox: "Semua gudang" / tiap gudang aktif / "Belum ditentukan"),
  bisa dikombinasikan dengan filter lain. Detailnya:
  - Nama gudang di-resolve di data layer (`resolveWarehouseNames` di `mock-db/orders.ts`) dan
    dilampirkan sebagai `Order.warehouseName` — hanya untuk OMS, TIDAK pernah dikirim ke storefront
    (`getOrdersByPhone` sengaja tak memakainya).
  - Peta nama dibangun dari **semua** gudang termasuk yang **nonaktif**: pesanan lama bisa dipenuhi
    gudang yang kini dinonaktifkan, dan riwayatnya harus tetap terbaca. Sebaliknya **dropdown filter
    hanya menawarkan gudang aktif** (gudang nonaktif tak lagi menerima pesanan baru).
  - **Pesanan lama** (`orders.warehouse_id` NULL — 43 dari 47 baris per 2026-08-14) tampil sebagai
    "Belum ditentukan", dan bisa dicari lewat opsi `none` (`WAREHOUSE_FILTER_NONE`) →
    `.is('warehouse_id', null)`. **Pakai `.is()`, bukan `.eq()`/`.in()`** — NULL tak pernah cocok
    dengan perbandingan biasa di SQL, jadi keduanya mengembalikan nol baris tanpa error.
  - **`OrderFilterOptions.gudang` bertipe `string[]`** (bukan `string`). Tiga cabang di
    `readOrdersFiltered`:
    | Pilihan | Klausa |
    |---|---|
    | hanya id gudang | `.in('warehouse_id', ids)` |
    | hanya `none` | `.is('warehouse_id', null)` |
    | id gudang **+** `none` | **SATU** `.or('warehouse_id.in.(…),warehouse_id.is.null')` |
    ⚠️ Cabang ketiga TIDAK boleh ditulis sebagai `.in(...).is(...)` — rangkaian itu jadi **AND**
    ("ada di daftar DAN sekaligus NULL"), mustahil benar, tabel tampil **kosong tanpa error apa pun**.
  - Nilai `gudang` di URL = **daftar berkoma** (`gudang=id1,id2,none`), pola sama `?category=a,b` di
    katalog. Route memvalidasi **per item** (`UUID_REGEX` atau `'none'`) lalu men-dedupe; item tak
    valid dibuang tanpa menggagalkan request, supaya bookmark/URL lama tetap menampilkan data.
  - **UI = `src/components/oms/WarehouseMultiFilter.tsx`** (popover tangan sendiri), BUKAN `<select>`:
    - `<select>` native tak bisa memuat checkbox, dan highlight `<option>` digambar OS (biru) —
      **tak bisa diwarnai lewat CSS halaman**. Itu satu-satunya sebab warna birunya; tak pernah ada
      hex biru di kode halaman ini. Persoalan identik pernah muncul di sort katalog storefront.
    - Bukan Headless UI `Listbox` walau sudah terpasang: panel ini butuh footer aksi
      ("Reset" + "Terapkan"), sementara Listbox menganggap seluruh isi panel sebagai daftar opsi.
      Pola tutup (`pointerdown` + `Escape`) sama dengan `NotificationBell`/`ProfileIconLink`/`MiniCart`.
    - **Model draft**: mencentang TIDAK langsung menyaring — panel tak tertutup, perubahan baru
      berlaku saat "Terapkan" (satu request untuk beberapa pilihan). Menutup panel/`Escape`
      **membatalkan** draft. "Reset" mengosongkan draft saja, tetap butuh "Terapkan" — supaya
      modelnya satu, tidak setengah-instan.
    - **Array kosong = "Semua gudang"**, tidak ada state ketiga. Karena itu melepas centang terakhir
      otomatis kembali ke "Semua gudang" tanpa penanganan khusus, dan "Semua gudang" hanyalah
      shortcut `setDraft([])`.
    - Label tombol: `Semua gudang` / nama gudang bila tepat satu / `N Gudang dipilih` bila lebih.
    - Warna hijau brand `brand-primary` (**#00843b** — bukan `#2E7D32`): border+ring tombol saat
      terbuka, kotak checkbox saat dicentang (centang PUTIH, pola sama keranjang & katalog), hover
      baris `bg-brand-surface`, tombol "Terapkan" solid.
  - **Empat dropdown lain di halaman ini (Kurir, Status Pembayaran, Urutkan, arah urut) MASIH
    `<select>` native** → highlight birunya masih muncul di sana. Disadari & diterima (keputusan
    2026-08-14: kerjakan Gudang saja). Kalau nanti disamakan, `WarehouseMultiFilter` bisa jadi
    acuan polanya.
- **Catatan data**: 18 baris `orders` punya `order_status` NULL (baris warisan sebelum enum status
  ada) → kolom Status menampilkan "—" dan baris itu tak ikut filter status apa pun. Bukan bug filter.

### Daftar Gudang (OMS) — sudah terpasang

- **Halaman**: `/oms/dashboard/gudang` (client, kartu per gudang + modal tambah/edit) — sub-halaman
  pertama area Gudang. Mode pergudangan **bisa diubah dari sini** lewat toggle
  (`PATCH /api/settings/warehouse-mode`, tersimpan di `store_settings`, berlaku seketika).
- **API** `/api/warehouses/{list,create,update,set-default,toggle,delete}` — **SEMUA `requireAdmin()`**,
  termasuk `list`: barisnya memuat `mengantar_origin_id` & koordinat, data operasional yang tak boleh
  ter-expose ke publik. Storefront tak pernah menyentuh endpoint ini.
- **Validasi** di `src/lib/warehouse-validation.ts` (dipakai form DAN server): nama 3–100, alamat ≤300,
  `mengantar_origin_id` wajib ObjectId 24 hex bila diisi, latitude −90..90, longitude −180..180.
  Koordinat divalidasi **berpasangan** — mengisi salah satu saja ditolak, karena gudang berkoordinat
  separuh tetap dianggap "tak punya koordinat" (diurutkan paling akhir) dan itu menyesatkan.
- **Tiga penjagaan yang ditegakkan di SERVER** (bukan hanya disembunyikan di UI):
  1. Gudang default **tak bisa dihapus & tak bisa dinonaktifkan** (`409 DEFAULT_WAREHOUSE`) — di mode
     single ia satu-satunya sumber stok & origin ongkir. Tunjuk default baru dulu.
  2. Gudang yang punya baris stok / pesanan **tak bisa dihapus** (`409 WAREHOUSE_IN_USE`, disertai
     jumlahnya) → arahkan ke "Nonaktifkan". FK `on delete restrict` juga menolaknya di level DB,
     tapi 409 memberi pesan yang bisa dibaca admin alih-alih error 500.
  3. `set-default` otomatis **mengaktifkan** gudang tersebut + melepas default lama (index partial
     `warehouses_single_default_idx` menolak dua default sekaligus).
- Setiap mutasi memanggil `revalidateTag('products', 'max')` karena gudang default menentukan stok
  efektif & origin ongkir.
### Sub-halaman area Gudang (OMS)

Menu **Gudang** punya tiga sub-halaman; sidebar (`components/oms/Sidebar.tsx`, `NAV_ITEMS[].children`,
sub-menu hanya dirender saat induknya aktif) dan `GudangTabs` di dalam halaman memakai daftar yang sama:

| Sub-halaman | Rute | Isi |
|---|---|---|
| Daftar Gudang | `/oms/dashboard/gudang` | master data gudang + toggle mode |
| Kelola Stok | `/oms/dashboard/gudang/stok` | matrix produk × gudang — **satu-satunya tempat stok bisa diedit** |
| Riwayat Mutasi | `/oms/dashboard/gudang/riwayat` | daftar kronologis `stock_mutations` |

**Pencocokan rute wajib PERSIS** (`pathname === href`) untuk sub-menu/tab: href "Daftar Gudang"
adalah prefiks dua href lainnya, jadi `startsWith` akan menyalakan ketiganya sekaligus.

### Kelola Stok Gudang (matrix) — SATU-SATUNYA tempat mengedit stok

- **Baca**: `GET /api/warehouses/stock/matrix` — sesi admin apa pun perannya (staff perlu melihat
  stok). Satu respons berisi mode, `role`, `canEdit`, gudang **aktif**, dan semua produk beserta
  `cells` per gudang + `variants[]`. Gudang nonaktif TIDAK ditampilkan (stoknya tak dipakai memenuhi
  pesanan, jadi mengeditnya menyesatkan); datanya tetap utuh.
- **Tulis**: `POST /api/warehouses/stock/set` — **`requireStockEditor()`**: sesi valid + peran
  `admin`; peran `staff` → `403 FORBIDDEN_ROLE`. Payload `{ changes: [{productId, variantId?,
  warehouseId, stok}] }`, maks 100 → **satu request = satu baris produk** (bukan satu sel).
  Urutannya: validasi SELURUH entri dulu (satu cacat → `422`, **tak ada** yang ditulis) → baca nilai
  lama → `setWarehouseStock` per entri → selaraskan kolom lama bila varian → catat `stock_mutations`
  (satu insert) → `revalidateTag('products','max')` + `revalidatePath`. Respons memuat `previous[]`
  (nilai lama dari server) supaya UI bisa menawarkan undo tanpa menebak.

#### Mode edit eksplisit (menggantikan autosave) — enam lapis anti human error

Versi pertama halaman ini menyimpan otomatis saat blur. Dibuang: satu ketikan tak sengaja langsung
mengubah stok yang dilihat pembeli dan menentukan pesanan bisa masuk atau tidak.

1. **Baris read-only** — menyentuh tabel tidak mengubah apa pun.
2. **Tombol "Edit" per baris** (kolom **Aksi**; kolom "Riwayat" per baris DIHAPUS, riwayat kini lewat
   tautan di bawah tabel). **Satu baris saja** yang bisa dibuka; baris lain diredupkan & tombolnya
   dinonaktifkan, filter + pencarian dikunci selama mengedit (mengganti kolom yang tampil di tengah
   pengeditan akan menyembunyikan sel yang sudah diubah tapi belum disimpan).
3. **Indikator perubahan** — sel yang berbeda dari nilai tersimpan jadi kuning + keterangan
   `lama → baru (+/−delta)`; kolom Total menampilkan pratinjau + angka lama tercoret; bilah aksi
   baris merangkum semua perubahan sebagai teks.
4. **Undo & Batal** — Undo memulihkan seluruh sel baris ke nilai tersimpan (tanpa request); Batal
   keluar dari mode edit. Sel dikosongkan → Simpan diblokir dengan pesan (BUKAN diam-diam jadi 0).
5. **Dialog konfirmasi** — rekap per sel (`lama` tercoret → `baru` + delta) sebelum request dikirim.
6. **Undo setelah simpan** — toast 12 detik dengan tombol "Batalkan" yang menulis balik `previous[]`
   dari server. Ini **compensating write**: riwayat memuat DUA baris (perubahan + pembatalannya),
   bukan menghapus jejak yang pertama.

Produk bervarian otomatis dibuka saat masuk mode edit (sel yang bisa diedit ada di sub-baris varian),
dan barisnya tak bisa ditutup selama diedit.
- **Kolom Total selalu read-only** dan menjumlahkan **SEMUA gudang aktif**, bukan hanya kolom yang
  sedang tampil. Alasannya: angka itu harus sama dengan kolom Stok di halaman Produk dan dengan stok
  yang dilihat pembeli. Filter gudang hanya **menyembunyikan kolom**.
- **Produk bervarian**: sel level-produk **DIKUNCI** (ikon gembok), baris dibuka `▸` untuk mengedit
  per varian. Menulis di level produk akan membuat baris `variant_id NULL` yang berjalan paralel
  dengan baris varian → total ganda. Ini menutup celah "stok varian per gudang belum ada UI".
- **Pencarian client-side, tanpa paginasi** — jumlah produk saat ini 11. Ambang pindah ke server-side
  + paginasi: **~200 produk**, dan tempat mengubahnya adalah endpoint `stock/matrix` (payload sudah
  per produk sehingga UI tak perlu berubah).
- `<input type="text" inputMode="numeric">`, bukan `type="number"`: panah spinner mudah tersenggol
  saat men-scroll tabel. Indikator per sel: spinner saat menyimpan → centang 1,5s → ikon merah + pesan
  di bawah sel bila gagal. `Escape` memulihkan nilai terakhir; sel dikosongkan lalu blur = tidak menyimpan.

### Stok di form produk (OMS) — Tambah = bisa, Edit = read-only

- **Tambah Produk** (`products/upload`) TETAP punya input stok awal (`WarehouseStockFields`:
  satu input di mode single, per gudang di mode multi + total). Alasannya sengaja: memaksa admin
  membuka dua halaman hanya untuk mengisi stok pertama akan memperlambat alur yang paling sering dipakai.
  Payload `stockPerWarehouse` divalidasi `parseStockPerWarehouse()` sebelum produk dibuat, ditulis
  `writeStockPerWarehouse()` setelahnya, lalu dicatat ke riwayat dengan alasan `product_form`
  (stok sebelum = 0, supaya baris pertama riwayat sebuah produk tidak "muncul entah dari mana").
- **Modal Edit Produk** (`products/page.tsx`) **TIDAK LAGI** punya input stok — diganti kotak
  read-only berikon gembok ("Total stok, semua gudang" + angka) dan tautan
  `Kelola stok gudang → /oms/dashboard/gudang/stok?search=<sku>`. Field `stock` &
  `stockPerWarehouse` **sengaja tidak dikirim** ke `/api/products/update`; tanpa field itu route
  membiarkan stok apa adanya. Validasi `stock` juga dilepas dari `editErrors`.
- `/api/products/update` **masih menerima** `stockPerWarehouse` untuk pemanggil lain/skrip, dan
  cabang itu ikut mencatat riwayat (`product_form`). **Kalau menambah titik tulis stok baru, WAJIB
  ikut mencatat lewat `src/lib/stock-audit.ts`** — kalau bolong, riwayat berbohong.
- **Stok varian kini otoritatif dari gudang**: `getVariantsByProduct` meng-overlay `stock` varian
  dari `product_stock_per_warehouse` (jumlah semua gudang). Sebelumnya `byVariant` dihitung tapi tak
  pernah dipakai, sehingga stok varian yang diedit tak akan pernah terlihat di storefront.
  Kolom lama `product_variants.stok` tetap diselaraskan (`syncVariantLegacyStock`) sebagai jaring pengaman.
- **Belum dikerjakan**: mutasi/transfer stok ANTAR gudang (butuh tabel `stock_transfers` sendiri —
  beda dari `stock_mutations` yang mencatat perubahan, bukan perpindahan).

### Riwayat Mutasi Stok (`stock_mutations`)

- **Migration** `supabase/migrations/20260813120000_init_stock_mutations.sql`. RLS aktif TANPA policy
  publik (riwayat stok mengungkap volume penjualan & sebaran gudang).
- **`changed_by` mengarah ke `admin_users(id)`, BUKAN `auth.users(id)`** — project ini tidak memakai
  Supabase Auth. `getAdminId()` (cookie sesi HMAC) sudah mengembalikan UUID admin, jadi tak perlu
  perubahan auth. Perubahan yang dipicu pembeli (pesanan/pembatalan) sengaja `NULL` → UI menampilkan
  "Sistem (pembeli)". `admin_users` tak punya kolom email; yang ditampilkan `name` (fallback `username`).
- **Semua FK `ON DELETE SET NULL` + snapshot nama** (`product_name`, `variant_name`, `warehouse_name`,
  `order_invoice`). `restrict` akan mematikan aksi massal "Hapus produk" begitu produk punya riwayat;
  `cascade` menghapus jejak audit justru saat paling dibutuhkan. Snapshot membuat riwayat tetap
  terbaca setelah barisnya hilang (pola sama `order_items` & `product_combo_items`).
- **Empat `reason`** (dijaga CHECK constraint — menambah nilai baru WAJIB ubah constraint juga):
  `manual_update` (matrix Kelola Stok) · `product_form` · `order` (pesanan masuk) ·
  `order_cancelled` (pembatalan, ketiga jalurnya: token, by-phone, dan update-status OMS).
- **Dicatat dari APLIKASI, bukan trigger DB** — lebih mudah di-debug solo dev, dan hanya lapisan app
  yang tahu admin mana yang login. Titik masuk tunggal: `src/lib/stock-audit.ts`
  (`recordAdminStockChanges`, `recordOrderStockChanges`).
- Untuk pesanan, nilai **"sesudah" dibaca dari DB setelah** RPC/restore selesai, lalu "sebelum"
  dihitung dari quantity. Yang wajib benar adalah stok akhir; membacanya setelah perubahan
  menghindari kunci baris tambahan hanya demi riwayat. `order_id` diisi lewat
  `getOrderUuidByInvoice()` karena lapisan app memakai `nomor_invoice`, sedangkan FK butuh `orders.id`.
- **Pencatatan BEST EFFORT**: gagal menulis riwayat tak pernah menggagalkan perubahan stok atau
  pembuatan pesanan (error ditelan + `console.error`). Tabel belum di-migrate → kode `PGRST205`
  dianggap "belum ada" dan halaman riwayat tampil kosong.

