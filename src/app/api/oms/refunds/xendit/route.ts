// src/app/api/oms/refunds/xendit/route.ts
// Mengembalikan dana pesanan lewat Xendit — otomatis, untuk pembayaran E-WALLET saja.
//
// ⚠️ INI MEMINDAHKAN UANG SUNGGUHAN dan tak bisa ditarik kembali. Satu-satunya endpoint di project
// ini yang melakukannya. Dijaga requireAdminRole (peran 'admin', bukan sekadar sesi valid).
//
// ── Kenapa hanya e-wallet ──
// Terverifikasi 2026-09-10: pembayaran lewat Virtual Account / transfer bank TIDAK BISA di-refund
// Xendit sama sekali — tidak lewat API, tidak lewat dashboard. Pengembaliannya adalah transfer BARU
// ke rekening pembeli, dijalankan manusia, dan dicatat lewat PATCH /api/oms/refunds.
//
// ── Kenapa TIDAK otomatis saat pembatalan ──
// Bisa saja disambungkan ke alur pembatalan seperti penghapusan penjemputan Mengantar. Sengaja
// tidak, setidaknya untuk versi pertama:
//   1. Penghapusan penjemputan membatalkan pembelian jasa milik TOKO SENDIRI. Ini mengirim uang ke
//      ORANG LAIN — kelas risiko yang berbeda, dan pantas dimulai satu tombol satu keputusan.
//   2. Separuh pembatalan (transfer bank) tetap menuntut manusia. Membuat separuhnya otomatis dan
//      separuhnya manual di alur yang sama justru membuat admin tak tahu mana yang sudah beres.
//   3. Perilaku kedua endpoint Xendit ini belum pernah kita lihat sekali pun.
// Setelah terbukti, penyambungannya ke pembatalan tinggal satu pemanggilan.
//
//   POST { orderId }              → kembalikan dana
//   POST { orderId, dryRun: true} → tampilkan charge id & metode yang AKAN dipakai, tanpa memanggil

