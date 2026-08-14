# Alur Checkout, Order & Promo

> Dipecah dari `CLAUDE.md` (2026-08-14). Isi dipindahkan APA ADANYA, tanpa pemangkasan.
> Kembali ke ringkasan: [CLAUDE.md](../CLAUDE.md)
>
> Empat section pertama (Pembatalan Pesanan Guest, Layanan Pesanan Guest by No. Telepon,
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

## Layanan Pesanan Guest by No. Telepon (lacak / batalkan / review) — sudah terpasang

Keluarga fitur guest yang mengidentifikasi pesanan lewat **no_telepon** (bukan login). Entry lewat
**hub `/pesanan-saya`** (ikon profil header → hub; badge dot merah bila cookie `infarm_phone` ada).
Semua berbagi pola: input phone → `getOrdersByPhone` (`mock-db/orders.ts`, `.eq('no_telepon')`) →
output NON-SENSITIF; **honeypot** field `website`; **auto-recognize** cookie `infarm_phone` (Opsi A:
auto-cari tanpa ketik). **Rate-limit sudah terpasang** — lihat "Rate Limiting" di
[CLAUDE.md](../CLAUDE.md) (section itu tetap di root, tidak ikut dipecah ke sini).

### Lacak — `/track-order` (berdampingan dengan `/track` by invoice)
- `POST /api/orders/track-by-phone`: kembalikan info non-sensitif (invoice, status, resi, kurir, tanggal,
  item nama+qty+foto), nama **di-mask** (`lib/mask.ts`). Detail timeline lengkap tetap via `/track?order=INV-…`.

### Batalkan — `/cancel-order` (2 LANGKAH)
- LANGKAH 1: cari by phone (reuse `track-by-phone`) → daftar ringkas → pilih satu.
- LANGKAH 2: **ketik ULANG no_telepon** (tak di-prefill) → `POST /api/orders/verify-cancel` (query ulang
  DB: cocokkan phone↔order + cek status cancellable) → cocok & boleh → tombol "Ya, Batalkan Pesanan".
- Eksekusi: `POST /api/orders/cancel-by-phone` — **RE-verifikasi phone↔order ke DB** (tak percaya client),
  status boleh cancel (`Menunggu Pembayaran`/`Diproses`; tolak `Dikirim`/`Selesai`/`Dibatalkan`),
  `updateOrderStatus('Dibatalkan')` + `restoreStock` + revalidate/tag. (Alur token `/order-cancellation` tetap ada.)

### Review terverifikasi — `/review` (GANTI flow invoice lama)
- `/review` kini **by no_telepon** (pembeli terverifikasi lewat riwayat beli). `POST /api/reviews/reviewable-by-phone`:
  kumpulkan produk BELUM diulas dari semua pesanan phone (exclude `Dibatalkan` & yang sudah diulas via
  `getReviewedProductIds` per invoice). Pilih produk → form rating/komentar/nama (auto-fill, editable).
- `POST /api/reviews/create-by-phone`: **verifikasi server phone↔order (query ulang DB)** + produk∈order +
  not cancelled + dedup (`order_invoice`+product, unique index). Submit lama `create` (invoice) masih ada.
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

## Validasi Form Checkout (client-side)

Section Alamat Pengiriman divalidasi di client sebelum request order dikirim. Logika terpusat di
`src/lib/checkout-validation.ts` (`validateAddress`) + helper `phone.ts` & `email.ts`:

- **Nama**: min 3 karakter. **Alamat lengkap**: min 10 karakter.
- **Telepon** (`phone.ts`): hanya angka (non-digit diblok saat mengetik via onKeyDown/onChange),
  wajib diawali `08`, panjang 10–12 digit. Disimpan sebagai angka bersih `08xxxxxxxxx`.
- **Email**: field ini **sudah dihapus dari form checkout** (`src/lib/email.ts` ikut dihapus, dead code).
  `AddressFieldKey`/`AddressValidationInput` (`checkout-validation.ts`) tidak lagi punya `email`.
- **Alamat**: wajib dipilih dari search Mengantar (`destination_id` tidak boleh kosong).
- **Kurir**: wajib dipilih (`selected_courier`).
- Tombol "Bayar Sekarang": disabled-visual + **guard di handler** (bukan hanya atribut `disabled`).
  Saat ditekan tapi belum lengkap → toast + auto-scroll ke field pertama yang invalid + border merah.

## Email Konfirmasi Pesanan

> **Update**: form checkout **tidak lagi mengumpulkan email pembeli** (dihapus dari `AddressForm`;
> fokus identitas guest = no_telepon). Order baru selalu mengirim `customerEmail: undefined` ke
> `/api/orders/create`, jadi kolom `customer_email` akan **selalu NULL** untuk order baru. Fitur
> kirim email otomatis di bawah ini masih roadmap dan sekarang **tidak punya alamat tujuan** kecuali
> flow pengumpulan email dihidupkan kembali di kanal lain — tandai ini saat mengerjakan integrasi Xendit.

- Template HTML: **`src/emails/order-confirmation.html`** — table-based + inline CSS (kompatibel
  Gmail/Outlook/Mail iOS), fluid `max-width:600px; margin:0 auto`, palet brand (`#46b33c`).
- Placeholder backend: `{{logo_url}}`, `{{order_id}}`, `{{item_list}}`, `{{total_price}}`,
  `{{tracking_url}}`, `{{cancel_url}}`. **Email wajib URL absolut** (path relatif hanya untuk preview).
- Aset gambar email di **`public/images/email/`** (mis. `logo-infarm.png`; lihat README folder tsb).
- Preview lokal: **`/dev/email-preview`** (route handler membaca file template + isi placeholder
  dengan data contoh). Hanya untuk development.
- Kolom **`customer_email`** (TEXT, nullable) masih ada di tabel `orders`
  (migration `supabase/migrations/20260624120000_add_orders_customer_email.sql`) untuk data lama —
  **tidak perlu dihapus manual** (nullable, semua kode sudah memperlakukannya opsional). `saveOrder`
  punya fallback aman bila kolom belum di-migrate (cek kode error `PGRST204`/`42703`).

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
- **Nomor invoice**: `generateInvoiceNumber()` = `INV-{YYYYMMDD}-{4 digit acak}`. Unik via index
  `orders_nomor_invoice_key`; `saveOrder` retry beberapa kali bila tabrakan (unique violation).
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
8. Halaman `/checkout`: form Nama, No. HP, Alamat (search Mengantar → `destination_id`),
   lalu **cek ongkir otomatis** (pilih kurir → `selected_courier`, ongkir masuk total), Metode
   Pembayaran. Semua field & kurir divalidasi client; tombol "Bayar Sekarang" aktif hanya bila valid.
   (Field email sudah dihapus dari form — lihat "Email Konfirmasi Pesanan".)
9. User isi form → klik "Bayar Sekarang" → `POST /api/orders/create` → RPC atomik `create_order_with_items`
   (insert `orders` + `order_items` + kurangi stok; rollback bila stok kurang; nomor invoice `INV-…`)
10. Backend **buat invoice** → hubungi Xendit API untuk generate link pembayaran *(roadmap)*
11. Xendit kirim balik URL invoice *(roadmap)*
12. User di-redirect ke halaman pembayaran Xendit *(roadmap)*
13. User melakukan pembayaran

### Alur Post-Payment (Webhook) — roadmap
14. Xendit kirim notifikasi ke webhook (`/api/webhooks/xendit`)
15. Backend verifikasi signature → update tabel `orders` + update stok produk
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
- Langkah 10-12: logika Xendit di `src/lib/xendit/`, jangan di frontend *(roadmap)*
- Langkah 14-20: semua terjadi di `src/app/api/webhooks/xendit/route.ts` *(roadmap)*
- Langkah 16-17: booking/tracking kurir Mengantar (pakai `MENGANTAR_API_KEY`) *(roadmap)*
- Langkah 19: pastikan cookie dihapus **hanya setelah** webhook dikonfirmasi sukses, bukan setelah redirect
- Langkah 20: template email ada di `src/emails/order-confirmation.html` (preview `/dev/email-preview`); pengiriman email otomatis *(roadmap)*
