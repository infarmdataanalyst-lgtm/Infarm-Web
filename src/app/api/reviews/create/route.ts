// src/app/api/reviews/create/route.ts
// API menulis ulasan baru ke Supabase. Dipanggil POST dari form /review.

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createReview, DuplicateReviewError } from '@/lib/mock-db/reviews'
import type { CreateReviewInput } from '@/lib/mock-db/reviews'
import { getOrderByOrderId } from '@/lib/mock-db/orders'

export const runtime = 'nodejs'

// Payload review + orderId (wajib): review harus terikat ke pesanan asli agar statusnya
// bisa diverifikasi di server (mis. tolak pesanan yang sudah dibatalkan).
type CreateReviewPayload = CreateReviewInput & { orderId: string }

// Validasi payload di sisi server (jangan percaya input client mentah-mentah)
function isValidPayload(body: unknown): body is CreateReviewPayload {
  if (typeof body !== 'object' || body === null) return false
  const b = body as Record<string, unknown>
  return (
    typeof b.orderId === 'string' &&
    b.orderId.trim().length > 0 &&
    typeof b.productId === 'string' &&
    b.productId.trim().length > 0 &&
    typeof b.authorName === 'string' &&
    b.authorName.trim().length > 0 &&
    typeof b.rating === 'number' &&
    b.rating >= 1 &&
    b.rating <= 5 &&
    // Komentar boleh kosong (pelanggan boleh hanya memberi rating)
    typeof b.comment === 'string'
  )
}

// Menyimpan ulasan baru dari pelanggan
export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  if (!isValidPayload(body)) {
    return NextResponse.json(
      { error: 'Data ulasan tidak valid (pesanan, produk, nama, dan rating 1–5 wajib).' },
      { status: 422 },
    )
  }

  // === Verifikasi pesanan di server (otoritatif) ===
  // Ambil pesanan asli lalu tolak bila: tidak ada, sudah dibatalkan, atau produk yang
  // diulas bukan bagian dari pesanan tsb. Cegah ulasan pesanan batal / produk yang tak dibeli.
  const invoice = body.orderId.replace(/^#/, '')
  const order = await getOrderByOrderId(invoice)
  if (!order) {
    return NextResponse.json({ error: 'Pesanan tidak ditemukan.' }, { status: 404 })
  }
  if (order.status === 'Dibatalkan') {
    return NextResponse.json(
      { error: 'Pesanan sudah dibatalkan, tidak dapat diberi ulasan.' },
      { status: 409 },
    )
  }
  if (!order.items.some((it) => it.productId === body.productId)) {
    return NextResponse.json(
      { error: 'Produk ini bukan bagian dari pesanan tersebut.' },
      { status: 422 },
    )
  }

  try {
    const id = await createReview({ ...body, orderInvoice: invoice })
    // Segarkan halaman detail produk agar ulasan baru langsung tampil
    revalidatePath(`/produk/${body.productId}`)
    return NextResponse.json({ success: true, id }, { status: 201 })
  } catch (err) {
    // Produk pada pesanan ini sudah pernah diulas → tolak duplikat
    if (err instanceof DuplicateReviewError) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    // Penyebab umum lain: product_id tidak ada di tabel products (pelanggaran foreign key)
    const message = err instanceof Error ? err.message : 'Gagal menyimpan ulasan.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
