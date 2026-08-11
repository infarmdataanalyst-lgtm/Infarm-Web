// src/app/api/warehouses/set-default/route.ts
// Menetapkan gudang default (ADMIN ONLY).
//
// Gudang default adalah gudang yang dipakai SELURUH sistem saat WAREHOUSE_MODE=single, dan menjadi
// fallback di mode multi. Karena itu penetapannya sekaligus MENGAKTIFKAN gudang tersebut —
// default yang nonaktif akan membuat pemilihan gudang kehilangan kandidat sah.

import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { requireAdmin } from '@/lib/oms-guard'
import { setDefaultWarehouse } from '@/lib/mock-db/warehouses'

export const runtime = 'nodejs'

export async function PATCH(request: Request) {
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'ID gudang wajib disertakan.' }, { status: 400 })

  try {
    const warehouse = await setDefaultWarehouse(id)
    if (!warehouse) return NextResponse.json({ error: 'Gudang tidak ditemukan.' }, { status: 404 })

    // Stok efektif & origin ongkir bergantung gudang default → segarkan cache storefront
    revalidateTag('products', 'max')
    return NextResponse.json({ success: true, warehouse })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Gagal menetapkan gudang default.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
