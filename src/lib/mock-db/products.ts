// src/lib/mock-db/products.ts
// Mock database produk berbasis file JSON lokal (rapid prototyping, pengganti Supabase sementara).
//
// ISOLASI: seluruh akses data produk lewat fungsi di file ini.
// Migrasi ke Supabase nanti cukup ganti isi readProducts()/saveProduct() — signature tetap sama.
//
// CATATAN: memakai Node 'fs' → hanya untuk server (API Route / Server Component).

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { StoredProduct, CreateProductInput } from '@/types/product'

const PRODUCTS_FILE = path.join(process.cwd(), 'src', 'data', 'products.json')

// === Baca ===

// Membaca seluruh produk hasil input OMS. Array kosong bila file belum ada/rusak.
export async function readProducts(): Promise<StoredProduct[]> {
  try {
    const raw = await fs.readFile(PRODUCTS_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as StoredProduct[]) : []
  } catch {
    return []
  }
}

// === Tulis ===

// Menambahkan produk baru dari OMS ke products.json lalu mengembalikan produk tersimpan.
// Opsi harga sederhana: originalPrice = promoPrice = price (tanpa diskon).
export async function saveProduct(input: CreateProductInput): Promise<StoredProduct> {
  const products = await readProducts()

  // ID unik berbasis waktu agar mudah dibaca & tidak bentrok dengan dummy
  const id = `oms-${Date.now()}`

  const product: StoredProduct = {
    id,
    name: input.name,
    originalPrice: input.price,
    promoPrice: input.price,
    imageUrl: input.imageUrl?.trim() || '/images/product-placeholder.png',
    category: input.category,
    badge: 'Baru', // tandai produk baru dari OMS
    sku: input.sku,
    stock: input.stock,
    description: input.description,
    createdAt: new Date().toISOString(),
  }

  // Produk terbaru di depan agar tampil paling atas
  products.unshift(product)

  await fs.writeFile(PRODUCTS_FILE, JSON.stringify(products, null, 2), 'utf-8')
  return product
}

// === Ubah ===

// Memperbarui sebagian field produk berdasarkan id. null bila produk tidak ditemukan.
export async function updateProduct(
  id: string,
  patch: Partial<Omit<StoredProduct, 'id' | 'createdAt'>>,
): Promise<StoredProduct | null> {
  const products = await readProducts()
  const index = products.findIndex((p) => p.id === id)
  if (index === -1) return null

  const updated: StoredProduct = { ...products[index], ...patch }
  products[index] = updated

  await fs.writeFile(PRODUCTS_FILE, JSON.stringify(products, null, 2), 'utf-8')
  return updated
}

// === Hapus ===

// Menghapus produk berdasarkan id. true bila terhapus, false bila tidak ditemukan.
export async function deleteProduct(id: string): Promise<boolean> {
  const products = await readProducts()
  const next = products.filter((p) => p.id !== id)
  if (next.length === products.length) return false

  await fs.writeFile(PRODUCTS_FILE, JSON.stringify(next, null, 2), 'utf-8')
  return true
}
