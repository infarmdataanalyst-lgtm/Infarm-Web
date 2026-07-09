// src/components/product/ProductInfo.tsx
// Informasi utama produk: nama, harga jual efektif + harga coret + badge diskon, dan rating.
// Server Component.

import type { ProductDetail } from '@/types/product'
import { formatRupiah } from '@/lib/format'
import StarRating from '@/components/product/StarRating'

// Menampilkan blok informasi utama produk di bawah slider foto.
export default function ProductInfo({ product }: { product: ProductDetail }) {
  const { name, originalPrice, promoPrice, rating, reviewCount } = product

  // Hitung persentase diskon untuk badge (mis. -25%)
  const discountPercent =
    originalPrice > promoPrice
      ? Math.round(((originalPrice - promoPrice) / originalPrice) * 100)
      : 0

  return (
    <section className="bg-white px-4 py-4">
      {/* === Nama produk === */}
      <h1 className="text-base font-medium leading-snug text-zinc-800">{name}</h1>

      {/* === Harga === */}
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {/* Harga jual efektif (promoPrice) — paling menonjol */}
        <span className="text-2xl font-bold text-red-500">{formatRupiah(promoPrice)}</span>
        {/* Harga asli (coret) */}
        {originalPrice > promoPrice && (
          <span className="text-sm text-zinc-400 line-through">{formatRupiah(originalPrice)}</span>
        )}
        {/* Badge persentase diskon */}
        {discountPercent > 0 && (
          <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold text-red-500">
            -{discountPercent}%
          </span>
        )}
      </div>

      {/* === Rating ringkas: bintang + angka rata-rata + jumlah ulasan === */}
      <div className="mt-2 flex items-center gap-2">
        <StarRating rating={rating} size={16} />
        <span className="text-sm font-semibold text-zinc-700">{rating.toFixed(1)}</span>
        <span className="text-sm text-zinc-400">({reviewCount} ulasan)</span>
      </div>
    </section>
  )
}
