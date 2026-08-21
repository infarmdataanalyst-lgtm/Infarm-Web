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
**cek ongkir otomatis** di halaman checkout sudah jalan (detail: [docs/checkout-flow.md](docs/checkout-flow.md)
→ "Mengantar (Logistik)").
Tracking/booking resi masih roadmap. Integrasi **Xendit (pembayaran)** **belum diimplementasi** —
masih roadmap; bagian Xendit di bawah adalah **target arsitektur**, bukan kondisi sekarang.
Tandai jelas mana yang sudah ada vs masih rencana saat menulis kode.

> Catatan penamaan: folder `src/lib/mock-db/` namanya warisan dari fase mock file-based,
> tapi **isinya kini Supabase**. Pola isolasinya tetap: pemanggil (API Route / Server Component)
> tidak tahu sumber datanya — hanya signature fungsi yang penting.

---

## Peta Dokumentasi

File ini hanya memuat **aturan yang berlaku di hampir semua task**. Detail per domain dipecah ke
`docs/` supaya tidak dimuat setiap sesi. **Baca file terkait saat task-nya menyentuh domain itu** —
tautan di bawah sengaja tautan biasa, BUKAN `@import`, karena `@import` tetap memuat seluruh isi
file di awal sesi sehingga tak menghemat context sama sekali.

| File | Isi | Baca saat |
|---|---|---|
| [docs/warehouse.md](docs/warehouse.md) | Gudang cabang, stok per gudang, Kelola Stok, Riwayat Mutasi, filter gudang di Pesanan | Menyentuh stok, ongkir, gudang, atau halaman Pesanan OMS |
| [docs/oms-dashboard.md](docs/oms-dashboard.md) | Header OMS (notifikasi & pengaturan), Revenue Dashboard, tabel/filter Produk, validasi form produk, foto multi, harga coret, produk terlaris | Mengerjakan halaman `/oms/dashboard/*` |
| [docs/storefront-pages.md](docs/storefront-pages.md) | AppBar & search, katalog, detail produk, legal, maintenance, floating WhatsApp, recently viewed, skala z-index | Mengerjakan halaman publik / elemen mengambang |
| [docs/checkout-flow.md](docs/checkout-flow.md) | Alur end-to-end, skema `orders`, promo & combo, minimum pembelian, Mengantar, validasi checkout, pembatalan & layanan by no. telepon, email konfirmasi | Menyentuh keranjang, checkout, order, promo, atau ongkir |
| [docs/design-system.md](docs/design-system.md) | Palet warna brand, token Tailwind, tipografi | Menyentuh tampilan apa pun |
| [ROADMAP.md](ROADMAP.md) | Semua pekerjaan yang belum selesai, dikelompokkan per area | Menentukan prioritas / mencari pekerjaan lanjutan |

Dokumen pendukung lain yang sudah ada: `docs/security/`, `docs/design/`, `docs/testing/`,
`docs/cache-test-*.md`, `docs/security-audit-2026-07-08.md`, `supabase/README.md`, `AGENTS.md`.

---

## Sistem Belanja: Guest Checkout

- Tidak ada sistem login untuk pelanggan (guest checkout)
- Pelanggan bisa menambahkan produk ke keranjang **tanpa login**
- Data keranjang disimpan di **cookie browser** (bukan database, bukan localStorage)
- Tetap tersedia halaman keranjang (`/keranjang`) untuk review sebelum checkout
- Data yang dikumpulkan saat checkout: nama, alamat, nomor HP (untuk keperluan pengiriman & notifikasi).
  Field email **sudah dihapus dari form checkout** — fokus identitas guest kini murni no_telepon
  (selaras lacak/batalkan/review by phone). Kolom `customer_email` masih ada di DB (nullable) untuk
  data lama, tapi order baru selalu mengirim `customerEmail: undefined`
  (detail: [docs/checkout-flow.md](docs/checkout-flow.md) → "Email Konfirmasi Pesanan").

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

