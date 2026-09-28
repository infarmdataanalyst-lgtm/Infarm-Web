// src/lib/mock-db/promotions.ts
// Akses data promo (dikelola oleh OMS).
//
// ISOLASI: seluruh akses data promo HANYA lewat fungsi di file ini, sehingga pemanggil
// (API Route) tidak perlu tahu sumber datanya. Di-back oleh Supabase (tabel public.promotions).
//
// SERVER-ONLY. Dua jenis client, dan pemilihannya disengaja (SEC-031):
//   - readActivePromotionsPublic() → createPublicClient() (anon, TUNDUK RLS). Khusus STOREFRONT.
//     Policy "Public dapat membaca promo aktif" (migration 20260907120000) hanya meloloskan
//     is_active = true.
//   - Selebihnya → createAdminClient() (service_role, menembus RLS). OMS butuh baris NONAKTIF, dan
//     orders/create menghitung tagihan dari baca otoritatif yang tak bergantung pada policy.
// Jangan diimpor dari komponen 'use client'.

import { createAdminClient, createPublicClient } from '@/lib/supabase/server'
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
  // Opsional di tipe: database yang belum menjalankan migration kuota tak punya kolomnya.
  usage_limit?: number | null
  usage_count?: number | null
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
    usageLimit: row.usage_limit ?? null,
    usageCount: row.usage_count ?? 0,
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
    // usage_count SENGAJA tak ditulis dari form: hanya create_order_with_items (tambah) dan
    // release_promo_quota (kurangi) yang boleh mengubahnya. Menyunting promo tak mereset pemakaian.
    usage_limit: input.usageLimit,
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

// Membaca promo AKTIF untuk STOREFRONT, lewat anon key (tunduk RLS, SEC-031).
//
// Policy database hanya meloloskan is_active = true, dan query ini tetap memfilter is_active
// sendiri — dua lapis yang sengaja bertumpuk. Jendela waktu (start_at/end_at) TIDAK disaring di
// sini; pemanggil yang memutuskan, karena storefront perlu membedakan "belum mulai" dari "tak ada".
//
// Array kosong bila error, termasuk bila policy/grant belum ada di sebuah lingkungan.
export async function readActivePromotionsPublic(): Promise<Promotion[]> {
  const supabase = createPublicClient()
  const { data, error } = await supabase
    .from('promotions')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Gagal membaca promo aktif (anon) dari Supabase:', error.message)
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

// === Kuota promo ===

// Mengembalikan kuota promo yang dipakai sebuah pesanan (dipanggil saat pesanan batal/kedaluwarsa,
// tepat di sebelah restoreStock). Idempoten di database (release_promo_quota menandai
// orders.promo_quota_released_at), jadi aman bila webhook dan penyapu terjadwal membatalkan pesanan
// yang sama. Best effort: gagal di sini tak boleh menggagalkan pembatalan — kuota yang tertahan
// hanya membuat promo habis sedikit lebih cepat, dan tercatat di log.
export async function releasePromoQuota(invoice: string): Promise<void> {
  const supabase = createAdminClient()
  const { data, error: readError } = await supabase
    .from('orders')
    .select('id')
    .eq('nomor_invoice', invoice)
    .maybeSingle()
  if (readError || !data) {
    if (readError) console.error(`[promo-kuota] gagal membaca pesanan ${invoice}:`, readError.message)
    return
  }

  const { error } = await supabase.rpc('release_promo_quota', { p_order_id: (data as { id: string }).id })
  if (error) {
    // PGRST202/42883 = fungsi belum ada (migration 20260928120000 belum dijalankan) → tak ada kuota
    // yang perlu dikembalikan. Galat lain dicatat.
    if (error.code === 'PGRST202' || error.code === '42883') return
    console.error(`[promo-kuota] gagal mengembalikan kuota promo ${invoice}:`, error.message)
  }
}
