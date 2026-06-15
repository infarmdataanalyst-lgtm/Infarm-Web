// src/app/api/products/list/route.ts
// API membaca seluruh produk hasil input OMS dari mock database.
// Dipanggil GET dari OMS (daftar produk) maupun ecommerce (katalog/beranda).

import { NextResponse } from 'next/server'
import { readProducts } from '@/lib/mock-db/products'

// 'fs' butuh runtime Node.js (bukan Edge)
export const runtime = 'nodejs'

// Selalu baca file terbaru, jangan di-cache (produk bertambah saat ada upload baru)
export const dynamic = 'force-dynamic'

// Mengembalikan daftar produk OMS terbaru
export async function GET() {
  const products = await readProducts()
  return NextResponse.json({ products, count: products.length })
}