Auth admin real (Supabase Auth), Xendit, Vercel, GitHub — beserta seluruh pekerjaan lain yang belum
selesai, dikumpulkan di [ROADMAP.md](ROADMAP.md).

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
│   │   └── success/page.tsx      # Pesanan Berhasil (2 kolom di lg+, + tombol batalkan pesanan)
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
│   │   ├── cron/                   # mengantar-pickup (GET, dipicu Vercel Cron, guard CRON_SECRET)
│   │   ├── dev/                    # simulate-payment (DEV-ONLY: NODE_ENV + requireAdmin)
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
│   ├── track/                    # Komponen pelacakan (TrackSearchForm, ShippingStepper,
│   │                             #   TrackingTimeline, OrderItemsCard = kartu produk dipesan)
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
│   ├── product-validation.ts     # Validasi form produk (SKU, nama, kategori, harga jual/asli, stok, berat, deskripsi, foto)
│   ├── warehouse.ts              # SATU pintu pergudangan: mode (DB), resolve gudang (fallback),
│   │                             #   stok efektif, origin id (server-only; TANPA jarak/Haversine)
│   ├── warehouse-shipping.ts     # Perbandingan ongkir riil antar gudang (paralel + cache 10 mnt)
│   ├── mengantar-estimate.ts     # Pemetaan respons estimasi Mengantar (dipakai client & server)
│   ├── mengantar-host.ts         # SATU pintu host Mengantar (MENGANTAR_BASE_URL) — ongkir+time+order
│   ├── shipping-weight.ts        # SATU pintu berat kirim: gram (DB) -> kilogram (Mengantar), murni
│   ├── pickup-schedule.ts        # Aturan jadwal pickup: hari kerja, cutoff 15:00 WIB, tanggal efektif (murni)
│   ├── mengantar-pickup.ts       # SATU pintu time_id pickup: POST /time + tabel harian (server-only)
│   ├── mengantar-shipment.ts     # SATU pintu booking kurir J&T: POST /order (server-only)
│   ├── shipment-booking.ts       # Orkestrasi booking setelah bayar sukses + catat hasil/kegagalan
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
│   │                             #   stock-mutations (riwayat stok), pickup (jadwal pickup harian)
│   │                             #   — server only
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
# public/images/couriers/<kode-kurir>.png: logo kurir di checkout (mis. jt.png). Nama file = kode
#   kurir dari respons Mengantar huruf kecil; peta di src/lib/courier-logo.ts. BERWARNA (kotaknya
#   selalu putih), transparan, bujur sangkar. Belum ada file → jatuh ke ikon truk. Lihat README
#   di folder tsb
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


---

## Alur Pesanan, Promo & Ongkir → `docs/checkout-flow.md`

**Berat produk disimpan GRAM di `products.berat`, tapi Mengantar meminta KILOGRAM** — konversi HANYA
lewat `src/lib/shipping-weight.ts` (salah satuan = ongkir 1000× lebih mahal). Jangan membulatkan kg
sendiri (Mengantar sudah menerapkan aturan `ceil(kg − 0,3)`), dan jangan memakai nilai `weight` dari
client sebagai dasar tagihan — server menghitung ulang dari berat di DB.

**Kurir dibatasi J&T saja** — daftar putih `ALLOWED_COURIER_IDS` di `src/lib/mengantar-estimate.ts`,
disaring **di server**. Kode kurirnya `'JT'` (kapital, tanpa `&`) untuk cek ongkir **maupun** booking;
`"jt"` huruf kecil ditolak Mengantar. Booking kurir dipicu setelah pembayaran sukses dan
**kegagalannya wajib ditandai** (`shipment_status='FAILED'`), jangan silent fail — uang pembeli sudah
masuk.

**Halaman `/checkout` membaca cookie `infarm_checkout`, BUKAN `infarm_cart`** — setiap aksi menuju
checkout (tombol Checkout di keranjang maupun "Beli Langsung") WAJIB memanggil `setCheckoutItems(...)`
lebih dulu. Checkout bersifat atomik lewat RPC `create_order_with_items`, dan minimum pembelian
(per produk + total belanja) **wajib dicek ulang di server**, jangan mengandalkan client.
Detail lengkap (skema `orders`, promo/combo, Mengantar, validasi checkout, pembatalan & layanan
by no. telepon, email konfirmasi, flowchart end-to-end): [docs/checkout-flow.md](docs/checkout-flow.md)

---

## Pergudangan (Gudang Cabang) → `docs/warehouse.md`

