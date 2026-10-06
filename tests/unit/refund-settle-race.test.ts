// tests/unit/refund-settle-race.test.ts
// settleRefundByReference: dua callback `refund.succeeded` serentak hanya boleh menghasilkan SATU
// pemenang. Sebelum 2026-10-05 UPDATE-nya tanpa `.select()`, sehingga keduanya mengembalikan
// orderId — tak merusak status, tapi akan mengirim event GA4 `refund` dua kali.
//
// Supabase diganti tiruan dalam memori. Syarat WHERE dinilai pada saat UPDATE dijalankan (atomik,
// seperti di Postgres), sedangkan SELECT sebelumnya bisa basi — persis jendela balapannya.

import { describe, expect, it, vi } from 'vitest'

const row = {
  nomor_invoice: 'INV-20261005-REFUND01',
  refund_status: 'SEDANG_DIPROSES',
  refund_reference: 'rfd-uji',
  refund_note: 'diklaim',
}

const yieldTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

type Filter = { col: string; val: unknown }
const cocok = (filters: Filter[]) =>
  filters.every(({ col, val }) => (row as Record<string, unknown>)[col] === val)

function fakeClient() {
  return {
    from: () => {
      const filters: Filter[] = []
      let patch: Record<string, unknown> | null = null
      const builder = {
        select: () => builder,
        update: (p: Record<string, unknown>) => {
          patch = p
          return builder
        },
        eq: (col: string, val: unknown) => {
          filters.push({ col, val })
          return builder
        },
        // Jalur baca: snapshot diambil sekarang, dikembalikan setelah satu putaran.
        limit: async () => {
          const hasil = cocok(filters) ? [{ ...row }] : []
          await yieldTurn()
          return { data: hasil, error: null }
        },
        // Jalur tulis: syarat dinilai SAAT menulis.
        maybeSingle: async () => {
          await yieldTurn()
          if (!patch || !cocok(filters)) return { data: null, error: null }
          Object.assign(row, patch)
          return { data: { id: 'uuid' }, error: null }
        },
      }
      return builder
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: fakeClient }))

describe('settleRefundByReference — callback kembar', () => {
  it('hanya satu yang menutup refund', async () => {
    const { settleRefundByReference } = await import('@/lib/mock-db/orders')

    const hasil = await Promise.all([
      settleRefundByReference('rfd-uji', true, 'SUCCEEDED'),
      settleRefundByReference('rfd-uji', true, 'SUCCEEDED'),
    ])

    expect(hasil.filter(Boolean)).toHaveLength(1)
    expect(row.refund_status).toBe('SUDAH_REFUND')
  })
})
