# ROADMAP — Pekerjaan yang Belum Selesai

> Dikumpulkan dari `CLAUDE.md` (2026-08-14). Berisi (a) section roadmap yang sudah eksplisit,
> dipindah APA ADANYA, dan (b) **indeks** anotasi inline yang menandai pekerjaan belum selesai
> ("TODO", "belum dikerjakan", "belum diimplementasi", "masih roadmap", "belum diperbaiki").
>
> **Anotasi inline TIDAK dihapus dari file aslinya.** Catatan seperti "TODO: setelah Xendit,
> ketatkan ke `status_pembayaran = PAID`" hanya berarti di tempat mekanismenya dijelaskan;
> mencabutnya ke sini akan menghilangkan konteks. Jadi file ini adalah **daftar kerja +
> penunjuk**, bukan pemindahan. Kolom "Detail" menunjuk ke tempat penjelasan lengkapnya.
>
> Kembali ke ringkasan: [CLAUDE.md](CLAUDE.md)

---

## Integrasi yang belum terpasang

Dipindah dari `CLAUDE.md` → Tech Stack → "Roadmap integrasi (belum terpasang)":

- **Auth admin real**: Supabase Auth (client sudah ada, login OMS belum terhubung)
- **Payment Gateway**: Xendit
- **Deployment**: Vercel
- **Version Control**: GitHub

Folder yang **belum ada** dan baru dibuat saat integrasi terkait dikerjakan:
`src/lib/xendit/`, `src/app/api/webhooks/`, `src/lib/cart.ts`, `src/lib/fetcher.ts`.
(`src/proxy.ts` **sudah ada** — guard auth OMS.)

---

## Roadmap Integrasi (target arsitektur — belum diimplementasi)

Dipindah APA ADANYA dari `CLAUDE.md` (heading aslinya dipertahankan):

### Xendit (Payment Gateway)
- Semua logika pembayaran di `src/lib/xendit/`
- Webhook diterima di `src/app/api/webhooks/xendit/route.ts`
- Verifikasi webhook signature sebelum memproses event apapun
- **Jangan expose** Xendit secret key di frontend

**Status per 2026-08-18 — sisi PENERIMA callback SUDAH ADA:**
`POST /api/webhooks/xendit` + `src/lib/xendit/webhook.ts` sudah terpasang & teruji
(token `x-callback-token` waktu-konstan, idempoten, PAID → Lunas/Diproses,
EXPIRED/FAILED → Gagal/Dibatalkan + stok dikembalikan + dicatat ke `stock_mutations`,
kurang bayar ditolak). Yang masih kosong: **pembuatan invoice** — belum ada kode yang
memanggil Xendit API, jadi belum ada callback nyata yang akan masuk. Saat membuat invoice
nanti, `external_id` WAJIB diisi `orders.nomor_invoice` karena webhook mencocokkan lewat
kolom itu, dan `id` invoice Xendit disimpan ke `orders.id_transaksi`.

Turunan yang menunggu Xendit:

| Pekerjaan | Detail |
|---|---|
| Langkah 10–12 alur checkout (buat invoice → URL Xendit → redirect) masih mock | [docs/checkout-flow.md](docs/checkout-flow.md) → Alur Checkout & Pembayaran |
| ~~webhook → update status order + stok~~ **SUDAH ADA** (`/api/webhooks/xendit`). Sisa alur post-payment yang belum: booking kurir, isi no. resi, hapus cookie keranjang, kirim email | [docs/checkout-flow.md](docs/checkout-flow.md) → Alur Post-Payment (Webhook) |
| Alokasi/rilis stok penuh saat pembayaran gagal/expired | [docs/warehouse.md](docs/warehouse.md) |
| Email konfirmasi pesanan: template & preview sudah ada, **pengiriman otomatis belum**, dan sejak field email dihapus dari checkout **tak ada alamat tujuan** | [docs/checkout-flow.md](docs/checkout-flow.md) → Email Konfirmasi Pesanan |
| Snapshot promo/combo (`infarm_checkout_promo`) belum di-wire ke tabel `orders` | [docs/checkout-flow.md](docs/checkout-flow.md) → Paket & Combo |
| Kartu "Total Pendapatan" dashboard menampilkan uang yang sebagian besar belum diterima (Lunas Rp0 · Pending besar) karena order baru selalu `PENDING` | [docs/oms-dashboard.md](docs/oms-dashboard.md) → Kenapa pendapatan WAJIB dipecah per status |
| `aggregateSales` masih mengecualikan `CANCELLED` saja; **TODO** setelah Xendit: ketatkan ke `status_pembayaran = PAID` | [docs/oms-dashboard.md](docs/oms-dashboard.md) → Produk Terlaris & "N Terjual" |

