// src/app/api/orders/list/route.ts
// API membaca pesanan dari mock database dengan support filter & sorting server-side.
// Dipanggil GET dari Dashboard OMS untuk mengisi tabel pesanan admin.
// Query params: dari, sampai, kurir, pembayaran, sortBy, order

import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/oms-guard'
import {
  readOrders,
  readOrdersFiltered,
  getDistinctCouriers,
  type OrderFilterOptions,
} from '@/lib/mock-db/orders'
import type { OrderPaymentStatus } from '@/types/order'

// Validasi format tanggal ISO (YYYY-MM-DD)
function validateDate(dateStr: string | null | undefined): string | undefined {
  if (!dateStr) return undefined
  const regex = /^\d{4}-\d{2}-\d{2}$/
  return regex.test(dateStr) ? dateStr : undefined
}

// 'fs' butuh runtime Node.js (bukan Edge)
export const runtime = 'nodejs'

// Selalu baca file terbaru, jangan di-cache (data berubah saat ada checkout baru)
export const dynamic = 'force-dynamic'

// Mengembalikan daftar pesanan (dengan filter & sorting optional) untuk OMS
export async function GET(request: NextRequest) {
  // Guard: endpoint OMS — mencegah dump PII pesanan tanpa auth (K-2)
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  // Parse query parameters
  const { searchParams } = new URL(request.url)
  const dari = validateDate(searchParams.get('dari'))
  const sampai = validateDate(searchParams.get('sampai'))
  const kurir = searchParams.get('kurir') || undefined
  const pembayaran = (searchParams.get('pembayaran') as OrderPaymentStatus | null) || undefined
  const sortBy = (searchParams.get('sortBy') as 'total' | 'tanggal' | null) || undefined
  const order = (searchParams.get('order') as 'asc' | 'desc' | null) || undefined

  // Validasi: jika kedua tanggal ada, pastikan dari <= sampai
  if (dari && sampai && dari > sampai) {
    return NextResponse.json(
      { error: 'Tanggal dari harus kurang dari atau sama dengan tanggal sampai' },
      { status: 400 },
    )
  }

  // Build filter options
  const filterOpts: OrderFilterOptions = {
    dari,
    sampai,
    kurir,
    pembayaran,
    sortBy,
    order,
  }

  // Fetch pesanan dengan filter (atau tanpa filter jika semua null)
  const hasFilters = Object.values(filterOpts).some((v) => v !== undefined)
  const orders = hasFilters ? await readOrdersFiltered(filterOpts) : await readOrders()

  // Ambil daftar kurir unik untuk dropdown filter di UI
  const couriers = await getDistinctCouriers()

  return NextResponse.json({ orders, count: orders.length, couriers })
}
