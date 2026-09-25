// tests/unit/gift-shipping.test.ts
// Hadiah promo yang tak bisa ikut dikirim (dropUnshippableGifts). Kasus nyatanya (25 Sep 2026):
// Hidroton ada di Gudang Jakarta & Utama, hadiah "Paket 5 Benih" hanya di Utama. Bila barang
// pesanan hanya ada di gudang yang tak punya hadiahnya, dulu pesanan gagal "stok tidak mencukupi";
// kini hadiahnya yang dilewati, pesanannya tetap jalan.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WarehouseStock } from '@/types/warehouse'

// Keadaan gudang & stok tiruan, diatur per test.
let multi = true
let stok: WarehouseStock[] = []

vi.mock('@/lib/warehouse', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/warehouse')>()),
  isMultiWarehouse: async () => multi,
  getDefaultWarehouse: async () => null,
}))

vi.mock('@/lib/mock-db/warehouses', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mock-db/warehouses')>()),
  readWarehouses: async () => [
    { id: 'jkt', nama: 'Gudang Jakarta', isActive: true, isDefault: false },
    { id: 'utm', nama: 'Gudang Utama', isActive: true, isDefault: true },
  ],
  readStockRows: async ({ productIds }: { productIds?: string[] } = {}) =>
    stok.filter((r) => !productIds || productIds.includes(r.productId)),
}))

const { dropUnshippableGifts } = await import('@/lib/warehouse-shipping')

const row = (productId: string, warehouseId: string, jumlah: number): WarehouseStock => ({
  id: `${productId}@${warehouseId}`,
  productId,
  warehouseId,
  stok: jumlah,
})

const HIDROTON = { productId: 'hidroton', quantity: 6 }
const HADIAH = { productId: 'benih', quantity: 1, isGift: true }

beforeEach(() => {
  multi = true
  stok = []
})

describe('dropUnshippableGifts', () => {
  it('hadiah dipertahankan bila ada gudang yang punya barang pesanan + hadiahnya', async () => {
    stok = [row('hidroton', 'jkt', 50), row('hidroton', 'utm', 97), row('benih', 'utm', 112)]
    const plan = await dropUnshippableGifts([HIDROTON, HADIAH])
    expect(plan.droppedGiftIds).toEqual([])
    expect(plan.items).toEqual([{ productId: 'hidroton', quantity: 6 }, { productId: 'benih', quantity: 1 }])
  })

  it('hadiah dilewati bila barang pesanan hanya ada di gudang tanpa hadiah', async () => {
    stok = [row('hidroton', 'jkt', 50), row('benih', 'utm', 112)]
    const plan = await dropUnshippableGifts([HIDROTON, HADIAH])
    expect(plan.droppedGiftIds).toEqual(['benih'])
    expect(plan.items).toEqual([{ productId: 'hidroton', quantity: 6 }])
  })

  it('hanya hadiah yang tak bisa ikut yang dilewati — hadiah lain tetap diusahakan', async () => {
    stok = [row('hidroton', 'jkt', 50), row('pot', 'jkt', 5), row('benih', 'utm', 112)]
    const plan = await dropUnshippableGifts([
      HIDROTON,
      HADIAH,
      { productId: 'pot', quantity: 1, isGift: true },
    ])
    expect(plan.droppedGiftIds).toEqual(['benih'])
    expect(plan.items.map((i) => i.productId)).toEqual(['hidroton', 'pot'])
  })

  it('barang pesanan sendiri tak ada di satu gudang → tak diubah (alur lama yang menangani)', async () => {
    stok = [row('benih', 'utm', 112)]
    const plan = await dropUnshippableGifts([HIDROTON, HADIAH])
    expect(plan.droppedGiftIds).toEqual([])
    expect(plan.items).toHaveLength(2)
  })

  it('mode satu gudang tak menilai stok per gudang', async () => {
    multi = false
    const plan = await dropUnshippableGifts([HIDROTON, HADIAH])
    expect(plan.droppedGiftIds).toEqual([])
  })

  it('tanpa hadiah: daftar dikembalikan apa adanya, tanpa penanda isGift', async () => {
    const plan = await dropUnshippableGifts([HIDROTON])
    expect(plan).toEqual({ items: [{ productId: 'hidroton', quantity: 6 }], droppedGiftIds: [] })
  })
})
