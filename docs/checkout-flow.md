# Alur Checkout, Order & Promo

> Dipecah dari `CLAUDE.md` (2026-08-14). Isi dipindahkan APA ADANYA, tanpa pemangkasan.
> Kembali ke ringkasan: [CLAUDE.md](../CLAUDE.md)
>
> Empat section pertama (Pembatalan Pesanan Guest, Layanan Pesanan Guest,
> Mengantar, Validasi Form Checkout) tidak disebut eksplisit dalam rencana pemecahan;
> ditaruh di sini karena semuanya bagian dari alur pesanan pasca-checkout.

## Pembatalan Pesanan Guest (token-protected)

- Karena guest tidak login, tautan pembatalan diamankan dengan **token HMAC** dari `orderId`
  (`src/lib/order-token.ts`, server-only). `generateCancelToken` dipakai saat menyusun tautan
  di halaman Order Confirmed; `verifyCancelToken` dicek di API
- Endpoint `src/app/api/orders/cancel/route.ts`:
  - `GET ?id=&token=` → verifikasi token, kembalikan detail order (tanpa data pribadi)
  - `PATCH` → verifikasi token + validasi status di server, set status `Dibatalkan`,
    lalu `restoreStock` (lepas stok kembali). Status yang boleh dibatalkan: `Menunggu Pembayaran`,
    `Diproses`. Status `Dikirim`/`Selesai` ditolak (terkunci)
- Halaman `src/app/order-cancellation/page.tsx` (server tipis) → `OrderCancellationView` (client)

## Layanan Pesanan Guest (lacak / batalkan / review) — sudah terpasang

Keluarga fitur guest yang menemukan pesanan **tanpa login**. Entry lewat **hub `/pesanan-saya`**
(ikon profil header → hub; badge dot merah bila cookie `infarm_phone` ada).

> **PENCARIAN kini seragam: email** (sejak 2026-09-01). Yang TIDAK seragam adalah verifikasi —
> baca tabel ini sebelum menyentuh salah satunya.

| Layanan | Halaman | Kunci PENCARIAN | Endpoint | Query | Cookie |
|---|---|---|---|---|---|
| **Lacak** | `/track-order` | **email** | `track-by-email` | `getOrdersByEmail` → `.eq('email')` | `infarm_email` |
| **Batalkan** | `/cancel-order` | **email**, lalu **no_telepon** sebagai konfirmasi | `track-by-email` → `verify-cancel` → `cancel-by-phone` | `getOrdersByEmail`, lalu cocokkan `no_telepon` pesanan | `infarm_email` |
| **Review** | `/review` | **email** | `reviewable-by-email` → `create-by-email` | `getOrdersByEmail` → `.eq('email')` | `infarm_email` |
| **Badge pesanan aktif** | header | no_telepon | `track-by-phone` | `getOrdersByPhone` → `.eq('no_telepon')` | `infarm_phone` |

**Kenapa Batalkan memakai DUA identitas**: pencariannya email seperti yang lain, tapi pembatalan
baru dieksekusi setelah pembeli memasukkan **no_telepon** pesanan itu. Kalau langkah konfirmasi
ikut memakai email, ia tak menambah apa pun — yang lolos pencarian otomatis lolos konfirmasi.
Dengan telepon, aksi yang tak bisa ditarik kembali menuntut DUA data berbeda dari pesanan yang
sama. Pencocokannya SERVER, dua kali dan saling bebas: `verify-cancel` lalu `cancel-by-phone`
yang sengaja tidak mempercayai hasil verifikasi sebelumnya. **Review tidak punya langkah ini** —
memberi ulasan tak merusak apa pun, jadi biayanya tak sepadan.

**Jalur `*-by-phone` tetap hidup, jangan di-rename atau dihapus**: `track-by-phone` masih dipakai
badge pesanan aktif, dan `cancel-by-phone` justru jadi langkah konfirmasi Batalkan.
`reviewable-by-phone`/`create-by-phone` tak lagi punya pemanggil di UI tapi dibiarkan utuh.

⚠️ **Pesanan ber-`email` NULL tak bisa ditemukan di ketiga halaman itu.** Kolom `orders.email`
baru terisi sejak field email kembali ke checkout (2026-08-31); pesanan sebelum itu tak punya
pemilik yang bisa dibuktikan lewat jalur email. Per 2026-09-01: 46 dari 69 pesanan.

Semua berbagi pola yang sama: input identitas → query → output NON-SENSITIF; **honeypot** field
`website`; **auto-recognize** cookie (Opsi A: auto-cari tanpa ketik) — kecuali langkah konfirmasi
Batalkan, yang **tak pernah di-prefill** dari cookie mana pun. **Rate-limit sudah terpasang** —
jalur telepon memakai `PHONE_LOOKUP_*`, jalur email memakai `EMAIL_LOOKUP_*`/`EMAIL_WRITE_*`
(ambang sama, konstanta terpisah). Lihat "Rate Limiting" di [CLAUDE.md](../CLAUDE.md) (section itu
tetap di root, tidak ikut dipecah ke sini).

### Lacak — `/track-order` (berdampingan dengan `/track` by invoice)
- **Kunci = email**, bukan no_telepon. `POST /api/orders/track-by-email`: kembalikan info
  non-sensitif (invoice, status, resi, kurir, tanggal, item nama+qty+foto), nama **di-mask**
  (`lib/mask.ts`). Detail timeline lengkap tetap via `/track?order=INV-…`.
- Email dinormalisasi (`normalizeEmail`) di client **dan** di server — pencocokan `.eq('email')`
  peka huruf besar/kecil, jadi bentuk yang disimpan dan yang dicari harus melewati helper yang sama.
- **Pesanan lama ber-email NULL tak akan muncul di sini.** Saat hasilnya kosong, halaman menampilkan
  arahan ke pencarian by NOMOR INVOICE (/track) agar pembeli tak mengira pesanannya hilang.
  Dulu arahannya ke pencarian by no. telepon di /cancel-order; sejak halaman itu ikut pindah ke
  email, janji itu tak bisa ditepati lagi.

#### `/track?order=INV-…` — tata letak & kartu produk
- **Tak ada verifikasi kepemilikan**: nomor invoice adalah satu-satunya kunci. Karena itu nama,
  no. telepon, dan detail jalan **di-mask** (`maskName`/`maskPhone`/`maskStreet`) sementara wilayah
  tetap tampil agar pembeli masih mengenali pesanannya. Kompensasi lain = entropi nomor invoice
  40 bit (lihat "Nomor invoice" di bagian skema `orders`).
- **`OrderItemsCard`** (`src/components/track/OrderItemsCard.tsx`, Server Component) menampilkan
  foto+nama+qty+harga tiap produk, lalu Subtotal → Ongkos Kirim & Biaya Lain → Pengiriman → Total.
  - Harga = `item.price` (snapshot `order_items.price_at_purchase`), **bukan** harga katalog saat ini.
  - Subtotal **mengecualikan** `isPromoItem` (hadiah promo berharga 0; tertulis "Gratis" + 🎁).
  - **Ongkir tak punya kolom sendiri** di `orders` → barisnya = `jumlah_total − subtotal`, jadi
    ongkir & diskon tak bisa dipisah. Selisih negatif dilabeli "Diskon". Bila kolom ongkir kelak
    ditambahkan (lihat ROADMAP.md), baris ini bisa dipecah jadi angka sebenarnya.
  - Nol query baru: `getOrderByOrderId` sudah me-resolve nama/foto/varian tiap item.
- **Layout**: `max-w-md` satu kolom di mobile, `max-w-5xl` dua kolom di `lg+` — kiri identitas +
  produk, kanan stepper/timeline/kurir/alamat. Urutan mobile mengikuti urutan DOM kolom kiri lalu
  kanan. `<header>` ikut `lg:max-w-5xl` agar logo sejajar tepi kartu.

### Batalkan — `/cancel-order` (2 LANGKAH, DUA IDENTITAS)
- LANGKAH 1: cari **by email** (reuse `track-by-email`) → daftar ringkas → pilih satu.
- LANGKAH 2: **ketik no_telepon pesanan itu** (tak pernah di-prefill dari cookie mana pun) →
  `POST /api/orders/verify-cancel` (query ulang DB: cocokkan phone↔order + cek status cancellable)
  → cocok & boleh → tombol "Ya, Batalkan Pesanan".
- Eksekusi: `POST /api/orders/cancel-by-phone` — **RE-verifikasi phone↔order ke DB** (tak percaya client),
  status boleh cancel (`Menunggu Pembayaran`/`Diproses`; tolak `Dikirim`/`Selesai`/`Dibatalkan`),
  `updateOrderStatus('Dibatalkan')` + `restoreStock` + revalidate/tag. (Alur token `/order-cancellation` tetap ada.)
- Langkah 2 sengaja memakai identitas BERBEDA dari langkah 1 — alasannya di atas tabel.

