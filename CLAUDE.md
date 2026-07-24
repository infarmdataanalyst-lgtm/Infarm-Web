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
│   │   ├── page.tsx              # Homepage (search bar autocomplete)
│   │   ├── products/page.tsx     # Katalog produk
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
│   ├── dev/email-preview/        # Preview template email (route handler, isi placeholder data contoh)
│   ├── oms/                      # OMS / back office
│   │   ├── login/page.tsx
│   │   └── dashboard/            # dashboard, products (+upload), orders, reviews,
│   │       │                     #   paket-combo (+baru, [id]/edit), promosi (+baru, [id]/edit)
│   ├── api/                      # Route Handlers (runtime nodejs)
│   │   ├── products/             # create | update | delete | list | check-sku | best-selling |
│   │   │                         #   sales-count | best-selling-catalog | search (autocomplete) | by-ids (resolve keranjang)
│   │   ├── orders/               # create | list (filter+sort+CSV OMS) | get | cancel (GET+PATCH token) |
│   │   │                         #   track-by-phone | verify-cancel | cancel-by-phone (batalkan by no_telepon)
│   │   ├── reviews/              # create (invoice) | list | reply | visibility | reviewed |
│   │   │                         #   reviewable-by-phone | create-by-phone (review terverifikasi via no_telepon)
│   │   ├── combos/              # create | update | delete | toggle | list | active (storefront)
│   │   ├── promotions/          # create | update | delete | toggle | list | active (storefront)
│   │   └── mengantar/address/search  # Proxy search alamat Mengantar (wilayah.id CORS-blocked → proxied)
│   ├── layout.tsx                # Root layout (font, metadata)
│   └── globals.css               # Tailwind v4 + @config tailwind.config.ts
├── components/
│   ├── home/                     # Homepage (HeroSearchBar, BestSellingProducts [infinite scroll], dll)
│   ├── product/                  # Kartu & detail produk: ProductImageSlider (galeri maks 9),
│   │                             #   ProductInfo (harga coret + "N terjual"), TrackProductView (catat lihat)
│   ├── cart/                     # Keranjang: CartPromoList, CartComboList, CartPaymentSummary,
│   │                             #   CartRecentlyViewed ("Dilihat Sebelumnya"), dll
│   ├── checkout/                 # AddressForm, AddressSearchCombobox, ShippingOptions (bottom sheet
│   │                             #   cek ongkir), PaymentModal, BottomSheet, OrderSummary, dll
│   ├── order-cancellation/       # OrderCancellationView (client)
│   ├── review/                   # Komponen review
│   ├── track/                    # Komponen pelacakan
│   ├── oms/                      # Sidebar, header, chart, ComboForm, PromotionForm
│   └── ui/                       # Komponen UI generik (AppBar, dll)
├── lib/
│   ├── cart-client.ts            # Helper keranjang sisi-klien (cookie base64) + addComboToCart + removeComboFromCart + snapshot promo + clearCart
│   ├── guest-phone.ts            # Cookie client no_telepon (infarm_phone) untuk auto-recognize lacak/batalkan
│   ├── recently-viewed.ts        # Riwayat "pernah dilihat" (guest, localStorage, maks 10)
│   ├── promo-cart.ts             # Helper murni: progres/hadiah promo + relevansi & alokasi harga combo (keranjang)
│   ├── product-validation.ts     # Validasi form produk (SKU, nama, kategori, harga jual/asli, stok, deskripsi, foto)
│   ├── format.ts                 # Util format (mis. rupiah)
│   ├── phone.ts                  # Validasi & normalisasi no. telepon ID (checkout)
│   ├── checkout-validation.ts    # Validasi field alamat (nama/telepon/alamat) → status tombol "Bayar Sekarang"
│   ├── combo-validation.ts       # Validasi server payload combo
│   ├── promotion-validation.ts   # Validasi server payload promo
│   ├── mengantar.ts              # Client: search alamat (via proxy) + cek ongkir (fetch langsung)
│   ├── order-token.ts            # Token HMAC tautan pembatalan (server-only)
│   ├── supabase/                 # Client Supabase: server.ts (admin/SSR) + browser.ts
│   ├── mock-db/                  # Akses data Supabase: products, orders, reviews, combos, promotions (server only)
│   │                             #   + cached-reads.ts (wrapper unstable_cache storefront: revalidate 30s + tags)
│   └── data/                     # Dummy data tampilan pelengkap (dummy-*.ts)
├── emails/                       # Template HTML email (order-confirmation.html) — placeholder {{...}}
├── hooks/                        # use-debounce.ts, dll
└── types/                        # product.ts, cart.ts, order.ts, combo.ts, promotion.ts

