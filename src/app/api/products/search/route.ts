// src/app/api/products/search/route.ts
// API pencarian produk untuk autocomplete (kolom pencarian hero beranda).
// Menggantikan pendekatan lama yang mengirim SELURUH produk ke client (payload berat) →
// kini client fetch saran on-type. Cocokkan nama/kategori (case-insensitive) HANYA dari produk
// OMS non-arsip (PURE Supabase, TANPA dummy — selaras katalog & "Produk Terlaris"),
// maksimal MAX_RESULTS. Baca produk OMS dari cache (revalidate 30s).

import { NextResponse } from 'next/server'
import { getCachedProducts } from '@/lib/mock-db/cached-reads'
import type { Product } from '@/types/product'

export const runtime = 'nodejs'

const MAX_RESULTS = 8

// GET ?q=keyword → { products: Product[] } (kartu ringan untuk dropdown saran)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = (searchParams.get('q') || '').trim().toLowerCase()
  if (!q) return NextResponse.json({ products: [] })

  // HANYA produk OMS non-arsip (real dari Supabase, cached). Tanpa dummy.
  const pool: Product[] = (await getCachedProducts())
    .filter((p) => !p.archived)
    .map((p) => ({
      id: p.id,
      name: p.name,
      originalPrice: p.originalPrice,
      promoPrice: p.promoPrice,
      imageUrl: p.imageUrl,
      category: p.category,
      badge: p.badge,
    }))

  // Cocokkan nama atau kategori (termasuk kategori tanpa tanda hubung: "pupuk-nutrisi" → "pupuk nutrisi")
  const products = pool
    .filter((p) => {
      const name = p.name.toLowerCase()
      const cat = p.category.toLowerCase()
      return name.includes(q) || cat.includes(q) || cat.replace(/-/g, ' ').includes(q)
    })
    .slice(0, MAX_RESULTS)

  return NextResponse.json({ products })
}
