// src/app/api/promotions/create/route.ts
// API membuat promo baru di Supabase. Dipanggil POST dari PromotionForm (mode buat).

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/oms-guard'
import { createPromotion } from '@/lib/mock-db/promotions'
import { validatePromotionInput } from '@/lib/promotion-validation'

export const runtime = 'nodejs'

// Menyimpan promo baru setelah validasi server.
export async function POST(request: Request) {
  // Guard: endpoint OMS — wajib sesi admin (K-1)
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  const result = validatePromotionInput(body)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 })
  }

  const promotion = await createPromotion(result.value)
  return NextResponse.json({ success: true, promotion }, { status: 201 })
}
