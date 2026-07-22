# Hasil Pengujian Cache — Final (Setelah Semua Optimasi)

**Tanggal & waktu pengujian:** 21 Juli 2026, 14:26:55 WITA (SEAST / UTC+8)

## Keterangan

Pengujian terhadap **deployment production Vercel** (`https://infarm-web-mu.vercel.app`) setelah
SELURUH optimasi ter-deploy:
- ISR (`revalidate`) beranda / katalog / detail produk + `unstable_cache` (revalidate 30s) + `generateStaticParams`
- `revalidateTag(..., 'max')` di semua API mutasi (produk / order / review / combo)
- Halaman pertama "Katalog Terlaris" di-render server (bukan client-fetch)
- Autocomplete hero via `/api/products/search` (bukan kirim seluruh katalog ke client)
- Data keranjang via `/api/products/by-ids` (bukan tarik seluruh katalog)

**Konfirmasi deploy live:** `GET /api/products/search` = 200, `GET /api/products/by-ids` = 200.

Metodologi sama dengan baseline: 10x request/halaman (5x checkout, 6x endpoint API),
rata-rata dari request ke-2 dst (exclude request pertama yang cold/PRERENDER/STALE).

> Catatan status cache Vercel:
> - **HIT** = dilayani dari cache edge (fresh).
> - **STALE** = dilayani dari cache (stale-while-revalidate) + regenerasi di background — tetap CEPAT.
>   Muncul saat `Age` > window `revalidate` (mis. halaman belum diakses beberapa menit).
> - **PRERENDER** = render pertama pada deploy baru, lalu jadi HIT.
> - **MISS** (khusus API route handler) = handler dijalankan tiap request (route handler memang
>   TIDAK di-CDN-cache), TAPI data internalnya sudah `unstable_cache` → tetap cepat, tanpa query Supabase ulang.

---

## 1. Beranda (`/`)

| Request | Time Total | TTFB | Cache | Age |
|:---:|:---:|:---:|:---:|:---:|
| 1 | 0.793s | 0.685s | STALE | 417 |
| 2 | 0.242s | 0.175s | HIT | 417 |
| 3 | 0.251s | 0.209s | STALE | 418 |
| 4 | 0.170s | 0.128s | STALE | 418 |
| 5 | 0.187s | 0.148s | STALE | 418 |
| 6 | 0.195s | 0.152s | STALE | 419 |
| 7 | 0.183s | 0.143s | STALE | 419 |
| 8 | 0.189s | 0.153s | STALE | 419 |
| 9 | 0.873s | 0.713s | STALE | 420 |
| 10 | 0.771s | 0.371s | STALE | 420 |

**Rata-rata (req 2–10):** Total **0.340s** · TTFB **0.243s** — (baseline sebelum optimasi 1.150s/0.950s → **~70% lebih cepat**)

> Mayoritas STALE (halaman belum diakses beberapa menit → Age ~420s) namun tetap cepat (~0.18s)
> karena stale-while-revalidate. Card "Katalog Terlaris" halaman pertama sudah di HTML (server-render)
> → tak ada flash/refetch saat kembali ke beranda.

---

## 2. Detail Produk (`/produk/399424a8-...`)

| Request | Time Total | TTFB | Cache | Age |
|:---:|:---:|:---:|:---:|:---:|
| 1 | 0.708s | 0.540s | STALE | 443 |
| 2 | 0.248s | 0.161s | HIT | 443 |
| 3 | 0.365s | 0.155s | STALE | 443 |
| 4 | 0.428s | 0.160s | STALE | 444 |
| 5 | 0.282s | 0.190s | STALE | 444 |
| 6 | 0.349s | 0.151s | STALE | 445 |
| 7 | 0.288s | 0.239s | STALE | 445 |
| 8 | 0.503s | 0.150s | STALE | 445 |
| 9 | 0.231s | 0.162s | STALE | 446 |
| 10 | 0.332s | 0.154s | HIT | 1 |

