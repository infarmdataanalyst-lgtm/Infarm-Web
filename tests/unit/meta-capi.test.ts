// tests/unit/meta-capi.test.ts
// Payload Conversions API adalah kontrak dengan Meta, dan salahnya tak pernah terlihat sebagai
// galat — Meta menjawab 200 untuk hash yang tak akan pernah cocok dengan siapa pun. Yang dijaga:
//
//   1. Normalisasi SEBELUM hash. Hash "Budi@Mail.com" ≠ hash "budi@mail.com"; telepon "0812…" ≠
//      "62812…". Meta hanya mencocokkan hash yang persis sama, jadi normalisasi yang salah berarti
//      Event Match Quality rendah dan pembelian tak teratribusi — diam-diam.
//   2. event_id = nomor invoice, dan content id = aturan `sku || id` yang sama dengan GA4 & pixel.
//   3. Tanpa pengenal pembeli sama sekali → null, bukan payload kosong yang ditolak Meta.

import { describe, expect, it } from 'vitest'
import { buildMetaPurchasePayload, normalizeEmail, normalizePhone, sha256 } from '@/lib/meta-capi'
import type { ProductMeta } from '@/lib/analytics-server'
import type { Order } from '@/types/order'

describe('normalizeEmail', () => {
  it('huruf kecil & tanpa spasi', () => {
    expect(normalizeEmail('  Budi@Mail.COM ')).toBe('budi@mail.com')
  })
  it('bukan email → undefined', () => {
    expect(normalizeEmail('')).toBeUndefined()
    expect(normalizeEmail(undefined)).toBeUndefined()
    expect(normalizeEmail('bukan email')).toBeUndefined()
  })
})

describe('normalizePhone', () => {
  it('08xx → 628xx (kode negara, tanpa +, hanya digit)', () => {
    expect(normalizePhone('0812-3456-7890')).toBe('6281234567890')
    expect(normalizePhone('+62 812 3456 7890')).toBe('6281234567890')
    expect(normalizePhone('62812 3456 7890')).toBe('6281234567890')
    expect(normalizePhone('81234567890')).toBe('6281234567890')
  })
  it('terlalu pendek / kosong → undefined', () => {
    expect(normalizePhone('0812')).toBeUndefined()
    expect(normalizePhone(undefined)).toBeUndefined()
  })
})

const pesanan: Order = {
  orderId: 'INV-20261015-ABCD1234',
  customerName: 'Pembeli Uji',
  customerEmail: 'Budi@Mail.com',
  customerPhone: '081234567890',
  date: '2026-10-15T02:00:00.000Z',
  items: [
    { productId: 'prod-1', name: 'Sprayer 2L', quantity: 2, price: 46000 },
    { productId: 'prod-2', name: 'Polybag 20x20', quantity: 1, price: 15000 },
  ],
  totalAmount: 112720,
  shippingCost: 66720,
  paymentStatus: 'Lunas',
  metaFbp: 'fb.1.1696000000000.1234567890',
  metaFbc: 'fb.1.1696000000000.IwAR0abc',
}

const meta = new Map<string, ProductMeta>([
  ['prod-1', { sku: 'SPR-2L', category: 'peralatan-berkebun' }],
  ['prod-2', { category: 'pot-polybag' }],
])

describe('buildMetaPurchasePayload', () => {
  it('event_id = nomor invoice, action_source website, event_time dioper apa adanya', () => {
    const ev = buildMetaPurchasePayload(pesanan, meta, 1_760_000_000)!.data[0]
    expect(ev.event_name).toBe('Purchase')
    expect(ev.event_id).toBe('INV-20261015-ABCD1234')
    expect(ev.action_source).toBe('website')
    expect(ev.event_time).toBe(1_760_000_000)
  })

  it('email & telepon dikirim sebagai hash dari bentuk yang SUDAH dinormalisasi', () => {
    const ud = buildMetaPurchasePayload(pesanan, meta, 1)!.data[0].user_data
    expect(ud.em).toEqual([sha256('budi@mail.com')])
    expect(ud.ph).toEqual([sha256('6281234567890')])
    // Teks aslinya tak boleh muncul di mana pun dalam payload
    expect(JSON.stringify(ud)).not.toContain('Budi@Mail.com')
    expect(JSON.stringify(ud)).not.toContain('081234567890')
  })

  it('cookie _fbp/_fbc diteruskan apa adanya', () => {
    const ud = buildMetaPurchasePayload(pesanan, meta, 1)!.data[0].user_data
    expect(ud.fbp).toBe('fb.1.1696000000000.1234567890')
    expect(ud.fbc).toBe('fb.1.1696000000000.IwAR0abc')
  })

  it('value = total dibayar; content id = sku || productId; num_items = total kuantitas', () => {
    const cd = buildMetaPurchasePayload(pesanan, meta, 1)!.data[0].custom_data
    expect(cd).toMatchObject({ currency: 'IDR', value: 112720, order_id: 'INV-20261015-ABCD1234', num_items: 3 })
    expect(cd.content_ids).toEqual(['SPR-2L', 'prod-2'])
    expect(cd.contents).toEqual([
      { id: 'SPR-2L', quantity: 2, item_price: 46000 },
      { id: 'prod-2', quantity: 1, item_price: 15000 },
    ])
  })

  it('tanpa pengenal pembeli sama sekali → null', () => {
    const tanpa: Order = { ...pesanan, customerEmail: undefined, customerPhone: undefined, metaFbp: undefined, metaFbc: undefined }
    expect(buildMetaPurchasePayload(tanpa, meta, 1)).toBeNull()
  })

  it('cukup satu pengenal (mis. email saja) → payload tetap terbentuk tanpa kunci kosong', () => {
    const emailSaja: Order = { ...pesanan, customerPhone: undefined, metaFbp: undefined, metaFbc: undefined }
    const ud = buildMetaPurchasePayload(emailSaja, meta, 1)!.data[0].user_data
    expect(Object.keys(ud)).toEqual(['em'])
  })

  it('test_event_code & event_source_url hanya ada bila diminta', () => {
    const polos = buildMetaPurchasePayload(pesanan, meta, 1)!
    expect(polos).not.toHaveProperty('test_event_code')
    expect(polos.data[0]).not.toHaveProperty('event_source_url')

    const uji = buildMetaPurchasePayload(pesanan, meta, 1, { testEventCode: 'TEST123', sourceUrl: 'https://infarm.id/checkout' })!
    expect(uji.test_event_code).toBe('TEST123')
    expect(uji.data[0].event_source_url).toBe('https://infarm.id/checkout')
  })
})
