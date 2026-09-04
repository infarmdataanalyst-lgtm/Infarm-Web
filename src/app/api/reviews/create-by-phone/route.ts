// src/app/api/reviews/create-by-phone/route.ts
// Submit ulasan dari flow review by no_telepon. Verifikasi OTORITATIF di server (query ulang DB):
//  - no_telepon input WAJIB cocok dengan no_telepon pesanan (jangan percaya client),
//  - pesanan tidak dibatalkan,
//  - produk benar bagian dari pesanan.
// Lalu simpan (dedup via order_invoice).
//
// ⚠ ENDPOINT INI SUDAH TIDAK PUNYA PEMANGGIL. Halaman /review berpindah ke pencarian by email
// (/api/reviews/create-by-email), dan form ulasan pun sudah tidak punya input nama sama sekali.
// Berkasnya dipertahankan agar rute yang mungkin dipakai integrasi luar tidak hilang mendadak,
// tetapi jangan menambah pemanggil baru ke sini.
//
// ── Nama penulis diisi SERVER, bukan dari body (menutup SEC-041) ──
// Endpoint ini dulu satu-satunya dari tiga endpoint submit ulasan yang masih mengambil
// `authorName` apa adanya dari body permintaan. /api/reviews/create dan create-by-email sudah
// mengisinya sendiri dari pesanan yang telah diverifikasi sejak penutupan SEC-007; berkas ini
// tertinggal karena tak lagi punya pemanggil di UI — tetapi rutenya tetap hidup dan bisa dipanggil
// siapa saja.
//
// Kenapa konteks bisnisnya memperberat, bukan meringankan: ulasan di storefront membawa badge
// "Pembeli Terverifikasi" yang dihitung dari ada tidaknya order_invoice. Nama palsu yang menempel
// pada badge itu lebih merusak daripada ulasan anonim, karena pembaca justru diberi alasan untuk
// memercayainya. Kini `authorName` dari body DIABAIKAN sepenuhnya — bukan divalidasi, tapi tak
// pernah dibaca.
//
// Perlindungan: honeypot `website` + rate limit per-IP & per-nomor (threshold ketat karena ini
// aksi tulis — lihat @/lib/rate-limit). Menutup temuan K-1 audit keamanan 2026-07-24
// (docs/security/audit-2026-07-24.md).

import { NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { createReview, DuplicateReviewError } from '@/lib/mock-db/reviews'
import { getOrderByOrderId } from '@/lib/mock-db/orders'
import { normalizePhone, isValidPhone } from '@/lib/phone'
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

  // Rate limit submit ulasan per-IP. Bucket-nya SAMA dengan /api/reviews/create agar bot tak bisa
  // memecah spam ke dua endpoint. Ambang batas di RATE_LIMITS.REVIEW_CREATE_IP.
  const ip = getClientIp(request)
  const limitedByIp = enforceRateLimit(`reviews-create:ip:${ip}`, RATE_LIMITS.REVIEW_CREATE_IP)
  if (limitedByIp) return limitedByIp

  const rawPhone = typeof body.phone === 'string' ? body.phone : ''
  const orderInvoice = typeof body.orderInvoice === 'string' ? body.orderInvoice.trim().replace(/^#/, '') : ''
  const productId = typeof body.productId === 'string' ? body.productId.trim() : ''
  const rating = typeof body.rating === 'number' ? body.rating : 0
  const comment = typeof body.comment === 'string' ? body.comment : ''

  if (!isValidPhone(rawPhone)) {
    return NextResponse.json({ error: 'Nomor telepon tidak valid.' }, { status: 400 })
  }
  // `authorName` sengaja TIDAK dibaca dari body — server yang mengisinya di bawah (SEC-041).
  if (!orderInvoice || !productId || rating < 1 || rating > 5) {
    return NextResponse.json(
      { error: 'Data ulasan tidak lengkap (pesanan, produk, dan rating 1–5 wajib).' },
      { status: 422 },
    )
  }
  if (comment.length > REVIEW_COMMENT_MAX) {
    return NextResponse.json({ error: REVIEW_COMMENT_TOO_LONG }, { status: 422 })
  }

  // Rate limit per-nomor: cegah brute-force tertarget ke satu nomor dari banyak IP
  const normalizedPhone = normalizePhone(rawPhone)
  const limitedByPhone = enforceRateLimit(
    `create-by-phone:phone:${normalizedPhone}`,
    RATE_LIMITS.PHONE_WRITE_PHONE,
  )
  if (limitedByPhone) return limitedByPhone

  // === Verifikasi otoritatif ke DB ===
  const order = await getOrderByOrderId(orderInvoice)
  if (!order) {
    return NextResponse.json({ error: 'Pesanan tidak ditemukan.' }, { status: 404 })
  }
  // Kepemilikan: no_telepon input harus cocok dengan no_telepon pesanan
  if (normalizedPhone !== normalizePhone(order.customerPhone ?? '')) {
    return NextResponse.json(
      { error: 'Nomor telepon tidak cocok dengan pesanan ini.' },
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

  // Nama penulis diambil dari PESANAN, bukan dari body — sama persis dengan create-by-email.
  // Fallback dipakai hanya bila pesanan lama benar-benar tak punya nama tersimpan.
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
