// src/app/api/dev/simulate-payment/route.ts
// SIMULASI pembayaran sukses — DEVELOPMENT ONLY. Dipakai menguji booking kurir J&T selama Xendit
// belum aktif, tanpa harus memalsukan callback Xendit beserta tokennya.
//
// ⚠️ DUA LAPIS PENJAGAAN, keduanya wajib:
//   1. NODE_ENV !== 'development' → 404 (bukan 403). Di production endpoint ini harus TIDAK ADA
//      wujudnya; membalas 403 justru mengonfirmasi keberadaannya bagi yang memindai.
//   2. requireAdmin() → hanya admin OMS yang sudah login. Tanpa ini, siapa pun di jaringan lokal
//      (atau lewat preview deployment yang lupa NODE_ENV) bisa menandai pesanan orang lain LUNAS
//      dan memicu booking kurir sungguhan.
//
// Efeknya IDENTIK dengan callback PAID dari Xendit karena memanggil orkestrator yang sama
// (lib/shipment-booking.ts) — jalur simulasi tak boleh menyimpang dari jalur nyata, kalau tidak
// pengujiannya kehilangan makna.
//
// Yang TIDAK dilakukan: menyentuh stok. Checkout sudah memotong stok saat pesanan dibuat, sama
// seperti pada jalur pembayaran nyata.

import { NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { requireAdmin } from '@/lib/oms-guard'
import { getOrderByOrderId, updatePaymentStatus } from '@/lib/mock-db/orders'
import { bookShipmentForPaidOrder } from '@/lib/shipment-booking'

export const runtime = 'nodejs'

const LOG = '[simulate-payment]'

export async function POST(request: Request) {
  // Lapis 1: tak pernah ada di luar development.
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Lapis 2: wajib sesi admin OMS.
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  const invoice = typeof body.invoice === 'string' ? body.invoice.trim() : ''
  if (!invoice) {
    return NextResponse.json({ error: 'Field `invoice` wajib diisi.' }, { status: 400 })
  }

  const order = await getOrderByOrderId(invoice)
  if (!order) {
    return NextResponse.json({ error: `Pesanan ${invoice} tidak ditemukan.` }, { status: 404 })
  }
  if (order.status === 'Dibatalkan') {
    // Cermin guard di webhook: pesanan yang sudah dibatalkan tak dihidupkan kembali.
    return NextResponse.json(
      { error: 'Pesanan sudah dibatalkan — tidak bisa ditandai lunas.' },
      { status: 409 },
    )
  }

  console.log(`${LOG} menandai ${invoice} LUNAS (simulasi)`)

  // Sudah lunas → jangan tulis ulang status, tapi booking TETAP dicoba: skenario paling sering
  // diuji adalah "pembayaran sudah masuk tapi booking gagal, ulangi booking-nya".
  let paidOrder = order
  if (order.paymentStatus !== 'Lunas') {
    const updated = await updatePaymentStatus(invoice, 'Lunas', { orderStatus: 'Diproses' })
    if (!updated) {
      return NextResponse.json({ error: 'Gagal memperbarui status pembayaran.' }, { status: 500 })
    }
    paidOrder = updated
    revalidateTag('sales', 'max')
    revalidatePath('/oms/dashboard')
  }

  const shipment = await bookShipmentForPaidOrder(paidOrder, LOG)

  // 200 walau booking gagal: pembayarannya memang berhasil disimulasikan. Hasil booking ada di
  // badan respons supaya bisa diperiksa saat pengujian.
  return NextResponse.json({ invoice, paymentStatus: 'Lunas', shipment })
}
