// src/app/api/warehouses/toggle/route.ts
// Mengaktifkan / menonaktifkan gudang (ADMIN ONLY).
//
// Nonaktif = gudang tetap ada beserta stok & riwayat pesanannya, tapi tak lagi dipilih untuk
// pesanan baru (readWarehouses(true) menyaringnya). Ini aksi yang BENAR untuk gudang yang berhenti
// beroperasi — bukan hapus, yang akan memutus jejak pesanan lama.

import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { requireAdmin } from '@/lib/oms-guard'
import { getWarehouseById, setWarehouseActive } from '@/lib/mock-db/warehouses'

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
  const isActive = body.isActive === true
  if (!id) return NextResponse.json({ error: 'ID gudang wajib disertakan.' }, { status: 400 })

  // Gudang default TIDAK boleh dinonaktifkan: di mode single ia satu-satunya sumber stok & origin
  // ongkir, jadi menonaktifkannya sama dengan mematikan checkout. Admin harus menunjuk gudang
  // default yang baru lebih dulu.
  const existing = await getWarehouseById(id)
  if (!existing) return NextResponse.json({ error: 'Gudang tidak ditemukan.' }, { status: 404 })
  if (existing.isDefault && !isActive) {
    return NextResponse.json(
      {
        error:
          'Gudang default tidak bisa dinonaktifkan. Tetapkan gudang lain sebagai default terlebih dahulu.',
        code: 'DEFAULT_WAREHOUSE',
      },
      { status: 409 },
    )
  }

  try {
    const warehouse = await setWarehouseActive(id, isActive)
    revalidateTag('products', 'max')
    return NextResponse.json({ success: true, warehouse })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Gagal mengubah status gudang.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
