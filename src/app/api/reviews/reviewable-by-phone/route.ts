// src/app/api/reviews/reviewable-by-phone/route.ts
// LANGKAH 1 fitur review by no_telepon: cari semua pesanan milik no_telepon, kumpulkan produk yang
// BELUM diulas untuk tiap pesanan (cek order_invoice + product_id di tabel reviews). Pesanan yang
// dibatalkan dikecualikan (tak bisa diulas). Output non-sensitif: foto + nama produk + invoice.
//
// ⚠ ENDPOINT INI SUDAH TIDAK PUNYA PEMANGGIL. Halaman /review berpindah ke pencarian by email
// (/api/reviews/reviewable-by-email). Berkasnya dipertahankan agar rute yang mungkin dipakai
// integrasi luar tidak hilang mendadak, tetapi jangan menambah pemanggil baru ke sini.
//
// ── customerName DIHAPUS dari respons (menutup SEC-021) ──
// Field itu dulu dikembalikan UTUH tanpa mask, berbeda dari track-by-phone yang konsisten memakai
// maskName(). Dikombinasikan dengan brute-force nomor telepon, endpoint ini langsung memberi
// pasangan (nomor telepon sah → nama lengkap pemiliknya) — justru lebih sensitif daripada nama
// ter-mask di endpoint saudaranya.
//
// DIHAPUS, bukan di-mask, karena satu-satunya alasan field ini pernah ada adalah mengisi otomatis
// input "Nama Tampilan" di halaman ulasan — input yang sudah tidak ada lagi sejak nama penulis
// diisi server dari pesanan yang terverifikasi. Mengembalikan nama yang tak dipakai siapa pun
// berarti membayar risiko PII tanpa memperoleh apa pun. Bentuk respons kini sama persis dengan
// reviewable-by-email, yang memang sengaja tidak mengembalikan nama.
//
// Perlindungan: honeypot `website` + rate limit per-IP & per-nomor (lihat @/lib/rate-limit).
// Menutup temuan K-1 audit keamanan 2026-07-24 (docs/security/audit-2026-07-24.md).

import { NextResponse } from 'next/server'
import { getOrdersByPhone } from '@/lib/mock-db/orders'
import { getReviewedProductIds } from '@/lib/mock-db/reviews'
import { normalizePhone, isValidPhone } from '@/lib/phone'
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

// Satu produk yang bisa diulas (dari sebuah pesanan). TANPA identitas pemesan — baca catatan
// SEC-021 di kepala berkas sebelum menambahkan field apa pun ke sini.
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

  // Honeypot → balas kosong senyap
  if (typeof body.website === 'string' && body.website.trim().length > 0) {
    return NextResponse.json({ items: [] })
  }

  // Rate limit per-IP: anti brute-force umum
  const ip = getClientIp(request)
  const limitedByIp = enforceRateLimit(`reviewable-by-phone:ip:${ip}`, RATE_LIMITS.PHONE_LOOKUP_IP)
  if (limitedByIp) return limitedByIp

  const rawPhone = typeof body.phone === 'string' ? body.phone : ''
  if (!isValidPhone(rawPhone)) {
    return NextResponse.json(
      { error: 'Nomor telepon tidak valid. Gunakan format 08xxxxxxxxxx.' },
      { status: 400 },
    )
  }

  const phone = normalizePhone(rawPhone)

  // Rate limit per-nomor: cegah brute-force tertarget ke satu nomor dari banyak IP
  const limitedByPhone = enforceRateLimit(
    `reviewable-by-phone:phone:${phone}`,
    RATE_LIMITS.PHONE_LOOKUP_PHONE,
  )
  if (limitedByPhone) return limitedByPhone

  // Rate limit per-kombinasi IP+nomor untuk percobaan GAGAL (nomor tanpa pesanan sama sekali) —
  // pencarian yang membuahkan hasil tidak dihitung agar user asli tidak terblokir.
  const missKey = `reviewable-by-phone:miss:${ip}:${phone}`
  if (isOverLimit(missKey, RATE_LIMITS.PHONE_LOOKUP_IP_PHONE_MISS)) {
    return rateLimitResponse(RATE_LIMITS.PHONE_LOOKUP_IP_PHONE_MISS, missKey)
  }

  const orders = await getOrdersByPhone(phone)
  if (orders.length === 0) recordAttempt(missKey, RATE_LIMITS.PHONE_LOOKUP_IP_PHONE_MISS)

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