# Root: next.config.ts, tailwind.config.ts, eslint.config.mjs, postcss.config.mjs,
#       tsconfig.json, AGENTS.md, CLAUDE.md, .env.local (tidak di-commit)
# public/images/email/: aset gambar email (mis. logo-infarm.png) — lihat README di folder tsb
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
  `getCachedRatingSummary`, `getCachedCombos`, `getCachedSalesCountByProduct`, `getBestSellingCatalogPage`.
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
  `name`, `is_active`. RLS aktif tanpa policy publik → akses hanya server (service_role).
  Migration `supabase/migrations/20260708120000_init_admin_users.sql` (+ seed admin awal).
- **Verifikasi password**: `src/lib/mock-db/admins.ts` (server-only, `node:crypto` scrypt +
  `timingSafeEqual`). `authenticateAdmin(username, password)`.
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
- **Roadmap**: pertimbangkan Supabase Auth penuh bila butuh multi-peran/reset password.

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
auto-cari tanpa ketik). **Rate-limit sudah terpasang** di semua endpoint ini via `src/lib/rate-limit.ts`
(in-memory Map per-instance, sama pola dengan `/api/oms/login` — belum terpusat lintas-instance Vercel,
kandidat migrasi ke tabel Supabase/Redis nanti). Dua lapis: per-IP (throttle umum) + per-nomor-telepon
dinormalisasi (cegah brute-force tertarget dari banyak IP ke satu nomor). Endpoint baca (`track-by-phone`,
`verify-cancel`, `reviewable-by-phone`): 20/IP/15 menit + 15/nomor/jam. Endpoint tulis/destruktif
(`cancel-by-phone`, `create-by-phone`): 8/IP/15 menit + 5/nomor/jam (lebih ketat). Balas `429` + pesan
generik saat limit tercapai. Menutup temuan K-1 di `docs/security/audit-2026-07-24.md`.

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

## Mengantar (Logistik) — sudah terpasang sebagian

Semua helper client ada di **`src/lib/mengantar.ts`** (file, bukan folder). Endpoint Mengantar
bersifat publik (tanpa API key) → dipanggil dari client, KECUALI search alamat yang diproksi karena CORS.

- **Search alamat** (`searchAddress`): UI di `AddressSearchCombobox` (debounce 500ms, min 3 karakter).
  Host alamat (wilayah) **tidak mengirim header CORS** → request diproksi lewat route handler internal
  `src/app/api/mengantar/address/search/route.ts` (BUKAN server action). `_id` kelurahan terpilih
  disimpan sebagai **`destination_id`** di state form alamat (dipakai cek ongkir).
- **Cek ongkir** (`fetchShippingEstimate`): endpoint estimasi **mengizinkan CORS (`*`)** → di-fetch
  **langsung dari client**. Origin toko dari env **`NEXT_PUBLIC_MENGANTAR_ORIGIN_ID`** (jangan hardcode).
  Param: `origin_id`, `destination_id`, `weight` (kg). Response = object per-kurir; ambil
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

## Roadmap Integrasi (target arsitektur — belum diimplementasi)

### Xendit (Payment Gateway)
- Semua logika pembayaran di `src/lib/xendit/`
- Webhook diterima di `src/app/api/webhooks/xendit/route.ts`
- Verifikasi webhook signature sebelum memproses event apapun
- **Jangan expose** Xendit secret key di frontend

---

## Domain: Ecommerce & OMS

