# OMS: Header, Dashboard, Halaman Produk

> Dipecah dari `CLAUDE.md` (2026-08-14). Isi dipindahkan APA ADANYA, tanpa pemangkasan.
> Kembali ke ringkasan: [CLAUDE.md](../CLAUDE.md)
>
> Tiga section terakhir (Foto Produk Multi, Harga Coret, Produk Terlaris) tidak disebut
> eksplisit dalam rencana pemecahan; ditaruh di sini karena datanya diinput lewat form
> produk OMS dan dibaca bersama "Validasi Form Produk".

## Header OMS: Notifikasi & Pengaturan — sudah terpasang

`OmsHeader` (client, dipakai SEMUA halaman OMS) kini tiga bagian kanannya nyata, bukan tombol mati:
ikon gear → `/oms/dashboard/pengaturan`, lonceng → `NotificationBell`, dan **nama + peran admin
diambil dari `GET /api/oms/me`**. Teks hardcode "Admin Utama / Manager Operasional" sudah dihapus —
dua jabatan itu tak pernah ada di sistem peran (`admin_users.role` hanya `admin` | `staff`).
Prop `notificationCount={3}` yang di-hardcode di 10 halaman juga dihapus (lencana palsu).

### Notifikasi DIHITUNG real-time, BUKAN tabel persisten

**Tidak ada tabel `notifications`.** `src/lib/mock-db/notifications.ts` menghitung dari keadaan
terkini setiap kali diminta. Alasannya (keputusan pemilik toko 2026-08-14):

| | Tabel persisten | Computed (dipilih) |
|---|---|---|
| Produsen data | insert di **tiap** titik tulis (RPC checkout, `stock/set`, 3 jalur cancel, form produk) — fan-out sama seperti `stock-audit.ts`, satu titik lupa = notifikasi bohong | nol titik tulis |
| Data lama | kosong sampai ada event baru | 19 pesanan lama langsung tampil |
| Basi | "Sprayer habis" tetap muncul setelah restock | mustahil basi |

Konsekuensi yang **diterima sadar**: "sudah dibaca" tak bisa per-notifikasi. Yang disimpan hanya
SATU timestamp per admin: `store_settings` baris `notif_last_seen:<adminId>`. Kunci sengaja
**per admin** — kalau satu kunci dipakai bersama, admin A membuka panel dan lencana admin B ikut hilang.

- **Dua kategori**: `pesanan_baru` (orders ber-`order_status` ∈ `PENDING|PROCESSING`) dan
  `stok_habis` (produk non-arsip ber-stok efektif 0).
  - `order_status` NULL (18 baris warisan) **tidak ikut** — `.in()` memang tak pernah cocok dengan
    NULL, dan baris itu tak punya status yang bisa dipercaya.
  - Waktu "stok habis" diambil dari **`stock_mutations` ber-`stok_after = 0`** (terbaru per produk).
    Tabel `products` tak punya `updated_at`, jadi tanpa ini notifikasi stok tak bisa diurutkan
    bersama pesanan. Tabel riwayat hilang/belum di-migrate → notifikasi tetap tampil, hanya tanpa waktu.
  - `unread` = `lastSeen === null ? true : createdAt > lastSeen`. Notifikasi tanpa waktu dihitung
    belum dibaca **hanya sebelum panel pernah dibuka** — kalau selamanya, lencana merahnya tak akan
    pernah bisa hilang dan admin berhenti mempercayainya.
  - `SOURCE_LIMIT = 200` per sumber: pagar memori, bukan paginasi. Naikkan bila backlog rutin melewatinya.
- **Endpoint**: `GET /api/notifications?limit=&offset=` dan `POST /api/notifications/mark-read`,
  keduanya `requireAdmin()` (peran apa pun — staff perlu melihat). Isinya memuat nama pembeli &
  nilai pesanan, jadi tak boleh publik. Waktu `mark-read` diambil dari **server**, bukan body:
  jam browser yang salah/masa depan akan mematikan lencana selamanya.
- **`NotificationBell`**: lencana (`9+` bila >9), panel `absolute right-0 top-full` (10 teratas,
  ikon per kategori, waktu relatif, klik → navigasi + tutup), "Lihat Semua (N)" muncul hanya bila
  `total > 10`. Membuka panel = `mark-read` (lencana dinolkan optimistis; penanda `unread` per baris
  SENGAJA dibiarkan agar admin masih bisa melihat mana yang baru pada bukaan itu).
