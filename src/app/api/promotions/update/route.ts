// src/app/api/promotions/update/route.ts
// API memperbarui promo di Supabase. Dipanggil PATCH dari PromotionForm (mode edit).

import { NextResponse } from 'next/server'
import { updatePromotion } from '@/lib/mock-db/promotions'
import { validatePromotionInput } from '@/lib/promotion-validation'

export const runtime = 'nodejs'

// Memperbarui promo: validasi server lalu replace datanya.
export async function PATCH(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  if (typeof body.id !== 'string') {
    return NextResponse.json({ error: 'id promo wajib ada.' }, { status: 400 })
  }

  const result = validatePromotionInput(body)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 })
  }

  const promotion = await updatePromotion(body.id, result.value)
  if (!promotion) {
    return NextResponse.json({ error: 'Promo tidak ditemukan.' }, { status: 404 })
  }

  return NextResponse.json({ success: true, promotion })
}
