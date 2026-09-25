// tests/unit/promotion-wib.test.ts
// Batas periode promo dalam WIB. Kasus asalnya (25 Sep 2026): promo "mulai 26 Sep" tersimpan
// sebagai 00.00 UTC = 07.00 WIB, dan promo "berakhir 30 Sep" masih berlaku sampai 1 Okt 06.59 WIB.

import { describe, expect, it } from 'vitest'
import {
  isPromotionExpired,
  isPromotionScheduled,
  promoEndIso,
  promoStartIso,
  todayWib,
  toWibDateInput,
} from '@/types/promotion'

const ms = (iso: string) => new Date(iso).getTime()

describe('batas hari promo dalam WIB', () => {
  it('mulai tepat 00.00 WIB, berakhir tepat 23.59.59 WIB', () => {
    expect(ms(promoStartIso('2026-09-26'))).toBe(ms('2026-09-25T17:00:00Z'))
    expect(ms(promoEndIso('2026-09-30'))).toBe(ms('2026-09-30T16:59:59Z'))
  })

  it('terbaca kembali sebagai tanggal yang sama di formulir', () => {
    // Bentuk yang dikembalikan Postgres: UTC
    expect(toWibDateInput('2026-09-25T17:00:00+00:00')).toBe('2026-09-26')
    expect(toWibDateInput('2026-09-30T16:59:59+00:00')).toBe('2026-09-30')
    expect(toWibDateInput(null)).toBe('')
    expect(toWibDateInput('bukan-tanggal')).toBe('')
  })

  it('hari ini menurut WIB, bukan UTC', () => {
    // 25 Sep 20.00 UTC = 26 Sep 03.00 WIB
    expect(todayWib(new Date('2026-09-25T20:00:00Z'))).toBe('2026-09-26')
  })
})

describe('status terjadwal & kedaluwarsa', () => {
  const start = promoStartIso('2026-09-26')
  const end = promoEndIso('2026-09-30')

  it('terjadwal sampai 00.00 WIB tanggal mulainya', () => {
    expect(isPromotionScheduled(start, ms('2026-09-25T23:59:00+07:00'))).toBe(true)
    expect(isPromotionScheduled(start, ms('2026-09-26T00:00:01+07:00'))).toBe(false)
    expect(isPromotionScheduled(null, ms('2026-09-25T00:00:00Z'))).toBe(false)
  })

  it('kedaluwarsa setelah 23.59.59 WIB tanggal berakhirnya, bukan pagi hari berikutnya', () => {
    expect(isPromotionExpired(end, ms('2026-09-30T23:59:00+07:00'))).toBe(false)
    expect(isPromotionExpired(end, ms('2026-10-01T00:00:01+07:00'))).toBe(true)
  })
})
