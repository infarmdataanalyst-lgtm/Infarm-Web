// src/lib/mock-db/warehouses.ts
// Akses data pergudangan ke Supabase — SERVER ONLY (memakai createAdminClient/service_role,
// karena tabel warehouses & product_stock_per_warehouse dikunci RLS tanpa policy publik).
// Jangan impor dari komponen 'use client'.
//
// Semua fungsi di sini TAHAN bila migration gudang belum di-apply: kode error Postgres/PostgREST
// untuk "tabel/kolom tak ada" ditangkap dan dikembalikan sebagai nilai kosong, sehingga aplikasi
// tetap jalan memakai kolom stok lama (products.stock / product_variants.stok).

import { createAdminClient } from '@/lib/supabase/server'
import type { Warehouse, WarehouseStock } from '@/types/warehouse'

// Kode error saat tabel/kolom belum ada di database.
// PGRST205/PGRST204 = skema tak dikenal PostgREST; 42P01 = tabel tak ada; 42703 = kolom tak ada.
const MISSING_SCHEMA_CODES = new Set(['PGRST205', 'PGRST204', '42P01', '42703'])

// true bila error menandakan skema gudang belum di-migrate (bukan kegagalan nyata).
export function isMissingWarehouseSchema(error: { code?: string } | null): boolean {
  return Boolean(error?.code && MISSING_SCHEMA_CODES.has(error.code))
}

// === Pemetaan baris DB <-> tipe aplikasi ===

type WarehouseRow = {
  id: string
  nama: string
  alamat: string | null
  mengantar_origin_id: string | null
  latitude: number | string | null
  longitude: number | string | null
  is_default: boolean
  is_active: boolean
  created_at: string
}

type StockRow = {
  id: string
  product_id: string
  variant_id: string | null
  warehouse_id: string
  stok: number
}

// numeric Postgres bisa datang sebagai string lewat PostgREST → normalkan ke number.
function toNumber(value: number | string | null): number | undefined {
  if (value === null) return undefined
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}

function rowToWarehouse(row: WarehouseRow): Warehouse {
  return {
    id: row.id,
    nama: row.nama,
    alamat: row.alamat ?? undefined,
    mengantarOriginId: row.mengantar_origin_id ?? undefined,
    latitude: toNumber(row.latitude),
    longitude: toNumber(row.longitude),
    isDefault: row.is_default,
    isActive: row.is_active,
    createdAt: row.created_at,
  }
}

function rowToStock(row: StockRow): WarehouseStock {
  return {
    id: row.id,
    productId: row.product_id,
    variantId: row.variant_id ?? undefined,
    warehouseId: row.warehouse_id,
    stok: row.stok,
  }
}

// === Baca gudang ===

// Membaca daftar gudang. `activeOnly` untuk menyembunyikan gudang nonaktif dari pemilihan order.
// Array kosong bila tabel belum ada atau terjadi error (pemanggil wajib punya fallback).
export async function readWarehouses(activeOnly = false): Promise<Warehouse[]> {
  const supabase = createAdminClient()
  let query = supabase.from('warehouses').select('*').order('created_at', { ascending: true })
  if (activeOnly) query = query.eq('is_active', true)

  const { data, error } = await query
  if (error) {
    if (!isMissingWarehouseSchema(error)) {
      console.error('Gagal membaca gudang dari Supabase:', error.message)
    }
    return []
  }
  return (data as WarehouseRow[]).map(rowToWarehouse)
}

// Mengambil gudang default (is_default = true). null bila belum ada / tabel belum di-migrate.
// Unik di level DB lewat index partial warehouses_single_default_idx.
export async function getDefaultWarehouseRow(): Promise<Warehouse | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('warehouses')
    .select('*')
    .eq('is_default', true)
    .limit(1)
    .maybeSingle()

  if (error) {
    if (!isMissingWarehouseSchema(error)) {
      console.error('Gagal membaca gudang default:', error.message)
    }
    return null
  }
  return data ? rowToWarehouse(data as WarehouseRow) : null
}

// Mengambil satu gudang berdasarkan id. null bila tidak ditemukan.
export async function getWarehouseById(id: string): Promise<Warehouse | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('warehouses').select('*').eq('id', id).maybeSingle()
  if (error) {
    if (!isMissingWarehouseSchema(error)) {
      console.error('Gagal membaca gudang:', error.message)
    }
    return null
  }
  return data ? rowToWarehouse(data as WarehouseRow) : null
}

// === Tulis gudang (OMS) ===

