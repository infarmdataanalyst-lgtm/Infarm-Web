import { describe, expect, it } from 'vitest'
import { parseAppliedPromos } from '@/lib/applied-promos'

describe('parseAppliedPromos', () => {
  it('membaca snapshot promo_terpakai (kasus INV-20260925-8A394YRX)', () => {
    const raw = [
      { id: 'p1', name: 'Gratis ongkir', type: 'free_shipping', value: 12000 },
      { id: 'p2', name: 'Promo day', type: 'free_product', value: 25000 },
    ]
    expect(parseAppliedPromos(raw)).toEqual(raw)
  })

  it('kolom kosong / null / bukan array → tanpa promo', () => {
    expect(parseAppliedPromos(null)).toEqual([])
    expect(parseAppliedPromos(undefined)).toEqual([])
    expect(parseAppliedPromos([])).toEqual([])
    expect(parseAppliedPromos({ name: 'x' })).toEqual([])
    expect(parseAppliedPromos('bukan json')).toEqual([])
  })

  it('string JSON tetap terbaca', () => {
    expect(parseAppliedPromos('[{"name":"Promo day","type":"free_product","value":5000}]')).toEqual([
      { id: '', name: 'Promo day', type: 'free_product', value: 5000 },
    ])
  })

  it('entri tanpa nama dibuang, nilai tak sah jadi 0', () => {
    expect(
      parseAppliedPromos([{ id: 'a', type: 'free_shipping' }, { name: 'Diskon', value: 'x' }, 7]),
    ).toEqual([{ id: '', name: 'Diskon', type: '', value: 0 }])
  })
})
