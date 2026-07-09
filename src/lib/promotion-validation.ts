// src/lib/promotion-validation.ts
// Validasi payload promo di sisi SERVER (jangan percaya input client mentah-mentah).
// Dipakai bersama oleh POST /api/promotions/create dan PATCH /api/promotions/update.
// Aturan harus konsisten dengan validasi inline di PromotionForm.

import type { PromotionInput, PromotionType } from '@/types/promotion'

const TYPES: PromotionType[] = [
  'free_shipping',
  'free_product',
  'discount_nominal',
  'discount_percent',
]

export type PromotionValidation =
  | { ok: true; value: PromotionInput }
  | { ok: false; error: string }

// Memvalidasi & menormalkan body menjadi PromotionInput, atau mengembalikan pesan error.
export function validatePromotionInput(body: unknown): PromotionValidation {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Body bukan objek yang valid.' }
  }
  const b = body as Record<string, unknown>

  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (name.length < 3) {
    return { ok: false, error: 'Nama promo wajib diisi minimal 3 karakter.' }
  }

  const type = b.type as PromotionType
  if (!TYPES.includes(type)) {
    return { ok: false, error: 'Tipe hadiah wajib dipilih.' }
  }

  const minPurchase = typeof b.minPurchase === 'number' ? Math.floor(b.minPurchase) : NaN
  if (!Number.isFinite(minPurchase) || minPurchase < 1000) {
    return { ok: false, error: 'Minimal pembelian wajib diisi (minimal Rp1.000).' }
  }

  const progressMessage = typeof b.progressMessage === 'string' ? b.progressMessage.trim() : ''
  if (!progressMessage) {
    return { ok: false, error: 'Pesan progres wajib diisi.' }
  }

  // Detail hadiah — sesuai tipe yang dipilih
  let freeProductId: string | null = null
  let freeProductName: string | null = null
  let discountValue: number | null = null

  if (type === 'free_product') {
    if (typeof b.freeProductId !== 'string' || !b.freeProductId) {
      return { ok: false, error: 'Produk hadiah wajib dipilih.' }
    }
    freeProductId = b.freeProductId
    freeProductName = typeof b.freeProductName === 'string' ? b.freeProductName : ''
  } else if (type === 'discount_nominal') {
    const v = typeof b.discountValue === 'number' ? Math.floor(b.discountValue) : NaN
    if (!Number.isFinite(v) || v <= 0) {
      return { ok: false, error: 'Nilai diskon wajib diisi.' }
    }
    if (v > minPurchase) {
      return { ok: false, error: 'Nilai diskon tidak boleh lebih besar dari minimal pembelian.' }
    }
    discountValue = v
  } else if (type === 'discount_percent') {
    const v = typeof b.discountValue === 'number' ? Math.floor(b.discountValue) : NaN
    if (!Number.isFinite(v) || v < 1 || v > 100) {
      return { ok: false, error: 'Persen diskon harus antara 1–100.' }
    }
    discountValue = v
  }

  // Periode (opsional). Bila berakhir diisi → mulai wajib; berakhir tidak boleh sebelum mulai.
  const startAt = typeof b.startAt === 'string' && b.startAt ? b.startAt : null
  const endAt = typeof b.endAt === 'string' && b.endAt ? b.endAt : null
  if (endAt && !startAt) {
    return { ok: false, error: 'Tanggal mulai wajib diisi jika tanggal berakhir diatur.' }
  }
  if (startAt && endAt && new Date(endAt).getTime() < new Date(startAt).getTime()) {
    return { ok: false, error: 'Tanggal berakhir harus setelah tanggal mulai.' }
  }

  const isActive = typeof b.isActive === 'boolean' ? b.isActive : true

  return {
    ok: true,
    value: {
      name,
      type,
      minPurchase,
      freeProductId,
      freeProductName,
      discountValue,
      startAt,
      endAt,
      progressMessage,
      isActive,
    },
  }
}
