// src/app/api/webhooks/xendit/route.ts
// Webhook (callback) Xendit untuk Invoice. HANYA POST — App Router otomatis membalas 405 untuk
// method lain karena hanya POST yang diekspor di file ini (tak perlu handler GET tiruan).
//
// Endpoint ini TIDAK memakai requireAdmin(): pemanggilnya Xendit, bukan admin OMS. Satu-satunya
// pembeda callback asli vs palsu adalah header `x-callback-token` (Xendit tak menandatangani body),
// jadi token diverifikasi lebih dulu SEBELUM body dibaca.
//
// ── Kenapa DB di-UPDATE sebelum membalas 200, bukan "balas dulu lalu proses async" ──
// Di serverless (Vercel) proses dibekukan/dimatikan segera setelah response dikirim. Promise yang
// dibiarkan menggantung TIDAK dijamin selesai — akibatnya webhook membalas 200, DB tak pernah
// terupdate, dan Xendit TIDAK akan mengulang kirim karena sudah menerima 200. Pembayaran hilang
// tanpa jejak. Membuatnya benar-benar async butuh `waitUntil` dari `@vercel/functions`
// (dependency baru) atau queue. Update di sini cuma satu UPDATE ber-index (nomor_invoice unique),
// jauh di bawah batas waktu callback Xendit — jadi di-`await`.
//
// ── Kenapa hampir semua kegagalan tetap dibalas 200 ──
// Xendit mengulang kirim untuk respons non-2xx. Mengulang tak akan menolong kalau masalahnya
// permanen (invoice tak dikenal, status tak kita tangani) — yang terjadi hanya banjir retry.
// Status non-2xx disimpan untuk hal yang MEMANG layak diulang / harus diperbaiki:
//   401 token salah · 500 env belum di-set.

import { NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import {
  getOrderByOrderId,
  getOrderUuidByInvoice,
  updatePaymentStatus,
} from '@/lib/mock-db/orders'
import { restoreStock } from '@/lib/mock-db/products'
import { recordOrderStockChanges } from '@/lib/stock-audit'
import { bookShipmentForPaidOrder } from '@/lib/shipment-booking'
import {
  parseInvoiceCallback,
  resolvePaymentOutcome,
  verifyCallbackToken,
} from '@/lib/xendit/webhook'
import type { Order } from '@/types/order'

// createAdminClient (Supabase) + node:crypto butuh runtime Node.js, bukan Edge
export const runtime = 'nodejs'

// Prefix log seragam supaya mudah di-grep di log Vercel
const LOG = '[xendit-webhook]'

export async function POST(request: Request) {
  // 1) Token dulu, body belakangan — jangan pernah memproses payload yang belum terverifikasi.
  const check = verifyCallbackToken(request.headers.get('x-callback-token'))
  if (!check.ok) {
    if (check.reason === 'not-configured') {
      // Salah konfigurasi KITA, bukan request nakal → 500 supaya Xendit mengulang setelah env di-set.
      console.error(`${LOG} XENDIT_CALLBACK_TOKEN belum di-set di environment`)
      return NextResponse.json({ error: 'Webhook belum dikonfigurasi.' }, { status: 500 })
    }
    console.warn(`${LOG} ditolak: token ${check.reason}`)
    return NextResponse.json({ error: 'Token callback tidak valid.' }, { status: 401 })
  }

  // 2) Body
  let body: unknown
  try {
    body = await request.json()
  } catch {
    console.warn(`${LOG} body bukan JSON valid`)
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  const parsed = parseInvoiceCallback(body)
  if (!parsed) {
    // Bisa jadi callback jenis lain (disbursement, dll) yang belum kita tangani. Balas 200 agar
    // Xendit tidak mengulang terus-menerus untuk sesuatu yang memang bukan urusan endpoint ini.
    console.warn(`${LOG} payload tanpa external_id/status — dilewati`)
    return NextResponse.json({ received: true, handled: false, reason: 'UNSUPPORTED_PAYLOAD' })
  }

  console.log(
    `${LOG} masuk invoice=${parsed.invoice} status=${parsed.rawStatus} paid=${parsed.paidAmount}`,
  )

  // 3) Pesanan harus ada. Nominal tagihan dibaca dari DB, bukan dari payload.
  const order = await getOrderByOrderId(parsed.invoice)
  if (!order) {
    console.warn(`${LOG} invoice=${parsed.invoice} tak ditemukan di orders`)
    return NextResponse.json({ received: true, handled: false, reason: 'ORDER_NOT_FOUND' })
  }

  const outcome = resolvePaymentOutcome(parsed, order.totalAmount)

  // 4) Tindakan per hasil
  switch (outcome.kind) {
    case 'pending':
      console.log(`${LOG} invoice=${parsed.invoice} masih PENDING — tak ada perubahan`)
      return NextResponse.json({ received: true, handled: false, reason: 'STILL_PENDING' })

    case 'ignored':
      console.warn(`${LOG} invoice=${parsed.invoice} status tak dikenal: ${outcome.rawStatus}`)
      return NextResponse.json({ received: true, handled: false, reason: 'UNKNOWN_STATUS' })

    case 'underpaid':
      // JANGAN tandai Lunas. Barang bisa terkirim padahal uangnya kurang.
      console.error(
        `${LOG} invoice=${parsed.invoice} KURANG BAYAR: terbayar ${outcome.paidAmount} < tagihan ${outcome.expectedAmount} — pesanan dibiarkan, perlu ditinjau admin`,
      )
      return NextResponse.json({ received: true, handled: false, reason: 'AMOUNT_MISMATCH' })

    case 'paid':
      return handlePaid(order, parsed.invoice, parsed.transactionId)

    case 'failed':
      return handleFailed(order, parsed.invoice, parsed.transactionId)
  }
}

// === Pembayaran berhasil ===

async function handlePaid(order: Order, invoice: string, transactionId?: string) {
  // Idempoten: Xendit mengulang kirim callback yang sama. Kalau sudah Lunas, jangan sentuh apa pun —
  // menimpanya berpotensi menarik kembali status alur yang sudah maju (mis. sudah Dikirim → Diproses).
  if (order.paymentStatus === 'Lunas') {
    console.log(`${LOG} invoice=${invoice} sudah Lunas — dilewati (idempoten)`)
    return NextResponse.json({ received: true, handled: false, reason: 'ALREADY_PAID' })
  }
  // Pesanan yang sudah dibatalkan tak boleh berubah jadi Lunas oleh callback yang datang terlambat.
  // Uangnya perlu di-refund manual, bukan pesanannya dihidupkan kembali.
  if (order.status === 'Dibatalkan') {
    console.error(
      `${LOG} invoice=${invoice} PEMBAYARAN MASUK untuk pesanan yang sudah DIBATALKAN — perlu refund manual`,
    )
    return NextResponse.json({ received: true, handled: false, reason: 'ORDER_CANCELLED' })
  }

  const updated = await updatePaymentStatus(invoice, 'Lunas', {
    // Pembayaran terkonfirmasi → pesanan masuk antrean proses.
    orderStatus: 'Diproses',
    ...(transactionId ? { transactionId } : {}),
  })
  if (!updated) {
    // Gagal tulis DB LAYAK diulang → balas 500 supaya Xendit kirim lagi.
    console.error(`${LOG} invoice=${invoice} gagal menyimpan status Lunas`)
    return NextResponse.json({ error: 'Gagal memperbarui pesanan.' }, { status: 500 })
  }

  // Stok TIDAK disentuh: checkout sudah memotongnya saat pesanan dibuat (order PENDING = sudah
  // commit stok). Yang berubah hanya makna angka "terjual" bagi agregasi penjualan.
  revalidateTag('sales', 'max')
  revalidatePath('/oms/dashboard')

  console.log(`${LOG} invoice=${invoice} → Lunas / Diproses`)

  // Booking kurir dipicu di sini — inilah titik "pembayaran sukses".
  // `updated` (bukan `order`) yang dipakai: ia hasil baca ulang setelah status berubah, jadi
  // memuat data terkini. Kegagalan booking TIDAK mengubah balasan ke Xendit menjadi non-2xx:
  // pembayarannya memang sudah sah dan sudah tercatat: mengulang callback tak akan memperbaiki
  // alamat yang salah, dan retry berulang justru menumpuk percobaan booking.
  const shipment = await bookShipmentForPaidOrder(updated, LOG)

  return NextResponse.json({ received: true, handled: true, status: 'PAID', shipment })
}

// === Pembayaran kedaluwarsa / gagal ===

async function handleFailed(order: Order, invoice: string, transactionId?: string) {
  // Sudah dibatalkan sebelumnya (mis. oleh pembeli lewat /order-cancellation, atau callback
  // duplikat) → stok SUDAH dikembalikan. Mengembalikannya lagi akan menggelembungkan stok.
  if (order.status === 'Dibatalkan') {
    console.log(`${LOG} invoice=${invoice} sudah Dibatalkan — stok tak dikembalikan lagi`)
    return NextResponse.json({ received: true, handled: false, reason: 'ALREADY_CANCELLED' })
  }
  // Sudah lunas tapi datang callback EXPIRED (urutan callback tak dijamin) → jangan batalkan
  // pesanan yang sudah dibayar.
  if (order.paymentStatus === 'Lunas') {
    console.warn(`${LOG} invoice=${invoice} sudah Lunas, callback gagal/kedaluwarsa diabaikan`)
    return NextResponse.json({ received: true, handled: false, reason: 'ALREADY_PAID' })
  }

  const updated = await updatePaymentStatus(invoice, 'Gagal', {
    orderStatus: 'Dibatalkan',
    ...(transactionId ? { transactionId } : {}),
  })
  if (!updated) {
    console.error(`${LOG} invoice=${invoice} gagal menyimpan status Gagal`)
    return NextResponse.json({ error: 'Gagal memperbarui pesanan.' }, { status: 500 })
  }

  // WAJIB: lepaskan kembali stok yang sudah dipotong saat checkout. Tanpa ini stok bocor permanen
  // setiap kali invoice kedaluwarsa — barang tercatat habis padahal tak pernah terjual.
  // Pola identik dengan PATCH /api/orders/cancel.
  await restoreStock(
    order.items.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
      variantId: i.variantId ?? undefined,
    })),
    order.warehouseId,
  )

  // Riwayat mutasi: pelakunya SISTEM (webhook), bukan admin → `changed_by` dibiarkan kosong.
  const orderUuid = await getOrderUuidByInvoice(invoice)
  await recordOrderStockChanges({
    items: order.items.map((i) => ({
      productId: i.productId,
      ...(i.variantId ? { variantId: i.variantId } : {}),
      quantity: i.quantity,
    })),
    ...(order.warehouseId ? { warehouseId: order.warehouseId } : {}),
    orderInvoice: invoice,
    ...(orderUuid ? { orderId: orderUuid } : {}),
    direction: 'in',
  })

  // Stok kembali → segarkan cache storefront agar stok & jumlah terjual tampil akurat.
  revalidatePath('/')
  revalidatePath('/products')
  for (const i of order.items) revalidatePath(`/produk/${i.productId}`)
  revalidateTag('products', 'max')
  revalidateTag('sales', 'max')
  revalidatePath('/oms/dashboard')

  console.log(`${LOG} invoice=${invoice} → Gagal / Dibatalkan, stok dikembalikan`)
  return NextResponse.json({ received: true, handled: true, status: 'FAILED' })
}
