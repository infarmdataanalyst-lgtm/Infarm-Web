// src/lib/cdn-cache.ts
// SATU pintu header cache CDN untuk API publik storefront (GET yang isinya sama untuk semua orang).
// Murni — tanpa I/O, aman diimpor route handler maupun unit test.
//
// ── Masalah yang ditutup ──
// Halaman storefront sudah ter-cache di CDN (ISR: beranda/katalog/detail berstatus HIT/STALE),
// tetapi DATA yang diambil browser di dalam halaman itu tidak: /api/products/list, combos/active,
// promotions/active, best-selling-catalog, by-ids, dan search selalu `x-vercel-cache: MISS`
// (terukur 6 Okt 2026, dua permintaan berturut-turut sama-sama MISS). Akibatnya setiap pengunjung
// yang sekadar melihat katalog atau keranjang menjalankan fungsi server — Function Invocations,
// Fluid CPU, dan Fast Origin Transfer naik lurus mengikuti jumlah pengunjung.
//
// `unstable_cache` di mock-db/cached-reads.ts TIDAK menolong di sini: ia cache DATA di dalam
// fungsi (mengurangi query Supabase), tapi fungsinya tetap dijalankan setiap request. Supaya CDN
// yang menjawab, responsnya harus membawa `s-maxage`.
//
// ── Kenapa 60 detik ──
// Setara dengan revalidate halaman beranda & katalog (60 dtk), jadi isi halaman dan isi datanya
// sama-sama paling lambat semenit tertinggal. stale-while-revalidate 60 dtk: setelah kedaluwarsa,
// pengunjung berikutnya tetap dijawab CDN seketika sementara versi baru diambil di belakang layar.
// Yang tak boleh basi — stok, harga, diskon, kuota promo — DIHITUNG ULANG di server saat pesanan
// dibuat (orders/create), jadi angka keranjang yang tertinggal semenit tak pernah ikut ditagihkan.
//
// `max-age=0` untuk browser: browser selalu bertanya ke CDN (murah, HIT), jadi pembeli yang
// memuat ulang halaman tak pernah terjebak di salinan lokal yang lebih tua dari salinan CDN.
//
// ── Jalur lolos cache: ?fresh=1 ──
// Dua pemanggil MEMBUTUHKAN data detik ini juga dan memakai parameter ini:
//   1. OMS (admin baru mengedit produk lalu daftar dimuat ulang — tak boleh melihat data lama).
//   2. Checkout setelah server menolak karena kuota promo habis (409 PROMO_QUOTA_EXHAUSTED):
//      promo dimuat ulang supaya promo yang habis hilang dari layar. Versi CDN akan menampilkannya
//      lagi dan pembeli tertahan di total yang terus ditolak.
// Parameter ini tidak membuka apa pun yang tidak publik — siapa pun memang bisa melewati cache
// dengan query string acak, karena kunci cache CDN memuat query string.

// Header untuk respons publik yang boleh disimpan CDN.
export const PUBLIC_CDN_CACHE_CONTROL = 'public, max-age=0, s-maxage=60, stale-while-revalidate=60'

// Header untuk permintaan ?fresh=1: jangan disimpan di mana pun.
export const NO_STORE_CACHE_CONTROL = 'private, no-store'

// Nama parameter lolos-cache.
export const FRESH_PARAM = 'fresh'

// Menambahkan `?fresh=1` (atau `&fresh=1`) ke sebuah path API. Dipakai pemanggil yang butuh data
// terbaru: OMS dan muat ulang promo di checkout.
export function freshUrl(path: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}${FRESH_PARAM}=1`
}

// Nilai Cache-Control yang tepat untuk sebuah permintaan GET API publik.
export function publicCacheControl(request: Request): string {
  const fresh = new URL(request.url).searchParams.get(FRESH_PARAM)
  return fresh === '1' ? NO_STORE_CACHE_CONTROL : PUBLIC_CDN_CACHE_CONTROL
}

// Header siap pakai untuk NextResponse.json(body, { headers: publicCacheHeaders(request) }).
//
// HANYA untuk respons SUKSES. Galat (4xx/5xx) jangan diberi header ini — galat sesaat yang
// tersimpan di CDN akan disajikan ke semua pengunjung selama semenit.
export function publicCacheHeaders(request: Request): Record<string, string> {
  return { 'Cache-Control': publicCacheControl(request) }
}
