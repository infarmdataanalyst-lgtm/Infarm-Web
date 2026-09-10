// src/app/api/orders/update-status/route.ts
// API update status pesanan dari OMS (back office).
//   PATCH → ubah order_status sesuai state machine. Bila 'Dikirim' wajib isi ekspedisi + no resi;
//           bila 'Dibatalkan' kembalikan stok produk.
// Keamanan: WAJIB sesi admin (requireAdmin) — endpoint tulis OMS, bukan publik.
// Validasi transisi & field dilakukan ULANG di server (jangan percaya UI).

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/oms-guard'
import {
  getOrderByOrderId,
  getOrderUuidByInvoice,
  setShipmentCancellation,
  updateOrderStatus,
} from '@/lib/mock-db/orders'
import { restoreStock } from '@/lib/mock-db/products'
import { recordOrderStockChanges } from '@/lib/stock-audit'
import { canTransition } from '@/lib/order-status-machine'
import { cancelShipmentOrder } from '@/lib/mengantar-cancel'
import { expireInvoiceForCancelledOrder } from '@/lib/order-invoice-expiry'
import type { Order, OrderFulfillmentStatus } from '@/types/order'

// createAdminClient (Supabase) butuh runtime Node.js, bukan Edge
export const runtime = 'nodejs'

const VALID_STATUSES: OrderFulfillmentStatus[] = [
  'Menunggu Pembayaran',
  'Diproses',
  'Dikirim',
  'Selesai',
  'Dibatalkan',
]

// Hasil upaya penghapusan penjemputan, dikembalikan ke OMS supaya admin melihatnya SEKARANG —
// bukan hanya tersimpan di kolom database yang tak pernah dibuka siapa pun.
export type ShipmentCancellationReport =
  | { attempted: false; reason: 'NO_SHIPMENT' | 'ALREADY_CANCELLED' }
  | { attempted: true; ok: true; deletedCount: number }
  | { attempted: true; ok: false; reason: string; detail: string; needsManual: true }

// Menghapus penjemputan di Mengantar untuk pesanan yang BARU SAJA dibatalkan.
//
// ── Kenapa dipanggil SETELAH status ditulis, bukan sebelum ──
// Dua kegagalan yang mungkin terjadi tidak setara:
//   - DELETE berhasil tapi tulis DB gagal → pengiriman lenyap sementara pesanan masih tampak
//     aktif. TIDAK ADA JEJAKNYA sama sekali; tak seorang pun akan tahu sampai pembeli bertanya.
//   - Tulis DB berhasil tapi DELETE gagal → pesanan batal, penjemputan masih hidup. Buruk juga,
//     tapi TERCATAT (CANCEL_FAILED) dan bisa ditindaklanjuti.
// Yang kedua jauh lebih baik daripada kegagalan senyap, jadi keputusan pembatalan dicatat lebih
// dulu dan penghapusan menyusul.
//
// ── Kenapa kegagalan TIDAK menggagalkan pembatalan ──
// Pembeli sudah meminta, uangnya sudah masuk, dan stok sudah dikembalikan. Menggagalkan pembatalan
// gara-gara kurir keburu jalan hanya memindahkan masalahnya kembali ke pembeli — padahal yang
// dibutuhkan justru sebaliknya: pembatalannya sah, dan admin diberi tahu ada satu langkah manual.
async function cancelPickupFor(order: Order): Promise<ShipmentCancellationReport> {
  const punyaPengiriman =
    Boolean(order.trackingNumber?.trim()) || order.shipmentStatus === 'BOOKED'
  if (!punyaPengiriman) return { attempted: false, reason: 'NO_SHIPMENT' }

  // IDEMPOTEN — dan ini bukan sekadar kerapian.
  //
  // Terukur 2026-09-09: DELETE /order membalas "Orders already deleted" untuk `_id` karangan MAUPUN
  // `_id` yang barusan berhasil dihapus. Mengantar tidak membedakan keduanya, jadi jawabannya tak
  // bisa dipakai untuk menyimpulkan apa pun saat mengulang. Catatan kita sendirilah yang menjawab:
  // kalau sudah CANCELLED, penghapusannya memang sudah berhasil dan tak perlu diulang.
  if (order.shipmentStatus === 'CANCELLED') {
    return { attempted: false, reason: 'ALREADY_CANCELLED' }
  }

  const hasil = await cancelShipmentOrder({
    ...(order.mengantarObjectId ? { objectId: order.mengantarObjectId } : {}),
    ...(order.mengantarOrderId ? { orderId: order.mengantarOrderId } : {}),
  })

  if (hasil.ok) {
    await setShipmentCancellation(order.orderId, { cancelled: true })
    return { attempted: true, ok: true, deletedCount: hasil.deletedCount }
  }

  const detail = `${hasil.reason}: ${hasil.detail}`
  await setShipmentCancellation(order.orderId, { cancelled: false, error: detail })
  console.error(
    `[update-status] ${order.orderId} DIBATALKAN tapi penjemputan (resi ${order.trackingNumber ?? '-'}) GAGAL DIHAPUS — ${detail}`,
  )
  return { attempted: true, ok: false, reason: hasil.reason, detail: hasil.detail, needsManual: true }
}

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

    // Penghapusan penjemputan dijalankan PALING AKHIR — setelah status, stok, dan mutasinya
    // tercatat. Urutan ini disengaja: ketiga langkah di atas adalah keadaan pesanan kita sendiri
    // dan harus utuh apa pun yang terjadi di Mengantar. Kegagalan di sini tidak membatalkan
    // satu pun dari mereka, dan tidak menggagalkan respons.
    const shipmentCancellation = await cancelPickupFor(order)

    // Mematikan tagihan yang masih hidup. Untuk pesanan yang sudah LUNAS ini otomatis dilewati
    // (tak ada yang perlu dimatikan), jadi di jalur OMS ia hanya bekerja pada pembatalan pesanan
    // yang belum dibayar.
    const invoiceExpiry = await expireInvoiceForCancelledOrder(order)

    return NextResponse.json({ success: true, order: updated, shipmentCancellation, invoiceExpiry })
  }

  return NextResponse.json({ success: true, order: updated })
}
