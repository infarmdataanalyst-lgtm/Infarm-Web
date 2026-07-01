// src/app/api/products/create/route.ts
// API menulis produk baru ke mock database.
// Dipanggil POST dari form Upload Produk OMS.

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { saveProduct } from '@/lib/mock-db/products'
import { PRODUCT_CATEGORIES } from '@/lib/data/categories'
import type { CreateProductInput } from '@/types/product'

// 'fs' butuh runtime Node.js (bukan Edge)
export const runtime = 'nodejs'

const VALID_CATEGORIES = PRODUCT_CATEGORIES.map((c) => c.slug)

// Validasi payload di server (jangan percaya input client mentah-mentah)
function isValidPayload(body: unknown): body is CreateProductInput {
  if (typeof body !== 'object' || body === null) return false
  const b = body as Record<string, unknown>
  return (
    typeof b.name === 'string' &&
    b.name.trim().length > 0 &&
    typeof b.sku === 'string' &&
    b.sku.trim().length > 0 &&
    typeof b.category === 'string' &&
    (VALID_CATEGORIES as string[]).includes(b.category) &&
    typeof b.price === 'number' &&
    b.price >= 0 &&
    typeof b.stock === 'number' &&
    b.stock >= 0 &&
    // images opsional: bila ada wajib array string maksimal 9
    (b.images === undefined ||
      (Array.isArray(b.images) &&
        b.images.length <= 9 &&
        b.images.every((s) => typeof s === 'string')))
  )
}

// Menyimpan produk baru dari OMS
export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  if (!isValidPayload(body)) {
    return NextResponse.json(
      { error: 'Data produk tidak lengkap, kategori tidak dikenal, atau tipe data salah.' },
      { status: 422 },
    )
  }

  const saved = await saveProduct(body)

  // Segarkan cache halaman storefront agar produk baru langsung tampil saat navigasi
  revalidatePath('/')
  revalidatePath('/produk')

  return NextResponse.json({ success: true, product: saved }, { status: 201 })
}
