// src/app/api/reviews/reviewable-by-email/route.ts
// LANGKAH 1 fitur review by EMAIL: cari semua pesanan milik satu email, kumpulkan produk yang
// BELUM diulas untuk tiap pesanan (cek order_invoice + product_id di tabel reviews). Pesanan yang
// dibatalkan dikecualikan (tak bisa diulas).
//
// ── Kenapa endpoint BARU, bukan mengganti reviewable-by-phone ──
// Pola yang sama dipakai saat /track-order pindah ke email: jalur telepon dibiarkan utuh supaya
// pemanggil lain tak ikut mati. Endpoint ini menyalin alur reviewable-by-phone persis, hanya
// kolom identitasnya yang berubah — lihat catatan di track-by-email untuk alasan lengkapnya.
//
// ── Yang SENGAJA tidak dikembalikan: nama pelanggan ──
// Versi by-phone mengembalikan `customerName` UTUH untuk auto-fill nama penulis. Endpoint ini
// tidak. Alasannya sama dengan yang menutup SEC-007: endpoint publik yang identifikasinya cuma
// satu nilai mudah-tebak tak boleh menjadi alat menukar "email seseorang" menjadi "nama lengkap
// orang itu". Nama penulis ulasan kini diisi SERVER dari pesanan yang sudah diverifikasinya, di
// /api/reviews/create-by-email — persis seperti yang dilakukan /api/reviews/create.
//
// Perlindungan (sama persis dengan track-by-email):
//  - Honeypot `website` → balas kosong senyap.
//  - Validasi + normalisasi email di server (tak percaya client).
//  - Rate limit 3 lapis: per-IP, per-email, dan per-kombinasi IP+email untuk percobaan GAGAL.

import { NextResponse } from 'next/server'
import { getOrdersByEmail } from '@/lib/mock-db/orders'
import { getReviewedProductIds } from '@/lib/mock-db/reviews'
import { normalizeEmail, isValidEmail } from '@/lib/email'
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

// Satu produk yang bisa diulas (dari sebuah pesanan). Tanpa data pribadi apa pun —
// nama produk, fotonya, dan nomor invoice asalnya saja.
type ReviewableItem = {
  orderInvoice: string
  productId: string
  name: string
  imageUrl: string | null
}

export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  // Honeypot → balas kosong senyap (jangan beri sinyal apa pun ke bot)
  if (typeof body.website === 'string' && body.website.trim().length > 0) {
    return NextResponse.json({ items: [] })
  }

  // Rate limit per-IP: anti brute-force umum
  const ip = getClientIp(request)
  const limitedByIp = enforceRateLimit(`reviewable-by-email:ip:${ip}`, RATE_LIMITS.EMAIL_LOOKUP_IP)
  if (limitedByIp) return limitedByIp

  const rawEmail = typeof body.email === 'string' ? body.email : ''
  if (!isValidEmail(rawEmail)) {
    return NextResponse.json(
      { error: 'Email tidak valid. Contoh: nama@gmail.com' },
      { status: 400 },
    )
  }

  // Normalisasi WAJIB memakai helper yang sama dengan sisi checkout — pencocokan di DB persis
  // (case-sensitive), jadi email yang disimpan dan yang dicari harus melewati normalisasi sama.
  const email = normalizeEmail(rawEmail)

  // Rate limit per-email: cegah brute-force tertarget ke satu email dari banyak IP
  const limitedByEmail = enforceRateLimit(
    `reviewable-by-email:email:${email}`,
    RATE_LIMITS.EMAIL_LOOKUP_EMAIL,
  )
  if (limitedByEmail) return limitedByEmail

  // Rate limit percobaan GAGAL, DIKUNCI PADA IP SAJA. Alasannya sama persis dengan track-by-email
  // (SEC-039): mengunci ember pada email yang sedang DICOBA berarti penyisir daftar email selalu
  // mendapat ember baru, sehingga lapis ini tak pernah mengikat siapa pun. Pencarian yang
  // membuahkan hasil tetap tidak dihitung agar pemilik email asli tak pernah terblokir.
  const missKey = `reviewable-by-email:miss:ip:${ip}`
  if (isOverLimit(missKey, RATE_LIMITS.EMAIL_LOOKUP_IP_MISS)) {
    return rateLimitResponse(RATE_LIMITS.EMAIL_LOOKUP_IP_MISS, missKey)
  }

  const orders = await getOrdersByEmail(email)
  if (orders.length === 0) recordAttempt(missKey, RATE_LIMITS.EMAIL_LOOKUP_IP_MISS)

  const items: ReviewableItem[] = []
  for (const order of orders) {
    // Pesanan dibatalkan tak bisa diulas
    if (order.status === 'Dibatalkan') continue

    // Produk yang SUDAH diulas untuk pesanan ini → dilewati
    const reviewed = new Set(await getReviewedProductIds(order.orderId))
    for (const it of order.items) {
      if (reviewed.has(it.productId)) continue
      items.push({
        orderInvoice: order.orderId,
        productId: it.productId,
        name: it.name,
        imageUrl: it.imageUrl ?? null,
      })
    }
  }

  return NextResponse.json({ items })
}
