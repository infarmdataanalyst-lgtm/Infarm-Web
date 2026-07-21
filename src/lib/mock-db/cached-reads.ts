// src/lib/mock-db/cached-reads.ts
// Pembungkus baca data BER-CACHE khusus untuk STOREFRONT (halaman publik yang di-render server,
// mis. detail produk /produk/[id]). Memakai unstable_cache Next.js: hasil query Supabase disimpan
// & di-revalidasi tiap 30 detik, ATAU langsung saat mutasi memanggil revalidateTag(tag terkait).
//
// KENAPA terpisah dari fungsi dasar di products.ts/reviews.ts/combos.ts/orders.ts:
// - Fungsi dasar dipakai juga oleh API OMS & pembuatan order yang WAJIB baca data FRESH
//   (mis. validasi stok/harga otoritatif). Membungkus fungsi dasar langsung akan membuat
//   jalur itu ikut ter-cache (berbahaya). Jadi hanya storefront yang memakai wrapper ini.
// - Tanpa cache ini, query Supabase = fetch no-store → memaksa halaman detail jadi dynamic
//   (mengabaikan `export const revalidate`). Dengan cache ini, halaman kembali bisa ISR.
//
// TAG revalidasi (dipanggil dari API mutasi via revalidateTag):
//   'products' → create/update/delete produk, order create/cancel (stok berubah)
//   'reviews'  → review create/reply/visibility
//   'combos'   → combo create/update/delete/toggle
//   'sales'    → order create/cancel (jumlah terjual berubah)

import { unstable_cache } from 'next/cache'
import { readProducts, getProductById } from './products'
import { getReviewsByProduct, getProductRatingSummary } from './reviews'
import { readCombos } from './combos'
import { getSalesCountByProduct } from './orders'

// Durasi cache storefront (detik). Data e-commerce tak berubah tiap detik; 30s cukup segar.
const REVALIDATE = 30

// Seluruh produk (untuk peta stok/gambar combo & "dilihat sebelumnya" di detail produk).
export const getCachedProducts = unstable_cache(readProducts, ['storefront-products'], {
  revalidate: REVALIDATE,
  tags: ['products'],
})

// Combo aktif (rekomendasi paket di detail produk).
export const getCachedCombos = unstable_cache(readCombos, ['storefront-combos'], {
  revalidate: REVALIDATE,
  tags: ['combos'],
})

// Peta jumlah terjual per produk ("N terjual" di detail produk).
export const getCachedSalesCountByProduct = unstable_cache(
  () => getSalesCountByProduct(),
  ['storefront-sales'],
  { revalidate: REVALIDATE, tags: ['sales'] },
)

// Satu produk berdasarkan id. keyParts menyertakan id agar tiap produk punya entri cache sendiri.
export function getCachedProductById(id: string) {
  return unstable_cache(() => getProductById(id), ['storefront-product', id], {
    revalidate: REVALIDATE,
    tags: ['products'],
  })()
}

// Ulasan tampil untuk satu produk.
export function getCachedReviewsByProduct(id: string) {
  return unstable_cache(() => getReviewsByProduct(id), ['storefront-reviews', id], {
    revalidate: REVALIDATE,
    tags: ['reviews'],
  })()
}

// Ringkasan rating (skor + jumlah) untuk satu produk.
export function getCachedRatingSummary(id: string) {
  return unstable_cache(() => getProductRatingSummary(id), ['storefront-rating', id], {
    revalidate: REVALIDATE,
    tags: ['reviews'],
  })()
}
