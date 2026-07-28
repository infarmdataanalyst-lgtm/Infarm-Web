// src/app/api/variants/summary/route.ts
// API ringkasan varian per produk (jumlah, total stok, rentang harga) untuk tampilan list produk OMS.

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/oms-guard'
import { getVariantSummaries } from '@/lib/mock-db/variants'

export const runtime = 'nodejs'

export async function GET() {
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  const map = await getVariantSummaries()
  // Map → object agar mudah dikonsumsi client
  const summaries = Object.fromEntries(map)
  return NextResponse.json({ summaries })
}
