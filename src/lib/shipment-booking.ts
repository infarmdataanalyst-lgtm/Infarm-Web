// src/lib/shipment-booking.ts
// Orkestrasi booking kurir SETELAH pembayaran sukses: panggil Mengantar → catat hasil ke pesanan.
// SERVER ONLY (mengimpor mengantar-shipment yang memegang API key).
//
// Dipisah dari route webhook Xendit supaya SATU implementasi dipakai dua pemicu:
//   1. POST /api/webhooks/xendit  → pembayaran nyata
//   2. POST /api/dev/simulate-payment → simulasi saat Xendit belum aktif (dev-only)
// Kalau logikanya diduplikasi di dua tempat, jalur simulasi akan perlahan menyimpang dari jalur
// nyata dan pengujian berhenti bermakna.

import { revalidatePath } from 'next/cache'
import { JT_COURIER_LABEL } from '@/lib/mengantar-estimate'
import { createShipmentOrder } from '@/lib/mengantar-shipment'
import { updateShipment } from '@/lib/mock-db/orders'
import type { Order } from '@/types/order'

// Ringkasan hasil untuk log & badan respons. Bukan untuk ditampilkan ke pembeli.
export type BookingOutcome =
  | { status: 'BOOKED'; trackingNumber: string; service: string }
  | { status: 'ALREADY_BOOKED'; trackingNumber?: string }
  | { status: 'FAILED'; reason: string; detail: string }
  // Resi terbit di Mengantar tapi gagal tercatat di DB — paling berbahaya, tak ada jejak.
  | { status: 'BOOKED_BUT_NOT_SAVED'; trackingNumber: string }

// Membuat shipment J&T untuk pesanan yang SUDAH lunas, lalu mencatat hasilnya.
//
// Sengaja TIDAK melempar: pemanggilnya adalah jalur webhook yang wajib tetap membalas 2xx.
// Kegagalan booking BUKAN alasan menggagalkan callback pembayaran — uangnya sudah masuk dan sudah
// tercatat; mengulang callback tak akan memperbaiki alamat yang salah, hanya menumpuk percobaan.
export async function bookShipmentForPaidOrder(
  order: Order,
  logPrefix: string,
): Promise<BookingOutcome> {
  const invoice = order.orderId

  // Idempoten: callback bisa datang berulang, dan resi yang sudah terbit tak boleh diganti resi
  // baru — paket fisiknya sudah berlabel yang lama.
  if (order.shipmentStatus === 'BOOKED' || order.trackingNumber) {
    console.log(`${logPrefix} invoice=${invoice} sudah punya resi — booking dilewati`)
    return {
      status: 'ALREADY_BOOKED',
      ...(order.trackingNumber ? { trackingNumber: order.trackingNumber } : {}),
    }
  }

  const result = await createShipmentOrder(order)

  if (!result.ok) {
    // Pembayaran sudah masuk, jadi pesanan TETAP ada. Yang ditandai: perlu tindakan manual admin.
    // Tanpa penandaan ini satu-satunya jejak adalah no_tracking kosong, yang tak bisa dibedakan
    // dari pesanan yang memang belum waktunya dibooking.
    console.error(`${logPrefix} invoice=${invoice} BOOKING GAGAL: ${result.reason} ${result.detail}`)
    await updateShipment(invoice, { booked: false, error: `${result.reason}: ${result.detail}` })
    revalidatePath('/oms/dashboard/orders')
    return { status: 'FAILED', reason: result.reason, detail: result.detail }
  }

  // nama_ekspedisi & jenis_layanan ditulis ULANG dengan nilai dari Mengantar, supaya kolomnya
  // konsisten dengan kurir yang benar-benar mengangkut — bukan sisa nilai dari pilihan checkout.
  const saved = await updateShipment(invoice, {
    booked: true,
    trackingNumber: result.trackingNumber,
    courier: JT_COURIER_LABEL,
    service: result.serviceCode,
  })

  if (!saved) {
    console.error(
      `${logPrefix} invoice=${invoice} RESI TERBIT (${result.trackingNumber}) TAPI GAGAL DISIMPAN — catat manual`,
    )
    return { status: 'BOOKED_BUT_NOT_SAVED', trackingNumber: result.trackingNumber }
  }

  console.log(`${logPrefix} invoice=${invoice} resi ${result.trackingNumber} (${result.serviceCode})`)
  revalidatePath('/oms/dashboard/orders')
  return { status: 'BOOKED', trackingNumber: result.trackingNumber, service: result.serviceCode }
}