**Mode multi-gudang adalah mode resmi sistem — jangan pernah berasumsi hanya ada satu gudang.**
Jangan membaca mode, stok mentah, atau `origin_id` di luar `src/lib/warehouse.ts` (satu pintu,
server-only); pemilihan gudang memakai **perbandingan ongkir riil**, bukan jarak. Stok hanya boleh
diedit dari OMS → Gudang → Kelola Stok, dan **setiap titik tulis stok baru WAJIB ikut mencatat lewat
`src/lib/stock-audit.ts`** — kalau bolong, riwayat berbohong.
Detail lengkap: [docs/warehouse.md](docs/warehouse.md)

---

## OMS: Header, Dashboard & Halaman Produk → `docs/oms-dashboard.md`

**Pendapatan WAJIB tetap dipecah per status pembayaran** (Lunas / Pending / Dibatalkan) selama Xendit
belum terpasang — order baru selalu `PENDING` padahal stok sudah dipotong, jadi satu angka gabungan
menyesatkan. **Ambang "stok menipis" bukan konstanta**: baca `getLowStockThreshold()` (server) atau
`GET /api/settings/low-stock-threshold` (client). Notifikasi header dihitung real-time (tanpa tabel
`notifications`) dan memakai polling, bukan Supabase Realtime.
Detail lengkap: [docs/oms-dashboard.md](docs/oms-dashboard.md)

---

## Halaman Storefront → `docs/storefront-pages.md`

**Patuhi skala z-index**: apa pun yang menutupi layar dan menerima klik WAJIB ≥ `z-[70]`, di atas
tombol mengambang `z-[60]` — pernah terjadi bottom-sheet `z-50` tertutup tombol WhatsApp. Halaman
baru yang punya bilah aksi bawah cukup memanggil `useStickyBarHeight`, jangan hardcode tinggi atau
daftar route di `FloatingWhatsApp`. Halaman legal sedang **dinonaktifkan** lewat satu tuas
`LEGAL_PAGES_ENABLED` — kodenya utuh, jangan dihapus.
Detail lengkap: [docs/storefront-pages.md](docs/storefront-pages.md)

---

## Brand Colors & Design System → `docs/design-system.md`

**Semua halaman wajib memakai palet brand**: hijau utama `#00843b` (`brand-primary`), background
halaman `#F5FFEF` (`brand-surface`), dan **harga jual SELALU `text-brand-primary`** (hijau, bukan
merah). **Jangan menggunakan warna biru atau ungu tanpa konfirmasi.** Heading `h1`–`h4` sudah otomatis
memakai font merek lewat `@layer base` — jangan menambahkan `font-sans` di heading (utility menang
atas base dan font merek akan luput).
Detail lengkap (palet, token Tailwind, tipografi): [docs/design-system.md](docs/design-system.md)

---

## Pekerjaan yang Belum Selesai → `ROADMAP.md`

Integrasi Xendit, booking/tracking kurir Mengantar, Supabase Auth penuh, transfer stok antar gudang,
perbaikan akurasi `aggregateSales`, dan temuan keamanan yang menunggu keputusan — semuanya
dikelompokkan per area di [ROADMAP.md](ROADMAP.md). Anotasi inline (`TODO`, "masih roadmap") tetap
ada di tempat aslinya; ROADMAP.md adalah indeks + penunjuknya.

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

# Sudah dipakai sekarang (Webhook Xendit)
XENDIT_CALLBACK_TOKEN            # server-only, WAJIB. Dibandingkan waktu-konstan dengan header
                                 # `x-callback-token` di POST /api/webhooks/xendit. Xendit TIDAK
                                 # menandatangani body-nya (tak ada HMAC seperti Stripe), jadi token
                                 # ini satu-satunya pembeda callback asli vs palsu. Ambil dari
                                 # Xendit Dashboard → Settings → Webhooks. Tanpa var ini endpoint
                                 # membalas 500 (bukan 401) — salah konfigurasi kita, bukan serangan.
                                 # CATATAN: dulu didokumentasikan sebagai XENDIT_WEBHOOK_TOKEN;
                                 # namanya diselaraskan ke header Xendit yang sebenarnya.

