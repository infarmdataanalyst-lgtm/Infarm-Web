// src/app/api/warehouses/stock/route.ts
// Stok satu produk di tiap gudang (ADMIN ONLY) — dipakai form produk OMS saat mode multi-gudang
// untuk mengisi nilai awal input per gudang.
//
// Hanya baca. Penulisan stok tetap lewat /api/products/{create,update} agar satu penyimpanan produk
// = satu transaksi logis dari sudut pandang admin (tak ada kondisi "produk tersimpan, stok belum").

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/oms-guard'
import { readStockRows } from '@/lib/mock-db/warehouses'

export const runtime = 'nodejs'

// GET ?productId=<uuid> → daftar baris stok produk tsb di semua gudang (termasuk per varian).
export async function GET(request: Request) {
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  const { searchParams } = new URL(request.url)
  const productId = (searchParams.get('productId') ?? '').trim()
  if (!productId) {
    return NextResponse.json({ error: 'productId wajib disertakan.' }, { status: 400 })
  }

  const rows = await readStockRows({ productIds: [productId] })
  return NextResponse.json({ rows })
}
