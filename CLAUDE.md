# Project: Ecommerce & OMS – infarm.id

## Overview
Platform ecommerce dan Order Management System (OMS) untuk infarm.id.
Terdiri dari dua aplikasi yang saling terhubung dalam satu codebase Next.js:

1. **OMS (Back Office)** — sistem input & manajemen produk, order, review oleh admin (`/oms/*`)
2. **Ecommerce (Storefront)** — tampilan publik yang menampilkan data dari OMS

**Alur data:**
Semua produk dan informasi yang tampil di ecommerce bersumber dari inputan admin melalui OMS.
Ecommerce hanya menyediakan tampilan (storefront) — tidak ada input produk dari sisi publik.

**Status saat ini (prototyping):**
Storefront dan OMS **sudah dibangun** dan saling terhubung lewat API Routes internal.
Lapisan data inti **sudah memakai Supabase** (PostgreSQL):

- **Produk, order, review** → disimpan di Supabase, diakses lewat `src/lib/mock-db/*`
  (fungsi-fungsi ini sekarang query Supabase via `createAdminClient`, bukan file lagi)
- **Data tampilan pelengkap** (detail produk, checkout, dummy katalog) → masih
  `src/lib/data/dummy-*.ts` (lihat catatan di bawah)

> **Penting:** karena data layer sudah Supabase, app **butuh `.env.local`** berisi kredensial
> Supabase untuk berjalan di lokal (lihat bagian Environment Variables). Tanpa itu muncul
> error `supabaseUrl is required.` / `Module not found: @supabase/ssr`.

Integrasi **Mengantar (logistik)** **sudah terpasang sebagian**: pencarian alamat tujuan dan
**cek ongkir otomatis** di halaman checkout sudah jalan (lihat bagian "Mengantar (Logistik)").
Tracking/booking resi masih roadmap. Integrasi **Xendit (pembayaran)** **belum diimplementasi** —
masih roadmap; bagian Xendit di bawah adalah **target arsitektur**, bukan kondisi sekarang.
Tandai jelas mana yang sudah ada vs masih rencana saat menulis kode.

> Catatan penamaan: folder `src/lib/mock-db/` namanya warisan dari fase mock file-based,
> tapi **isinya kini Supabase**. Pola isolasinya tetap: pemanggil (API Route / Server Component)
> tidak tahu sumber datanya — hanya signature fungsi yang penting.

---

## Sistem Belanja: Guest Checkout

- Tidak ada sistem login untuk pelanggan (guest checkout)
- Pelanggan bisa menambahkan produk ke keranjang **tanpa login**
- Data keranjang disimpan di **cookie browser** (bukan database, bukan localStorage)
- Tetap tersedia halaman keranjang (`/keranjang`) untuk review sebelum checkout
- Data yang dikumpulkan saat checkout: nama, alamat, nomor HP (untuk keperluan pengiriman & notifikasi).
  Field email **sudah dihapus dari form checkout** — fokus identitas guest kini murni no_telepon
  (selaras lacak/batalkan/review by phone). Kolom `customer_email` masih ada di DB (nullable) untuk
  data lama, tapi order baru selalu mengirim `customerEmail: undefined` (lihat "Email Konfirmasi Pesanan").

**Implementasi cookie keranjang (kondisi sekarang):**
- Operasi keranjang dijalankan **sisi-klien** lewat `src/lib/cart-client.ts`
  (`document.cookie`, komponen `'use client'`, reaktif via `useSyncExternalStore`)
- Tiga cookie dipakai:
  - `infarm_cart` — isi keranjang
  - `infarm_checkout` — snapshot item terpilih yang dibawa ke halaman `/checkout`
  - `infarm_checkout_promo` — snapshot promo/combo tercapai saat menuju checkout
    (tipe `CheckoutPromoSnapshot`, ditulis `setCheckoutPromo`; untuk diteruskan ke order nanti)
- Nilai cookie di-encode **base64** dari JSON (`btoa`/`atob`) agar aman dari masalah parsing
- Struktur item: `{ productId, quantity, price, comboId? }` (tipe `CartItem` di `src/types/cart.ts`).
  `comboId` terisi bila item ditambahkan sebagai bagian paket/combo dari keranjang.
- Jangan simpan data sensitif di cookie (hanya ID produk, quantity, price, comboId)
- **Rencana:** helper baca keranjang dari Server Component (`cookies()` dari `next/headers`)
  akan ditaruh di `src/lib/cart.ts` — belum dibuat.

**Cookie tambahan `infarm_phone` (auto-recognize lacak/batalkan pesanan):**
- Ditulis setelah checkout sukses (`setGuestPhone` di `src/lib/guest-phone.ts`) — HANYA no_telepon
  (`08xxx`), 30 hari, plain cookie (bukan base64). Bukan data sensitif kritis (no. HP milik user
  sendiri di device-nya); TIDAK menyimpan status/alamat/isi pesanan.
- Dibaca di `/track-order` (& nanti `/cancel-order`) untuk **auto-fill + auto-cari** (Opsi A):
  cookie ada & valid → langsung tampil pesanan tanpa ketik; kedaluwarsa/tak ada → input manual.
- **Cookie = sumber IDENTITAS saja; status pesanan SELALU di-fetch fresh dari server.**

**Catatan sinkronisasi "Beli Langsung" vs "Checkout":**
- Halaman `/checkout` membaca cookie **`infarm_checkout`** (bukan `infarm_cart`).
- Setiap aksi yang menuju checkout (tombol Checkout di keranjang **maupun** "Beli Langsung"
  di detail produk) WAJIB memanggil `setCheckoutItems(...)` dulu agar produk yang tampil benar.

---

## Tech Stack

- **Framework**: Next.js 16.2.7 (App Router) — bukan Pages Router
- **Language**: TypeScript (strict mode)
- **Frontend**: React 19.2, Tailwind CSS v4 (PostCSS, `@tailwindcss/postcss`)
- **Ikon**: `lucide-react`
- **Komponen UI headless**: `@headlessui/react` (v2) — dropdown/listbox aksesibel (mis. sort katalog),
  agar highlight opsi ikut tema hijau (bukan biru native `<select>`). Boleh dipakai untuk dropdown/menu
  baru; jangan tambah lib UI lain tanpa konfirmasi.
- **Chart (OMS dashboard)**: `recharts`
- **Database**: Supabase (PostgreSQL) — `@supabase/ssr` + `@supabase/supabase-js` **sudah terpasang**
- **Backend**: Next.js API Routes (Route Handlers di `src/app/api/`)
- **Package Manager**: npm

### Integrasi yang sudah terpasang (sebagian)
- **Logistik / Pengiriman**: Mengantar — **search alamat + cek ongkir di checkout sudah jalan**
  (client-side via `src/lib/mengantar.ts`). Tracking/booking kurir masih roadmap.
- **Analytics**: Google Analytics 4 via `@next/third-parties` — dipasang lewat
  `<GoogleAnalyticsGate>` (`src/components/analytics/`) di `src/app/layout.tsx`: render kondisional
  bila `NEXT_PUBLIC_GA_ID` terisi, dan di-gate agar TIDAK aktif di area `/oms` (tak melacak admin).
  Event GA4 (`view_item`, `add_to_cart`) via `src/lib/analytics.ts`. Strategi load = `afterInteractive`
  (default @next/third-parties) — disengaja demi akurasi analytics (tak di-defer ke `lazyOnload`).

### Roadmap integrasi (belum terpasang)
- **Auth admin real**: Supabase Auth (client sudah ada, login OMS belum terhubung)
- **Payment Gateway**: Xendit
- **Deployment**: Vercel
- **Version Control**: GitHub

### ⚠️ Breaking Changes Next.js 16 yang Perlu Diperhatikan

- **Wajib baca dulu**: `AGENTS.md` di root + dokumentasi di `node_modules/next/dist/docs/`
  sebelum menyentuh routing, caching, atau network boundary
- **Middleware dihapus** — gunakan `proxy.ts`, bukan `middleware.ts`. **Sudah ada** di
  `src/proxy.ts` (sejajar `app/`): guard area `/oms/dashboard/*` (lihat "Auth Guard OMS")
- **Cache Components (`use cache`/PPR) BELUM diaktifkan** di `next.config.ts` (config masih kosong).
  Jadi **caching yang dipakai sekarang = klasik**: `export const revalidate` (ISR) + `unstable_cache`
  + `revalidateTag`/`revalidatePath`. Lihat bagian "Caching & Revalidasi (storefront)". Bila nanti
  Cache Components diaktifkan, wrapper `unstable_cache` di `cached-reads.ts` perlu dimigrasi ke `use cache`.
- **`revalidateTag` di Next 16.2.7 WAJIB 2 argumen**: `revalidateTag(tag, 'max')` (`'max'` =
  stale-while-revalidate, rekomendasi resmi). Memanggil dengan 1 argumen = error TypeScript.