# Sudah dipakai sekarang (Jadwal pickup harian Mengantar)
MENGANTAR_BASE_URL               # server-only, WAJIB. Host API Mengantar untuk POST /time,
                                 # POST /order, DAN cek ongkir (allEstimatePublic) — satu pintu
                                 # di src/lib/mengantar-host.ts. Saat ini masih
                                 # https://sandbox.mengantar.com — GANTI ke
                                 # https://app.mengantar.com sebelum go-live.
                                 # PENTING: cek ongkir & booking WAJIB satu host. Tabel tarif
                                 # sandbox berbeda jauh dari produksi (J&T 1kg Jakarta->Jakarta:
                                 # produksi Rp8.000 vs sandbox Rp25.520) dan sandbox mengalikan
                                 # berat linear, bukan ceil(kg-0,3). Kalau host-nya beda, harga
                                 # yang DIKUTIP ke pembeli tak akan pernah cocok dengan biaya
                                 # booking. Search alamat SENGAJA tetap ke app.mengantar.com
                                 # (master data wilayah & _id identik di kedua host).
MENGANTAR_API_KEY                # server-only, WAJIB untuk POST /time & POST /order.
                                 # PERHATIAN: key ini menjadi SEGMEN PATH URL
                                 # ({BASE}/api/public/{KEY}/time), bukan header. Jadi URL-nya
                                 # rahasia — jangan pernah di-log, dan JANGAN dipakai dari
                                 # komponen klien (akan terbaca utuh di tab Network).
                                 # Cek ongkir & search alamat tetap tak butuh key.
MENGANTAR_STORE_ADDRESS_ID       # server-only, WAJIB. _id alamat gudang/toko di Mengantar (ObjectId
                                 # 24 hex) — dikirim sebagai address_id saat membuat slot pickup.
                                 # BEDA dari MENGANTAR_ORIGIN_ID (itu _id kelurahan untuk ongkir).
MENGANTAR_PICKUP_ORIGIN_ID       # server-only, OPSIONAL tapi SANGAT DISARANKAN selama akun Mengantar
                                 # hanya punya SATU alamat pickup. _id kelurahan alamat pickup itu
                                 # (mis. CENGKARENG BARAT). Bila di-set, SELURUH kutipan ongkir
                                 # memakai origin ini — bukan origin per gudang — sehingga harga yang
                                 # dilihat pembeli = harga yang benar-benar ditagih saat booking.
                                 # KENAPA PERLU: POST /order tak punya field origin; Mengantar
                                 # menagih dari pickup.address_id. Tanpa env ini pembeli bisa dikutip
                                 # tarif Surabaya lalu ditagih tarif Cengkareng — selisihnya keluar
                                 # dari saldo Mengantar tanpa jejak di tabel orders.
                                 # Dibaca HANYA oleh getQuoteOriginId() di src/lib/warehouse.ts.
                                 # Konsekuensi: semua gudang berharga sama → pemilihan gudang tak
                                 # lagi berbasis ongkir (jatuh ke gudang ber-stok, default dulu).
                                 # Cabut setelah tiap gudang punya mengantar_address_id sendiri.
MENGANTAR_PICKUP_TIME_ID         # server-only, OPSIONAL. Slot pickup STATIS dari era sebelum tabel
                                 # mengantar_daily_pickup ada. Kini hanya CADANGAN LAPIS TERAKHIR di
                                 # getTodayPickupTimeId() bila tabel kosong DAN panggilan POST /time
                                 # gagal. Jangan dijadikan sumber utama: satu id untuk selamanya
                                 # berarti semua paket terdaftar di slot penjemputan yang sama.
CRON_SECRET                      # server-only, WAJIB. Vercel otomatis menyisipkan header
                                 # `Authorization: Bearer $CRON_SECRET` saat memanggil cron bila var
                                 # ini ada. Dibandingkan waktu-konstan di
                                 # GET /api/cron/mengantar-pickup. Tanpa guard ini siapa pun yang
                                 # tahu URL-nya bisa memicu pembuatan slot pickup baru di Mengantar.
                                 # Tanpa var ini endpoint membalas 500 (bukan 401) — salah
                                 # konfigurasi kita, bukan serangan.

