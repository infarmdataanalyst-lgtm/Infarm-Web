// src/app/api/orders/list/route.ts
// API membaca seluruh pesanan dari mock database.
// Dipanggil GET dari Dashboard OMS untuk mengisi tabel pesanan admin.

import { NextResponse } from 'next/server'
import { readOrders } from '@/lib/mock-db/orders'

// 'fs' butuh runtime Node.js (bukan Edge)
export const runtime = 'nodejs'

// Selalu baca file terbaru, jangan di-cache (data berubah saat ada checkout baru)
export const dynamic = 'force-dynamic'

// Mengembalikan daftar pesanan terbaru untuk OMS
export async function GET() {
  const orders = await readOrders()
  return NextResponse.json({ orders, count: orders.length })
}
