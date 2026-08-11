// src/lib/mock-db/products.ts
// Akses data produk (dibaca/ditulis oleh OMS, dibaca oleh storefront).
//
// ISOLASI: seluruh akses data produk lewat fungsi di file ini, sehingga
// pemanggil (API Route & Server Component) tidak perlu tahu sumber datanya.
// Sebelumnya file JSON lokal; kini di-back oleh Supabase (tabel public.products).
//
// SERVER-ONLY: memakai createAdminClient() (service_role) yang menembus RLS,
// jadi readProducts() bisa melihat produk archived (untuk OMS) dan operasi
// tulis tidak terhalang policy. JANGAN diimpor dari komponen 'use client'.

import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/server'
import {
  getEffectiveStockMaps,
  returnStockToWarehouse,
  writeEffectiveStock,
} from '@/lib/warehouse'
import type {
  StoredProduct,
  CreateProductInput,
  ProductCategory,
} from '@/types/product'

// === Upload gambar ke Supabase Storage ===
// Foto produk WAJIB disimpan sebagai URL Storage, bukan base64 di kolom DB (payload membengkak).
// Bucket 'product-images' (public). Helper di bawah mengubah data-URL base64 → file di Storage → URL.

const IMAGE_BUCKET = 'product-images'

// Ekstensi file dari mime data-URL (fallback .bin)
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

// Bila string berupa data-URL base64 → decode, upload ke Storage, kembalikan URL publik.
// Bila sudah URL (http) / placeholder / kosong → kembalikan apa adanya (idempoten).
async function uploadImageIfDataUrl(value: string): Promise<string> {
  if (!value || !value.startsWith('data:')) return value

  const match = value.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return value // format tak dikenal → biarkan (jangan hilangkan foto)

  const mime = match[1]
  const ext = MIME_EXT[mime] ?? 'bin'
  const buffer = Buffer.from(match[2], 'base64')
  const path = `products/${randomUUID()}.${ext}`

  const supabase = createAdminClient()
  // cacheControl '3600' → CDN Supabase (Cloudflare) menyimpan gambar 1 jam. Gambar produk
  // jarang berubah (URL baru per upload), jadi aman di-cache lama. Hanya berlaku untuk upload baru.
  const { error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(path, buffer, { contentType: mime, upsert: false, cacheControl: '3600' })

  if (error) {
    console.error('Gagal upload gambar ke Storage:', error.message)
    return value // fallback: pertahankan data-URL agar foto tak hilang (payload berat, tapi aman)
  }

  return supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl
}

// Memproses daftar gambar galeri: upload yang masih data-URL, sisanya (URL) dibiarkan.
async function uploadGallery(images: string[]): Promise<string[]> {
  return Promise.all(images.map((img) => uploadImageIfDataUrl(img)))
}

// === Pemetaan baris DB <-> StoredProduct ===

// Bentuk satu baris tabel products (snake_case sesuai kolom Postgres).
type ProductRow = {
  id: string
  name: string
  original_price: number
  promo_price: number
  image_url: string
  images: string[] | null // kolom jsonb (galeri); null bila kolom belum di-migrate
  category: string
  badge: string | null
  sku: string
  stock: number
  description: string | null
  archived: boolean
  created_at: string
  min_order_qty: number | null // null bila kolom belum di-migrate (produk lama)
}

// Mengubah baris DB (snake_case) menjadi StoredProduct (camelCase) yang dipakai aplikasi.
// category aman di-cast karena dibatasi CHECK constraint di migration.
function rowToStored(row: ProductRow): StoredProduct {
  // Galeri: pakai kolom images bila ada; fallback ke [image_url] agar produk lama tetap punya 1 foto
  const images =
    Array.isArray(row.images) && row.images.length > 0
      ? row.images
      : row.image_url
        ? [row.image_url]
        : []
  return {
    id: row.id,
    name: row.name,
    originalPrice: row.original_price,
    promoPrice: row.promo_price,
    imageUrl: row.image_url,
    images,
    category: row.category as ProductCategory,
    badge: row.badge ?? undefined,
    sku: row.sku,
    stock: row.stock,
    description: row.description ?? undefined,
    archived: row.archived,
    createdAt: row.created_at,
    // Fallback 1 = tanpa batasan, aman bila kolom belum di-migrate atau berisi nilai tak valid
    minOrderQty: row.min_order_qty && row.min_order_qty >= 1 ? row.min_order_qty : 1,
  }
}

// Membersihkan & membatasi galeri foto: buang non-string/kosong, maksimal 9.
function sanitizeGallery(images: string[] | undefined): string[] {
  if (!Array.isArray(images)) return []
  return images.filter((s) => typeof s === 'string' && s.trim().length > 0).slice(0, 9)
}

// === Baca ===

// Membaca seluruh produk (termasuk archived), terbaru di depan.
// Array kosong bila terjadi error agar UI tidak crash.
// Nilai `stock` yang dikembalikan = STOK EFEKTIF dari product_stock_per_warehouse (lihat
// applyEffectiveStock); kolom products.stock hanya dipakai bila baris gudang belum ada.
export async function readProducts(): Promise<StoredProduct[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Gagal membaca produk dari Supabase:', error.message)
    return []
  }

  return applyEffectiveStock((data as ProductRow[]).map(rowToStored))
}