# Roadmap (belum dipakai)
XENDIT_SECRET_KEY                # server-only (untuk MEMBUAT invoice; webhook tak butuh key ini)
```

> Cara dapat `NEXT_PUBLIC_MENGANTAR_ORIGIN_ID`: panggil endpoint search alamat Mengantar dengan
> nama kelurahan toko, ambil `_id` yang cocok. Jangan hardcode di kode.

---

## ⛔ Panggilan API Berbayar — WAJIB Konfirmasi Pemilik Proyek

**Jangan pernah memanggil endpoint pihak ketiga yang menghabiskan uang atau menerbitkan dokumen
nyata tanpa persetujuan eksplisit pemilik proyek lebih dulu.** Ini berlaku untuk siapa pun/apa pun
yang bekerja di repo ini, termasuk asisten AI.

Yang termasuk **panggilan TULIS berbayar**:

| Panggilan | Akibatnya |
|---|---|
| `POST {host}/api/public/{KEY}/order` | Memotong saldo Mengantar + menerbitkan resi nyata. **Tak bisa dibatalkan dari sisi kita** |
| `POST {host}/api/public/{KEY}/time` | Membuat slot penjemputan di akun Mengantar |
| `POST /api/dev/simulate-payment` | Menandai LUNAS lalu **memicu booking kurir** — sama mahalnya dengan pembayaran sungguhan |
| Xendit `api.xendit.co` | Membuat invoice/charge = uang sungguhan |

Yang **bebas dipanggil** (gratis, tanpa API key, tanpa efek samping): cek ongkir
`allEstimatePublic`, search alamat `/api/public/test/address/search`, dan seluruh endpoint lokal
`/api/...` milik app ini yang hanya membaca.

**Verifikasi kontrak API dilakukan dengan MEMBACA** — kode, dokumen, respons yang sudah pernah
tercatat di `docs/` — **bukan** dengan memanggil endpoint berbayar berulang kali sampai bentuknya
ketemu. Kalau memang harus memanggil: jelaskan dulu apa yang akan dipanggil dan berapa biayanya,
lalu biarkan pemilik proyek yang menjalankannya.

**Latar belakang (kenapa aturan ini ada):** saat integrasi booking kurir dikerjakan, verifikasi
kontrak API dijalankan dengan 4 kali booking sungguhan ke sandbox tanpa bertanya lebih dulu.
Saldo terpotong oleh kiriman uji yang **bercampur** dengan pengujian pemilik proyek, dan dashboard
Mengantar tak punya penanda apa pun untuk membedakan keduanya — angka yang terpotong jadi tak bisa
dijelaskan. Di sandbox itu kerugian yang bisa ditoleransi. Dengan kunci produksi, itu uang nyata
dan paket nyata yang akan dijemput kurir.

### Tiga lapis penegaknya (jangan dilemahkan tanpa diminta)

1. **Penjaga lingkungan** — `mengantarWriteHost()` di `src/lib/mengantar-host.ts`. Host PRODUKSI
   Mengantar hanya boleh ditulis dari deployment produksi (`NODE_ENV=production` dan bukan preview
   Vercel). SETIAP titik `POST /order` / `POST /time` **wajib** lewat fungsi ini; membaca
   `MENGANTAR_BASE_URL` langsung untuk panggilan tulis = memutar balik penjaganya.
   **Sengaja tanpa jalan pintas** — tuas "izinkan sekali ini" selalu berakhir menyala di tempat
   yang salah. Mau menguji booking? Sandbox di lokal, atau di deployment produksi sungguhan.
2. **Hook blokir** — `.claude/hooks/guard-paid-api.cjs` (terdaftar sebagai `PreToolUse` di
   `.claude/settings.json`). Memblokir perintah shell yang menyentuh endpoint berbayar, **termasuk
   yang disembunyikan di dalam file skrip** (hook ikut membaca isi file yang disebut di perintah).
   Jangan mencari jalan lain untuk melewatinya — mengganti nama file, merangkai perintah, atau
   menyamarkan URL melanggar maksud aturannya.
3. **Kunci produksi tidak disimpan di mesin lokal** — `MENGANTAR_API_KEY` & `XENDIT_SECRET_KEY`
   produksi HANYA di environment variable Vercel, tidak pernah di `.env.local`. Ini lapisan
   terkuat: tanpa kredensial produksi di lokal, tak ada cara menghabiskan uang sungguhan dari sini.

**Lubang yang masih terbuka & sengaja dibiarkan:** `npm run build && npm run start` di mesin lokal
ber-`NODE_ENV=production` tanpa `VERCEL_ENV`, jadi lapis 1 mengizinkannya menulis ke host produksi.
Mengetatkannya sampai mewajibkan `VERCEL_ENV=production` akan membuat booking **gagal senyap** bila
app kelak di-host sendiri (VPS) — pembeli sudah bayar tapi resi tak pernah terbit, jauh lebih buruk.
Lubang ini ditutup oleh lapis 3, bukan oleh kode.

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

