// tests/unit/promo-hadiah-habis.test.ts
// Syarat promo hadiah tercapai tapi stok hadiahnya habis di semua gudang (uji pemilik 25 Sep 2026).
// Keranjang dulu tetap merayakan "Selamat! Kamu mendapatkan …" sementara checkout diam-diam tak
// memasukkan hadiahnya — harapan palsu bagi pembeli.

import { describe, expect, it } from 'vitest'
import { computePromoProgress, unavailableGiftIds } from '@/lib/promo-cart'
import type { Promotion } from '@/types/promotion'

const PROMO_HADIAH: Promotion = {
  id: 'promo-day',
  name: 'Promo day',
  type: 'free_product',
  minPurchase: 100_000,
  freeProductId: 'benih',
  freeProductName: 'Paket 5 Benih 30 Hari Panen',
  discountValue: null,
  startAt: null,
  endAt: null,
  progressMessage: 'Tambah {sisa} untuk hadiah!',
  isActive: true,
  createdAt: '2026-07-06T00:00:00.000Z',
}

describe('computePromoProgress — hadiah habis', () => {
  it('stok ada → tetap dirayakan', () => {
    const [p] = computePromoProgress([PROMO_HADIAH], 119_600, [])
    expect(p.giftOutOfStock).toBe(false)
    expect(p.message).toContain('Selamat')
  })

  it('stok habis → pesan jujur, bukan "Selamat!"', () => {
    const [p] = computePromoProgress([PROMO_HADIAH], 119_600, ['benih'])
    expect(p.reached).toBe(true)
    expect(p.giftOutOfStock).toBe(true)
    expect(p.message).not.toContain('Selamat')
    expect(p.message).toContain('stok hadiah Paket 5 Benih 30 Hari Panen sedang habis')
  })

  it('syarat belum tercapai → pesan progres biasa walau stok habis', () => {
    const [p] = computePromoProgress([PROMO_HADIAH], 50_000, ['benih'])
    expect(p.giftOutOfStock).toBe(false)
    expect(p.message).toBe('Tambah Rp50.000 untuk hadiah!')
  })
})

describe('unavailableGiftIds', () => {
  it('stok 0 atau diarsipkan dianggap habis; produk yang belum dimuat TIDAK', () => {
    const promos = [PROMO_HADIAH, { ...PROMO_HADIAH, id: 'p2', freeProductId: 'pot' }]
    expect(unavailableGiftIds(promos, [{ id: 'benih', stock: 0 }])).toEqual(['benih'])
    expect(unavailableGiftIds(promos, [{ id: 'pot', stock: 5, archived: true }])).toEqual(['pot'])
    expect(unavailableGiftIds(promos, [{ id: 'benih', stock: 3 }])).toEqual([])
    expect(unavailableGiftIds(promos, [])).toEqual([])
  })
})