- **⚠️ POLLING 60 detik + refetch saat tab kembali fokus — Supabase Realtime TIDAK BISA DIPAKAI.**
  `orders`/`products` RLS-aktif tanpa policy publik, dan browser admin hanya memegang anon key
  (auth OMS = cookie HMAC sendiri, bukan Supabase Auth) → langganan `postgres_changes` menerima
  **nol baris**. Membuatnya jalan menuntut service_role di browser = dilarang mutlak.
  **Jangan coba pasang Realtime di sini tanpa lebih dulu memindahkan auth OMS ke Supabase Auth.**
- **Halaman `/oms/dashboard/notifikasi`** (client, paginasi 20/halaman). **Wajib di bawah
  `/oms/dashboard`**: guard di `proxy.ts` memakai matcher `/oms/dashboard/:path*`, jadi `/notifikasi`
  di root akan terbuka untuk siapa pun tanpa login. Tak ada entri sidebar — dijangkau dari
  "Lihat Semua" di panel lonceng.

### Halaman Pengaturan (`/oms/dashboard/pengaturan`) — tiga tab

Tiga section lewat tab horizontal, semuanya baris di **`store_settings`** (tak ada tabel baru,
tak ada migration): **Profil Toko** (`store_name`, `store_description`) · **Threshold Stok**
(`low_stock_threshold`) · **Minimum Belanja** (`min_order_amount`, yang sudah ada sebelumnya).

- **Peran**: halaman terbuka untuk sesi OMS apa pun, tapi **tombol Simpan hanya untuk `admin`**.
  Penyembunyian tombol BUKAN penjagaan — tiap endpoint tulis memanggil **`requireAdminRole(pesan)`**
  (baru di `oms-guard.ts`; `requireStockEditor()` kini tipis di atasnya) dan membalas `403`
  `FORBIDDEN_ROLE` untuk `staff`.
- **Alamat gudang di tab Profil Toko READ-ONLY**, hanya menampilkan gudang default + `origin id`
  + tautan ke `/oms/dashboard/gudang`. Sumber kebenarannya tabel `warehouses`. Menyalinnya ke
  `store_settings` = dua sumber kebenaran, kesalahan yang sama seperti env `WAREHOUSE_MODE` yang
  sudah dibuang. **Jangan jadikan field yang bisa diedit di sini.**
- **`LOW_STOCK_THRESHOLD` SUDAH DIGANTI `DEFAULT_LOW_STOCK_THRESHOLD`** (`product-validation.ts`).
  Konstanta itu kini hanya **nilai cadangan**; angka sebenarnya dibaca `getLowStockThreshold()`
  (server) atau `GET /api/settings/low-stock-threshold` (client, `requireAdmin`).
  Pemakainya: Dashboard (widget Stok Rendah, `await` di `Promise.all`), halaman Produk (state hasil
  fetch, nilai awal = konstanta bawaan), dan notifikasi stok. **Kalau menambah tempat baru yang
  membandingkan stok, ambil dari sini — jangan hardcode 10 lagi.**
  Minimal 1 (stok 0 selalu "habis"), maksimal `MAX_LOW_STOCK_THRESHOLD` (1.000) — ambang setinggi
  stok maksimum akan menandai seluruh katalog "menipis" dan peringatannya kehilangan arti.

## Dashboard OMS (`/oms/dashboard`) — Revenue Dashboard

Server Component (`dynamic = 'force-dynamic'`). **Tidak ada lagi data dummy di halaman ini** —
seluruh angka dari Supabase. Dua helper MURNI dipakai bersama server & client supaya logikanya
tidak terduplikasi: `src/lib/dashboard-period.ts` (periode/granularity) dan
`src/lib/dashboard-revenue.ts` (klasifikasi & agregasi + palet).

### Kenapa pendapatan WAJIB dipecah per status pembayaran

Selama Xendit belum terpasang, checkout menyimpan pesanan sebagai `PENDING` dan **langsung**
memotong stok. Satu angka "Total Pendapatan" gabungan karena itu menyesatkan — admin bisa
menganggap uangnya sudah masuk. Kondisi data per 2026-08-12: **`Lunas` Rp0, `Pending`
Rp5.376.699 (37 pesanan), `Dibatalkan` Rp634.300 (8 pesanan)**. **Jangan gabungkan kembali.**

