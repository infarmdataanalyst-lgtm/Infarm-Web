// src/app/api/reviews/list/route.ts
// API membaca seluruh ulasan (beserta info produk) untuk dashboard OMS.
//
// WAJIB requireAdmin (menutup SEC-015): listReviewsForOms() mengembalikan SELURUH baris tabel
// reviews tanpa filter `visible`, termasuk ulasan yang sudah sengaja disembunyikan moderator dan
// balasan admin yang belum tayang. Tanpa guard, siapa pun tanpa sesi admin bisa membacanya.
// Ini juga menyamakan endpoint ini dengan pola endpoint OMS lain (orders/list, products/*).

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/oms-guard'
import { listReviewsForOms } from '@/lib/mock-db/reviews'

export const runtime = 'nodejs'

// Selalu baca data terbaru, jangan di-cache
export const dynamic = 'force-dynamic'

// Mengembalikan daftar ulasan terbaru untuk OMS
export async function GET() {
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  const reviews = await listReviewsForOms()
  return NextResponse.json({ reviews, count: reviews.length })
}
