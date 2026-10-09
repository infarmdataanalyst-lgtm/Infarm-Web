// tests/unit/buyer-orders.test.ts
// Ringkasan ulasan & urutan daftar pesanan di halaman Pesanan Saya (lib/buyer-orders.ts).
//
// Yang dijaga: badge "Beri Ulasan" hanya muncul untuk pesanan yang BENAR-BENAR boleh diulas dan
// masih punya produk belum diulas; dan di tab Selesai pesanan itu naik ke atas. Salah di sini =
// pembeli diminta mengulas pesanan yang ditolak server, atau tak pernah tahu ada yang menunggu.

import { describe, expect, it } from 'vitest'
import { fullyReviewed, needsReview, sortBuyerOrders, splitBuyerOrders, summarizeOrderReview } from '@/lib/buyer-orders'
import type { PublicOrderReview } from '@/types/public-order'

const items = [
  { productId: 'p1', name: 'Benih', quantity: 1, price: 1000 },
  { productId: 'p2', name: 'Pupuk', quantity: 2, price: 2000 },
]
const NOW = Date.parse('2026-10-09T05:00:00.000Z')

describe('summarizeOrderReview', () => {
  it('Selesai tanpa ulasan → boleh diulas, semua produk menunggu', () => {
    const r = summarizeOrderReview({ status: 'Selesai', items }, [], NOW)
    expect(r.eligible).toBe(true)
    expect(r.pendingProductIds).toEqual(['p1', 'p2'])
    expect(r.reviewedCount).toBe(0)
    expect(r.totalCount).toBe(2)
  })

  it('satu produk sudah diulas → hanya sisanya yang menunggu', () => {
    const r = summarizeOrderReview({ status: 'Selesai', items }, ['p1'], NOW)
    expect(r.pendingProductIds).toEqual(['p2'])
    expect(r.reviewedCount).toBe(1)
  })

  it('Dibatalkan → tidak boleh diulas, dengan alasan dari review-eligibility', () => {
    const r = summarizeOrderReview({ status: 'Dibatalkan', items }, [], NOW)
    expect(r.eligible).toBe(false)
    expect(r.blockCode).toBe('CANCELLED')
    expect(r.blockMessage).toBeTruthy()
  })

  it('Diproses (belum diterima) → belum boleh diulas', () => {
    const r = summarizeOrderReview({ status: 'Diproses', items }, [], NOW)
    expect(r.eligible).toBe(false)
    expect(r.blockCode).toBe('NOT_COMPLETED')
  })

  it('diterima kurir >14 hari lalu → jendela tutup, meski status masih Diproses', () => {
    const r = summarizeOrderReview(
      { status: 'Diproses', deliveredAt: '2026-09-01T03:00:00.000Z', items },
      [],
      NOW,
    )
    expect(r.eligible).toBe(false)
    expect(r.blockCode).toBe('WINDOW_EXPIRED')
  })
})

const review = (over: Partial<PublicOrderReview>): PublicOrderReview => ({
  eligible: true,
  pendingProductIds: ['p1'],
  reviewedCount: 0,
  totalCount: 1,
  ...over,
})

describe('needsReview / fullyReviewed', () => {
  it('menunggu ulasan = boleh DAN masih ada produk belum diulas', () => {
    expect(needsReview({ review: review({}) })).toBe(true)
    expect(needsReview({ review: review({ eligible: false }) })).toBe(false)
    expect(needsReview({ review: review({ pendingProductIds: [], reviewedCount: 1 }) })).toBe(false)
  })

  it('sudah diulas = semua produk punya ulasan; pesanan kosong tak pernah "sudah diulas"', () => {
    expect(fullyReviewed({ review: review({ pendingProductIds: [], reviewedCount: 1 }) })).toBe(true)
    expect(fullyReviewed({ review: review({}) })).toBe(false)
    expect(fullyReviewed({ review: review({ pendingProductIds: [], reviewedCount: 0, totalCount: 0 }) })).toBe(false)
  })
})

describe('sortBuyerOrders', () => {
  it('menunggu ulasan naik ke atas; di tiap kelompok terbaru dulu; masukan tak diubah', () => {
    const input = [
      { orderId: 'A', date: '2026-10-05T00:00:00Z', review: review({ pendingProductIds: [], reviewedCount: 1 }) },
      { orderId: 'B', date: '2026-10-01T00:00:00Z', review: review({}) },
      { orderId: 'C', date: '2026-10-07T00:00:00Z', review: review({ eligible: false }) },
      { orderId: 'D', date: '2026-10-03T00:00:00Z', review: review({}) },
    ]
    const sorted = sortBuyerOrders(input)
    expect(sorted.map((o) => o.orderId)).toEqual(['D', 'B', 'C', 'A'])
    expect(input.map((o) => o.orderId)).toEqual(['A', 'B', 'C', 'D'])
  })
})

describe('splitBuyerOrders', () => {
  it('Aktif = belum final; Selesai = Selesai & Dibatalkan', () => {
    const { active, finished } = splitBuyerOrders([
      { status: 'Menunggu Pembayaran' },
      { status: 'Diproses' },
      { status: 'Dikirim' },
      { status: 'Selesai' },
      { status: 'Dibatalkan' },
    ])
    expect(active.map((o) => o.status)).toEqual(['Menunggu Pembayaran', 'Diproses', 'Dikirim'])
    expect(finished.map((o) => o.status)).toEqual(['Selesai', 'Dibatalkan'])
  })
})
