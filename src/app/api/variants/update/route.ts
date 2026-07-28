// src/app/api/variants/update/route.ts
// API memperbarui varian produk (modal "Kelola Varian" OMS). Validasi server + SKU unik (excludeId).

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/oms-guard'
import { revalidatePath, revalidateTag } from 'next/cache'
import { updateVariant, isVariantSkuTaken } from '@/lib/mock-db/variants'
import { validateName, validateSkuFormat, validatePrice, validateStock } from '@/lib/product-validation'

export const runtime = 'nodejs'

export async function PATCH(request: Request) {
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  const id = typeof body.id === 'string' ? body.id.trim() : ''
  const productId = typeof body.productId === 'string' ? body.productId.trim() : ''
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const sku = typeof body.sku === 'string' ? body.sku.trim() : ''
  const price = typeof body.price === 'number' ? body.price : Number(body.price)
  const stock = typeof body.stock === 'number' ? body.stock : Number(body.stock)
  const isDefault = body.isDefault === true

  if (!id || !productId) return NextResponse.json({ error: 'id varian/produk wajib ada.' }, { status: 400 })
  const err = validateName(name) ?? validateSkuFormat(sku) ?? validatePrice(price) ?? validateStock(stock)
  if (err) return NextResponse.json({ error: err }, { status: 422 })

  if (await isVariantSkuTaken(sku, id)) {
    return NextResponse.json({ error: 'SKU sudah digunakan varian/produk lain.' }, { status: 409 })
  }

  try {
    const variant = await updateVariant(id, { productId, name, sku, price, stock, isDefault })
    if (!variant) return NextResponse.json({ error: 'Varian tidak ditemukan.' }, { status: 404 })
    revalidateTag('variants', 'max')
    revalidatePath(`/produk/${productId}`)
    return NextResponse.json({ success: true, variant })
  } catch (e) {
    if (e instanceof Error && e.message === 'SKU_DUPLICATE') {
      return NextResponse.json({ error: 'SKU sudah digunakan varian/produk lain.' }, { status: 409 })
    }
    console.error('Gagal memperbarui varian:', e)
    return NextResponse.json({ error: 'Gagal memperbarui varian. Coba lagi.' }, { status: 500 })
  }
}
