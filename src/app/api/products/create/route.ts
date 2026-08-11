// src/app/api/products/create/route.ts
// API menulis produk baru ke mock database.
// Dipanggil POST dari form Upload Produk OMS.

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/oms-guard'
import { revalidatePath, revalidateTag } from 'next/cache'
import { saveProduct } from '@/lib/mock-db/products'
import { parseStockPerWarehouse, writeStockPerWarehouse } from '@/lib/warehouse'
import { PRODUCT_CATEGORIES } from '@/lib/data/categories'
import {
  validateName,
  validateSkuFormat,
  validatePrice,
  validateOriginalPrice,
  validateStock,
  validateMinOrderQty,
  validateDescription,
  validateImages,
  MAX_PRODUCT_IMAGES,
} from '@/lib/product-validation'
import type { CreateProductInput, ProductCategory } from '@/types/product'

// 'fs' butuh runtime Node.js (bukan Edge)
export const runtime = 'nodejs'

const VALID_CATEGORIES = PRODUCT_CATEGORIES.map((c) => c.slug) as string[]

// Validasi payload di server (jangan percaya input client). Kembalikan pesan error atau null.
// Aturan sama dengan client (src/lib/product-validation.ts) — pertahanan berlapis.
function validatePayload(body: unknown): { input: CreateProductInput } | { error: string } {
  if (typeof body !== 'object' || body === null) return { error: 'Body tidak valid.' }
  const b = body as Record<string, unknown>

  if (typeof b.sku !== 'string') return { error: 'SKU wajib diisi.' }
  const skuErr = validateSkuFormat(b.sku)
  if (skuErr) return { error: skuErr }

  if (typeof b.name !== 'string') return { error: 'Nama produk wajib diisi.' }
  const nameErr = validateName(b.name)
  if (nameErr) return { error: nameErr }

  if (typeof b.category !== 'string' || !VALID_CATEGORIES.includes(b.category)) {
    return { error: 'Pilih kategori produk.' }
  }

  const priceErr = validatePrice(typeof b.price === 'number' ? b.price : '')
  if (priceErr) return { error: priceErr }

  // Harga asli opsional; bila diisi wajib > harga jual
  const originalPrice = typeof b.originalPrice === 'number' ? b.originalPrice : undefined
  const origErr = validateOriginalPrice(originalPrice ?? '', typeof b.price === 'number' ? b.price : '')
  if (origErr) return { error: origErr }

  const stockErr = validateStock(typeof b.stock === 'number' ? b.stock : '')
  if (stockErr) return { error: stockErr }

  // Minimum pembelian: opsional di payload (produk lama/klien lama) → default 1 = tanpa batasan
  const minOrderQty = typeof b.minOrderQty === 'number' ? b.minOrderQty : 1
  const minQtyErr = validateMinOrderQty(minOrderQty)
  if (minQtyErr) return { error: minQtyErr }

  if (typeof b.description !== 'string') return { error: 'Deskripsi wajib diisi.' }
  const descErr = validateDescription(b.description)
  if (descErr) return { error: descErr }

  // Galeri: wajib array string; minimal 1, maksimal 9
  if (!Array.isArray(b.images) || !b.images.every((s) => typeof s === 'string')) {
    return { error: 'Gambar produk tidak valid.' }
  }
  if (b.images.length > MAX_PRODUCT_IMAGES) return { error: `Maksimal ${MAX_PRODUCT_IMAGES} gambar per produk` }
  const imgErr = validateImages(b.images.length)
  if (imgErr) return { error: imgErr }

  return {
    input: {
      name: (b.name as string).trim(),
      sku: (b.sku as string).trim(),
      category: b.category as ProductCategory,
      price: b.price as number,
      originalPrice,
      stock: b.stock as number,
      minOrderQty,
      description: (b.description as string).trim(),
      imageUrl: typeof b.imageUrl === 'string' ? b.imageUrl : undefined,
      images: b.images as string[],
    },
  }
}

// Menyimpan produk baru dari OMS
export async function POST(request: Request) {
  // Guard: endpoint OMS — wajib sesi admin (K-1)
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  const result = validatePayload(body)
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 422 })
  }

  // Rincian stok per gudang (mode multi). Divalidasi SEBELUM produk dibuat agar payload cacat
  // tidak meninggalkan produk tanpa stok yang benar.
  const perWarehouse = parseStockPerWarehouse((body as Record<string, unknown>).stockPerWarehouse)
  if (perWarehouse.error) {
    return NextResponse.json({ error: perWarehouse.error }, { status: 422 })
  }

  const saved = await saveProduct(result.input)

  // saveProduct sudah menaruh `stock` ke gudang default; rincian per gudang menimpanya bila ada.
  if (perWarehouse.entries && perWarehouse.entries.length > 0) {
    await writeStockPerWarehouse(saved.id, perWarehouse.entries)
  }

  // Segarkan cache halaman storefront agar produk baru langsung tampil saat navigasi.
  // '/produk/[id]' butuh arg 'page' karena route dinamis (revalidasi semua halaman detail).
  revalidatePath('/')
  revalidatePath('/products')
  revalidatePath('/produk/[id]', 'page')
  // Invalidasi cache baca storefront (cached-reads) agar produk baru langsung muncul
  revalidateTag('products', 'max')

  return NextResponse.json({ success: true, product: saved }, { status: 201 })
}