// Menimpa field `stock` tiap produk dengan stok efektif dari tabel gudang.
//
// Kenapa di sini, bukan di tiap pemanggil: semua storefront & OMS membaca stok lewat
// readProducts/getProductById, jadi satu titik ini membuat SELURUH aplikasi otomatis memakai
// stok per gudang tanpa mengubah komponen mana pun. Di mode single, stok dijumlahkan dari semua
// gudang sehingga angka yang tampil identik dengan sebelum migration.
//
// Dipakai versi BATCH (satu query untuk semua produk) supaya tidak terjadi N+1 query.
// Produk yang belum punya baris gudang tetap memakai nilai products.stock (fail-safe).
async function applyEffectiveStock(products: StoredProduct[]): Promise<StoredProduct[]> {
  if (products.length === 0) return products
  const { byProduct } = await getEffectiveStockMaps(products.map((p) => p.id))
  if (byProduct.size === 0) return products // tabel gudang belum di-migrate → pakai kolom lama
  return products.map((p) => {
    const effective = byProduct.get(p.id)
    return effective === undefined ? p : { ...p, stock: effective }
  })
}

// Membaca satu produk berdasarkan id. null bila tidak ditemukan.
export async function getProductById(id: string): Promise<StoredProduct | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('Gagal membaca produk dari Supabase:', error.message)
    return null
  }

  if (!data) return null
  const [product] = await applyEffectiveStock([rowToStored(data as ProductRow)])
  return product
}

// === Tulis ===