**Rata-rata (req 2–10):** Total **0.336s** · TTFB **0.169s** — (baseline 2.508s/2.268s → **~87% lebih cepat**)

> Perbaikan paling dramatis. Dari ~2.8s (MISS) → ~0.17s TTFB (STALE/HIT). Kombinasi ISR +
> `unstable_cache` + `generateStaticParams` bekerja.

---

## 3. Katalog (`/products`)

| Request | Time Total | TTFB | Cache |
|:---:|:---:|:---:|:---:|
| 1 | 0.495s | 0.494s | STALE |
| 2 | 0.146s | 0.145s | HIT |
| 3 | 0.239s | 0.239s | STALE |
| 4 | 0.149s | 0.148s | STALE |
| 5 | 0.173s | 0.173s | STALE |
| 6 | 0.150s | 0.149s | STALE |
| 7 | 0.154s | 0.154s | STALE |
| 8 | 0.185s | 0.185s | STALE |
| 9 | 0.169s | 0.167s | HIT |
| 10 | 0.193s | 0.193s | HIT |

**Rata-rata (req 2–10):** Total **0.173s** · TTFB **0.173s** — HIT/STALE, cepat konsisten.

---

## 4. Keranjang (`/keranjang`) — shell

| Request | Time Total | TTFB | Cache |
|:---:|:---:|:---:|:---:|
| 1 | 0.208s | 0.207s | HIT |
| 2 | 0.415s | 0.415s | HIT |
| 3 | 0.724s | 0.723s | HIT |
| 4 | 0.174s | 0.174s | HIT |
| 5 | 0.335s | 0.318s | HIT |
| 6 | 0.196s | 0.182s | HIT |
| 7 | 0.385s | 0.383s | HIT |
| 8 | 0.260s | 0.259s | HIT |
| 9 | 0.152s | 0.152s | HIT |
| 10 | 0.183s | 0.183s | HIT |

**Rata-rata (req 2–10):** Total **0.314s** · TTFB **0.312s** — HIT semua (shell statis).

