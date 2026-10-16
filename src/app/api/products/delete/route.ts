// src/app/api/products/delete/route.ts
// API menghapus produk dari mock database (dari tombol Hapus OMS).
// Memakai POST (bukan DELETE) agar body JSON {id} pasti terkirim di semua klien.

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/oms-guard'
import { revalidatePath, revalidateTag } from 'next/cache'
import { deleteProduct, getProductById, PRODUCT_IN_USE_MESSAGE } from '@/lib/mock-db/products'
import { logAdminActivity } from '@/lib/admin-activity'

export const runtime = 'nodejs'

// Menghapus produk berdasarkan id
export async function POST(request: Request) {
  // Guard: endpoint OMS — wajib sesi admin (K-1)
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  if (typeof body.id !== 'string') {
    return NextResponse.json({ error: 'id produk wajib ada.' }, { status: 400 })
  }

  // Dibaca sebelum dihapus — setelahnya nama & SKU tak bisa diambil lagi untuk log.
  const before = await getProductById(body.id)

  const result = await deleteProduct(body.id)
  if (result === 'in-use') {
    return NextResponse.json({ error: PRODUCT_IN_USE_MESSAGE, code: 'PRODUCT_IN_USE' }, { status: 409 })
  }
  if (result === 'not-found') {
    return NextResponse.json({ error: 'Produk tidak ditemukan.' }, { status: 404 })
  }
  if (result === 'error') {
    return NextResponse.json({ error: 'Gagal menghapus produk. Coba lagi.' }, { status: 500 })
  }

  // Segarkan cache storefront agar produk yang dihapus hilang dari ecommerce.
  // id diketahui → revalidasi halaman detail spesifik + beranda + katalog.
  await logAdminActivity({
    action: 'product.delete',
    entityType: 'product',
    entityId: body.id,
    entityLabel: before?.name ?? null,
    details: { sku: before?.sku ?? null, category: before?.category ?? null },
  })

  revalidatePath('/')
  revalidatePath('/products')
  revalidatePath(`/produk/${body.id}`)
  // Invalidasi cache baca storefront (cached-reads) agar produk terhapus langsung hilang
  revalidateTag('products', 'max')

  return NextResponse.json({ success: true })
}
