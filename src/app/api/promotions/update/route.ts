// src/app/api/promotions/update/route.ts
// API memperbarui promo di Supabase. Dipanggil PATCH dari PromotionForm (mode edit).

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/oms-guard'
import { PromotionWriteError, updatePromotion } from '@/lib/mock-db/promotions'
import { validatePromotionInput } from '@/lib/promotion-validation'

export const runtime = 'nodejs'

// Memperbarui promo: validasi server lalu replace datanya.
export async function PATCH(request: Request) {
  // Guard: endpoint OMS — wajib sesi admin (K-1)
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

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

  let promotion
  try {
    promotion = await updatePromotion(body.id, result.value)
  } catch (e) {
    if (e instanceof PromotionWriteError) {
      return NextResponse.json({ error: e.message }, { status: 500 })
    }
    throw e
  }
  if (!promotion) {
    return NextResponse.json({ error: 'Promo tidak ditemukan.' }, { status: 404 })
  }

  return NextResponse.json({ success: true, promotion })
}
