// src/lib/applied-promos.ts
// Membaca snapshot promo pesanan (orders.promo_terpakai, jsonb) — fungsi murni, tanpa database.

import type { Order } from '@/types/order'

// Defensif: kolom bisa null, belum di-migrate, berupa string JSON, atau berisi entri tak lengkap.
// Entri tanpa nama dibuang — tak ada yang bisa ditampilkan darinya.
export function parseAppliedPromos(raw: unknown): NonNullable<Order['appliedPromos']> {
  const list = typeof raw === 'string' ? safeJson(raw) : raw
  if (!Array.isArray(list)) return []
  return list.flatMap((p) => {
    if (!p || typeof p !== 'object') return []
    const { id, name, type, value } = p as Record<string, unknown>
    if (typeof name !== 'string' || name.trim() === '') return []
    return [
      {
        id: typeof id === 'string' ? id : '',
        name,
        type: typeof type === 'string' ? type : '',
        value: typeof value === 'number' && Number.isFinite(value) ? value : 0,
      },
    ]
  })
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}
