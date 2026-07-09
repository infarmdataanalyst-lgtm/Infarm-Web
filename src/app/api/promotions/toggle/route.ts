// src/app/api/promotions/toggle/route.ts
// API mengaktifkan / menonaktifkan promo (kolom is_active). Dipanggil PATCH dari daftar promo OMS.

import { NextResponse } from 'next/server'
import { setPromotionActive } from '@/lib/mock-db/promotions'

export const runtime = 'nodejs'

// Mengubah status aktif sebuah promo
export async function PATCH(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  if (typeof body.id !== 'string' || typeof body.isActive !== 'boolean') {
    return NextResponse.json(
      { error: 'id promo dan isActive (boolean) wajib ada.' },
      { status: 400 },
    )
  }

  const promotion = await setPromotionActive(body.id, body.isActive)
  if (!promotion) {
    return NextResponse.json({ error: 'Promo tidak ditemukan.' }, { status: 404 })
  }

  return NextResponse.json({ success: true, promotion })
}
