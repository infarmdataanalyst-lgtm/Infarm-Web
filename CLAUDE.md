# Project: Ecommerce & OMS – infarm.id

## Overview
Platform ecommerce dan Order Management System (OMS) untuk infarm.id.
Terdiri dari dua aplikasi yang saling terhubung:

1. **OMS (Back Office)** — sistem input & manajemen produk, order, stok oleh admin
2. **Ecommerce (Storefront)** — tampilan publik yang menampilkan data dari OMS

**Alur data:**
Semua produk dan informasi yang tampil di ecommerce bersumber dari inputan admin melalui OMS.
Ecommerce hanya menyediakan tampilan (storefront) — tidak ada input produk dari sisi publik.

**Status saat ini:**
OMS belum dibangun. Seluruh data produk di ecommerce menggunakan **dummy data hardcode** terlebih dahulu.
Setelah OMS selesai dibangun, dummy data akan diganti dengan data real dari Supabase.

---

## Sistem Belanja: Guest Checkout

- Tidak ada sistem login untuk pelanggan (guest checkout)
- Pelanggan bisa menambahkan produk ke keranjang **tanpa login**
- Data keranjang disimpan di **cookie browser** (bukan database, bukan localStorage)
- Tetap tersedia halaman keranjang (`/keranjang`) untuk review sebelum checkout
- Data yang dikumpulkan saat checkout: nama, alamat, nomor HP, email (untuk keperluan pengiriman & notifikasi)

**Implementasi cookie keranjang:**
- Gunakan `cookies()` dari `next/headers` untuk server-side
- Struktur data cookie: array of `{ productId, quantity, price }`
- Nama cookie: `infarm_cart`
- Jangan simpan data sensitif di cookie (hanya ID produk & quantity)

---

## Tech Stack

- **Framework**: Next.js 16.2.6 (App Router) — bukan Pages Router
- **Language**: TypeScript (strict mode)
- **Frontend**: React 19, Tailwind CSS
- **Backend**: Next.js API Routes + Server Actions
- **Database & Auth**: Supabase (PostgreSQL, Auth, Storage, Edge Functions)
- **Payment Gateway**: Xendit
- **Logistik / Pengiriman**: Mengantar
- **Deployment**: Vercel
- **Version Control**: GitHub
- **Package Manager**: npm

### ⚠️ Breaking Changes Next.js 16 yang Perlu Diperhatikan

- **Middleware dihapus** — gunakan `proxy.ts` di root project, bukan `middleware.ts`
- **Cache Components** — gunakan `use cache` dan PPR, bukan `revalidate` lama
- **Turbopack aktif by default** — tidak perlu flag `--turbo`
- Sebelum menulis kode yang menyentuh routing, caching, atau network boundary: baca dokumentasi di `node_modules/next/dist/docs/` atau tanya dulu

**Jangan tambahkan library berikut tanpa diminta:**
- Redux atau state library global lain (gunakan Zustand atau React Context)
- styled-components, Emotion (gunakan Tailwind CSS)
- Axios (gunakan native `fetch` dengan wrapper di `lib/fetcher.ts`)
- Material UI, Ant Design, Chakra UI

---

## Bash Commands

```bash
npm run dev          # Jalankan dev server Next.js (Turbopack aktif by default)
npm run build        # Build production
npm run start        # Jalankan production server lokal
npm run typecheck    # TypeScript type check
npm run lint         # ESLint
npm run test         # Run tests
```

---

## Project Structure

```
/
├── app/                      # Next.js App Router
│   ├── (store)/              # Route group: halaman publik ecommerce
│   │   ├── page.tsx          # Homepage
│   │   ├── produk/           # Halaman katalog & detail produk
│   │   ├── keranjang/        # Halaman keranjang (data dari cookie)
│   │   └── checkout/         # Halaman guest checkout
│   ├── (admin)/              # Route group: dashboard admin & OMS (belum dibangun)
│   ├── api/                  # API Routes
│   │   └── webhooks/
│   │       ├── xendit/       # Webhook payment
│   │       └── mengantar/    # Webhook pengiriman
│   └── layout.tsx
├── components/
│   ├── home/                 # Komponen homepage
│   ├── product/              # Komponen kartu & detail produk
│   ├── cart/                 # Komponen keranjang
│   └── ui/                   # Komponen UI generik (button, input, dll)
├── lib/
│   ├── supabase/             # Supabase client (server & browser)
│   ├── xendit/               # Xendit SDK wrapper
│   ├── mengantar/            # Mengantar API wrapper
│   ├── cart.ts               # Helper baca/tulis cookie keranjang
│   └── fetcher.ts            # Native fetch wrapper (gunakan ini, bukan Axios)
├── lib/data/
│   └── dummy-products.ts     # Dummy data produk (sementara, diganti Supabase setelah OMS selesai)
├── types/
│   ├── product.ts            # Tipe data produk
│   ├── cart.ts               # Tipe data keranjang & cookie
│   └── supabase.ts           # Generated Supabase types
├── supabase/
│   ├── migrations/           # SQL migrations
│   └── functions/            # Edge Functions
├── proxy.ts                  # Network boundary (pengganti middleware.ts di Next.js 16)
├── docs/                     # Dokumentasi arsitektur & rencana fitur
└── CLAUDE.md
```