- `categorizeRevenue()` — kategori **eksklusif**, urutan cek penting: `Dibatalkan` dulu (pesanan
  sudah dibayar lalu dibatalkan = refund, BUKAN pendapatan), lalu `Lunas`, sisanya `Pending`.
- **45 baris `orders` punya `status_pembayaran` NULL/`order_status` NULL** (baris warisan, skema
  awal dibuat manual di Dashboard) — 18 di antaranya NULL keduanya. `readOrdersForRevenue`
  memetakannya ke `Menunggu` (`?? 'Menunggu'`), jadi masuk `Pending`. Jangan menebak status lain.
- **Kartu ringkasan = `SUMMARY_STATS`, EMPAT kartu berjejer SATU BARIS** (keputusan pemilik toko
  2026-08-13, menggantikan kartu gabungan `RevenueBreakdownCard` yang dihapus). Urutan kiri→kanan:
  **Total Pendapatan Periode Ini** (`berjalan`, hint "Lunas + Pending · N pesanan") ·
  **Total Pesanan** (`semua.orderCount`) · **Rata-rata Nilai Pesanan** (AOV) ·
  **Dibatalkan / Gagal** (`upIsGood: false`).
- **Grid `grid-cols-1 sm:grid-cols-2 xl:grid-cols-4`** — turun bertahap, BUKAN 4→1 langsung.
  Memaksa 4 kolom di bawah 1280px menyisakan ~160px per kartu dan nilai serupa `Rp1.413.755`
  akan terlipat/terpotong. Jumlah kartu genap sehingga tahap 2 kolom pun tetap rapi (2×2), tak
  pernah ada kartu menggantung sendirian di baris terakhir. Lebar kartu terukur: 388px @1920 ·
  268px @1440 · 228px @1280 (masih muat, tanpa teks meluber).
- ⚠️ **Lunas & Pending TIDAK lagi punya kartu sendiri.** Konsekuensinya harus disadari: selama
  Xendit belum terpasang, kartu "Total Pendapatan" menampilkan uang yang sebagian besar **belum
  diterima** (per 2026-08-13: Lunas Rp0, Pending Rp1.413.755) — persis salah-baca yang dulu
  dicegah oleh breakdown. Peredamnya: pemecahan Lunas vs Pending **masih hidup di chart Tren
  Pendapatan + tampilan Tabel-nya**, dan `TOTAL_REVENUE_TOOLTIP` menunjuk ke sana.
  **Jangan hapus chart atau tampilan Tabel-nya** — sejak perubahan ini keduanya satu-satunya
  tempat admin bisa melihat berapa yang benar-benar sudah lunas. Kalau chart dipindah, perbarui
  juga kalimat tooltip itu.
- Tiap kartu punya chip ikon (`Wallet` · `ShoppingBag` · `Receipt` · `AlertTriangle`) berwarna
  nada masing-masing, nilai, keterangan singkat, badge delta, dan ikon info bertooltip
  (`InfoHint`, tooltip CSS murni — jangan ubah jadi komponen client hanya untuk tooltip).
  Kartu pendapatan memakai warna dari `REVENUE_COLORS` supaya cocok dengan legend chart;
  kartu operasional memakai nada brand (aksennya dekorasi, bukan pembawa data).
- **`InfoHint`: panel tooltip dipaku ke ancestor ber-`relative` terdekat, bukan ke ikonnya.**
  Wrapper ikon sengaja tidak `relative`; panel memakai `left-0 right-0 max-w-[15rem]` sehingga
  lebarnya = min(lebar kontainer, 240px). Memaku ke ikon (14px) berakhir di dua-duanya salah: dengan
  `max-w-full` panel menyusut jadi 24px dan teksnya membeludak, tanpa itu panel 240px menonjol
  keluar kontainer. Keduanya **memunculkan scrollbar horizontal diam-diam** karena panel tetap
  menempati layout walau `invisible`, dan rembesannya naik ke `documentElement.scrollWidth` lewat
  rantai `overflow-x: visible`. Setiap pemanggil `InfoHint` WAJIB memberi pembungkusnya `relative`.
  - Di `StatCard`, `relative` ada di root kartu. Kalau nanti `InfoHint` dipakai di dalam daftar
    (mis. beberapa baris dalam satu kartu), pasang `relative` **per BARIS**, bukan di kartunya —
    kalau di kartu, tooltip baris bawah melayang di atas seluruh kartu dan terlepas dari baris
    yang sedang dijelaskan.