---

## Booking & Tracking Kurir (Mengantar)

Search alamat + cek ongkir **sudah jalan**, dan ongkir kini memakai **berat riil produk**
(`products.berat` gram -> kg lewat `src/lib/shipping-weight.ts`). Yang belum:

| Pekerjaan | Detail |
|---|---|
| **Alamat pickup per gudang** — `MENGANTAR_PICKUP_ORIGIN_ID` sudah menyelaraskan kutipan dengan tagihan (semua kutipan dari zona alamat pickup), tapi harganya: pemilihan gudang tak lagi berbasis ongkir. Solusi permanen: daftarkan alamat tiap gudang di dashboard Mengantar → kolom `warehouses.mengantar_address_id` → booking pakai alamat gudang pemenuh + `time_id` per alamat → cabut env-nya | [docs/checkout-flow.md](docs/checkout-flow.md) → Origin gudang vs alamat pickup |
| **Tabel `orders` tak punya kolom ongkir** — ongkir melebur ke `jumlah_total`, jadi selisih kutipan vs tagihan Mengantar tak bisa dideteksi otomatis (ditemukan manual dengan membandingkan dashboard Mengantar). Usul: `ongkir INT` (dikutip) + `ongkir_aktual INT` (ditagih) supaya OMS bisa menandai pesanan yang selisih | [docs/checkout-flow.md](docs/checkout-flow.md) → Booking Kurir |
| **Ganti `MENGANTAR_BASE_URL` + `MENGANTAR_API_KEY` dari sandbox ke PRODUKSI setelah pengujian selesai.** Satu env var itu kini menentukan host cek ongkir SEKALIGUS booking, jadi tak ada perubahan kode. Selama masih sandbox, tarif yang dilihat pembeli adalah angka dummy (Jakarta→Jakarta Rp25.520 vs produksi Rp8.000) | [docs/checkout-flow.md](docs/checkout-flow.md) → Host Mengantar |
| Ganti endpoint simulasi dev (`/api/dev/simulate-payment`) dengan Xendit sungguhan begitu pembuatan invoice terpasang | [docs/checkout-flow.md](docs/checkout-flow.md) → Booking Kurir |
| Tracking status paket otomatis (webhook/polling Mengantar) — `no_tracking` SUDAH terisi otomatis saat booking | [docs/checkout-flow.md](docs/checkout-flow.md) → Booking Kurir |
| `MENGANTAR_API_KEY` belum dipakai (cek ongkir tak butuh key) | `CLAUDE.md` → Environment Variables |
| **Berat saat booking kurir wajib dihitung ulang dari `order_items` di DB** (belum ada call site — booking belum dibuat) | [docs/checkout-flow.md](docs/checkout-flow.md) → Berat Kirim |
| **Berat per varian** — `product_variants` belum punya kolom berat, semua varian memakai berat produk induk | [docs/oms-dashboard.md](docs/oms-dashboard.md) → Berat Produk |
| Isi berat 11 produk lama (masih badge "Belum diisi" → ongkir memakai cadangan 1 kg/pcs) | OMS → Produk → Edit |

---

## Auth & Otorisasi Admin

| Pekerjaan | Detail |
|---|---|
| Supabase Auth penuh (multi-peran, reset password) | `CLAUDE.md` → Auth Guard OMS |
| **Proteksi per-endpoint API OMS belum lengkap** — proxy hanya menjaga HALAMAN `/oms/dashboard/*`; route mutasi produk/combo/promo/review belum dijaga satu per satu (temuan K-1 `docs/security-audit-2026-07-08.md`) | `CLAUDE.md` → Auth Guard OMS |
| **Belum ada UI kelola akun admin** — membuat akun `staff` masih lewat SQL (`insert into admin_users` + `password_hash` dari `hashPassword()`) | `CLAUDE.md` → Auth Guard OMS |
| Gating peran `staff` di halaman Pengaturan **belum teruji runtime** (di DB hanya ada satu akun berperan `admin`) | [docs/oms-dashboard.md](docs/oms-dashboard.md) → Halaman Pengaturan |

