// src/lib/mock-db/variants.ts
// Akses data varian produk (public.product_variants). SERVER-ONLY (createAdminClient menembus RLS).
// Varian OPSIONAL: produk tanpa baris varian → fungsi kembalikan array kosong (pemanggil pakai harga
// & stok dari tabel products seperti biasa). Jangan diimpor dari komponen 'use client'.

import { createAdminClient } from '@/lib/supabase/server'
import type { ProductVariant } from '@/types/variant'

type VariantRow = {
  id: string
  product_id: string
  nama_varian: string
  sku: string
  harga: number
  stok: number
  is_default: boolean
  created_at: string
}

// Ubah baris DB → ProductVariant (snake_case → camelCase).
function rowToVariant(row: VariantRow): ProductVariant {
  return {
    id: row.id,
    productId: row.product_id,
    name: row.nama_varian,
    sku: row.sku,
    price: row.harga,
    stock: row.stok,
    isDefault: row.is_default,
    createdAt: row.created_at,
  }
}

// Membaca semua varian sebuah produk (urut: default dulu, lalu terlama). Kosong bila produk tak bervarian.
export async function getVariantsByProduct(productId: string): Promise<ProductVariant[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('product_variants')
    .select('*')
    .eq('product_id', productId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })

  if (error) {
    // Tabel belum di-migrate / error lain → anggap tak bervarian (produk tetap jalan normal)
    console.error('Gagal membaca varian produk dari Supabase:', error.message)
    return []
  }
  return ((data as VariantRow[]) ?? []).map(rowToVariant)
}

// Membaca beberapa varian sekaligus by id (dipakai saat resolve nama varian di order/keranjang).
// Kembalikan Map id→ProductVariant. Array id kosong → Map kosong.
export async function getVariantsByIds(ids: string[]): Promise<Map<string, ProductVariant>> {
  const map = new Map<string, ProductVariant>()
  const unique = [...new Set(ids)].filter(Boolean)
  if (unique.length === 0) return map
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('product_variants').select('*').in('id', unique)
  if (error) {
    console.error('Gagal membaca varian (by ids) dari Supabase:', error.message)
    return map
  }
  for (const row of (data as VariantRow[]) ?? []) map.set(row.id, rowToVariant(row))
  return map
}

// === Ringkasan varian per produk (untuk tampilan list OMS) ===
export type VariantSummary = {
  count: number // jumlah varian
  totalStock: number // total stok semua varian
  minPrice: number
  maxPrice: number
}

// Peta productId → ringkasan varian (jumlah, total stok, rentang harga). Produk tanpa varian tak masuk peta.
export async function getVariantSummaries(): Promise<Map<string, VariantSummary>> {
  const map = new Map<string, VariantSummary>()
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('product_variants')
    .select('product_id, harga, stok')
  if (error) {
    console.error('Gagal membaca ringkasan varian dari Supabase:', error.message)
    return map
  }
  for (const r of (data as { product_id: string; harga: number; stok: number }[] | null) ?? []) {
    const prev = map.get(r.product_id)
    if (prev) {
      prev.count += 1
      prev.totalStock += r.stok
      prev.minPrice = Math.min(prev.minPrice, r.harga)
      prev.maxPrice = Math.max(prev.maxPrice, r.harga)
    } else {
      map.set(r.product_id, { count: 1, totalStock: r.stok, minPrice: r.harga, maxPrice: r.harga })
    }
  }
  return map
}

// === Tulis (OMS) ===

// Payload buat/ubah varian (dari form OMS).
export type VariantInput = {
  productId: string
  name: string
  sku: string
  price: number
  stock: number
  isDefault: boolean
}

// Bila varian di-set default, hilangkan flag default varian lain pada produk yang sama (hanya 1 default).
async function clearOtherDefaults(
  supabase: ReturnType<typeof createAdminClient>,
  productId: string,
  exceptId?: string,
): Promise<void> {
  let q = supabase.from('product_variants').update({ is_default: false }).eq('product_id', productId)
  if (exceptId) q = q.neq('id', exceptId)
  await q
}

// Membuat varian baru. Melempar Error('SKU_DUPLICATE') bila SKU sudah dipakai (unique violation).
export async function createVariant(input: VariantInput): Promise<ProductVariant> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('product_variants')
    .insert({
      product_id: input.productId,
      nama_varian: input.name,
      sku: input.sku,
      harga: input.price,
      stok: input.stock,
      is_default: input.isDefault,
    })
    .select('*')
    .single()
  if (error) {
    if (error.code === '23505') throw new Error('SKU_DUPLICATE')
    throw new Error(`Gagal membuat varian: ${error.message}`)
  }
  const created = rowToVariant(data as VariantRow)
  if (created.isDefault) await clearOtherDefaults(supabase, created.productId, created.id)
  return created
}

// Memperbarui varian. Melempar Error('SKU_DUPLICATE') bila SKU bentrok.
export async function updateVariant(id: string, input: VariantInput): Promise<ProductVariant | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('product_variants')
    .update({
      nama_varian: input.name,
      sku: input.sku,
      harga: input.price,
      stok: input.stock,
      is_default: input.isDefault,
    })
    .eq('id', id)
    .select('*')
    .maybeSingle()
  if (error) {
    if (error.code === '23505') throw new Error('SKU_DUPLICATE')
    throw new Error(`Gagal memperbarui varian: ${error.message}`)
  }
  if (!data) return null
  const updated = rowToVariant(data as VariantRow)
  if (updated.isDefault) await clearOtherDefaults(supabase, updated.productId, updated.id)
  return updated
}

// Menghapus varian. true bila berhasil.
export async function deleteVariant(id: string): Promise<boolean> {
  const supabase = createAdminClient()
  const { error } = await supabase.from('product_variants').delete().eq('id', id)
  if (error) {
    console.error('Gagal menghapus varian dari Supabase:', error.message)
    return false
  }
  return true
}

// Cek apakah SKU varian sudah dipakai (untuk validasi form; excludeId saat edit).
export async function isVariantSkuTaken(sku: string, excludeId?: string): Promise<boolean> {
  const supabase = createAdminClient()
  let q = supabase.from('product_variants').select('id').eq('sku', sku)
  if (excludeId) q = q.neq('id', excludeId)
  const { data } = await q.limit(1)
  return ((data as { id: string }[] | null) ?? []).length > 0
}