### Review terverifikasi — `/review` (GANTI flow invoice lama)
- `/review` kini **by email** (pembeli terverifikasi lewat riwayat beli). `POST /api/reviews/reviewable-by-email`:
  kumpulkan produk BELUM diulas dari semua pesanan email itu (exclude `Dibatalkan` & yang sudah diulas via
  `getReviewedProductIds` per invoice). Pilih produk → form rating + komentar. **Tanpa faktor kedua** —
  memberi ulasan tak merusak apa pun.
- `POST /api/reviews/create-by-email`: **verifikasi server email↔order (query ulang DB)** + produk∈order +
  not cancelled + dedup (`order_invoice`+product, unique index). Submit lama `create` (invoice) masih ada.
- **Nama penulis diisi SERVER dari pesanan, tak ada input "Nama Tampilan"**, dan
  `reviewable-by-email` **tidak** mengembalikan nama pelanggan sama sekali. Dua-duanya aturan yang
  sama dengan yang menutup SEC-007: endpoint publik jangan jadi alat menukar "email seseorang"
  menjadi "nama lengkapnya", dan nama penulis yang bisa diketik bebas berarti ulasan bisa dikirim
  atas nama orang lain. Jalur `reviewable-by-phone`/`create-by-phone` masih memakai pola lama
  (mengembalikan `customerName`, menerima `authorName` dari client) tapi sudah tak punya pemanggil.
- **Badge "Pembeli Terverifikasi"**: `ProductReview.verified = Boolean(order_invoice)` (`getReviewsByProduct`),
  dirender di `ProductReviews.tsx` (`BadgeCheck`). Ulasan lama `order_invoice` NULL → tanpa badge.
- **Schema**: TANPA kolom baru — reuse `order_invoice` (TEXT) + unique index yang sudah ada (bukan `order_id` UUID).
- Halaman sukses & hub mengarah ke `/review` polos (phone auto-fill cookie). `ReviewForm.tsx`/`ReviewProductCard.tsx`
  (flow invoice `?order=` lama) kini **dead code** (tak di-link).


---

## Mengantar (Logistik) — sudah terpasang sebagian

Semua helper client ada di **`src/lib/mengantar.ts`** (file, bukan folder). Endpoint Mengantar
bersifat publik (tanpa API key), tapi **keduanya (search alamat & cek ongkir) diproksi lewat route
handler internal** — search karena CORS, ongkir agar bisa di-rate-limit.

- **Search alamat** (`searchAddress`): UI di `AddressSearchCombobox` (debounce 500ms, min 3 karakter).
  Host alamat (wilayah) **tidak mengirim header CORS** → request diproksi lewat route handler internal
  `src/app/api/mengantar/address/search/route.ts` (BUKAN server action). `_id` kelurahan terpilih
  disimpan sebagai **`destination_id`** di state form alamat (dipakai cek ongkir).
- **Cek ongkir** (`fetchShippingEstimate`): endpoint estimasi Mengantar mengizinkan CORS (`*`), tapi
  fetch langsung browser→Mengantar **tidak bisa di-rate-limit** → sejak sekarang diproksi lewat
  `src/app/api/mengantar/shipping/estimate/route.ts` (rate limit `MENGANTAR_IP` + `origin_id` diisi
  di server). Client hanya kirim `destination_id` & `weight` (kg); pemetaan/pengurutan kurir tetap di
  `src/lib/mengantar.ts`. Origin toko dari env `MENGANTAR_ORIGIN_ID` (fallback:
  `NEXT_PUBLIC_MENGANTAR_ORIGIN_ID`, jangan hardcode). Response = object per-kurir; ambil
  `estimatedSpecialPrice` (ongkir) & `estimatedDate` (estimasi), **sembunyikan** kurir `unsupported: true`,
  urutkan termurah→termahal.
- **UI cek ongkir**: `ShippingOptions` (tombol trigger → bottom sheet `BottomSheet`, pola seperti
  `PaymentModal`): skeleton saat loading, pesan + tombol retry saat gagal, "Belum ada kurir tersedia
  ke alamat tujuan" bila semua unsupported. Kurir terpilih disimpan ke state `selected_courier`,
  ongkir ditambahkan ke total. Tombol "Bayar Sekarang" baru aktif setelah kurir dipilih.
- **Roadmap (belum ada)**: booking kurir + tracking resi otomatis (via webhook pembayaran).

### Jadwal Pickup Harian — `time_id` untuk booking kurir

Booking kurir butuh `time_id` (slot penjemputan) dari **`POST /time`** Mengantar. Satu slot dipakai
untuk SEMUA paket hari itu, jadi memanggilnya per transaksi = satu round-trip tambahan di jalur
bayar + boros kuota + titik gagal baru tepat saat pembeli menekan bayar. Karena itu ada tabel
perantara yang diisi cron, dan checkout hanya **membaca**.

| Berkas | Peran |
|---|---|
| `supabase/migrations/20260820120000_init_mengantar_daily_pickup.sql` | tabel `mengantar_daily_pickup` (`date` UNIQUE, `time_id`) |
| `src/lib/pickup-schedule.ts` | **murni** — hari kerja, cutoff, tanggal pickup efektif |
| `src/lib/mock-db/pickup.ts` | akses tabel (server-only) |
| `src/lib/mengantar-pickup.ts` | **satu pintu** `POST /time` + `getTodayPickupTimeId()` |
| `src/app/api/cron/mengantar-pickup/route.ts` | GET, dipicu Vercel Cron, guard `CRON_SECRET` |
| `vercel.json` | `"schedule": "0 23 * * 0-5"` |

- **⚠️ Cron Vercel memakai UTC, bukan WIB.** 06:00 WIB = **23:00 UTC hari SEBELUMNYA**, jadi
  "Senin–Sabtu WIB" ditulis sebagai **Minggu–Jumat UTC** → `0 23 * * 0-5`. Menulis `0 6 * * 1-6`
  akan jalan 13:00 WIB dan salah hari untuk Sabtu/Senin. Jangan "diperbaiki" tanpa menghitung ulang.
- **Cutoff 15:00 WIB** (`PICKUP_CUTOFF_HOUR_WIB`): lewat jam itu, pesanan memakai `time_id` **hari
  kerja berikutnya**. Sabtu sore → Senin. **Hari Minggu, jam berapa pun, juga → Senin** — cabang
  `bukan-hari-pickup` di `resolvePickupDate`; tanpa itu pesanan Minggu pagi meminta slot untuk hari
  yang kurirnya tidak datang.
- **`getTodayPickupTimeId()` tiga lapis**: (1) baca tabel — jalur normal, nol panggilan keluar;
  (2) fallback `POST /time` **yang hasilnya DISIMPAN**; (3) `MENGANTAR_PICKUP_TIME_ID` statis.
- **Fallback lapis 2 adalah jalur NORMAL setiap sore**, bukan pengecualian: cron hanya membuat slot
  untuk hari itu, sedangkan pesanan setelah 15:00 butuh tanggal besok yang cron-nya baru jalan besok
  pagi. Karena hasilnya disimpan, hanya pesanan PERTAMA sore itu yang memanggil Mengantar — dan cron
  esok hari otomatis melewati tanggal itu karena barisnya sudah ada. **Kalau panggilan sore ingin
  dihilangkan sama sekali**, ubah cron agar meng-generate hari ini **dan** hari kerja berikutnya.
- **Idempotensi**: `ensurePickupForDate` **membaca dulu, baru** memanggil Mengantar. Membaliknya
  membuat setiap re-run cron menumpuk slot pickup sampah di sistem kurir.
- **Balapan diselesaikan DB, bukan kode**: `savePickup` melakukan `insert` lalu menangkap
  `23505` (unique_violation) dan membaca ulang baris pemenang — bukan pola "cek dulu lalu insert"
  yang bocor saat cron re-run bersamaan dengan fallback checkout. Juga **bukan upsert**: menimpa
  `time_id` yang sudah dipakai order lain hari itu membuat sebagian paket terdaftar di slot berbeda
  dari yang tercatat di sistem.
- **`CRON_SECRET` wajib.** Tanpa guard, siapa pun yang tahu URL-nya bisa memicu pembuatan slot
  pickup baru di Mengantar. Env kosong → **500**, bukan 401 (salah konfigurasi kita, bukan serangan).
#### Kontrak `POST /time` — TERVERIFIKASI terhadap sandbox

```
POST {MENGANTAR_BASE_URL}/api/public/{MENGANTAR_API_KEY}/time
Content-Type: application/json          ← TANPA header auth
{ "address_id": "<MENGANTAR_STORE_ADDRESS_ID>", "date": "08-20-2026", "time": "17:00" }
```

Respons:

```json
{ "success": true,
  "data": { "_id": "6a8660eb458cf203c3cc498f", "date": "2026-08-20T00:00:00.000Z",
            "time": "17:00", "status": "empty", "isSunday": false, "address": { … } } }
```

Tiga jebakan yang sudah menggigit dan sekarang terkunci di kode:

1. **API key ada di dalam URL sebagai segmen path**, bukan header. Berarti URL-nya **rahasia** —
   `publicEndpoint()` tak pernah dicetak ke log, dan cabang `network` hanya melaporkan
   `error.name`, bukan `error.message` (yang di sebagian runtime memuat URL).
   Konsekuensi lain: key ini **tak boleh pernah** dipakai dari komponen klien — ia akan terbaca
   utuh di tab Network.
