// src/app/api/reviews/create/route.ts
// API menulis ulasan baru ke Supabase. Dipanggil POST dari form /review.

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createReview } from '@/lib/mock-db/reviews'
import type { CreateReviewInput } from '@/lib/mock-db/reviews'

export const runtime = 'nodejs'

// Validasi payload di sisi server (jangan percaya input client mentah-mentah)
function isValidPayload(body: unknown): body is CreateReviewInput {
  if (typeof body !== 'object' || body === null) return false
  const b = body as Record<string, unknown>
  return (
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
      { error: 'Data ulasan tidak valid (produk, nama, dan rating 1–5 wajib).' },
      { status: 422 },
    )
  }

  try {
    const id = await createReview(body)
    // Segarkan halaman detail produk agar ulasan baru langsung tampil
    revalidatePath(`/produk/${body.productId}`)
    return NextResponse.json({ success: true, id }, { status: 201 })
  } catch (err) {
    // Penyebab umum: product_id tidak ada di tabel products (pelanggaran foreign key)
    const message = err instanceof Error ? err.message : 'Gagal menyimpan ulasan.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
