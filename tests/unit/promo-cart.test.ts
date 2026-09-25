// tests/unit/promo-cart.test.ts
// computeOrderPromos menentukan BERAPA YANG DITAGIHKAN ke pembeli. Keranjang dan
// /api/orders/create memanggil fungsi yang sama persis, jadi selama fungsi ini benar, angka di
// layar dan angka di tagihan mustahil berbeda — dan kalau ia salah, keduanya salah bersamaan
// tanpa satu pun tanda.

import { describe, expect, it } from 'vitest'
import { computeOrderPromos } from '@/lib/promo-cart'
import type { Promotion, PromotionType } from '@/types/promotion'

// Promo minimum yang sah. Field yang tak relevan bagi perhitungan diisi nilai netral.
function promo(over: Partial<Promotion> & { type: PromotionType }): Promotion {
  return {
    id: over.id ?? 'p1',
    name: over.name ?? 'Promo Uji',
    type: over.type,
    minPurchase: over.minPurchase ?? 0,
    freeProductId: null,
    freeProductName: null,
    discountValue: over.discountValue ?? null,
    startAt: over.startAt ?? null,
    endAt: over.endAt ?? null,
    progressMessage: '',
    isActive: over.isActive ?? true,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

const NOW = Date.parse('2026-09-23T03:00:00.000Z')
const LIMITS = { maxDiscountPercent: 50, minTotal: 10_000 }

describe('computeOrderPromos', () => {
  it('menjumlah diskon nominal, tapi hanya memakai persen TERTINGGI', () => {
    // Aturan pemilik proyek 2026-09-07: dua promo 30% tidak menjadi 60%. Menumpuk persen hampir
    // tak pernah disengaja dan paling cepat menggerus margin.
    const hasil = computeOrderPromos(
      [
        promo({ id: 'n1', type: 'discount_nominal', discountValue: 5_000 }),
        promo({ id: 'n2', type: 'discount_nominal', discountValue: 3_000 }),
        promo({ id: 'p30', type: 'discount_percent', discountValue: 30 }),
        promo({ id: 'p10', type: 'discount_percent', discountValue: 10 }),
      ],
      100_000,
      10_000,
      NOW,
      LIMITS,
    )

    // 5.000 + 3.000 + 30% dari 100.000 = 38.000. Persen 10% tidak ikut.
    expect(hasil.discount).toBe(38_000)
    expect(hasil.appliedPromos.map((p) => p.id)).toEqual(['n1', 'n2', 'p30'])
  })

  it('memotong diskon di plafon dan menandainya', () => {
    const hasil = computeOrderPromos(
      [promo({ type: 'discount_nominal', discountValue: 90_000 })],
      100_000,
      10_000,
      NOW,
      LIMITS,
    )

    expect(hasil.discount).toBe(50_000) // plafon 50% dari subtotal
    expect(hasil.clampedByCap).toBe(true)
  })

  it('mensubsidi ongkir penuh saat gratis ongkir berlaku', () => {
    const hasil = computeOrderPromos(
      [promo({ type: 'free_shipping' })],
      100_000,
      12_345,
      NOW,
      LIMITS,
    )

    expect(hasil.shippingSubsidy).toBe(12_345)
    expect(hasil.discount).toBe(0)
  })

  it('mengabaikan promo kedaluwarsa, belum mulai, nonaktif, dan yang minimalnya belum tercapai', () => {
    // Penyaringan waktu WAJIB ada di sini, bukan hanya di endpoint promo: /api/orders/create
    // bersifat publik, jadi promo kedaluwarsa bisa datang dari pemanggil yang tak lewat keranjang.
    const hasil = computeOrderPromos(
      [
        promo({ id: 'habis', type: 'discount_nominal', discountValue: 9_000, endAt: '2026-09-22T00:00:00.000Z' }),
        promo({ id: 'belum', type: 'discount_nominal', discountValue: 9_000, startAt: '2026-09-24T00:00:00.000Z' }),
        promo({ id: 'mati', type: 'discount_nominal', discountValue: 9_000, isActive: false }),
        promo({ id: 'kurang', type: 'discount_nominal', discountValue: 9_000, minPurchase: 200_000 }),
      ],
      100_000,
      10_000,
      NOW,
      LIMITS,
    )

    expect(hasil.discount).toBe(0)
    expect(hasil.appliedPromos).toEqual([])
  })

  it('menahan total di batas gateway dengan mengurangi diskon lebih dulu', () => {
    // Pesanan yang totalnya di bawah batas Xendit MUSTAHIL ditagihkan. Diskon yang sedikit
    // berkurang jauh lebih baik daripada pesanan yang tak bisa dibayar sama sekali.
    const hasil = computeOrderPromos(
      [promo({ type: 'discount_nominal', discountValue: 10_000 })],
      20_000,
      0,
      NOW,
      LIMITS,
    )

    // Tanpa pengaman: 20.000 - 10.000 = 10.000 (pas di batas). Diuji dengan batas lebih tinggi:
    expect(hasil.discount).toBe(10_000)
    expect(hasil.clampedByMinTotal).toBe(false)

    const ketat = computeOrderPromos(
      [promo({ type: 'discount_nominal', discountValue: 10_000 })],
      20_000,
      0,
      NOW,
      { maxDiscountPercent: 100, minTotal: 15_000 },
    )

    expect(ketat.discount).toBe(5_000) // dikurangi supaya total tepat 15.000
    expect(ketat.clampedByMinTotal).toBe(true)
  })

  it('tidak pernah menghasilkan diskon melebihi subtotal', () => {
    const hasil = computeOrderPromos(
      [promo({ type: 'discount_nominal', discountValue: 999_999 })],
      30_000,
      5_000,
      NOW,
      { maxDiscountPercent: 100, minTotal: 0 },
    )

    expect(hasil.discount).toBeLessThanOrEqual(30_000)
  })
})
