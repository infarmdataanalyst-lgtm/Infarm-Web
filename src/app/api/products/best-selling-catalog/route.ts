// src/app/api/products/best-selling-catalog/route.ts
// API katalog terlaris berpaginasi (untuk infinite scroll section beranda).
// Produk OMS non-arsip diurut berdasarkan unit terjual (terbanyak dulu; tie-break
// = terbaru), lalu dipotong per halaman. Hanya kirim field yang dipakai kartu produk
// (tanpa galeri base64) agar payload ringan.

import { NextResponse } from 'next/server'
import { readProducts } from '@/lib/mock-db/products'
import { getSalesCountByProduct } from '@/lib/mock-db/orders'
import type { Product } from '@/types/product'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET ?page=0&pageSize=10  → { products, hasMore, page }
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const page = Math.max(0, Number(searchParams.get('page')) || 0)
  const pageSize = Math.min(50, Math.max(1, Number(searchParams.get('pageSize')) || 10))

  // Semua produk non-arsip (readProducts sudah urut created_at desc → jadi tie-break stabil)
  const all = (await readProducts()).filter((p) => !p.archived)
  const sold = await getSalesCountByProduct()

  // Urut penjualan terbanyak dulu; produk tanpa penjualan ikut urutan asal (terbaru)
  const sorted = all
    .map((p, index) => ({ p, index, s: sold[p.id] ?? 0 }))
    .sort((a, b) => b.s - a.s || a.index - b.index)
    .map((x) => x.p)

  const start = page * pageSize
  const slice = sorted.slice(start, start + pageSize)

  // Kirim hanya field kartu produk (buang images base64, stock, dll)
  const products: Product[] = slice.map((p) => ({
    id: p.id,
    name: p.name,
    originalPrice: p.originalPrice,
    promoPrice: p.promoPrice,
    imageUrl: p.imageUrl,
    category: p.category,
    badge: p.badge,
  }))

  const hasMore = start + pageSize < sorted.length
  return NextResponse.json({ products, hasMore, page })
}
