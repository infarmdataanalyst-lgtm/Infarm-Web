// tests/unit/cart-lines.test.ts
// Paket di keranjang. Bug asalnya (24 Sep 2026): pembeli memasukkan paket A-B-C lalu menambah A
// satuan → keranjang menggabung keduanya jadi A×2 bertanda paket → server menolak seluruh pesanan.
// Arah sebaliknya lebih buruk: A satuan ditimpa paket dan hilang tanpa pemberitahuan.

import { describe, expect, it } from 'vitest'
import {
  addCombo,
  addLooseItem,
  comboMultiplier,
  removeLooseLine,
  setComboCount,
  updateLooseQuantity,
} from '@/lib/cart-lines'
import { allocateComboPrices } from '@/lib/promo-cart'
import { mergeRequirements } from '@/lib/warehouse'
import type { CartItem } from '@/types/cart'
import type { ComboItem } from '@/types/combo'

const PAKET = 'paket-1'
// Harga alokasi paket untuk A, B, C (satu paket)
const ISI_PAKET = [
  { productId: 'A', quantity: 1, price: 25000 },
  { productId: 'B', quantity: 1, price: 15000 },
  { productId: 'C', quantity: 1, price: 6300 },
]
const A_SATUAN: CartItem = { productId: 'A', quantity: 1, price: 29900 }

const baris = (cart: CartItem[], productId: string, comboId?: string) =>
  cart.filter((c) => c.productId === productId && c.comboId === comboId)

describe('produk yang sama di dalam paket dan satuan', () => {
  it('paket dulu, lalu A satuan → dua baris A dengan harga masing-masing', () => {
    const cart = addLooseItem(addCombo([], PAKET, ISI_PAKET), A_SATUAN)

    expect(baris(cart, 'A', PAKET)).toEqual([{ productId: 'A', quantity: 1, price: 25000, comboId: PAKET }])
    expect(baris(cart, 'A', undefined)).toEqual([A_SATUAN])
    expect(cart).toHaveLength(4)
  })

  it('A satuan dulu, lalu paket → A satuan TIDAK ditimpa', () => {
    const cart = addCombo(addLooseItem([], A_SATUAN), PAKET, ISI_PAKET)

    expect(baris(cart, 'A', undefined)).toEqual([A_SATUAN])
    expect(baris(cart, 'A', PAKET)[0].quantity).toBe(1)
    expect(cart).toHaveLength(4)
  })

  it('menambah A satuan lagi hanya menambah baris satuan', () => {
    let cart = addLooseItem(addCombo([], PAKET, ISI_PAKET), A_SATUAN)
    cart = addLooseItem(cart, A_SATUAN)

    expect(baris(cart, 'A', undefined)[0].quantity).toBe(2)
    expect(baris(cart, 'A', PAKET)[0].quantity).toBe(1)
  })

  it('comboId pada item satuan diabaikan — paket hanya masuk lewat addCombo', () => {
    const cart = addLooseItem([], { ...A_SATUAN, comboId: PAKET })
    expect(cart[0].comboId).toBeUndefined()
  })

  it('ubah jumlah & hapus baris satuan tak menyentuh anggota paket', () => {
    let cart = addLooseItem(addCombo([], PAKET, ISI_PAKET), A_SATUAN)
    cart = updateLooseQuantity(cart, 'A', 5)
    expect(baris(cart, 'A', undefined)[0].quantity).toBe(5)
    expect(baris(cart, 'A', PAKET)[0].quantity).toBe(1)

    cart = removeLooseLine(cart, 'A')
    expect(baris(cart, 'A', undefined)).toHaveLength(0)
    expect(baris(cart, 'A', PAKET)).toHaveLength(1)
  })

  it('memasukkan paket yang sama dua kali tak menggandakan anggotanya', () => {
    const cart = addCombo(addCombo([], PAKET, ISI_PAKET), PAKET, ISI_PAKET)
    expect(cart).toHaveLength(3)
  })
})

describe('jumlah paket (N)', () => {
  const units = [
    { productId: 'A', quantity: 1 },
    { productId: 'B', quantity: 1 },
    { productId: 'C', quantity: 1 },
  ]

  it('tiga paket 1-1-1 → 3-3-3, dan server menghitung N = 3', () => {
    const cart = setComboCount(addCombo([], PAKET, ISI_PAKET), PAKET, units, 3)
    expect(cart.map((c) => c.quantity)).toEqual([3, 3, 3])
    expect(comboMultiplier(units, cart)).toBe(3)
  })

  it('paket berisi A×2 + B×1: tiga paket → 6-3', () => {
    const unitsAB = [
      { productId: 'A', quantity: 2 },
      { productId: 'B', quantity: 1 },
    ]
    const start = addCombo([], PAKET, [
      { productId: 'A', quantity: 2, price: 10000 },
      { productId: 'B', quantity: 1, price: 5000 },
    ])
    const cart = setComboCount(start, PAKET, unitsAB, 3)
    expect(cart.map((c) => c.quantity)).toEqual([6, 3])
    expect(comboMultiplier(unitsAB, cart)).toBe(3)
  })

  it('jumlah paket < 1 mengeluarkan seluruh paket, baris satuan tetap', () => {
    const cart = setComboCount(addLooseItem(addCombo([], PAKET, ISI_PAKET), A_SATUAN), PAKET, units, 0)
    expect(cart).toEqual([A_SATUAN])
  })
})

