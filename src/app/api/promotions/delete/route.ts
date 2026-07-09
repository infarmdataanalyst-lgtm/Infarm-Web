// src/app/api/promotions/delete/route.ts
// API menghapus promo dari Supabase.
// Memakai POST (bukan DELETE) agar body JSON {id} pasti terkirim di semua klien.

import { NextResponse } from 'next/server'
import { deletePromotion } from '@/lib/mock-db/promotions'

export const runtime = 'nodejs'

// Menghapus promo berdasarkan id
export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  if (typeof body.id !== 'string') {
    return NextResponse.json({ error: 'id promo wajib ada.' }, { status: 400 })
  }

  const deleted = await deletePromotion(body.id)
  if (!deleted) {
    return NextResponse.json({ error: 'Promo tidak ditemukan.' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
