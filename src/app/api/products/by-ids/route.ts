// src/app/api/products/by-ids/route.ts
// API resolve produk berdasarkan daftar id (dipakai halaman keranjang/checkout untuk mengisi
// detail item: nama, foto, harga, badge). Menggantikan pemakaian /api/products/list yang menarik
// SELURUH katalog hanya untuk me-resolve beberapa item — kini hanya id yang diminta yang dikembalikan.
// Data dibaca dari cache (revalidate 30s + tag products) → cepat & tetap segar saat produk berubah.

import { NextResponse } from 'next/server'
import { getCachedProducts } from '@/lib/mock-db/cached-reads'

export const runtime = 'nodejs'

// GET ?ids=id1,id2,... → { products: StoredProduct[] } (hanya id yang cocok, produk OMS)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const idsParam = (searchParams.get('ids') || '').trim()
  if (!idsParam) return NextResponse.json({ products: [] })

  const ids = new Set(
    idsParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  if (ids.size === 0) return NextResponse.json({ products: [] })

  // Ambil dari cache lalu saring hanya id yang diminta (payload ringan: hanya item terkait).
  const all = await getCachedProducts()
  const products = all.filter((p) => ids.has(p.id))
  return NextResponse.json({ products })
}