import { NextResponse } from 'next/server'
import { requireAdminRole, getAdminIdentity } from '@/lib/oms-guard'
import { getOrderByOrderId, resolveRefund } from '@/lib/mock-db/orders'
import { fetchInvoicePayment } from '@/lib/xendit/invoice'
import { pilihMetode, refundEwalletCharge } from '@/lib/xendit/ewallet-refund'
import { paymentMethodInfo } from '@/lib/payment-method'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(request: Request) {
  const denied = await requireAdminRole('Akun Anda tidak berwenang mengembalikan dana.')
  if (denied) return denied

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  const orderId = typeof body.orderId === 'string' ? body.orderId.trim().replace(/^#/, '') : ''
  const dryRun = body.dryRun === true
  if (!orderId) return NextResponse.json({ error: 'orderId wajib ada.' }, { status: 400 })

  const order = await getOrderByOrderId(orderId)
  if (!order) {
    return NextResponse.json({ error: `Pesanan ${orderId} tidak ditemukan.` }, { status: 404 })
  }

  // === Pagar, berurutan dari yang paling murah ===

  if (order.refundStatus !== 'PERLU_REFUND') {
    // Termasuk yang sudah SUDAH_REFUND. Menolak di sini adalah pertahanan utama terhadap
    // pengembalian ganda — uang yang terkirim dua kali tak bisa ditarik.
    return NextResponse.json(
      {
        error: `Pesanan ini tidak sedang menunggu pengembalian dana (status: ${order.refundStatus ?? 'tidak ditandai'}).`,
        code: 'NOT_PENDING',
      },
      { status: 409 },
    )
  }

  const info = paymentMethodInfo(order.paymentMethod)
  if (info?.family === 'transfer-bank') {
    return NextResponse.json(
      {
        error: `Pembayaran ${info.channel} tidak bisa dikembalikan lewat Xendit. Transfer manual ke rekening pembeli, lalu catat lewat tombol "Catat pengembalian".`,
        code: 'BANK_TRANSFER',
      },
      { status: 422 },
    )
  }

  if (!order.transactionId) {
    return NextResponse.json(
      { error: 'Pesanan ini tak punya id tagihan Xendit — kembalikan manual.', code: 'NO_INVOICE' },
      { status: 422 },
    )
  }

  // === Ambil id pembayarannya ===
  //
  // `orders.id_transaksi` adalah id TAGIHAN; yang dibutuhkan pengembalian dana adalah id
  // PEMBAYARAN — nomor berbeda yang tak pernah kita simpan. Dibaca segar dari Xendit; ini
  // panggilan baca, tak memindahkan apa pun.
  const invoice = await fetchInvoicePayment(order.transactionId)
  if (!invoice.ok) {
    return NextResponse.json(
      { error: `Gagal membaca tagihan di Xendit: ${invoice.detail}`, code: 'INVOICE_READ_FAILED' },
      { status: 502 },
    )
  }

  const metode = pilihMetode(invoice.payment.paidAt)

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      catatan: 'Tidak ada panggilan pengembalian dana. Ulangi tanpa dryRun untuk menjalankannya.',
      orderId,
      chargeId: invoice.payment.paymentId,
      channel: invoice.payment.channel,
      paidAt: invoice.payment.paidAt,
      metode,
      alasanMetode:
        metode === 'void'
          ? 'Dibayar hari ini sebelum batas 23:40 WIB → void (penuh, hampir seketika).'
          : 'Bukan hari yang sama (atau sudah lewat batas) → refunds (~1 hari kerja).',
      jumlah: order.totalAmount,
    })
  }

  // === Titik tak bisa kembali ===
  const hasil = await refundEwalletCharge({
    chargeId: invoice.payment.paymentId,
    method: metode,
    reason: 'CANCELLATION',
  })

  if (!hasil.ok) {
    console.error(`[oms/refunds/xendit] ${orderId} GAGAL (${metode}): ${hasil.reason} ${hasil.detail}`)
    return NextResponse.json(
      {
        error: `Pengembalian dana gagal (${metode}): ${hasil.detail}`,
        code: hasil.reason,
        metode,
        // Timeout TIDAK berarti uangnya tak terkirim — permintaannya bisa saja diproses setelah
        // kita berhenti menunggu. Admin harus MEMERIKSA, bukan mengulang.
        periksaDashboard: hasil.reason === 'network' || hasil.reason === 'bad-shape',
      },
      { status: 502 },
    )
  }

  // Uang SUDAH terkirim pada titik ini. Kegagalan menyimpan di bawah tidak menariknya kembali —
  // karena itu dicatat sekeras mungkin bila terjadi.
  const identity = await getAdminIdentity()
  const by = identity?.name?.trim() || 'admin'
  const note =
    `Dikembalikan otomatis lewat Xendit (${metode}) ke ${invoice.payment.channel || 'dompet asal'}` +
    (hasil.status ? ` — status ${hasil.status}` : '')

  const updated = await resolveRefund(orderId, {
    status: 'SUDAH_REFUND',
    amount: order.totalAmount,
    note,
    by,
    ...(hasil.reference ? { reference: hasil.reference } : {}),
  })

  if (!updated) {
    console.error(
      `[oms/refunds/xendit] ${orderId} UANG SUDAH DIKEMBALIKAN (${metode}, ref ${hasil.reference || '-'}) ` +
        'TAPI GAGAL DICATAT — tandai manual supaya tak dikembalikan dua kali.',
    )
    return NextResponse.json(
      {
        error:
          'Dana SUDAH dikembalikan, tapi gagal dicatat. JANGAN ulangi — tandai manual lewat "Catat pengembalian".',
        code: 'REFUNDED_BUT_NOT_SAVED',
        reference: hasil.reference,
      },
      { status: 500 },
    )
  }

  console.log(
    `[oms/refunds/xendit] ${orderId} dikembalikan ${metode} ref=${hasil.reference || '-'} oleh ${by}`,
  )
  return NextResponse.json({
    success: true,
    metode,
    reference: hasil.reference,
    status: hasil.status,
    order: updated,
  })
}