- Badge delta dipisah jadi `DeltaBadge` (dipakai `StatCard`; `upIsGood: false` untuk metrik yang
  naiknya buruk) supaya logika arah × `upIsGood` hanya ada di satu tempat.
- Banner penjelas Xendit muncul otomatis bila `pending.amount > 0`, supaya admin tak menyimpulkan
  pembeli gagal bayar.

### Periode & granularity (URL query params)

`?periode=hari-ini|7-hari|30-hari|bulan-ini|tahun-ini|custom` (+ `&dari=&sampai=` untuk custom).
Default `30-hari`. Nilai tak dikenal / custom range tak valid **DIABAIKAN** → jatuh ke default,
bukan error (pola sama filter gudang di halaman Pesanan: bookmark lama harus tetap menampilkan data).

| Periode | Granularity sumbu-X |
|---|---|
| Hari ini | per jam |
| 7 Hari / 30 Hari / Bulan ini | per hari |
| Tahun ini | per bulan |
| Custom | ≤1 hari → jam · ≤92 hari → hari · lebih → bulan |

- **SEMUA perhitungan tanggal memakai zona WIB (UTC+7), bukan zona server.** Server produksi
  jalan di UTC; tanpa penyesuaian "Hari ini" bergeser 7 jam dan breakdown per jam salah label 7
  kolom. Triknya: geser instant `+7 jam` lalu baca dengan getter **UTC** (`getUTCHours` dst).
- `fromIso` **inklusif**, `toIso` **EKSKLUSIF** (dipakai `.lt`, bukan `.lte`) supaya pesanan tepat
  tengah malam tidak terhitung di dua periode berdampingan — kalau bocor, delta pertumbuhan salah.
  `toIsoInclusive` disediakan khusus pemanggil lama yang memakai `.lte`
  (`getBestSellingProducts`).
- `buildBuckets()` membuat kerangka bucket **termasuk yang nol** agar sumbu-X kontinu, dan
  **tidak pernah membuat bucket masa depan** (jam 10.00 → hanya 00:00–10:00; deret nol di ujung
  kanan membuat tren terlihat anjlok).
- Delta kartu dibandingkan `previousPeriod()` = rentang **sama panjang** tepat sebelumnya.
  `growthPercent` mengembalikan `undefined` bila pembanding 0 → badge disembunyikan (bukan "+∞%").

### Chart & palet (sudah divalidasi)

`RevenueChart` (client) = **combo chart** Recharts `ComposedChart`: stacked bar + garis tren
overlay. Urutan tumpukan bar dari dasar: Lunas → Pending → Dibatalkan.

**Palet = SKEMA BIRU LEMBUT** (keputusan pemilik toko 2026-08-13, menggantikan hijau/amber/rose).
Biru dipakai atas persetujuan eksplisit; larangan biru/ungu di bagian Brand Colors **tetap
berlaku untuk tempat lain**. `REVENUE_COLORS`: `#35577E` (lunas) · `#8FB4DE` (pending) ·
`#5F6670` (dibatalkan). Dipakai konsisten di bar, legend, tooltip, kolom tabel, **dan aksen ikon
3 kartu breakdown** (kartu operasional tetap nada brand — aksennya dekorasi, bukan pembawa data).

- Hex ini **bukan** usulan pertama (`#7C9CC4`/`#A8C5E8`/`#B8B8B8`): pasangan itu **gagal keras**
  di validator — `#A8C5E8` ↔ `#B8B8B8` hanya **ΔE 6.7** (normal-vision floor 15), tak terbedakan
  bahkan oleh mata normal, padahal keduanya segmen yang **bersinggungan** di stack; kontrasnya
  1,73:1 & 1,93:1 → bar nyaris lenyap di kartu putih. Jaraknya di-restep sampai semua check
  WAJIB lolos.
