// tests/unit/analytics-server.test.ts
// Dua hal yang kalau salah tidak menimbulkan galat apa pun, dan baru ketahuan berminggu-minggu
// kemudian saat laporan dibuka:
//
//   1. Bentuk client_id. Measurement Protocol menerima string APA PUN tanpa mengeluh, lalu
//      mencatat penjualan atas nama pengunjung yang tak pernah ada.
//   2. item_id di payload purchase. Kalau ia tak sama dengan yang dikirim halaman detail produk,
//      funnel view_item → purchase putus tepat di langkah terakhir.

import { describe, expect, it } from 'vitest'
import { gaSessionCookieName, parseGaCookie, parseGaSessionCookie } from '@/lib/ga-client-id'
import { buildPurchasePayload, type ProductMeta } from '@/lib/analytics-server'
import type { Order } from '@/types/order'

describe('parseGaCookie', () => {
  it('mengambil dua bagian terakhir sebagai client_id', () => {
    expect(parseGaCookie('GA1.1.1234567890.1699999999')).toBe('1234567890.1699999999')
  })

  it('tetap benar saat jumlah bagian domain berbeda', () => {
    // Angka kedua = jumlah bagian domain, jadi ia memang berubah antar host. Yang stabil adalah
    // posisi client_id DARI BELAKANG — itulah yang dipegang parser ini.
    expect(parseGaCookie('GA1.2.1234567890.1699999999')).toBe('1234567890.1699999999')
    expect(parseGaCookie('GA1.3.1234567890.1699999999')).toBe('1234567890.1699999999')
  })

  it('menolak bentuk yang tak dikenali alih-alih menebak', () => {
    // Lebih baik kehilangan atribusi satu pesanan daripada mengirim potongan cookie sembarang ke
    // GA4 — yang kedua mengotori laporan secara permanen dan tak bisa dihapus.
    expect(parseGaCookie('GA1.1.1234567890')).toBeUndefined() // kurang satu bagian
    expect(parseGaCookie('GA1.1.abc.def')).toBeUndefined() // bukan angka
    expect(parseGaCookie('')).toBeUndefined()
    expect(parseGaCookie('sembarang teks')).toBeUndefined()
  })
})

const pesanan: Order = {
  orderId: 'INV-20260923-ABCD1234',
  customerName: 'Pembeli Uji',
  date: '2026-09-23T02:00:00.000Z',
  items: [
    { productId: 'prod-1', name: 'Sprayer 2L', quantity: 2, price: 46000 },
    { productId: 'prod-2', name: 'Polybag 20x20', quantity: 1, price: 15000 },
  ],
  totalAmount: 112720,
  shippingCost: 66720,
  paymentStatus: 'Lunas',
}

const meta = new Map<string, ProductMeta>([
  ['prod-1', { sku: 'SPR-2L', category: 'peralatan-berkebun' }],
  // prod-2 sengaja tanpa SKU — produk lama yang belum diisi.
  ['prod-2', { category: 'pot-polybag' }],
])

