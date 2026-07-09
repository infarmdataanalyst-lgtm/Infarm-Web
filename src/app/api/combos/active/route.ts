// src/app/api/combos/active/route.ts
// API publik (storefront): daftar paket/combo yang AKTIF, untuk rekomendasi di halaman keranjang.
// Filter is_active di server (query Supabase tetap server-only via mock-db). Penyaringan lanjutan
// (relevansi dengan keranjang, stok produk) dilakukan di client karena butuh isi keranjang & stok terkini.

import { NextResponse } from 'next/server'
import { readCombos } from '@/lib/mock-db/combos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic' // selalu pakai data combo terbaru

export async function GET() {
  const combos = (await readCombos()).filter((c) => c.isActive)
  return NextResponse.json({ combos })
}