- Validator untuk pasangan yang **bersinggungan** (Lunas→Pending→Dibatalkan): lightness band
  PASS · CVD ΔE 25.1 PASS · normal-vision ΔE 25.6 PASS. Sisa **chroma floor FAIL** — itu
  **melekat pada skema pastel + netral** (pastel = chroma rendah; abu = 0) dan diterima sadar,
  karena pembedanya di sini lightness. **WARN kontras `#8FB4DE` 2,1:1** → relief-nya label
  terlihat: legend teks + kartu KPI berangka + **tampilan Tabel**.
- Lunas ↔ Dibatalkan hanya ΔE 8.2, tapi keduanya **tak pernah bersinggungan** (Pending selalu di
  antaranya) + dipisah celah 2px, jadi geometri chart tak pernah menyandingkan mereka.
- **Jangan ganti hex tanpa menjalankan ulang validator, dan jangan hapus tampilan Tabel** (itu
  kembaran chart yang bisa dibaca tanpa warna & tanpa hover).

- Pemisah antar segmen = `stroke` 2px **berwarna permukaan** (celah), bukan garis tepi berwarna.
- Grid hairline **solid** (bukan `strokeDasharray`), `maxBarSize={24}`, `radius` di semua segmen
  (Recharts tak bisa membulatkan hanya segmen teratas yang > 0).

**Garis tren total** (`<Line dataKey="berjalan">`, warna `REVENUE_TREND_COLOR` `#1F2937`):

- Nilainya = **`lunas + pending`, TANPA dibatalkan** (field `RevenueBucket.berjalan`, istilah yang
  sama dengan `RevenueTotals.berjalan`). Jadi **garisnya memang berada DI BAWAH puncak batang**
  pada bucket yang punya pembatalan — itu benar, bukan bug, dan subjudul chart menjelaskannya.
- Harus **jauh lebih gelap daripada bar tergelap** (`#35577E`). Usulan `#4A5568` dibuang karena
  hanya ΔE 4.2 dari warna Lunas → garisnya lenyap tiap melintasi segmen Lunas.
- Warna ini **sengaja gagal** check
  `lightness band` & `chroma floor` validator: kedua check itu menjaga hue *kategorikal* saling
  terbedakan & setara bobot, sedangkan garis tren harus lebih gelap agar terbaca di atas fill dan
  netral agar tak terbaca sebagai status keempat. Identitasnya dibawa **jenis mark** (garis + dot
  bercincin) — secondary encoding terkuat.
- `<Line>` ditulis **setelah** semua `<Bar>`: di Recharts urutan render = urutan gambar, jadi garis
  otomatis di atas batang **tanpa z-index**. Opacity dibiarkan penuh — yang menjaga keterbacaan
  adalah **cincin 2px berwarna permukaan** di tiap dot, bukan menyamarkan garisnya.
- `type="linear"`, **bukan `monotone`**: interpolasi melengkung mengarang puncak & lembah di antara
  titik pada deret yang banyak nol-nya.
- Label garis **mengikuti granularity** (`trendLabel()`): "Total per Jam" / "Total Harian" /
  "Total Bulanan" — "Total Harian" akan berbohong saat sumbu-X per jam atau per bulan. Label yang
  sama dipakai legend, baris tooltip, dan header kolom tabel.
- Tooltip: 3 baris kategori → pemisah → baris tren (swatch garis, tebal) → baris "Termasuk
  dibatalkan" yang **hanya muncul bila ada pembatalan** (dua baris total berangka identik cuma
  membingungkan). Kolom terakhir tabel = nilai garis tren, bukan tinggi batang — tinggi batang
  bukan besaran bisnis (mencampur pendapatan dengan pembatalan).

### Widget lain (semua data riil)

- **Produk Terlaris** — `getBestSellingProducts` mengikuti periode aktif.
  ⚠️ **Catatan akurasi yang BELUM diperbaiki**: `aggregateSales` memfilter
  `.neq('order_status','CANCELLED')`, dan di SQL `NULL <> 'CANCELLED'` bernilai NULL → **18 baris
  warisan ber-`order_status` NULL ikut terbuang** (19 dari 37 pesanan non-batal yang terhitung).
  Akibatnya widget ini bisa menampilkan lebih sedikit penjualan daripada kartu pendapatan di
  atasnya. Perbaikannya `.or('order_status.is.null,order_status.neq.CANCELLED')`, tapi fungsi yang
  sama juga menyuplai "N terjual" di storefront → butuh keputusan tersendiri.
