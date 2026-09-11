// src/app/api/oms/refunds/xendit/route.ts
// Mengembalikan dana pesanan lewat Xendit — otomatis, untuk pembayaran E-WALLET saja.
//
// ⚠️ INI MEMINDAHKAN UANG SUNGGUHAN dan tak bisa ditarik kembali. Satu-satunya endpoint di project
// ini yang melakukannya. Dijaga requireAdminRole (peran 'admin', bukan sekadar sesi valid).
//
// ── Urutannya: KLAIM DULU, BARU BAYAR (SEC-045) ──
// Versi pertama memeriksa `refundStatus` hasil query, memanggil Xendit, lalu baru menjalankan
// compare-and-swap saat menyimpan hasilnya. Itu pola baca-lalu-bertindak: pemeriksaannya memakai
// data yang dibaca beberapa ratus milidetik sebelumnya, dan dua permintaan kembar bisa sama-sama
// melewatinya lalu sama-sama mengirim uang. CAS-nya benar, tapi terpasang SESUDAH titik tak bisa
// kembali — yang kalah baru diberi tahu setelah uangnya terlanjur keluar.
//
// Sekarang barisnya diklaim (PERLU_REFUND → SEDANG_DIPROSES, atomik di database) SEBELUM Xendit
// disentuh. Yang kalah klaim berhenti tanpa memanggil apa pun. Kunci klaimnya sekaligus dikirim
// sebagai X-IDEMPOTENCY-KEY, jaring kedua bila permintaannya terkirim ulang di luar kendali kita.
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

