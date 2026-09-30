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
  fillPaymentMethodIfEmpty,
} from '@/lib/mock-db/orders'
import { expireOrder, revalidateAfterExpiry } from '@/lib/order-expiry'
import { getCachedProducts } from '@/lib/mock-db/cached-reads'
import { sendPurchaseEvent, type ProductMeta } from '@/lib/analytics-server'
import { bookShipmentForPaidOrder } from '@/lib/shipment-booking'
import {
  isLegacyInvoiceCallback,
  parseXenditCallback,
  resolvePaymentOutcome,
  verifyCallbackToken,
} from '@/lib/xendit/webhook'
import {
  callbackEventName,
  parseRefundCallback,
  type RefundCallback,
} from '@/lib/xendit/refund-callback'
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
    // Bisa jadi callback jenis lain (payout, payment_token, dll) yang belum kita tangani. Balas 200
    // agar Xendit tidak mengulang terus-menerus untuk sesuatu yang memang bukan urusan endpoint ini.
    // Nama event ikut dicatat: callback refund eWallet pertama (2026-09-14) dulu lenyap di sini
    // dengan pesan yang tak menyebut event-nya — padahal nama itu saja sudah cukup untuk langsung
    // menemukan penyebabnya. Aman dicatat: token callback sudah diverifikasi di langkah 1.
    const eventName = callbackEventName(body)
    if (isLegacyInvoiceCallback(body)) {
      // Invoice API v2 dilepas 2026-09-28. Callback seperti ini berarti masih ada tagihan lama
      // (dari masa uji) yang beredar di akun Xendit — bukan pembayaran pembeli sungguhan.
      console.warn(`${LOG} callback Invoice API v2 LAMA diabaikan (jalur sudah dilepas)`)
      return NextResponse.json({ received: true, handled: false, reason: 'LEGACY_INVOICE_CALLBACK' })
    }
    console.warn(
      `${LOG} payload tak dikenali${eventName ? ` (event=${eventName})` : ''} — tanpa data.reference_id/status, dilewati`,
    )
    return NextResponse.json({
      received: true,
      handled: false,
      reason: 'UNSUPPORTED_PAYLOAD',
      ...(eventName ? { event: eventName } : {}),
    })
  }

  console.log(
    `${LOG} masuk invoice=${parsed.invoice} event=${parsed.event} status=${parsed.rawStatus} paid=${parsed.paidAmount} bentuk=${parsed.source}`,
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

    case 'attempt-failed':
      // Satu PERCOBAAN bayar gagal (`payment.failure`), tapi sesinya masih hidup dan pembeli bisa
      // mencoba metode lain. Pesanan & stok TIDAK disentuh — yang menutup pesanan hanya
      // `payment_session.expired` (atau penyapu cron). Lihat catatan di lib/xendit/webhook.ts.
      console.log(`${LOG} invoice=${parsed.invoice} percobaan bayar gagal (${parsed.rawStatus}) — sesi masih hidup, tak ada perubahan`)
      return NextResponse.json({ received: true, handled: false, reason: 'ATTEMPT_FAILED' })

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
// Pengenalan dan pemetaan field-nya ada di src/lib/xendit/refund-callback.ts — modul murni yang bisa
// diuji dengan payload sungguhan tanpa menjalankan server. Dipindah dari sini setelah 2026-09-14
// terbukti bentuk yang ditulis dari dokumentasi tak cocok dengan callback yang benar-benar dikirim.
//
// ⚠️ `data.reference_id` di callback refund adalah referensi yang KITA kirim saat meminta refund
// (nomor invoice) — tapi pencocokannya sengaja tetap lewat refund_reference: refund yang dimulai
// dari dashboard Xendit tak membawa reference_id kita, dan satu pesanan hanya boleh ditutup oleh
// refund yang memang diklaim OMS.

async function handleRefundCallback(refund: RefundCallback) {
  console.log(
    `${LOG} callback ${refund.event} ref=${refund.id || '-'} pr=${refund.paymentRequestId || '-'} py=${refund.paymentId || '-'} status=${refund.status || '-'}`,
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

  // Dicoba dengan nomor refund (`data.id`) lebih dulu, lalu payment_request_id, lalu payment_id.
  //
  // Semuanya perlu karena isi refund_reference BERGANTI selama prosesnya: saat diklaim ia berisi
  // `pr-…` (sudah diketahui sebelum Xendit dipanggil), lalu ditimpa nomor refund `rfd-…` begitu
  // balasan HTTP Xendit diterima. Callback yang tiba sesudah pergantian itu cocok lewat nomor
  // refund; yang tiba SEBELUMNYA hanya bisa cocok lewat payment_request_id. payment_id cadangan
  // terakhir bila suatu saat Xendit hanya menyertakan itu.
  const kandidat = [refund.id, refund.paymentRequestId, refund.paymentId].filter(Boolean)
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
    // Satu-satunya pengecualian: metode bayar. `payment_session.completed` bisa tiba lebih dulu
    // dan menandai Lunas tanpa `channel_code`; `payment.capture` yang menyusul membawanya.
    // Hanya kolom itu yang diisi, dan hanya bila masih kosong — status tetap tak disentuh.
    if (paymentMethod && !order.paymentMethod) {
      const filled = await fillPaymentMethodIfEmpty(invoice, paymentMethod)
      console.log(
        `${LOG} invoice=${invoice} sudah Lunas — ${filled ? `metode=${paymentMethod} dilengkapi` : 'metode tak jadi diisi'}`,
      )
      return NextResponse.json({ received: true, handled: filled, reason: 'ALREADY_PAID' })
    }
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

  // === GA4 purchase ===
  //
  // Dikirim DI SINI dan tak di tempat lain. Ini satu-satunya titik yang tahu uangnya benar-benar
  // masuk, dan halaman sukses bukan penggantinya: pembayaran VA/QRIS sering lunas berjam-jam
  // kemudian tanpa pembeli pernah kembali ke sana.
  //
  // Idempoten karena posisinya: callback kembar sudah berhenti di cabang ALREADY_PAID jauh di
  // atas, jadi baris ini hanya tercapai pada perpindahan status yang BERHASIL — sekali per
  // pesanan. `transaction_id` di payload jadi lapis keduanya.
  //
  // SETELAH booking kurir, bukan sebelum: keduanya di-await sebelum membalas Xendit, dan yang
  // menyangkut paket sungguhan berhak jalan lebih dulu. Kegagalan di sini tak mengubah balasan —
  // pembayarannya sah dan sudah tercatat apa pun kata Google.
  await sendPurchaseEvent(updated, await productMetaFor(updated), LOG)

  return NextResponse.json({ received: true, handled: true, status: 'PAID', shipment })
}

// SKU & kategori tiap produk dalam pesanan — keduanya TIDAK tersimpan di order_items.
//
// SKU-nya yang penting: halaman detail produk mengirim `sku || id` sebagai item_id GA4, jadi
// purchase harus memakai aturan yang sama atau GA4 mencatat barang yang sama sebagai dua item
// berbeda, dan funnel view_item → purchase putus di langkah terakhir.
//
// Dibaca dari cache storefront yang memang sudah hangat (tag `products`), jadi ini bukan
// perjalanan tambahan ke database pada jalur webhook.
async function productMetaFor(order: Order): Promise<Map<string, ProductMeta>> {
  const meta = new Map<string, ProductMeta>()
  try {
    const dibutuhkan = new Set(order.items.map((it) => it.productId))
    for (const product of await getCachedProducts()) {
      if (!dibutuhkan.has(product.id)) continue
      meta.set(product.id, { sku: product.sku, category: product.category })
    }
  } catch (e) {
    // Gagal membaca produk TIDAK boleh membatalkan pengiriman event: payload tetap terkirim
    // dengan item_id jatuh ke productId. Laporannya jadi kurang rapi, bukan hilang.
    console.error(`${LOG} gagal membaca SKU produk untuk GA4:`, e instanceof Error ? e.message : e)
  }
  return meta
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
