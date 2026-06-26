// src/lib/mock-db/combos.ts
// Akses data paket/combo (dikelola oleh OMS).
//
// ISOLASI: seluruh akses data combo HANYA lewat fungsi di file ini, sehingga pemanggil
// (API Route) tidak perlu tahu sumber datanya. Di-back oleh Supabase
// (tabel public.product_combos + public.product_combo_items).
//
// SERVER-ONLY: memakai createAdminClient() (service_role) yang menembus RLS.
// Tabel combo terkunci dari publik → semua baca/tulis WAJIB lewat server.
// Jangan diimpor dari komponen 'use client'.

import { createAdminClient } from '@/lib/supabase/server'
import type { ProductCombo, ComboItem, ComboInput } from '@/types/combo'

// === Pemetaan baris DB <-> ProductCombo ===

type ComboRow = {
  id: string
  name: string
  combo_price: number
  is_active: boolean
  created_at: string
  // Item ter-embed lewat relasi FK combo_id (PostgREST nested select)
  product_combo_items?: ComboItemRow[]
}

type ComboItemRow = {
  id: string
  combo_id: string
  product_id: string
  name: string
  unit_price: number
  quantity: number
}

function rowToItem(row: ComboItemRow): ComboItem {
  return {
    productId: row.product_id,
    name: row.name,
    unitPrice: row.unit_price,
    quantity: row.quantity,
  }
}

function rowToCombo(row: ComboRow): ProductCombo {
  return {
    id: row.id,
    name: row.name,
    comboPrice: row.combo_price,
    isActive: row.is_active,
    items: (row.product_combo_items ?? []).map(rowToItem),
    createdAt: row.created_at,
  }
}

// Petakan item input → baris yang disisipkan ke product_combo_items untuk sebuah combo.
function itemsToRows(comboId: string, items: ComboItem[]) {
  return items.map((item) => ({
    combo_id: comboId,
    product_id: item.productId,
    name: item.name,
    unit_price: item.unitPrice,
    quantity: item.quantity,
  }))
}

// === Baca ===

// Membaca seluruh combo beserta itemnya, terbaru di depan.
// Array kosong bila terjadi error agar UI tidak crash.
export async function readCombos(): Promise<ProductCombo[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('product_combos')
    .select('*, product_combo_items(*)')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Gagal membaca combo dari Supabase:', error.message)
    return []
  }

  return (data as ComboRow[]).map(rowToCombo)
}

// Membaca satu combo berdasarkan id (beserta itemnya). null bila tidak ditemukan.
export async function getComboById(id: string): Promise<ProductCombo | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('product_combos')
    .select('*, product_combo_items(*)')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('Gagal membaca combo dari Supabase:', error.message)
    return null
  }

  return data ? rowToCombo(data as ComboRow) : null
}

// === Tulis ===

// Membuat combo baru: insert ke product_combos lalu insert semua item ke product_combo_items.
export async function createCombo(input: ComboInput): Promise<ProductCombo> {
  const supabase = createAdminClient()

  const { data: combo, error: comboError } = await supabase
    .from('product_combos')
    .insert({
      name: input.name,
      combo_price: input.comboPrice,
      is_active: input.isActive,
    })
    .select('id')
    .single()

  if (comboError || !combo) {
    throw new Error(`Gagal menyimpan combo: ${comboError?.message ?? 'tidak diketahui'}`)
  }

  const { error: itemsError } = await supabase
    .from('product_combo_items')
    .insert(itemsToRows(combo.id, input.items))

  if (itemsError) {
    // Rollback manual: hapus combo agar tidak tertinggal tanpa item (cascade ikut bersih)
    await supabase.from('product_combos').delete().eq('id', combo.id)
    throw new Error(`Gagal menyimpan item combo: ${itemsError.message}`)
  }

  const created = await getComboById(combo.id)
  if (!created) throw new Error('Combo tersimpan tetapi gagal dibaca ulang.')
  return created
}

// Memperbarui combo: update product_combos, hapus semua item lama, lalu insert ulang item baru.
// null bila combo tidak ditemukan.
export async function updateCombo(id: string, input: ComboInput): Promise<ProductCombo | null> {
  const supabase = createAdminClient()

  const { data: updated, error: updateError } = await supabase
    .from('product_combos')
    .update({
      name: input.name,
      combo_price: input.comboPrice,
      is_active: input.isActive,
    })
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (updateError) {
    console.error('Gagal memperbarui combo di Supabase:', updateError.message)
    return null
  }
  if (!updated) return null // combo tidak ditemukan

  // Ganti seluruh item: hapus yang lama lalu insert ulang (pendekatan paling sederhana & konsisten)
  const { error: delError } = await supabase
    .from('product_combo_items')
    .delete()
    .eq('combo_id', id)
  if (delError) {
    console.error('Gagal menghapus item combo lama:', delError.message)
    return null
  }

  const { error: insError } = await supabase
    .from('product_combo_items')
    .insert(itemsToRows(id, input.items))
  if (insError) {
    console.error('Gagal menyisipkan item combo baru:', insError.message)
    return null
  }

  return getComboById(id)
}

// === Ubah status ===

// Mengaktifkan / menonaktifkan combo (kolom is_active). null bila tidak ditemukan.
export async function setComboActive(id: string, isActive: boolean): Promise<ProductCombo | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('product_combos')
    .update({ is_active: isActive })
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('Gagal mengubah status combo:', error.message)
    return null
  }
  if (!data) return null

  return getComboById(id)
}

// === Hapus ===

// Menghapus combo berdasarkan id. Item ikut terhapus otomatis (ON DELETE CASCADE).
// true bila terhapus, false bila tidak ditemukan.
export async function deleteCombo(id: string): Promise<boolean> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('product_combos')
    .delete()
    .eq('id', id)
    .select('id')

  if (error) {
    console.error('Gagal menghapus combo di Supabase:', error.message)
    return false
  }

  return (data?.length ?? 0) > 0
}