2. **Tanggal berformat `MM-DD-YYYY`** (gaya AS), bukan ISO dan bukan `DD-MM-YYYY`. Konversi hanya
   lewat `toMengantarDate()`. Terbukti benar karena respons memantulkan
   `date: "2026-08-20T00:00:00.000Z"` untuk kiriman `"08-20-2026"`. Salah urutan berpotensi
   diterima sebagai tanggal LAIN tanpa error — slot dibuat untuk hari yang salah dan baru terlihat
   saat kurir tak datang.
3. **`time_id` = `data._id`.** Mengantar tak memakai nama `time_id` di responsnya, padahal field
   itulah yang diminta saat create order. `extractTimeId` mencoba `data._id` lebih dulu, sisanya
   cadangan.

Juga: **body membawa `success`.** HTTP 200 dengan `success: false` = ditolak secara logis (mis.
`address_id` tak dikenal) dan diperlakukan sebagai gagal, bukan sukses.

**Mengantar TIDAK men-dedupe berdasarkan tanggal** — terbukti: dua permintaan untuk tanggal sama
menghasilkan dua `_id` berbeda. Inilah alasan `ensurePickupForDate` **membaca DB dulu**; tanpa itu
setiap re-run cron meninggalkan slot pickup terlantar di sistem kurir.

- **`MENGANTAR_BASE_URL` masih sandbox** (`https://sandbox.mengantar.com`) — jadwal pickup yang
  dibuat tidak nyata. Ganti ke host produksi **beserta API key produksi** sebelum go-live.

### Host Mengantar — SATU PINTU di `src/lib/mengantar-host.ts`

`MENGANTAR_BASE_URL` menentukan host untuk **cek ongkir, `POST /time`, DAN `POST /order`**.
Sebelumnya cek ongkir hardcode ke `app.mengantar.com` sementara booking memakai env → kita
**mengutip harga produksi lalu membooking di sandbox**.

**Tabel tarif sandbox BUKAN tarif nyata** (J&T, 1 kg, terukur):

| Rute | `app.mengantar.com` | `sandbox.mengantar.com` |
|---|---|---|
| Surabaya → Surabaya | Rp4.800 | Rp61.200 |
| Surabaya → Jakarta | Rp11.200 | Rp18.640 |
| Jakarta → Jakarta | Rp8.000 | Rp25.520 |

Bukti bahwa sandbox dummy: intra-Surabaya di sandbox **lebih mahal** daripada Surabaya→Jakarta —
mustahil pada tarif nyata. **Aturan pembulatan berat juga beda**: produksi memakai
`ceil(kg − 0,3)`, sandbox mengalikan **linear** (18.640 × 1,03 = 19.199). Jadi jangan pernah
memvalidasi aturan pembulatan terhadap sandbox.

- **Beralih lingkungan = ganti satu env var + redeploy.** Tak ada perubahan kode.
- **Search alamat SENGAJA tetap ke `app.mengantar.com`** dan tidak mengikuti env: master data
  wilayah identik di kedua host (pencarian "Kemayoran" mengembalikan `_id` yang sama persis, dan
  `_id` dari produksi terbukti diterima saat booking di sandbox). Membiarkannya di produksi membuat
  pencarian alamat tetap hidup walau `MENGANTAR_BASE_URL` salah isi.
- **⚠️ Selama sandbox aktif, perbandingan gudang jadi terbalik.** Dengan tarif sandbox, Gudang Utama
  (Surabaya) tampak LEBIH MURAH (±Rp19k) daripada Gudang Jakarta (±Rp26k), padahal di produksi
  justru sebaliknya (Rp11.200 vs Rp8.000). Jadi selama pengujian setiap pesanan akan diarahkan ke
  gudang Surabaya — sementara booking selalu berangkat dari alamat pickup Cengkareng.
  Lihat "Origin gudang vs alamat pickup" di bawah.

### Origin gudang vs alamat pickup — BELUM selaras

| Gudang (tabel `warehouses`) | `mengantar_origin_id` menunjuk ke | Alamat pickup booking |
|---|---|---|
| Gudang Utama Infarm (**default**) | **SURABAYA** / Sukolilo / Keputih | Cengkareng, Jakarta Barat |
| Gudang Jakarta | Jakarta Barat / Cengkareng / Kedaung Kali Angke | Cengkareng, Jakarta Barat |

Cek ongkir membandingkan **origin per gudang**, tapi booking memakai **satu**
`MENGANTAR_STORE_ADDRESS_ID` (`PICKUP_ADDRESS "Jl Melati no 9"`, `CENGKARENG BARAT`). Artinya paket
SELALU dijemput di Cengkareng, kurirnya menagih rute dari Cengkareng, tapi pembeli bisa dikutip
tarif dari Surabaya. Hanya **Gudang Jakarta** yang konsisten.

#### Penyelarasan sekarang: `MENGANTAR_PICKUP_ORIGIN_ID`

Diselaraskan lewat **satu env**, dibaca hanya oleh `getQuoteOriginId()` di `src/lib/warehouse.ts`:

```
MENGANTAR_PICKUP_ORIGIN_ID=5fc62f5ff8f44b34aa4c0dbc   # CENGKARENG BARAT — kelurahan alamat pickup
```

Bila di-set, **seluruh kutipan ongkir** memakai origin ini, apa pun gudang pemenuhnya → harga yang
dilihat pembeli = harga yang benar-benar ditagih saat booking. Kosong → perilaku lama (origin per
gudang) tanpa perubahan kode.

Seluruh kelurahan Cengkareng berbagi `ORIGIN_CODE: CGK10000` dan `JT_Code: JKT001`, jadi kelurahan
mana pun di Cengkareng memberi tarif identik — nilai di atas tak perlu persis sama dengan kelurahan
`PICKUP_ADDRESS`, cukup satu zona asal yang sama.

**Konsekuensi yang disengaja:** semua gudang jadi berharga sama, jadi pemilihan gudang **tak lagi
berbasis ongkir**. Pemenangnya cukup gudang ber-stok, deterministik lewat `resolveWarehouseForOrder`
(gudang default didahulukan). `resolveShippingOptions` kini mengelompokkan gudang per origin dan
memanggil Mengantar **satu kali per origin**, bukan per gudang.

Jalan keluar permanen (belum dikerjakan — lihat ROADMAP.md): tambah kolom `mengantar_address_id` per
gudang, booking memakai alamat pickup milik gudang pemenuh, lalu **cabut env ini**. Butuh alamat
gudang Surabaya didaftarkan lebih dulu di dashboard Mengantar + slot `time_id` per alamat (cron
sekarang hanya membuat satu slot).

### Logo kurir — `src/lib/courier-logo.ts` + `CourierLogo.tsx`

Tampil di baris trigger "Metode Pengiriman" (36px) dan di tiap opsi bottom sheet (44px).
Susunan baris: `[logo] [nama + estimasi tiba] … [harga] [centang bila terpilih]`.

- **Peta kurir→file** di `src/lib/courier-logo.ts` (`COURIER_LOGOS`). Kunci = kode kurir yang sudah
  dinormalkan `normalizeCourierKey()` (huruf besar, buang non-alfanumerik) sehingga `'JT'` dari
  `courier.id`, `'J&T'` dari `courier.name`, dan `orders.nama_ekspedisi` **menghasilkan logo yang
  sama**. File di `public/images/couriers/<kode huruf kecil>.png` (lihat README di folder itu).
- **Menambah kurir = taruh file + satu baris di peta.** Tak ada gaya/ukuran yang perlu disentuh.
- **Radio button lama DIHAPUS**; logo mengambil tempatnya. Penanda terpilih = border+ring hijau
  kartu, ditambah centang di ujung kanan. Ruang centang tetap disediakan saat tak aktif supaya
  harga tak bergeser ketika buyer berpindah pilihan. `role="radio"`/`aria-checked` dipertahankan.
- **Kotak logo SELALU putih**, termasuk saat kartu aktif berlatar `brand-surface`. Logo kurir
  umumnya PNG transparan berwarna gelap; membiarkannya di atas latar hijau membuatnya menempel ke
  ring penanda pilihan. Karena itu README mensyaratkan logo BERWARNA, bukan versi putih.
- **File belum ada → jatuh ke ikon truk** lewat `onError` (karena itu `CourierLogo` `'use client'`).
  Terverifikasi: `GET /images/couriers/jt.png` 404 → ikon truk, tanpa gambar rusak. Catatan: 404-nya
  tetap muncul di console browser, jadi entri di `COURIER_LOGOS` sebaiknya hanya ditambahkan setelah
  filenya benar-benar ada.

### Kurir dibatasi J&T saja

Daftar putih ada di **`src/lib/mengantar-estimate.ts`** (`ALLOWED_COURIER_IDS`, saat ini hanya
`JT_COURIER_ID = 'JT'`). Menambah kurir lain = tambah satu entri di situ.

