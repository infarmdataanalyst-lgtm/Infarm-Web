// tests/unit/delivery-estimate.test.ts
// Estimasi tiba adalah JANJI ke pembeli. Salah urai → pembeli di Aceh dijanjikan besok, atau
// pembeli di Jakarta dijanjikan bulan depan.

import { describe, expect, it } from 'vitest'
import {
  FALLBACK_ESTIMATE_DAYS,
  formatArrivalRange,
  parseEstimateDays,
} from '@/lib/delivery-estimate'

describe('parseEstimateDays', () => {
  it('mengurai bentuk yang dikirim Mengantar', () => {
    expect(parseEstimateDays('2-4 hari')).toEqual({ min: 2, max: 4 })
    expect(parseEstimateDays('2 - 4 Hari')).toEqual({ min: 2, max: 4 })
    expect(parseEstimateDays('3 hari')).toEqual({ min: 3, max: 3 })
  })

  it('menolak yang tak masuk akal alih-alih menjanjikannya', () => {
    expect(parseEstimateDays(null)).toBeNull()
    expect(parseEstimateDays('')).toBeNull()
    expect(parseEstimateDays('segera')).toBeNull()
    expect(parseEstimateDays('4-2 hari')).toBeNull() // terbalik
    expect(parseEstimateDays('2026-09-24')).toBeNull() // tanggal, bukan lama hari
    expect(parseEstimateDays('45 hari')).toBeNull() // di luar batas wajar
  })
})

describe('formatArrivalRange', () => {
  // 24 Sep 2026 10.00 WIB
  const START = '2026-09-24T03:00:00.000Z'

  it('menghitung dari waktu mulai, di zona WIB', () => {
    expect(formatArrivalRange(START, { min: 2, max: 4 })).toBe('26 Sep – 28 Sep')
  })

  it('satu tanggal saja bila min = max', () => {
    expect(formatArrivalRange(START, { min: 1, max: 1 })).toBe('25 Sep')
  })

  it('jatuh ke perkiraan lama bila estimasi tak ada', () => {
    expect(formatArrivalRange(START, null)).toBe(
      formatArrivalRange(START, FALLBACK_ESTIMATE_DAYS),
    )
  })

  it('tetap menampilkan sesuatu yang jujur bila tanggal mulainya rusak', () => {
    expect(formatArrivalRange('bukan-tanggal', { min: 2, max: 4 })).toBe('2–4 hari')
  })
})
