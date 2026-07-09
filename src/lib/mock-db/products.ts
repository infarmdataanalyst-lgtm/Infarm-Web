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

import { createAdminClient } from '@/lib/supabase/server'
import type {
  StoredProduct,
  CreateProductInput,
  ProductCategory,
} from '@/types/product'

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

  return (data as ProductRow[]).map(rowToStored)
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

  return data ? rowToStored(data as ProductRow) : null
}

// === Tulis ===

// Menyimpan produk baru dari OMS lalu mengembalikan produk tersimpan (id & createdAt dari DB).
// Opsi harga sederhana: originalPrice = promoPrice = price (tanpa diskon).
export async function saveProduct(input: CreateProductInput): Promise<StoredProduct> {
  const supabase = createAdminClient()
  const gallery = sanitizeGallery(input.images)
  // Foto utama: imageUrl eksplisit → foto pertama galeri → placeholder
  const primary = input.imageUrl?.trim() || gallery[0] || '/images/product-placeholder.png'

  const row: Record<string, unknown> = {
    name: input.name,
    original_price: input.price,
    promo_price: input.price,
    image_url: primary,
    images: gallery,
    category: input.category,
    badge: 'Baru', // tandai produk baru dari OMS
    sku: input.sku,
    stock: input.stock,
    description: input.description ?? null,
  }

  let { data, error } = await supabase.from('products').insert(row).select('*').single()

  // Jaring pengaman: bila kolom images belum di-migrate, simpan ulang tanpa galeri
  // agar upload tetap jalan (foto utama tetap tersimpan di image_url).
  // PGRST204 = kolom tak dikenal PostgREST; 42703 = kolom tak ada di Postgres.
  if (error?.code === 'PGRST204' || error?.code === '42703') {
    const rowWithoutImages = { ...row }
    delete rowWithoutImages.images
    ;({ data, error } = await supabase.from('products').insert(rowWithoutImages).select('*').single())
  }

  if (error || !data) {
    throw new Error(`Gagal menyimpan produk: ${error?.message ?? 'tidak diketahui'}`)
  }

  return rowToStored(data as ProductRow)
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
  if (patch.imageUrl !== undefined) dbPatch.image_url = patch.imageUrl
  if (patch.category !== undefined) dbPatch.category = patch.category
  if (patch.badge !== undefined) dbPatch.badge = patch.badge
  if (patch.sku !== undefined) dbPatch.sku = patch.sku
  if (patch.stock !== undefined) dbPatch.stock = patch.stock
  if (patch.description !== undefined) dbPatch.description = patch.description
  if (patch.archived !== undefined) dbPatch.archived = patch.archived
  // Galeri: simpan array + sinkronkan foto utama (image_url) ke foto pertama galeri
  if (patch.images !== undefined) {
    const gallery = sanitizeGallery(patch.images)
    dbPatch.images = gallery
    if (gallery[0]) dbPatch.image_url = gallery[0]
  }

  const supabase = createAdminClient()
  let { data, error } = await supabase
    .from('products')
    .update(dbPatch)
    .eq('id', id)
    .select('*')
    .maybeSingle()

  // Fallback bila kolom images belum di-migrate: ulangi update tanpa galeri
  if (error?.code === 'PGRST204' || error?.code === '42703') {
    const patchWithoutImages = { ...dbPatch }
    delete patchWithoutImages.images
    ;({ data, error } = await supabase
      .from('products')
      .update(patchWithoutImages)
      .eq('id', id)
      .select('*')
      .maybeSingle())
  }

  if (error) {
    console.error('Gagal memperbarui produk di Supabase:', error.message)
    return null
  }

  return data ? rowToStored(data as ProductRow) : null
}

// === Stok ===

// Mengembalikan stok produk ke "tersedia" saat pesanan dibatalkan: stock += quantity.
// Hanya berlaku untuk produk yang ADA di DB (produk OMS); item dummy/tak dikenal dilewati.
// Catatan: idealnya stok dikurangi saat checkout (alokasi). Selama alokasi belum ada,
// fungsi ini menambah kembali jumlah yang dibatalkan sebagai simulasi pelepasan stok.
export async function restoreStock(
  items: { productId: string; quantity: number }[],
): Promise<void> {
  const supabase = createAdminClient()
  for (const { productId, quantity } of items) {
    if (!quantity || quantity <= 0) continue
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
