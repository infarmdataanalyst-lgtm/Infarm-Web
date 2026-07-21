# Hasil Pengujian Cache — Baseline (Sebelum Optimasi)

**Tanggal & waktu pengujian:** 21 Juli 2026, 10:35:35 WITA (SEAST / UTC+8)

## Keterangan Lingkungan Pengujian

Pengujian dijalankan terhadap **deployment production di Vercel**
(`https://infarm-web-mu.vercel.app`), sehingga header **`x-vercel-cache` nyata dan terukur**
(HIT / MISS / PRERENDER dari Vercel Edge Network). Endpoint data tetap sama dengan lokal
(Supabase project `wkywgnsgajlyqwkbsmeq`).

> Catatan:
> - **Gambar Supabase Storage** diuji langsung ke URL public Supabase (bukan lewat domain
>   Vercel), jadi header cache-nya berasal dari **Cloudflare** (`CF-Cache-Status`), bukan
>   Vercel. `x-vercel-cache` memang tidak berlaku untuk aset ini.
> - Angka waktu dipengaruhi latensi jaringan dari lokasi uji (Asia Tenggara) ke edge Vercel;
>   dipakai sebagai **acuan relatif baseline**, bukan patokan absolut.

### URL yang diuji

| Halaman | URL |
|---------|-----|
| Beranda | `https://infarm-web-mu.vercel.app/` |
| Detail produk | `https://infarm-web-mu.vercel.app/produk/399424a8-4d02-4689-87ae-dd7ed76f3629` |
| Gambar Storage | `https://wkywgnsgajlyqwkbsmeq.supabase.co/storage/v1/object/public/product-images/products/9cfee029-5b22-4a6b-87fd-802923cd6603.webp` |
| Checkout (kontrol) | `https://infarm-web-mu.vercel.app/checkout` |

> Catatan route: route detail produk sebenarnya **`/produk/[id]`** (Bahasa Indonesia),
> BUKAN `/products/[id]` seperti disebut di instruksi (route itu tidak ada; `/products`
> adalah halaman katalog). ID produk `399424a8-4d02-4689-87ae-dd7ed76f3629` diambil dari
> `GET /api/products/list` (produk OMS real di Supabase).

---

## 1. Halaman Beranda (`/`)

| Request ke- | Time Total | TTFB | Status Cache |
|:-----------:|:----------:|:----:|:------------:|
| 1 | 1.623687s | 1.363087s | MISS |
| 2 | 1.351254s | 1.145700s | MISS |
| 3 | 1.286057s | 1.052850s | MISS |
| 4 | 1.363077s | 1.051781s | MISS |
| 5 | 0.731713s | 0.687345s | MISS |
| 6 | 0.631243s | 0.603078s | MISS |
| 7 | 1.268371s | 1.018505s | MISS |
| 8 | 1.291469s | 1.056290s | MISS |
| 9 | 0.922305s | 0.674269s | MISS |
| 10 | 1.505048s | 1.262559s | MISS |

**Ringkasan (rata-rata request ke-2 s/d ke-10):**
- Rata-rata Time Total: **1.1501s**
- Rata-rata TTFB: **0.9503s**

> **Catatan cache:** `X-Vercel-Cache: MISS` di **semua** request; `Cache-Control: private,
> no-cache, no-store, max-age=0, must-revalidate`. Halaman dirender dinamis tiap request —
> **cache belum aktif**. Kandidat optimasi (Cache Components / PPR).

---

## 2. Halaman Detail Produk (`/produk/399424a8-4d02-4689-87ae-dd7ed76f3629`)

| Request ke- | Time Total | TTFB | Status Cache |
|:-----------:|:----------:|:----:|:------------:|
| 1 | 2.730170s | 2.540195s | MISS |
| 2 | 3.483663s | 3.303274s | MISS |
| 3 | 2.648815s | 2.477626s | MISS |
| 4 | 2.739255s | 2.429309s | MISS |
| 5 | 2.387177s | 1.967636s | MISS |
| 6 | 2.419411s | 2.308751s | MISS |
| 7 | 2.223590s | 1.940624s | MISS |
| 8 | 2.242440s | 1.960148s | MISS |
| 9 | 2.173020s | 2.000237s | MISS |
| 10 | 2.253365s | 2.023725s | MISS |

**Ringkasan (rata-rata request ke-2 s/d ke-10):**
- Rata-rata Time Total: **2.5079s**
- Rata-rata TTFB: **2.2679s**

> **Catatan cache:** `X-Vercel-Cache: MISS` di **semua** request; `private, no-store`.
> Halaman **TERLAMBAT** (~2.5s rata-rata) karena Server Component ini melakukan banyak query
> Supabase berurutan per request (produk, ulasan, rating, combo, semua produk, sales count),
> dan tidak ada cache sama sekali. **Prioritas #1 optimasi cache.**

---

## 3. Gambar Produk — Supabase Storage

