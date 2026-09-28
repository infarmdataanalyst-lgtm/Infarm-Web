// src/lib/promo-quota.ts
// Aturan MURNI kuota promo di sisi server pesanan (tanpa I/O — diuji di tests/unit/promo-quota).
//
// Promo yang kuotanya penuh TIDAK diterapkan. Tapi pembeli tak boleh diam-diam ditagih lebih mahal
// dari yang ia lihat: bila promo itu masih ia KIRA berlaku (checkout mengirim `expectedPromoIds` =
// promo yang ia tampilkan), pesanan ditolak dengan pesan jujur, checkout memuat ulang promo, dan
// pembeli menyetujui total baru. Bila promo itu sudah tak ia lihat (checkout sudah memuat ulang),
// pesanan jalan tanpa promo itu.

import { isPromoEligible } from '@/lib/promo-cart'
import { isPromotionQuotaFull, type Promotion } from '@/types/promotion'

// Mengurai expectedPromoIds dari body. null = klien lama yang tak mengirimnya → dianggap
// mengharapkan SEMUA promo yang memenuhi syarat (paling aman: lebih baik menolak sekali daripada
// menagih lebih tanpa pemberitahuan).
export function parseExpectedPromoIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  return raw.filter((v): v is string => typeof v === 'string' && v.length > 0).slice(0, 50)
}

export type QuotaPlan = {
  // Promo yang boleh diterapkan (kuota masih ada / tanpa batas)
  available: Promotion[]
  // Promo yang memenuhi syarat & masih diharapkan pembeli, tapi kuotanya habis → tolak pesanan
  exhaustedExpected: Promotion[]
}

export function planPromoQuota(
  promotions: Promotion[],
  subtotal: number,
  nowMs: number,
  expectedPromoIds: string[] | null,
): QuotaPlan {
  const available = promotions.filter((p) => !isPromotionQuotaFull(p))
  const exhaustedExpected = promotions.filter(
    (p) =>
      isPromotionQuotaFull(p) &&
      isPromoEligible(p, subtotal, nowMs) &&
      (expectedPromoIds === null || expectedPromoIds.includes(p.id)),
  )
  return { available, exhaustedExpected }
}

// Pesan untuk pembeli bila kuota promo yang ia harapkan habis.
export function promoQuotaMessage(names: string[]): string {
  const daftar = names.length > 0 ? names.join(', ') : 'yang kamu pakai'
  return (
    `Kuota promo ${daftar} sudah habis, jadi total pembayaranmu berubah. ` +
    'Periksa kembali ringkasan pesanan, lalu tekan bayar lagi bila setuju.'
  )
}
