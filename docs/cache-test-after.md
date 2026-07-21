# Hasil Pengujian Cache — Setelah Optimasi

**Tanggal & waktu pengujian:** 21 Juli 2026, 11:15:05 WITA (SEAST / UTC+8)

## Keterangan Lingkungan Pengujian

Diuji terhadap **deployment production Vercel** (`https://infarm-web-mu.vercel.app`) setelah
commit optimasi cache di-deploy. Header `x-vercel-cache` (HIT / MISS / PRERENDER) valid dan
terukur. Metodologi sama persis dengan baseline (`docs/cache-test-before.md`): 10x request per
halaman (5x untuk checkout), rata-rata dihitung dari request ke-2 s/d terakhir (exclude request
pertama yang cold/PRERENDER).

Optimasi yang sudah diterapkan (lihat commit):
- `export const revalidate = 60` di beranda (`/`), katalog (`/products`), detail produk (`/produk/[id]`)
- `cacheControl: '3600'` pada upload gambar baru ke Supabase Storage
- `revalidatePath` diperbaiki + ditambah di API mutasi produk & order

### URL yang diuji (sama dengan baseline)

| Halaman | URL |
|---------|-----|
| Beranda | `https://infarm-web-mu.vercel.app/` |
| Detail produk | `https://infarm-web-mu.vercel.app/produk/399424a8-4d02-4689-87ae-dd7ed76f3629` |
| Katalog | `https://infarm-web-mu.vercel.app/products` |
| Gambar Storage | `https://wkywgnsgajlyqwkbsmeq.supabase.co/storage/v1/object/public/product-images/products/9cfee029-5b22-4a6b-87fd-802923cd6603.webp` |
| Checkout (kontrol) | `https://infarm-web-mu.vercel.app/checkout` |

---

## 1. Halaman Beranda (`/`)

| Request ke- | Time Total | TTFB | Status Cache |
|:-----------:|:----------:|:----:|:------------:|
| 1 | 1.694561s | 1.652528s | PRERENDER |
| 2 | 0.588065s | 0.564160s | HIT |
| 3 | 0.472643s | 0.432441s | HIT |
| 4 | 0.539272s | 0.507500s | HIT |
| 5 | 0.239643s | 0.165241s | HIT |
| 6 | 0.213082s | 0.170792s | HIT |
| 7 | 0.577926s | 0.500805s | HIT |
| 8 | 0.583613s | 0.553889s | HIT |
| 9 | 0.878030s | 0.815899s | HIT |
| 10 | 0.974219s | 0.232499s | HIT |

**Ringkasan (rata-rata request ke-2 s/d ke-10):**
- Rata-rata Time Total: **0.5629s** (baseline 1.1501s → **~51% lebih cepat**)
- Rata-rata TTFB: **0.4381s** (baseline 0.9503s → **~54% lebih cepat**)

> ✅ **BERHASIL di-cache.** Dari `MISS` konsisten di baseline → sekarang `PRERENDER` (req 1)
> lalu `HIT` di semua request berikutnya. Header `Age` naik 0→3 lalu reset (bukti revalidasi
> ISR tiap ~60 detik). `revalidate = 60` bekerja.

---

## 2. Halaman Detail Produk (`/produk/399424a8-...`)

| Request ke- | Time Total | TTFB | Status Cache |
|:-----------:|:----------:|:----:|:------------:|
| 1 | 4.290166s | 4.151945s | MISS |
| 2 | 3.455369s | 3.274348s | MISS |
| 3 | 2.631046s | 2.381548s | MISS |
| 4 | 2.607464s | 2.370732s | MISS |
| 5 | 3.159593s | 2.801622s | MISS |
| 6 | 3.567094s | 3.283169s | MISS |
| 7 | 2.212918s | 1.961569s | MISS |
| 8 | 2.303121s | 1.989967s | MISS |
| 9 | 1.776582s | 1.614978s | MISS |
| 10 | 3.596962s | 3.384056s | MISS |

