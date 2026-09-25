// src/app/api/warehouses/update/route.ts
// Memperbarui gudang (ADMIN ONLY). Dipakai modal edit di /oms/dashboard/gudang.

import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { requireAdmin } from '@/lib/oms-guard'
import { updateWarehouse } from '@/lib/mock-db/warehouses'
import { validateWarehouseForm, toWarehouseFormValues } from '@/lib/warehouse-validation'

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

  const values = toWarehouseFormValues(body)
  const errors = validateWarehouseForm(values)
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ error: 'Data gudang belum valid.', errors }, { status: 422 })
  }

  try {
    const warehouse = await updateWarehouse(id, {
      nama: values.nama,
      alamat: values.alamat || undefined,
      mengantarOriginId: values.mengantarOriginId || undefined,
      latitude: values.latitude === '' ? undefined : values.latitude,
      longitude: values.longitude === '' ? undefined : values.longitude,
      isDefault: body.isDefault === true,
      isActive: body.isActive !== false,
    })
    if (!warehouse) return NextResponse.json({ error: 'Gudang tidak ditemukan.' }, { status: 404 })

    revalidateTag('products', 'max')
    return NextResponse.json({ success: true, warehouse })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Gagal memperbarui gudang.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
