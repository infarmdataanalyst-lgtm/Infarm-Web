// src/app/api/products/best-selling-catalog/route.ts
// API katalog terlaris berpaginasi (untuk infinite scroll section beranda).
// Produk OMS non-arsip diurut berdasarkan unit terjual (terbanyak dulu; tie-break
// = terbaru), lalu dipotong per halaman. Hanya kirim field yang dipakai kartu produk
// (tanpa galeri base64) agar payload ringan.

import { NextResponse } from 'next/server'
import { getBestSellingCatalogPage } from '@/lib/mock-db/cached-reads'

export const runtime = 'nodejs'

// GET ?page=0&pageSize=10  → { products, hasMore, page }
// Data dibaca lewat wrapper BER-CACHE (revalidate 30s + tag products/sales) → respons cepat &
// tak lagi query Supabase tiap request. Invalidasi otomatis saat produk/stok berubah (revalidateTag).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const page = Math.max(0, Number(searchParams.get('page')) || 0)
  const pageSize = Math.min(50, Math.max(1, Number(searchParams.get('pageSize')) || 10))

  const result = await getBestSellingCatalogPage(page, pageSize)
  return NextResponse.json(result)
}
