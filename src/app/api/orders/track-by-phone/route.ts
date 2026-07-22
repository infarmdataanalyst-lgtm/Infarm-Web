// src/app/api/orders/track-by-phone/route.ts
// API Lacak Pesanan by no_telepon (guest). Mengembalikan HANYA info non-sensitif tiap pesanan:
// nomor invoice, status, no resi, tanggal, ringkasan barang (nama+qty), dan NAMA yang DIMASK.
// TIDAK mengembalikan alamat lengkap / nama penuh / email.
//
// Perlindungan (kompensasi karena identifikasi hanya via no_telepon):
//  - Honeypot: field tersembunyi `website` — bila terisi → dianggap bot, balas kosong senyap.
//  - Validasi format no_telepon di server.
//  - TODO(rate-limit): batasi 5 percobaan / IP / jam (ditunda — akan ditambah kemudian,
//    bisa in-memory Map seperti /api/oms/login atau tabel Supabase untuk konsistensi lintas instance).

import { NextResponse } from 'next/server'
import { getOrdersByPhone } from '@/lib/mock-db/orders'
import { normalizePhone, isValidPhone } from '@/lib/phone'
import { maskName } from '@/lib/mask'

// createAdminClient (Supabase) butuh runtime Node.js, bukan Edge
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Bentuk pesanan aman-publik (tanpa alamat/nama penuh/email/telepon)
type PublicTrackOrder = {
  orderId: string
  status: string
  paymentStatus: string
  trackingNumber: string | null
  courier: string | null
  date: string
  customerNameMasked: string
  items: { name: string; quantity: number }[]
}

export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  // Honeypot: bot sering mengisi semua field. Field `website` disembunyikan dari user asli →
  // bila terisi, balas kosong senyap (jangan beri sinyal apa pun ke bot).
  if (typeof body.website === 'string' && body.website.trim().length > 0) {
    return NextResponse.json({ orders: [] })
  }

  const rawPhone = typeof body.phone === 'string' ? body.phone : ''
  if (!isValidPhone(rawPhone)) {
    return NextResponse.json(
      { error: 'Nomor telepon tidak valid. Gunakan format 08xxxxxxxxxx.' },
      { status: 400 },
    )
  }

  const phone = normalizePhone(rawPhone)
  const orders = await getOrdersByPhone(phone)

  // Petakan ke bentuk non-sensitif saja
  const publicOrders: PublicTrackOrder[] = orders.map((o) => ({
    orderId: o.orderId,
    status: o.status ?? 'Diproses',
    paymentStatus: o.paymentStatus,
    trackingNumber: o.trackingNumber ?? null,
    courier: o.logistics?.courier || null,
    date: o.date,
    customerNameMasked: maskName(o.customerName),
    items: o.items.map((it) => ({ name: it.name, quantity: it.quantity })),
  }))

  return NextResponse.json({ orders: publicOrders })
}
