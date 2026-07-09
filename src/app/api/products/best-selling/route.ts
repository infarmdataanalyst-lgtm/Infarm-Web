// src/app/api/products/best-selling/route.ts
// API produk terlaris — agregasi unit terjual per produk dari pesanan Lunas.
// Dipakai storefront (mis. section "Produk Terlaris" di beranda).
// Aman publik: hanya mengembalikan productId, name, totalSold, totalRevenue
// (tanpa data pribadi pelanggan). Query Supabase tetap server-only.

import { NextResponse } from 'next/server'
import { getBestSellingProducts } from '@/lib/mock-db/orders'

// createAdminClient butuh runtime Node.js
export const runtime = 'nodejs'

// Data berubah tiap ada order baru → jangan di-cache
export const dynamic = 'force-dynamic'

// Mengembalikan daftar produk terlaris. ?limit=N (default 5, maksimum 20).
// Opsional ?from=&to= (ISO date) untuk memfilter rentang waktu penjualan.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const rawLimit = Number(searchParams.get('limit'))
  // Batasi limit agar tidak bisa diminta jumlah tak wajar
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 20) : 5
  const from = searchParams.get('from') ?? undefined
  const to = searchParams.get('to') ?? undefined

  const products = await getBestSellingProducts({ limit, from, to })
  return NextResponse.json({ products, count: products.length })
}
