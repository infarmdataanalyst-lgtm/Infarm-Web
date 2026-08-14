// src/app/api/settings/low-stock-threshold/route.ts
// Ambang "stok menipis" (store_settings.low_stock_threshold).
//   GET   → ADMIN ONLY (requireAdmin, peran apa pun) — dibaca halaman Produk OMS yang berupa
//           komponen klien. Angka ini murni operasional; storefront tak memakainya.
//   PATCH → peran 'admin' saja (requireAdminRole) — 'staff' boleh melihat, tak boleh mengubah.
//
// Pola sama dengan endpoint OMS lain (API Route, bukan server action) sesuai aturan CLAUDE.md.

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { requireAdmin, requireAdminRole } from '@/lib/oms-guard'
import {
  getLowStockThreshold,
  setLowStockThreshold,
  MAX_LOW_STOCK_THRESHOLD,
} from '@/lib/mock-db/settings'

// createAdminClient (Supabase) butuh runtime Node.js, bukan Edge
export const runtime = 'nodejs'

export async function GET() {
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  const lowStockThreshold = await getLowStockThreshold()
  return NextResponse.json({ lowStockThreshold })
}

export async function PATCH(request: Request) {
  const denied = await requireAdminRole(
    'Akun Anda tidak berwenang mengubah pengaturan. Hubungi admin utama.',
  )
  if (denied) return denied

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  const raw = body.lowStockThreshold
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 1) {
    return NextResponse.json(
      { error: 'Ambang stok menipis minimal 1. Stok 0 selalu dihitung "habis".' },
      { status: 422 },
    )
  }
  if (raw > MAX_LOW_STOCK_THRESHOLD) {
    return NextResponse.json(
      { error: `Ambang terlalu besar (maksimal ${MAX_LOW_STOCK_THRESHOLD}).` },
      { status: 422 },
    )
  }

  try {
    const saved = await setLowStockThreshold(raw)
    // Dashboard OMS membaca ambang ini saat render (Server Component) — segarkan agar widget
    // "Stok Rendah" langsung memakai angka baru tanpa menunggu kunjungan berikutnya.
    revalidatePath('/oms/dashboard')
    return NextResponse.json({ success: true, lowStockThreshold: saved })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Gagal menyimpan pengaturan.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
