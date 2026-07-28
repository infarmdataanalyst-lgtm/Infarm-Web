// src/app/api/variants/delete/route.ts
// API menghapus varian produk (modal "Kelola Varian" OMS).

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/oms-guard'
import { revalidatePath, revalidateTag } from 'next/cache'
import { deleteVariant } from '@/lib/mock-db/variants'

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

  const ok = await deleteVariant(id)
  if (!ok) return NextResponse.json({ error: 'Gagal menghapus varian.' }, { status: 500 })

  revalidateTag('variants', 'max')
  if (productId) revalidatePath(`/produk/${productId}`)
  return NextResponse.json({ success: true })
}