- **Kode kurir J&T = `JT`** — dua huruf kapital, TANPA `&` dan tanpa spasi. Terverifikasi lewat
  probe 4 rute; respons `allEstimatePublic` memuat 16 key (`JNE, JNECargo, SiCepat, SiCepatCargo,
  SAP, SAPLite, SapCargo, iDexpress, iDlite, JT, lion, iDexpressCargo, anteraja, paxel, Ninja,
  pos`). Nama `"J&T"` hanya ada di `COURIER_DISPLAY_NAMES` (label kita) dan di
  `orders.nama_ekspedisi` (`JT_COURIER_LABEL`) — **bukan** di respons Mengantar.
- **Respons cek ongkir TIDAK punya field `nama_ekspedisi`/`jenis_layanan`.** Bentuknya objek
  ber-key kode kurir: `{ data: { JT: { estimatedSpecialPrice, estimatedDate, unsupported } } }`.
  Kolom `nama_ekspedisi`/`jenis_layanan` adalah kolom tabel `orders` kita. Jadi filter
  "nama_ekspedisi mengandung J&T" tidak akan cocok apa pun.
- **Dicocokkan EKSAK (`id === 'JT'`), bukan substring `includes('jt')`** — pencocokan longgar akan
  menyambar key baru yang kebetulan memuat huruf itu, dan pembeli ditawari layanan yang booking-nya
  belum kita dukung.
- **Penyaringan DI SISI SERVER**, di `warehouse-shipping.ts` sebelum respons dikirim. Kurir lain
  tak pernah melewati batas jaringan — tak ada kedipan daftar kurir lain di UI.
- **Daftar kosong → `reason: 'NO_JT_SERVICE'`** (dulu `NO_COURIER_AVAILABLE`), dan checkout
  menampilkan *"Maaf, J&T tidak melayani pengiriman ke alamat ini saat ini."* Dibedakan dari
  `ESTIMATE_UNAVAILABLE` yang layak dicoba ulang.
- **Opsi termurah AUTO-SELECTED** saat dimuat (`selected` masih null). Nama kurir cuma satu, jadi
  memaksa buka-sheet-lalu-Konfirmasi adalah langkah kosong. Sheet tetap ada karena dengan beberapa
  gudang J&T muncul **beberapa kali dengan tarif berbeda**.
- **`optionKey()` = `warehouseId::courierId`.** WAJIB gabungan: daftar adalah gabungan beberapa
  gudang, jadi semua baris ber-id `JT`. Memakai `courier.id` saja menyebabkan duplicate React key
  DAN `find()` mengembalikan baris pertama — buyer melihat tarif gudang A tapi ordernya diarahkan
  ke gudang B.
- **SATU baris per kurir (termurah) yang dikirim ke pembeli** — `cheapestPerCourier()` diterapkan di
  `/api/mengantar/shipping/options` sebelum respons. Tanpa ini, produk yang stoknya ada di beberapa
  gudang memunculkan dua baris berlabel **persis sama** (`"J&T"`, estimasi sama) yang hanya beda
  harga, tanpa cara apa pun bagi pembeli membedakannya — dan tak ada alasan seseorang memilih yang
  lebih mahal. Gejalanya baru telanjang setelah kurir difilter J&T saja; sebelumnya tersamar di
  antara 16 nama kurir.
  **Daftar LENGKAP tetap disimpan di cache** `shippingOptionsKey` — `orders/create` memakainya untuk
  jatuh ke gudang termurah BERIKUTNYA bila gudang pilihan gagal verifikasi stok. Men-dedupe sebelum
  cache akan menghapus jalur fallback itu.
- `fetchShippingEstimate` (jalur satu gudang, **tanpa pemanggil**) TIDAK menerapkan daftar putih.
  Jangan dipakai untuk checkout.

### Booking Kurir (`POST /order`) — TERPASANG

| Berkas | Peran |
|---|---|
| `src/lib/mengantar-shipment.ts` | **satu pintu** `POST /order` (server-only, memegang API key) |
| `src/lib/shipment-booking.ts` | orkestrasi: panggil Mengantar → catat hasil ke pesanan |
| `src/app/api/webhooks/xendit/route.ts` | pemicu NYATA, di dalam `handlePaid()` |
| `src/app/api/dev/simulate-payment/route.ts` | pemicu SIMULASI, **development-only** |
| `supabase/migrations/20260820130000_add_orders_shipment.sql` | kolom `shipment_status/error/booked_at` |

Kontrak terverifikasi terhadap sandbox:

```
POST {MENGANTAR_BASE_URL}/api/public/{MENGANTAR_API_KEY}/order
{ "courier": "JT",
  "pickup": { "type": "scheduledPickup", "volume": "volumeMotor",
              "address_id": "<MENGANTAR_STORE_ADDRESS_ID>", "time_id": "<getTodayPickupTimeId()>" },
  "orders": [{ "goodsValue": 46000, "customerName": "…", "customerPhone": "08…",
               "customerAddress": "<detail jalan saja>", "customerAddressDataId": "<destination_id>",
               "parcelContent": "…", "weight": 1, "quantity": 1 }] }
```

Respons: `{ success, data: [ { cnote_no, ORDER_ID, SERVICE_CODE, … } ], batch, batch_id, courier,
errors: [], ordersClosedDestination: [] }`

- **⚠️ `courier` harus `"JT"` KAPITAL.** Huruf kecil `"jt"` ditolak `400 {"message":"Invalid courier"}`
  — sudah diuji. Kebetulan sama dengan key di cek ongkir, jadi satu konstanta.
- **Nomor resi = `data[0].cnote_no`** (mis. `JO9303785004`). `jenis_layanan` diisi dari
  `data[0].SERVICE_CODE` (mis. `REG`).
- **`success: true` BUKAN jaminan sukses.** Mengantar bisa menaruh order bermasalah di `errors` /
  `ordersClosedDestination` sambil tetap `success: true` — keduanya diperiksa
  (`collectPartialErrors`) dan dianggap **gagal**.
- **`quantity` = jumlah KOLI, bukan jumlah barang.** Selalu `1`; mengirim total pcs membuat kurir
  menagih beberapa paket untuk satu kiriman.
- **`weight` dihitung ulang server** dari `products.berat` (bukan dari client, bukan dari
  `order_items` yang tak menyimpan berat). `goodsValue` dari `SUM(price × qty)` `order_items` —
  bukan `totalAmount` yang sudah memuat ongkir & dikurangi diskon.
- **`customerAddress` hanya detail jalan.** Kota/kecamatan/kelurahan di-resolve Mengantar dari
  `customerAddressDataId`.

Penanganan kegagalan (poin penting — uang pembeli sudah masuk):

- Pesanan **TETAP tersimpan**. Yang ditandai: `shipment_status = 'FAILED'` + `shipment_error`
  (alasan + detail), resi TIDAK disentuh. Tabel Pesanan OMS menampilkan badge merah
  **"Booking gagal"** di kolom No. Resi (tooltip = pesan errornya), dan CSV ekspor punya kolom
  **"Status Booking Kurir"**.
- `shipment_status` **NULL ≠ FAILED**: NULL = belum pernah dicoba (pesanan lama / belum dibayar).
  Tanpa pembedaan ini resi kosong tak bisa dibedakan dari pesanan yang memang belum waktunya.
- **Idempoten**: resi yang sudah terbit tak pernah diganti resi baru (paket fisiknya sudah
  berlabel). Callback ulang → `ALREADY_BOOKED`.
- **Kegagalan booking TIDAK membuat webhook membalas non-2xx.** Pembayarannya sah dan sudah
  tercatat; mengulang callback tak memperbaiki alamat yang salah, hanya menumpuk percobaan booking.
- `BOOKED_BUT_NOT_SAVED` = resi terbit di Mengantar tapi gagal tercatat. Paling berbahaya (tak ada
  jejak) → dicatat sekeras mungkin di log.
- Kolom `shipment_*` belum di-migrate → `updateShipment` **tetap menyimpan resi** lewat fallback
  `PGRST204`/`42703`, hanya status booking yang tak tercatat.

**⚠️ Ongkir yang dikutip vs biaya booking bisa BEDA bila `MENGANTAR_PICKUP_ORIGIN_ID` kosong.**
`POST /order` tak punya field origin — Mengantar menagih dari `pickup.address_id`. Terbukti pada
`INV-20260820-4876`: gudang pemenuh Surabaya, dikutip Surabaya→Kemayoran Rp18.000, ditagih
Cengkareng→Kemayoran ±Rp25.000. Selisihnya keluar dari saldo Mengantar dan **tak tercatat di pesanan
mana pun** (tabel `orders` tidak punya kolom ongkir sama sekali — lihat ROADMAP.md).
Penyelarasannya: bagian "Origin gudang vs alamat pickup" di atas.
- **Belum ada call site.** Booking kurir belum dibuat, jadi `getTodayPickupTimeId()` belum dipanggil
  dari alur order mana pun. Saat booking dikerjakan, panggil dari route handler
  (`POST /api/orders/create` atau endpoint booking terpisah) — **bukan** Server Action; project ini
  tidak memakai Server Action sama sekali.

