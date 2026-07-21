// src/app/api/products/search/route.ts
// API pencarian produk untuk autocomplete (kolom pencarian hero beranda).
// Menggantikan pendekatan lama yang mengirim SELURUH produk ke client (payload berat) →
// kini client fetch saran on-type. Cocokkan nama/kategori (case-insensitive), OMS didahulukan
// lalu dummy sebagai pelengkap, maksimal MAX_RESULTS. Baca produk OMS dari cache (revalidate 30s).

import { NextResponse } from 'next/server'
import { getCachedProducts } from '@/lib/mock-db/cached-reads'
import { dummyProducts } from '@/lib/data/dummy-products'
import type { Product } from '@/types/product'

export const runtime = 'nodejs'

const MAX_RESULTS = 8

// GET ?q=keyword → { products: Product[] } (kartu ringan untuk dropdown saran)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = (searchParams.get('q') || '').trim().toLowerCase()
  if (!q) return NextResponse.json({ products: [] })

  // OMS non-arsip (real, cached) didahulukan; dummy sebagai pelengkap
  const oms = (await getCachedProducts()).filter((p) => !p.archived)
  const pool: Product[] = [
    ...oms.map((p) => ({
      id: p.id,
      name: p.name,
      originalPrice: p.originalPrice,
      promoPrice: p.promoPrice,
      imageUrl: p.imageUrl,
      category: p.category,
      badge: p.badge,
    })),
    ...dummyProducts,
  ]

  // Cocokkan nama atau kategori (termasuk kategori tanpa tanda hubung: "pupuk-nutrisi" → "pupuk nutrisi")
  const seen = new Set<string>()
  const products = pool
    .filter((p) => {
      if (seen.has(p.id)) return false // dedup bila id sama (OMS menang karena lebih dulu)
      const name = p.name.toLowerCase()
      const cat = p.category.toLowerCase()
      const hit = name.includes(q) || cat.includes(q) || cat.replace(/-/g, ' ').includes(q)
      if (hit) {
        seen.add(p.id)
        return true
      }
      return false
    })
    .slice(0, MAX_RESULTS)

  return NextResponse.json({ products })
}