- **Turbopack aktif by default** — tidak perlu flag `--turbo`

**Jangan tambahkan library berikut tanpa diminta:**
- Redux atau state library global lain (gunakan Zustand atau React Context)
- styled-components, Emotion (gunakan Tailwind CSS)
- Axios (gunakan native `fetch`)
- Material UI, Ant Design, Chakra UI

---

## Bash Commands

```bash
npm run dev          # Jalankan dev server Next.js (Turbopack aktif by default)
npm run build        # Build production
npm run start        # Jalankan production server lokal
npm run lint         # ESLint
```

> Catatan: script `typecheck` dan `test` belum dikonfigurasi di `package.json`.
> Untuk cek tipe manual: `npx tsc --noEmit`.

---

## Project Structure

Seluruh kode aplikasi berada di bawah `src/`.

```
src/
├── app/                          # Next.js App Router
│   ├── (store)/                  # Route group: halaman publik ber-AppBar
│   │   ├── layout.tsx
│   │   ├── page.tsx              # Homepage (Hero + HeroStats count-up, ValueProp, kategori, terlaris)
│   │   ├── products/page.tsx     # Katalog produk (ProductCatalog: sidebar filter desktop + sheet mobile)
│   │   └── produk/[id]/page.tsx  # Detail produk
│   ├── keranjang/page.tsx        # Halaman keranjang (data dari cookie)
│   ├── checkout/
│   │   ├── page.tsx              # Guest checkout
│   │   └── success/page.tsx      # Order Confirmed (+ tombol batalkan pesanan)
│   ├── order-cancellation/page.tsx  # Pembatalan pesanan Guest (token-protected, dari link email/sukses)
│   ├── review/page.tsx           # Beri Review by NO. TELEPON (pembeli terverifikasi; ganti flow invoice lama)
│   │                             #   (ReviewForm.tsx/ReviewProductCard.tsx = flow invoice lama, kini dead code)
│   ├── track/page.tsx            # Lacak pesanan by NOMOR INVOICE (dipakai untuk detail timeline ?order=)
│   ├── track-order/page.tsx      # Lacak pesanan by NO. TELEPON (entry utama; honeypot + auto-recognize cookie)
│   ├── cancel-order/page.tsx     # Batalkan pesanan by NO. TELEPON — 2 langkah (verifikasi ulang phone ke DB)
│   ├── pesanan-saya/page.tsx     # Hub "Pesanan Saya": kartu lacak / batalkan / review (ikon profil header → sini)
│   ├── privacy-policy/page.tsx   # Kebijakan Privasi (statis, LegalPageShell) — NONAKTIF (404),
│   │                             #   kode utuh; tuas LEGAL_PAGES_ENABLED di lib/data/legal.ts
│   ├── terms-and-conditions/page.tsx  # Syarat & Ketentuan (idem — NONAKTIF, kode utuh)
│   ├── dev/email-preview/        # Preview template email (route handler, isi placeholder data contoh)
│   ├── oms/                      # OMS / back office
│   │   ├── login/page.tsx
│   │   └── dashboard/            # dashboard, products (+upload), orders, reviews, pengaturan,
│   │       │                     #   gudang (Daftar Gudang + /stok Kelola Stok + /riwayat Riwayat
│   │       │                     #   Mutasi), paket-combo (+baru, [id]/edit),
│   │       │                     #   promosi (+baru, [id]/edit)
│   ├── api/                      # Route Handlers (runtime nodejs)
│   │   ├── products/             # create | update | delete | bulk (aksi massal OMS) | list |
│   │   │                         #   check-sku | best-selling |
│   │   │                         #   sales-count | best-selling-catalog | search (autocomplete) | by-ids (resolve keranjang)
│   │   ├── orders/               # create | list (filter tanggal/kurir/pembayaran/status/gudang +
│   │   │                         #   sort + opsi dropdown; sumber tabel & CSV OMS) | get | cancel (GET+PATCH token) |
│   │   │                         #   track-by-phone | verify-cancel | cancel-by-phone (batalkan by no_telepon)
│   │   ├── reviews/              # create (invoice) | list | reply | visibility | reviewed |
│   │   │                         #   reviewable-by-phone | create-by-phone (review terverifikasi via no_telepon)
│   │   ├── combos/              # create | update | delete | toggle | list | active (storefront)
│   │   ├── promotions/          # create | update | delete | toggle | list | active (storefront)
│   │   ├── warehouses/         # list | create | update | set-default | toggle | delete | stock |
│   │   │                        #   stock/matrix (matrix produk×gudang) | stock/set (tulis 1 sel)
│   │   │                        #   (SEMUA admin-only — memuat origin id & koordinat gudang)
│   │   ├── stock-mutations/    # list (riwayat mutasi stok, admin-only)
│   │   └── mengantar/              # address/search (CORS-blocked → proxied) |
│   │                               #   shipping/estimate (1 gudang) | shipping/options (POST,
│   │                               #   perbandingan ongkir semua gudang → titik rate limit)
│   ├── layout.tsx                # Root layout (Montserrat + Geist Sans/Mono, metadata)
│   └── globals.css               # Tailwind v4 + @config tailwind.config.ts + token font & base h1–h4
├── components/
│   ├── home/                     # Homepage: HeroSection (dual-image bg + CTA), HeroStats (3 indicator
│   │                             #   box + count-up native), ValuePropositionBanner (grid desktop/carousel
│   │                             #   mobile), CategoryGrid (foto latar per kategori), BestSellingProducts.
│   │                             #   (HeroSearchBar DIHAPUS — search kini di header)
│   ├── product/                  # ProductCard (harga hijau + coret inline + rating|terjual),
│   │                             #   ProductCatalog (filter lengkap: sidebar/sheet, multi-kategori, harga,
│   │                             #   sort Listbox HeadlessUI), ProductImageSlider, ProductInfo,
│   │                             #   ProductDescription (client, lipat 5 baris + "Lihat Selengkapnya"),
│   │                             #   StickyBuyBar (mengambang < lg, statis di lg+ bawah deskripsi),
│   │                             #   TrackProductView. (CategoryFilterTabs DIHAPUS)
│   ├── cart/                     # Keranjang: CartHeader (teks putih), CartItemRow & CartCheckoutBar
│   │                             #   (checkbox custom: box putih border, centang putih di box hijau),
│   │                             #   CartPromoList, CartRecentlyViewed ("Dilihat Sebelumnya"), dll
│   ├── checkout/                 # AddressForm, AddressSearchCombobox, ShippingOptions (bottom sheet
│   │                             #   cek ongkir), PaymentModal, BottomSheet, OrderSummary, dll
│   ├── order-cancellation/       # OrderCancellationView (client)
│   ├── review/                   # Komponen review
│   ├── track/                    # Komponen pelacakan
│   ├── oms/                      # Sidebar (mendukung sub-menu), header, ComboForm,
│   │                             #   PromotionForm, GudangTabs (sub-nav area Gudang),
│   │                             #   WarehouseStockFields (input stok awal — HANYA form Tambah Produk),
│   │                             #   RevenueChart (stacked bar pendapatan + tampilan tabel),
│   │                             #   DashboardPeriodFilter (toggle periode dashboard)
│   │                             #   (SalesChart DIHAPUS — datanya dummy)
│   └── ui/                       # UI generik: AppBar (menu+logo+HeaderSearch tengah+cart/profil),
│                                 #   MenuDrawer (drawer kiri: nav+kategori), ProfileIconLink
│                                 #   (ikon akun → dropdown layanan pesanan desktop / hub mobile), HeaderSearch
│                                 #   (search persisten: inline desktop, overlay mobile), FloatingWhatsApp
├── lib/
│   ├── cart-client.ts            # Helper keranjang sisi-klien (cookie base64) + addComboToCart + removeComboFromCart + snapshot promo + clearCart
│   ├── guest-phone.ts            # Cookie client no_telepon (infarm_phone) untuk auto-recognize lacak/batalkan
│   ├── recently-viewed.ts        # Riwayat "pernah dilihat" (guest, localStorage, maks 10)
│   ├── promo-cart.ts             # Helper murni: progres/hadiah promo + relevansi & alokasi harga combo (keranjang)
│   ├── product-validation.ts     # Validasi form produk (SKU, nama, kategori, harga jual/asli, stok, deskripsi, foto)
│   ├── warehouse.ts              # SATU pintu pergudangan: mode (DB), resolve gudang (fallback),
│   │                             #   stok efektif, origin id (server-only; TANPA jarak/Haversine)
│   ├── warehouse-shipping.ts     # Perbandingan ongkir riil antar gudang (paralel + cache 10 mnt)
│   ├── mengantar-estimate.ts     # Pemetaan respons estimasi Mengantar (dipakai client & server)
│   ├── stock-audit.ts            # SATU pintu pencatatan riwayat stok → stock_mutations (server-only)
│   ├── warehouse-validation.ts   # Validasi form gudang (nama, origin id 24 hex, lat/long berpasangan)
│   ├── dashboard-period.ts       # Periode & granularity Dashboard OMS (murni, zona WIB)
│   ├── dashboard-revenue.ts      # Klasifikasi & agregasi pendapatan per status (murni) + palet
│   ├── format.ts                 # Util format: formatRupiah + formatSold (mis. 523 → "500+")
│   ├── phone.ts                  # Validasi & normalisasi no. telepon ID (checkout)
│   ├── checkout-validation.ts    # Validasi field alamat (nama/telepon/alamat) → status tombol "Bayar Sekarang"
│   ├── combo-validation.ts       # Validasi server payload combo
│   ├── promotion-validation.ts   # Validasi server payload promo
│   ├── mengantar.ts              # Client: search alamat (via proxy) + cek ongkir (fetch langsung)
│   ├── order-token.ts            # Token HMAC tautan pembatalan (server-only)
│   ├── supabase/                 # Client Supabase: server.ts (admin/SSR) + browser.ts
│   ├── mock-db/                  # Akses data Supabase: products, orders, reviews, combos, promotions,
│   │                             #   admins, variants, settings (store_settings key-value),
│   │                             #   warehouses (gudang + stok per gudang),
│   │                             #   stock-mutations (riwayat stok) — server only
│   │                             #   + cached-reads.ts (wrapper unstable_cache storefront: revalidate 30s + tags)
│   └── data/                     # Dummy data tampilan pelengkap (dummy-*.ts)
├── emails/                       # Template HTML email (order-confirmation.html) — placeholder {{...}}
├── hooks/                        # use-debounce.ts, use-media-query.ts (breakpoint reaktif),
│                                 #   use-sticky-bar-height.ts (tinggi bilah bawah → CSS var --sticky-bar-h)
└── types/                        # product.ts (+ CatalogCardProduct: rating/soldCount opsional), cart, order, combo,
                                  #   promotion, warehouse (Warehouse, WarehouseStock, WarehouseMode),
                                  #   stock-mutation (StockMutation + label alasan)

# Root: next.config.ts, tailwind.config.ts, eslint.config.mjs, postcss.config.mjs,
#       tsconfig.json, AGENTS.md, CLAUDE.md, .env.local (tidak di-commit)
# scripts/migrate-data.mjs: salin DATA (bukan skema) antar project Supabase (SOURCE .env.local →
#   TARGET .env.migration.local); urut FK, preserve id, idempotent. Jalankan: node scripts/migrate-data.mjs [--run]
# public/images/email/: aset gambar email (mis. logo-infarm.png) — lihat README di folder tsb
# public/images/categories/<slug>.(webp|jpg): foto latar tombol kategori beranda (CategoryGrid resolve fs)
# public/images/icons/{cart,user}.png: ikon UI header (512px, PUTIH, transparan — latar header hijau)
# public/images/value-props/<slug>.png: ikon 4 keunggulan beranda (512px, BERWARNA, transparan —
#   lingkaran latar #E8F5E0 terang; nama file = slug judul, lihat ValuePropositionBanner)
# public/images/hero-background(.jpg) + hero-background-mobile.(jpg|webp|png): bg hero art-direction
#   (desktop landscape 16:9 / mobile portrait 9:16; HeroSection resolve fs, fallback ke desktop)
# supabase/: migrations/ (SQL, sumber kebenaran skema) + README.md (cara apply via Dashboard)
```