| Request ke- | Time Total | TTFB | Status Cache |
|:-----------:|:----------:|:----:|:-----------------------:|
| 1 | 0.990061s | 0.860910s | `CF-Cache-Status: HIT` |
| 2 | 0.554110s | 0.456113s | `CF-Cache-Status: HIT` |
| 3 | 0.256144s | 0.169032s | `CF-Cache-Status: HIT` |
| 4 | 0.328011s | 0.280476s | `CF-Cache-Status: HIT` |
| 5 | 0.391422s | 0.243508s | `CF-Cache-Status: HIT` |
| 6 | 0.238623s | 0.177255s | `CF-Cache-Status: HIT` |
| 7 | 0.321084s | 0.224332s | `CF-Cache-Status: HIT` |
| 8 | 0.193371s | 0.148027s | `CF-Cache-Status: HIT` |
| 9 | 0.271849s | 0.229805s | `CF-Cache-Status: HIT` |
| 10 | 0.230126s | 0.161999s | `CF-Cache-Status: HIT` |

**Ringkasan (rata-rata request ke-2 s/d ke-10):**
- Rata-rata Time Total: **0.3094s**
- Rata-rata TTFB: **0.2323s**

> **Catatan cache:** Cache CDN aktif nyata — `Cache-Control: public, max-age=3600` +
> `CF-Cache-Status: HIT` di SEMUA request (Supabase Storage di belakang Cloudflare).
> `x-vercel-cache` tidak berlaku (bukan aset Vercel). Sudah optimal — bukan target optimasi.

---

## 4. Halaman Checkout (`/checkout`) — Kontrol / Pembanding

| Request ke- | Time Total | TTFB | Status Cache |
|:-----------:|:----------:|:----:|:------------------------:|
| 1 | 0.907820s | 0.907513s | PRERENDER |
| 2 | 0.142813s | 0.140636s | HIT |
| 3 | 0.149252s | 0.146996s | HIT |
| 4 | 0.158021s | 0.156575s | HIT |
| 5 | 0.146316s | 0.142597s | HIT |

**Ringkasan (rata-rata request ke-2 s/d ke-5):**
- Rata-rata Time Total: **0.1491s**
- Rata-rata TTFB: **0.1467s**

> **⚠️ Catatan cache (temuan menarik):** Berbeda dari ekspektasi awal, checkout JUSTRU
> **ter-cache di Vercel** — request pertama `PRERENDER`, sisanya `X-Vercel-Cache: HIT`
> (`Cache-Control: public, max-age=0, must-revalidate`). Waktu turun drastis dari ~0.9s
> (PRERENDER) ke ~0.15s (HIT).
>
> Ini terjadi karena `/checkout` adalah **client component** — shell HTML-nya statis
> (data dinamis dibaca dari cookie di sisi klien), sehingga Vercel bisa memprerender &
> menyajikannya dari cache edge. Yang dinamis (isi keranjang, ongkir) di-hydrate di browser,
> **tidak** memengaruhi cache HTML. Jadi halaman ini bukan kontrol "selalu MISS" seperti
> diasumsikan — melainkan contoh halaman statis yang sudah otomatis di-cache Vercel.

---

## Ringkasan Umum & Halaman ber-status MISS Terus-menerus

| Halaman | Avg Time Total (req 2+) | Avg TTFB (req 2+) | Status cache konsisten |
|---------|:-----------------------:|:-----------------:|------------------------|
| Beranda `/` | 1.1501s | 0.9503s | **MISS** (cache belum aktif) |
| Detail produk | 2.5079s | 2.2679s | **MISS** (cache belum aktif) — TERLAMBAT |
| Gambar Storage | 0.3094s | 0.2323s | HIT (CDN Cloudflare — sudah optimal) |
| Checkout (kontrol) | 0.1491s | 0.1467s | HIT (prerender statis — sudah di-cache Vercel) |

**Halaman yang MISS terus-menerus (indikasi cache belum aktif):**
- **Beranda (`/`)** — `X-Vercel-Cache: MISS` + `private, no-store` di semua request
  (~1.15s rata-rata). Belum ter-cache.
- **Detail produk (`/produk/[id]`)** — `MISS` di semua request, dan **paling lambat**
  (~2.5s rata-rata) karena banyak query Supabase per request. **Prioritas #1 optimasi cache.**

**Halaman yang SUDAH ter-cache (bukan target optimasi):**
- **Gambar Storage** — `CF-Cache-Status: HIT` (Cloudflare, `max-age=3600`).
- **Checkout** — `X-Vercel-Cache: HIT` (prerender statis Vercel). Di luar dugaan sebagai
  "kontrol", halaman ini justru sudah cepat & ter-cache.

**Kesimpulan baseline:** Dua halaman Server Component dinamis — **beranda** dan (terutama)
**detail produk** — belum ter-cache sama sekali (`MISS` konsisten), sedangkan aset gambar
(Cloudflare) dan shell checkout (prerender Vercel) sudah ter-cache. Target optimasi paling
berdampak: **halaman detail produk** (~2.5s → berpotensi turun drastis bila di-cache),
disusul **beranda**. Ukur ulang setelah optimasi untuk membandingkan perubahan `MISS → HIT`.