### Berat Kirim — SATU PINTU di `src/lib/shipping-weight.ts`

**Berat produk disimpan GRAM (integer) di `products.berat`, tapi Mengantar meminta KILOGRAM.**
Konversi hanya boleh terjadi lewat `src/lib/shipping-weight.ts` — jangan pernah membagi 1000
sendiri di komponen atau route. Salah satuan bukan galat kecil: mengirim gram apa adanya membuat
ongkir **1000× lebih mahal** (terbukti: `weight=1` → JNE Rp30.000, `weight=1000` → Rp30.000.000).

- **Rumus**: `totalBerat = SUM(berat_produk × quantity)` gram → `shippingWeightKg()` → kg, minimum
  1 kg, dibulatkan 2 desimal (agar kunci cache `shippingOptionsKey` stabil, bukan `3.3299999…`).
- **Produk hadiah promo IKUT ditimbang** — barangnya tetap dikirim fisik. Mengabaikannya membuat
  ongkir yang dikutip lebih murah dari tarif kurir sebenarnya.
- **`berat` NULL/tak valid → `DEFAULT_WEIGHT_GRAM` (1000 g/pcs)**, yaitu perilaku persis sebelum
  fitur ini ada. Angka ini **bukan** penanda "belum diisi" — untuk itu pakai `isWeightUnset()`,
  jangan membandingkan `berat === 1000` (produk yang beratnya memang 1 kg akan salah dibadge).
- **JANGAN membulatkan kg sendiri.** Mengantar sudah menerapkan aturan kurir Indonesia
  ">0,3 kg dibulatkan ke atas" di sisi server: kg ditagih = `ceil(kg − 0,3)`, minimum 1
  (terverifikasi: 1,3 → 1 kg; 1,31 → 2 kg; 2,3 → 2 kg; 2,31 → 3 kg). Membulatkan ganda hanya
  membebani buyer satu kilogram ekstra yang tak pernah ditagih kurir.
- **Reaktivitas**: `shippingWeight` di `/checkout` adalah `useMemo` atas item cookie
  (`useSyncExternalStore`) → berubah otomatis saat isi keranjang/quantity berubah, dan
  `ShippingOptions` memakainya sebagai dependency efek fetch → ongkir ikut di-refresh sendiri.
  **Jangan tambah pemicu manual.**
- **Server TIDAK memercayai berat dari client.** `POST /api/orders/create` menghitung ulang
  (`serverWeight`) dari `products.berat` di DB. Kalau berat dipercaya dari payload, pembeli bisa
  mengirim berat kecil untuk ongkir murah sementara kurir menagih tarif berat sebenarnya —
  selisihnya ditanggung toko. Field `weight` di payload masih diterima demi klien lama tapi
  **diabaikan**.
- **Saat booking kurir dikerjakan nanti**: hitung berat dari `order_items` di DB memakai modul yang
  sama, JANGAN dari nilai apa pun yang dikirim client saat checkout.
- **Catatan pra-ada**: kunci cache ongkir di client memakai `shippingItems` **tanpa** item hadiah
  promo, sedangkan server memakai `requirements` **dengan** item hadiah. Bila ada promo hadiah aktif,
  lookup cache fallback pemilihan gudang tak akan cocok dan turun ke `resolveWarehouseForOrder`
  (aman, tapi kurang optimal). Bukan akibat fitur berat — sudah begitu sebelumnya.

## Validasi Form Checkout (client-side)

Section Alamat Pengiriman divalidasi di client sebelum request order dikirim. Logika terpusat di
`src/lib/checkout-validation.ts` (`validateAddress`) + helper `phone.ts` & `email.ts`:

- **Nama**: min 3 karakter. **Alamat lengkap**: min 10 karakter.
- **Telepon** (`phone.ts`): hanya angka (non-digit diblok saat mengetik via onKeyDown/onChange),
  wajib diawali `08`, panjang 10–12 digit. Disimpan sebagai angka bersih `08xxxxxxxxx`.
- **Email** (`email.ts`): **WAJIB**, dikembalikan ke form pada 2026-08-31. Regex sengaja sederhana
  (ada `@`, domain bertitik, TLD ≥ 2 huruf, tanpa spasi, maks 254 karakter) — bukan RFC 5322 penuh,
  karena format seketat apa pun tak bisa membuktikan kotak suratnya ada; tugasnya hanya menolak yang
  jelas salah ketik. **Dinormalisasi ke huruf kecil + trim** (`normalizeEmail`) sebelum disimpan
  DAN sebelum dipakai mencari; tanpa itu `Budi@Gmail.com` saat checkout dan `budi@gmail.com` saat
  melacak menjadi dua identitas berbeda. Di UI, kotaknya menampilkan teks apa adanya saat mengetik
  lalu disamakan ke bentuk ternormalisasi saat `onBlur`.
  `getEmailError` mengembalikan pesan spesifik per jenis kesalahan ("Email harus mengandung tanda @",
  "Domain email harus mengandung titik…"), bukan satu pesan generik.
- **Alamat**: wajib dipilih dari search Mengantar (`destination_id` tidak boleh kosong).
- **Kurir**: wajib dipilih (`selected_courier`).
- Tombol "Bayar Sekarang": disabled-visual + **guard di handler** (bukan hanya atribut `disabled`).
  Saat ditekan tapi belum lengkap → toast + auto-scroll ke field pertama yang invalid + border merah.

## Email Konfirmasi Pesanan

> **Update 2026-08-31**: form checkout **mengumpulkan email lagi** dan field itu WAJIB. Order baru
> mengirim `customerEmail` berisi nilai asli ke `/api/orders/create` → tersimpan di kolom
> `orders.email`. Fitur kirim email otomatis di bawah ini **masih roadmap**, tapi kini sudah punya
> alamat tujuan. Email juga menjadi kunci pencarian SELURUH layanan pesanan guest (lacak, batalkan, review)
> — lihat "Layanan Pesanan Guest".
>
> ⚠️ **Nama kolomnya `email`, BUKAN `customer_email`.** Migration
> `20260624120000_add_orders_customer_email.sql` menyebut `customer_email`, tapi kolom itu **tak
> pernah ada** di database (`.eq('customer_email')` → `42703 undefined_column`). Kolom `email` sudah
> ada sejak tabel dibuat dan itulah yang diisi RPC `create_order_with_items` lewat `p_email`. File
> migration itu mendeskripsikan kolom yang tak pernah dibuat — jangan dijadikan acuan.
>
> **Pesanan lama ber-email NULL** (dibuat selama field email absen) tidak bisa dilacak lewat
> `/track-order`, `/cancel-order`, maupun `/review`; ketiganya mengarahkan pembelinya ke jalur
> yang masih berbasis nomor invoice (pencarian /track, atau tautan bertoken pada bukti pesanan).

- Template HTML: **`src/emails/order-confirmation.html`** — table-based + inline CSS (kompatibel
  Gmail/Outlook/Mail iOS), fluid `max-width:600px; margin:0 auto`, palet brand (`#46b33c`).
- Placeholder backend: `{{logo_url}}`, `{{order_id}}`, `{{item_list}}`, `{{total_price}}`,
  `{{tracking_url}}`, `{{cancel_url}}`. **Email wajib URL absolut** (path relatif hanya untuk preview).
- Aset gambar email di **`public/images/email/`** (mis. `logo-infarm.png`; lihat README folder tsb).
- Preview lokal: **`/dev/email-preview`** (route handler membaca file template + isi placeholder
  dengan data contoh). Hanya untuk development.
- Kolom **`email`** (TEXT, nullable) di tabel `orders` — nullable dipertahankan karena pesanan lama
  memang tak punya nilainya; order baru selalu mengisinya. `saveOrder` punya fallback aman bila
  kolom belum di-migrate (cek kode error `PGRST204`/`42703`).

## Paket & Combo dan Promosi (OMS + Storefront)

Dua fitur OMS yang sudah Supabase + tampil real di storefront keranjang. Pola data sama seperti
produk/order: tipe di `src/types/*`, akses di `src/lib/mock-db/*` (server-only via `createAdminClient`),
validasi server di `src/lib/*-validation.ts`, UI lewat API Routes (BUKAN server action).

### Paket & Combo
- **Tabel**: `product_combos` + `product_combo_items` (FK `combo_id` ON DELETE CASCADE).
  Item menyimpan **snapshot** `name`/`unit_price` (tanpa FK ke products). Harga normal TIDAK
  disimpan — dihitung dari `calcNormalPrice(items)` (`src/types/combo.ts`).
- **OMS**: `/oms/dashboard/paket-combo` (daftar), `.../baru`, `.../[id]/edit` (form bersama `ComboForm`).
  Data via `src/lib/mock-db/combos.ts` + API `/api/combos/{create,update,delete,toggle,list}`.