---

## Code Style

- Gunakan **ES modules** (`import/export`), bukan CommonJS (`require`)
- Destructure imports: `import { createClient } from '@supabase/supabase-js'`
- **TypeScript strict mode** — hindari `any`, gunakan type eksplisit
- Nama file: `kebab-case.ts`, komponen: `PascalCase.tsx`
- Fungsi & variabel: `camelCase`; konstanta global: `UPPER_SNAKE_CASE`
- Indentasi: 2 spasi
- Gunakan **Server Components** by default; tambahkan `'use client'` hanya jika benar-benar perlu

---

## Komentar Kode

Tulis komentar untuk memudahkan maintenance. Ikuti aturan berikut:

- **Setiap file** — komentar singkat di baris pertama menjelaskan tujuan file
  ```ts
  // lib/cart.ts
  // Helper untuk membaca dan menulis data keranjang dari cookie browser
  ```

- **Setiap fungsi/komponen yang di-export** — jelaskan apa yang dilakukan, bukan bagaimana
  ```ts
  // Menambahkan item ke keranjang dan menyimpannya kembali ke cookie
  export function addToCart(item: CartItem): void {}
  ```

- **Logic yang tidak langsung jelas** — beri komentar kenapa, bukan apa
  ```ts
  // Cookie di-encode ke base64 karena nilai JSON mentah bisa menyebabkan error parsing di beberapa browser
  const encoded = btoa(JSON.stringify(cart))
  ```

- **Setiap section dalam file panjang** — gunakan komentar pemisah
  ```ts
  // === Baca Cookie ===
  // === Tulis Cookie ===
  // === Kalkulasi Total ===
  ```

- **Jangan** tulis komentar redundan yang mengulang nama fungsi
  ```ts
  // JANGAN: Mengambil produk (sudah jelas dari getProduct())
  // BOLEH: Mengambil produk beserta stok real-time dari Supabase
  ```

---

## Data & State

### Produk (saat ini)
- Semua data produk berasal dari `lib/data/dummy-products.ts`
- **Jangan** hubungkan ke Supabase dulu sampai OMS selesai dibangun
- Setiap fungsi yang mengambil data produk harus diberi komentar `// TODO: ganti dengan query Supabase setelah OMS selesai`

### Keranjang (cookie-based)
- Semua operasi keranjang via helper di `lib/cart.ts`
- Cookie name: `infarm_cart`
- Struktur: `CartItem[] = { productId: string, quantity: number, price: number }[]`
- Jangan simpan data user atau data sensitif di cookie keranjang

---

## Supabase Conventions

- Supabase **server client**: `lib/supabase/server.ts`
- Supabase **browser client**: `lib/supabase/browser.ts`
- Row Level Security (RLS) **wajib aktif** di semua tabel
- Semua perubahan skema via **migration file** di `supabase/migrations/`
- Jangan edit schema langsung via dashboard tanpa membuat migration
- Regenerate types setelah migrasi: `supabase gen types typescript --local > types/supabase.ts`

---

## Third-Party API

### Xendit (Payment Gateway)
- Semua logika pembayaran di `lib/xendit/`
- Webhook diterima di `app/api/webhooks/xendit/route.ts`
- Verifikasi webhook signature sebelum memproses event apapun
- **Jangan expose** Xendit secret key di frontend

### Mengantar (Logistik)
- Semua logika pengiriman di `lib/mengantar/`
- Kalkulasi ongkos kirim dan tracking order via API Mengantar

---

## Domain: Ecommerce & OMS

