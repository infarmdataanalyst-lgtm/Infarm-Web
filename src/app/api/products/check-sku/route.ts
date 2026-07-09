// src/app/api/products/check-sku/route.ts
// API cek duplikat SKU produk (dipakai form OMS saat onBlur field SKU).
// Server-only (createAdminClient) agar akurat termasuk produk terarsip — RLS anon
// hanya melihat produk non-arsip, jadi cek dari client bisa meloloskan duplikat.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET ?sku=INF-001&excludeId=<uuid opsional>
// excludeId dipakai mode edit agar SKU produk itu sendiri tidak dianggap duplikat.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sku = (searchParams.get('sku') ?? '').trim()
  const excludeId = searchParams.get('excludeId') ?? ''

  if (!sku) return NextResponse.json({ exists: false })

  const supabase = createAdminClient()
  const { data, error } = await supabase.from('products').select('id').eq('sku', sku)
  if (error) {
    console.error('Gagal cek duplikat SKU:', error.message)
    // Jangan blok user bila cek gagal — anggap tidak duplikat (insert tetap dijaga UNIQUE di DB)
    return NextResponse.json({ exists: false })
  }

  const rows = (data as { id: string }[] | null) ?? []
  const exists = rows.some((r) => r.id !== excludeId)
  return NextResponse.json({ exists })
}
