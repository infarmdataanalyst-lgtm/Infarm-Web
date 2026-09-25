// src/app/api/orders/track-by-email/route.ts
// API Lacak Pesanan by EMAIL (guest). Mengembalikan HANYA info non-sensitif tiap pesanan:
// nomor invoice, status, no resi, tanggal, ringkasan barang (nama+qty), dan NAMA yang DIMASK.
// TIDAK mengembalikan alamat lengkap / nama penuh / nomor telepon.
//
// ── Kenapa endpoint BARU, bukan mengganti track-by-phone ──
// `/api/orders/track-by-phone` masih dipakai DUA pemanggil lain yang tetap berbasis no_telepon:
// halaman /cancel-order (langkah verifikasi pertama) dan komponen ActiveOrdersSummary (badge
// jumlah pesanan aktif di ikon profil). Mengubah endpoint itu menjadi berbasis email akan
// mematikan keduanya. Jadi jalur email berdiri sendiri; jalur telepon dibiarkan utuh.
//
// Perlindungan (kompensasi karena identifikasi hanya via email — sama persis dengan jalur telepon):
//  - Honeypot: field tersembunyi `website` — bila terisi → dianggap bot, balas kosong senyap.
//  - Validasi format email di server (tak percaya validasi client).
//  - Rate limit in-memory 3 lapis (lihat @/lib/rate-limit): per-IP, per-email, dan per-kombinasi
//    IP+email untuk percobaan GAGAL. Filosofinya identik dengan track-by-phone; lihat CLAUDE.md
//    section "Rate Limiting".

import { NextResponse } from 'next/server'
import { getOrdersByEmail } from '@/lib/mock-db/orders'
import { normalizeEmail, isValidEmail } from '@/lib/email'
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

// Bentuk pesanan aman-publik (tanpa alamat/nama penuh/email/telepon).
// Sengaja identik dengan bentuk di track-by-phone supaya halaman /track-order tak perlu tahu
// lewat jalur mana datanya datang.
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
  const limitedByIp = enforceRateLimit(`track-by-email:ip:${ip}`, RATE_LIMITS.EMAIL_LOOKUP_IP)
  if (limitedByIp) return limitedByIp

  const rawEmail = typeof body.email === 'string' ? body.email : ''
  if (!isValidEmail(rawEmail)) {
    return NextResponse.json(
      { error: 'Email tidak valid. Contoh: nama@gmail.com' },
      { status: 400 },
    )
  }

  // Normalisasi WAJIB dan harus memakai helper yang sama dengan sisi checkout — kalau tidak,
  // email yang tersimpan huruf kecil tak akan pernah cocok dengan yang dicari apa adanya.
  const email = normalizeEmail(rawEmail)

  // Rate limit per-email: cegah brute-force tertarget ke satu email dari banyak IP sekaligus
  const limitedByEmail = enforceRateLimit(
    `track-by-email:email:${email}`,
    RATE_LIMITS.EMAIL_LOOKUP_EMAIL,
  )
  if (limitedByEmail) return limitedByEmail

  // Rate limit percobaan GAGAL, DIKUNCI PADA IP SAJA — menutup cacat pembatas laju pada SEC-039.
  //
  // Versi lama mengunci ember pada `{ip}:{email}`, yaitu ikut memakai NILAI YANG SEDANG DITEBAK
  // sebagai bagian kunci. Penyisir daftar email karena itu selalu mendapat ember baru dan lapis ini
  // tak pernah menyentuhnya sama sekali — cacat yang sama persis dengan SEC-038, hanya di jalur
  // email. Yang tetap sama sepanjang penyisiran adalah SUMBER permintaannya, jadi itulah kuncinya.
  //
  // Hanya percobaan MELESET yang dihitung: pemilik email selalu mendapat hasil, jadi berapa kali
  // pun ia me-reload halamannya sendiri, hitungan ini tak pernah bertambah untuknya.
  const missKey = `track-by-email:miss:ip:${ip}`
  if (isOverLimit(missKey, RATE_LIMITS.EMAIL_LOOKUP_IP_MISS)) {
    return rateLimitResponse(RATE_LIMITS.EMAIL_LOOKUP_IP_MISS, missKey)
  }

  const orders = await getOrdersByEmail(email)
  if (orders.length === 0) recordAttempt(missKey, RATE_LIMITS.EMAIL_LOOKUP_IP_MISS)

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