- **Pesanan Terbaru** — `getRecentOrders(5)`, **sengaja di luar filter periode** (widget pemantau
  pesanan masuk; akan selalu kosong bila admin melihat periode lampau). `items` tidak diambil.
- **Stok Rendah** — produk aktif ber-stok efektif di bawah **ambang setelan admin**, terkecil dulu,
  maks 5. Bar diukur relatif terhadap ambang itu, bukan kapasitas maksimum (produk tak punya kolom
  kapasitas; mengarang pembagi membuat bar berbohong). Tautan → Kelola Stok Gudang.
- **Ambang stok menipis diambil `await getLowStockThreshold()`** (ikut `Promise.all` di halaman),
  bukan konstanta kode. Diatur di `/oms/dashboard/pengaturan` → tab Threshold Stok; angka yang sama
  dipakai halaman Produk & notifikasi stok supaya jumlah peringatannya selalu cocok.
- **Kartu "Produk Aktif" & "Rata-rata Rating" SUDAH DIHAPUS** (2026-08-13). Keduanya tak
  terpengaruh filter periode dan angkanya tersedia dengan konteks jauh lebih lengkap di halaman
  **Produk** (jumlah + status + stok) dan halaman **Ulasan** (rating per produk + isi ulasannya);
  di dashboard keduanya hanya angka tanpa tindak lanjut. **Jangan dihidupkan lagi di sini.**
  Ikut dihapus: fungsi `getOverallRatingSummary()` di `mock-db/reviews.ts` (tak ada pemanggil lain),
  konstanta `TONE_DARK`/`TONE_AMBER`, dan ikon `Boxes`/`Star`. `readProducts()` **tetap** dipakai
  widget Stok Rendah.
- **TIDAK ada tombol "Ekspor Laporan" di dashboard.** Versi sebelumnya hanya bernavigasi ke
  halaman Pesanan tanpa mengunduh apa pun — label yang menjanjikan aksi yang tak pernah terjadi.
  **Jangan tambahkan lagi kecuali benar-benar mengunduh file.** Ekspor CSV yang asli tetap ada di
  halaman Pesanan, dan halaman itu dijangkau dari sidebar.

## Halaman Produk OMS — tabel, filter, aksi massal

- **Lebar kolom eksplisit**: `<table className="table-fixed min-w-[900px]">` + `<colgroup>`.
  Tanpa `table-fixed`, browser membagi lebar dari konten → kolom Produk melebar mengikuti nama
  terpanjang dan mendorong kolom lain sampai butuh scroll horizontal. Nama produk `line-clamp-2`
  + `title` (tooltip nama penuh); pembungkusnya **wajib `min-w-0`** — tanpa itu flex item menolak
  menyusut dan line-clamp tak pernah aktif.
- **Kolom Aksi**: Edit & Varian = ikon bertooltip (aksi tersering, badge jumlah varian di ikon);
  Arsip/Pulihkan & Hapus di dropdown **⋮** (klik-luar ditutup overlay transparan). Hapus destruktif
  sengaja butuh satu klik ekstra.
