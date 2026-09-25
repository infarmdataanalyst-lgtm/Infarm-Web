// tests/unit/analytics.test.ts
// Payload GA4 adalah KONTRAK dengan sistem di luar repo ini, dan kesalahannya tak pernah
// menampilkan galat: event tetap terkirim, laporan tetap terisi, angkanya saja yang salah diam-diam.
//
// Yang dijaga di sini terutama satu hal: `item_id` harus sama di SELURUH funnel. Kalau halaman
// detail produk mengirim SKU sementara checkout mengirim id produk, GA4 memperlakukan keduanya
// sebagai barang berbeda — funnel view_item → purchase terputus tepat di tengah, dan tak ada
// satu pun pesan galat yang muncul.

import { afterEach, describe, expect, it } from 'vitest'
import {
  trackAddShippingInfo,
  trackBeginCheckout,
  trackViewItem,
  type AnalyticsLineItem,
  type AnalyticsProduct,
} from '@/lib/analytics'

type GtagCall = { name: string; params: Record<string, unknown> }

// Vitest berjalan di environment 'node' → `window` tak ada sama sekali. Itu justru berguna:
// ketiadaannya menguji jalur no-op, dan kehadirannya dipalsukan hanya saat dibutuhkan.
function pasangGtag(): GtagCall[] {
  const calls: GtagCall[] = []
  ;(globalThis as { window?: unknown }).window = {
    gtag: (_command: 'event', name: string, params?: Record<string, unknown>) => {
      calls.push({ name, params: params ?? {} })
    },
  }
  return calls
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

const sprayer: AnalyticsProduct = {
  id: 'prod-1',
  sku: 'SPR-2L',
  name: 'Sprayer 2L',
  category: 'peralatan-berkebun',
  price: 46000,
}

const baris: AnalyticsLineItem[] = [{ ...sprayer, quantity: 2 }]

describe('tanpa gtag', () => {
  it('diam saja, tidak melempar', () => {
    // Terjadi setiap hari: halaman OMS tak memuat GA, dan dev lokal jalan tanpa NEXT_PUBLIC_GA_ID.
    // Event analytics tak boleh pernah menjatuhkan halaman yang sedang dipakai orang berbelanja.
    expect(() => trackBeginCheckout(92000, baris)).not.toThrow()
  })
})

describe('trackBeginCheckout', () => {
  it('mengirim currency, value, dan item dengan kuantitasnya', () => {
    const calls = pasangGtag()
    trackBeginCheckout(92000, baris)

    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('begin_checkout')
    expect(calls[0].params).toMatchObject({ currency: 'IDR', value: 92000 })
    expect(calls[0].params.items).toEqual([
      {
        item_id: 'SPR-2L',
        item_name: 'Sprayer 2L',
        item_category: 'peralatan-berkebun',
        price: 46000,
        quantity: 2,
      },
    ])
  })

  it('value adalah subtotal yang dioper, bukan hasil hitung ulang dari item', () => {
    // Diskon & subsidi ongkir dihitung di halaman checkout, bukan di sini. Kalau helper ini
    // diam-diam menjumlah sendiri price × quantity, nilai begin_checkout akan mengabaikan promo
    // dan selalu lebih tinggi dari purchase — selisih yang terbaca seperti pembeli membatalkan
    // sebagian belanjaannya.
    const calls = pasangGtag()
    trackBeginCheckout(75000, baris) // 75.000, bukan 2 × 46.000
    expect(calls[0].params.value).toBe(75000)
  })
})

describe('trackAddShippingInfo', () => {
  it('membawa shipping_tier dan shipping_cost', () => {
    const calls = pasangGtag()
    trackAddShippingInfo(92000, 'J&T Reguler', 66720, baris)

    expect(calls[0].name).toBe('add_shipping_info')
    expect(calls[0].params).toMatchObject({
      currency: 'IDR',
      value: 92000,
      shipping_tier: 'J&T Reguler',
      shipping_cost: 66720,
    })
  })

  it('shipping_cost terpisah dari value — ongkir tidak ikut dijumlahkan ke nilai keranjang', () => {
    // Kalau ongkir ikut masuk `value`, membandingkan begin_checkout dengan add_shipping_info
    // menghasilkan kenaikan semu yang besarnya persis ongkir, dan pertanyaan "berapa banyak yang
    // mundur setelah melihat ongkir" jadi mustahil dijawab.
    const calls = pasangGtag()
    trackAddShippingInfo(92000, 'J&T Reguler', 66720, baris)
    expect(calls[0].params.value).toBe(92000)
  })
})

describe('konsistensi item_id lintas event', () => {
  it('view_item dan begin_checkout memakai item_id yang sama', () => {
    const calls = pasangGtag()
    trackViewItem(sprayer)
    trackBeginCheckout(92000, baris)

    const idDari = (c: GtagCall) =>
      (c.params.items as Array<{ item_id: string }>)[0].item_id

    expect(idDari(calls[0])).toBe(idDari(calls[1]))
  })

  it('produk tanpa SKU jatuh ke id, dan tetap konsisten', () => {
    // Produk dummy/lama belum tentu punya SKU. Yang penting bukan nilainya, melainkan bahwa
    // KEDUA event jatuh ke nilai cadangan yang sama.
    const tanpaSku: AnalyticsProduct = { ...sprayer, sku: undefined }
    const calls = pasangGtag()
    trackViewItem(tanpaSku)
    trackBeginCheckout(46000, [{ ...tanpaSku, quantity: 1 }])

    const idDari = (c: GtagCall) =>
      (c.params.items as Array<{ item_id: string }>)[0].item_id

    expect(idDari(calls[0])).toBe('prod-1')
    expect(idDari(calls[1])).toBe('prod-1')
  })
})
