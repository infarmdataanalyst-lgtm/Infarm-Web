// src/app/api/promotions/delete/route.ts
// API menghapus promo dari Supabase.
// Memakai POST (bukan DELETE) agar body JSON {id} pasti terkirim di semua klien.

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/oms-guard'
import { deletePromotion, getPromotionById } from '@/lib/mock-db/promotions'
import { logAdminActivity } from '@/lib/admin-activity'

export const runtime = 'nodejs'

// Menghapus promo berdasarkan id
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

  if (typeof body.id !== 'string') {
    return NextResponse.json({ error: 'id promo wajib ada.' }, { status: 400 })
  }

  // Dibaca sebelum dihapus — untuk nama promo di log aktivitas.
  const before = await getPromotionById(body.id)

  const deleted = await deletePromotion(body.id)
  if (!deleted) {
    return NextResponse.json({ error: 'Promo tidak ditemukan.' }, { status: 404 })
  }

  await logAdminActivity({
    action: 'promotion.delete',
    entityType: 'promotion',
    entityId: body.id,
    entityLabel: before?.name ?? null,
    details: before ? { type: before.type, isActive: before.isActive } : {},
  })

  return NextResponse.json({ success: true })
}
