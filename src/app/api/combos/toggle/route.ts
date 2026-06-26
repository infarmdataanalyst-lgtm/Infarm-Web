// src/app/api/combos/toggle/route.ts
// API mengaktifkan / menonaktifkan combo (kolom is_active). Dipanggil PATCH dari daftar combo OMS.

import { NextResponse } from 'next/server'
import { setComboActive } from '@/lib/mock-db/combos'

export const runtime = 'nodejs'

// Mengubah status aktif sebuah combo
export async function PATCH(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  if (typeof body.id !== 'string' || typeof body.isActive !== 'boolean') {
    return NextResponse.json(
      { error: 'id combo dan isActive (boolean) wajib ada.' },
      { status: 400 },
    )
  }

  const combo = await setComboActive(body.id, body.isActive)
  if (!combo) {
    return NextResponse.json({ error: 'Combo tidak ditemukan.' }, { status: 404 })
  }

  return NextResponse.json({ success: true, combo })
}
