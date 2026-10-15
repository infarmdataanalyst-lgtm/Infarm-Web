import { describe, expect, it } from 'vitest'
import { aggregateStockRows, productStockFrom } from '@/lib/warehouse'

const UTAMA = 'gudang-utama'
const JAKARTA = 'gudang-jakarta'

// Kasus nyata 15 Okt 2026: INF-SM-045, 3 varian × 100 di Gudang Utama, products.stock lama = 120.
const polybag = [
  { productId: 'polybag', variantId: 'v-10x15', warehouseId: UTAMA, stok: 100 },
  { productId: 'polybag', variantId: 'v-20x20', warehouseId: UTAMA, stok: 100 },
  { productId: 'polybag', variantId: 'v-15x15', warehouseId: UTAMA, stok: 100 },
  { productId: 'polybag', variantId: 'v-15x15', warehouseId: JAKARTA, stok: 0 },
]
const benih = [
  { productId: 'benih', variantId: null, warehouseId: UTAMA, stok: 7 },
  { productId: 'benih', variantId: null, warehouseId: JAKARTA, stok: 3 },
]

describe('aggregateStockRows + productStockFrom', () => {
  it('produk bervarian → total stok semua varian di semua gudang', () => {
    const maps = aggregateStockRows(polybag)
    expect(productStockFrom(maps, 'polybag')).toBe(300)
    expect(maps.byVariant.get('v-15x15')).toBe(100)
  })

  it('produk tanpa varian → jumlah baris tanpa varian, seperti sebelumnya', () => {
    expect(productStockFrom(aggregateStockRows(benih), 'benih')).toBe(10)
  })

  it('produk tanpa baris gudang → undefined (pemanggil jatuh ke products.stock)', () => {
    expect(productStockFrom(aggregateStockRows(benih), 'tidak-ada')).toBeUndefined()
  })

  it('baris tanpa varian sisa masa lalu tidak menimpa total varian', () => {
    const rows = [...polybag, { productId: 'polybag', variantId: null, warehouseId: UTAMA, stok: 120 }]
    expect(productStockFrom(aggregateStockRows(rows), 'polybag')).toBe(300)
  })

  it('gudang spesifik → hanya baris gudang itu', () => {
    const maps = aggregateStockRows([...polybag, ...benih], JAKARTA)
    expect(productStockFrom(maps, 'polybag')).toBe(0)
    expect(productStockFrom(maps, 'benih')).toBe(3)
  })
})
