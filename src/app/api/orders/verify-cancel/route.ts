// src/app/api/orders/verify-cancel/route.ts
// LANGKAH 2 (verifikasi) pembatalan by no_telepon: pastikan no_telepon yang diketik ulang user
// benar-benar COCOK dengan no_telepon pada order terpilih — DIQUERY ULANG dari DB (jangan percaya
// state client). Juga cek apakah status order masih boleh dibatalkan. TIDAK membatalkan apa pun di sini.
//
// Perlindungan: honeypot `website` + rate limit per-IP & per-nomor (lihat @/lib/rate-limit).
// Menutup temuan K-1 audit keamanan 2026-07-24 (docs/security/audit-2026-07-24.md).

import { NextResponse } from 'next/server'
import { getOrderByOrderId } from '@/lib/mock-db/orders'
import { normalizePhone, isValidPhone } from '@/lib/phone'
import type { OrderFulfillmentStatus } from '@/types/order'
import {
  RATE_LIMITS,
  enforceRateLimit,
  getClientIp,
  isOverLimit,
  rateLimitResponse,
  recordAttempt,
} from '@/lib/rate-limit'

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

  // Rate limit per-IP: anti brute-force umum
  const ip = getClientIp(request)
  const limitedByIp = enforceRateLimit(`verify-cancel:ip:${ip}`, RATE_LIMITS.PHONE_LOOKUP_IP)
  if (limitedByIp) return limitedByIp

  const orderId = typeof body.orderId === 'string' ? body.orderId.trim().replace(/^#/, '') : ''
  const rawPhone = typeof body.phone === 'string' ? body.phone : ''
  if (!orderId) {
    return NextResponse.json({ error: 'Pesanan tidak valid.' }, { status: 400 })
  }
  if (!isValidPhone(rawPhone)) {
    return NextResponse.json({ error: 'Nomor telepon tidak valid.' }, { status: 400 })
  }

  // Rate limit per-nomor: cegah brute-force tertarget ke satu nomor dari banyak IP
  const normalizedPhone = normalizePhone(rawPhone)
  const limitedByPhone = enforceRateLimit(
    `verify-cancel:phone:${normalizedPhone}`,
    RATE_LIMITS.PHONE_LOOKUP_PHONE,
  )
  if (limitedByPhone) return limitedByPhone

  // Rate limit per-kombinasi IP+nomor, hanya untuk percobaan GAGAL (nomor tidak cocok dengan
  // pesanan). Verifikasi yang benar tidak dihitung → user asli tak terganggu.
  const missKey = `verify-cancel:miss:${ip}:${normalizedPhone}`
  if (isOverLimit(missKey, RATE_LIMITS.PHONE_LOOKUP_IP_PHONE_MISS)) {
    return rateLimitResponse(RATE_LIMITS.PHONE_LOOKUP_IP_PHONE_MISS, missKey)
  }

  // Query ULANG dari DB (bukan dari state client)
  const order = await getOrderByOrderId(orderId)
  if (!order) {
    recordAttempt(missKey, RATE_LIMITS.PHONE_LOOKUP_IP_PHONE_MISS)
    return NextResponse.json({ error: 'Pesanan tidak ditemukan.' }, { status: 404 })
  }

  // Cocokkan no_telepon input dengan no_telepon di order (keduanya dinormalkan)
  const match = normalizedPhone === normalizePhone(order.customerPhone ?? '')
  if (!match) {
    recordAttempt(missKey, RATE_LIMITS.PHONE_LOOKUP_IP_PHONE_MISS)
    // Jangan bocorkan status bila nomor tak cocok
    return NextResponse.json({ match: false })
  }

  const status = order.status ?? 'Diproses'
  const cancellable = CANCELLABLE.includes(status)
  return NextResponse.json({ match: true, cancellable, status })
}