describe('buildPurchasePayload', () => {
  it('memakai nomor invoice sebagai transaction_id', () => {
    // Bukan id_transaksi Xendit: nomor invoice inilah yang muncul di OMS dan di laporan penjualan,
    // jadi angka GA4 bisa dicocokkan baris per baris dengan database saat ada yang meragukan.
    const payload = buildPurchasePayload(pesanan, '1234567890.1699999999', meta)
    expect(payload.events[0].params.transaction_id).toBe('INV-20260923-ABCD1234')
  })

  it('value = total dibayar, shipping dipisah', () => {
    const params = buildPurchasePayload(pesanan, '1.1', meta).events[0].params
    expect(params.value).toBe(112720)
    expect(params.shipping).toBe(66720)
    expect(params.currency).toBe('IDR')
  })

  it('item_id memakai SKU bila ada, dan jatuh ke productId bila tidak', () => {
    // Aturan yang sama persis dengan toItem() di src/lib/analytics.ts. Keduanya harus bergerak
    // bersama; kalau salah satu berubah sendiri, funnelnya yang patah, bukan build-nya.
    const items = buildPurchasePayload(pesanan, '1.1', meta).events[0].params.items
    expect(items[0].item_id).toBe('SPR-2L')
    expect(items[1].item_id).toBe('prod-2')
  })

  it('tetap menghasilkan payload utuh saat detail produk tak terbaca', () => {
    // productMetaFor() di webhook sengaja mengembalikan peta KOSONG bila pembacaan produk gagal,
    // supaya penjualannya tetap tercatat walau item_id-nya kurang rapi. Yang tak boleh terjadi
    // adalah event batal terkirim.
    const params = buildPurchasePayload(pesanan, '1.1', new Map()).events[0].params
    expect(params.items.map((i) => i.item_id)).toEqual(['prod-1', 'prod-2'])
    expect(params.items.every((i) => i.item_category === '')).toBe(true)
    expect(params.value).toBe(112720)
  })

  it('shipping 0 untuk pesanan lama yang tak punya kolom ongkir', () => {
    // `undefined` di sana berarti "kolomnya belum ada saat pesanan dibuat", bukan gratis ongkir.
    // GA4 tak punya cara menyatakan "tidak diketahui", jadi 0 adalah pilihan yang paling tidak
    // menyesatkan — dan alasannya perlu tertulis supaya tak dibaca sebagai bug.
    const tanpaOngkir: Order = { ...pesanan, shippingCost: undefined }
    expect(buildPurchasePayload(tanpaOngkir, '1.1', meta).events[0].params.shipping).toBe(0)
  })
})

describe('parseGaSessionCookie', () => {
  it('membaca bentuk GS1 — bagian ketiga angka polos', () => {
    expect(parseGaSessionCookie('GS1.1.1758600000.3.1.1758600120.0.0.0')).toBe('1758600000')
  })

  it('membaca bentuk GS2 — bagian ketiga ber-awalan s dan dipisah $', () => {
    // Google mengganti bentuk cookie ini tanpa pengumuman. Kedua bentuk harus tetap terbaca,
    // karena browser yang berbeda bisa memegang versi yang berbeda pada saat yang sama.
    expect(parseGaSessionCookie('GS2.1.s1758600000$o3$g1$t1758600120$j60$l0$h0')).toBe(
      '1758600000',
    )
  })

  it('menolak bentuk yang tak dikenali alih-alih menebak', () => {
    // Bentuk ketiga yang belum pernah kita lihat harus jatuh ke undefined. Menebaknya berbahaya:
    // Measurement Protocol menerima session_id apa pun tanpa mengeluh, lalu menempelkan penjualan
    // ke sesi yang tidak ada — lebih buruk daripada tidak teratribusi sama sekali.
    expect(parseGaSessionCookie('GS3.1.xyz$o1')).toBeUndefined()
    expect(parseGaSessionCookie('GS1.1')).toBeUndefined()
    expect(parseGaSessionCookie('')).toBeUndefined()
  })
})

describe('gaSessionCookieName', () => {
  it('membuang awalan G- dari Measurement ID', () => {
    expect(gaSessionCookieName('G-ABC123XYZ')).toBe('_ga_ABC123XYZ')
  })
})

describe('buildPurchasePayload — session_id', () => {
  it('menyertakan session_id dan engagement_time_msec bila pesanan punya sesi', () => {
    const denganSesi: Order = { ...pesanan, gaSessionId: '1758600000' }
    const params = buildPurchasePayload(denganSesi, '1.1', meta).events[0].params

    expect(params.session_id).toBe('1758600000')
    // Wajib berpasangan: session_id tanpa engagement_time_msec membuat GA4 menerima event-nya
    // tapi tidak menghitungnya sebagai bagian sesi, dan atribusinya gagal tanpa pesan galat.
    expect(params.engagement_time_msec).toBe('1')
  })

  it('tetap mengirim purchase utuh walau sesi tak terbaca', () => {
    // Pendapatannya nyata walau kanalnya tak diketahui. Yang tak boleh terjadi adalah event batal
    // terkirim hanya karena cookie sesi diblokir.
    const params = buildPurchasePayload(pesanan, '1.1', meta).events[0].params

    expect(params.session_id).toBeUndefined()
    expect(params.engagement_time_msec).toBeUndefined()
    expect(params.value).toBe(112720)
    expect(params.transaction_id).toBe('INV-20260923-ABCD1234')
  })
})
