// src/app/api/combos/delete/route.ts
// API menghapus paket/combo dari Supabase (item ikut terhapus via cascade).
// Memakai POST (bukan DELETE) agar body JSON {id} pasti terkirim di semua klien.

import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { requireAdmin } from '@/lib/oms-guard'
import { deleteCombo } from '@/lib/mock-db/combos'

export const runtime = 'nodejs'

// Menghapus combo berdasarkan id
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
    return NextResponse.json({ error: 'id combo wajib ada.' }, { status: 400 })
  }

  const deleted = await deleteCombo(body.id)
  if (!deleted) {
    return NextResponse.json({ error: 'Combo tidak ditemukan.' }, { status: 404 })
  }

  // Invalidasi cache combo storefront
  revalidateTag('combos', 'max')
  return NextResponse.json({ success: true })
}
