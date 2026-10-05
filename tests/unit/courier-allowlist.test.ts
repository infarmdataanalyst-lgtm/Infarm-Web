// tests/unit/courier-allowlist.test.ts
// Kurir yang ditawarkan ke pembeli & pemetaan label ↔ kode API (Shopee Express, 2026-10-02).
//
// Pemetaan inilah yang menentukan kurir yang DIBOOKING dan DIBATALKAN di Mengantar. Salah peta =
// pembeli memilih Shopee Express tapi kurir J&T yang datang menjemput, atau pembatalan penjemputan
// ditolak karena kurirnya tak cocok dengan saat booking.

import { describe, expect, it } from 'vitest'
import {
  courierDisplayName,
  courierIdFromLabel,
  isOfferableCourier,
  type ShippingCourier,
} from '@/lib/mengantar-estimate'

const kurir = (id: string, price = 10000, unsupported = false): ShippingCourier => ({
  id,
  name: courierDisplayName(id),
  price,
  estimatedDate: '2-4 hari',
  unsupported,
})

describe('isOfferableCourier', () => {
  it('menawarkan J&T dan Shopee Express, bukan kurir lain', () => {
    expect(isOfferableCourier(kurir('JT'))).toBe(true)
    expect(isOfferableCourier(kurir('spx'))).toBe(true)
    expect(isOfferableCourier(kurir('JNE'))).toBe(false)
    // Dicocokkan eksak: 'SPX' kapital bukan kode yang dikirim Mengantar.
    expect(isOfferableCourier(kurir('SPX'))).toBe(false)
  })

  it('tetap menolak kurir yang tak melayani rute atau bertarif 0', () => {
    expect(isOfferableCourier(kurir('spx', 10000, true))).toBe(false)
    expect(isOfferableCourier(kurir('spx', 0))).toBe(false)
  })
})

describe('courierIdFromLabel', () => {
  it('memetakan label tampilan maupun kode ke kode API', () => {
    expect(courierDisplayName('spx')).toBe('Shopee Express')
    expect(courierIdFromLabel('Shopee Express')).toBe('spx')
    expect(courierIdFromLabel('spx')).toBe('spx')
    expect(courierIdFromLabel('J&T')).toBe('JT')
    expect(courierIdFromLabel('JT')).toBe('JT')
  })

  it('kosong / tak dikenal → J&T (semua pesanan sebelum 2026-10-02)', () => {
    expect(courierIdFromLabel(null)).toBe('JT')
    expect(courierIdFromLabel('')).toBe('JT')
    expect(courierIdFromLabel('JNE')).toBe('JT')
  })
})
