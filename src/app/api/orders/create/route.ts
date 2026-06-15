// src/app/api/orders/create/route.ts
// API menulis pesanan baru ke mock database.
// Dipanggil POST dari halaman sukses checkout ecommerce (Order Confirmed).

import { NextResponse } from 'next/server'
import { saveOrder } from '@/lib/mock-db/orders'
import type { CreateOrderInput, OrderItem } from '@/types/order'

// 'fs' butuh runtime Node.js (bukan Edge)
export const runtime = 'nodejs'

// Validasi minimal payload di sisi server (jangan percaya input client mentah-mentah)
function isValidPayload(body: unknown): body is CreateOrderInput {
  if (typeof body !== 'object' || body === null) return false
  const b = body as Record<string, unknown>
  return (
    typeof b.orderId === 'string' &&
    typeof b.customerName === 'string' &&
    typeof b.date === 'string' &&
    typeof b.totalAmount === 'number' &&
    Array.isArray(b.items) &&
    b.items.every(
      (item) =>
        typeof (item as OrderItem).productId === 'string' &&
        typeof (item as OrderItem).quantity === 'number',
    )
  )
}

// Menyimpan pesanan baru yang dikirim dari checkout sukses
export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  if (!isValidPayload(body)) {
    return NextResponse.json(
      { error: 'Data pesanan tidak lengkap atau tipe data salah.' },
      { status: 422 },
    )
  }

  const saved = await saveOrder(body)
  return NextResponse.json({ success: true, order: saved }, { status: 201 })
}
