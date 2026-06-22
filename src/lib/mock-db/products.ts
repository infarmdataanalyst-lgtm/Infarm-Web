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
  return {
    id: row.id,
    name: row.name,
    originalPrice: row.original_price,
    promoPrice: row.promo_price,
    imageUrl: row.image_url,
    category: row.category as ProductCategory,
    badge: row.badge ?? undefined,
    sku: row.sku,
    stock: row.stock,
    description: row.description ?? undefined,
    archived: row.archived,
    createdAt: row.created_at,
  }
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
  const { data, error } = await supabase
    .from('products')
    .insert({
      name: input.name,
      original_price: input.price,
      promo_price: input.price,
      image_url: input.imageUrl?.trim() || '/images/product-placeholder.png',
      category: input.category,
      badge: 'Baru', // tandai produk baru dari OMS
      sku: input.sku,
      stock: input.stock,
      description: input.description ?? null,
    })
    .select('*')
    .single()

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

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('products')
    .update(dbPatch)
    .eq('id', id)
    .select('*')
    .maybeSingle()

  if (error) {
    console.error('Gagal memperbarui produk di Supabase:', error.message)
    return null
  }

  return data ? rowToStored(data as ProductRow) : null
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
