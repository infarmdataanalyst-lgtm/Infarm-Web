// src/app/api/oms/orders/detail/route.ts
// Satu pesanan LENGKAP untuk modal detail/ubah status OMS, dibuka dari panel pencarian cepat.
//   GET ?invoice=<nomor invoice> → { order }
//
// Bentuknya `Order` utuh (item, alamat, kontak) karena OrderStatusModal memakai objek yang sama
// dengan halaman Pesanan — halaman itu sudah menerima bentuk ini dari /api/orders/list untuk sesi
// OMS apa pun, jadi endpoint ini tidak membuka data baru bagi siapa pun yang sudah login.
// Wajib requireAdmin sendiri: proxy.ts hanya menjaga HALAMAN, bukan /api/* (SEC-015).

import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/oms-guard'
import { getOrderByOrderId } from '@/lib/mock-db/orders'
import { normalizeInvoiceId } from '@/lib/invoice-id'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  const invoice = normalizeInvoiceId(request.nextUrl.searchParams.get('invoice'))
  if (!invoice) {
    return NextResponse.json({ error: 'Nomor invoice tidak valid.' }, { status: 400 })
  }

  const order = await getOrderByOrderId(invoice)
  if (!order) {
    return NextResponse.json({ error: `Pesanan ${invoice} tidak ditemukan.` }, { status: 404 })
  }
  return NextResponse.json({ order })
}
