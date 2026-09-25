// src/app/api/products/update/route.ts
// API memperbarui produk di mock database (dari modal Edit OMS).
//
// ── Validator yang sama dengan create/route.ts (menutup SEC-018) ──
// Berkas ini dulu nyaris tak mengimpor apa pun dari @/lib/product-validation, padahal create sudah
// memakainya sepenuhnya. Akibatnya `price` hanya dicek >= 0 tanpa PRICE_MIN/PRICE_MAX, `stock`
// hanya >= 0 tanpa STOCK_MAX dan tanpa cek bilangan bulat, `sku` tak diadu ke SKU_REGEX, `name`
// dan `description` tanpa batas panjang, dan `images` tanpa batas MAX_PRODUCT_IMAGES — sehingga
// produk yang TIDAK MUNGKIN dibuat lewat create bisa lahir dengan membuatnya seadanya lalu
// mengeditnya. Ini bukan celah anonim (endpoint ini menuntut sesi admin); nilainya ada pada
// pertahanan berlapis bila akun admin dikompromikan, dan pada data produk yang tetap bersih.
//
// Sifat PATCH dipertahankan: field yang TIDAK dikirim tetap tak tersentuh. Yang berubah hanya
// nasib field yang dikirim tapi tak lolos — dulu diam-diam diabaikan, kini ditolak 422. Diam-diam
// mengabaikan justru lebih buruk: admin melihat formnya tersimpan padahal nilainya tidak berubah.

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/oms-guard'
import { revalidatePath, revalidateTag } from 'next/cache'
import { updateProduct } from '@/lib/mock-db/products'
import { parseStockPerWarehouse, writeStockPerWarehouse } from '@/lib/warehouse'
import { readStockRows } from '@/lib/mock-db/warehouses'
import { recordAdminStockChanges } from '@/lib/stock-audit'
import { PRODUCT_CATEGORIES } from '@/lib/data/categories'
import {
  validateBerat,
  validateMinOrderQty,
  validateName,
  validateSkuFormat,
  validatePrice,
  validateOriginalPrice,
  validateStock,
  validateDescription,
  MAX_PRODUCT_IMAGES,
} from '@/lib/product-validation'
import { validateProductImages } from '@/lib/product-image-validation'
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

  // Susun patch hanya dari field bertipe benar. Setiap field yang DIKIRIM diadu ke validator yang
  // sama persis dengan create/route.ts — lihat SEC-018 di kepala berkas.
  const patch: Partial<Omit<StoredProduct, 'id' | 'createdAt'>> = {}

  if (body.name !== undefined) {
    if (typeof body.name !== 'string') {
      return NextResponse.json({ error: 'Nama produk tidak valid.' }, { status: 422 })
    }
    const nameErr = validateName(body.name)
    if (nameErr) return NextResponse.json({ error: nameErr }, { status: 422 })
    patch.name = body.name.trim()
  }

  if (body.sku !== undefined) {
    if (typeof body.sku !== 'string') {
      return NextResponse.json({ error: 'SKU tidak valid.' }, { status: 422 })
    }
    const skuErr = validateSkuFormat(body.sku)
    if (skuErr) return NextResponse.json({ error: skuErr }, { status: 422 })
    patch.sku = body.sku.trim()
  }

  if (body.category !== undefined) {
    if (typeof body.category !== 'string' || !VALID_CATEGORIES.includes(body.category)) {
      return NextResponse.json({ error: 'Pilih kategori produk.' }, { status: 422 })
    }
    patch.category = body.category as StoredProduct['category']
  }

  // Harga jual → promo_price. Harga asli (opsional) → original_price bila > harga jual,
  // selain itu disamakan (tanpa diskon).
  //
  // originalPrice sengaja hanya divalidasi bersama price: validateOriginalPrice menuntut keduanya
  // untuk bisa menilai "harga asli harus di atas harga jual", dan modal edit OMS memang selalu
  // mengirim keduanya sekaligus.
  if (body.price !== undefined) {
    const price = typeof body.price === 'number' ? body.price : ''
    const priceErr = validatePrice(price)
    if (priceErr) return NextResponse.json({ error: priceErr }, { status: 422 })

    const originalPrice = typeof body.originalPrice === 'number' ? body.originalPrice : undefined
    const origErr = validateOriginalPrice(originalPrice ?? '', price)
    if (origErr) return NextResponse.json({ error: origErr }, { status: 422 })

    patch.promoPrice = body.price as number
    patch.originalPrice =
      originalPrice !== undefined && originalPrice > (body.price as number)
        ? originalPrice
        : (body.price as number)
  }

  if (body.stock !== undefined) {
    const stockErr = validateStock(typeof body.stock === 'number' ? body.stock : '')
    if (stockErr) return NextResponse.json({ error: stockErr }, { status: 422 })
    patch.stock = body.stock as number
  }
  // Minimum pembelian: divalidasi ulang di server (jangan percaya form OMS)
  if (typeof body.minOrderQty === 'number') {
    const minQtyErr = validateMinOrderQty(body.minOrderQty)
    if (minQtyErr) return NextResponse.json({ error: minQtyErr }, { status: 422 })
    patch.minOrderQty = body.minOrderQty
  }
  // Berat (gram): divalidasi ulang di server. Hanya diproses bila dikirim — PATCH bersifat parsial,
  // dan aksi lain (mis. arsipkan produk) tak boleh dipaksa mengirim berat.
  if (body.berat !== undefined) {
    const beratErr = validateBerat(typeof body.berat === 'number' ? body.berat : '')
    if (beratErr) return NextResponse.json({ error: beratErr }, { status: 422 })
    patch.berat = body.berat as number
  }
  if (body.description !== undefined) {
    if (typeof body.description !== 'string') {
      return NextResponse.json({ error: 'Deskripsi tidak valid.' }, { status: 422 })
    }
    const descErr = validateDescription(body.description)
    if (descErr) return NextResponse.json({ error: descErr }, { status: 422 })
    patch.description = body.description
  }

  if (typeof body.archived === 'boolean') patch.archived = body.archived
  if (typeof body.imageUrl === 'string' && body.imageUrl.trim()) patch.imageUrl = body.imageUrl

  // Galeri foto (opsional): array string, dibatasi MAX_PRODUCT_IMAGES — batas yang sama dengan
  // create/route.ts dan dengan constraint DB. Dulu batas ini hanya ada di mock-db.
  if (body.images !== undefined) {
    if (!Array.isArray(body.images) || !body.images.every((s) => typeof s === 'string')) {
      return NextResponse.json({ error: 'Gambar produk tidak valid.' }, { status: 422 })
    }
    if (body.images.length > MAX_PRODUCT_IMAGES) {
      return NextResponse.json(
        { error: `Maksimal ${MAX_PRODUCT_IMAGES} gambar per produk` },
        { status: 422 },
      )
    }
    patch.images = body.images as string[]
  }

  // Tipe, ukuran, dan ISI tiap gambar diperiksa di server (menutup SEC-019). Dilakukan di route,
  // bukan hanya di lapisan penyimpanan, supaya admin mendapat penolakan yang JELAS — kalau hanya
  // ditolak jauh di dalam uploadImageIfDataUrl, respons yang kembali tetap 200 dan fotonya diam-diam
  // menghilang. Pemeriksaan di lapisan penyimpanan tetap ada sebagai pertahanan berlapis.
  const imageError = validateProductImages({ imageUrl: body.imageUrl, images: body.images })
  if (imageError) return NextResponse.json({ error: imageError }, { status: 422 })

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
