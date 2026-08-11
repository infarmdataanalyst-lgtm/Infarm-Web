// src/app/api/warehouses/delete/route.ts
// Menghapus gudang (ADMIN ONLY) — hanya untuk gudang yang benar-benar belum terpakai.
//
// Tiga penjagaan, dicek di server (bukan sekadar disembunyikan di UI):
//   1. Gudang default tak boleh dihapus — sistem selalu butuh satu default.
//   2. Gudang yang punya baris stok tak boleh dihapus — FK `on delete restrict` pada
//      product_stock_per_warehouse akan menolaknya, dan menghapus stok berarti kehilangan angka
//      persediaan nyata.
//   3. Gudang yang pernah memenuhi pesanan tak boleh dihapus — orders.warehouse_id akan menggantung
//      dan riwayat pemenuhan pesanan jadi tak bisa dilacak.
// Untuk gudang yang berhenti beroperasi, gunakan /api/warehouses/toggle (nonaktifkan).

import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { requireAdmin } from '@/lib/oms-guard'
import { deleteWarehouse, getWarehouseById, getWarehouseUsage } from '@/lib/mock-db/warehouses'

export const runtime = 'nodejs'

export async function DELETE(request: Request) {
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  const { searchParams } = new URL(request.url)
  const id = (searchParams.get('id') ?? '').trim()
  if (!id) return NextResponse.json({ error: 'ID gudang wajib disertakan.' }, { status: 400 })

  const existing = await getWarehouseById(id)
  if (!existing) return NextResponse.json({ error: 'Gudang tidak ditemukan.' }, { status: 404 })

  if (existing.isDefault) {
    return NextResponse.json(
      {
        error: 'Gudang default tidak bisa dihapus. Tetapkan gudang lain sebagai default lebih dahulu.',
        code: 'DEFAULT_WAREHOUSE',
      },
      { status: 409 },
    )
  }

  const usage = await getWarehouseUsage(id)
  if (usage.stockRows > 0 || usage.orders > 0) {
    return NextResponse.json(
      {
        error: `Gudang ini masih terpakai (${usage.stockRows} baris stok, ${usage.orders} pesanan). Nonaktifkan saja agar data & riwayatnya tetap utuh.`,
        code: 'WAREHOUSE_IN_USE',
        usage,
      },
      { status: 409 },
    )
  }

  try {
    const deleted = await deleteWarehouse(id)
    if (!deleted) return NextResponse.json({ error: 'Gudang tidak ditemukan.' }, { status: 404 })

    revalidateTag('products', 'max')
    return NextResponse.json({ success: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Gagal menghapus gudang.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
