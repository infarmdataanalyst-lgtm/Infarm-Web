// src/app/api/settings/min-order/route.ts
// Minimum total belanja (store_settings.min_order_amount).
//   GET   → PUBLIK, read-only. Hanya mengembalikan satu angka; tabel store_settings sendiri
//           RLS-aktif tanpa policy publik sehingga tak pernah ter-expose ke browser.
//   PATCH → ADMIN ONLY (requireAdmin) — dipakai halaman /oms/dashboard/pengaturan.
//
// Pola sama dengan endpoint OMS lain (API Route, bukan server action) sesuai aturan CLAUDE.md.

import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { requireAdmin } from '@/lib/oms-guard'
import {
  getMinOrderAmount,
  setMinOrderAmount,
  MAX_MIN_ORDER_AMOUNT,
} from '@/lib/mock-db/settings'

// createAdminClient (Supabase) butuh runtime Node.js, bukan Edge
export const runtime = 'nodejs'

// GET: nilai minimum total belanja untuk storefront (keranjang & checkout).
export async function GET() {
  const minOrderAmount = await getMinOrderAmount()
  return NextResponse.json({ minOrderAmount })
}

// PATCH: admin mengubah nilai minimum.
export async function PATCH(request: Request) {
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  const raw = body.minOrderAmount
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
    return NextResponse.json({ error: 'Nilai minimum tidak valid.' }, { status: 422 })
  }
  if (raw > MAX_MIN_ORDER_AMOUNT) {
    return NextResponse.json(
      { error: `Nilai minimum terlalu besar (maksimal ${MAX_MIN_ORDER_AMOUNT}).` },
      { status: 422 },
    )
  }

  try {
    const saved = await setMinOrderAmount(raw)
    // Segarkan cache storefront yang membaca nilai ini (getCachedMinOrderAmount)
    revalidateTag('settings', 'max')
    return NextResponse.json({ success: true, minOrderAmount: saved })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Gagal menyimpan pengaturan.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
