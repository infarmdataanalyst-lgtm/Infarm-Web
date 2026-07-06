// src/lib/product-validation.ts
// Validasi form produk OMS (upload & edit). Fungsi murni — dipakai bersama oleh
// halaman upload dan modal edit. Cek duplikat SKU bersifat async (lihat /api/products/check-sku),
// TIDAK di file ini karena butuh akses server.

import type { ProductCategory } from '@/types/product'

// === Batasan ===
export const SKU_REGEX = /^[A-Z0-9-]+$/
export const NAME_MIN = 3
export const NAME_MAX = 200
export const DESC_MIN = 20
export const DESC_MAX = 2000
export const PRICE_MIN = 100
export const PRICE_MAX = 99_999_999
export const STOCK_MIN = 0
export const STOCK_MAX = 999_999
export const MAX_PRODUCT_IMAGES = 9 // sesuai slider detail produk & constraint DB
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024 // 2MB per file
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const ACCEPTED_IMAGE_ACCEPT = '.jpg,.jpeg,.png,.webp' // untuk atribut input accept

// === Validator per field (mengembalikan pesan error atau undefined) ===

// Validasi format SKU (bukan duplikat — duplikat dicek async ke server).
export function validateSkuFormat(sku: string): string | undefined {
  const v = sku.trim()
  if (!v) return 'SKU tidak boleh kosong'
  if (!SKU_REGEX.test(v)) return 'SKU hanya boleh huruf kapital, angka, dan tanda hubung'
  return undefined
}

export function validateName(name: string): string | undefined {
  const v = name.trim()
  if (!v) return 'Nama produk tidak boleh kosong'
  if (v.length < NAME_MIN) return 'Nama produk minimal 3 karakter'
  if (v.length > NAME_MAX) return 'Nama produk maksimal 200 karakter'
  return undefined
}

export function validateCategory(category: ProductCategory | ''): string | undefined {
  if (!category) return 'Pilih kategori produk'
  return undefined
}

export function validatePrice(price: number | ''): string | undefined {
  if (price === '' || Number.isNaN(Number(price))) return 'Harga tidak boleh kosong'
  const n = Number(price)
  if (n < PRICE_MIN) return 'Harga minimal Rp 100'
  if (n > PRICE_MAX) return 'Harga melebihi batas maksimal'
  return undefined
}

export function validateStock(stock: number | ''): string | undefined {
  if (stock === '') return 'Stok tidak boleh kosong'
  const n = Number(stock)
  if (!Number.isInteger(n)) return 'Stok harus bilangan bulat'
  if (n < STOCK_MIN) return 'Stok tidak boleh negatif'
  if (n > STOCK_MAX) return 'Stok melebihi batas maksimal'
  return undefined
}

export function validateDescription(description: string): string | undefined {
  const v = description.trim()
  if (!v) return 'Deskripsi tidak boleh kosong'
  if (v.length < DESC_MIN) return 'Deskripsi terlalu singkat, minimal 20 karakter'
  if (v.length > DESC_MAX) return 'Deskripsi maksimal 2000 karakter'
  return undefined
}

export function validateImages(count: number): string | undefined {
  if (count < 1) return 'Wajib upload minimal 1 gambar'
  if (count > MAX_PRODUCT_IMAGES) return `Maksimal ${MAX_PRODUCT_IMAGES} gambar per produk`
  return undefined
}

// Validasi satu file gambar (tipe & ukuran). Mengembalikan pesan error atau undefined.
export function validateImageFile(file: File): string | undefined {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return 'Format gambar tidak didukung, gunakan JPG, PNG, atau WEBP'
  }
  if (file.size > MAX_IMAGE_BYTES) return 'Ukuran gambar maksimal 2MB'
  return undefined
}

// === Validasi seluruh form (sinkron; tanpa cek duplikat SKU) ===

export type ProductFieldKey =
  | 'sku'
  | 'name'
  | 'category'
  | 'price'
  | 'stock'
  | 'description'
  | 'images'

export type ProductFieldErrors = Partial<Record<ProductFieldKey, string>>

export type ProductFormValues = {
  sku: string
  name: string
  category: ProductCategory | ''
  price: number | ''
  stock: number | ''
  description: string
  imageCount: number
}

// Urutan field untuk auto-scroll ke error pertama saat submit
export const PRODUCT_FIELD_ORDER: ProductFieldKey[] = [
  'sku',
  'name',
  'category',
  'price',
  'stock',
  'description',
  'images',
]

// Menjalankan semua validator sinkron sekaligus. Duplikat SKU (async) digabung terpisah.
export function validateProductForm(values: ProductFormValues): ProductFieldErrors {
  const errors: ProductFieldErrors = {}
  const sku = validateSkuFormat(values.sku)
  if (sku) errors.sku = sku
  const name = validateName(values.name)
  if (name) errors.name = name
  const category = validateCategory(values.category)
  if (category) errors.category = category
  const price = validatePrice(values.price)
  if (price) errors.price = price
  const stock = validateStock(values.stock)
  if (stock) errors.stock = stock
  const description = validateDescription(values.description)
  if (description) errors.description = description
  const images = validateImages(values.imageCount)
  if (images) errors.images = images
  return errors
}