---

## Pergudangan

| Pekerjaan | Detail |
|---|---|
| **Mutasi/transfer stok ANTAR gudang** — butuh tabel `stock_transfers` tersendiri (beda dari `stock_mutations` yang mencatat perubahan, bukan perpindahan) | [docs/warehouse.md](docs/warehouse.md) → Stok di form produk |
| Kelola Stok masih client-side tanpa paginasi; ambang pindah ke server-side ≈ **200 produk**, titik ubahnya endpoint `stock/matrix` | [docs/warehouse.md](docs/warehouse.md) → Kelola Stok Gudang |

---

## Akurasi Data Dashboard & Laporan

| Pekerjaan | Detail |
|---|---|
| ⚠️ **BELUM DIPERBAIKI**: `aggregateSales` memfilter `.neq('order_status','CANCELLED')`, dan di SQL `NULL <> 'CANCELLED'` bernilai NULL → **18 baris warisan ber-`order_status` NULL ikut terbuang**. Widget Produk Terlaris bisa menampilkan lebih sedikit penjualan daripada kartu pendapatan di atasnya. Perbaikannya `.or('order_status.is.null,order_status.neq.CANCELLED')`, tapi fungsi yang sama juga menyuplai "N terjual" di storefront → **butuh keputusan tersendiri** | [docs/oms-dashboard.md](docs/oms-dashboard.md) → Widget lain |
| 45 baris `orders` ber-`status_pembayaran`/`order_status` NULL (18 NULL keduanya) dipetakan ke `Menunggu`; baris itu tak ikut filter status apa pun. Bukan bug filter, tapi data warisan yang belum dibereskan | [docs/oms-dashboard.md](docs/oms-dashboard.md) · [docs/warehouse.md](docs/warehouse.md) |

---

## Caching & Performa

| Pekerjaan | Detail |
|---|---|
| **Cache Components (`use cache`/PPR) belum diaktifkan** di `next.config.ts`. Bila nanti diaktifkan, wrapper `unstable_cache` di `cached-reads.ts` perlu dimigrasi ke `use cache` | `CLAUDE.md` → Caching & Revalidasi |
| `/api/products/list` (full, tanpa cache) masih dipakai OMS & sebagian storefront lama (checkout/ProductCatalog/ReviewForm) — **kandidat migrasi** ke by-ids/paginasi saat katalog membesar | `CLAUDE.md` → Caching & Revalidasi |
| Rate limiting masih in-memory per-instance, **belum terpusat lintas-instance Vercel** — kandidat migrasi ke tabel Supabase atau Redis bila traffic/serangan naik | `CLAUDE.md` → Rate Limiting |
| Perbandingan ongkir antar gudang di-cache in-memory 10 menit (per-instance, keterbatasan yang sama) | [docs/warehouse.md](docs/warehouse.md) |

---

## Halaman & UI

| Pekerjaan | Detail |
|---|---|
| **Halaman Legal dinonaktifkan** (`LEGAL_PAGES_ENABLED = false` → rute balas 404). Sebelum dinyalakan lagi: ganti `LEGAL_CONTACT_EMAIL`/`LEGAL_CONTACT_PHONE` (masih **PLACEHOLDER**) dan perbarui `LEGAL_EFFECTIVE_DATE` | [docs/storefront-pages.md](docs/storefront-pages.md) → Halaman Legal |
| **Belum ada mekanisme mengaktifkan maintenance mode** — `/maintenance` baru TAMPILAN. Butuh rewrite ber-flag env di `src/proxy.ts` + idealnya balas **HTTP 503**, bukan 200 | [docs/storefront-pages.md](docs/storefront-pages.md) → Halaman Maintenance |
| `WHATSAPP_CS_LINK` masih placeholder `/404` — ganti ke `https://wa.me/62…` saat siap | [docs/storefront-pages.md](docs/storefront-pages.md) → Floating WhatsApp CS |
| Empat dropdown filter di halaman Pesanan (Kurir, Status Pembayaran, Urutkan, arah urut) masih `<select>` native → highlight biru OS masih muncul. `WarehouseMultiFilter` bisa jadi acuan polanya | [docs/warehouse.md](docs/warehouse.md) → Gudang di halaman Pesanan |
| `src/lib/cart.ts` (helper baca keranjang dari Server Component via `cookies()`) **belum dibuat** | `CLAUDE.md` → Sistem Belanja: Guest Checkout |
| `ReviewForm.tsx` / `ReviewProductCard.tsx` = **dead code** (flow review by invoice lama, tak di-link) | [docs/checkout-flow.md](docs/checkout-flow.md) → Review terverifikasi |

