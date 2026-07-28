// src/app/api/variants/create/route.ts
// API membuat varian produk (dari modal "Kelola Varian" OMS). Validasi server + SKU unik.

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/oms-guard'
import { revalidatePath, revalidateTag } from 'next/cache'
import { createVariant, isVariantSkuTaken } from '@/lib/mock-db/variants'
import { validateName, validateSkuFormat, validatePrice, validateStock } from '@/lib/product-validation'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  const productId = typeof body.productId === 'string' ? body.productId.trim() : ''
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const sku = typeof body.sku === 'string' ? body.sku.trim() : ''
  const price = typeof body.price === 'number' ? body.price : Number(body.price)
  const stock = typeof body.stock === 'number' ? body.stock : Number(body.stock)
  const isDefault = body.isDefault === true

  if (!productId) return NextResponse.json({ error: 'id produk wajib ada.' }, { status: 400 })
  const err = validateName(name) ?? validateSkuFormat(sku) ?? validatePrice(price) ?? validateStock(stock)
  if (err) return NextResponse.json({ error: err }, { status: 422 })

  if (await isVariantSkuTaken(sku)) {
    return NextResponse.json({ error: 'SKU sudah digunakan varian/produk lain.' }, { status: 409 })
  }

  try {
    const variant = await createVariant({ productId, name, sku, price, stock, isDefault })
    revalidateTag('variants', 'max')
    revalidatePath(`/produk/${productId}`)
    return NextResponse.json({ success: true, variant }, { status: 201 })
  } catch (e) {
    if (e instanceof Error && e.message === 'SKU_DUPLICATE') {
      return NextResponse.json({ error: 'SKU sudah digunakan varian/produk lain.' }, { status: 409 })
    }
    console.error('Gagal membuat varian:', e)
    return NextResponse.json({ error: 'Gagal membuat varian. Coba lagi.' }, { status: 500 })
  }
}