> Folder berikut **belum ada** dan baru dibuat saat integrasi terkait dikerjakan:
> `src/lib/xendit/`, `src/app/api/webhooks/`, `src/lib/cart.ts`, `src/lib/fetcher.ts`.
> (`src/proxy.ts` **sudah ada** — guard auth OMS.)
> Catatan: logika Mengantar memakai **file** `src/lib/mengantar.ts` (bukan folder `src/lib/mengantar/`).

---

## Code Style

- Gunakan **ES modules** (`import/export`), bukan CommonJS (`require`)
- Import dengan alias `@/...` (root = `src/`), mis. `import { addToCart } from '@/lib/cart-client'`
- **TypeScript strict mode** — hindari `any`, gunakan type eksplisit
- Nama file: `kebab-case.ts`, komponen: `PascalCase.tsx`
- Fungsi & variabel: `camelCase`; konstanta global: `UPPER_SNAKE_CASE`
- Indentasi: 2 spasi
- Gunakan **Server Components** by default; tambahkan `'use client'` hanya jika benar-benar perlu
  (interaksi browser, state, event, cookie sisi-klien)

---

## Komentar Kode

Tulis komentar untuk memudahkan maintenance. Ikuti aturan berikut:

- **Setiap file** — komentar singkat di baris pertama menjelaskan tujuan file
  ```ts
  // src/lib/cart-client.ts
  // Helper sisi-klien untuk membaca/menulis cookie keranjang dari browser
  ```

- **Setiap fungsi/komponen yang di-export** — jelaskan apa yang dilakukan, bukan bagaimana
  ```ts
  // Menambahkan item ke keranjang dan menyimpannya kembali ke cookie
  export function addToCart(item: CartItem): CartItem[] {}
  ```

- **Logic yang tidak langsung jelas** — beri komentar kenapa, bukan apa
  ```ts
  // Cookie di-encode base64 karena nilai JSON mentah bisa bikin error parsing di sebagian browser
  document.cookie = `${name}=${btoa(binary)}; path=/; SameSite=Lax`
  ```

- **Setiap section dalam file panjang** — gunakan komentar pemisah
  ```ts
  // === Baca Cookie ===
  // === Tulis Cookie ===
  // === Kalkulasi Total ===
  ```

- **Jangan** tulis komentar redundan yang mengulang nama fungsi

---

## Data & State

### Produk, Order, Review (Supabase)
- Semua akses data lewat fungsi di `src/lib/mock-db/{products,orders,reviews}.ts`
  — **server only** karena memakai `createAdminClient()` (service_role, menembus RLS)
- UI mengakses lewat API Routes, mis. `GET /api/products/list`,
  `GET /api/orders/get`, `PATCH /api/orders/cancel`, `POST /api/reviews/create`
- Skema tabel = migration di `supabase/migrations/` (snake_case di DB ↔ camelCase di app,
  dipetakan oleh fungsi `rowTo*` di tiap file mock-db)
- **Jangan** memanggil `createAdminClient()` dari komponen `'use client'` — server only

### Dummy data tampilan (dipakai terbatas)
- **Katalog `/products` kini PURE produk OMS** (Supabase) — dummy TIDAK lagi digabung di katalog
  maupun section "Produk Terlaris" homepage.
- `src/lib/data/dummy-*.ts` masih dipakai sebagai: **fallback** detail produk
  (`dummy-product-details`, bila id bukan produk OMS), fallback ringkasan checkout, dan sebagai
  peta pelengkap saat me-resolve item cookie di keranjang/checkout (produk OMS didahulukan;
  yang diarsipkan dibuang).

### Keranjang (cookie-based)
- Semua operasi keranjang via helper di `src/lib/cart-client.ts`
- Cookie: `infarm_cart` (isi keranjang) dan `infarm_checkout` (snapshot ke checkout)
- Struktur: `CartItem[] = { productId: string, quantity: number, price: number }[]`
- Nilai cookie di-encode base64; UI lain disinkronkan lewat custom event
  (`infarm:cart-updated`, dll.)
- Jangan simpan data user atau data sensitif di cookie keranjang

---

## Caching & Revalidasi (storefront) — sudah terpasang

Cache Components (`use cache`/PPR) **belum aktif** → pakai caching klasik Next 16 (`revalidate` + `unstable_cache` + `revalidateTag`). Tujuan: halaman publik cepat (edge cache) tanpa mengorbankan kesegaran data OMS/admin.

- **ISR halaman**: `export const revalidate` di `(store)/page.tsx` (beranda), `(store)/products/page.tsx`
  (katalog), `(store)/produk/[id]/page.tsx` (detail, 30s + `generateStaticParams` return `[]` +
  `dynamicParams` agar route dinamis tetap bisa ISR). Beranda: halaman pertama "Katalog Terlaris"
  di-**render server** (bukan client-fetch) → kembali ke beranda tak flash/refetch.
- **`unstable_cache` (server-only)** di `src/lib/mock-db/cached-reads.ts` — membungkus baca Supabase
  KHUSUS storefront (revalidate 30s + tags `products`/`reviews`/`combos`/`sales`). Tanpa ini, query
  supabase-js = `fetch` no-store → memaksa halaman jadi dynamic (revalidate diabaikan).
  Fungsi: `getCachedProducts`, `getCachedProductById`, `getCachedReviewsByProduct`,
  `getCachedRatingSummary`, `getCachedRatingSummaryByProduct` (agregasi rating batch — avg+count per
  product, tag `reviews`; dipakai kartu "Produk Pilihan"), `getCachedCombos`, `getCachedSalesCountByProduct`,
  `getBestSellingCatalogPage` (kini payload sertakan `soldCount`+`rating`+`reviewCount` per kartu).
