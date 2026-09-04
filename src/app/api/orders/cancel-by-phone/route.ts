// src/app/api/orders/cancel-by-phone/route.ts
// LANGKAH akhir pembatalan: batalkan pesanan setelah RE-VERIFIKASI DUA IDENTITAS ke DB
// (defense-in-depth — tidak percaya hasil verify sisi client) + cek status di server.
// Set status 'Dibatalkan' + kembalikan stok. Aturan status = sama dengan alur token (/api/orders/cancel).
//
// ── DUA IDENTITAS, keduanya diverifikasi di sini (menutup SEC-037) ──
// Endpoint ini dulu hanya menuntut nomor invoice + no_telepon. Halaman /cancel-order memang
// meminta email lebih dulu lalu no_telepon sebagai konfirmasi, tetapi properti "dua identitas"
// itu HANYA hidup di UI: siapa pun yang memanggil endpoint ini langsung tak perlu tahu email
// pemilik pesanan sama sekali. Dibuktikan saat audit — satu request berisi orderId dan phone saja
// membatalkan pesanan sungguhan.
//
// Kini `email` WAJIB ada di payload dan dicocokkan ke orders.email. Jadi pembatalan benar-benar
// menuntut dua data berbeda dari pesanan yang sama, dan keduanya diperiksa SERVER, bukan UI.
// Jangan melonggarkan ini kembali menjadi telepon saja: sendirian, no_telepon hanya menyembunyikan
// 4 digit tengah (lihat maskPhone di /track) sehingga ruang tebaknya cuma 10.000.
//
// Perlindungan: honeypot `website` + rate limit per-IP & per-nomor (threshold lebih ketat
// karena ini aksi destruktif — lihat @/lib/rate-limit). Menutup temuan K-1 audit keamanan
// 2026-07-24 (docs/security/audit-2026-07-24.md).

import { NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { getOrderByOrderId, getOrderUuidByInvoice, updateOrderStatus } from '@/lib/mock-db/orders'
import { restoreStock } from '@/lib/mock-db/products'
import { recordOrderStockChanges } from '@/lib/stock-audit'
import { normalizePhone, isValidPhone } from '@/lib/phone'
import { normalizeEmail, isValidEmail } from '@/lib/email'
import type { OrderFulfillmentStatus } from '@/types/order'
import { RATE_LIMITS, enforceRateLimit, getClientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

const CANCELLABLE: OrderFulfillmentStatus[] = ['Menunggu Pembayaran', 'Diproses']

export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  // Honeypot → tolak senyap (anggap gagal biasa)
  if (typeof body.website === 'string' && body.website.trim().length > 0) {
    return NextResponse.json({ error: 'Permintaan tidak valid.' }, { status: 400 })
  }

  // Rate limit per-IP: aksi destruktif → threshold lebih ketat dari endpoint baca
  const ip = getClientIp(request)
  const limitedByIp = enforceRateLimit(`cancel-by-phone:ip:${ip}`, RATE_LIMITS.PHONE_WRITE_IP)
  if (limitedByIp) return limitedByIp

  const orderId = typeof body.orderId === 'string' ? body.orderId.trim().replace(/^#/, '') : ''
  const rawPhone = typeof body.phone === 'string' ? body.phone : ''
  const rawEmail = typeof body.email === 'string' ? body.email : ''
  if (!orderId) return NextResponse.json({ error: 'Pesanan tidak valid.' }, { status: 400 })
  if (!isValidEmail(rawEmail)) {
    return NextResponse.json({ error: 'Email tidak valid.' }, { status: 400 })
  }
  if (!isValidPhone(rawPhone)) {
    return NextResponse.json({ error: 'Nomor telepon tidak valid.' }, { status: 400 })
  }

  // Rate limit per-pesanan untuk aksi destruktif. Dikunci pada NOMOR PESANAN dengan alasan yang
  // sama seperti verify-cancel (SEC-038): mengunci pada nilai yang ditebak berarti penebak selalu
  // mendapat ember baru. Bedanya di sini SETIAP percobaan dihitung, bukan hanya yang gagal —
  // membatalkan pesanan yang sama berkali-kali memang bukan perilaku wajar.
  const normalizedPhone = normalizePhone(rawPhone)
  const email = normalizeEmail(rawEmail)
  const limitedByOrder = enforceRateLimit(
    `cancel-by-phone:order:${orderId}`,
    RATE_LIMITS.PHONE_WRITE_PHONE,
  )
  if (limitedByOrder) return limitedByOrder

  // Query ULANG dari DB
  const order = await getOrderByOrderId(orderId)
  if (!order) return NextResponse.json({ error: 'Pesanan tidak ditemukan.' }, { status: 404 })

  // RE-VERIFIKASI kepemilikan — DUA identitas, keduanya wajib cocok. Lihat catatan di kepala
  // berkas: sebelum SEC-037 ditutup, hanya no_telepon yang diperiksa di sini.
  //
  // Pesanan lama ber-email NULL tak akan pernah lolos: normalizeEmail(undefined) menghasilkan
  // string kosong sementara `email` dijamin tidak kosong oleh isValidEmail di atas. Itu memang
  // diinginkan — pesanan tanpa email tak punya pemilik yang bisa dibuktikan lewat jalur ini, dan
  // pemiliknya masih bisa memakai tautan pembatalan bertoken.
  if (email !== normalizeEmail(order.customerEmail ?? '')) {
    return NextResponse.json(
      { error: 'Email tidak cocok dengan pesanan ini.' },
      { status: 403 },
    )
  }
  if (normalizedPhone !== normalizePhone(order.customerPhone ?? '')) {
    return NextResponse.json(
      { error: 'Nomor telepon tidak cocok dengan pesanan ini.' },
      { status: 403 },
    )
  }

  const current = order.status ?? 'Diproses'
  if (current === 'Dibatalkan') {
    return NextResponse.json({ error: 'Pesanan ini sudah dibatalkan sebelumnya.' }, { status: 409 })
  }
  // Validasi status di SERVER — tolak bila sudah lewat tahap aman (mis. Dikirim/Selesai)
  if (!CANCELLABLE.includes(current)) {
    return NextResponse.json(
      { error: 'Pesanan tidak dapat dibatalkan karena sudah dalam proses pengiriman/selesai.' },
      { status: 409 },
    )
  }

  const updated = await updateOrderStatus(orderId, 'Dibatalkan')
  if (!updated) {
    return NextResponse.json({ error: 'Gagal memperbarui status pesanan.' }, { status: 500 })
  }

  // Kembalikan stok yang dialokasikan untuk pesanan ini, ke gudang pemenuhnya
  await restoreStock(
    order.items.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
      variantId: i.variantId ?? undefined,
    })),
    order.warehouseId,
  )

  // Riwayat mutasi: stok kembali karena pembatalan oleh pembeli (lihat catatan di orders/cancel).
  const orderUuid = await getOrderUuidByInvoice(order.orderId)
  await recordOrderStockChanges({
    items: order.items.map((i) => ({
      productId: i.productId,
      ...(i.variantId ? { variantId: i.variantId } : {}),
      quantity: i.quantity,
    })),
    ...(order.warehouseId ? { warehouseId: order.warehouseId } : {}),
    orderInvoice: order.orderId,
    ...(orderUuid ? { orderId: orderUuid } : {}),
    direction: 'in',
  })

  // Stok kembali → segarkan cache storefront (sama seperti alur cancel token)
  revalidatePath('/')
  revalidatePath('/products')
  for (const i of order.items) revalidatePath(`/produk/${i.productId}`)
  revalidateTag('products', 'max')
  revalidateTag('sales', 'max')

  return NextResponse.json({ success: true, orderId: order.orderId, status: 'Dibatalkan' })
}
