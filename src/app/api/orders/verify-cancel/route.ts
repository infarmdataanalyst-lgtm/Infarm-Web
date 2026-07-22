// src/app/api/orders/verify-cancel/route.ts
// LANGKAH 2 (verifikasi) pembatalan by no_telepon: pastikan no_telepon yang diketik ulang user
// benar-benar COCOK dengan no_telepon pada order terpilih — DIQUERY ULANG dari DB (jangan percaya
// state client). Juga cek apakah status order masih boleh dibatalkan. TIDAK membatalkan apa pun di sini.
//
// Perlindungan: honeypot `website`. TODO(rate-limit): 5/IP/jam (ditunda, sama seperti track-by-phone).

import { NextResponse } from 'next/server'
import { getOrderByOrderId } from '@/lib/mock-db/orders'
import { normalizePhone, isValidPhone } from '@/lib/phone'
import type { OrderFulfillmentStatus } from '@/types/order'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Status yang masih boleh dibatalkan mandiri (sama dengan alur token di /api/orders/cancel)
const CANCELLABLE: OrderFulfillmentStatus[] = ['Menunggu Pembayaran', 'Diproses']

export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  // Honeypot → balas "tidak cocok" senyap
  if (typeof body.website === 'string' && body.website.trim().length > 0) {
    return NextResponse.json({ match: false })
  }

  const orderId = typeof body.orderId === 'string' ? body.orderId.trim().replace(/^#/, '') : ''
  const rawPhone = typeof body.phone === 'string' ? body.phone : ''
  if (!orderId) {
    return NextResponse.json({ error: 'Pesanan tidak valid.' }, { status: 400 })
  }
  if (!isValidPhone(rawPhone)) {
    return NextResponse.json({ error: 'Nomor telepon tidak valid.' }, { status: 400 })
  }

  // Query ULANG dari DB (bukan dari state client)
  const order = await getOrderByOrderId(orderId)
  if (!order) {
    return NextResponse.json({ error: 'Pesanan tidak ditemukan.' }, { status: 404 })
  }

  // Cocokkan no_telepon input dengan no_telepon di order (keduanya dinormalkan)
  const match = normalizePhone(rawPhone) === normalizePhone(order.customerPhone ?? '')
  if (!match) {
    // Jangan bocorkan status bila nomor tak cocok
    return NextResponse.json({ match: false })
  }

  const status = order.status ?? 'Diproses'
  const cancellable = CANCELLABLE.includes(status)
  return NextResponse.json({ match: true, cancellable, status })
}
