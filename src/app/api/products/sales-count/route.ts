// src/app/api/products/sales-count/route.ts
// API jumlah unit terjual per produk dalam rentang waktu (untuk tabel produk OMS).
// Mengembalikan peta { [productId]: totalSold }. Non-PII (tanpa data pelanggan);
// query Supabase tetap server-only. Filter opsional ?from=&to= (ISO date).

import { NextResponse } from 'next/server'
import { getSalesCountByProduct } from '@/lib/mock-db/orders'

// createAdminClient butuh runtime Node.js
export const runtime = 'nodejs'

// Data berubah tiap ada order baru → jangan di-cache
export const dynamic = 'force-dynamic'

// Mengembalikan { counts: { [productId]: totalSold } } dalam rentang waktu.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from') ?? undefined
  const to = searchParams.get('to') ?? undefined

  const counts = await getSalesCountByProduct({ from, to })
  return NextResponse.json({ counts })
}
