// src/app/api/reviews/reviewable-by-phone/route.ts
// LANGKAH 1 fitur review by no_telepon: cari semua pesanan milik no_telepon, kumpulkan produk yang
// BELUM diulas untuk tiap pesanan (cek order_invoice + product_id di tabel reviews). Pesanan yang
// dibatalkan dikecualikan (tak bisa diulas). Output non-sensitif (foto+nama produk+invoice+nama untuk auto-fill).
//
// Perlindungan: honeypot `website`. TODO(rate-limit): 5/IP/jam (ditunda, seperti track/cancel).

import { NextResponse } from 'next/server'
import { getOrdersByPhone } from '@/lib/mock-db/orders'
import { getReviewedProductIds } from '@/lib/mock-db/reviews'
import { normalizePhone, isValidPhone } from '@/lib/phone'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Satu produk yang bisa diulas (dari sebuah pesanan)
type ReviewableItem = {
  orderInvoice: string
  productId: string
  name: string
  imageUrl: string | null
  customerName: string // untuk auto-fill nama tampilan (bisa diedit user)
}

export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  // Honeypot → balas kosong senyap
  if (typeof body.website === 'string' && body.website.trim().length > 0) {
    return NextResponse.json({ items: [] })
  }

  const rawPhone = typeof body.phone === 'string' ? body.phone : ''
  if (!isValidPhone(rawPhone)) {
    return NextResponse.json(
      { error: 'Nomor telepon tidak valid. Gunakan format 08xxxxxxxxxx.' },
      { status: 400 },
    )
  }

  const phone = normalizePhone(rawPhone)
  const orders = await getOrdersByPhone(phone)

  const items: ReviewableItem[] = []
  for (const order of orders) {
    // Pesanan dibatalkan tak bisa diulas
    if (order.status === 'Dibatalkan') continue

    // Produk yang SUDAH diulas untuk pesanan ini → dilewati
    const reviewed = new Set(await getReviewedProductIds(order.orderId))
    for (const it of order.items) {
      if (reviewed.has(it.productId)) continue
      items.push({
        orderInvoice: order.orderId,
        productId: it.productId,
        name: it.name,
        imageUrl: it.imageUrl ?? null,
        customerName: order.customerName,
      })
    }
  }

  return NextResponse.json({ items })
}
