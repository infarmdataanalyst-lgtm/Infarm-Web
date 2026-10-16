// src/app/api/variants/delete/route.ts
// API menghapus varian produk (modal "Kelola Varian" OMS).

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/oms-guard'
import { revalidatePath, revalidateTag } from 'next/cache'
import { deleteVariant, getVariantsByIds } from '@/lib/mock-db/variants'
import { logAdminActivity } from '@/lib/admin-activity'

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

  const id = typeof body.id === 'string' ? body.id.trim() : ''
  const productId = typeof body.productId === 'string' ? body.productId.trim() : ''
  if (!id) return NextResponse.json({ error: 'id varian wajib ada.' }, { status: 400 })

  // Dibaca sebelum dihapus — untuk nama & SKU di log aktivitas.
  const sebelum = (await getVariantsByIds([id])).get(id)

  const ok = await deleteVariant(id)
  if (!ok) return NextResponse.json({ error: 'Gagal menghapus varian.' }, { status: 500 })

  await logAdminActivity({
    action: 'variant.delete',
    entityType: 'variant',
    entityId: id,
    entityLabel: sebelum?.name ?? null,
    details: { productId: productId || null, sku: sebelum?.sku ?? null },
  })

  revalidateTag('variants', 'max')
  if (productId) revalidatePath(`/produk/${productId}`)
  return NextResponse.json({ success: true })
}