- **PENTING — jangan blanket-cache fungsi dasar `mock-db/*`**: API OMS & `orders/create` WAJIB baca
  data FRESH (validasi stok/harga otoritatif). Storefront pakai wrapper cached; OMS/order pakai fungsi dasar.
- **Invalidasi saat mutasi**: tiap API tulis memanggil `revalidateTag(tag, 'max')` + `revalidatePath`:
  produk create/update/delete → `products`; order create/cancel → `products`+`sales` (stok/terjual);
  review create/reply/visibility → `reviews`; combo create/update/delete/toggle → `combos`.
  **Kalau nambah titik mutasi baru, WAJIB tambah `revalidateTag` yang sesuai** (kalau bolong → data basi).
- **Resolusi produk hemat**: keranjang pakai `GET /api/products/by-ids?ids=` (cached), autocomplete
  hero pakai `GET /api/products/search?q=` (cached, maks 8) — BUKAN lagi tarik seluruh katalog via
  `/api/products/list`. `/api/products/list` (full, tanpa cache) tetap dipakai OMS & sebagian storefront
  lama (checkout/ProductCatalog/ReviewForm) — kandidat migrasi ke by-ids/paginasi saat katalog membesar.
- **Storage**: upload gambar baru pakai `cacheControl: '3600'` (`mock-db/products.ts`); efek hanya untuk upload baru.
- **Catatan**: `revalidate`/`revalidateTag`/`x-vercel-cache` hanya efektif di **production Vercel**
  (bukan `next dev`). API route handler selalu `x-vercel-cache: MISS` (tak di-CDN-cache) walau data
  internalnya cached — itu normal. Baseline & hasil uji: `docs/cache-test-*.md`.

---

## Supabase (sudah terpasang)

- **Client**: server `src/lib/supabase/server.ts` (`createClient` anon/SSR + `createAdminClient`
  service_role); browser `src/lib/supabase/browser.ts`
- **Row Level Security (RLS) wajib aktif** di semua tabel. Tabel `orders` (berisi data pribadi)
  dikunci dari publik → semua baca/tulis lewat server (`createAdminClient`)
- **Skema** dikelola lewat **migration file** di `supabase/migrations/` (sumber kebenaran).
  CLI belum dipasang di mesin ini → migration dijalankan **manual via Dashboard → SQL Editor**
  (lihat `supabase/README.md`), berurutan sesuai timestamp
- Regenerate types (saat CLI tersedia): `supabase gen types typescript --local > src/types/supabase.ts`

## Auth Guard OMS (cookie sesi bertanda tangan + tabel admin_users)

Akses `/oms/dashboard/*` dilindungi guard di **`src/proxy.ts`** (Next.js 16 Proxy, pengganti
middleware). Login diverifikasi ke **tabel Supabase `admin_users`** (bukan lagi dummy hardcode);
sesi disimpan sebagai **cookie httpOnly bertanda tangan HMAC** (bukan lagi penanda `"1"` forgeable).

- **Tabel `admin_users`**: `username` (unik), `password_hash` (scrypt, format `saltHex:hashHex`),
  `name`, `is_active`, **`role`**. RLS aktif tanpa policy publik → akses hanya server (service_role).
  Migration `supabase/migrations/20260708120000_init_admin_users.sql` (+ seed admin awal) &
  `20260814120000_add_admin_users_role.sql`.
- **Verifikasi password**: `src/lib/mock-db/admins.ts` (server-only, `node:crypto` scrypt +
  `timingSafeEqual`). `authenticateAdmin(username, password)` & `getAdminById(id)` — keduanya
  mengembalikan `AdminIdentity { id, name, role }`. `admin_users` **tak punya kolom email**; nama
  tampilan = `name`, fallback `username`.
- **Peran (`role`)** — hanya DUA nilai, dijaga CHECK constraint (menambah nilai baru = ubah
  constraint juga):
  | Peran | Wewenang |
  |---|---|
  | `admin` | akses penuh, termasuk **menulis stok gudang** |
  | `staff` | boleh melihat stok & halaman OMS; **tak boleh menulis stok** |
  - `DEFAULT 'admin'` disengaja supaya akun yang sudah ada tak kehilangan akses saat migration jalan.
  - Kolom belum di-migrate (`42703`) → dianggap `'admin'`. Menambahkan sistem peran tak boleh
    mengunci admin dari pekerjaannya.
  - **Peran SELALU dibaca ulang dari DB** (`getAdminIdentity()` di `oms-guard.ts`), tidak disimpan di
    cookie sesi — menurunkan peran seseorang langsung berlaku tanpa menunggu sesinya kedaluwarsa.
  - Guard tulis stok: **`requireStockEditor()`** → `401` bila tak login, **`403`** bila peran salah
    (ia sudah login; yang kurang wewenang). Dipakai `POST /api/warehouses/stock/set`.
    `canEdit` yang dikirim endpoint matrix HANYA untuk menyembunyikan tombol — UI bukan penjagaan.
- **Token sesi**: `src/lib/oms-auth.ts` — `createSessionToken`/`verifySessionToken`
  (HMAC-SHA256 via Web Crypto, jalan di edge & node), `sanitizeOmsRedirect`,
  `OMS_SESSION_COOKIE`. Secret dari env `OMS_SESSION_SECRET` (fallback dev).
- **Login**: `POST /api/oms/login` (runtime nodejs) — verifikasi kredensial + **rate limit**
  in-memory (5 percobaan/menit per IP+username) → set cookie sesi `httpOnly`, `secure` (prod),
  `SameSite=Lax`, `maxAge` (12 jam; 30 hari bila "Ingat Saya").
- **Guard** (`proxy.ts`, `matcher: '/oms/dashboard/:path*'`): `verifySessionToken` cookie →
  invalid/kedaluwarsa → `307` ke `/oms/login?redirect=<tujuan asli>`. `/oms/login` tak diproteksi.
- **Logout**: tombol "Keluar" di `Sidebar` → `POST /api/oms/logout` (hapus cookie httpOnly) +
  `router.replace('/oms/login')`.
- **Catatan**: proxy hanya menjaga **halaman** dashboard. Route handler mutasi OMS
  (`/api/products|combos|promotions|reviews/...`, `/api/orders/list`) **belum** dijaga per-endpoint
  (lihat temuan K-1 di `docs/security-audit-2026-07-08.md`) — roadmap berikutnya.
- **Roadmap**: pertimbangkan Supabase Auth penuh bila butuh peran lebih banyak/reset password.
  Belum ada UI kelola akun admin — membuat akun `staff` masih lewat SQL (`insert into admin_users`
  dengan `role = 'staff'` + `password_hash` dari `hashPassword()`).

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
auto-cari tanpa ketik). **Rate-limit sudah terpasang** — lihat bagian "Rate Limiting" di bawah.

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

## Rate Limiting (anti bot / brute-force / scraping) — sudah terpasang

Semua ambang batas terkumpul di **`src/lib/rate-limit.ts`** (konstanta `RATE_LIMITS`) — ubah angka
di situ, jangan hardcode di route. Implementasi: **in-memory `Map` per-instance** (pola sama dengan
`/api/oms/login`), best-effort. **Belum terpusat lintas-instance Vercel** — kandidat migrasi ke tabel
Supabase atau Redis bila traffic/serangan naik. Helper: `enforceRateLimit(key, rule)` → `NextResponse`
429 siap-kirim atau `null`; `isOverLimit`/`recordAttempt` untuk pencatatan tertunda; `getClientIp`.
Respons limit = **HTTP 429** + pesan generik `RATE_LIMIT_MESSAGE` (tanpa membocorkan angka limit) +
header `Retry-After`. Map disapu berkala tiap 500 penulisan agar tak bocor memori.

| Aturan | Batas | Dipakai di |
|---|---|---|
| `PHONE_LOOKUP_IP` | 20 / 15 mnt / IP | `track-by-phone`, `verify-cancel`, `reviewable-by-phone` |
| `PHONE_LOOKUP_PHONE` | 15 / jam / nomor | idem (cegah serangan 1 nomor dari banyak IP) |
| `PHONE_LOOKUP_IP_PHONE_MISS` | 5 / 15 mnt / (IP+nomor) | idem — **hanya percobaan GAGAL** yang dihitung |
| `PHONE_WRITE_IP` | 8 / 15 mnt / IP | `cancel-by-phone` |
| `PHONE_WRITE_PHONE` | 5 / jam / nomor | `cancel-by-phone`, `create-by-phone` |
| `MENGANTAR_IP` | 20 / menit / IP | proxy search alamat & cek ongkir |
| `ORDER_CREATE_IP` | 3 / menit / IP | `POST /api/orders/create` |
| `REVIEW_CREATE_IP` | 3 / 10 mnt / IP | `reviews/create` **dan** `reviews/create-by-phone` (bucket sama) |