describe('comboMultiplier — aturan sah/tidaknya paket (dipakai keranjang DAN server)', () => {
  const units = [
    { productId: 'A', quantity: 1 },
    { productId: 'B', quantity: 1 },
    { productId: 'C', quantity: 1 },
  ]
  const lines = (a: number, b: number, c: number) => [
    { productId: 'A', quantity: a },
    { productId: 'B', quantity: b },
    { productId: 'C', quantity: c },
  ]

  it('menerima kelipatan yang seragam', () => {
    expect(comboMultiplier(units, lines(1, 1, 1))).toBe(1)
    expect(comboMultiplier(units, lines(3, 3, 3))).toBe(3)
  })

  it('menolak kelipatan yang tak seragam — kasus bug asalnya (A×2 di paket 1-1-1)', () => {
    expect(comboMultiplier(units, lines(2, 1, 1))).toBeNull()
    expect(comboMultiplier(units, lines(3, 3, 2))).toBeNull()
  })

  it('menolak isi yang bukan kelipatan isi per paket', () => {
    const unitsAB = [
      { productId: 'A', quantity: 2 },
      { productId: 'B', quantity: 1 },
    ]
    expect(comboMultiplier(unitsAB, [{ productId: 'A', quantity: 3 }, { productId: 'B', quantity: 3 }])).toBeNull()
    expect(comboMultiplier(unitsAB, [{ productId: 'A', quantity: 1 }, { productId: 'B', quantity: 1 }])).toBeNull()
  })

  it('menolak anggota kurang, anggota ganda, produk asing, varian, dan jumlah nol', () => {
    expect(comboMultiplier(units, lines(1, 1, 1).slice(0, 2))).toBeNull()
    // Paket A-B dikirim sebagai [A, A] — dulu LOLOS karena jumlah barisnya kebetulan sama.
    expect(
      comboMultiplier(
        [
          { productId: 'A', quantity: 1 },
          { productId: 'B', quantity: 1 },
        ],
        [
          { productId: 'A', quantity: 1 },
          { productId: 'A', quantity: 1 },
        ],
      ),
    ).toBeNull()
    expect(
      comboMultiplier(units, [...lines(1, 1, 1).slice(0, 2), { productId: 'X', quantity: 1 }]),
    ).toBeNull()
    expect(
      comboMultiplier(units, [{ productId: 'A', quantity: 1, variantId: 'v1' }, ...lines(1, 1, 1).slice(1)]),
    ).toBeNull()
    expect(comboMultiplier(units, lines(0, 0, 0))).toBeNull()
  })
})

describe('harga N paket = N × harga paket', () => {
  const item = (productId: string, unitPrice: number, dealPrice: number | null, quantity = 1): ComboItem => ({
    productId,
    name: productId,
    unitPrice,
    quantity,
    isPrimary: productId === 'A',
    dealPrice,
  })

  // Server menghargai tiap baris paket dengan harga SATUAN hasil alokasi × jumlah di baris itu.
  const totalServer = (items: ComboItem[], comboPrice: number, n: number) =>
    allocateComboPrices(items, comboPrice).reduce((sum, a) => sum + a.price * a.quantity * n, 0)

  it('paket berharga per produk (deal_price) — contoh "testing 1" Rp46.300', () => {
    const items = [item('A', 29900, 25000), item('B', 15000, 15000), item('C', 6900, 6300)]
    expect(totalServer(items, 46300, 1)).toBe(46300)
    expect(totalServer(items, 46300, 3)).toBe(3 * 46300)
  })

  it('paket lama (dibagi proporsional) — tanpa selisih pembulatan antar N', () => {
    const items = [item('A', 15000, null), item('B', 10000, null), item('C', 7000, null)]
    const satu = totalServer(items, 30000, 1)
    expect(totalServer(items, 30000, 4)).toBe(4 * satu)
  })
})

describe('kebutuhan stok dijumlahkan per produk', () => {
  it('A di paket ×2 + A satuan ×1 = butuh 3', () => {
    const merged = mergeRequirements([
      { productId: 'A', quantity: 2 },
      { productId: 'B', quantity: 2 },
      { productId: 'A', quantity: 1 },
    ])
    expect(merged.find((m) => m.productId === 'A')?.quantity).toBe(3)
    expect(merged.find((m) => m.productId === 'B')?.quantity).toBe(2)
  })
})
