// src/app/api/reviews/list/route.ts
// API membaca seluruh ulasan (beserta info produk) untuk dashboard OMS.

import { NextResponse } from 'next/server'
import { listReviewsForOms } from '@/lib/mock-db/reviews'

export const runtime = 'nodejs'

// Selalu baca data terbaru, jangan di-cache
export const dynamic = 'force-dynamic'

// Mengembalikan daftar ulasan terbaru untuk OMS
export async function GET() {
  const reviews = await listReviewsForOms()
  return NextResponse.json({ reviews, count: reviews.length })
}
