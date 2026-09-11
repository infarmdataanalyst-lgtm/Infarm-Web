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
  settleRefundByReference,
  updatePaymentStatus,
} from '@/lib/mock-db/orders'
import { expireOrder, revalidateAfterExpiry } from '@/lib/order-expiry'
import { bookShipmentForPaidOrder } from '@/lib/shipment-booking'
import {
  parseXenditCallback,
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

  // 2b) Callback PENGEMBALIAN DANA — diperiksa SEBELUM parser invoice.
  //
  // Bentuknya berbeda total dari callback invoice: ia dibungkus `{ event, data: {...} }` dan TIDAK
  // memuat `external_id` kita sama sekali. Tanpa cabang ini ia akan jatuh ke `UNSUPPORTED_PAYLOAD`
  // dan hasil pengembalian dana tak pernah sampai ke pesanan mana pun — baris SEDANG_DIPROSES
  // menggantung selamanya.
  const refund = parseRefundCallback(body)
  if (refund) return handleRefundCallback(refund)

  const parsed = parseXenditCallback(body)
  if (!parsed) {
    // Bisa jadi callback jenis lain (disbursement, dll) yang belum kita tangani. Balas 200 agar
    // Xendit tidak mengulang terus-menerus untuk sesuatu yang memang bukan urusan endpoint ini.
    console.warn(`${LOG} payload tanpa external_id/reference_id/status — dilewati`)
    return NextResponse.json({ received: true, handled: false, reason: 'UNSUPPORTED_PAYLOAD' })
  }

  console.log(
    `${LOG} masuk invoice=${parsed.invoice} status=${parsed.rawStatus} paid=${parsed.paidAmount} bentuk=${parsed.source}`,
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
      return handlePaid(order, parsed.invoice, parsed.transactionId, parsed.paymentMethod)

    case 'failed':
      return handleFailed(order, parsed.invoice, parsed.transactionId)
  }
}

// === Callback pengembalian dana ===
//
// Bentuk terdokumentasi (docs.xendit.co → refund webhook notification):
//   { "event": "refund.succeeded" | "refund.failed",
//     "data": { "id": "rfd-…", "payment_id": "ewc-…", "status": "SUCCEEDED"|"FAILED"|…,
//               "amount": "10000", "channel_code": "SHOPEEPAY", "failure_code": null, … } }
//
// ⚠️ TIDAK memuat `external_id` — jadi nomor invoice kita tak ada di mana pun di payload ini.
// Penghubung satu-satunya adalah nomor referensi yang kita simpan saat pengembalian dimulai.
type RefundCallback = {
  event: string
  /** `data.id` — nomor referensi pengembalian. */
  id: string
  /** `data.payment_id` — id charge aslinya (`ewc_…`). Cadangan pencocokan. */
  paymentId: string
  status: string
  detail: string
}

function asText(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''
}

// null = bukan callback pengembalian dana. Pengenalannya lewat `event` yang berawalan 'refund.',
// BUKAN lewat ada-tidaknya field tertentu: callback lain juga punya `data` dan `status`, dan
// menebak dari bentuk akan membuat callback asing tak sengaja diperlakukan sebagai pengembalian.
function parseRefundCallback(body: unknown): RefundCallback | null {
  if (typeof body !== 'object' || body === null) return null
  const root = body as Record<string, unknown>
  const event = asText(root.event)
  if (!event.toLowerCase().startsWith('refund.')) return null

  const data =
    typeof root.data === 'object' && root.data !== null
      ? (root.data as Record<string, unknown>)
      : {}

  return {
    event,
    id: asText(data.id),
    paymentId: asText(data.payment_id),
    status: asText(data.status),
    detail: [asText(data.status), asText(data.failure_code)].filter(Boolean).join(' / '),
  }
}