---

## Temuan Keamanan yang Dilaporkan tapi BELUM Diubah

Butuh keputusan pemilik toko sebelum disentuh (semuanya hasil audit, bukan dugaan):

| Temuan | Catatan |
|---|---|
| `GET /api/orders/get` — IDOR (temuan S-2); route-nya dead code, kandidat dihapus | `docs/security/` |
| Nomor invoice mudah ditebak, dan `/checkout/success` menerbitkan token pembatalan untuk invoice apa pun | `docs/security/` |
| `/checkout/success` & `/track` belum di-gate verifikasi no. telepon | `docs/security/` |
| `order_items` masih anon-readable di DB live (schema drift dari migration) | `docs/security/` |
| No. telepon belum divalidasi ulang di server pada `orders/create` | `docs/security/` |
| `shippingCost <= 0 → 0` (perlu ditinjau) | `docs/security/` |
| `mock-db/*` belum diberi `import 'server-only'` | `docs/security/` |
| Duplikat React key pada pilihan kurir (`SAPLite` dst) saat multi-gudang: `courier.id` unik per gudang, bukan lintas gudang. Selain warning React, **kedua kartu kurir yang sama menyala bersamaan** dan `find()` mengambil kecocokan pertama. Perbaikan: identitas gabungan `${warehouseId}::${id}` di `ShippingOptions.tsx` (4 titik) | Dilaporkan 2026-08-14, menunggu keputusan |

---

## Status Fitur per Domain

Dipindah dari `CLAUDE.md` → "Domain: Ecommerce & OMS". Daftar ini campuran `[x]` sudah jadi,
`[~]` sebagian, `[ ]` belum — disimpan utuh sebagai rujukan cakupan.

## Domain: Ecommerce & OMS

### Ecommerce (Storefront)
- [x] Search bar autocomplete PERSISTEN di header (semua halaman store) — desktop inline, mobile overlay
      (`HeaderSearch`); dulu di hero, kini pindah ke `AppBar`
- [x] Halaman beranda (homepage) — Hero (bg dual-image) + 3 indicator box count-up (`HeroStats`)
- [x] Halaman katalog produk (`/products`) — filter lengkap: sidebar desktop / bottom-sheet mobile,
      kategori multi-checkbox, rentang harga, sort (Listbox HeadlessUI), chip kategori aktif
- [x] Halaman detail produk (`/produk/[id]`) — CTA beli mengambang di mobile & statis di desktop
      (bawah deskripsi), deskripsi dilipat 5 baris + "Lihat Selengkapnya"
- [x] Floating WhatsApp CS di semua halaman ecommerce (`FloatingWhatsApp`, kanan bawah; link CS placeholder `/404`)
- [x] Halaman keranjang (`/keranjang`) — data dari cookie; desktop 2 kolom (produk kiri, "Dilihat Sebelumnya" kanan), mobile 1 kolom
- [x] Mini cart dropdown di header (desktop ≥640px) — `MiniCart` + kontrol ubah jumlah per baris
      (− n +, batas bawah `minOrderQty`, batas atas stok, hapus per baris, sorotan saat nilai
      berubah); mobile tetap navigate ke `/keranjang` (panelnya tak di-mount sama sekali)
- [x] Katalog & "Produk Terlaris" pure produk OMS (infinite scroll); "N terjual" di detail produk
- [x] Detail produk: galeri foto multi (maks 9) + harga coret
- [x] Promo & paket combo REAL di keranjang (dari Supabase via `/api/{promotions,combos}/active`)
- [x] Halaman guest checkout (`/checkout` + `/checkout/success`) — halaman sukses: satu kolom di
      mobile, DUA kolom di lg+ (kiri status+aksi, kanan rincian item+total), satu warna hijau
      (`brand-primary`) untuk semua blok, CTA bertingkat (Lacak = utama solid), `pb-28` agar tak
      tertutup tombol WhatsApp mengambang
