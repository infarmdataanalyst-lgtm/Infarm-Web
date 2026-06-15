// src/app/api/products/delete/route.ts
// API menghapus produk dari mock database (dari tombol Hapus OMS).
// Memakai POST (bukan DELETE) agar body JSON {id} pasti terkirim di semua klien.

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { deleteProduct } from '@/lib/mock-db/products'

export const runtime = 'nodejs'

// Menghapus produk berdasarkan id
export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  if (typeof body.id !== 'string') {
    return NextResponse.json({ error: 'id produk wajib ada.' }, { status: 400 })
  }

  const deleted = await deleteProduct(body.id)
  if (!deleted) {
    return NextResponse.json({ error: 'Produk tidak ditemukan.' }, { status: 404 })
  }

  // Segarkan cache storefront agar produk yang dihapus hilang dari ecommerce
  revalidatePath('/')
  revalidatePath('/produk')

  return NextResponse.json({ success: true })
}
