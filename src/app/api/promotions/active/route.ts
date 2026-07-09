// src/app/api/promotions/active/route.ts
// API publik (storefront): daftar promo yang AKTIF & belum kedaluwarsa, untuk halaman keranjang.
// Filter dilakukan di server (query Supabase tetap server-only via mock-db) sehingga promo
// nonaktif/kedaluwarsa tidak ikut terkirim ke client. Diurutkan dari minimal pembelian terkecil.

import { NextResponse } from 'next/server'
import { readPromotions } from '@/lib/mock-db/promotions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic' // selalu pakai data promo terbaru

export async function GET() {
  const now = Date.now()
  const promotions = (await readPromotions())
    .filter((p) => {
      if (!p.isActive) return false
      // start_at null ATAU sudah lewat; end_at null ATAU belum lewat
      if (p.startAt && new Date(p.startAt).getTime() > now) return false
      if (p.endAt && new Date(p.endAt).getTime() < now) return false
      return true
    })
    .sort((a, b) => a.minPurchase - b.minPurchase)

  return NextResponse.json({ promotions })
}