- [x] Hub "Pesanan Saya" (`/pesanan-saya`) — kartu lacak/batalkan/review; ikon akun header (dropdown
      di semua ukuran layar) + badge angka pesanan aktif dari cookie
- [x] Beri Review Produk by no_telepon (`/review`) — pembeli terverifikasi (riwayat beli) + badge "Pembeli Terverifikasi"
- [x] Halaman lacak pesanan by nomor invoice (`/track`) + by no_telepon (`/track-order`, honeypot + auto-recognize cookie)
- [x] Halaman pembatalan pesanan Guest (`/order-cancellation` token) + by no_telepon 2 langkah (`/cancel-order`)
- [x] Rate-limit endpoint publik rawan bot (lacak/batalkan/review by no_telepon, proxy Mengantar alamat+ongkir, create order, submit ulasan) — in-memory, ambang batas terpusat di `src/lib/rate-limit.ts`; belum terpusat lintas-instance (kandidat migrasi Supabase/Redis)
- [x] Search alamat + **cek ongkir** Mengantar di checkout (client; ongkir masuk ke total)
- [x] **Kurir dibatasi J&T** (daftar putih server-side, kode `JT`) + booking kurir otomatis setelah pembayaran sukses (resi `cnote_no` → `orders.no_tracking`, kegagalan ditandai `shipment_status=FAILED`)
- [x] **Jadwal pickup harian Mengantar** — tabel `mengantar_daily_pickup`, Vercel Cron 06:00 WIB (Sen–Sab), cutoff 15:00 WIB, `getTodayPickupTimeId()` (belum ada call site: booking kurir belum dibuat)
- [x] **Berat produk** (`products.berat`, gram) sebagai dasar ongkir — form OMS + kolom tabel + badge "Belum diisi", total berat keranjang, hitung ulang server-side di `orders/create`
- [x] Validasi form checkout (nama/telepon/email/alamat/kurir) + gating tombol "Bayar Sekarang"
- [x] Template email konfirmasi pesanan (`src/emails/`, preview di `/dev/email-preview`)
- [~] Halaman legal: Kebijakan Privasi & Syarat/Ketentuan — kode LENGKAP (`LegalPageShell`, tautan
      footer, teks persetujuan checkout) tapi **DINONAKTIFKAN** (`LEGAL_PAGES_ENABLED = false` →
      rute balas 404, semua tautan disembunyikan). Kontak masih PLACEHOLDER di `src/lib/data/legal.ts`
- [ ] Integrasi Xendit (pembayaran) — masih UI/mock
- [ ] Mengantar: booking kurir & tracking resi otomatis — masih roadmap

### OMS (Back Office)
- [x] Login OMS (`/oms/login`) — verifikasi ke tabel `admin_users` (scrypt) + cookie sesi httpOnly
      bertanda tangan HMAC + rate limit (`proxy.ts` verifikasi tanda tangan)
- [x] Notifikasi header OMS (`NotificationBell`) — pesanan menunggu diproses + produk stok habis,
      DIHITUNG real-time (tanpa tabel `notifications`), unread lewat `notif_last_seen:<adminId>` di
      `store_settings`, polling 60 dtk + refetch saat tab fokus (Realtime tak mungkin: RLS + anon key),
      panel 10 teratas + halaman `/oms/dashboard/notifikasi` berpaginasi
- [x] Halaman Pengaturan bertab (`/oms/dashboard/pengaturan`) — Profil Toko / Threshold Stok /
      Minimum Belanja, semua di `store_settings` (tanpa tabel & migration baru). Tulis = peran
      `admin` (`requireAdminRole`), `staff` hanya melihat. Alamat gudang read-only (sumbernya
      tabel `warehouses`). Ikon gear di header mengarah ke sini
- [x] Ambang "stok menipis" bisa diatur admin — dipakai serentak Dashboard, halaman Produk, dan
      notifikasi stok (`DEFAULT_LOW_STOCK_THRESHOLD` kini hanya nilai cadangan)
- [x] Header OMS menampilkan nama & peran admin ASLI (`GET /api/oms/me`), bukan teks hardcode
- [x] Dashboard OMS (`/oms/dashboard`) — Revenue Dashboard: pendapatan dipecah per status
      pembayaran (Lunas/Pending/Dibatalkan) + tooltip definisi, toggle periode di URL params
      (Hari ini/7/30 hari/Bulan ini/Tahun ini/Custom) dengan granularity chart otomatis
      (jam/hari/bulan, zona WIB), stacked bar + tampilan tabel, delta vs periode pembanding.
      Ringkasan = 4 kartu berjejer satu baris (Total Pendapatan · Total Pesanan · Rata-rata Nilai
      Pesanan · Dibatalkan/Gagal); pemecahan Lunas vs Pending hidup di chart + tampilan Tabel.
      Semua widget data riil (stok rendah, pesanan terbaru, produk terlaris)
