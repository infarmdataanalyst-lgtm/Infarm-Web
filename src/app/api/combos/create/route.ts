// src/app/api/combos/create/route.ts
// API membuat paket/combo baru di Supabase. Dipanggil POST dari ComboForm (mode buat).

import { NextResponse } from 'next/server'
import { createCombo } from '@/lib/mock-db/combos'
import { validateComboInput } from '@/lib/combo-validation'

export const runtime = 'nodejs'

// Menyimpan combo baru setelah validasi server (nama, min 2 produk unik, harga < normal).
export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  const result = validateComboInput(body)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 })
  }

  const combo = await createCombo(result.value)
  return NextResponse.json({ success: true, combo }, { status: 201 })
}
