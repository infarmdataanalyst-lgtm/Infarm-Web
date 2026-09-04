// src/app/api/reviews/create-by-email/route.ts
// Submit ulasan dari flow review by EMAIL. Verifikasi OTORITATIF di server (query ulang DB):
//  - email input WAJIB cocok dengan email pesanan (jangan percaya client),
//  - pesanan tidak dibatalkan,
//  - produk benar bagian dari pesanan.
// Lalu simpan (dedup via order_invoice).
//
// ── Kepemilikan diverifikasi lewat email, TANPA konfirmasi kedua ──
// Berbeda dari pembatalan pesanan yang meminta no_telepon sebagai faktor kedua, memberi ulasan
// tidak merusak apa pun dan tidak bisa ditarik kembali oleh penyerang untuk keuntungannya —
// paling jauh ia menulis ulasan palsu pada produk yang memang dibeli pemilik email itu. Biaya
// satu langkah verifikasi tambahan di sini lebih besar daripada risikonya.
//
// ── Nama penulis diisi SERVER, bukan dari body ──
// `authorName` dari client bisa diisi apa saja, termasuk nama orang lain. Server sudah memegang
// pesanannya di sini, jadi tak ada alasan mempercayai kiriman client. Ini juga yang memungkinkan
// /api/reviews/reviewable-by-email berhenti mengembalikan nama pelanggan sama sekali. Pola dan
// alasannya identik dengan /api/reviews/create (temuan SEC-007).
//
// Perlindungan: honeypot `website` + rate limit per-IP & per-email (threshold ketat karena ini
// aksi tulis — lihat @/lib/rate-limit).

import { NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { createReview, DuplicateReviewError } from '@/lib/mock-db/reviews'
import { getOrderByOrderId } from '@/lib/mock-db/orders'
import { normalizeEmail, isValidEmail } from '@/lib/email'
import {
  REVIEW_COMMENT_MAX,
  REVIEW_COMMENT_TOO_LONG,
  clampAuthorName,
} from '@/lib/review-validation'
import { RATE_LIMITS, enforceRateLimit, getClientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  // Honeypot → tolak senyap
  if (typeof body.website === 'string' && body.website.trim().length > 0) {
    return NextResponse.json({ error: 'Permintaan tidak valid.' }, { status: 400 })
  }

  // Rate limit submit ulasan per-IP. Bucket-nya SAMA dengan /api/reviews/create dan
  // /api/reviews/create-by-phone agar bot tak bisa memecah spam ke tiga endpoint.
  const ip = getClientIp(request)
  const limitedByIp = enforceRateLimit(`reviews-create:ip:${ip}`, RATE_LIMITS.REVIEW_CREATE_IP)
  if (limitedByIp) return limitedByIp

  const rawEmail = typeof body.email === 'string' ? body.email : ''
  const orderInvoice =
    typeof body.orderInvoice === 'string' ? body.orderInvoice.trim().replace(/^#/, '') : ''
  const productId = typeof body.productId === 'string' ? body.productId.trim() : ''
  const rating = typeof body.rating === 'number' ? body.rating : 0
  const comment = typeof body.comment === 'string' ? body.comment : ''

  if (!isValidEmail(rawEmail)) {
    return NextResponse.json(
      { error: 'Email tidak valid. Contoh: nama@gmail.com' },
      { status: 400 },
    )
  }
  // `authorName` sengaja TIDAK divalidasi dari body — server yang mengisinya di bawah.
  if (!orderInvoice || !productId || rating < 1 || rating > 5) {
    return NextResponse.json(
      { error: 'Data ulasan tidak lengkap (pesanan, produk, dan rating 1–5 wajib).' },
      { status: 422 },
    )
  }
  // Batas panjang komentar — lihat @/lib/review-validation (bagian batas panjang pada SEC-042).
  if (comment.length > REVIEW_COMMENT_MAX) {
    return NextResponse.json({ error: REVIEW_COMMENT_TOO_LONG }, { status: 422 })
  }

  // Rate limit per-email: cegah brute-force tertarget ke satu email dari banyak IP
  const email = normalizeEmail(rawEmail)
  const limitedByEmail = enforceRateLimit(
    `create-by-email:email:${email}`,
    RATE_LIMITS.EMAIL_WRITE_EMAIL,
  )
  if (limitedByEmail) return limitedByEmail

  // === Verifikasi otoritatif ke DB ===
  const order = await getOrderByOrderId(orderInvoice)
  if (!order) {
    return NextResponse.json({ error: 'Pesanan tidak ditemukan.' }, { status: 404 })
  }
  // Kepemilikan: email input harus cocok dengan email pesanan. Keduanya dinormalkan lebih dulu —
  // yang tersimpan pun lewat normalizeEmail saat checkout, jadi perbandingannya setara.
  //
  // Pesanan lama ber-email NULL TIDAK akan pernah cocok di sini: normalizeEmail(undefined) = ''
  // sementara `email` dijamin tidak kosong oleh isValidEmail di atas. Itu memang yang diinginkan —
  // pesanan tanpa email tak punya pemilik yang bisa dibuktikan lewat jalur ini.
  if (email !== normalizeEmail(order.customerEmail ?? '')) {
    return NextResponse.json(
      { error: 'Email tidak cocok dengan pesanan ini.' },
      { status: 403 },
    )
  }
  if (order.status === 'Dibatalkan') {
    return NextResponse.json(
      { error: 'Pesanan sudah dibatalkan, tidak dapat diberi ulasan.' },
      { status: 409 },
    )
  }
  if (!order.items.some((it) => it.productId === productId)) {
    return NextResponse.json(
      { error: 'Produk ini bukan bagian dari pesanan tersebut.' },
      { status: 422 },
    )
  }

  // Nama penulis diambil dari PESANAN, bukan dari body. Fallback dipakai hanya bila pesanan lama
  // benar-benar tak punya nama tersimpan.
  const authorName = clampAuthorName(order.customerName?.trim() || 'Pelanggan Infarm')

  try {
    const id = await createReview({ productId, authorName, rating, comment, orderInvoice })
    revalidatePath(`/produk/${productId}`)
    revalidateTag('reviews', 'max')
    return NextResponse.json({ success: true, id }, { status: 201 })
  } catch (err) {
    if (err instanceof DuplicateReviewError) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    const message = err instanceof Error ? err.message : 'Gagal menyimpan ulasan.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