- [x] Manajemen produk (list, upload/create, update, delete) via API + Supabase — multi-foto (maks 9),
      harga jual/asli (coret), validasi form, kolom "Terjual" + rentang waktu
- [x] Tabel produk: lebar kolom eksplisit (`table-fixed` + `colgroup`), nama `line-clamp-2` + tooltip,
      aksi ikon + dropdown ⋮, paginasi 10/hal
- [x] Filter produk di URL params (cari nama/SKU debounce, kategori, status stok, status produk,
      rentang tanggal + pintasan) dengan chip per filter & reset semua
- [x] Aksi massal produk (`POST /api/products/bulk`, admin-only): arsipkan/pulihkan/ubah kategori/
      hapus + konfirmasi hapus. Tabel murni produk Supabase (produk contoh hardcode sudah dihapus)
- [x] Manajemen order (`/oms/dashboard/orders`) — filter tanggal (range + shortcut)/kurir/status
      pembayaran/**status pesanan**/**gudang (MULTI-SELECT)**, sort Total & Tanggal, kombinasi filter
      tersimpan di URL query params, Reset Filter, ekspor CSV (SEMUA penyaringan server-side via
      `readOrdersFiltered`/`getDistinctCouriers`, `OrderFilterOptions`). Kolom tabel memuat **Gudang**
- [x] Filter Gudang multi-select bertema hijau (`WarehouseMultiFilter`) — checkbox + model draft
      ("Terapkan"/"Reset"), URL `gudang=id1,id2,none`, query `.in()`/`.is()`/`.or()`. Empat dropdown
      lain di halaman itu masih `<select>` native (highlight biru OS) — belum disamakan
- [x] Manajemen review (`/oms/dashboard/reviews`) — create/list/reply/visibility
- [x] Manajemen Paket & Combo (`/oms/dashboard/paket-combo`) — create/list/update/delete/toggle
- [x] Manajemen Promosi (`/oms/dashboard/promosi`) — create/list/update/delete/toggle
- [x] Kelola Gudang (`/oms/dashboard/gudang`) — CRUD `warehouses` + set default + aktif/nonaktif,
      semua endpoint `requireAdmin`; penjagaan hapus/nonaktif gudang default & gudang terpakai
- [x] Stok awal di form **Tambah** Produk — `WarehouseStockFields` (satu input di mode single, per
      gudang di mode multi + total); payload `stockPerWarehouse` divalidasi & ditulis di server
- [x] Kelola Stok Gudang (`/oms/dashboard/gudang/stok`) — matrix produk × gudang, **mode edit
      eksplisit per baris** (tombol Edit di kolom Aksi → indikator perubahan → Undo/Batal → dialog
      konfirmasi → undo setelah simpan), baris varian bisa dibuka, filter gudang + cari nama/SKU.
      **Satu-satunya tempat stok bisa diedit** → stok di modal Edit Produk kini read-only
- [x] Pembatasan peran: menulis stok butuh `admin_users.role = 'admin'` (`requireStockEditor`);
      peran `staff` hanya melihat. Belum ada UI kelola akun admin (buat akun staff via SQL)
- [x] Riwayat Mutasi Stok (`/oms/dashboard/gudang/riwayat`) — tabel `stock_mutations`; mencatat edit
      manual, form produk, pesanan masuk, & pembatalan (`changed_by` → `admin_users`, bukan `auth.users`)
- [ ] Mutasi/transfer stok ANTAR gudang (butuh tabel `stock_transfers` tersendiri)
- [~] Autentikasi admin: sudah DB-backed (`admin_users` + scrypt + sesi HMAC httpOnly); Supabase Auth
      penuh (multi-peran/reset password) + proteksi per-endpoint API OMS masih menyusul
- [~] Stok berkurang atomik saat checkout (RPC `create_order_with_items`); alokasi/rilis stok penuh
      (mis. saat pembayaran gagal/expired) menyusul bareng Xendit

