// tests/unit/mengantar-cancel.test.ts
// Aturan "kegagalan mana yang layak diulang" (MGT-66).
//
// Salah di sisi longgar: permintaan yang sudah dijawab Mengantar diulang berkali-kali sambil
// menahan admin di depan layar, tanpa peluang hasil berbeda.
// Salah di sisi ketat: gangguan sesaat — persis yang terjadi 22 Sep 2026 pada resi JO6451515051 —
// langsung menyerah, penjemputan kurir tetap hidup, dan saldo toko tertahan sampai ada manusia
// yang membaca kolom galat.

import { describe, expect, it } from 'vitest'
import { buildCancelPayload, isRetryableCancelFailure } from '@/lib/mengantar-cancel'

describe('isRetryableCancelFailure', () => {
  it('mengulang gangguan di jalan menuju Mengantar', () => {
    expect(isRetryableCancelFailure('network')).toBe(true)
    // Halaman galat HTML dari CDN datang sebagai HTTP 200 yang bukan JSON — bentuk MGT-66.
    expect(isRetryableCancelFailure('bad-shape', 200)).toBe(true)
    expect(isRetryableCancelFailure('http-error', 429)).toBe(true)
    expect(isRetryableCancelFailure('http-error', 500)).toBe(true)
    expect(isRetryableCancelFailure('http-error', 503)).toBe(true)
  })

  it('TIDAK mengulang jawaban Mengantar sendiri', () => {
    // Keduanya adalah keputusan Mengantar, bukan gangguan. Mengulang hanya menghasilkan jawaban
    // yang sama — termasuk "Orders already deleted", yang justru berarti tak ada lagi yang dihapus.
    expect(isRetryableCancelFailure('rejected', 200)).toBe(false)
    expect(isRetryableCancelFailure('not-deleted', 200)).toBe(false)
  })

  it('TIDAK mengulang penolakan 4xx selain 429', () => {
    // 401/403/404 berarti permintaan kita sendiri yang salah; mengulangnya percuma.
    expect(isRetryableCancelFailure('http-error', 400)).toBe(false)
    expect(isRetryableCancelFailure('http-error', 401)).toBe(false)
    expect(isRetryableCancelFailure('http-error', 404)).toBe(false)
  })

  it('TIDAK mengulang keadaan kita sendiri yang tak berubah dalam dua detik', () => {
    expect(isRetryableCancelFailure('not-configured')).toBe(false)
    expect(isRetryableCancelFailure('no-identity')).toBe(false)
    expect(isRetryableCancelFailure('blocked-environment')).toBe(false)
  })
})

describe('buildCancelPayload', () => {
  it('memakai _id bila ada, dan TIDAK menyertakan orderIds bersamaan', () => {
    // Dokumentasi Mengantar: bila `ids` ada, `orderIds` akan menimpanya. Karena itu hanya satu
    // yang boleh dikirim.
    const payload = buildCancelPayload({ objectId: '6ab339fb167806e924329b81', orderId: '260923ZO35XM' })
    expect(payload).toEqual({ courier: 'JT', ids: ['6ab339fb167806e924329b81'] })
    expect(payload && 'orderIds' in payload).toBe(false)
  })

  it('jatuh ke ORDER_ID hanya bila _id tak ada', () => {
    expect(buildCancelPayload({ orderId: '260923ZO35XM' })).toEqual({
      courier: 'JT',
      orderIds: ['260923ZO35XM'],
    })
  })

  it('null bila pesanan tak punya identitas Mengantar sama sekali', () => {
    // Pesanan lama yang gagal di-backfill. Pemanggil yang memutuskan langkah berikutnya —
    // jangan sampai ia mengirim DELETE tanpa sasaran.
    expect(buildCancelPayload({})).toBeNull()
    expect(buildCancelPayload({ objectId: '   ' })).toBeNull()
  })
})