### Ecommerce (Storefront)
- [x] Halaman beranda (homepage) — dengan search bar autocomplete
- [x] Halaman katalog produk (`/products`)
- [x] Halaman detail produk (`/produk/[id]`)
- [x] Halaman keranjang (`/keranjang`) — data dari cookie + section "Dilihat Sebelumnya" (localStorage)
- [x] Katalog & "Produk Terlaris" pure produk OMS (infinite scroll); "N terjual" di detail produk
- [x] Detail produk: galeri foto multi (maks 9) + harga coret
- [x] Promo & paket combo REAL di keranjang (dari Supabase via `/api/{promotions,combos}/active`)
- [x] Halaman guest checkout (`/checkout` + `/checkout/success`)
- [x] Hub "Pesanan Saya" (`/pesanan-saya`) — kartu lacak/batalkan/review; ikon profil header + badge cookie
- [x] Beri Review Produk by no_telepon (`/review`) — pembeli terverifikasi (riwayat beli) + badge "Pembeli Terverifikasi"
- [x] Halaman lacak pesanan by nomor invoice (`/track`) + by no_telepon (`/track-order`, honeypot + auto-recognize cookie)
- [x] Halaman pembatalan pesanan Guest (`/order-cancellation` token) + by no_telepon 2 langkah (`/cancel-order`)
- [x] Rate-limit untuk lacak/batalkan/review by no_telepon — in-memory per-IP + per-nomor (`src/lib/rate-limit.ts`); belum terpusat lintas-instance (kandidat migrasi Supabase/Redis)
- [x] Search alamat + **cek ongkir** Mengantar di checkout (client; ongkir masuk ke total)
- [x] Validasi form checkout (nama/telepon/email/alamat/kurir) + gating tombol "Bayar Sekarang"
- [x] Template email konfirmasi pesanan (`src/emails/`, preview di `/dev/email-preview`)
- [ ] Integrasi Xendit (pembayaran) — masih UI/mock
- [ ] Mengantar: booking kurir & tracking resi otomatis — masih roadmap

### OMS (Back Office)
- [x] Login OMS (`/oms/login`) — verifikasi ke tabel `admin_users` (scrypt) + cookie sesi httpOnly
      bertanda tangan HMAC + rate limit (`proxy.ts` verifikasi tanda tangan)
- [x] Dashboard OMS (`/oms/dashboard`)
- [x] Manajemen produk (list, upload/create, update, delete) via API + Supabase — multi-foto (maks 9),
      harga jual/asli (coret), validasi form, kolom "Terjual" + rentang waktu
- [x] Manajemen order (`/oms/dashboard/orders`) — filter tanggal (range + shortcut)/kurir/status pembayaran,
      sort Total & Tanggal, kombinasi filter tersimpan di URL query params, Reset Filter, ekspor CSV
      (server-side via `readOrdersFiltered`/`getDistinctCouriers`, `OrderFilterOptions`)
- [x] Manajemen review (`/oms/dashboard/reviews`) — create/list/reply/visibility
- [x] Manajemen Paket & Combo (`/oms/dashboard/paket-combo`) — create/list/update/delete/toggle
- [x] Manajemen Promosi (`/oms/dashboard/promosi`) — create/list/update/delete/toggle
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
NEXT_PUBLIC_MENGANTAR_ORIGIN_ID  # PUBLIC/client; _id kelurahan toko (asal pengiriman). WAJIB di-set
                                 # di Vercel juga (var NEXT_PUBLIC_* di-inline saat build → perlu redeploy)

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
| `green-primary` | `#46B33C` | Background section, tombol utama, navbar, footer |
| `green-light` | `#96D296` | Background card, badge, hover state |
| `green-surface` | `#F5FFEF` | Background halaman (putih kehijauan), input background |
| `white` | `#FFFFFF` | Teks di atas background hijau, card background |
| `text-dark` | `#1A1A1A` | Teks utama di atas background putih/terang |
| `text-muted` | `#6B7280` | Teks sekunder, harga asli (coret), placeholder |
| `red-promo` | `#EF4444` | Badge promo, harga diskon, notifikasi error |

### Aturan Penggunaan Warna

- Background halaman default: `#F5FFEF` (bukan pure white `#FFFFFF`)
- Tombol primary: background `#46B33C`, teks `#FFFFFF`
- Tombol hover: background sedikit lebih gelap dari `#46B33C` (gunakan `brightness-90`)
- Card produk: background `#FFFFFF` dengan border atau shadow tipis
- Section banner (value proposition, footer): background `#46B33C`, teks `#FFFFFF`
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
        primary: '#46B33C',   // hijau utama
        light: '#96D296',     // hijau muda / card
        surface: '#F5FFEF',   // background halaman
      }
    }
  }
}
```

Gunakan class `bg-brand-primary`, `text-brand-primary`, `bg-brand-light`, `bg-brand-surface` di seluruh project.

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
