// src/app/api/combos/active/route.ts
// API publik (storefront): daftar paket/combo yang AKTIF, untuk rekomendasi di halaman keranjang.
// Dibaca dengan anon key (tunduk RLS, SEC-031): policy database hanya meloloskan paket aktif, dan
// filter is_active di query mengulangnya. Penyaringan lanjutan (relevansi dengan keranjang, stok
// produk) dilakukan di client karena butuh isi keranjang & stok terkini.

import { NextResponse } from 'next/server'
import { readActiveCombosPublic } from '@/lib/mock-db/combos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic' // selalu pakai data combo terbaru

export async function GET() {
  const combos = await readActiveCombosPublic()
  return NextResponse.json({ combos })
}