- **Filter**: state di **URL query params** (`q`, `kategori`, `stok`, `status`, `dari`, `sampai`) —
  bisa di-bookmark/di-share, pola sama dengan halaman Pesanan. **Penyaringannya di CLIENT** atas
  data yang sudah dimuat; `/api/products/list` sengaja TIDAK disentuh karena endpoint itu juga
  dipakai storefront (checkout/katalog/ReviewForm).
  - Opsi kategori dari konstanta `PRODUCT_CATEGORIES` (bukan query DB — kategori dibatasi CHECK
    constraint, jadi tak ada ejaan bebas yang perlu di-`ilike`).
  - Tanggal pakai `<input type="date">` native + pintasan (hari ini/7/30 hari/bulan ini) — **tanpa
    library date-picker**.
  - Ambang "Stok Menipis" = setelan admin (`GET /api/settings/low-stock-threshold`, state di
    komponen dengan nilai awal `DEFAULT_LOW_STOCK_THRESHOLD`), satu angka dengan kartu ringkasan
    di atas tabel dan widget Stok Rendah di Dashboard.
  - **Kartu ringkasan (Total Produk / Stok Menipis / Stok Habis) = PINTASAN filter status stok.**
    Dirender sebagai `<button>` ber-`aria-pressed`, memanggil `toggleStockFilter()` yang menulis
    param `stok` lewat `updateFilters` — **sumber state yang sama persis dengan dropdown "Status
    Stok"**, jadi keduanya tak mungkin desinkron dan filter lain (kategori/tanggal/pencarian)
    otomatis terjaga karena `updateFilters` menyalin seluruh param lain lebih dulu.
    - Klik kartu yang sedang aktif = **toggle off** (kembali ke "Semua stok"). "Total Produk"
      aktif saat `stok === ''`; mengkliknya berulang aman karena kedua cabang sama-sama
      menghasilkan keadaan tak-terfilter.
    - Memilih **"Tersedia"** dari dropdown sengaja membuat ketiga kartu netral — memang tak ada
      kartu yang mewakili keadaan itu.
    - Border **selalu `border-2`**, yang berubah hanya warnanya saat aktif. Kalau ketebalannya
      yang diubah (1px→2px), isi kartu bergeser 1px tiap kali filter di-toggle.
  - **Angka kartu dihitung dari `filteredExceptStock`** (semua filter KECUALI status stok), bukan
    dari seluruh `products` — supaya angka di kartu selalu sama dengan jumlah baris yang muncul
    saat kartu itu diklik, termasuk ketika filter kategori/tanggal sedang aktif. Kalau filter stok
    ikut dihitung, mengklik satu kartu akan membuat angka kartu lain jadi 0.
  - Perbandingan stok dipusatkan di `matchesStock()` yang membaca **stok efektif** (`stockOf`,
    varian dijumlahkan). Sebelumnya kartu memakai `p.stock` mentah sementara tabel memakai
    `stockOf` — untuk produk bervarian keduanya berbeda, jadi angka kartu tak cocok dengan hasil
    filternya.
  - Chip per filter aktif (bisa dihapus satu-satu) + "Reset semua filter".
  - **Debounce pencarian ada di EVENT HANDLER, bukan `useEffect`** — menulis URL memicu setState
    (page & seleksi di-reset) dan lint `react-hooks/set-state-in-effect` melarangnya di dalam efek.
- **Paginasi client-side** `PAGE_SIZE = 10` (sama dengan Pesanan) atas hasil filter.
- **Seleksi massal**: checkbox per baris + "pilih semua" **halaman aktif saja** (bukan seluruh hasil
  filter) supaya jumlah terpilih selalu sama dengan yang terlihat. Bilah aksi sticky muncul saat ada
  yang dipilih: Arsipkan / Pulihkan / Ubah Kategori / Hapus + "Batalkan pilihan". Hapus massal wajib
  lewat dialog konfirmasi.
  - **Semua baris bisa dipilih.** Konstanta `INITIAL_PRODUCTS` (5 produk contoh `PRD-001…005`) dan
    field `Product.persisted` **SUDAH DIHAPUS** — tabel ini kini MURNI produk dari Supabase
    (`/api/products/list`). Dulu produk contoh dirender bersama produk asli tapi checkbox-nya
    dinonaktifkan dan edit/arsip atasnya hanya berlaku di layar; angka stok & "terjual"-nya tak
    pernah nyata, jadi tabelnya menampilkan data yang tak bisa dipercaya. **Jangan hidupkan lagi
    baris contoh hardcode di halaman OMS** — kalau butuh data pengisi, seed ke database.
  - Baris tanpa `createdAt` tetap tersaring keluar saat filter tanggal aktif (mengklaim tanggal apa
    pun untuknya akan menyesatkan).
- **Endpoint** `POST /api/products/bulk` (`requireAdmin`): `action` ∈ `archive|restore|delete|category`,
  `ids[]` (maks 200, di-dedupe). Satu query `.in('id', ids)` per aksi lewat `bulkSetArchived` /
  `bulkSetCategory` / `bulkDeleteProducts` di `mock-db/products.ts` — bukan loop per produk.
  Menutup dengan `revalidatePath` + `revalidateTag('products','max')` seperti create/update.
  Hapus massal mengandalkan FK CASCADE (varian & stok per gudang ikut terhapus; `order_items`
  menyimpan `product_id` nullable sehingga riwayat pesanan tetap utuh).