### Promosi
- **Tabel**: `promotions` (kolom: `type`, `min_purchase`, `free_product_id`/`free_product_name`
  [snapshot], `discount_value`, `start_at`/`end_at`, `progress_message`, `is_active`).
  `type` ∈ `free_shipping | free_product | discount_nominal | discount_percent`.
  Status **Kedaluwarsa TIDAK disimpan** — dihitung dari `end_at` (`isPromotionExpired`).
- **OMS**: `/oms/dashboard/promosi` (daftar + filter Aktif/Nonaktif/Kedaluwarsa, badge "Stok Habis"
  bila produk hadiah free_product stoknya 0), `.../baru`, `.../[id]/edit` (form bersama `PromotionForm`,
  detail hadiah kondisional + preview pesan `{sisa}`). Data via `src/lib/mock-db/promotions.ts` +
  API `/api/promotions/{create,update,delete,toggle,list}`.

### Tampil di keranjang (storefront)
- Endpoint **publik server-filtered**: `GET /api/promotions/active` (hanya `is_active` & belum
  kedaluwarsa, urut `min_purchase` ASC) dan `GET /api/combos/active` (hanya `is_active`).
  Query Supabase tetap server-only di route handler → tidak ter-expose ke client.
- Logika promo/combo keranjang murni di `src/lib/promo-cart.ts`:
  - `computePromoProgress` (progress bar + pesan `{sisa}` → rupiah; tercapai → pesan sukses)
  - `computePromoRewards` (agregasi hadiah tercapai: free_shipping → ongkir GRATIS,
    discount_nominal/percent → kurangi total, free_product → produk hadiah)
  - `selectRelevantCombos` (combo aktif, semua produk stok > 0, minimal 1 produk di keranjang,
    bukan yang semua produknya sudah di keranjang; urut relevansi, maks 3)
  - `allocateComboPrices` (bagi `combo_price` ke tiap produk; total ≈ harga combo)
- UI: `CartPromoList`, `CartComboList`, `CartPaymentSummary`. Tombol "Tambah Paket ke Keranjang"
  memakai `addComboToCart` (`cart-client.ts`) — produk yang sudah ada quantity-nya DISESUAIKAN,
  harga = harga combo, item ditandai `comboId`.
- **Section "Beli Kombo Lebih Hemat" di DETAIL produk** (`BundleOffer`, `components/product/`):
  tiap kartu combo punya **checkbox pojok kiri atas** — centang = seluruh produk combo masuk keranjang
  (`addComboToCart`, harga combo); uncheck = `removeComboFromCart(comboId)` (`cart-client.ts`).
  Status checked **disinkron reaktif** dengan isi keranjang (`useSyncExternalStore`) → tetap sinkron
  setelah reload. Rincian isi paket (nama ×qty) tampil di `<details>` collapsible (kartu tetap ringkas).
  Checkmark kanan = indikator status (hijau bila sudah di keranjang).
- Saat menuju checkout, snapshot promo/combo disimpan ke cookie `infarm_checkout_promo`
  (`setCheckoutPromo`, tipe `CheckoutPromoSnapshot`) untuk diteruskan ke order nanti *(wiring ke
  tabel orders masih roadmap)*.

## Skema Order & Checkout (Supabase) — sudah diperbarui

Tabel `orders` **memakai kolom Bahasa Indonesia** + tabel anak `order_items`. Enum di DB
Inggris, dipetakan ke label Indonesia di data layer (`rowToOrder`), jadi UI dashboard/track/cancel
tidak perlu berubah saat skema DB berganti.

- **`orders`** (kolom utama): `nomor_invoice` (unik), `email`, `no_telepon`, `nama_customer`,
  `jumlah_total`, `shipping_address`, `provinsi`/`kota`/`kecamatan`/`kelurahan`/`kodepos`,
  `nama_ekspedisi`, `jenis_layanan`, `no_tracking`, `id_transaksi`, `destination_id`,
  `status_pembayaran`, `order_status`, `created_at`.
- **`orders.metode_pembayaran`** (migration `20260828120000_add_orders_metode_pembayaran.sql`) —
  metode/channel yang BENAR-BENAR dipakai pembeli, apa adanya dari callback Xendit (`BCA`, `OVO`,
  `QRIS`, `ALFAMART`, …). Sebelum kolom ini, pilihan pembeli di halaman Xendit tak pernah kembali ke
  kita; `id_transaksi` tak memberi tahu cara bayarnya. **Diisi HANYA oleh webhook pembayaran**
  (`handlePaid`) — saat tagihan diterbitkan pembeli belum memilih apa pun. Jadi NULL = belum
  dibayar / kedaluwarsa / pesanan sebelum migration, **bukan** "datanya hilang". Tanpa CHECK daftar
  nilai: Xendit menambah channel kapan saja, dan constraint yang ketinggalan akan menggagalkan
  penyimpanan status LUNAS pesanan yang uangnya sudah masuk. **Tanpa backfill.**
- **`order_items`**: `order_id` → `orders.id`, `product_id` (nullable — dummy non-UUID → null),
  `quantity`, `price_at_purchase` (**snapshot harga saat beli**, bukan harga produk sekarang).
- **Enum ↔ label**:
  - `status_pembayaran` `PENDING|PAID|FAILED` ↔ `Menunggu|Lunas|Gagal`
  - `order_status` `PENDING|PROCESSING|SHIPPED|COMPLETED|CANCELLED` ↔
    `Menunggu Pembayaran|Diproses|Dikirim|Selesai|Dibatalkan`
- **Checkout atomik**: `POST /api/orders/create` → `saveOrder` (`src/lib/mock-db/orders.ts`) memanggil
  **RPC `create_order_with_items`** (`supabase/migrations/20260702120000_...`, plpgsql `security definer`):
  dalam SATU transaksi — insert `orders` + `order_items` + kurangi `products.stock`. Stok salah satu
  produk kurang → `raise exception 'INSUFFICIENT_STOCK:<nama>'` → **seluruh transaksi rollback**;
  app melempar `OrderStockError` ("Stok produk … tidak mencukupi").
- **Nomor invoice**: `generateInvoiceNumber()` = `INV-{YYYYMMDD}-{8 karakter Crockford base32}`,
  mis. `INV-20260820-MW2S47ZX`. Unik via index `orders_nomor_invoice_key`; `saveOrder` retry
  beberapa kali bila tabrakan (unique violation).
  - **Dulu 4 digit desimal** (9.000 kemungkinan per tanggal) — bisa dienumerasi habis dalam
    hitungan menit, dan `/track` tidak memverifikasi kepemilikan apa pun. Sejak halaman itu juga
    menampilkan isi belanja + nominal (kartu Produk Dipesan), entropinya dinaikkan ke **40 bit**
    (≈1,1 × 10¹²). Sumber acak `crypto.randomUUID()`, BUKAN `Math.random()`.
  - Alfabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ` — tanpa I/L/O/U agar tak tertukar saat dibacakan;
    panjang tepat 32 supaya pemetaan 5-bit tidak berbias.
  - **Pesanan lama tetap bernomor 4 digit** dan tetap bisa dilacak. Format lama tak divalidasi di
    mana pun (hanya placeholder di `TrackSearchForm`), jadi keduanya hidup berdampingan.
- **Baris warisan**: `rowToOrder` pakai `orderId: nomor_invoice ?? id` (aman untuk baris lama
  tanpa `nomor_invoice`).


---

## Minimum Pembelian (produk murah) — sudah terpasang

Dua lapis, harus jalan bersamaan (A saja tak menjamin B: gabungan beberapa produk murah tetap
bisa di bawah minimum payment gateway):

- **A. Minimum qty per produk** — kolom `products.min_order_qty` (INT, default 1, CHECK ≥ 1).
  Berlaku **per BARIS keranjang** (produk+varian), konsisten dengan tombol `+`/`−` yang per baris.
  Diisi admin di form tambah/edit produk; validasi `validateMinOrderQty` (`product-validation.ts`).
- **B. Minimum total belanja** — tabel **`store_settings`** (key-value, RLS aktif TANPA policy
  publik) baris `min_order_amount` (TEXT, di-cast INTEGER; seed `15000`). Diubah admin di
  **`/oms/dashboard/pengaturan`** via `PATCH /api/settings/min-order` (`requireAdmin`).
  Storefront membaca lewat `GET /api/settings/min-order` (publik, hanya satu angka — tabelnya
  sendiri tak pernah ter-expose). Cache: `getCachedMinOrderAmount` + tag **`settings`**
  (di-`revalidateTag` saat admin menyimpan).

**Dasar perbandingan = SUBTOTAL BARANG** (tanpa ongkir/diskon). Alasannya di komentar
`orders/create`: itu angka yang dilihat pembeli di keranjang sebelum memilih kurir, sehingga pesan
"kurang Rp X lagi" sama persis di keranjang, checkout, dan penolakan server.

- **UI**: label "Min. beli N pcs" di `CartItemRow` & `StickyBuyBar`; tombol `−` disabled di batas;
  `addToCart` menambah sebanyak `minOrderQty` (bukan 1); bilah keranjang & checkout mengunci tombol
  + menampilkan kekurangannya.
- **Server (WAJIB, jangan andalkan client)**: `POST /api/orders/create` re-fetch produk fresh
  (`readProducts`, bukan cache) lalu tolak `422` dengan `code: 'MIN_ORDER_QTY'` /
  `'MIN_ORDER_AMOUNT'` **sebelum** menyentuh RPC order maupun (nanti) API Xendit.
- Migration: `supabase/migrations/20260810120000_add_min_order.sql`. Semua jalur baca/tulis punya
  fallback bila kolom/tabel belum di-apply (`PGRST204`/`42703` → `minOrderQty` 1,
  `min_order_amount` → `DEFAULT_MIN_ORDER_AMOUNT`).


---

## Pembayaran Xendit — Invoice API v2 (JALUR AKTIF)

Keputusan pemilik proyek 2026-08-21: checkout memakai **Invoice API v2**. Pembeli dibawa ke halaman
pembayaran yang di-host Xendit (`invoice_url`) yang sudah menyediakan semua metode (VA, e-wallet,
QRIS, retail) tanpa kita membangun UI apa pun.

> Jalur **Payment Request v3 / Virtual Account** (bagian di bawah) **TIDAK dipakai lagi** oleh
> checkout. Kodenya utuh dan tak dihapus — lihat ROADMAP.md.

| Berkas | Peran |
|---|---|
| `src/lib/xendit/config.ts` | satu pintu kredensial + penjaga lingkungan (dipakai kedua jalur) |
| `src/lib/xendit/invoice.ts` | penyusun payload `POST /v2/invoices` + pemetaan respons |
| `src/app/api/payments/invoice/route.ts` | endpoint yang dipanggil checkout |
| `src/app/checkout/success/PayNowButton.tsx` | tombol bayar ulang bila penerbitan gagal / halaman ditutup |

### Alurnya

```
"Bayar Sekarang" di /checkout
  → POST /api/orders/create        (RPC atomik: orders + order_items + potong stok)
  → POST /api/payments/invoice     { invoice: nomor_invoice }
  → Xendit POST /v2/invoices
  → window.location.replace(invoice_url)     ← FULL redirect, bukan router.push
  → pembeli bayar di halaman Xendit
  → callback "Invoice paid" → /api/webhooks/xendit → Lunas + booking kurir J&T
  → Xendit redirect ke /checkout/success?invoice=…