// Menyimpan produk baru dari OMS lalu mengembalikan produk tersimpan (id & createdAt dari DB).
// Opsi harga sederhana: originalPrice = promoPrice = price (tanpa diskon).
export async function saveProduct(input: CreateProductInput): Promise<StoredProduct> {
  const supabase = createAdminClient()
  // Upload galeri (data-URL → Storage) lebih dulu agar kolom images berisi URL, bukan base64
  const gallery = await uploadGallery(sanitizeGallery(input.images))
  // Foto utama: imageUrl eksplisit → foto pertama galeri → placeholder. Upload bila masih data-URL.
  const primary = await uploadImageIfDataUrl(
    input.imageUrl?.trim() || gallery[0] || '/images/product-placeholder.png',
  )

  // promo_price = harga jual (dibayar buyer). original_price = harga asli (dicoret).
  // Bila originalPrice tak diisi / tidak lebih besar → samakan dengan harga jual (tanpa diskon).
  const promo = input.price
  const original =
    input.originalPrice !== undefined && input.originalPrice > promo ? input.originalPrice : promo

  const row: Record<string, unknown> = {
    name: input.name,
    original_price: original,
    promo_price: promo,
    image_url: primary,
    images: gallery,
    category: input.category,
    badge: 'Baru', // tandai produk baru dari OMS
    sku: input.sku,
    stock: input.stock,
    description: input.description ?? null,
    // Minimum pembelian; clamp ≥ 1 agar tak pernah melanggar CHECK di DB
    min_order_qty: Math.max(1, Math.floor(input.minOrderQty ?? 1)),
  }

  let { data, error } = await supabase.from('products').insert(row).select('*').single()

  // Jaring pengaman: bila kolom images / min_order_qty belum di-migrate, simpan ulang tanpa
  // kolom tersebut agar upload tetap jalan (foto utama tetap tersimpan di image_url).
  // PGRST204 = kolom tak dikenal PostgREST; 42703 = kolom tak ada di Postgres.
  if (error?.code === 'PGRST204' || error?.code === '42703') {
    const rowFallback = { ...row }
    delete rowFallback.images
    delete rowFallback.min_order_qty
    ;({ data, error } = await supabase.from('products').insert(rowFallback).select('*').single())
  }

  if (error || !data) {
    throw new Error(`Gagal menyimpan produk: ${error?.message ?? 'tidak diketahui'}`)
  }

  const saved = rowToStored(data as ProductRow)

  // Stok awal dicatat ke gudang (mode single → gudang default). Kolom products.stock di atas
  // TETAP diisi nilai yang sama: bukan sebagai sumber kebenaran, tapi agar produk baru punya
  // fallback yang benar bila baris gudang gagal dibuat (mis. migration belum di-apply).
  await writeEffectiveStock({ productId: saved.id, stok: input.stock })

  return saved
}

// === Ubah ===

// Memperbarui sebagian field produk berdasarkan id. null bila produk tidak ditemukan.
export async function updateProduct(
  id: string,
  patch: Partial<Omit<StoredProduct, 'id' | 'createdAt'>>,
): Promise<StoredProduct | null> {
  // Petakan hanya field yang dikirim ke kolom snake_case-nya
  const dbPatch: Record<string, unknown> = {}
  if (patch.name !== undefined) dbPatch.name = patch.name
  if (patch.originalPrice !== undefined) dbPatch.original_price = patch.originalPrice
  if (patch.promoPrice !== undefined) dbPatch.promo_price = patch.promoPrice
  // Foto utama: upload bila masih data-URL (jangan simpan base64 ke image_url)
  if (patch.imageUrl !== undefined) dbPatch.image_url = await uploadImageIfDataUrl(patch.imageUrl)
  if (patch.category !== undefined) dbPatch.category = patch.category
  if (patch.badge !== undefined) dbPatch.badge = patch.badge
  if (patch.sku !== undefined) dbPatch.sku = patch.sku
  if (patch.description !== undefined) dbPatch.description = patch.description
  if (patch.archived !== undefined) dbPatch.archived = patch.archived
  // Clamp ≥ 1 agar tak melanggar CHECK products_min_order_qty_check
  if (patch.minOrderQty !== undefined) {
    dbPatch.min_order_qty = Math.max(1, Math.floor(patch.minOrderQty))
  }
  // Galeri: upload data-URL → URL Storage, simpan array + sinkronkan foto utama ke foto pertama
  if (patch.images !== undefined) {
    const gallery = await uploadGallery(sanitizeGallery(patch.images))
    dbPatch.images = gallery
    if (gallery[0]) dbPatch.image_url = gallery[0]
  }

  // Stok TIDAK lagi ditulis ke products.stock. Sumber kebenarannya kini
  // product_stock_per_warehouse (mode single → gudang default). Kolom lama dibiarkan apa adanya
  // sebagai cadangan historis. Bila penulisan ke gudang gagal (tabel belum di-migrate), stok
  // baru dikembalikan ke kolom lama supaya perubahan admin tidak hilang.
  if (patch.stock !== undefined) {
    const written = await writeEffectiveStock({ productId: id, stok: patch.stock })
    if (!written) dbPatch.stock = patch.stock
  }

  // Hanya stok yang diubah & sudah tersimpan ke gudang → tak ada kolom products yang perlu
  // di-update. Supabase menolak update dengan payload kosong, jadi cukup baca ulang produknya.
  if (Object.keys(dbPatch).length === 0) return getProductById(id)

  const supabase = createAdminClient()
  let { data, error } = await supabase
    .from('products')
    .update(dbPatch)
    .eq('id', id)
    .select('*')
    .maybeSingle()

  // Fallback bila kolom images / min_order_qty belum di-migrate: ulangi update tanpa kolom itu
  if (error?.code === 'PGRST204' || error?.code === '42703') {
    const patchFallback = { ...dbPatch }
    delete patchFallback.images
    delete patchFallback.min_order_qty
    ;({ data, error } = await supabase
      .from('products')
      .update(patchFallback)
      .eq('id', id)
      .select('*')
      .maybeSingle())
  }

  if (error) {
    console.error('Gagal memperbarui produk di Supabase:', error.message)
    return null
  }

  if (!data) return null
  // Overlay stok gudang: baris products yang baru dikembalikan Supabase masih membawa nilai
  // products.stock yang sudah tidak otoritatif.
  const [updated] = await applyEffectiveStock([rowToStored(data as ProductRow)])
  return updated
}

