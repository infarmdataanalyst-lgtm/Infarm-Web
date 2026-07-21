// src/app/api/reviews/visibility/route.ts
// API menyetel apakah sebuah ulasan tampil di storefront (moderasi OMS).

import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { requireAdmin } from '@/lib/oms-guard'
import { setReviewVisibility } from '@/lib/mock-db/reviews'

export const runtime = 'nodejs'

// Mengubah status tampil/sembunyi sebuah ulasan
export async function POST(request: Request) {
  // Guard: endpoint OMS — wajib sesi admin (K-1)
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  if (typeof body.id !== 'string' || typeof body.visible !== 'boolean') {
    return NextResponse.json(
      { error: 'id ulasan & status visible (boolean) wajib ada.' },
      { status: 400 },
    )
  }

  const ok = await setReviewVisibility(body.id, body.visible)
  if (!ok) {
    return NextResponse.json({ error: 'Gagal mengubah visibilitas ulasan.' }, { status: 500 })
  }

  // Invalidasi cache baca ulasan storefront agar perubahan visibilitas langsung tampil
  revalidateTag('reviews', 'max')

  return NextResponse.json({ success: true })
}
