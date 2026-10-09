// tests/unit/order-active-status.test.ts
// Aturan "pesanan masih aktif" yang dipakai tab Aktif/Selesai di Lacak Pesanan dan badge pesanan
// aktif di header. Salah di sini = pesanan yang masih dikirim lenyap dari tab Aktif, atau badge
// menghitung pesanan yang sudah selesai.

import { describe, expect, it } from 'vitest'
import { isActiveOrderStatus } from '@/lib/order-status-machine'

describe('isActiveOrderStatus', () => {
  it('Menunggu Pembayaran, Diproses, Dikirim = aktif', () => {
    expect(isActiveOrderStatus('Menunggu Pembayaran')).toBe(true)
    expect(isActiveOrderStatus('Diproses')).toBe(true)
    expect(isActiveOrderStatus('Dikirim')).toBe(true)
  })

  it('Selesai dan Dibatalkan = tidak aktif (tab Selesai)', () => {
    expect(isActiveOrderStatus('Selesai')).toBe(false)
    expect(isActiveOrderStatus('Dibatalkan')).toBe(false)
  })

  it('status tak dikenal dianggap aktif, bukan disembunyikan', () => {
    expect(isActiveOrderStatus('')).toBe(true)
    expect(isActiveOrderStatus('STATUS_BARU')).toBe(true)
  })
})