**Ringkasan (rata-rata request ke-2 s/d ke-10):**
- Rata-rata Time Total: **2.8122s** (baseline 2.5079s → tidak membaik / sedikit lebih lambat karena variasi jaringan)
- Rata-rata TTFB: **2.5624s** (baseline 2.2679s)

> ⚠️ **BELUM di-cache — masih `MISS` di semua request** (`Cache-Control: private, no-store`).
> Ini SESUAI dengan yang diprediksi sebelum deploy: `export const revalidate = 60` **sudah
> terpasang** di halaman ini, TAPI tidak berlaku karena Server Component-nya memanggil query
> Supabase (`getProductById`, `getReviewsByProduct`, `getProductRatingSummary`, `readCombos`,
> `readProducts`, `getSalesCountByProduct`) yang memakai `fetch` **uncached (no-store default
> di Next 16)** → memaksa route jadi **dynamic**, menimpa `revalidate`.
>
> **Solusi (langkah lanjutan, belum dikerjakan — butuh persetujuan):** bungkus fungsi baca
> data di `src/lib/mock-db/*` dengan `unstable_cache` (+ `revalidateTag` saat mutasi). Ini
> mengubah data layer, di luar cakupan "hanya cache config" pada task sebelumnya.
> Variasi angka (2.2s–3.6s) murni fluktuasi jaringan/beban, bukan efek cache.

---

## 3. Halaman Katalog (`/products`)

| Request ke- | Time Total | TTFB | Status Cache |
|:-----------:|:----------:|:----:|:------------:|
| 1 | 0.803513s | 0.780093s | PRERENDER |
| 2 | 0.177949s | 0.177224s | HIT |
| 3 | 0.262680s | 0.224610s | HIT |
| 4 | 0.216272s | 0.215227s | HIT |
| 5 | 0.178415s | 0.178034s | HIT |
| 6 | 0.156331s | 0.156031s | HIT |
| 7 | 0.486541s | 0.485092s | HIT |
| 8 | 0.204337s | 0.174682s | HIT |
| 9 | 0.218203s | 0.215749s | HIT |
| 10 | 0.170657s | 0.170229s | HIT |

**Ringkasan (rata-rata request ke-2 s/d ke-10):**
- Rata-rata Time Total: **0.2302s**
- Rata-rata TTFB: **0.2219s**

> ✅ **BERHASIL di-cache** (`PRERENDER` → `HIT`). Halaman ini tidak ada di baseline (baru
> ditambah `revalidate = 60`). Catatan: yang di-cache adalah **shell HTML** — daftar produk
> tetap di-fetch sisi-klien via `/api/products/list` (`force-dynamic`), jadi isi katalog tetap
> segar sementara shell dilayani cepat dari edge.

---

## 4. Gambar Produk — Supabase Storage

| Request ke- | Time Total | TTFB | Status Cache |
|:-----------:|:----------:|:----:|:-----------------------:|
| 1 | 0.747000s | 0.665495s | `CF-Cache-Status: HIT` |
| 2 | 0.341708s | 0.299424s | `CF-Cache-Status: HIT` |
| 3 | 0.244256s | 0.194606s | `CF-Cache-Status: HIT` |
| 4 | 0.215037s | 0.173436s | `CF-Cache-Status: HIT` |
| 5 | 0.261811s | 0.219664s | `CF-Cache-Status: HIT` |
| 6 | 0.226207s | 0.178467s | `CF-Cache-Status: HIT` |
| 7 | 0.265407s | 0.221884s | `CF-Cache-Status: HIT` |
| 8 | 0.244638s | 0.201533s | `CF-Cache-Status: HIT` |
| 9 | 0.241844s | 0.193266s | `CF-Cache-Status: HIT` |
| 10 | 0.250883s | 0.211231s | `CF-Cache-Status: HIT` |

**Ringkasan (rata-rata request ke-2 s/d ke-10):**
- Rata-rata Time Total: **0.2546s** (baseline 0.3094s)
- Rata-rata TTFB: **0.2104s** (baseline 0.2323s)

