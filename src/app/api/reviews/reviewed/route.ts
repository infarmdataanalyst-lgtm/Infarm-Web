// src/app/api/reviews/reviewed/route.ts
// API: daftar product_id yang SUDAH diulas untuk sebuah pesanan (?orderId=...).
// Dipakai form /review agar produk yang sudah diulas tidak ditawarkan lagi.

import { NextResponse } from 'next/server'
import { getReviewedProductIds } from '@/lib/mock-db/reviews'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const orderId = searchParams.get('orderId')
  if (!orderId) {
    return NextResponse.json({ error: 'Parameter orderId wajib ada.' }, { status: 400 })
  }
  const reviewedProductIds = await getReviewedProductIds(orderId.replace(/^#/, ''))
  return NextResponse.json({ reviewedProductIds })
}
