// src/app/api/products/update/route.ts
// API memperbarui produk di mock database (dari modal Edit OMS).

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/oms-guard'
import { revalidatePath, revalidateTag } from 'next/cache'
import { updateProduct } from '@/lib/mock-db/products'
import { parseStockPerWarehouse, writeStockPerWarehouse } from '@/lib/warehouse'
import { readStockRows } from '@/lib/mock-db/warehouses'
import { recordAdminStockChanges } from '@/lib/stock-audit'
import { PRODUCT_CATEGORIES } from '@/lib/data/categories'
import { validateMinOrderQty } from '@/lib/product-validation'
import type { StoredProduct } from '@/types/product'

export const runtime = 'nodejs'

const VALID_CATEGORIES = PRODUCT_CATEGORIES.map((c) => c.slug) as string[]

// Memperbarui produk berdasarkan id; hanya field yang dikirim yang diubah
export async function PATCH(request: Request) {
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

  // Susun patch hanya dari field bertipe benar
  const patch: Partial<Omit<StoredProduct, 'id' | 'createdAt'>> = {}
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim()
  if (typeof body.sku === 'string' && body.sku.trim()) patch.sku = body.sku.trim()
  if (typeof body.category === 'string' && VALID_CATEGORIES.includes(body.category)) {
    patch.category = body.category as StoredProduct['category']
  }
  // Harga jual → promo_price. Harga asli (opsional) → original_price bila > harga jual,
  // selain itu disamakan (tanpa diskon).
  if (typeof body.price === 'number' && body.price >= 0) {
    patch.promoPrice = body.price
    patch.originalPrice =
      typeof body.originalPrice === 'number' && body.originalPrice > body.price
        ? body.originalPrice
        : body.price
  }
  if (typeof body.stock === 'number' && body.stock >= 0) patch.stock = body.stock
  // Minimum pembelian: divalidasi ulang di server (jangan percaya form OMS)
  if (typeof body.minOrderQty === 'number') {
    const minQtyErr = validateMinOrderQty(body.minOrderQty)
    if (minQtyErr) return NextResponse.json({ error: minQtyErr }, { status: 422 })
    patch.minOrderQty = body.minOrderQty
  }
  if (typeof body.description === 'string') patch.description = body.description
  if (typeof body.archived === 'boolean') patch.archived = body.archived
  if (typeof body.imageUrl === 'string' && body.imageUrl.trim()) patch.imageUrl = body.imageUrl
  // Galeri foto (opsional): array string, dibatasi maks 9 di mock-db
  if (Array.isArray(body.images) && body.images.every((s) => typeof s === 'string')) {
    patch.images = body.images as string[]
  }

  // Rincian stok per gudang (mode multi) — divalidasi sebelum menyentuh produk.
  const perWarehouse = parseStockPerWarehouse(body.stockPerWarehouse)
  if (perWarehouse.error) {
    return NextResponse.json({ error: perWarehouse.error }, { status: 422 })
  }

  const updated = await updateProduct(body.id, patch)
  if (!updated) {
    return NextResponse.json({ error: 'Produk tidak ditemukan.' }, { status: 404 })
  }

  // Menimpa stok tiap gudang. Dijalankan SETELAH update produk agar produk yang tak ditemukan
  // tidak menyisakan perubahan stok.
  //
  // Catatan: modal edit produk SUDAH TIDAK mengirim stockPerWarehouse (stok hanya bisa diubah di
  // Gudang → Kelola Stok). Cabang ini dipertahankan untuk pemanggil lain / skrip, dan karena itu
  // ikut dicatat ke riwayat dengan alasan 'product_form'.
  if (perWarehouse.entries && perWarehouse.entries.length > 0) {
    // Nilai lama dibaca SEBELUM ditimpa, untuk stok_before di riwayat.
    const previous = await readStockRows({ productIds: [body.id] })
    await writeStockPerWarehouse(body.id, perWarehouse.entries)
    await recordAdminStockChanges(
      perWarehouse.entries.map((entry) => ({
        productId: body.id as string,
        warehouseId: entry.warehouseId,
        stokBefore:
          previous.find((r) => r.warehouseId === entry.warehouseId && !r.variantId)?.stok ?? 0,
        stokAfter: entry.stok,
      })),
      'product_form',
    )
  }

  // Segarkan cache storefront agar perubahan (harga/stok/arsip) langsung tampil di ecommerce.
  // id produk diketahui → revalidasi halaman detail spesifik + beranda + katalog.
  revalidatePath('/')
  revalidatePath('/products')
  revalidatePath(`/produk/${body.id}`)
  // Invalidasi cache baca storefront (cached-reads) agar perubahan harga/stok/arsip langsung tampil
  revalidateTag('products', 'max')

  return NextResponse.json({ success: true, product: updated })
}
