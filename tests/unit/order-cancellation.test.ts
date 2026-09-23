// tests/unit/order-cancellation.test.ts
// Siapa yang boleh membatalkan pesanan sendiri, dan kapan.
//
// Garis batasnya adalah RESI, bukan status pesanan. Booking kurir berjalan tepat setelah
// pembayaran masuk, sementara status baru berpindah ke 'Dikirim' ketika admin menandainya — ada
// jendela berjam-jam saat pesanan masih 'Diproses' padahal resinya sudah tercetak. Membiarkan
// pembeli membatalkan sendiri di jendela itu berarti stok dikreditkan balik seolah barang masih
// ada, sementara paketnya tetap berjalan.

import { describe, expect, it } from 'vitest'
import { evaluateBuyerCancel } from '@/lib/order-cancellation'

describe('evaluateBuyerCancel', () => {
  it('mengizinkan pembatalan sebelum kurir dibooking', () => {
    expect(evaluateBuyerCancel({ status: 'Menunggu Pembayaran' })).toEqual({ ok: true })
    expect(evaluateBuyerCancel({ status: 'Diproses' })).toEqual({ ok: true })
  })

  it('menyerahkan ke CS begitu resi sudah ada, walau status masih Diproses', () => {
    const hasil = evaluateBuyerCancel({ status: 'Diproses', trackingNumber: 'JO9001419509' })
    expect(hasil.ok).toBe(false)
    expect(hasil.ok === false && hasil.code).toBe('NEEDS_CS')
  })

  it('menyerahkan ke CS bila pengiriman sudah tercatat BOOKED tanpa nomor resi', () => {
    // Booking bisa berhasil tapi nomor resinya gagal tersimpan. Yang menentukan adalah perintah
    // jemput yang sudah ada di kurir, bukan kolom yang kebetulan terisi.
    const hasil = evaluateBuyerCancel({ status: 'Diproses', shipmentStatus: 'BOOKED' })
    expect(hasil.ok === false && hasil.code).toBe('NEEDS_CS')
  })

  it('menolak pesanan yang sudah dibatalkan dan yang sudah dikirim', () => {
    expect(evaluateBuyerCancel({ status: 'Dibatalkan' }).ok).toBe(false)
    const dikirim = evaluateBuyerCancel({ status: 'Dikirim' })
    expect(dikirim.ok === false && dikirim.code).toBe('ALREADY_SHIPPED')
  })

  it('tidak menganggap resi berisi spasi sebagai bukti booking', () => {
    expect(evaluateBuyerCancel({ status: 'Diproses', trackingNumber: '   ' })).toEqual({ ok: true })
  })
})