- **Kenapa "hanya percobaan gagal" untuk kunci IP+nomor**: penebak nomor orang lain hampir selalu
  meleset (0 pesanan / nomor tak cocok), sedangkan pemilik nomor selalu dapat hasil. Menghitung
  yang gagal saja = brute-force tetap terhenti di 5 tebakan, tapi user normal yang reload halaman
  atau mengulang pencarian nomornya sendiri **tidak pernah** kena limit.
- **Catatan UX**: `REVIEW_CREATE_IP` 3/10 menit berarti pembeli yang mengulas >3 produk sekaligus
  akan tertahan. Naikkan konstanta itu bila keluhan muncul.
- Menutup temuan K-1 di `docs/security/audit-2026-07-24.md`.

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
  + dropdown filter "Semua gudang / <gudang aktif> / Belum ditentukan", bisa dikombinasikan dengan
  filter lain. Detailnya:
  - Nama gudang di-resolve di data layer (`resolveWarehouseNames` di `mock-db/orders.ts`) dan
    dilampirkan sebagai `Order.warehouseName` — hanya untuk OMS, TIDAK pernah dikirim ke storefront
    (`getOrdersByPhone` sengaja tak memakainya).
  - Peta nama dibangun dari **semua** gudang termasuk yang **nonaktif**: pesanan lama bisa dipenuhi
    gudang yang kini dinonaktifkan, dan riwayatnya harus tetap terbaca. Sebaliknya **dropdown filter
    hanya menawarkan gudang aktif** (gudang nonaktif tak lagi menerima pesanan baru).
  - **Pesanan lama** (`orders.warehouse_id` NULL — 43 dari 44 baris per 2026-08-12) tampil sebagai
    "Belum ditentukan", dan bisa dicari lewat opsi filter `gudang=none` → `.is('warehouse_id', null)`
    (`WAREHOUSE_FILTER_NONE`). **Pakai `.is()`, bukan `.eq()`** — NULL tak pernah cocok dengan
    perbandingan biasa di SQL, jadi `.eq()` akan mengembalikan nol baris tanpa error.
  - Nilai `gudang` divalidasi di route (`UUID_REGEX` atau `'none'`); nilai lain **diabaikan**, bukan
    error, supaya bookmark/URL lama tetap menampilkan data.
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
- **Stok Rendah** — produk aktif ber-stok efektif `< LOW_STOCK_THRESHOLD`, terkecil dulu, maks 5.
  Bar diukur relatif terhadap ambang itu, bukan kapasitas maksimum (produk tak punya kolom
  kapasitas; mengarang pembagi membuat bar berbohong). Tautan → Kelola Stok Gudang.
- **`LOW_STOCK_THRESHOLD` (10) kini di `src/lib/product-validation.ts`** dan di-import halaman
  Produk maupun Dashboard — satu sumber supaya jumlah peringatan di kedua halaman selalu cocok.
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
  - Ambang "Stok Menipis" = `LOW_STOCK_THRESHOLD` (10), satu angka dengan kartu ringkasan di atas tabel.
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

## Riwayat "Dilihat Sebelumnya" (Recently Viewed)

- **localStorage** (guest, sisi-klien) key `recently_viewed_products` — `src/lib/recently-viewed.ts`
  (`trackProductView`, `getRecentlyViewedIds`). Array `{ product_id, viewed_at }`, terbaru di depan,
  maks 10, anti-duplikat, semua akses `try/catch` (aman saat disabled/penuh).
- Dicatat saat buka detail produk via `TrackProductView` (komponen null, `'use client'`).
- Ditampilkan di **keranjang** (`CartRecentlyViewed`): resolve id → data produk **terbaru** (OMS+dummy),
  buang produk diarsipkan atau yang sudah ada di keranjang, maks 6; section disembunyikan bila kosong.

## Header & Search Persisten (storefront)

- Header storefront = **`AppBar`** (Server Component, dirender di `(store)/layout.tsx`, fixed, `bg-brand-header`
  hijau `#00843b` + teks/ikon putih, `rounded-b-[2rem]`, `backdrop-blur`). Layout: `[hamburger+logo] — [HeaderSearch] — [cart+profil]`.
- **Halaman mana yang memakai `AppBar`**: HANYA route group `(store)` — beranda, `/products`,
  `/produk/[id]`. Halaman di luar group punya header sendiri: `/keranjang` → `CartHeader`,
  `/checkout` → `CheckoutHeader`, `/pesanan-saya` & layanan pesanan → header masing-masing,
  halaman legal → `LegalPageShell`. Jadi "menyembunyikan elemen header" di halaman-halaman itu
  tidak perlu conditional apa pun — elemennya memang tak pernah dirender.
- **`CheckoutHeader`** sengaja minimal demi fokus pembayaran: tombol kembali + **logo NON-tautan**
  + judul. Tanpa search/keranjang/akun, dan `FloatingWhatsApp` self-gate di `/checkout`.
  **Jangan menambah navigasi keluar baru di header ini**; logo tidak dibungkus `<Link>` agar user
  tak tercampak dari alur pembayaran karena menyenggolnya.
- **Pembagian tugas navigasi header (jangan dicampur lagi)**: `MenuDrawer` = **navigasi katalog**
  (beranda/produk/keranjang + kategori); `ProfileIconLink` = **layanan pesanan** (hub/lacak/
  batalkan/review). Section "Pesanan" DIHAPUS dari drawer agar tak tumpang tindih dengan ikon akun.
- **`MenuDrawer`** (`components/ui/`, client) = tombol hamburger + panel geser dari kiri. Dua section:
  Navigasi (Beranda / Semua Produk / Keranjang) dan Kategori Produk (dari `PRODUCT_CATEGORIES` —
  satu sumber dengan `CategoryGrid` & filter katalog).
  Tutup lewat backdrop, tombol ×, `Escape`, atau klik tautan (`onClick` di `<nav>`, BUKAN efek
  `pathname` — lint `react-hooks/set-state-in-effect` melarangnya). Scroll body dikunci saat terbuka;
  panel `inert` saat tertutup.
  **WAJIB portal ke `document.body`** (`createPortal`): `AppBar` memakai `backdrop-blur-md`, dan
  elemen ber-`backdrop-filter` jadi containing block untuk anak `position: fixed` → tanpa portal
  `inset-y-0` mengacu ke tinggi AppBar (56px), drawer terpotong & backdrop cuma menutupi header.
  Deteksi klien pakai `useSyncExternalStore` (bukan setState di `useEffect`, dilarang lint).
  Konsekuensi: isi drawer tidak ada di HTML awal — tak masalah, tautan kategori/nav juga tersedia
  di `CategoryGrid` beranda & footer. **Tanpa penanda aktif untuk kategori**: membacanya butuh
  `useSearchParams` yang memaksa halaman jadi dinamis, sementara beranda & katalog sengaja ISR.
- **`CartIconLink` + `MiniCart`** (`components/ui/`, client) = ikon keranjang + badge jumlah item.
  **Mobile (<640px)**: `<Link>` ke `/keranjang` (tak berubah). **Desktop (≥640px)**: tombol yang
  membuka **mini cart** `absolute right-0 top-full w-80` — daftar item (thumbnail/nama/qty/harga,
  `max-h-72 overflow-y-auto`), subtotal, tombol "Lihat Keranjang" & "Checkout"; kosong → ajakan
  "Mulai Belanja". Tutup via klik-luar (`pointerdown`), `Escape`, atau klik aksi.
  - Pemilihan varian pakai **`useMediaQuery`** (`src/hooks/use-media-query.ts`, `useSyncExternalStore`),
    BUKAN kelas `sm:hidden` — `id="cart-anchor"` harus unik & punya ukuran nyata karena dipakai
    animasi fly-to-cart (`StickyBuyBar`); elemen `display:none` memberi rect 0×0 → animasi ngawur.
  - Detail produk di-resolve `GET /api/products/by-ids` **hanya saat panel dibuka**; foto pakai
    `Image ... unoptimized` (URL Supabase Storage belum di `remotePatterns`), pola sama `CartItemRow`.
  - Tombol Checkout WAJIB `setCheckoutItems(cart)` sebelum `router.push('/checkout')`.
