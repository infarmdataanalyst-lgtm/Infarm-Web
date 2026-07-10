// src/app/api/orders/list/route.ts
// API membaca seluruh pesanan dari mock database.
// Dipanggil GET dari Dashboard OMS untuk mengisi tabel pesanan admin.

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/oms-guard'
import { readOrders } from '@/lib/mock-db/orders'

// 'fs' butuh runtime Node.js (bukan Edge)
export const runtime = 'nodejs'

// Selalu baca file terbaru, jangan di-cache (data berubah saat ada checkout baru)
export const dynamic = 'force-dynamic'

// Mengembalikan daftar pesanan terbaru untuk OMS
export async function GET() {
  // Guard: endpoint OMS — mencegah dump PII pesanan tanpa auth (K-2)
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  const orders = await readOrders()
  return NextResponse.json({ orders, count: orders.length })
}
