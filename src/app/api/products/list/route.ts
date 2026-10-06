// src/app/api/products/list/route.ts
// API membaca seluruh produk hasil input OMS dari mock database.
// Dipanggil GET dari OMS (daftar produk) maupun ecommerce (katalog/beranda).
//
// Respons publik di-cache CDN 60 dtk (lib/cdn-cache.ts). OMS memanggilnya dengan ?fresh=1 supaya
// admin yang baru mengedit produk selalu melihat data terbaru.

import { NextResponse } from 'next/server'
import { readProducts } from '@/lib/mock-db/products'
import { publicCacheHeaders } from '@/lib/cdn-cache'

// 'fs' butuh runtime Node.js (bukan Edge)
export const runtime = 'nodejs'

// Fungsinya tetap dinamis (selalu membaca Supabase saat dijalankan); yang menyimpan respons
// adalah CDN, lewat header Cache-Control di bawah.
export const dynamic = 'force-dynamic'

// Mengembalikan daftar produk OMS terbaru
export async function GET(request: Request) {
  const products = await readProducts()
  return NextResponse.json({ products, count: products.length }, { headers: publicCacheHeaders(request) })
}
