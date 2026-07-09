// src/app/api/promotions/list/route.ts
// API membaca seluruh promo dari Supabase. Dipanggil GET dari daftar promo OMS.

import { NextResponse } from 'next/server'
import { readPromotions } from '@/lib/mock-db/promotions'

// createAdminClient (Supabase) butuh runtime Node.js
export const runtime = 'nodejs'

// Selalu baca data terbaru (promo bisa berubah saat ada create/edit/delete)
export const dynamic = 'force-dynamic'

// Mengembalikan daftar promo terbaru
export async function GET() {
  const promotions = await readPromotions()
  return NextResponse.json({ promotions, count: promotions.length })
}