### Ecommerce (Storefront) — dikerjakan sekarang
- [x] Halaman beranda (homepage)
- [ ] Halaman katalog produk (`/produk`)
- [ ] Halaman detail produk (`/produk/[slug]`)
- [ ] Halaman keranjang (`/keranjang`) — data dari cookie
- [ ] Halaman guest checkout (`/checkout`)
- [ ] Integrasi Xendit (pembayaran)
- [ ] Integrasi Mengantar (pengiriman & tracking)

### OMS (Back Office) — dikerjakan setelah storefront selesai
- [ ] Autentikasi admin (Supabase Auth)
- [ ] Dashboard admin
- [ ] Manajemen produk (CRUD, kategori, varian, stok)
- [ ] Manajemen order (status, fulfillment, retur)
- [ ] Manajemen inventori

---

## Git & GitHub Workflow

- Branch naming: `feat/nama-fitur`, `fix/nama-bug`, `chore/nama-task`
- Commit format (Conventional Commits):
  - `feat: tambah halaman keranjang dengan cookie`
  - `fix: perbaiki kalkulasi ongkir Mengantar`
- Jangan push langsung ke `main` — gunakan PR, squash merge

---

## Deployment (Vercel)

- Preview deploy otomatis dari setiap PR; production dari branch `main`
- Environment variables di Vercel dashboard (jangan di-commit)

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY      # server-only
XENDIT_SECRET_KEY              # server-only
XENDIT_WEBHOOK_TOKEN           # server-only
MENGANTAR_API_KEY              # server-only
```

---

## Security Rules

- **Jangan expose** `SUPABASE_SERVICE_ROLE_KEY`, `XENDIT_SECRET_KEY`, atau `MENGANTAR_API_KEY` di frontend
- Semua logic sensitif (pricing, stock update, payment) harus di Server Components, API Routes, atau Edge Functions
- Validasi input di sisi server, bukan hanya frontend
- Verifikasi webhook signature Xendit sebelum memproses event apapun
- Cookie keranjang tidak boleh menyimpan data sensitif — hanya ID produk dan quantity

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

### Tailwind Config

Tambahkan warna custom ini ke `tailwind.config.ts`:
```ts
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

## Flowchart Sistem Ecommerce

Berikut alur lengkap sistem yang harus dijadikan acuan saat membangun fitur:

### Alur Browsing & Keranjang
1. User membuka browser → web mengambil data produk terbaru dari database produk
2. Server menyiapkan tampilan halaman (Server Component)
3. User klik "Tambah ke Keranjang" → backend proses dan **simpan ke cookie** (`infarm_cart`)
4. Tampilan angka keranjang di navbar update (+1) tanpa reload halaman
5. User akses halaman `/keranjang` → backend ambil data produk berdasarkan ID di cookie
6. Halaman keranjang tampilkan total item + kalkulasi total harga

### Alur Checkout & Pembayaran
7. User klik "Checkout" dari halaman keranjang
8. Halaman `/checkout` tampilkan form: Email, No. HP, Alamat, Metode Pembayaran, Logistik
9. User isi form → klik "Order Sekarang"
10. Backend **buat invoice** → hubungi Xendit API untuk generate link pembayaran
11. Xendit kirim balik URL invoice
12. User di-redirect ke halaman pembayaran Xendit
13. User melakukan pembayaran

### Alur Post-Payment (Webhook)
14. Xendit kirim notifikasi ke webhook (`/api/webhooks/xendit`)
15. Backend verifikasi signature → insert ke tabel `orders` + update stok produk
16. Kirim data ke API Mengantar untuk proses booking kurir
17. Mengantar kirim balik no. resi / booking ID resmi
18. Update tabel order dengan no. resi
19. **Hapus cookie keranjang** (`infarm_cart`) → delete cookie `guest_cart`
20. Kirim email otomatis ke user berisi no. pesanan & link pelacakan
21. User kembali ke web → tampil halaman "Pembayaran Sukses"
22. User bisa tracking pesanan via no. resi

### Catatan Implementasi Penting
- Langkah 3: cookie operasi via `lib/cart.ts`
- Langkah 10-12: logika Xendit di `lib/xendit/`, jangan di frontend
- Langkah 14-20: semua terjadi di `app/api/webhooks/xendit/route.ts`
- Langkah 16-17: logika Mengantar di `lib/mengantar/`
- Langkah 19: pastikan cookie dihapus **hanya setelah** webhook dikonfirmasi sukses, bukan setelah redirect