- **`ProfileIconLink`** (`components/ui/`, client) = ikon akun + badge angka pesanan aktif (cookie
  `infarm_active_orders`, tanpa query DB). Klik/tap ikon → dropdown `absolute right-0 top-full`
  berisi **3 aksi**: Lacak / Batalkan / Beri Review (+ baris kepala "N pesanan aktif"); tutup via
  klik-luar (`pointerdown`), `Escape`, atau klik item. **Satu perilaku untuk semua ukuran layar**
  (mobile TIDAK lagi navigate ke `/pesanan-saya`) supaya pembeli tak kehilangan konteks halaman
  yang sedang dibuka. Item "Pesanan Saya" sengaja dihapus dari dropdown — hub `/pesanan-saya`
  kini TIDAK ditautkan dari header, hanya dari tombol "kembali" di `/track-order`, `/cancel-order`,
  `/review`. Baris menu `py-3 sm:py-2.5` agar
  target sentuh mobile nyaman. Dropdown pakai `absolute`, BUKAN `fixed`, jadi tak kena masalah
  containing block `backdrop-filter` seperti `MenuDrawer`.
  **Tanpa Profil/Logout/Alamat Tersimpan/Pengaturan** — proyek ini guest checkout, tak ada akun
  pelanggan; jangan tambahkan item itu tanpa membangun sistem auth pelanggan dulu.
- **`HeaderSearch`** (`components/ui/`, client) = search autocomplete PERSISTEN (dulu `HeroSearchBar` di hero, sudah dihapus):
  - Desktop (sm+): input inline (`bg-white/15`, pill, ikon search kanan sebagai trigger), lebar `max-w-[320px]` rata kanan.
  - Mobile: ikon kaca pembesar → **overlay full-width** (`fixed inset-0`) menutupi header (tombol ←, input, dropdown).
  - Saran on-type via `GET /api/products/search` (debounce). Logika autocomplete sama dgn versi hero lama.

## Halaman Katalog `/products` — Filter Lengkap

- **`ProductCatalog`** (client) merakit filter + grid; `products/page.tsx` hanya membungkus dengan `<Suspense>`
  (butuh `useSearchParams`). Data = produk OMS non-arsip via `/api/products/list`.
- **Desktop (lg+)**: sidebar kiri sticky (kategori **multi-checkbox** custom [box putih border → hijau+centang putih],
  rentang harga Min–Maks, tombol **Terapkan**) + konten kanan (judul, jumlah, sort). **Mobile**: baris kontrol
  (Filter, Urutkan, chip kategori aktif ×) → **bottom-sheet** (reuse `checkout/BottomSheet`) untuk filter & sort.
- **Sort** = Headless UI `Listbox` (Terbaru/Harga Terendah/Tertinggi), highlight opsi tema hijau. Filter kategori & harga
  **staged** (berlaku saat Terapkan); sort instan. Chip × hapus kategori langsung.
- **Sinkron URL** `?category=a,b` via **`window.history.replaceState`** (BUKAN `router.replace`) — hindari navigasi/
  Suspense fallback yang bikin bottom-sheet nyangkut. Deep-link dari `CategoryGrid` beranda (slug tunggal) tetap jalan.
  - **WAJIB `replaceState(window.history.state, '', href)`** — meneruskan state yang ada. Next menyimpan state
    router di `history.state`; menimpanya dengan `null` merusak navigasi soft berikutnya.
  - **Filter WAJIB ikut berubah saat `?category=` berganti tanpa remount** (mis. klik kategori di `MenuDrawer`
    sementara user sudah di `/products`). `useState` hanya membaca URL sekali → ada penyesuaian state
    **saat render** (pola resmi React) dengan pembanding `syncedCategoryParam`, yang juga diperbarui di
    `syncUrl` agar klik kategori sama setelah filter diubah manual tetap terdeteksi.
- Label jumlah: `"{n} produk"` (+ ` · {Kategori}` bila tepat 1 kategori aktif). `CategoryFilterTabs` (kapsul lama) DIHAPUS.

## Halaman Detail Produk — CTA & Deskripsi

- **Tombol beli responsif per breakpoint** (`StickyBuyBar`, satu instance saja):
  - **Mobile (< lg)**: `fixed inset-x-0 bottom-0 z-40` + latar putih & `border-t` — mengambang di
    dasar layar, seperti sebelumnya.
  - **Desktop (lg+)**: `lg:static lg:border-0 lg:bg-transparent` → mengalir sebagai blok biasa di
    kolom kanan, **di bawah section Deskripsi Produk**, tanpa panel putih (murni dua tombol).
    Bilah mengambang di layar lebar justru menutupi konten saat men-scroll.
  - Karena `position: fixed` mengeluarkan elemen dari alur, **letaknya di markup tidak memengaruhi
    tampilan mobile** — itulah kenapa satu instance cukup, tak perlu duplikat komponen per breakpoint.
    Syaratnya: jangan letakkan di dalam ancestor ber-`transform`/`filter`/`backdrop-filter`
    (akan jadi containing block, lihat catatan `MenuDrawer`).
  - `<main>` memakai `pb-24 lg:pb-8`; `useStickyBarHeight(isMobile)` menahan `--sticky-bar-h` di 0
    saat desktop. Deteksi breakpoint pakai `useMediaQuery('(max-width: 1023px)')`, satu flag untuk
    dua keperluan (mode mengambang + bottom-sheet varian).
- **Deskripsi bisa dilipat** (`ProductDescription`, kini `'use client'`): dipotong 5 baris
  (`max-height: calc(5 * 1.625 * 0.875rem)` — dihitung dari `text-sm` × `leading-relaxed` agar
  memotong pas di batas baris), gradient fade putih di tepi bawah, tombol "Lihat Selengkapnya" ⇄
  "Sembunyikan", transisi `max-height` 300ms. Berlaku di semua viewport.
  - Deteksi "perlu tombol atau tidak" = `scrollHeight > clientHeight` diukur di **ref callback**
    (bukan `useEffect` — lint `react-hooks/set-state-in-effect` melarang `setState` di dalam efek),
    dengan `ResizeObserver` untuk perubahan lebar. **Jangan** menebak dari jumlah karakter: deskripsi
    berisi baris baru & baris pendek ("Isi bersih: 50 gr") sehingga panjang teks ≠ jumlah baris.
  - Pengukuran di-skip saat sedang terbuka (dijaga `expandedRef`); tanpa itu `scrollHeight ==
    clientHeight` dan tombolnya hilang sendiri begitu diklik.
  - Konsekuensi: tombol baru muncul **setelah hidrasi** (tak ada di HTML server). Tanpa JS deskripsi
    tetap terpotong 5 baris.

## Halaman Legal (Kebijakan Privasi & Syarat/Ketentuan) — SEDANG DINONAKTIFKAN

> **Status (2026-08-12): kedua halaman TIDAK bisa diakses.** Keputusan pemilik toko — dokumennya
> belum diperlukan sekarang. **KODENYA UTUH, JANGAN DIHAPUS**: `page.tsx` kedua rute,
> `LegalPageShell`, dan seluruh konstanta `lib/data/legal.ts` tetap ada & tetap ikut type-check.
>
> Tuas tunggal: **`LEGAL_PAGES_ENABLED`** di `src/lib/data/legal.ts` (kini `false`).
> - `false` → kedua rute memanggil `notFound()` (**HTTP 404**), section "Legal" + baris di bawah
>   copyright di footer disembunyikan, dan teks persetujuan di `CheckoutBottomBar` tak dirender.
> - Menghidupkan kembali: ubah satu nilai itu jadi `true`. Tak ada file yang perlu dibuat ulang.
> - Sebelum dinyalakan lagi, ganti dulu `LEGAL_CONTACT_EMAIL`/`LEGAL_CONTACT_PHONE` (masih
>   placeholder) dan perbarui `LEGAL_EFFECTIVE_DATE`.
>
> Catatan: `main` di `/checkout` masih `pb-32` (ruang untuk teks persetujuan). Aman — hanya sedikit
> ruang ekstra saat teksnya disembunyikan, dan tak perlu diubah dua kali saat halaman dinyalakan lagi.

Uraian di bawah menjelaskan halamannya saat AKTIF:

- Rute: `/privacy-policy` & `/terms-and-conditions` (Server Component, konten statis, di LUAR route
  group `(store)` → punya header hijau sendiri seperti `/pesanan-saya`).
- Kerangka bersama: **`src/components/legal/LegalPageShell.tsx`** — header + judul + tanggal berlaku,
  lalu **SATU kartu putih** berisi daftar isi anchor + seluruh `LegalSection`, dipisah garis tipis
  (`divide-y`) bukan kartu per topik. Tiap `LegalSection` = `py-5 last:pb-0` + `scroll-mt-20`
  (lebih besar dari tinggi header karena bab punya padding atas). Anak PERTAMA kartu adalah `<nav>`
  daftar isi, jadi jangan pasang `first:pt-0` di section. Plus `LegalList`, `LegalExternalLink`
  (selalu `target="_blank" rel="noopener noreferrer"`).
