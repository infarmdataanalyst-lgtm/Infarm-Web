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

Integrasi **Xendit (pembayaran)** dan **Mengantar (logistik)** **belum diimplementasi** — masih roadmap.
Bagian Xendit / Mengantar di bawah adalah **target arsitektur**, bukan kondisi sekarang.
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
- Data yang dikumpulkan saat checkout: nama, alamat, nomor HP, email (untuk keperluan pengiriman & notifikasi)

**Implementasi cookie keranjang (kondisi sekarang):**
- Operasi keranjang dijalankan **sisi-klien** lewat `src/lib/cart-client.ts`
  (`document.cookie`, komponen `'use client'`, reaktif via `useSyncExternalStore`)
- Dua cookie dipakai:
  - `infarm_cart` — isi keranjang
  - `infarm_checkout` — snapshot item terpilih yang dibawa ke halaman `/checkout`
- Nilai cookie di-encode **base64** dari JSON (`btoa`/`atob`) agar aman dari masalah parsing
- Struktur data: array of `{ productId, quantity, price }` (tipe `CartItem` di `src/types/cart.ts`)
- Jangan simpan data sensitif di cookie (hanya ID produk, quantity, price)
- **Rencana:** helper baca keranjang dari Server Component (`cookies()` dari `next/headers`)
  akan ditaruh di `src/lib/cart.ts` — belum dibuat.

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

### Roadmap integrasi (belum terpasang)
- **Auth admin real**: Supabase Auth (client sudah ada, login OMS belum terhubung)
- **Payment Gateway**: Xendit
- **Logistik / Pengiriman**: Mengantar
- **Deployment**: Vercel
- **Version Control**: GitHub

### ⚠️ Breaking Changes Next.js 16 yang Perlu Diperhatikan

- **Wajib baca dulu**: `AGENTS.md` di root + dokumentasi di `node_modules/next/dist/docs/`
  sebelum menyentuh routing, caching, atau network boundary
- **Middleware dihapus** — gunakan `proxy.ts` di root project, bukan `middleware.ts`
  (belum ada di project ini; buat bila perlu network boundary)
- **Cache Components** — gunakan `use cache` dan PPR, bukan `revalidate` lama
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
│   ├── order-cancellation/page.tsx  # Pembatalan pesanan Guest (token-protected)
│   ├── review/                   # Form review produk (+ /submitted)
│   ├── track/page.tsx            # Lacak pesanan
│   ├── oms/                      # OMS / back office
│   │   ├── login/page.tsx
│   │   └── dashboard/            # dashboard, products (+upload), orders, reviews
│   ├── api/                      # Route Handlers (runtime nodejs)
│   │   ├── products/             # create | update | delete | list
│   │   ├── orders/               # create | list | get | cancel (GET+PATCH)
│   │   └── reviews/              # create | list | reply | visibility
│   ├── layout.tsx                # Root layout (font, metadata)
│   └── globals.css               # Tailwind v4 + @config tailwind.config.ts
├── components/
│   ├── home/                     # Homepage (HeroSearchBar, dll)
│   ├── product/                  # Kartu & detail produk
│   ├── cart/                     # Komponen keranjang
│   ├── checkout/                 # Form & modal checkout
│   ├── order-cancellation/       # OrderCancellationView (client)
│   ├── review/                   # Komponen review
│   ├── track/                    # Komponen pelacakan
│   ├── oms/                      # Sidebar, header, chart OMS
│   └── ui/                       # Komponen UI generik (AppBar, dll)
├── lib/
│   ├── cart-client.ts            # Helper keranjang sisi-klien (cookie base64)
│   ├── format.ts                 # Util format (mis. rupiah)
│   ├── order-token.ts            # Token HMAC tautan pembatalan (server-only)
│   ├── supabase/                 # Client Supabase: server.ts (admin/SSR) + browser.ts
│   ├── mock-db/                  # Akses data Supabase: products, orders, reviews (server only)
│   └── data/                     # Dummy data tampilan pelengkap (dummy-*.ts)
├── hooks/                        # use-debounce.ts, dll
└── types/                        # product.ts, cart.ts, order.ts

