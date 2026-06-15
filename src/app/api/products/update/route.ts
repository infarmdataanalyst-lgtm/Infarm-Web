// src/app/api/products/update/route.ts
// API memperbarui produk di mock database (dari modal Edit OMS).

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { updateProduct } from '@/lib/mock-db/products'
import { PRODUCT_CATEGORIES } from '@/lib/data/categories'
import type { StoredProduct } from '@/types/product'

export const runtime = 'nodejs'

const VALID_CATEGORIES = PRODUCT_CATEGORIES.map((c) => c.slug) as string[]

// Memperbarui produk berdasarkan id; hanya field yang dikirim yang diubah
export async function PATCH(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  if (typeof body.id !== 'string') {
    return NextResponse.json({ error: 'id produk wajib ada.' }, { status: 400 })
  }

  // Susun patch hanya dari field bertipe benar
  const patch: Partial<Omit<StoredProduct, 'id' | 'createdAt'>> = {}
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim()
  if (typeof body.sku === 'string' && body.sku.trim()) patch.sku = body.sku.trim()
  if (typeof body.category === 'string' && VALID_CATEGORIES.includes(body.category)) {
    patch.category = body.category as StoredProduct['category']
  }
  // Opsi harga sederhana: satu harga jual → originalPrice = promoPrice
  if (typeof body.price === 'number' && body.price >= 0) {
    patch.originalPrice = body.price
    patch.promoPrice = body.price
  }
  if (typeof body.stock === 'number' && body.stock >= 0) patch.stock = body.stock
  if (typeof body.description === 'string') patch.description = body.description
  if (typeof body.archived === 'boolean') patch.archived = body.archived
  if (typeof body.imageUrl === 'string' && body.imageUrl.trim()) patch.imageUrl = body.imageUrl

  const updated = await updateProduct(body.id, patch)
  if (!updated) {
    return NextResponse.json({ error: 'Produk tidak ditemukan.' }, { status: 404 })
  }

  // Segarkan cache storefront agar perubahan langsung tampil di ecommerce
  revalidatePath('/')
  revalidatePath('/produk')

  return NextResponse.json({ success: true, product: updated })
}