- Konstanta bersama: **`src/lib/data/legal.ts`** — `LEGAL_PAGES_ENABLED` (tuas aktif/nonaktif),
  `LEGAL_CONTACT_EMAIL`/`LEGAL_CONTACT_PHONE` (**PLACEHOLDER**, ganti sebelum go-live),
  `LEGAL_EFFECTIVE_DATE` (perbarui manual tiap revisi material), `PRIVACY_POLICY_PATH`/`TERMS_PATH`
  (dipakai footer + bilah checkout), `THIRD_PARTY_LINKS`.
- **Isi dokumen HARUS cermin implementasi nyata.** Saat alur data berubah, perbarui halamannya:
  field checkout (kini TANPA email — identitas = no_telepon), cookie/localStorage yang dipakai,
  pihak ketiga (Xendit, Mengantar, Google Analytics, Supabase), aturan pembatalan (hanya status
  `Menunggu Pembayaran`/`Diproses`).
- Tautan: footer beranda (section "Legal" + baris di bawah copyright) & `CheckoutBottomBar`
  (teks persetujuan di atas tombol bayar, tautan **tab baru** agar isian form tak hilang →
  karena itu `main` checkout memakai `pb-32`, bukan `pb-24`).

## Skala z-index (storefront) — patuhi saat menambah elemen mengambang

Elemen ber-`z-index` lebih besar **menyerap klik/tap** walau secara visual tampak di belakang.
Bug nyata yang pernah terjadi: bottom-sheet `z-50` di bawah `FloatingWhatsApp` `z-[60]` → tombol
"Terapkan filter" hanya bisa diklik di sisi kiri karena sisanya tertutup tombol WA.

| Lapis | z-index | Contoh |
|---|---|---|
| Konten & bilah aksi bawah | `z-10`–`z-40` | `StickyBuyBar` (40, **hanya < lg**), `CartCheckoutBar`/`CheckoutBottomBar` (30) |
| Header | `z-50` | `AppBar`, header halaman |
| Tombol mengambang | `z-[60]` | `FloatingWhatsApp` |
| Overlay & backdrop | `z-[70]` | backdrop `MenuDrawer`, overlay `HeaderSearch` mobile, `PhoneConfirmModal` |
| Panel modal/sheet | `z-[80]` | `BottomSheet` (filter/sort/varian/ongkir/pembayaran), panel `MenuDrawer` |

**Aturan:** apa pun yang menutupi layar dan menerima klik WAJIB ≥ `z-[70]` — di atas tombol
mengambang. Jangan menambah lapis baru tanpa memperbarui tabel ini.

## Halaman Maintenance (`/maintenance`)

- **`src/app/maintenance/page.tsx`** — Server Component statis, tanpa header/footer/navigasi.
  Isi: logo (non-tautan), ikon `Wrench` dalam lingkaran `bg-brand-light/30`, judul "Sedang Dalam
  Perbaikan", 2 paragraf, pemisah `bg-brand-primary`, tautan CS WhatsApp, copyright.
  `metadata.robots = { index: false, follow: false }` (kondisi sementara, jangan diindeks).
- Link CS memakai **`WHATSAPP_CS_LINK`** dari `src/lib/data/contact.ts` (dipindah dari dalam
  `FloatingWhatsApp.tsx` agar satu sumber). Masih placeholder `/404`.
- `FloatingWhatsApp` self-gate juga di `/maintenance` (halaman ini sudah punya tautan CS sendiri).
- **Belum ada mekanisme mengaktifkan maintenance mode** — halaman ini baru TAMPILAN. Untuk
  mengalihkan seluruh trafik ke sini, tambahkan rewrite ber-flag env di `src/proxy.ts`
  (mis. `MAINTENANCE_MODE=1`), kecualikan `/maintenance` sendiri + aset `_next/*` + `/oms/*` bila
  admin tetap perlu akses. Idealnya balas **HTTP 503** (bukan 200) agar mesin pencari tak menganggap
  situs hilang permanen — butuh route handler/response kustom, bukan `page.tsx` biasa.

## Floating WhatsApp CS

- **`FloatingWhatsApp`** (`components/ui/`, client) dipasang di **root `layout.tsx`** (bukan per halaman) → tampil di
  SEMUA halaman ecommerce; **self-gate**: `usePathname()` → `return null` di `/oms/*` (admin) dan `/checkout`
  (jangan ganggu proses bayar; `/checkout/success` tetap tampil).
- Tombol lingkaran hijau kanan bawah (`fixed right-5 z-[60]`) + ikon WhatsApp SVG inline (lucide tak punya brand icon).
- **Posisi vertikal mengikuti bilah aksi bawah**: `bottom: calc(1.25rem + var(--sticky-bar-h, 0px))` +
  `transition-[bottom]`. Variable diisi oleh bilah yang sedang tampil lewat hook
  **`useStickyBarHeight`** (`src/hooks/use-sticky-bar-height.ts`, ResizeObserver → set
  `--sticky-bar-h` di `<html>`, reset `0px` saat unmount). Dipakai `StickyBuyBar` (detail produk) &
  `CartCheckoutBar` (keranjang). **Halaman baru dengan bilah bawah cukup memanggil hook ini** —
  jangan hardcode tinggi atau daftar route di `FloatingWhatsApp`.
  Hook menerima argumen **`enabled`** (default `true`) untuk bilah yang mengambang hanya di sebagian
  breakpoint: saat `false`, variable ditahan `0px`. Dipakai `StickyBuyBar` (`useStickyBarHeight(isMobile)`)
  karena di desktop bilahnya statis — tanpa itu tombol WA terangkat tanpa ada yang perlu dihindari.
  Bubble "Pesan melalui CS kami" muncul ~2.5s, auto-hide, tombol × tutup permanen.
- **Link CS** = constant **`WHATSAPP_CS_LINK`** di `FloatingWhatsApp.tsx` (placeholder `/404`; ganti ke `https://wa.me/62…` saat siap).

## Roadmap Integrasi (target arsitektur — belum diimplementasi)

### Xendit (Payment Gateway)
- Semua logika pembayaran di `src/lib/xendit/`
- Webhook diterima di `src/app/api/webhooks/xendit/route.ts`
- Verifikasi webhook signature sebelum memproses event apapun
- **Jangan expose** Xendit secret key di frontend

---

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
- [x] Mini cart dropdown di header (desktop ≥640px) — `MiniCart`; mobile tetap navigate ke `/keranjang`
- [x] Katalog & "Produk Terlaris" pure produk OMS (infinite scroll); "N terjual" di detail produk
- [x] Detail produk: galeri foto multi (maks 9) + harga coret
- [x] Promo & paket combo REAL di keranjang (dari Supabase via `/api/{promotions,combos}/active`)
- [x] Halaman guest checkout (`/checkout` + `/checkout/success`)
- [x] Hub "Pesanan Saya" (`/pesanan-saya`) — kartu lacak/batalkan/review; ikon akun header (dropdown
      di semua ukuran layar) + badge angka pesanan aktif dari cookie
- [x] Beri Review Produk by no_telepon (`/review`) — pembeli terverifikasi (riwayat beli) + badge "Pembeli Terverifikasi"
- [x] Halaman lacak pesanan by nomor invoice (`/track`) + by no_telepon (`/track-order`, honeypot + auto-recognize cookie)
- [x] Halaman pembatalan pesanan Guest (`/order-cancellation` token) + by no_telepon 2 langkah (`/cancel-order`)
- [x] Rate-limit endpoint publik rawan bot (lacak/batalkan/review by no_telepon, proxy Mengantar alamat+ongkir, create order, submit ulasan) — in-memory, ambang batas terpusat di `src/lib/rate-limit.ts`; belum terpusat lintas-instance (kandidat migrasi Supabase/Redis)
- [x] Search alamat + **cek ongkir** Mengantar di checkout (client; ongkir masuk ke total)
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
      pembayaran/**status pesanan**/**gudang**, sort Total & Tanggal, kombinasi filter tersimpan di
      URL query params, Reset Filter, ekspor CSV (SEMUA penyaringan server-side via
      `readOrdersFiltered`/`getDistinctCouriers`, `OrderFilterOptions`). Kolom tabel memuat **Gudang**
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

---

## Git & GitHub Workflow

- Branch naming: `feat/nama-fitur`, `fix/nama-bug`, `chore/nama-task`
- Commit format (Conventional Commits):
  - `feat: tambah halaman keranjang dengan cookie`
  - `fix: perbaiki kalkulasi ongkir Mengantar`
- Jangan push langsung ke branch utama — gunakan PR, squash merge

---

## Environment Variables

`.env.local` **wajib ada** untuk menjalankan app di lokal (Supabase sudah aktif).
Jangan di-commit (sudah diabaikan `.gitignore`). Di production, set lewat Vercel dashboard.

