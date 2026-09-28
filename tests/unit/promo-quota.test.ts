// tests/unit/promo-quota.test.ts
// Kuota promo (migration 20260928120000). Pemotongan & pengembalian kuota yang sebenarnya terjadi
// di database (create_order_with_items / release_promo_quota) dan diuji di preview; yang diuji di
// sini adalah aturan aplikasi: kapan promo dianggap habis, kapan pesanan ditolak alih-alih ditagih
// lebih mahal diam-diam, dan validasi isian formulir.

import { describe, expect, it } from 'vitest'
import { parseExpectedPromoIds, planPromoQuota, promoQuotaMessage } from '@/lib/promo-quota'
import { validatePromotionInput } from '@/lib/promotion-validation'
import { isPromotionQuotaFull, remainingQuota, type Promotion } from '@/types/promotion'

const NOW = Date.parse('2026-09-28T03:00:00.000Z')

function promo(over: Partial<Promotion> & { id: string }): Promotion {
  return {
    name: over.id,
    type: 'free_shipping',
    minPurchase: 150_000,
    freeProductId: null,
    freeProductName: null,
    discountValue: null,
    startAt: null,
    endAt: null,
    progressMessage: '',
    isActive: true,
    usageLimit: null,
    usageCount: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  }
}

describe('sisa kuota', () => {
  it('tanpa batas → null dan tak pernah penuh', () => {
    const p = promo({ id: 'a', usageCount: 999 })
    expect(remainingQuota(p)).toBeNull()
    expect(isPromotionQuotaFull(p)).toBe(false)
  })

  it('berbatas → sisa = batas − terpakai, penuh saat 0', () => {
    expect(remainingQuota(promo({ id: 'a', usageLimit: 10, usageCount: 7 }))).toBe(3)
    expect(isPromotionQuotaFull(promo({ id: 'a', usageLimit: 10, usageCount: 10 }))).toBe(true)
  })

  it('batas diturunkan di bawah pemakaian → sisa 0, bukan negatif', () => {
    const p = promo({ id: 'a', usageLimit: 5, usageCount: 8 })
    expect(remainingQuota(p)).toBe(0)
    expect(isPromotionQuotaFull(p)).toBe(true)
  })
})

describe('planPromoQuota', () => {
  const ongkirHabis = promo({ id: 'ongkir', name: 'Gratis ongkir', usageLimit: 10, usageCount: 10 })
  const hadiah = promo({ id: 'hadiah', type: 'free_product', minPurchase: 100_000 })

  it('promo yang kuotanya habis tak ikut diterapkan', () => {
    const plan = planPromoQuota([ongkirHabis, hadiah], 50_000, NOW, [])
    expect(plan.available.map((p) => p.id)).toEqual(['hadiah'])
  })

  it('pembeli masih MENGIRA promo itu berlaku → pesanan ditolak, bukan ditagih lebih mahal', () => {
    const plan = planPromoQuota([ongkirHabis, hadiah], 179_400, NOW, ['ongkir', 'hadiah'])
    expect(plan.exhaustedExpected.map((p) => p.id)).toEqual(['ongkir'])
  })

  it('checkout sudah memuat ulang (promo tak lagi ditampilkan) → pesanan jalan tanpa promo itu', () => {
    const plan = planPromoQuota([ongkirHabis, hadiah], 179_400, NOW, ['hadiah'])
    expect(plan.exhaustedExpected).toEqual([])
  })

  it('klien lama tanpa expectedPromoIds → dianggap mengharapkan semua promo yang memenuhi syarat', () => {
    const plan = planPromoQuota([ongkirHabis], 179_400, NOW, null)
    expect(plan.exhaustedExpected.map((p) => p.id)).toEqual(['ongkir'])
  })

  it('syarat belanja belum tercapai → kuota habis tak menolak apa pun', () => {
    const plan = planPromoQuota([ongkirHabis], 100_000, NOW, null)
    expect(plan.exhaustedExpected).toEqual([])
  })
})

describe('parseExpectedPromoIds & pesan', () => {
  it('hanya string yang dipakai; bukan array → null', () => {
    expect(parseExpectedPromoIds(['a', 1, '', 'b'])).toEqual(['a', 'b'])
    expect(parseExpectedPromoIds(undefined)).toBeNull()
  })

  it('pesan menyebut nama promo dan meminta pembeli memeriksa total', () => {
    const msg = promoQuotaMessage(['Gratis ongkir'])
    expect(msg).toContain('Kuota promo Gratis ongkir sudah habis')
    expect(msg).toContain('total pembayaranmu berubah')
  })
})

describe('validasi formulir: batas pemakaian', () => {
  const dasar = { name: 'Gratis ongkir', type: 'free_shipping', minPurchase: 150_000, progressMessage: '' }

  it('kosong / tak dikirim → tanpa batas', () => {
    const r1 = validatePromotionInput({ ...dasar, usageLimit: null })
    const r2 = validatePromotionInput(dasar)
    expect(r1.ok && r1.value.usageLimit).toBeNull()
    expect(r2.ok && r2.value.usageLimit).toBeNull()
  })

  it('bilangan bulat 1–1.000.000 diterima', () => {
    const r = validatePromotionInput({ ...dasar, usageLimit: 10 })
    expect(r.ok && r.value.usageLimit).toBe(10)
  })

  it('0, pecahan, negatif, dan terlalu besar ditolak', () => {
    for (const bad of [0, 2.5, -1, 1_000_001, '10']) {
      expect(validatePromotionInput({ ...dasar, usageLimit: bad }).ok).toBe(false)
    }
  })
})