## Validasi Form Produk (OMS)

Logika terpusat di `src/lib/product-validation.ts`, dipakai form upload **dan** modal edit + dicek ulang
di server (`/api/products/{create,update}`). Konstanta: `SKU_REGEX` (`^[A-Z0-9-]+$`), nama 3–200,
deskripsi 20–2000, harga 100–99.999.999, stok 0–999.999, `MAX_PRODUCT_IMAGES=9`,
`MAX_IMAGE_BYTES=2MB`, `ACCEPTED_IMAGE_TYPES` (jpg/png/webp).

- **SKU**: format wajib huruf besar/angka/strip + **cek duplikat** server (`/api/products/check-sku`,
  dukung `excludeId` saat edit).
- Foto: min 1, maks 9, tiap file ≤ 2MB & tipe diterima (`validateImageFile`).
- Error tampil per-field + auto-scroll ke field invalid pertama (`PRODUCT_FIELD_ORDER`).


---

## Foto Produk Multi (Galeri, maks 9)

- **Kolom** `products.images` (`jsonb`, default `[]`) — migration `20260701120000_add_products_images.sql`.
  `image_url` tetap = foto utama (`images[0]`). Batas maks 9 selaras slider + validasi app.
- App: `StoredProduct.images: string[]`; `mock-db/products.ts` punya `sanitizeGallery` + **fallback aman**
  bila kolom `images` belum di-migrate (kode error `PGRST204`/`42703`).
- OMS upload + **modal edit** bisa tambah/ganti/hapus foto (bukan hanya ganti 1).
- **Foto disimpan sebagai URL Supabase Storage, BUKAN base64.** Bucket **`product-images`** (public).
  Client OMS tetap kirim data-URL base64; `saveProduct`/`updateProduct` (`mock-db/products.ts`)
  otomatis **decode → upload ke Storage → simpan URL** (`uploadImageIfDataUrl`/`uploadGallery`).
  Kolom `image_url`/`images` = URL `https://<proj>.supabase.co/storage/v1/object/public/product-images/...`.
  **Jangan pernah simpan base64 ke `image_url`/`images`** (dulu bikin payload `products/list` ~5MB;
  setelah pindah Storage jadi ~20KB). Migrasi data lama: `scripts/migrate-product-images-to-storage.mjs`.
- Detail produk: `ProductImageSlider` (thumbnail clickable desktop+mobile, dots); fallback ke
  `imageUrl` bila galeri kosong.

## Harga Coret (Diskon)

- Dua kolom eksisting: **`original_price`** (harga asli/coret) & **`promo_price`** (harga jual). **Tanpa**
  kolom `is_on_sale`/tanggal sale — status diskon dihitung: `isProductOnSale(p)` = `originalPrice > promoPrice`
  (`src/types/product.ts`).
- OMS form: field **Harga Jual** (= `promoPrice`) + **Harga Asli** opsional (`validateOriginalPrice`
  wajib > harga jual bila diisi). `saveProduct` set `original = originalPrice` bila > promo, else = promo.
- Tampil coret di: `ProductCard`, `ProductInfo`, `CartRecentlyViewed` (kondisional lewat `isProductOnSale`).

## Produk Terlaris & "N Terjual"

- Agregasi di `src/lib/mock-db/orders.ts` (`aggregateSales`): jumlah `order_items.quantity` per produk.
  **Sementara** hanya mengecualikan `order_status = CANCELLED` (`.neq`). **TODO**: setelah Xendit,
  ketatkan ke `status_pembayaran = PAID` (order baru masih `PENDING` sampai pembayaran real).
- Fungsi: `getBestSellingProducts({limit, from, to})` dan `getSalesCountByProduct({from, to})`.
- **OMS** halaman produk: kolom "Terjual" + selektor rentang waktu.
- **Storefront**: section "Produk Terlaris" homepage (`BestSellingProducts`). **Halaman pertama
  di-render SERVER** (props `initialProducts` dari `getBestSellingCatalogPage`, cached) → jadi bagian
  HTML ISR, tak flash saat kembali ke beranda. Halaman berikutnya = infinite scroll client via
  `IntersectionObserver` native + `/api/products/best-selling-catalog` (cached). "N terjual"
  di detail produk (di samping rating).