```
# Sudah dipakai sekarang (Supabase)
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY        # server-only (dipakai mock-db via createAdminClient)
ORDER_CANCEL_SECRET              # server-only, opsional (HMAC token pembatalan; ada fallback dev)
OMS_SESSION_SECRET               # server-only (HMAC tanda tangan cookie sesi OMS; ada fallback dev
                                 # — WAJIB di-set di production, jangan pakai fallback)

# Sudah dipakai sekarang (Mengantar — cek ongkir)
NEXT_PUBLIC_MENGANTAR_ORIGIN_ID  # _id kelurahan toko (asal pengiriman). WAJIB di-set di Vercel juga
                                 # (var NEXT_PUBLIC_* di-inline saat build → perlu redeploy)
MENGANTAR_ORIGIN_ID              # server-only, OPSIONAL; alias non-public dari var di atas (dipakai
                                 # proxy cek ongkir; bila diisi, nilainya menang & tak bocor ke bundel)
                                 # CATATAN: sejak fitur pergudangan, origin_id BERSUMBER DARI TABEL
                                 # warehouses; kedua var di atas kini hanya FALLBACK bila kolom
                                 # warehouses.mengantar_origin_id kosong.

# Sudah dipakai sekarang (Pergudangan)
# (DIHAPUS) WAREHOUSE_MODE       # Mode gudang TIDAK lagi dari env. Sumber kebenarannya baris DB
                                 # store_settings.warehouse_mode, diubah lewat toggle di OMS →
                                 # Gudang (berlaku seketika, tanpa redeploy). Jangan hidupkan
                                 # kembali env ini — dua sumber kebenaran = bug menunggu terjadi.

# Sudah dipakai sekarang (Google Analytics 4)
NEXT_PUBLIC_GA_ID                # PUBLIC/client; Measurement ID GA4 (format G-XXXXXXXXXX). Dipasang di
                                 # src/app/layout.tsx via <GoogleAnalytics> (@next/third-parties). Render
                                 # kondisional — GA hanya jalan bila terisi. Set di Vercel juga + redeploy.

# Roadmap (belum dipakai)
XENDIT_SECRET_KEY                # server-only
XENDIT_WEBHOOK_TOKEN             # server-only
MENGANTAR_API_KEY                # server-only (untuk booking/tracking nanti; cek ongkir tak butuh key)
```

> Cara dapat `NEXT_PUBLIC_MENGANTAR_ORIGIN_ID`: panggil endpoint search alamat Mengantar dengan
> nama kelurahan toko, ambil `_id` yang cocok. Jangan hardcode di kode.

---

## Security Rules

- **Jangan expose** `SUPABASE_SERVICE_ROLE_KEY`, `XENDIT_SECRET_KEY`, atau `MENGANTAR_API_KEY` di frontend
- Semua logic sensitif (pricing, stock update, payment) harus di Server Components, API Routes, atau Edge Functions
- `createAdminClient()` (service_role, menembus RLS) hanya dari server (API Route / Server Component) —
  jangan dari komponen klien. Browser pakai anon key + RLS
- Validasi input & **status order** di sisi server, bukan hanya frontend
  (mis. pembatalan: status dicek ulang di `PATCH /api/orders/cancel`, bukan percaya UI)
- Tautan aksi guest (pembatalan) wajib diverifikasi token (`verifyCancelToken`) sebelum diproses
- Verifikasi webhook signature Xendit sebelum memproses event apapun (saat integrasi)
- Cookie keranjang tidak boleh menyimpan data sensitif — hanya ID produk, quantity, price

---

## Brand Colors & Design System

Semua halaman wajib menggunakan palet warna berikut. Jangan menggunakan warna di luar palet ini tanpa konfirmasi.

### Palet Warna Utama

| Nama | HEX | Kegunaan |
|------|-----|----------|
| `green-primary` | `#00843b` | Background section, tombol utama, navbar, footer, **harga jual** |
| `green-light` | `#96D296` | Background card, badge, hover state |
| `green-surface` | `#F5FFEF` | Background halaman (putih kehijauan), input background |
| `white` | `#FFFFFF` | Teks di atas background hijau, card background |
| `text-dark` | `#1A1A1A` | Teks utama di atas background putih/terang |
| `text-muted` | `#6B7280` | Teks sekunder, harga asli (coret), placeholder |
| `red-promo` | `#EF4444` | Badge promo & badge persentase diskon, notifikasi error |

### Aturan Penggunaan Warna

- Background halaman default: `#F5FFEF` (bukan pure white `#FFFFFF`)
- Tombol primary: background `#00843b`, teks `#FFFFFF`
- Tombol hover: background sedikit lebih gelap dari `#00843b` (gunakan `brightness-90`)
- Card produk: background `#FFFFFF` dengan border atau shadow tipis
- Section banner (value proposition, footer): background `#00843b`, teks `#FFFFFF`
- **Harga jual SELALU `text-brand-primary`** (hijau), bukan merah — konsisten di kartu produk,
  detail produk (harga utama/varian/combo), keranjang, dan ringkasan checkout. Merah hanya untuk
  **badge persentase diskon** (`-25%`), teks "Stok habis", pesan error, dan ikon hapus item.
  Harga asli yang dicoret tetap `text-zinc-400`
- Card fitur di dalam section hijau: background `#96D296`
- **Jangan** menggunakan warna biru, ungu, atau warna brand lain tanpa konfirmasi
- **Pengecualian fungsional** (sudah disepakati): aksi destruktif memakai `rose` (mis. tombol
  "Batalkan Pesanan"), tombol sekunder netral `slate-100`, banner peringatan `orange`, dan
  badge status order (amber/emerald/rose). Tetap hindari biru/ungu.

### Token Brand (sudah dikonfigurasi)

Token brand sudah didefinisikan di `tailwind.config.ts` dan di-load lewat directive
`@config` di `src/app/globals.css` (Tailwind v4):

```ts
// tailwind.config.ts
theme: {
  extend: {
    colors: {
      brand: {
        primary: '#00843b',   // hijau utama
        light: '#96D296',     // hijau muda / card
        surface: '#F5FFEF',   // background halaman
        soil: '#6B4E3D',      // cokelat tanah — eyebrow/aksen hangat
        cream: '#EDE3D0',     // krem biji — background lembut alternatif
        dark: '#3B4A2E',      // hijau zaitun gelap
        header: '#00843b',    // background header storefront
      }
    }
  }
}
```

Gunakan class `bg-brand-primary`, `text-brand-primary`, `bg-brand-light`, `bg-brand-surface` di seluruh project.

> **Kalau hex brand diubah**, perbarui tabel palet + blok di atas sekaligus. Satu tempat yang
> TIDAK ikut token: `src/emails/order-confirmation.html` (inline CSS, `#46b33c`) — klien email tak
> mengenal variabel CSS, jadi hex di situ harus diganti manual.

### Tipografi (sudah terpasang)

Dua font, dibagi menurut peran. Terpasang lewat `next/font/google` di `src/app/layout.tsx`.

| Peran | Font | Cara pakai |
|---|---|---|
| Judul & CTA utama (identitas merek) | **Montserrat** (variable, `display: swap`) | token `--font-heading` → utility `font-heading` |
| Teks isi (paragraf, label, tabel) | **Geist Sans** | `--font-sans`, dipakai `body` |
| Angka teknis (SKU, resi, invoice) | **Geist Mono** | utility `font-mono` |

- **`h1`–`h4` otomatis** memakai font merek lewat aturan `@layer base` di `globals.css` — jangan
  tambahkan `font-heading` satu per satu di komponen. **JANGAN pakai `font-sans` pada heading**:
  utility class menang atas aturan base, jadi heading itu akan luput dari font merek (bug ini pernah
  terjadi di headline `HeroSection`).
- **Tombol TIDAK diikutkan** di aturan base. Hanya CTA utama yang diberi `font-heading` eksplisit
  (`StickyBuyBar`, `CartCheckoutBar`, `CheckoutBottomBar`, `MiniCart`, CTA hero). Tombol kecil
  (stepper qty, tutup modal, aksi tabel OMS) sengaja tetap netral & padat.
- Wordmark teks "infarm" (footer, `LegalPageShell`) memakai `font-heading`.
- `body` mengikuti `var(--font-sans)`; Arial hanya fallback. **Jangan hardcode `font-family` di
  `body`** — dulu `body { font-family: Arial }` menimpa font next/font sehingga unduhannya sia-sia.
- **Ganti font merek** (mis. ke font berlisensi seperti Mont dari Fontfabric) cukup di dua tempat:
  deklarasi font di `layout.tsx` + nilai `--font-heading` di `globals.css`. Komponen tak perlu
  disentuh. Font komersial WAJIB dari lisensi *webfont* yang dibeli, self-host via `next/font/local`
  di `src/fonts/` — jangan pakai file dari situs unduhan gratis.

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