// Payload buat/ubah gudang dari form OMS. Field opsional dikirim undefined bila tak diisi.
export type WarehouseInput = {
  nama: string
  alamat?: string
  mengantarOriginId?: string
  latitude?: number
  longitude?: number
  isDefault?: boolean
  isActive?: boolean
}

// Mengosongkan flag default pada gudang lain. WAJIB dipanggil sebelum menandai default baru:
// index partial warehouses_single_default_idx menolak dua baris is_default=true sekaligus.
async function clearOtherDefaults(exceptId?: string): Promise<void> {
  const supabase = createAdminClient()
  let query = supabase.from('warehouses').update({ is_default: false }).eq('is_default', true)
  if (exceptId) query = query.neq('id', exceptId)
  const { error } = await query
  if (error) console.error('Gagal mengosongkan gudang default lama:', error.message)
}

function inputToRow(input: WarehouseInput): Record<string, unknown> {
  return {
    nama: input.nama.trim(),
    alamat: input.alamat?.trim() || null,
    mengantar_origin_id: input.mengantarOriginId?.trim() || null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    is_active: input.isActive ?? true,
  }
}

// Membuat gudang baru. Bila ditandai default, flag gudang lain dilepas lebih dulu.
export async function createWarehouse(input: WarehouseInput): Promise<Warehouse> {
  const supabase = createAdminClient()
  if (input.isDefault) await clearOtherDefaults()

  const { data, error } = await supabase
    .from('warehouses')
    .insert({ ...inputToRow(input), is_default: input.isDefault ?? false })
    .select('*')
    .single()

  if (error || !data) throw new Error(`Gagal membuat gudang: ${error?.message ?? 'tidak diketahui'}`)
  return rowToWarehouse(data as WarehouseRow)
}

// Memperbarui gudang. null bila id tidak ditemukan.
export async function updateWarehouse(
  id: string,
  input: WarehouseInput,
): Promise<Warehouse | null> {
  const supabase = createAdminClient()
  if (input.isDefault) await clearOtherDefaults(id)

  const row = { ...inputToRow(input) }
  // is_default hanya ditulis bila eksplisit true; melepas default dilakukan lewat setDefaultWarehouse
  // pada gudang lain, supaya tak pernah ada kondisi "tidak ada gudang default sama sekali".
  if (input.isDefault) row.is_default = true

  const { data, error } = await supabase
    .from('warehouses')
    .update(row)
    .eq('id', id)
    .select('*')
    .maybeSingle()

  if (error) throw new Error(`Gagal memperbarui gudang: ${error.message}`)
  return data ? rowToWarehouse(data as WarehouseRow) : null
}

// Menjadikan satu gudang sebagai default (dan melepas default sebelumnya).
// Gudang nonaktif ikut diaktifkan: default yang nonaktif akan membuat pemilihan gudang mode multi
// tak punya kandidat sah.
export async function setDefaultWarehouse(id: string): Promise<Warehouse | null> {
  await clearOtherDefaults(id)
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('warehouses')
    .update({ is_default: true, is_active: true })
    .eq('id', id)
    .select('*')
    .maybeSingle()

  if (error) throw new Error(`Gagal menetapkan gudang default: ${error.message}`)
  return data ? rowToWarehouse(data as WarehouseRow) : null
}

// Mengaktifkan/menonaktifkan gudang.
export async function setWarehouseActive(
  id: string,
  isActive: boolean,
): Promise<Warehouse | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('warehouses')
    .update({ is_active: isActive })
    .eq('id', id)
    .select('*')
    .maybeSingle()

  if (error) throw new Error(`Gagal mengubah status gudang: ${error.message}`)
  return data ? rowToWarehouse(data as WarehouseRow) : null
}

// Jumlah keterikatan data pada satu gudang — dipakai untuk memutuskan boleh dihapus atau tidak.
// Gudang yang pernah menyimpan stok / memenuhi pesanan TIDAK boleh dihapus (FK on delete restrict
// pada tabel stok akan menolaknya, dan menghapus jejak pesanan lama merusak riwayat).
export async function getWarehouseUsage(id: string): Promise<{ stockRows: number; orders: number }> {
  const supabase = createAdminClient()
  const [stock, orders] = await Promise.all([
    supabase
      .from('product_stock_per_warehouse')
      .select('*', { count: 'exact', head: true })
      .eq('warehouse_id', id),
    supabase.from('orders').select('*', { count: 'exact', head: true }).eq('warehouse_id', id),
  ])
  return { stockRows: stock.count ?? 0, orders: orders.count ?? 0 }
}

