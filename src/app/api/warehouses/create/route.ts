// src/app/api/warehouses/create/route.ts
// Membuat gudang baru (ADMIN ONLY). Dipakai halaman /oms/dashboard/gudang.
// Validasi dijalankan ULANG di sini — form client boleh dilewati, server tidak.

import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { requireAdmin } from '@/lib/oms-guard'
import { createWarehouse } from '@/lib/mock-db/warehouses'
import { validateWarehouseForm, toWarehouseFormValues } from '@/lib/warehouse-validation'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  const values = toWarehouseFormValues(body)
  const errors = validateWarehouseForm(values)
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ error: 'Data gudang belum valid.', errors }, { status: 422 })
  }

  try {
    const warehouse = await createWarehouse({
      nama: values.nama,
      alamat: values.alamat || undefined,
      mengantarOriginId: values.mengantarOriginId || undefined,
      latitude: values.latitude === '' ? undefined : values.latitude,
      longitude: values.longitude === '' ? undefined : values.longitude,
      isDefault: body.isDefault === true,
      isActive: body.isActive !== false,
    })

    // Gudang default menentukan stok efektif & origin ongkir → segarkan cache storefront
    revalidateTag('products', 'max')
    return NextResponse.json({ success: true, warehouse })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Gagal membuat gudang.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
