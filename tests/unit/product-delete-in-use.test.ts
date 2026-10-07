// tests/unit/product-delete-in-use.test.ts
// Hapus produk yang PERNAH DIBELI ditolak database (FK order_items.product_id ON DELETE RESTRICT).
// Sampai 2026-10-07 penolakan itu dilaporkan sebagai "Produk tidak ditemukan" — menyesatkan.

import { describe, expect, it, vi } from 'vitest'

const state = { result: { data: null as unknown, error: null as { code?: string; message: string } | null } }

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => {
    const builder = {
      delete: () => builder,
      eq: () => builder,
      in: () => builder,
      select: async () => state.result,
    }
    return { from: () => builder }
  },
}))

describe('deleteProduct / bulkDeleteProducts', () => {
  it('ditolak FK (23503) → in-use, bukan not-found', async () => {
    const { deleteProduct } = await import('@/lib/mock-db/products')
    state.result = { data: null, error: { code: '23503', message: 'violates foreign key constraint' } }
    expect(await deleteProduct('p-1')).toBe('in-use')
  })

  it('tak ada baris terhapus → not-found', async () => {
    const { deleteProduct } = await import('@/lib/mock-db/products')
    state.result = { data: [], error: null }
    expect(await deleteProduct('p-x')).toBe('not-found')
  })

  it('terhapus → deleted', async () => {
    const { deleteProduct } = await import('@/lib/mock-db/products')
    state.result = { data: [{ id: 'p-2' }], error: null }
    expect(await deleteProduct('p-2')).toBe('deleted')
  })

  it('galat lain → error', async () => {
    const { deleteProduct } = await import('@/lib/mock-db/products')
    state.result = { data: null, error: { code: '57014', message: 'timeout' } }
    expect(await deleteProduct('p-3')).toBe('error')
  })

  it('hapus massal yang ditolak FK melempar ProductInUseError dengan pesan untuk admin', async () => {
    const { bulkDeleteProducts, ProductInUseError } = await import('@/lib/mock-db/products')
    state.result = { data: null, error: { code: '23503', message: 'violates foreign key constraint' } }
    await expect(bulkDeleteProducts(['p-1', 'p-2'])).rejects.toBeInstanceOf(ProductInUseError)
  })
})
