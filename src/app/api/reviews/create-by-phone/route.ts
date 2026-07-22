// src/app/api/reviews/create-by-phone/route.ts
// Submit ulasan dari flow review by no_telepon. Verifikasi OTORITATIF di server (query ulang DB):
//  - no_telepon input WAJIB cocok dengan no_telepon pesanan (jangan percaya client),
//  - pesanan tidak dibatalkan,
//  - produk benar bagian dari pesanan.
// Lalu simpan (dedup via order_invoice). Honeypot mencegah bot.

import { NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { createReview, DuplicateReviewError } from '@/lib/mock-db/reviews'
import { getOrderByOrderId } from '@/lib/mock-db/orders'
import { normalizePhone, isValidPhone } from '@/lib/phone'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  // Honeypot → tolak senyap
  if (typeof body.website === 'string' && body.website.trim().length > 0) {
    return NextResponse.json({ error: 'Permintaan tidak valid.' }, { status: 400 })
  }

  const rawPhone = typeof body.phone === 'string' ? body.phone : ''
  const orderInvoice = typeof body.orderInvoice === 'string' ? body.orderInvoice.trim().replace(/^#/, '') : ''
  const productId = typeof body.productId === 'string' ? body.productId.trim() : ''
  const authorName = typeof body.authorName === 'string' ? body.authorName.trim() : ''
  const rating = typeof body.rating === 'number' ? body.rating : 0
  const comment = typeof body.comment === 'string' ? body.comment : ''

  if (!isValidPhone(rawPhone)) {
    return NextResponse.json({ error: 'Nomor telepon tidak valid.' }, { status: 400 })
  }
  if (!orderInvoice || !productId || !authorName || rating < 1 || rating > 5) {
    return NextResponse.json(
      { error: 'Data ulasan tidak lengkap (pesanan, produk, nama, rating 1–5 wajib).' },
      { status: 422 },
    )
  }

  // === Verifikasi otoritatif ke DB ===
  const order = await getOrderByOrderId(orderInvoice)
  if (!order) {
    return NextResponse.json({ error: 'Pesanan tidak ditemukan.' }, { status: 404 })
  }
  // Kepemilikan: no_telepon input harus cocok dengan no_telepon pesanan
  if (normalizePhone(rawPhone) !== normalizePhone(order.customerPhone ?? '')) {
    return NextResponse.json(
      { error: 'Nomor telepon tidak cocok dengan pesanan ini.' },
      { status: 403 },
    )
  }
  if (order.status === 'Dibatalkan') {
    return NextResponse.json(
      { error: 'Pesanan sudah dibatalkan, tidak dapat diberi ulasan.' },
      { status: 409 },
    )
  }
  if (!order.items.some((it) => it.productId === productId)) {
    return NextResponse.json(
      { error: 'Produk ini bukan bagian dari pesanan tersebut.' },
      { status: 422 },
    )
  }

  try {
    const id = await createReview({ productId, authorName, rating, comment, orderInvoice })
    revalidatePath(`/produk/${productId}`)
    revalidateTag('reviews', 'max')
    return NextResponse.json({ success: true, id }, { status: 201 })
  } catch (err) {
    if (err instanceof DuplicateReviewError) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    const message = err instanceof Error ? err.message : 'Gagal menyimpan ulasan.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
