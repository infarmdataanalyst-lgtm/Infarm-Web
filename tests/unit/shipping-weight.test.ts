// tests/unit/shipping-weight.test.ts
// Berat kirim menentukan tarif yang ditagih Mengantar. Nilai 0 membuat sebagian kurir membalas
// harga 0 — pilihan ongkir palsu yang tetap ditagihkan ke toko saat booking.

import { describe, expect, it } from 'vitest'
import {
  MIN_SHIPPING_WEIGHT_KG,
  effectiveWeightGram,
  shippingWeightKg,
  totalWeightGram,
} from '@/lib/shipping-weight'

describe('effectiveWeightGram', () => {
  it('memakai berat dari DB bila masuk akal', () => {
    expect(effectiveWeightGram(750)).toBe(750)
  })

  it('memperlakukan nilai tak valid sama dengan belum diisi', () => {
    // 0, negatif, dan NaN semuanya berakhir di berat cadangan — bukan diteruskan apa adanya.
    const cadangan = effectiveWeightGram(null)
    expect(effectiveWeightGram(0)).toBe(cadangan)
    expect(effectiveWeightGram(-500)).toBe(cadangan)
    expect(effectiveWeightGram(Number.NaN)).toBe(cadangan)
    expect(effectiveWeightGram(undefined)).toBe(cadangan)
    expect(cadangan).toBeGreaterThan(0)
  })
})

describe('totalWeightGram', () => {
  it('menjumlah berat satuan dikali jumlah', () => {
    expect(totalWeightGram([{ quantity: 3, berat: 500 }, { quantity: 1, berat: 250 }])).toBe(1_750)
  })

  it('melewati baris ber-quantity tak valid tanpa menggagalkan sisanya', () => {
    // Satu baris keranjang yang cacat tak boleh membuat pembeli kehilangan SELURUH pilihan ongkir.
    expect(
      totalWeightGram([
        { quantity: 0, berat: 500 },
        { quantity: -2, berat: 500 },
        { quantity: 2, berat: 500 },
      ]),
    ).toBe(1_000)
  })
})

describe('shippingWeightKg', () => {
  it('tidak pernah mengirim berat di bawah minimum', () => {
    expect(shippingWeightKg([{ quantity: 1, berat: 50 }])).toBe(MIN_SHIPPING_WEIGHT_KG)
    expect(shippingWeightKg([])).toBe(MIN_SHIPPING_WEIGHT_KG)
  })

  it('membulatkan ke 2 desimal supaya kunci cache ongkir stabil', () => {
    // 10 x 333 g = 3,33 kg — BUKAN 3.3299999999999996, yang akan menghasilkan kunci cache berbeda
    // tiap kali dihitung sehingga verifikasi ongkir di orders/create selalu meleset.
    const kg = shippingWeightKg([{ quantity: 10, berat: 333 }])
    expect(kg).toBe(3.33)
    expect(String(kg)).toBe('3.33')
  })
})