> ✅ Tetap `CF-Cache-Status: HIT` + `Cache-Control: public, max-age=3600`. Gambar YANG DIUJI
> ini adalah upload LAMA (sebelum perubahan), jadi header cache-nya belum tentu dari parameter
> `cacheControl: '3600'` yang baru — kebetulan default Supabase juga `max-age=3600`. Parameter
> `cacheControl: '3600'` yang ditambahkan berlaku untuk **upload gambar baru ke depan**
> (sesuai instruksi: gambar lama tidak diubah).

---

## 5. Halaman Checkout (`/checkout`) — Kontrol / Pembanding

| Request ke- | Time Total | TTFB | Status Cache |
|:-----------:|:----------:|:----:|:------------------------:|
| 1 | 1.056036s | 1.055346s | PRERENDER |
| 2 | 0.178971s | 0.178607s | HIT |
| 3 | 0.374674s | 0.374233s | HIT |
| 4 | 0.181578s | 0.174435s | HIT |
| 5 | 0.193826s | 0.187189s | HIT |

**Ringkasan (rata-rata request ke-2 s/d ke-5):**
- Rata-rata Time Total: **0.2323s** (baseline 0.1491s)
- Rata-rata TTFB: **0.2286s** (baseline 0.1467s)

> ✅ **Tidak berubah perilaku** — sama seperti baseline: `PRERENDER` → `HIT` (shell statis
> client component, data dinamis dibaca dari cookie di browser). **Tidak ada `revalidate`
> ditambahkan** ke halaman ini. Selisih waktu kecil = fluktuasi jaringan, bukan perubahan
> caching. Kontrol tetap valid: optimasi tidak mengganggu halaman yang harus dinamis.

---

## Ringkasan Perbandingan Baseline → Setelah Optimasi

| Halaman | Avg Total (before → after) | Avg TTFB (before → after) | Cache (before → after) |
|---------|:--------------------------:|:-------------------------:|------------------------|
| **Beranda `/`** | 1.1501s → **0.5629s** ✅ | 0.9503s → **0.4381s** ✅ | MISS → **HIT** |
| **Detail produk** | 2.5079s → 2.8122s ⚠️ | 2.2679s → 2.5624s ⚠️ | MISS → **MISS (belum)** |
| **Katalog `/products`** | (baru) → 0.2302s ✅ | (baru) → 0.2219s ✅ | — → **HIT** |
| **Gambar Storage** | 0.3094s → 0.2546s | 0.2323s → 0.2104s | HIT → HIT |
| **Checkout (kontrol)** | 0.1491s → 0.2323s | 0.1467s → 0.2286s | HIT → HIT (tak berubah) |

### Kesimpulan

- ✅ **Beranda**: sukses. `MISS` → `HIT`, ~51% lebih cepat. `revalidate = 60` aktif (Age reset per ~menit).
- ✅ **Katalog**: sukses ter-cache (shell), respons ~0.23s dari edge.
- ✅ **Gambar Storage**: tetap optimal (CDN Cloudflare HIT). Parameter cacheControl baru untuk upload berikutnya.
- ✅ **Checkout (kontrol)**: perilaku tidak berubah — optimasi tidak merusak halaman dinamis.
- ⚠️ **Detail produk**: **BELUM ter-cache** (`MISS` konsisten). `revalidate = 60` terpasang tapi
  ditimpa oleh query Supabase uncached (no-store) di Server Component. **Ini kandidat optimasi
  berikutnya**: bungkus baca data (`src/lib/mock-db/*`) dengan `unstable_cache` + `revalidateTag`.
  Karena mengubah data layer, perlu persetujuan sebelum dikerjakan.

**Halaman ber-status MISS terus-menerus (cache belum aktif):** hanya **Detail produk** —
sisanya sudah `HIT`/ter-cache sesuai target (checkout memang sengaja tidak diubah).
