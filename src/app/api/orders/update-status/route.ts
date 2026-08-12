// src/app/api/orders/update-status/route.ts
// API update status pesanan dari OMS (back office).
//   PATCH → ubah order_status sesuai state machine. Bila 'Dikirim' wajib isi ekspedisi + no resi;
//           bila 'Dibatalkan' kembalikan stok produk.
// Keamanan: WAJIB sesi admin (requireAdmin) — endpoint tulis OMS, bukan publik.
// Validasi transisi & field dilakukan ULANG di server (jangan percaya UI).

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/oms-guard'
import { getOrderByOrderId, getOrderUuidByInvoice, updateOrderStatus } from '@/lib/mock-db/orders'
import { restoreStock } from '@/lib/mock-db/products'
import { recordOrderStockChanges } from '@/lib/stock-audit'
import { canTransition } from '@/lib/order-status-machine'
import type { OrderFulfillmentStatus } from '@/types/order'

// createAdminClient (Supabase) butuh runtime Node.js, bukan Edge
export const runtime = 'nodejs'

const VALID_STATUSES: OrderFulfillmentStatus[] = [
  'Menunggu Pembayaran',
  'Diproses',
  'Dikirim',
  'Selesai',
  'Dibatalkan',
]

// PATCH: perbarui status pesanan setelah verifikasi sesi admin + validasi transisi.
export async function PATCH(request: Request) {
  // Guard: hanya admin OMS terautentikasi
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : ''
  const newStatus = body.status as OrderFulfillmentStatus

  if (!orderId) {
    return NextResponse.json({ error: 'orderId wajib ada.' }, { status: 400 })
  }
  if (!VALID_STATUSES.includes(newStatus)) {
    return NextResponse.json({ error: 'Status tidak dikenal.' }, { status: 400 })
  }

  const order = await getOrderByOrderId(orderId)
  if (!order) {
    return NextResponse.json({ error: 'Pesanan tidak ditemukan.' }, { status: 404 })
  }

  // Validasi transisi di SERVER (jangan percaya dropdown UI)
  const current = order.status ?? 'Menunggu Pembayaran'
  if (!canTransition(current, newStatus)) {
    return NextResponse.json(
      { error: `Transisi status "${current}" → "${newStatus}" tidak diizinkan.` },
      { status: 409 },
    )
  }

  // Bila status baru 'Dikirim': ekspedisi, jenis layanan & no resi wajib diisi.
  let logistics: { courier: string; service: string; trackingNumber: string } | undefined
  if (newStatus === 'Dikirim') {
    const courier = typeof body.courier === 'string' ? body.courier.trim() : ''
    const service = typeof body.service === 'string' ? body.service.trim() : ''
    const trackingNumber = typeof body.trackingNumber === 'string' ? body.trackingNumber.trim() : ''
    if (!courier) {
      return NextResponse.json({ error: 'Nama ekspedisi wajib diisi untuk status Dikirim.' }, { status: 422 })
    }
    if (!service) {
      return NextResponse.json({ error: 'Jenis layanan wajib diisi untuk status Dikirim.' }, { status: 422 })
    }
    if (!trackingNumber) {
      return NextResponse.json({ error: 'No resi wajib diisi untuk status Dikirim.' }, { status: 422 })
    }
    logistics = { courier, service, trackingNumber }
  }

  const updated = await updateOrderStatus(orderId, newStatus, logistics)
  if (!updated) {
    return NextResponse.json({ error: 'Gagal memperbarui status pesanan.' }, { status: 500 })
  }

  // Bila dibatalkan: lepaskan kembali stok yang dialokasikan untuk pesanan ini (produk OMS).
  if (newStatus === 'Dibatalkan') {
    await restoreStock(
      order.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        variantId: i.variantId ?? undefined,
      })),
      order.warehouseId,
    )

    // Riwayat mutasi. Di jalur ini pelakunya ADMIN (pembatalan dari OMS), jadi recordOrderStockChanges
    // tetap dipakai untuk alasan 'order_cancelled' — kolom "diubah oleh" memang tak diisi di sini
    // supaya semua baris pembatalan konsisten; nomor invoice sudah menunjukkan asal perubahannya.
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
  }

  return NextResponse.json({ success: true, order: updated })
}