import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireAdminRole, getAdminIdentity } from '@/lib/oms-guard'
import {
  getOrderByOrderId,
  claimRefundForProcessing,
  finalizeClaimedRefund,
  releaseRefundClaim,
} from '@/lib/mock-db/orders'
import { fetchInvoicePayment } from '@/lib/xendit/invoice'
import { pilihMetode, refundEwalletCharge } from '@/lib/xendit/ewallet-refund'
import { paymentMethodInfo } from '@/lib/payment-method'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Kegagalan yang membuktikan Xendit MENOLAK permintaannya — tak ada uang yang bergerak, jadi
// klaimnya aman dilepas dan barisnya boleh kembali menjadi pekerjaan.
//
// Sengaja daftar putih, bukan daftar hitam: alasan kegagalan baru yang belum pernah kita lihat
// akan MEMPERTAHANKAN klaim. Menahan pekerjaan yang sebenarnya masih perlu dikerjakan bisa
// diperbaiki admin; mengirim uang dua kali tidak.
const PENOLAKAN_PASTI = new Set(['http-error', 'not-ewallet', 'not-configured'])

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
    // Pemeriksaan MURAH, bukan pengaman. Ia memakai data yang sudah dibaca di atas, jadi dua
    // permintaan bersamaan bisa sama-sama melewatinya — yang menghentikan mereka adalah klaim
    // database di bawah. Gunanya di sini hanya memberi pesan yang jelas dan menghemat satu
    // panggilan baca ke Xendit untuk kasus yang jelas-jelas salah.
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

  // === KLAIM — pengaman yang sesungguhnya ===
  //
  // Dijalankan SEBELUM Xendit disentuh. Database yang memutuskan siapa yang menang, jadi berapa
  // pun permintaan yang tiba bersamaan hanya satu yang lolos ke bawah garis ini.
  const identity = await getAdminIdentity()
  const by = identity?.name?.trim() || 'admin'
  const claimReference = `claim-${randomUUID()}`

  const claimed = await claimRefundForProcessing(orderId, {
    reference: claimReference,
    by,
    amount: order.totalAmount,
    note: `Pengembalian lewat Xendit (${metode}) sedang dikirim — diklaim oleh ${by}`,
  })

  if (!claimed) {
    // Ada yang mendahului antara pemeriksaan di atas dan baris ini. Ia sedang (atau sudah)
    // mengirim uangnya; permintaan ini berhenti di sini tanpa memanggil Xendit sama sekali.
    console.warn(`[oms/refunds/xendit] ${orderId} klaim KALAH — permintaan kembar, tidak dikirim.`)
    return NextResponse.json(
      {
        error:
          'Pengembalian dana pesanan ini sedang diproses permintaan lain. JANGAN diulang — muat ulang halaman untuk melihat statusnya.',
        code: 'CLAIM_LOST',
      },
      { status: 409 },
    )
  }

  // === Titik tak bisa kembali ===
  const hasil = await refundEwalletCharge({
    chargeId: invoice.payment.paymentId,
    method: metode,
    reason: 'CANCELLATION',
    idempotencyKey: claimReference,
  })

  if (!hasil.ok) {
    // Ditolak dengan kode yang jelas → tak ada uang yang bergerak → klaimnya dilepas supaya
    // pesanan ini muncul lagi sebagai pekerjaan.
    //
    // Timeout & respons tak terbaca TIDAK dilepas: permintaannya bisa saja sampai dan diproses
    // setelah kita berhenti menunggu. Barisnya ditinggal SEDANG_DIPROSES — admin memeriksa
    // dashboard Xendit, lalu menutupnya manual. Itu memang merepotkan, dan jauh lebih murah
    // daripada mengundang transfer kedua untuk uang yang mungkin sudah keluar.
    const pasti = PENOLAKAN_PASTI.has(hasil.reason)
    if (pasti) await releaseRefundClaim(orderId, claimReference, `${hasil.reason} ${hasil.detail}`)

    console.error(
      `[oms/refunds/xendit] ${orderId} GAGAL (${metode}): ${hasil.reason} ${hasil.detail} — ` +
        (pasti
          ? 'klaim dilepas, kembali ke daftar kerja.'
          : `klaim DIPERTAHANKAN (ref ${claimReference}); uang mungkin terkirim, PERIKSA DASHBOARD.`),
    )
    return NextResponse.json(
      {
        error: `Pengembalian dana gagal (${metode}): ${hasil.detail}`,
        code: hasil.reason,
        metode,
        // Timeout TIDAK berarti uangnya tak terkirim — permintaannya bisa saja diproses setelah
        // kita berhenti menunggu. Admin harus MEMERIKSA, bukan mengulang.
        periksaDashboard: !pasti,
        ...(pasti ? {} : { reference: claimReference }),
      },
      { status: 502 },
    )
  }

  // ── Selesai, atau baru diterima? ──
  // `void` tuntas saat responsnya diterima. `refunds` ASINKRON: ia menjawab PENDING, dan hasil
  // sesungguhnya baru datang lewat callback refund.succeeded/refund.failed ~1 hari kerja kemudian.
  //
  // Menuliskan SUDAH_REFUND untuk keduanya — seperti versi pertama kode ini — berarti menyatakan
  // dana sudah kembali padahal masih diproses. Kalau kemudian gagal, tak seorang pun akan tahu:
  // barisnya sudah keluar dari setiap daftar.
  //
  // Hanya SUCCEEDED yang dianggap tuntas. Status apa pun selain itu (termasuk yang belum pernah
  // kita lihat) tetap SEDANG_DIPROSES — keadaan yang berkata "sudah dikirim, jangan diulang,
  // tapi belum dipastikan".
  const tuntas = hasil.status.toUpperCase() === 'SUCCEEDED'
  const note =
    `Dikembalikan lewat Xendit (${metode}) ke ${invoice.payment.channel || 'dompet asal'}` +
    (hasil.status ? ` — status ${hasil.status}` : '')

  const updated = await finalizeClaimedRefund(orderId, claimReference, {
    status: tuntas ? 'SUDAH_REFUND' : 'SEDANG_DIPROSES',
    note,
    reference: hasil.reference,
  })

  if (!updated) {
    // Uang sudah dikembalikan tapi hasilnya gagal dicatat. BEDA dari versi sebelumnya: barisnya
    // sudah berstatus SEDANG_DIPROSES sejak klaim, jadi ia TIDAK bisa dikembalikan dua kali —
    // yang hilang hanya catatan penutupnya, bukan pagarnya.
    console.error(
      `[oms/refunds/xendit] ${orderId} UANG SUDAH DIKEMBALIKAN (${metode}, ref ${hasil.reference || claimReference}) ` +
        'TAPI HASILNYA GAGAL DICATAT — baris tetap SEDANG_DIPROSES, tutup manual setelah dicek.',
    )
    return NextResponse.json(
      {
        error:
          'Dana SUDAH dikembalikan, tapi hasilnya gagal dicatat. Pesanan ini terkunci sebagai "sedang diproses" sehingga tak akan terkirim dua kali — tutup manual lewat "Catat pengembalian" setelah dicek di dashboard.',
        code: 'REFUNDED_BUT_NOT_SAVED',
        reference: hasil.reference || claimReference,
      },
      { status: 500 },
    )
  }

  console.log(
    `[oms/refunds/xendit] ${orderId} ${metode} ref=${hasil.reference || claimReference} status=${hasil.status} → ${tuntas ? 'SUDAH_REFUND' : 'SEDANG_DIPROSES'} oleh ${by}`,
  )
  return NextResponse.json({
    success: true,
    metode,
    reference: hasil.reference || claimReference,
    status: hasil.status,
    tuntas,
    // Dibedakan supaya UI bisa berkata jujur: "sudah kembali" vs "sedang diproses". Menyamakan
    // keduanya di layar akan membuat admin menjanjikan ke pembeli sesuatu yang belum pasti.
    pesan: tuntas
      ? 'Dana sudah dikembalikan.'
      : `Permintaan diterima Xendit (${hasil.status}). Hasilnya menyusul lewat callback, biasanya 1 hari kerja. JANGAN diulang.`,
    order: updated,
  })
}