// Menghapus gudang. false bila tidak ditemukan. Pemanggil WAJIB memeriksa getWarehouseUsage
// dan status default lebih dulu — fungsi ini tidak menilai kelayakan hapus.
export async function deleteWarehouse(id: string): Promise<boolean> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('warehouses').delete().eq('id', id).select('id')
  if (error) throw new Error(`Gagal menghapus gudang: ${error.message}`)
  return Array.isArray(data) && data.length > 0
}

// === Baca stok per gudang ===

// Membaca baris stok, opsional difilter produk dan/atau gudang.
// Array kosong bila tabel belum ada → pemanggil jatuh ke kolom stok lama.
export async function readStockRows(filter?: {
  productIds?: string[]
  warehouseId?: string
}): Promise<WarehouseStock[]> {
  const supabase = createAdminClient()
  let query = supabase.from('product_stock_per_warehouse').select('*')
  if (filter?.productIds && filter.productIds.length > 0) {
    query = query.in('product_id', filter.productIds)
  }
  if (filter?.warehouseId) query = query.eq('warehouse_id', filter.warehouseId)

  const { data, error } = await query
  if (error) {
    if (!isMissingWarehouseSchema(error)) {
      console.error('Gagal membaca stok per gudang:', error.message)
    }
    return []
  }
  return (data as StockRow[]).map(rowToStock)
}

// === Tulis stok per gudang ===

// Menetapkan stok absolut satu produk/varian di satu gudang (upsert manual).
// Dipakai OMS saat admin menyimpan stok. false bila gagal / tabel belum ada → pemanggil
// tetap menulis kolom stok lama sebagai jaring pengaman.
export async function setWarehouseStock(input: {
  productId: string
  variantId?: string
  warehouseId: string
  stok: number
}): Promise<boolean> {
  const supabase = createAdminClient()
  const stok = Math.max(0, Math.floor(input.stok))

  // Upsert dilakukan manual (select → update/insert), bukan .upsert(), karena keunikan baris
  // dijaga DUA index partial (variant_id NULL vs terisi) — onConflict tak bisa menyebut keduanya.
  let query = supabase
    .from('product_stock_per_warehouse')
    .select('id')
    .eq('product_id', input.productId)
    .eq('warehouse_id', input.warehouseId)
  query = input.variantId ? query.eq('variant_id', input.variantId) : query.is('variant_id', null)

  const { data: existing, error: findError } = await query.maybeSingle()
  if (findError) {
    if (!isMissingWarehouseSchema(findError)) {
      console.error('Gagal mencari baris stok gudang:', findError.message)
    }
    return false
  }

  if (existing) {
    const { error } = await supabase
      .from('product_stock_per_warehouse')
      .update({ stok })
      .eq('id', (existing as { id: string }).id)
    if (error) {
      console.error('Gagal memperbarui stok gudang:', error.message)
      return false
    }
    return true
  }

  const { error } = await supabase.from('product_stock_per_warehouse').insert({
    product_id: input.productId,
    variant_id: input.variantId ?? null,
    warehouse_id: input.warehouseId,
    stok,
  })
  if (error) {
    if (!isMissingWarehouseSchema(error)) {
      console.error('Gagal menambah stok gudang:', error.message)
    }
    return false
  }
  return true
}

// Menambah/mengurangi stok relatif di satu gudang (dipakai saat pesanan dibatalkan).
// delta positif = stok kembali. Baris yang belum ada dilewati (tak dibuat) agar tidak
// memunculkan stok di gudang yang memang tak pernah menyimpan produk itu.
export async function adjustWarehouseStock(input: {
  productId: string
  variantId?: string
  warehouseId: string
  delta: number
}): Promise<boolean> {
  if (!input.delta) return false
  const supabase = createAdminClient()

  let query = supabase
    .from('product_stock_per_warehouse')
    .select('id, stok')
    .eq('product_id', input.productId)
    .eq('warehouse_id', input.warehouseId)
  query = input.variantId ? query.eq('variant_id', input.variantId) : query.is('variant_id', null)

  const { data, error } = await query.maybeSingle()
  if (error) {
    if (!isMissingWarehouseSchema(error)) {
      console.error('Gagal mencari baris stok gudang:', error.message)
    }
    return false
  }
  if (!data) return false

  const row = data as { id: string; stok: number }
  const { error: updateError } = await supabase
    .from('product_stock_per_warehouse')
    .update({ stok: Math.max(0, row.stok + input.delta) })
    .eq('id', row.id)

  if (updateError) {
    console.error('Gagal menyesuaikan stok gudang:', updateError.message)
    return false
  }
  return true
}