async function handleRefundCallback(refund: RefundCallback) {
  console.log(
    `${LOG} callback ${refund.event} ref=${refund.id || '-'} charge=${refund.paymentId || '-'} status=${refund.status || '-'}`,
  )

  // Keberhasilan ditentukan `data.status`, bukan nama event-nya. Keduanya hampir selalu sepakat,
  // tapi `status` adalah nilai yang didokumentasikan punya himpunan tertutup
  // (SUCCEEDED/FAILED/PENDING/CANCELLED) sementara nama event bisa bertambah kapan saja.
  const status = refund.status.toUpperCase()

  if (status === 'PENDING') {
    // Belum ada yang bisa disimpulkan. Barisnya memang sudah SEDANG_DIPROSES.
    return NextResponse.json({ received: true, handled: false, reason: 'REFUND_STILL_PENDING' })
  }

  const berhasil = status === 'SUCCEEDED'
  if (!berhasil && status !== 'FAILED' && status !== 'CANCELLED') {
    // Status di luar himpunan yang dikenal — JANGAN menebak. Menebaknya "berhasil" akan menutup
    // pekerjaan yang belum selesai; menebaknya "gagal" akan menyuruh admin mengirim ulang uang
    // yang mungkin sudah terkirim.
    console.error(`${LOG} status refund tak dikenal: ${refund.status} (ref ${refund.id})`)
    return NextResponse.json({ received: true, handled: false, reason: 'UNKNOWN_REFUND_STATUS' })
  }

  // Dicoba dengan `data.id` lebih dulu, lalu `data.payment_id`. Dokumentasi menyebut respons
  // pengembalian eWallet mengembalikan id ber-awalan `ewc_`, sedangkan contoh callback-nya
  // memakai `rfd-` — belum terbukti mana yang tersimpan di refund_reference kita. Mencoba
  // keduanya menutup ketidakpastian itu tanpa menebak salah satunya.
  const kandidat = [refund.id, refund.paymentId].filter(Boolean)
  for (const ref of kandidat) {
    const hasil = await settleRefundByReference(ref, berhasil, refund.detail || status)
    if (hasil) {
      console.log(
        `${LOG} refund ${hasil.orderId} → ${berhasil ? 'SUDAH_REFUND' : 'PERLU_REFUND (gagal, perlu diulang)'}`,
      )
      return NextResponse.json({ received: true, handled: true, orderId: hasil.orderId })
    }
  }

  // Tak cocok dengan baris mana pun: pengembalian yang bukan dimulai dari OMS ini (mis. dijalankan
  // langsung di dashboard Xendit), atau callback kembar yang barisnya sudah ditutup. Keduanya
  // normal — dibalas 200 supaya Xendit berhenti mengulang.
  console.warn(`${LOG} callback refund tak cocok dengan pesanan mana pun (ref ${kandidat.join(', ') || '-'})`)
  return NextResponse.json({ received: true, handled: false, reason: 'REFUND_NOT_MATCHED' })
}

// === Pembayaran berhasil ===

// `paymentMethod` HANYA ada di jalur ini — inilah satu-satunya titik di mana metode bayar bisa
// tercatat. Pembeli memilihnya di halaman Xendit, jadi saat tagihan diterbitkan kita belum tahu
// apa pun (lihat api/payments/invoice/route.ts), dan callback gagal/kedaluwarsa tak membawanya
// karena tak pernah ada yang dibayar.
async function handlePaid(
  order: Order,
  invoice: string,
  transactionId?: string,
  paymentMethod?: string,
) {
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
    ...(paymentMethod ? { paymentMethod } : {}),
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

  console.log(
    `${LOG} invoice=${invoice} → Lunas / Diproses metode=${paymentMethod ?? 'tak disebut callback'}`,
  )

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
  // Penutupan pesanan & pelepasan stok TIDAK ditulis di sini melainkan di expireOrder, karena
  // penyapu terjadwal (cron/expire-orders) harus melakukan hal yang sama persis. Callback ini
  // jalur tercepat, bukan satu-satunya — dan dua jalur yang menyalin logika stok cepat atau
  // lambat akan menyimpang.
  const outcome = await expireOrder(order, invoice, 'webhook', transactionId)

  if (!outcome.ok) {
    return NextResponse.json({ error: 'Gagal memperbarui pesanan.' }, { status: 500 })
  }
  if (!outcome.released) {
    return NextResponse.json({ received: true, handled: false, reason: outcome.reason })
  }

  // Stok kembali → segarkan cache storefront agar stok & jumlah terjual tampil akurat.
  revalidateAfterExpiry(order.items.map((i) => i.productId))

  return NextResponse.json({ received: true, handled: true, status: 'FAILED' })
}
