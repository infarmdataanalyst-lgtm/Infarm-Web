// tests/unit/order-export.test.ts
// Nama berkas ekspor CSV halaman Pesanan: selalu bertanggal, dan tanggalnya tanggal WIB — bukan UTC,
// yang di pagi hari WIB masih menunjuk hari kemarin.

import { describe, expect, it } from 'vitest'
import { orderExportFileName } from '@/lib/order-export'

// 14 Okt 2026 pukul 06.30 WIB = 13 Okt 2026 23.30 UTC.
const PAGI_WIB_14_OKT = Date.UTC(2026, 9, 13, 23, 30)

describe('orderExportFileName', () => {
  it('tanpa filter tanggal → tanggal ekspor WIB', () => {
    expect(orderExportFileName('', '', PAGI_WIB_14_OKT)).toBe('pesanan_20261014.csv')
  })

  it('dengan rentang → rentang yang diekspor', () => {
    expect(orderExportFileName('2026-10-01', '2026-10-14', PAGI_WIB_14_OKT)).toBe('pesanan_20261001-20261014.csv')
  })

  it('satu hari yang sama → satu tanggal saja', () => {
    expect(orderExportFileName('2026-10-12', '2026-10-12', PAGI_WIB_14_OKT)).toBe('pesanan_20261012.csv')
  })

  it('batas yang kosong: dari → "awal", sampai → tanggal ekspor', () => {
    expect(orderExportFileName('2026-10-01', '', PAGI_WIB_14_OKT)).toBe('pesanan_20261001-20261014.csv')
    expect(orderExportFileName('', '2026-10-10', PAGI_WIB_14_OKT)).toBe('pesanan_awal-20261010.csv')
  })
})