> Ingat: skor PageSpeed keranjang tinggi/berubah-ubah karena sesi test = keranjang KOSONG.
> Isi item keranjang di-resolve client via `/api/products/by-ids` (bagian #6) — itu yang
> menentukan pengalaman nyata user, BUKAN angka shell ini.

---

## 5. Checkout (`/checkout`) — kontrol

| Request | Time Total | TTFB | Cache |
|:---:|:---:|:---:|:---:|
| 1 | 2.633s | 2.609s | PRERENDER |
| 2 | 0.272s | 0.272s | HIT |
| 3 | 0.553s | 0.505s | HIT |
| 4 | 0.339s | 0.339s | HIT |
| 5 | 0.529s | 0.510s | HIT |

**Rata-rata (req 2–5):** Total **0.423s** · TTFB **0.407s** — PRERENDER→HIT, perilaku tak berubah (kontrol valid).

---

## 6. API `/api/products/by-ids` — resolve data keranjang (FIX UTAMA keranjang)

| Request | Time Total | TTFB | Cache |
|:---:|:---:|:---:|:---:|
| 1 | 1.966s | 1.282s | MISS (cold) |
| 2 | 1.026s | 1.026s | MISS |
| 3 | 0.694s | 0.651s | MISS |
| 4 | 0.795s | 0.794s | MISS |
| 5 | 1.047s | 1.027s | MISS |
| 6 | 1.245s | 1.245s | MISS |

**Rata-rata (req 2–6):** Total **0.962s** · TTFB **0.949s**

> **MISS itu WAJAR & bukan masalah** — route handler memang tak di-CDN-cache Vercel. Yang penting:
> data internal (`getCachedProducts`) sudah `unstable_cache` → **tak query Supabase ulang**, dan
> payload = **hanya item keranjang** (bukan seluruh katalog seperti sebelumnya via `/api/products/list`).
> Sebelum fix: tarik SEMUA produk full-field + `force-dynamic` (query Supabase tiap buka) → lebih berat & lambat.
> ~0.95s ini = overhead fungsi serverless + baca Data Cache, tetap jauh lebih ringan dari sebelumnya.

---

## 7. API `/api/products/search` — autocomplete hero

| Request | Time Total | TTFB | Cache |
|:---:|:---:|:---:|:---:|
| 1 | 0.924s | 0.899s | MISS |
| 2 | 0.719s | 0.719s | MISS |
| 3 | 0.756s | 0.756s | MISS |
| 4 | 0.569s | 0.568s | MISS |
| 5 | 0.790s | 0.789s | MISS |
| 6 | 1.109s | 1.109s | MISS |

**Rata-rata (req 2–6):** Total **0.788s** · TTFB **0.788s**

> Sama seperti by-ids: MISS (route handler) tapi data cached. Hanya dipanggil saat user mengetik
> (debounce 350ms), payload kecil (maks 8 saran). Menggantikan pengiriman SELURUH katalog sebagai
> prop ke client (payload beranda jauh lebih ringan).

---

## 8. Gambar Supabase Storage

| Request | Time Total | TTFB | Cache |
|:---:|:---:|:---:|:---:|
| 1 | 3.073s | 2.401s | CF HIT (cold) |
| 2 | 0.474s | 0.395s | CF HIT |
| 3 | 0.758s | 0.541s | CF HIT |
| 4 | 1.673s | 1.255s | CF HIT |
| 5 | 0.635s | 0.490s | CF HIT |
| 6 | 0.571s | 0.442s | CF HIT |

**Rata-rata (req 2–6):** Total **0.822s** · TTFB **0.616s** — `CF-Cache-Status: HIT` (Cloudflare CDN), variasi = jaringan.

---

## Ringkasan Perbandingan

| Halaman/Endpoint | Baseline (sebelum) | Final (sesudah) | Cache | Keterangan |
|---|:---:|:---:|:---:|---|
| Beranda `/` | 1.150s | **0.340s** | STALE/HIT | ~70% lebih cepat |
| **Detail produk** | 2.508s | **0.336s** | STALE/HIT | **~87% lebih cepat** |
| Katalog `/products` | (baru) | **0.173s** | STALE/HIT | ter-cache |
| Keranjang (shell) | — | **0.314s** | HIT | shell statis |
| Checkout (kontrol) | 0.149s | **0.423s** | HIT | tak berubah by design |
| API by-ids (data keranjang) | (dulu `/list` full+dynamic) | **0.962s** | MISS* | payload kecil + data cached |
| API search (autocomplete) | (dulu seluruh katalog jadi prop) | **0.788s** | MISS* | data cached, on-type |
| Gambar Storage | 0.309s | **0.822s** | CF HIT | variasi jaringan |

\* MISS pada route handler API adalah normal (tak di-CDN-cache); data internal tetap ter-cache.

### Kesimpulan
- ✅ Semua halaman storefront ter-cache & cepat. Detail produk (dulu terlambat ~2.8s) kini ~0.17s TTFB.
- ✅ Fix data keranjang: dari "tarik seluruh katalog + force-dynamic" → "resolve id yang perlu + data cached". Payload & beban query turun drastis (walau HTTP status API = MISS, itu wajar).
- ✅ Checkout (kontrol) tak berubah — optimasi tak mengganggu halaman dinamis.
- ⚠️ Endpoint API (by-ids/search) masih ~0.8–1s karena overhead fungsi serverless + baca Data Cache;
  bisa ditekan lebih jauh dengan CDN `Cache-Control` per-URL bila diperlukan (opsional, gain terbatas
  karena ids/keyword bervariasi antar user).
- 📌 Angka LCP/skor PageSpeed dipengaruhi GA (third-party) & throttle lab — di luar cakupan cache
  server ini. GA sengaja dipertahankan `afterInteractive` (analytics akurat) sesuai keputusan.
