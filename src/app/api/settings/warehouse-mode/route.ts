// src/app/api/settings/warehouse-mode/route.ts
// Mode pergudangan (store_settings.warehouse_mode) — ADMIN ONLY, dibaca & diubah dari
// halaman OMS → Gudang.
//
// Ini pengganti environment variable WAREHOUSE_MODE: mode bisa diubah kapan saja tanpa redeploy,
// dan hanya ada SATU sumber kebenaran (baris DB). GET juga admin-only karena mode operasional
// bukan informasi yang perlu diketahui storefront — pembeli hanya melihat hasilnya (stok & ongkir).

import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { requireAdmin } from '@/lib/oms-guard'
import { getWarehouseMode, setWarehouseMode } from '@/lib/warehouse'
import type { WarehouseMode } from '@/types/warehouse'

export const runtime = 'nodejs'

export async function GET() {
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  return NextResponse.json({ mode: await getWarehouseMode() })
}

export async function PATCH(request: Request) {
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  const raw = body.mode
  if (raw !== 'single' && raw !== 'multi') {
    return NextResponse.json(
      { error: "Mode harus 'single' atau 'multi'." },
      { status: 422 },
    )
  }

  try {
    const saved = await setWarehouseMode(raw as WarehouseMode)
    // Mode menentukan cara stok efektif dihitung → segarkan cache baca storefront.
    revalidateTag('products', 'max')
    revalidateTag('settings', 'max')
    return NextResponse.json({ success: true, mode: saved })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Gagal menyimpan mode pergudangan.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
