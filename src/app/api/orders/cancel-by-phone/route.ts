// src/app/api/orders/cancel-by-phone/route.ts
// LANGKAH akhir pembatalan by no_telepon: batalkan pesanan setelah RE-VERIFIKASI no_telepon ke DB
// (defense-in-depth — tidak percaya hasil verify sisi client) + cek status di server.
// Set status 'Dibatalkan' + kembalikan stok. Aturan status = sama dengan alur token (/api/orders/cancel).
//
// Perlindungan: honeypot `website`. TODO(rate-limit): 5/IP/jam (ditunda).

import { NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { getOrderByOrderId, updateOrderStatus } from '@/lib/mock-db/orders'
import { restoreStock } from '@/lib/mock-db/products'
import { normalizePhone, isValidPhone } from '@/lib/phone'
import type { OrderFulfillmentStatus } from '@/types/order'

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

  const orderId = typeof body.orderId === 'string' ? body.orderId.trim().replace(/^#/, '') : ''
  const rawPhone = typeof body.phone === 'string' ? body.phone : ''
  if (!orderId) return NextResponse.json({ error: 'Pesanan tidak valid.' }, { status: 400 })
  if (!isValidPhone(rawPhone)) {
    return NextResponse.json({ error: 'Nomor telepon tidak valid.' }, { status: 400 })
  }

  // Query ULANG dari DB
  const order = await getOrderByOrderId(orderId)
  if (!order) return NextResponse.json({ error: 'Pesanan tidak ditemukan.' }, { status: 404 })

  // RE-VERIFIKASI kepemilikan: no_telepon input WAJIB cocok dengan no_telepon order
  if (normalizePhone(rawPhone) !== normalizePhone(order.customerPhone ?? '')) {
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

  // Kembalikan stok yang dialokasikan untuk pesanan ini
  await restoreStock(order.items.map((i) => ({ productId: i.productId, quantity: i.quantity })))

  // Stok kembali → segarkan cache storefront (sama seperti alur cancel token)
  revalidatePath('/')
  revalidatePath('/products')
  for (const i of order.items) revalidatePath(`/produk/${i.productId}`)
  revalidateTag('products', 'max')
  revalidateTag('sales', 'max')

  return NextResponse.json({ success: true, orderId: order.orderId, status: 'Dibatalkan' })
}