// === Stok ===

// Mengembalikan stok produk ke "tersedia" saat pesanan dibatalkan: stok += quantity.
// Hanya berlaku untuk produk yang ADA di DB (produk OMS); item dummy/tak dikenal dilewati.
// Catatan: idealnya stok dikurangi saat checkout (alokasi). Selama alokasi belum ada,
// fungsi ini menambah kembali jumlah yang dibatalkan sebagai simulasi pelepasan stok.
//
// `warehouseId` = gudang pemenuh pesanan (orders.warehouse_id). Kosong → gudang default, sehingga
// pembatalan pesanan lama (sebelum kolom itu ada) tetap mengembalikan stok ke tempat yang benar
// di mode single. Bila tabel gudang belum di-migrate, penambahan jatuh ke kolom products.stock
// seperti perilaku sebelumnya.
export async function restoreStock(
  items: { productId: string; quantity: number; variantId?: string }[],
  warehouseId?: string,
): Promise<void> {
  // 1. Jalur utama: kembalikan ke stok per gudang
  await returnStockToWarehouse(
    items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity })),
    warehouseId,
  )

  // 2. Jaring pengaman untuk produk yang belum punya baris gudang (mis. tabel belum di-migrate):
  //    tanpa ini stok yang dibatalkan tak pernah kembali.
  const supabase = createAdminClient()
  const { byProduct } = await getEffectiveStockMaps(items.map((i) => i.productId))
  for (const { productId, quantity, variantId } of items) {
    if (!quantity || quantity <= 0) continue
    if (variantId) continue // stok varian tidak disimpan di products.stock
    if (byProduct.has(productId)) continue // sudah ditangani jalur gudang di atas
    const product = await getProductById(productId)
    if (!product) continue // produk dummy / tidak ada di DB → lewati dengan aman
    const { error } = await supabase
      .from('products')
      .update({ stock: product.stock + quantity })
      .eq('id', productId)
    if (error) console.error('Gagal mengembalikan stok produk:', error.message)
  }
}

// === Hapus ===

// Menghapus produk berdasarkan id. true bila terhapus, false bila tidak ditemukan.
export async function deleteProduct(id: string): Promise<boolean> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('products')
    .delete()
    .eq('id', id)
    .select('id')

  if (error) {
    console.error('Gagal menghapus produk di Supabase:', error.message)
    return false
  }

  return (data?.length ?? 0) > 0
}
