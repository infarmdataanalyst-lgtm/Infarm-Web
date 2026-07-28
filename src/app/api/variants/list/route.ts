// src/app/api/variants/list/route.ts
// API daftar varian sebuah produk (untuk modal "Kelola Varian" OMS). Fresh (bukan cache).

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/oms-guard'
import { getVariantsByProduct } from '@/lib/mock-db/variants'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  const { searchParams } = new URL(request.url)
  const productId = (searchParams.get('productId') || '').trim()
  if (!productId) return NextResponse.json({ variants: [] })

  const variants = await getVariantsByProduct(productId)
  return NextResponse.json({ variants })
}
