// src/types/promotion.ts
// Tipe data promo untuk fitur "Promosi" di OMS. Dipetakan dari tabel public.promotions (Supabase).

// Tipe hadiah promo
export type PromotionType = 'free_shipping' | 'free_product' | 'discount_nominal' | 'discount_percent'

// Label tampilan tiap tipe hadiah (dipakai badge tabel & dropdown form)
export const PROMOTION_TYPE_LABELS: Record<PromotionType, string> = {
  free_shipping: 'Gratis Ongkir',
  free_product: 'Gratis Produk',
  discount_nominal: 'Diskon Nominal',
  discount_percent: 'Diskon Persen',
}

// Promo lengkap yang disimpan & ditampilkan di OMS.
export type Promotion = {
  id: string
  name: string
  type: PromotionType
  minPurchase: number // minimal pembelian (rupiah)
  freeProductId: string | null // untuk free_product: id produk hadiah (snapshot, tanpa FK)
  freeProductName: string | null // snapshot nama produk hadiah
  discountValue: number | null // discount_nominal → rupiah; discount_percent → persen (1-100)
  startAt: string | null // ISO; null = tak terbatas
  endAt: string | null // ISO; null = tak terbatas
  progressMessage: string // pesan progres di keranjang (boleh memuat token {sisa})
  isActive: boolean
  createdAt: string // ISO date, untuk urutan terbaru
}

// Payload dari form OMS untuk membuat / memperbarui promo (sebelum disimpan).
export type PromotionInput = {
  name: string
  type: PromotionType
  minPurchase: number
  freeProductId: string | null
  freeProductName: string | null
  discountValue: number | null
  startAt: string | null
  endAt: string | null
  progressMessage: string
  isActive: boolean
}

// Promo kedaluwarsa bila endAt terisi & sudah lewat dari "sekarang".
// Status Kedaluwarsa TIDAK disimpan di DB — dihitung di frontend (nowMs dari client).
export function isPromotionExpired(endAt: string | null, nowMs: number): boolean {
  if (!endAt) return false
  return new Date(endAt).getTime() < nowMs
}
