// src/app/api/combos/list/route.ts
// API membaca seluruh paket/combo dari Supabase. Dipanggil GET dari daftar combo OMS.
//
// Sejak 2026-09-07 respons ikut membawa `salesCount` — jumlah paket terjual per combo, dihitung
// dari order_items.combo_id dan DIBATASI pada pesanan berstatus Lunas.
//
// ⚠️ Karena itu endpoint ini kini WAJIB requireAdmin(). Sebelumnya ia terbuka tanpa penjagaan
// (satu-satunya pemanggilnya memang halaman OMS, tapi route-nya sendiri publik), dan angka
// penjualan bukan data yang boleh dibaca siapa pun. Storefront TIDAK terpengaruh: ia memakai
// /api/combos/active, bukan endpoint ini.

import { NextResponse } from 'next/server'
import { readCombos, getComboSalesCount } from '@/lib/mock-db/combos'
import { requireAdmin } from '@/lib/oms-guard'

// createAdminClient (Supabase) butuh runtime Node.js
export const runtime = 'nodejs'

// Selalu baca data terbaru (combo bisa berubah saat ada create/edit/delete)
export const dynamic = 'force-dynamic'

// Mengembalikan daftar combo terbaru beserta itemnya + jumlah terjual (pesanan Lunas).
export async function GET() {
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  const [combos, salesCount] = await Promise.all([readCombos(), getComboSalesCount()])
  return NextResponse.json({ combos, count: combos.length, salesCount })
}
