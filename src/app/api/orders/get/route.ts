// src/app/api/orders/get/route.ts
// API membaca satu pesanan berdasarkan ?orderId=... (dipakai form /review).
// Hanya mengembalikan field yang dibutuhkan form ulasan (bukan seluruh data pesanan).

import { NextResponse } from 'next/server'
import { getOrderByOrderId } from '@/lib/mock-db/orders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Mengembalikan { order: { orderId, customerName, items } } untuk nomor pesanan tertentu
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const orderId = searchParams.get('orderId')

  if (!orderId) {
    return NextResponse.json({ error: 'Parameter orderId wajib ada.' }, { status: 400 })
  }

  // Buang '#' di depan bila ada (label invoice memakai "#INF-...")
  const order = await getOrderByOrderId(orderId.replace(/^#/, ''))
  if (!order) {
    return NextResponse.json({ error: 'Pesanan tidak ditemukan.' }, { status: 404 })
  }

  return NextResponse.json({
    order: {
      orderId: order.orderId,
      customerName: order.customerName,
      items: order.items,
    },
  })
}
