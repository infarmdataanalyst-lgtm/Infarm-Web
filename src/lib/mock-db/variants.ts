// src/lib/mock-db/variants.ts
// Akses data varian produk (public.product_variants). SERVER-ONLY (createAdminClient menembus RLS).
// Varian OPSIONAL: produk tanpa baris varian → fungsi kembalikan array kosong (pemanggil pakai harga
// & stok dari tabel products seperti biasa). Jangan diimpor dari komponen 'use client'.

import { createAdminClient } from '@/lib/supabase/server'
import { getEffectiveStockMaps, writeEffectiveStock } from '@/lib/warehouse'
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
// Nilai `stock` = STOK EFEKTIF dari product_stock_per_warehouse (sejumlah semua gudang), sama
// perlakuannya seperti produk biasa di readProducts. Kolom product_variants.stok hanya dipakai
// bila varian itu belum punya baris gudang.
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
  const variants = ((data as VariantRow[]) ?? []).map(rowToVariant)
  if (variants.length === 0) return variants

  // Overlay stok gudang. Tanpa ini, stok varian yang diedit di halaman "Kelola Stok Gudang"
  // tak akan pernah terlihat di storefront (VariantSelector membaca daftar ini).
  const { byVariant } = await getEffectiveStockMaps([productId])
  if (byVariant.size === 0) return variants
  return variants.map((v) => (byVariant.has(v.id) ? { ...v, stock: byVariant.get(v.id) ?? 0 } : v))
}

// Membaca SELURUH varian (semua produk) — dipakai matrix "Kelola Stok Gudang" agar tak perlu
// satu query per produk. Stok di sini SENGAJA nilai kolom lama: matrix menghitung totalnya
// sendiri dari baris per gudang.
export async function readAllVariants(): Promise<ProductVariant[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('product_variants')
    .select('*')
    .order('product_id', { ascending: true })
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Gagal membaca seluruh varian dari Supabase:', error.message)
    return []
  }
  return ((data as VariantRow[]) ?? []).map(rowToVariant)
}

// Menyelaraskan kolom lama product_variants.stok dengan total stok varian di semua gudang.
// Dipanggil setelah menulis stok varian per gudang. Kolom lama tetap diisi sebagai jaring
// pengaman untuk jalur baca yang belum memakai overlay stok gudang.
export async function syncVariantLegacyStock(variantId: string, stok: number): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('product_variants')
    .update({ stok: Math.max(0, Math.trunc(stok)) })
    .eq('id', variantId)
  if (error) console.error('Gagal menyelaraskan stok lama varian:', error.message)
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
  // Catat stok awal varian ke gudang (mode single → gudang default). Kolom product_variants.stok
  // di atas tetap terisi sebagai fallback bila tabel gudang belum di-migrate.
  await writeEffectiveStock({
    productId: created.productId,
    variantId: created.id,
    stok: input.stock,
  })
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
  // Stok varian juga disimpan per gudang. Berbeda dengan produk, kolom product_variants.stok
  // TETAP ikut ditulis di atas: pembaca varian (detail produk, bottom-sheet, RPC fallback)
  // membacanya langsung, dan overlay batch belum dipasang di jalur varian.
  await writeEffectiveStock({
    productId: updated.productId,
    variantId: updated.id,
    stok: input.stock,
  })
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
