// src/lib/mock-db/stock-mutations.ts
// Akses data riwayat mutasi stok ke Supabase — SERVER ONLY (createAdminClient/service_role,
// tabel stock_mutations dikunci RLS tanpa policy publik). Jangan impor dari komponen 'use client'.
//
// Pencatatan bersifat BEST EFFORT: gagal menulis riwayat TIDAK boleh menggagalkan perubahan stok
// (apalagi pembuatan pesanan). Semua error dicatat ke console lalu ditelan — stok tetap benar,
// hanya barisnya yang tak tercatat. Pemanggil karena itu tak perlu try/catch.

import { createAdminClient } from '@/lib/supabase/server'
import type { StockMutation, StockMutationReason } from '@/types/stock-mutation'

// Kode error saat tabel belum di-migrate (pola sama dengan mock-db/warehouses.ts).
const MISSING_SCHEMA_CODES = new Set(['PGRST205', 'PGRST204', '42P01', '42703'])

function isMissingSchema(error: { code?: string } | null): boolean {
  return Boolean(error?.code && MISSING_SCHEMA_CODES.has(error.code))
}

type StockMutationRow = {
  id: string
  product_id: string | null
  variant_id: string | null
  warehouse_id: string | null
  product_name: string
  variant_name: string | null
  warehouse_name: string
  changed_by: string | null
  changed_by_name: string | null
  stok_before: number
  stok_after: number
  reason: string
  order_id: string | null
  order_invoice: string | null
  created_at: string
}

function rowToMutation(row: StockMutationRow): StockMutation {
  const mutation: StockMutation = {
    id: row.id,
    productName: row.product_name,
    warehouseName: row.warehouse_name,
    stokBefore: row.stok_before,
    stokAfter: row.stok_after,
    reason: row.reason as StockMutationReason,
    createdAt: row.created_at,
  }
  if (row.product_id) mutation.productId = row.product_id
  if (row.variant_id) mutation.variantId = row.variant_id
  if (row.warehouse_id) mutation.warehouseId = row.warehouse_id
  if (row.variant_name) mutation.variantName = row.variant_name
  if (row.changed_by) mutation.changedBy = row.changed_by
  if (row.changed_by_name) mutation.changedByName = row.changed_by_name
  if (row.order_id) mutation.orderId = row.order_id
  if (row.order_invoice) mutation.orderInvoice = row.order_invoice
  return mutation
}

// === Tulis ===

// Satu perubahan stok yang akan dicatat.
export type StockMutationInput = {
  productId?: string
  variantId?: string
  warehouseId?: string
  productName: string
  variantName?: string
  warehouseName: string
  changedBy?: string
  changedByName?: string
  stokBefore: number
  stokAfter: number
  reason: StockMutationReason
  orderId?: string
  orderInvoice?: string
}

// Mencatat satu/banyak mutasi dalam SATU insert. Baris yang stoknya tidak berubah dibuang di sini
// supaya riwayat tak dipenuhi baris "10 → 10" saat admin blur dari sel tanpa mengedit.
export async function logStockMutations(inputs: StockMutationInput[]): Promise<void> {
  const changed = inputs.filter((i) => i.stokBefore !== i.stokAfter)
  if (changed.length === 0) return

  const supabase = createAdminClient()
  const { error } = await supabase.from('stock_mutations').insert(
    changed.map((i) => ({
      product_id: i.productId ?? null,
      variant_id: i.variantId ?? null,
      warehouse_id: i.warehouseId ?? null,
      product_name: i.productName,
      variant_name: i.variantName ?? null,
      warehouse_name: i.warehouseName,
      changed_by: i.changedBy ?? null,
      changed_by_name: i.changedByName ?? null,
      stok_before: Math.trunc(i.stokBefore),
      stok_after: Math.trunc(i.stokAfter),
      reason: i.reason,
      order_id: i.orderId ?? null,
      order_invoice: i.orderInvoice ?? null,
    })),
  )

  if (error && !isMissingSchema(error)) {
    // Sengaja tidak dilempar: stok sudah berubah/pesanan sudah tersimpan, dan menggagalkan
    // operasi di titik ini akan lebih merugikan daripada kehilangan satu baris riwayat.
    console.error('Gagal mencatat riwayat mutasi stok:', error.message)
  }
}

// === Baca ===

// Membaca riwayat kronologis (terbaru dulu). `productId` untuk melihat riwayat satu produk saja.
// Array kosong bila tabel belum di-migrate — halaman riwayat menampilkan keadaan kosong.
export async function readStockMutations(options?: {
  productId?: string
  limit?: number
}): Promise<StockMutation[]> {
  const supabase = createAdminClient()
  let query = supabase
    .from('stock_mutations')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(options?.limit ?? 200)

  if (options?.productId) query = query.eq('product_id', options.productId)

  const { data, error } = await query
  if (error) {
    if (!isMissingSchema(error)) {
      console.error('Gagal membaca riwayat mutasi stok:', error.message)
    }
    return []
  }
  return (data as StockMutationRow[]).map(rowToMutation)
}
