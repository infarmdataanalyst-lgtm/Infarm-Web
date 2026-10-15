// tests/unit/meta-pixel.test.ts
// Terjemahan GA4 → Meta adalah kontrak dengan Events Manager Meta, dan seperti GA4, salahnya tak
// pernah terlihat sebagai galat: event tetap diterima, hanya laporan iklannya yang diam-diam
// keliru — dan iklan dioptimalkan dari angka yang keliru itu.
//
// Yang dijaga: nama event standar Meta tepat (salah huruf = jadi custom event yang tak bisa dipakai
// optimasi), `content_ids` sama dengan `item_id` GA4 (funnel lintas platform bisa dicocokkan),
// dan `purchase` TIDAK pernah lahir dari browser.

import { afterEach, describe, expect, it } from 'vitest'
import { isValidMetaPixelId, metaEventId, sendMetaEvent, toMetaEvent } from '@/lib/meta-pixel'

const items = [
  { item_id: 'SPR-2L', item_name: 'Sprayer 2L', item_category: 'peralatan-berkebun', price: 46000, quantity: 2 },
  { item_id: 'prod-9', item_name: 'Polybag 30', item_category: 'pot-polybag', price: 12000, quantity: 1 },
]

describe('toMetaEvent', () => {
  it('view_item → ViewContent dengan nama & kategori produk', () => {
    const ev = toMetaEvent('view_item', { currency: 'IDR', value: 46000, items: [items[0]] })
    expect(ev?.name).toBe('ViewContent')
    expect(ev?.params).toMatchObject({
      content_type: 'product',
      content_ids: ['SPR-2L'],
      content_name: 'Sprayer 2L',
      content_category: 'peralatan-berkebun',
      currency: 'IDR',
      value: 46000,
    })
  })

  it('add_to_cart → AddToCart; contents membawa harga SATUAN, bukan subtotal baris', () => {
    // Meta mengalikan sendiri item_price × quantity. Mengirim subtotal berarti nilai keranjang
    // di laporan Meta berlipat sebanyak kuantitasnya.
    const ev = toMetaEvent('add_to_cart', { currency: 'IDR', value: 92000, items: [items[0]] })
    expect(ev?.name).toBe('AddToCart')
    expect(ev?.params.contents).toEqual([{ id: 'SPR-2L', quantity: 2, item_price: 46000 }])
    expect(ev?.params.value).toBe(92000)
  })

  it('begin_checkout → InitiateCheckout dengan num_items = total kuantitas', () => {
    const ev = toMetaEvent('begin_checkout', { currency: 'IDR', value: 104000, items })
    expect(ev?.name).toBe('InitiateCheckout')
    expect(ev?.params).toMatchObject({ content_ids: ['SPR-2L', 'prod-9'], num_items: 3, value: 104000 })
  })

  it('add_shipping_info → AddPaymentInfo; parameter ongkir GA4 tidak ikut', () => {
    const ev = toMetaEvent('add_shipping_info', {
      currency: 'IDR',
      value: 104000,
      shipping_tier: 'J&T Reguler',
      shipping_cost: 66720,
      items,
    })
    expect(ev?.name).toBe('AddPaymentInfo')
    expect(ev?.params).not.toHaveProperty('shipping_tier')
    expect(ev?.params).not.toHaveProperty('shipping_cost')
    expect(ev?.params.value).toBe(104000)
  })

  it('search → Search dengan search_string dan results_count', () => {
    const ev = toMetaEvent('search', { search_term: 'bayam', results_count: 0, items: [] })
    expect(ev?.name).toBe('Search')
    expect(ev?.params).toMatchObject({ search_string: 'bayam', results_count: 0, content_ids: [] })
  })

  it('purchase dan event tak dikenal → null (tidak pernah dikirim dari browser)', () => {
    // Purchase lahir di webhook lewat Conversions API. Kalau pemetaan ini suatu hari mengenalnya,
    // pembelian yang sama tiba dua kali di Meta dan ROAS iklan terbaca dua kali lipat.
    expect(toMetaEvent('purchase', { transaction_id: 'INV-1', value: 1, items })).toBeNull()
    expect(toMetaEvent('refund', { transaction_id: 'INV-1' })).toBeNull()
    expect(toMetaEvent('scroll', {})).toBeNull()
  })

  it('content_ids identik dengan item_id GA4 untuk seluruh funnel', () => {
    const idsDari = (name: string) => toMetaEvent(name, { value: 1, items })?.params.content_ids
    expect(idsDari('view_item')).toEqual(['SPR-2L', 'prod-9'])
    expect(idsDari('add_to_cart')).toEqual(idsDari('view_item'))
    expect(idsDari('begin_checkout')).toEqual(idsDari('view_item'))
    expect(idsDari('add_shipping_info')).toEqual(idsDari('view_item'))
  })
})

describe('sendMetaEvent', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  it('tanpa window/fbq: diam saja, tidak melempar', () => {
    expect(() => sendMetaEvent({ name: 'Search', params: {} })).not.toThrow()
    ;(globalThis as { window?: unknown }).window = {}
    expect(() => sendMetaEvent({ name: 'Search', params: {} })).not.toThrow()
  })

  it('memanggil fbq("track") dengan eventID unik', () => {
    const calls: unknown[][] = []
    ;(globalThis as { window?: unknown }).window = { fbq: (...args: unknown[]) => calls.push(args) }

    sendMetaEvent({ name: 'AddToCart', params: { value: 1 } })
    sendMetaEvent({ name: 'AddToCart', params: { value: 1 } })

    expect(calls).toHaveLength(2)
    expect(calls[0][0]).toBe('track')
    expect(calls[0][1]).toBe('AddToCart')
    const id1 = (calls[0][3] as { eventID: string }).eventID
    const id2 = (calls[1][3] as { eventID: string }).eventID
    expect(id1).toMatch(/^AddToCart\./)
    expect(id1).not.toBe(id2)
  })

  it('null → tidak memanggil fbq sama sekali', () => {
    const calls: unknown[][] = []
    ;(globalThis as { window?: unknown }).window = { fbq: (...args: unknown[]) => calls.push(args) }
    sendMetaEvent(null)
    expect(calls).toHaveLength(0)
  })
})

describe('metaEventId', () => {
  it('diawali nama event dan berbeda tiap panggilan', () => {
    const a = metaEventId('ViewContent')
    const b = metaEventId('ViewContent')
    expect(a.startsWith('ViewContent.')).toBe(true)
    expect(a).not.toBe(b)
  })
})

describe('isValidMetaPixelId', () => {
  it('menerima deretan angka', () => {
    expect(isValidMetaPixelId('123456789012345')).toBe(true)
  })

  it('menolak kosong, placeholder, dan apa pun yang bukan angka', () => {
    // Nilainya disisipkan ke <script> inline: teks sembarang di sini = teks sembarang di halaman.
    expect(isValidMetaPixelId(undefined)).toBe(false)
    expect(isValidMetaPixelId('')).toBe(false)
    expect(isValidMetaPixelId('ISI_NANTI')).toBe(false)
    expect(isValidMetaPixelId("123');alert(1);//")).toBe(false)
    expect(isValidMetaPixelId('123')).toBe(false) // terlalu pendek untuk ID sungguhan
  })
})
