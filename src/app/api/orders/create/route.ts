// src/app/api/orders/create/route.ts
// API menulis pesanan baru ke Supabase (orders + order_items + kurangi stok, atomik via RPC).
// Dipanggil POST dari halaman checkout ecommerce saat "Bayar Sekarang".

import { NextResponse } from 'next/server'
import { saveOrder, OrderStockError } from '@/lib/mock-db/orders'
import type { CreateOrderInput, OrderItem, OrderShippingAddress } from '@/types/order'

// createAdminClient (Supabase) butuh runtime Node.js, bukan Edge
export const runtime = 'nodejs'

// Validasi payload di server (jangan percaya input client mentah-mentah)
function isValidPayload(body: unknown): body is CreateOrderInput {
  if (typeof body !== 'object' || body === null) return false
  const b = body as Record<string, unknown>

  const addr = b.address as Partial<OrderShippingAddress> | undefined
  const addressOk =
    typeof addr === 'object' &&
    addr !== null &&
    typeof addr.shippingAddress === 'string' &&
    typeof addr.destinationId === 'string' &&
    addr.destinationId.length > 0

  const itemsOk =
    Array.isArray(b.items) &&
    b.items.length > 0 &&
    b.items.every(
      (item) =>
        typeof (item as OrderItem).productId === 'string' &&
        typeof (item as OrderItem).quantity === 'number' &&
        (item as OrderItem).quantity >= 1 &&
        typeof (item as OrderItem).price === 'number',
    )

  return (
    typeof b.customerName === 'string' &&
    b.customerName.trim().length > 0 &&
    (b.customerEmail === undefined || typeof b.customerEmail === 'string') &&
    (b.customerPhone === undefined || typeof b.customerPhone === 'string') &&
    typeof b.totalAmount === 'number' &&
    b.totalAmount >= 0 &&
    itemsOk &&
    addressOk
  )
}

// Menyimpan pesanan baru dari checkout
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

  try {
    const saved = await saveOrder(body)
    // invoice dikembalikan agar checkout bisa redirect ke ?invoice=...
    return NextResponse.json({ success: true, invoice: saved.orderId, order: saved }, { status: 201 })
  } catch (e) {
    // Stok tidak cukup → transaksi sudah di-rollback DB; beri tahu buyer produk mana
    if (e instanceof OrderStockError) {
      return NextResponse.json({ error: `Stok produk ${e.productName} tidak mencukupi` }, { status: 409 })
    }
    console.error('Gagal membuat pesanan:', e)
    return NextResponse.json({ error: 'Gagal memproses pesanan. Silakan coba lagi.' }, { status: 500 })
  }
}
