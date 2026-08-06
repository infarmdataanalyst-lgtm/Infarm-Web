// src/app/api/orders/track-by-phone/route.ts
// API Lacak Pesanan by no_telepon (guest). Mengembalikan HANYA info non-sensitif tiap pesanan:
// nomor invoice, status, no resi, tanggal, ringkasan barang (nama+qty), dan NAMA yang DIMASK.
// TIDAK mengembalikan alamat lengkap / nama penuh / email.
//
// Perlindungan (kompensasi karena identifikasi hanya via no_telepon):
//  - Honeypot: field tersembunyi `website` — bila terisi → dianggap bot, balas kosong senyap.
//  - Validasi format no_telepon di server.
//  - Rate limit in-memory 3 lapis (lihat @/lib/rate-limit): per-IP (anti brute-force umum),
//    per-nomor (anti brute-force tertarget dari banyak IP ke satu nomor), dan per-kombinasi
//    IP+nomor untuk percobaan GAGAL (lihat catatan di bawah). Menutup temuan K-1 audit
//    keamanan 2026-07-24 (docs/security/audit-2026-07-24.md).

import { NextResponse } from 'next/server'
import { getOrdersByPhone } from '@/lib/mock-db/orders'
import { normalizePhone, isValidPhone } from '@/lib/phone'
import { maskName } from '@/lib/mask'
import {
  RATE_LIMITS,
  enforceRateLimit,
  getClientIp,
  isOverLimit,
  rateLimitResponse,
  recordAttempt,
} from '@/lib/rate-limit'

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
  items: { name: string; quantity: number; imageUrl: string | null }[]
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

  // Rate limit per-IP: batasi jumlah percobaan pencarian dari satu sumber (anti brute-force umum)
  const ip = getClientIp(request)
  const limitedByIp = enforceRateLimit(`track-by-phone:ip:${ip}`, RATE_LIMITS.PHONE_LOOKUP_IP)
  if (limitedByIp) return limitedByIp

  const rawPhone = typeof body.phone === 'string' ? body.phone : ''
  if (!isValidPhone(rawPhone)) {
    return NextResponse.json(
      { error: 'Nomor telepon tidak valid. Gunakan format 08xxxxxxxxxx.' },
      { status: 400 },
    )
  }

  const phone = normalizePhone(rawPhone)

  // Rate limit per-nomor: cegah brute-force tertarget ke satu nomor dari banyak IP sekaligus
  const limitedByPhone = enforceRateLimit(
    `track-by-phone:phone:${phone}`,
    RATE_LIMITS.PHONE_LOOKUP_PHONE,
  )
  if (limitedByPhone) return limitedByPhone

  // Rate limit per-kombinasi IP+nomor. Hanya dihitung untuk percobaan GAGAL (nomor tanpa pesanan) —
  // penebak nomor orang lain hampir selalu meleset, sedangkan user asli selalu dapat hasil, jadi
  // pencarian berulang atas nomornya sendiri (mis. reload halaman) tidak pernah kena limit ini.
  const missKey = `track-by-phone:miss:${ip}:${phone}`
  if (isOverLimit(missKey, RATE_LIMITS.PHONE_LOOKUP_IP_PHONE_MISS)) {
    return rateLimitResponse(RATE_LIMITS.PHONE_LOOKUP_IP_PHONE_MISS, missKey)
  }

  const orders = await getOrdersByPhone(phone)
  if (orders.length === 0) recordAttempt(missKey, RATE_LIMITS.PHONE_LOOKUP_IP_PHONE_MISS)

  // Petakan ke bentuk non-sensitif saja
  const publicOrders: PublicTrackOrder[] = orders.map((o) => ({
    orderId: o.orderId,
    status: o.status ?? 'Diproses',
    paymentStatus: o.paymentStatus,
    trackingNumber: o.trackingNumber ?? null,
    courier: o.logistics?.courier || null,
    date: o.date,
    customerNameMasked: maskName(o.customerName),
    items: o.items.map((it) => ({
      name: it.name,
      quantity: it.quantity,
      imageUrl: it.imageUrl ?? null, // foto produk (dari products.image_url) — non-sensitif
    })),
  }))

  return NextResponse.json({ orders: publicOrders })
}
