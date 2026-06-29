// src/lib/mock-db/promotions.ts
// Akses data promo (dikelola oleh OMS).
//
// ISOLASI: seluruh akses data promo HANYA lewat fungsi di file ini, sehingga pemanggil
// (API Route) tidak perlu tahu sumber datanya. Di-back oleh Supabase (tabel public.promotions).
//
// SERVER-ONLY: memakai createAdminClient() (service_role) yang menembus RLS.
// Tabel promotions terkunci dari publik → semua baca/tulis WAJIB lewat server.
// Jangan diimpor dari komponen 'use client'.

import { createAdminClient } from '@/lib/supabase/server'
import type { Promotion, PromotionInput, PromotionType } from '@/types/promotion'

// === Pemetaan baris DB <-> Promotion ===

type PromotionRow = {
  id: string
  name: string
  type: PromotionType
  min_purchase: number
  free_product_id: string | null
  free_product_name: string | null
  discount_value: number | null
  start_at: string | null
  end_at: string | null
  progress_message: string
  is_active: boolean
  created_at: string
}

function rowToPromotion(row: PromotionRow): Promotion {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    minPurchase: row.min_purchase,
    freeProductId: row.free_product_id,
    freeProductName: row.free_product_name,
    discountValue: row.discount_value,
    startAt: row.start_at,
    endAt: row.end_at,
    progressMessage: row.progress_message,
    isActive: row.is_active,
    createdAt: row.created_at,
  }
}

// Petakan input form → baris kolom snake_case untuk insert/update.
function inputToRow(input: PromotionInput) {
  return {
    name: input.name,
    type: input.type,
    min_purchase: input.minPurchase,
    free_product_id: input.freeProductId,
    free_product_name: input.freeProductName,
    discount_value: input.discountValue,
    start_at: input.startAt,
    end_at: input.endAt,
    progress_message: input.progressMessage,
    is_active: input.isActive,
  }
}

// === Baca ===

// Membaca seluruh promo, terbaru di depan. Array kosong bila error agar UI tidak crash.
export async function readPromotions(): Promise<Promotion[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('promotions')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Gagal membaca promo dari Supabase:', error.message)
    return []
  }

  return (data as PromotionRow[]).map(rowToPromotion)
}

// Membaca satu promo berdasarkan id. null bila tidak ditemukan.
export async function getPromotionById(id: string): Promise<Promotion | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('promotions')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('Gagal membaca promo dari Supabase:', error.message)
    return null
  }

  return data ? rowToPromotion(data as PromotionRow) : null
}

// === Tulis ===

// Membuat promo baru.
export async function createPromotion(input: PromotionInput): Promise<Promotion> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('promotions')
    .insert(inputToRow(input))
    .select('*')
    .single()

  if (error || !data) {
    throw new Error(`Gagal menyimpan promo: ${error?.message ?? 'tidak diketahui'}`)
  }

  return rowToPromotion(data as PromotionRow)
}

// Memperbarui promo. null bila promo tidak ditemukan.
export async function updatePromotion(id: string, input: PromotionInput): Promise<Promotion | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('promotions')
    .update(inputToRow(input))
    .eq('id', id)
    .select('*')
    .maybeSingle()

  if (error) {
    console.error('Gagal memperbarui promo di Supabase:', error.message)
    return null
  }

  return data ? rowToPromotion(data as PromotionRow) : null
}

// === Ubah status ===

// Mengaktifkan / menonaktifkan promo (kolom is_active). null bila tidak ditemukan.
export async function setPromotionActive(id: string, isActive: boolean): Promise<Promotion | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('promotions')
    .update({ is_active: isActive })
    .eq('id', id)
    .select('*')
    .maybeSingle()

  if (error) {
    console.error('Gagal mengubah status promo:', error.message)
    return null
  }

  return data ? rowToPromotion(data as PromotionRow) : null
}

// === Hapus ===

// Menghapus promo berdasarkan id. true bila terhapus, false bila tidak ditemukan.
export async function deletePromotion(id: string): Promise<boolean> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('promotions')
    .delete()
    .eq('id', id)
    .select('id')

  if (error) {
    console.error('Gagal menghapus promo di Supabase:', error.message)
    return false
  }

  return (data?.length ?? 0) > 0
}
