// src/app/api/stock-mutations/list/route.ts
// Riwayat mutasi stok untuk halaman OMS "Riwayat Mutasi" (ADMIN ONLY).
//
// Riwayat stok mengungkap volume penjualan & sebaran gudang → tak boleh publik, sama alasannya
// dengan /api/warehouses/list.

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/oms-guard'
import { readStockMutations } from '@/lib/mock-db/stock-mutations'

export const runtime = 'nodejs'

const DEFAULT_LIMIT = 200
const MAX_LIMIT = 500

// GET ?productId=<uuid>&limit=<n> → daftar mutasi terbaru lebih dulu.
export async function GET(request: Request) {
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  const { searchParams } = new URL(request.url)
  const productId = (searchParams.get('productId') ?? '').trim()
  const rawLimit = Number(searchParams.get('limit'))
  // Batas atas dipatok agar satu request tak menarik seluruh riwayat saat tabelnya membesar.
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.trunc(rawLimit), MAX_LIMIT) : DEFAULT_LIMIT

  const mutations = await readStockMutations({
    ...(productId ? { productId } : {}),
    limit,
  })

  return NextResponse.json({ mutations })
}
