// src/app/api/combos/update/route.ts
// API memperbarui paket/combo di Supabase. Dipanggil PATCH dari ComboForm (mode edit).

import { NextResponse } from 'next/server'
import { updateCombo } from '@/lib/mock-db/combos'
import { validateComboInput } from '@/lib/combo-validation'

export const runtime = 'nodejs'

// Memperbarui combo: validasi server lalu replace data + item-nya.
export async function PATCH(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  if (typeof body.id !== 'string') {
    return NextResponse.json({ error: 'id combo wajib ada.' }, { status: 400 })
  }

  const result = validateComboInput(body)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 })
  }

  const combo = await updateCombo(body.id, result.value)
  if (!combo) {
    return NextResponse.json({ error: 'Combo tidak ditemukan.' }, { status: 404 })
  }

  return NextResponse.json({ success: true, combo })
}
