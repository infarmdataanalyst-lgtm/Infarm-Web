'use client'

// src/components/product/RecentlyViewed.tsx
// Seksi "Produk yang Pernah Anda Lihat" — grid responsive kartu produk dari localStorage (client-side).
// Baca riwayat real-time, resolve ke produk OMS, filter archived + produk saat ini, min 2 produk.

import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import type { Product, StoredProduct } from '@/types/product'
import { getRecentlyViewedIds } from '@/lib/recently-viewed'
import { formatRupiah } from '@/lib/format'
import { isProductOnSale } from '@/types/product'

export default function RecentlyViewed({
  currentProductId,
  allProducts,
}: {
  currentProductId: string
  allProducts: StoredProduct[]
}) {
  const [viewedIds, setViewedIds] = useState<string[]>([])

  // Baca localStorage sekali saat mount (client-side only)
  useEffect(() => {
    setViewedIds(getRecentlyViewedIds())
  }, [])

  // Resolve product IDs → detail, filter archived + produk saat ini
  const products = useMemo(() => {
    const byId = new Map<string, Product>()
    for (const p of allProducts) {
      if (!p.archived) {
        byId.set(p.id, p)
      }
    }

    return viewedIds
      .filter((id) => id !== currentProductId) // exclude produk saat ini
      .map((id) => byId.get(id))
      .filter((p): p is Product => Boolean(p))
      .slice(0, 4) // limit 4 produk
  }, [viewedIds, allProducts, currentProductId])

  // Min 2 produk → jangan render jika kurang
  if (products.length < 2) return null

  return (
    <section className="bg-white px-4 py-4">
      <h2 className="mb-3 text-lg font-bold text-zinc-800">Produk yang Pernah Anda Lihat</h2>

      {/* Horizontal scroll mobile (2.5 card visible), desktop 4-column grid (no scroll) */}
      <ul className="flex gap-3 overflow-x-auto scrollbar-hide lg:grid lg:grid-cols-4 lg:overflow-x-visible">
        {products.map((product) => (
          <li key={product.id} className="flex-shrink-0 w-[calc(40vw-6px)] lg:w-auto">
            <RecentCard product={product} />
          </li>
        ))}
      </ul>
    </section>
  )
}

// Kartu produk dengan badge promo, harga coret, harga diskon
function RecentCard({ product }: { product: Product }) {
  const { id, name, originalPrice, promoPrice, imageUrl, badge } = product
  const onSale = isProductOnSale(product)

  return (
    <Link
      href={`/produk/${id}`}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-zinc-100 bg-white shadow-sm transition hover:shadow-md"
    >
      <div className="relative aspect-square w-full bg-zinc-50">
        <Image
          src={imageUrl}
          alt={name}
          fill
          unoptimized
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          className="object-cover transition group-hover:scale-[1.02]"
        />
        {badge && (
          <span className="absolute left-0 top-2 rounded-r-md bg-red-500 px-2 py-1 text-xs font-semibold text-white shadow">
            + {badge}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-2.5">
        <h3 className="line-clamp-2 text-sm leading-snug text-zinc-800">{name}</h3>
        <div className="mt-auto pt-2">
          {onSale && (
            <p className="text-xs text-zinc-400 line-through">{formatRupiah(originalPrice)}</p>
          )}
          <p className="text-base font-bold text-brand-primary">{formatRupiah(promoPrice)}</p>
        </div>
      </div>
    </Link>
  )
}
