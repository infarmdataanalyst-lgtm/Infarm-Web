// tests/unit/warehouse-shipping.test.ts
// Kunci cache hasil perbandingan ongkir.
//
// Kunci ini dipakai DUA KALI dengan cara berbeda: saat checkout menyimpan hasil perbandingan, dan
// saat /api/orders/create membacanya kembali untuk memverifikasi ongkir yang dikirim pembeli.
// Kalau kedua sisi menghasilkan kunci yang sedikit berbeda, pembacaannya selalu meleset — server
// diam-diam memanggil Mengantar lagi, dan pada kasus terburuk menolak ongkir yang sebenarnya sah.

import { describe, expect, it } from 'vitest'
import { shippingOptionsKey } from '@/lib/warehouse-shipping'

const TUJUAN = '5fc62f5ff8f44b34aa4c0dbc'

describe('shippingOptionsKey', () => {
  it('tidak bergantung pada urutan item di keranjang', () => {
    const a = shippingOptionsKey(TUJUAN, 2, [
      { productId: 'A', quantity: 1 },
      { productId: 'B', quantity: 2 },
    ])
    const b = shippingOptionsKey(TUJUAN, 2, [
      { productId: 'B', quantity: 2 },
      { productId: 'A', quantity: 1 },
    ])
    expect(a).toBe(b)
  })

  it('membedakan varian dari produk polos', () => {
    // Stok varian disimpan terpisah, jadi dua permintaan ini tak boleh berbagi hasil perbandingan.
    const polos = shippingOptionsKey(TUJUAN, 1, [{ productId: 'A', quantity: 1 }])
    const varian = shippingOptionsKey(TUJUAN, 1, [{ productId: 'A', quantity: 1, variantId: 'v1' }])
    expect(polos).not.toBe(varian)
  })

  it('membedakan jumlah, berat, dan tujuan', () => {
    const dasar = shippingOptionsKey(TUJUAN, 1, [{ productId: 'A', quantity: 1 }])
    expect(shippingOptionsKey(TUJUAN, 1, [{ productId: 'A', quantity: 2 }])).not.toBe(dasar)
    expect(shippingOptionsKey(TUJUAN, 2, [{ productId: 'A', quantity: 1 }])).not.toBe(dasar)
    expect(shippingOptionsKey('tujuan-lain', 1, [{ productId: 'A', quantity: 1 }])).not.toBe(dasar)
  })

  it('stabil untuk permintaan yang sama persis', () => {
    const items = [
      { productId: 'A', quantity: 1 },
      { productId: 'B', quantity: 3, variantId: 'v9' },
    ]
    expect(shippingOptionsKey(TUJUAN, 3.33, items)).toBe(shippingOptionsKey(TUJUAN, 3.33, items))
  })
})
