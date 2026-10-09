// tests/unit/speed-insights-filter.test.ts
// Penyaring event Speed Insights. Yang mahal kalau salah: event OMS/maintenance ikut terkirim dan
// menghabiskan kuota 10.000 event, atau nomor invoice / email / token pembeli bocor ke dashboard Vercel.

import { describe, expect, it } from 'vitest'
import {
  filterSpeedInsightsEvent,
  ID_PLACEHOLDER,
  isSpeedInsightsExcludedPath,
  sanitizeSpeedInsightsPath,
  type SpeedInsightsEvent,
} from '@/lib/speed-insights-filter'

const event = (url: string): SpeedInsightsEvent => ({ type: 'vital', url })
const ORIGIN = 'https://infarm.id'

describe('isSpeedInsightsExcludedPath', () => {
  it('OMS, maintenance, api, dev → dikecualikan (tepat maupun di bawahnya)', () => {
    expect(isSpeedInsightsExcludedPath('/oms')).toBe(true)
    expect(isSpeedInsightsExcludedPath('/oms/login')).toBe(true)
    expect(isSpeedInsightsExcludedPath('/oms/dashboard/orders')).toBe(true)
    expect(isSpeedInsightsExcludedPath('/maintenance')).toBe(true)
    expect(isSpeedInsightsExcludedPath('/maintenance/')).toBe(true)
    expect(isSpeedInsightsExcludedPath('/api/products/list')).toBe(true)
    expect(isSpeedInsightsExcludedPath('/dev/email-preview')).toBe(true)
  })

  it('awalan hanya cocok per segmen, bukan per huruf', () => {
    expect(isSpeedInsightsExcludedPath('/omset')).toBe(false)
    expect(isSpeedInsightsExcludedPath('/maintenance-tips')).toBe(false)
  })
})

describe('filterSpeedInsightsEvent — event yang dibuang', () => {
  it('halaman OMS → null', () => {
    expect(filterSpeedInsightsEvent(event(`${ORIGIN}/oms/dashboard`))).toBeNull()
    expect(filterSpeedInsightsEvent(event(`${ORIGIN}/oms/login?redirect=%2Foms%2Fdashboard`))).toBeNull()
  })

  it('halaman maintenance → null', () => {
    expect(filterSpeedInsightsEvent(event(`${ORIGIN}/maintenance`))).toBeNull()
  })

  it('URL yang tak bisa diurai → null, bukan diteruskan apa adanya', () => {
    expect(filterSpeedInsightsEvent(event('http://'))).toBeNull()
  })
})

describe('filterSpeedInsightsEvent — pembersihan URL', () => {
  it('query string dan hash dibuang (pengenal pesanan hari ini ada di query)', () => {
    expect(filterSpeedInsightsEvent(event(`${ORIGIN}/track?order=INV-20261009-K7QM4T2X`))).toEqual(
      event(`${ORIGIN}/track`),
    )
    expect(
      filterSpeedInsightsEvent(
        event(`${ORIGIN}/order-cancellation?id=INV-20261009-K7QM4T2X&token=m1x.ab12cd34.ef56ab78`),
      ),
    ).toEqual(event(`${ORIGIN}/order-cancellation`))
    expect(
      filterSpeedInsightsEvent(event(`${ORIGIN}/checkout/success?invoice=INV-1&order=abc#ringkasan`)),
    ).toEqual(event(`${ORIGIN}/checkout/success`))
    expect(filterSpeedInsightsEvent(event(`${ORIGIN}/products?kategori=benih&q=cabai`))).toEqual(
      event(`${ORIGIN}/products`),
    )
  })

  it('segmen path setelah rute pesanan disamarkan menjadi [id]', () => {
    expect(sanitizeSpeedInsightsPath('/track/INV-20261009-K7QM4T2X')).toBe(`/track/${ID_PLACEHOLDER}`)
    expect(sanitizeSpeedInsightsPath('/track-order/081234567890')).toBe(`/track-order/${ID_PLACEHOLDER}`)
    expect(sanitizeSpeedInsightsPath('/cancel-order/budi%40example.com')).toBe(`/cancel-order/${ID_PLACEHOLDER}`)
    expect(sanitizeSpeedInsightsPath('/order-cancellation/INV-1/m1x.0123abcd.4567ef89')).toBe(
      `/order-cancellation/${ID_PLACEHOLDER}/${ID_PLACEHOLDER}`,
    )
    expect(sanitizeSpeedInsightsPath('/review/apa-pun')).toBe(`/review/${ID_PLACEHOLDER}`)
    expect(sanitizeSpeedInsightsPath('/pesanan-saya/xyz')).toBe(`/pesanan-saya/${ID_PLACEHOLDER}`)
  })

  it('anak statis rute pesanan yang memang ada di src/app tetap tampil', () => {
    expect(sanitizeSpeedInsightsPath('/review/submitted')).toBe('/review/submitted')
    expect(sanitizeSpeedInsightsPath('/review/submitted/INV-1')).toBe(`/review/submitted/${ID_PLACEHOLDER}`)
    expect(sanitizeSpeedInsightsPath('/checkout/success')).toBe('/checkout/success')
  })

  it('segmen berbentuk pengenal disamarkan di rute mana pun (email, telepon, invoice, token)', () => {
    expect(sanitizeSpeedInsightsPath('/produk/budi@example.com')).toBe(`/produk/${ID_PLACEHOLDER}`)
    expect(sanitizeSpeedInsightsPath('/produk/081234567890')).toBe(`/produk/${ID_PLACEHOLDER}`)
    expect(sanitizeSpeedInsightsPath('/produk/INV-ABC')).toBe(`/produk/${ID_PLACEHOLDER}`)
    expect(sanitizeSpeedInsightsPath('/produk/m1x.0123abcd.4567ef89')).toBe(`/produk/${ID_PLACEHOLDER}`)
  })

  it('URL toko biasa lolos tanpa perubahan', () => {
    expect(filterSpeedInsightsEvent(event(`${ORIGIN}/`))).toEqual(event(`${ORIGIN}/`))
    expect(filterSpeedInsightsEvent(event(`${ORIGIN}/products`))).toEqual(event(`${ORIGIN}/products`))
    expect(filterSpeedInsightsEvent(event(`${ORIGIN}/produk/benih-cabai-rawit-123`))).toEqual(
      event(`${ORIGIN}/produk/benih-cabai-rawit-123`),
    )
    expect(filterSpeedInsightsEvent(event(`${ORIGIN}/keranjang`))).toEqual(event(`${ORIGIN}/keranjang`))
    expect(filterSpeedInsightsEvent(event(`${ORIGIN}/track`))).toEqual(event(`${ORIGIN}/track`))
  })

  it('URL relatif tetap relatif, hanya path-nya yang dibersihkan', () => {
    expect(filterSpeedInsightsEvent(event('/track?order=INV-1'))).toEqual(event('/track'))
  })

  it('field lain pada event tidak disentuh', () => {
    const hasil = filterSpeedInsightsEvent({ type: 'vital', url: `${ORIGIN}/keranjang?x=1` })
    expect(hasil?.type).toBe('vital')
  })
})
