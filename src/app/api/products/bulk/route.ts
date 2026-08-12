// src/app/api/products/bulk/route.ts
// Aksi massal produk dari OMS: arsipkan, pulihkan, ubah kategori, hapus (ADMIN ONLY).
//
// Kenapa API Route, bukan Server Action: konvensi project (lihat CLAUDE.md) — seluruh mutasi OMS
// lewat Route Handler agar satu pola dengan endpoint produk/order/combo lain. Bypass RLS tetap
// terjadi karena mock-db memakai createAdminClient() (service_role) di sisi server.
//
// Satu request = satu query `.in('id', ids)` per aksi, bukan loop per produk.

import { NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { requireAdmin } from '@/lib/oms-guard'
import {
  bulkDeleteProducts,
  bulkSetArchived,
  bulkSetCategory,
} from '@/lib/mock-db/products'
import { PRODUCT_CATEGORIES } from '@/lib/data/categories'
import type { ProductCategory } from '@/types/product'

export const runtime = 'nodejs'

const VALID_CATEGORIES = PRODUCT_CATEGORIES.map((c) => c.slug) as string[]

// Batas jumlah id per request — jaring pengaman terhadap payload sampah / salah klik massal.
const MAX_IDS = 200

type BulkAction = 'archive' | 'restore' | 'delete' | 'category'
const VALID_ACTIONS: BulkAction[] = ['archive', 'restore', 'delete', 'category']

export async function POST(request: Request) {
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  const action = body.action
  if (typeof action !== 'string' || !VALID_ACTIONS.includes(action as BulkAction)) {
    return NextResponse.json({ error: 'Aksi massal tidak dikenal.' }, { status: 400 })
  }

  // ids wajib array string non-kosong. Produk contoh di UI (id 'PRD-00x') tidak pernah dikirim
  // ke sini — UI menonaktifkan checkbox-nya karena tak ada di database.
  const rawIds = body.ids
  if (!Array.isArray(rawIds) || rawIds.some((id) => typeof id !== 'string')) {
    return NextResponse.json({ error: 'Daftar produk tidak valid.' }, { status: 400 })
  }
  const ids = [...new Set((rawIds as string[]).map((id) => id.trim()).filter(Boolean))]
  if (ids.length === 0) {
    return NextResponse.json({ error: 'Tidak ada produk yang dipilih.' }, { status: 400 })
  }
  if (ids.length > MAX_IDS) {
    return NextResponse.json(
      { error: `Maksimal ${MAX_IDS} produk per aksi massal.` },
      { status: 422 },
    )
  }

  try {
    let affected = 0

    if (action === 'archive' || action === 'restore') {
      affected = await bulkSetArchived(ids, action === 'archive')
    } else if (action === 'delete') {
      affected = await bulkDeleteProducts(ids)
    } else {
      // action === 'category'
      const category = body.category
      if (typeof category !== 'string' || !VALID_CATEGORIES.includes(category)) {
        return NextResponse.json({ error: 'Kategori tidak valid.' }, { status: 422 })
      }
      affected = await bulkSetCategory(ids, category as ProductCategory)
    }

    // Stok/harga/ketersediaan berubah → segarkan cache storefront (pola sama dengan create/update).
    revalidatePath('/')
    revalidatePath('/products')
    revalidatePath('/produk/[id]', 'page')
    revalidateTag('products', 'max')

    return NextResponse.json({ success: true, action, affected })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Gagal menjalankan aksi massal.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
