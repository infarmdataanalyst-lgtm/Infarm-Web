// src/app/api/combos/list/route.ts
// API membaca seluruh paket/combo dari Supabase. Dipanggil GET dari daftar combo OMS.

import { NextResponse } from 'next/server'
import { readCombos } from '@/lib/mock-db/combos'

// createAdminClient (Supabase) butuh runtime Node.js
export const runtime = 'nodejs'

// Selalu baca data terbaru (combo bisa berubah saat ada create/edit/delete)
export const dynamic = 'force-dynamic'

// Mengembalikan daftar combo terbaru beserta itemnya
export async function GET() {
  const combos = await readCombos()
  return NextResponse.json({ combos, count: combos.length })
}