```

### Aturan yang tak boleh dilanggar

- **`external_id` WAJIB `orders.nomor_invoice`**, bukan `orders.id` (UUID). Webhook mencari pesanan
  dengan `.eq('nomor_invoice', external_id)`; mengisi UUID = SETIAP callback gagal menemukan
  pesanannya dan pembayaran tak pernah tercatat meski uangnya masuk.
- **Tagihan diterbitkan SETELAH order tersimpan**, bukan sebelum — ia mengacu pada `nomor_invoice`
  yang baru dibuat server. Efek samping yang disengaja: penerbitan tagihan gagal **tidak**
  menghilangkan pesanan; ia tetap ada berstatus Menunggu, dan pembeli diarahkan ke
  `/checkout/success?invoice=…&pay_error=1` yang menyediakan tombol bayar ulang.
- **Client hanya mengirim nomor invoice.** Nominal/nama/telepon dibaca dari tabel `orders`.
- **`invoice_duration` 24 jam** (`INVOICE_DURATION_SECONDS`). Sengaja pendek: pesanan menunggu bayar
  MENAHAN STOK, dan callback EXPIRED-lah yang melepasnya kembali.
- **`items` sengaja TIDAK dikirim** ke Xendit. Jumlah harga item ≠ `amount` (amount memuat ongkir
  dan dikurangi diskon, sementara ongkir tak punya kolom sendiri), dan daftar yang tak berjumlah
  sama dengan tagihan lebih membingungkan daripada tak ada daftar.

### Notifikasi lewat WhatsApp, bukan email

`payer_email` tetap **tidak** dikirim ke Xendit meski `orders.email` kini selalu terisi sejak
2026-08-31. Notifikasi pembayaran sengaja lewat WhatsApp: nomor telepon adalah kanal yang sudah
terbukti dipakai pembeli (lacak/batalkan/review), sementara email baru dikumpulkan lagi dan belum
punya pengirim apa pun (`src/emails/` masih template + preview saja). Jadi
`customer.mobile_number` + `customer_notification_preference` diisi saluran `whatsapp` untuk keempat
peristiwa (created/reminder/paid/expired). Menambahkan `payer_email` bisa dipertimbangkan setelah
pengirim email benar-benar ada.

- Nomor dikonversi ke E.164 oleh **`toE164Phone()`** di `src/lib/phone.ts` (`08…` → `+628…`).
  Xendit menolak format lokal. Nomor tak valid → blok `customer` **tak dikirim sama sekali**
  (mengirim `mobile_number` kosong ditolak).
- ⚠️ Saluran WhatsApp harus **diaktifkan di Dashboard Xendit** (Settings → Customer notifications).
  Bila belum, invoice tetap terbit tapi notifikasinya tak terkirim.
- ⚠️ UNVERIFIED: sebagian versi Invoice API mewajibkan `payer_email`. Bila Xendit menolak dengan
  `API_VALIDATION_ERROR`, nama field-nya akan muncul apa adanya di log lewat `describeXenditError()`.

### `success_redirect_url` = `failure_redirect_url`

Keduanya menuju `/checkout/success?invoice=…`. Halaman itu membaca status **FRESH dari Supabase**,
jadi ia menampilkan keadaan sungguhan tanpa mempercayai parameter redirect — status yang sah hanya
datang dari webhook, dan URL bisa diketik siapa pun.

| Keadaan di DB | Yang tampil |
|---|---|
| `Lunas` | "Pesanan Berhasil" + "Yeay! Pesananmu Sedang Disiapkan" + Estimasi Tiba |
| `Menunggu` | "Menunggu Pembayaran" + "Selesaikan Pembayaran" + kartu amber 24 jam + **tombol Bayar Sekarang** |
| `Dibatalkan` | "Pesanan Dibatalkan" + catatan stok sudah dilepas |

Estimasi tiba **hanya** muncul saat lunas — menampilkannya pada pesanan yang belum dibayar adalah
janji yang belum tentu ditepati (kurir baru dipesan setelah pembayaran masuk).

## Pembayaran Xendit — Virtual Account (Payment Request v3, TIDAK AKTIF)

**Tidak dipakai checkout sejak 2026-08-21** (diganti Invoice API di atas). Kode utuh, tak dihapus.
Dua sisi: **penerimaan** (webhook) sudah lama jadi, **pembuatan** (VA) dibangun lalu ditinggalkan.
Keduanya bertemu di `orders.nomor_invoice`.

### Pembuatan VA — `POST /api/payments/create`

Body: `{ invoice, method }`. Client hanya mengirim **nomor invoice** dan **pilihan bank** —
nominal SELALU dibaca dari `orders.jumlah_total` di DB. Kalau nominal diambil dari body, siapa pun
bisa menerbitkan VA Rp1.000 untuk pesanan Rp1.000.000.

- **Route Handler, bukan Server Action** — project ini nol Server Action; keamanannya identik dan
  helper rate-limit/`requireAdmin` yang sudah ada langsung terpakai.
- **`src/lib/xendit/config.ts`** = satu pintu kredensial. Basic Auth `base64("{KEY}:")` (password
  KOSONG, titik dua wajib). **Penjaga lingkungan**: kunci LIVE (`xnd_production_…`) ditolak di luar
  deployment produksi, aturan & alasan sama dengan `mengantarWriteHost()` — lihat CLAUDE.md →
  "Panggilan API Berbayar". Kunci berformat tak dikenal dianggap LIVE.
- **`src/lib/xendit/payment-request.ts`** = penyusun payload + pemetaan respons. Daftar putih bank
  EKSPLISIT (`VA_CHANNEL_CODES`); bank di luar daftar ditolak dengan pesan kita sendiri, bukan
  dibiarkan ditolak Xendit setelah pembeli menekan bayar. Urutan validasi: **input dulu, kredensial
  belakangan** — kalau dibalik, bank tak didukung dilaporkan sebagai "belum dikonfigurasi" dan
  pembeli menunggu perbaikan yang tak akan datang.
- **`Idempotency-key: nomor_invoice`** — pembeli menekan bayar dua kali mengembalikan Payment
  Request yang SAMA, bukan VA kedua untuk satu pesanan.
- **VA berumur `VA_EXPIRY_HOURS = 24`.** Sengaja pendek: setiap pesanan menunggu bayar MENAHAN STOK
  (checkout sudah memotongnya), jadi VA berumur panjang = stok terkunci tanpa uang masuk.
- **`orders.id_transaksi`** diisi `payment_request_id` lewat `setOrderTransactionId()` — fungsi
  terpisah dari `updatePaymentStatus()` karena id terbit saat VA dibuat (status masih Menunggu),
  bukan saat pembayaran masuk. Gagal menyimpan **tidak** membatalkan respons: VA sudah terbit dan
  webhook menemukan pesanan lewat `reference_id`, bukan kolom ini.
- **Rate limit** `PAYMENT_CREATE_IP` 6/5 mnt/IP + `PAYMENT_CREATE_INVOICE` 5/30 mnt/invoice.
- **Pesan error ke client digeneralkan** (peta `PUBLIC_ERRORS`); detail respons Xendit hanya ke log.

### Webhook menerima DUA bentuk payload

`parseXenditCallback()` mencoba bentuk Invoice API v2 lebih dulu, lalu Payment Request v3:

| | Invoice v2 | Payment Request v3 |
|---|---|---|
| Referensi kita | `external_id` (akar) | `data.reference_id` |
| Status | `status` | `data.status`, cadangan dari `event` |
| Nominal | `paid_amount` \|\| `amount` | `data.amount` \|\| `captured_amount` \|\| `request_amount` |
| id transaksi | `id` | `data.payment_request_id` (didahulukan) \|\| `data.id` |
| Metode bayar | `payment_channel` (didahulukan) \|\| `payment_method` | `…virtual_account.channel_code` \|\| `channel_code` \|\| `payment_method.type` |

Baris **metode bayar** → `orders.metode_pembayaran`. Yang SPESIFIK didahulukan di kedua bentuk:
kolom itu menjawab "dibayar pakai apa" (`BCA`), bukan "lewat mekanisme apa" (`BANK_TRANSFER` /
`VIRTUAL_ACCOUNT`). Hanya `handlePaid()` yang menyimpannya — callback gagal/kedaluwarsa tak
membawanya karena tak pernah ada yang dibayar, dan `updatePaymentStatus()` **tak menulis null** untuk
field kosong (urutan callback tak dijamin; null akan menghapus metode yang sudah tercatat).

Keduanya dipertahankan supaya jalur pembayaran bisa dipindah tanpa mematikan callback yang sudah
beredar. `ParsedCallback.source` mencatat bentuk mana yang cocok (muncul di log sebagai `bentuk=`).

Status: PAID/SETTLED/**SUCCEEDED**/CAPTURED → lunas · EXPIRED/FAILED/**VOIDED**/CANCELED →
gagal + stok dikembalikan · PENDING/**REQUIRES_ACTION**/AWAITING_CAPTURE → tak ada perubahan.
Nominal kurang → **tak pernah** ditandai lunas. Nominal yang tak terbaca jatuh jadi 0 → kurang
bayar (menolak-dengan-aman).

### ⚠️ Yang masih UNVERIFIED

Belum ada satu pun panggilan Xendit yang pernah dijalankan dari project ini, jadi hal berikut
disusun dari dokumentasi dan **wajib dicocokkan setelah panggilan pertama**:

- **Path endpoint** `XENDIT_PAYMENT_REQUEST_PATH = '/payment_requests'`. Sebagian dokumentasi
  Xendit memakai `/v3/payment_requests`. Satu konstanta di `config.ts` — koreksinya satu baris.
- **Letak nomor VA** di respons (`payment_method.virtual_account.channel_properties
  .virtual_account_number`). `extractVirtualAccount()` mencoba beberapa kandidat.
- **Bentuk callback v3** dan nama peristiwanya (`payment.succeeded`, dll).
- **Ketersediaan channel** — sebagian VA harus diaktifkan lewat dashboard Xendit. `danamon` sengaja
  TIDAK ada di peta meski muncul di `PAYMENT_METHODS`; tambahkan bila terbukti tersedia.

Setelah callback pertama masuk, cocokkan dengan log `[xendit-webhook] masuk …` lalu perbarui
komentar `UNVERIFIED` di kode.

### Halaman uji `/test-xendit` — development only

Bukan bagian dari checkout. Dua lapis: `NODE_ENV !== 'development'` → `notFound()` (404, bukan
halaman "akses ditolak" yang justru mengonfirmasi keberadaannya), lalu `getAdminIdentity()` wajib
ada. Menampilkan 30 pesanan terakhir yang masih `Menunggu` + input invoice manual.

### Belum tersambung ke checkout

`/api/payments/create` **belum dipanggil** dari `/checkout` — halaman itu masih langsung menuju
`/checkout/success` setelah order dibuat. Menyambungkannya butuh keputusan UX: menampilkan VA di
halaman sukses, atau halaman pembayaran tersendiri. Juga: **nomor VA tidak disimpan** di `orders`
(tak ada kolomnya), jadi pembeli yang menutup halaman kehilangan nomornya — perlu kolom baru atau
pengambilan ulang dari Xendit. Lihat ROADMAP.md.

## Flowchart Sistem Ecommerce (target end-to-end)

Alur lengkap sistem sebagai acuan saat membangun fitur. Data produk/order/review sudah Supabase;
search alamat + **cek ongkir Mengantar sudah real**; bagian Xendit (pembayaran) & booking/tracking
resi masih roadmap (dijalankan dengan mock).

### Alur Browsing & Keranjang
1. User membuka web → data produk diambil via `GET /api/products/list` (Supabase; katalog & terlaris pure OMS)
2. Server menyiapkan tampilan halaman (Server Component)
3. User klik "Tambah ke Keranjang" → disimpan ke cookie (`infarm_cart`) via `cart-client.ts`
4. Angka keranjang di navbar update (+1) tanpa reload (custom event)
5. User akses `/keranjang` → render item berdasarkan ID di cookie
6. Keranjang tampilkan: progres promo aktif (`/api/promotions/active`), rekomendasi combo relevan
   (`/api/combos/active`), dan ringkasan pembayaran (subtotal − diskon promo, ongkir GRATIS bila tercapai)

### Alur Checkout & Pembayaran
7. User klik "Checkout" / "Beli Langsung" → item terpilih disimpan ke cookie `infarm_checkout`
   (keduanya WAJIB `setCheckoutItems`); snapshot promo/combo tercapai → `infarm_checkout_promo`
8. Halaman `/checkout`: form Nama, No. HP, **Email**, Alamat (search Mengantar → `destination_id`),
   lalu **cek ongkir otomatis** (pilih kurir → `selected_courier`, ongkir masuk total), Metode
   Pembayaran. Semua field & kurir divalidasi client; tombol "Bayar Sekarang" aktif hanya bila valid.
   (Email WAJIB dan menjadi kunci Lacak Pesanan — lihat "Validasi Form Checkout" & "Layanan Pesanan Guest".)
9. User isi form → klik "Bayar Sekarang" → `POST /api/orders/create` → RPC atomik `create_order_with_items`
   (insert `orders` + `order_items` + kurangi stok; rollback bila stok kurang; nomor invoice `INV-…`)
10. Backend **buat Virtual Account** → `POST /api/payments/create` → Xendit Payment Request v3 *(sudah ada, BELUM disambung ke halaman checkout)*
11. Xendit kirim balik nomor VA + batas waktu; `payment_request_id` disimpan ke `orders.id_transaksi` *(sudah ada)*
12. Nomor VA ditampilkan di halaman kita sendiri (pembeli tak keluar dari situs) *(UI belum dibuat)*
13. User melakukan pembayaran

### Alur Post-Payment (Webhook) — SUDAH TERPASANG
14. Xendit kirim notifikasi ke webhook (`/api/webhooks/xendit`)
15. Backend verifikasi `x-callback-token` (Xendit tak menandatangani body) → update `orders`; stok TIDAK disentuh saat lunas karena checkout sudah memotongnya, tapi DIKEMBALIKAN saat EXPIRED/FAILED
16. Kirim data ke API Mengantar untuk proses booking kurir
17. Mengantar kirim balik no. resi / booking ID resmi
18. Update tabel order dengan no. resi
19. **Hapus cookie keranjang** (`infarm_cart` + `infarm_checkout`)
20. Kirim email otomatis ke user berisi no. pesanan & link pelacakan
21. User kembali ke web → tampil halaman "Order Confirmed" (`/checkout/success`)
22. User bisa tracking pesanan via no. resi (`/track`), atau **membatalkan** lewat
    `/order-cancellation?id=&token=` selama status masih `Menunggu Pembayaran`/`Diproses`

### Catatan Implementasi Penting
- Langkah 3 & 7: operasi cookie via `src/lib/cart-client.ts`
- Langkah 8: cek ongkir Mengantar via `src/lib/mengantar.ts` (`fetchShippingEstimate`), UI `ShippingOptions` *(sudah real)*
- Langkah 9 & 22: data order via `src/lib/mock-db/orders.ts` (Supabase)
- Langkah 10-12: logika Xendit di `src/lib/xendit/` (`config.ts` + `payment-request.ts`), jangan di frontend *(sudah ada)*
- Langkah 14-18: `src/app/api/webhooks/xendit/route.ts` *(sudah ada)*. Langkah 19-20 (hapus cookie, email) belum
- Langkah 16-17: booking/tracking kurir Mengantar (pakai `MENGANTAR_API_KEY`) *(roadmap)*
- Langkah 19: pastikan cookie dihapus **hanya setelah** webhook dikonfirmasi sukses, bukan setelah redirect
- Langkah 20: template email ada di `src/emails/order-confirmation.html` (preview `/dev/email-preview`); pengiriman email otomatis *(roadmap)*