# Root: next.config.ts, tailwind.config.ts, eslint.config.mjs, postcss.config.mjs,
#       tsconfig.json, AGENTS.md, CLAUDE.md, .env.local (tidak di-commit)
# supabase/: migrations/ (SQL, sumber kebenaran skema) + README.md (cara apply via Dashboard)
```

> Folder berikut **belum ada** dan baru dibuat saat integrasi terkait dikerjakan:
> `src/lib/xendit/`, `src/lib/mengantar/`, `src/app/api/webhooks/`, `proxy.ts`,
> `src/lib/cart.ts`, `src/lib/fetcher.ts`.

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

### Dummy data tampilan (masih dipakai)
- `src/lib/data/dummy-*.ts` masih jadi sumber untuk: katalog dummy yang digabung di storefront,
  detail produk (`dummy-product-details`), serta fallback ringkasan checkout
- Halaman yang me-resolve produk dari cookie (keranjang/checkout) menggabungkan **produk Supabase
  (via API) + dummy** agar produk OMS maupun dummy sama-sama tampil

### Keranjang (cookie-based)
- Semua operasi keranjang via helper di `src/lib/cart-client.ts`
- Cookie: `infarm_cart` (isi keranjang) dan `infarm_checkout` (snapshot ke checkout)
- Struktur: `CartItem[] = { productId: string, quantity: number, price: number }[]`
- Nilai cookie di-encode base64; UI lain disinkronkan lewat custom event
  (`infarm:cart-updated`, dll.)
- Jangan simpan data user atau data sensitif di cookie keranjang

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

## Roadmap Integrasi (target arsitektur — belum diimplementasi)

### Xendit (Payment Gateway)
- Semua logika pembayaran di `src/lib/xendit/`
- Webhook diterima di `src/app/api/webhooks/xendit/route.ts`
- Verifikasi webhook signature sebelum memproses event apapun
- **Jangan expose** Xendit secret key di frontend

### Mengantar (Logistik)
- Semua logika pengiriman di `src/lib/mengantar/`
- Kalkulasi ongkos kirim dan tracking order via API Mengantar

---

## Domain: Ecommerce & OMS

### Ecommerce (Storefront)
- [x] Halaman beranda (homepage) — dengan search bar autocomplete
- [x] Halaman katalog produk (`/products`)
- [x] Halaman detail produk (`/produk/[id]`)
- [x] Halaman keranjang (`/keranjang`) — data dari cookie
- [x] Halaman guest checkout (`/checkout` + `/checkout/success`)
- [x] Halaman review produk (`/review`)
- [x] Halaman lacak pesanan (`/track`)
- [x] Halaman pembatalan pesanan Guest (`/order-cancellation`) — token-protected
- [ ] Integrasi Xendit (pembayaran) — masih UI/mock
- [ ] Integrasi Mengantar (pengiriman & tracking) — masih UI/mock

### OMS (Back Office)
- [x] Halaman login OMS (`/oms/login`) — belum terhubung auth real
- [x] Dashboard OMS (`/oms/dashboard`)
- [x] Manajemen produk (list, upload/create, update, delete) via API + Supabase
- [x] Manajemen order (`/oms/dashboard/orders`)
- [x] Manajemen review (`/oms/dashboard/reviews`) — create/list/reply/visibility
- [ ] Autentikasi admin real (Supabase Auth)
- [ ] Manajemen inventori / stok real (alokasi stok saat checkout)

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
SUPABASE_SERVICE_ROLE_KEY      # server-only (dipakai mock-db via createAdminClient)
ORDER_CANCEL_SECRET            # server-only, opsional (HMAC token pembatalan; ada fallback dev)

# Roadmap (belum dipakai)
XENDIT_SECRET_KEY              # server-only
XENDIT_WEBHOOK_TOKEN           # server-only
MENGANTAR_API_KEY              # server-only
```

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
bagian Xendit/Mengantar masih roadmap (dijalankan dengan mock).

### Alur Browsing & Keranjang
1. User membuka web → data produk diambil via `GET /api/products/list` (Supabase, digabung dummy)
2. Server menyiapkan tampilan halaman (Server Component)
3. User klik "Tambah ke Keranjang" → disimpan ke cookie (`infarm_cart`) via `cart-client.ts`
4. Angka keranjang di navbar update (+1) tanpa reload (custom event)
5. User akses `/keranjang` → render item berdasarkan ID di cookie
6. Halaman keranjang tampilkan total item + kalkulasi total harga

### Alur Checkout & Pembayaran
7. User klik "Checkout" / "Beli Langsung" → item terpilih disimpan ke cookie `infarm_checkout`
   (keduanya WAJIB `setCheckoutItems` agar produk di checkout benar)
8. Halaman `/checkout` tampilkan form: Email, No. HP, Alamat, Metode Pembayaran, Logistik
9. User isi form → klik "Order Sekarang" → order tersimpan ke Supabase (`POST /api/orders/create`)
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
- Langkah 9 & 22: data order via `src/lib/mock-db/orders.ts` (Supabase)
- Langkah 10-12: logika Xendit di `src/lib/xendit/`, jangan di frontend *(roadmap)*
- Langkah 14-20: semua terjadi di `src/app/api/webhooks/xendit/route.ts` *(roadmap)*
- Langkah 16-17: logika Mengantar di `src/lib/mengantar/` *(roadmap)*
- Langkah 19: pastikan cookie dihapus **hanya setelah** webhook dikonfirmasi sukses, bukan setelah redirect
