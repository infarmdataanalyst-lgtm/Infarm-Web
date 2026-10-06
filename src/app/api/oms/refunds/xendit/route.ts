// src/app/api/oms/refunds/xendit/route.ts
// Mengembalikan dana pesanan lewat Xendit — otomatis, untuk kanal yang bisa dikembalikan ke
// sumbernya (e-wallet, QRIS, direct debit, kartu).
//
// ⚠️ INI MEMINDAHKAN UANG SUNGGUHAN dan tak bisa ditarik kembali. Satu-satunya endpoint di project
// ini yang melakukannya. Dijaga requireAdminRole (peran 'admin', bukan sekadar sesi valid).
//
// ── Urutannya: KLAIM DULU, BARU BAYAR (SEC-045) ──
// Versi pertama memeriksa `refundStatus` hasil query, memanggil Xendit, lalu baru menjalankan
// compare-and-swap saat menyimpan hasilnya. Itu pola baca-lalu-bertindak: dua permintaan kembar
// bisa sama-sama melewatinya lalu sama-sama mengirim uang. Sekarang barisnya diklaim
// (PERLU_REFUND → SEDANG_DIPROSES, atomik di database) SEBELUM Xendit disentuh. Yang kalah klaim
// berhenti tanpa memanggil apa pun. Klaim menyimpan `payment_request_id` (`pr-…`) yang juga
// dibawa callback, dan setiap percobaan mengirim kunci idempotency acak sebagai jaring kedua.
//
// ── Kenapa transfer bank / VA ditolak di sini ──
// Xendit tidak bisa me-refund VA (403 REFUND_NOT_SUPPORTED). Pengembaliannya adalah payout BARU
// ke rekening pembeli — sementara dijalankan manusia dari dashboard dan dicatat lewat
// PATCH /api/oms/refunds; otomatisasinya lewat Payouts API dijadwalkan terpisah.
//
// ── Kenapa TIDAK otomatis saat pembatalan ──
// Mengirim uang ke ORANG LAIN adalah kelas risiko yang berbeda dari membatalkan jasa milik toko
// sendiri (penjemputan Mengantar), dan separuh pembatalan (VA) tetap menuntut manusia. Satu tombol,
// satu keputusan. Setelah terbukti, penyambungannya ke pembatalan tinggal satu pemanggilan.
//
//   POST { orderId }              → kembalikan dana
//   POST { orderId, dryRun: true} → tampilkan id yang AKAN dipakai, tanpa memanggil

import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireAdminRole, getAdminIdentity } from '@/lib/oms-guard'
import {
  getOrderByOrderId,
  claimRefundForProcessing,
  finalizeClaimedRefund,
  releaseRefundClaim,
} from '@/lib/mock-db/orders'
import { fetchSessionPayment } from '@/lib/xendit/session'
import { refundPaymentRequest } from '@/lib/xendit/refund'
import { paymentMethodInfo } from '@/lib/payment-method'
import { normalizeInvoiceId } from '@/lib/invoice-id'
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { reportRefundToGa } from '@/lib/ga-refund'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Label mekanisme untuk respons & catatan. Hanya ada SATU jalur sejak Payments v3 (dulu ada
// `void` untuk hari yang sama dan `refunds` untuk H+1); dipertahankan sebagai field supaya UI
// yang membacanya tak perlu berubah.
const METODE = 'refund'

// Kegagalan yang membuktikan Xendit MENOLAK permintaannya — tak ada uang yang bergerak, jadi
// klaimnya aman dilepas dan barisnya boleh kembali menjadi pekerjaan.
//
// Sengaja daftar putih, bukan daftar hitam: alasan kegagalan baru yang belum pernah kita lihat
// akan MEMPERTAHANKAN klaim. Menahan pekerjaan yang sebenarnya masih perlu dikerjakan bisa
// diperbaiki admin; mengirim uang dua kali tidak.
const PENOLAKAN_PASTI = new Set(['http-error', 'not-refundable', 'not-configured'])

export async function POST(request: Request) {
  const denied = await requireAdminRole('Akun Anda tidak berwenang mengembalikan dana.')
  if (denied) return denied

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  // Bentuknya divalidasi, bukan sekadar dirapikan (SEC-052): nilai ini masuk ke console.log apa
  // adanya, dan log inilah yang dipakai menginvestigasi ke mana uang pergi.
  const orderId = normalizeInvoiceId(body.orderId)
  const dryRun = body.dryRun === true
  if (!orderId) {
    return NextResponse.json({ error: 'orderId wajib ada dan berbentuk nomor invoice.' }, { status: 400 })
  }

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
      { error: 'Pesanan ini tak punya id sesi pembayaran Xendit — kembalikan manual.', code: 'NO_INVOICE' },
      { status: 422 },
    )
  }

  // === Ambil id payment request-nya ===
  //
  // `orders.id_transaksi` adalah id SESI; yang dituntut POST /refunds adalah `payment_request_id`
  // — nomor berbeda yang tak pernah kita simpan. Dibaca segar dari Xendit; ini panggilan baca,
  // tak memindahkan apa pun.
  const session = await fetchSessionPayment(order.transactionId)
  if (!session.ok) {
    return NextResponse.json(
      { error: `Gagal membaca sesi pembayaran di Xendit: ${session.detail}`, code: 'INVOICE_READ_FAILED' },
      { status: 502 },
    )
  }

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      catatan: 'Tidak ada panggilan pengembalian dana. Ulangi tanpa dryRun untuk menjalankannya.',
      orderId,
      sessionId: order.transactionId,
      paymentRequestId: session.payment.paymentRequestId,
      paymentId: session.payment.paymentId,
      sessionStatus: session.payment.sessionStatus,
      metode: METODE,
      jumlah: order.totalAmount,
    })
  }

  // === KLAIM — pengaman yang sesungguhnya ===
  //
  // Dijalankan SEBELUM Xendit disentuh. Database yang memutuskan siapa yang menang, jadi berapa
  // pun permintaan yang tiba bersamaan hanya satu yang lolos ke bawah garis ini.
  const identity = await getAdminIdentity()
  const by = identity?.name?.trim() || 'admin'

  // === Pembatas laju (SEC-051) ===
  //
  // Diletakkan SETELAH cabang dryRun dengan sengaja: dryRun tak memindahkan apa pun, dan memakan
  // jatah hanya karena admin memeriksa keadaan akan membuatnya berhenti memeriksa.
  //
  // Dua kunci, tak satu pun IP — yang dibatasi adalah wewenang si admin dan uang si pesanan,
  // bukan lokasi jaringan yang murah diganti.
  const batasAdmin = enforceRateLimit(
    `refund-exec:admin:${identity?.id ?? 'tanpa-id'}`,
    RATE_LIMITS.REFUND_EXECUTE_ADMIN,
  )
  if (batasAdmin) return batasAdmin

  const batasInvoice = enforceRateLimit(
    `refund-exec:invoice:${orderId}`,
    RATE_LIMITS.REFUND_EXECUTE_INVOICE,
  )
  if (batasInvoice) return batasInvoice

  // === Isi klaim: payment_request_id, BUKAN kunci acak ===
  //
  // refund_reference menyimpan `pr-…` saat klaim. Nilai itu sudah diketahui SEBELUM Xendit
  // dipanggil, dan Xendit menyebutnya kembali di callback sebagai `data.payment_request_id` — jadi
  // callback yang tiba sebelum balasan HTTP-nya sampai ke server kita tetap bisa menemukan
  // barisnya. Nomor refund (`rfd-…`) menimpanya di finalizeClaimedRefund begitu balasan itu
  // diterima; callback mencoba keduanya.
  //
  // Kunci idempotency SENGAJA dipisah dan tetap acak per percobaan. Kalau disamakan dengan
  // payment_request_id, percobaan kedua yang sah setelah penolakan pasti akan dijawab Xendit dengan
  // hasil penolakan yang sama dari cache idempotency-nya.
  const claimReference = session.payment.paymentRequestId
  const idempotencyKey = `refund-${randomUUID()}`

  const claimed = await claimRefundForProcessing(orderId, {
    reference: claimReference,
    by,
    amount: order.totalAmount,
    note: `Pengembalian lewat Xendit sedang dikirim — diklaim oleh ${by}`,
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
  const hasil = await refundPaymentRequest({
    paymentRequestId: session.payment.paymentRequestId,
    reason: 'CANCELLATION',
    referenceId: orderId,
    idempotencyKey,
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
      `[oms/refunds/xendit] ${orderId} GAGAL: ${hasil.reason} ${hasil.errorCode ?? ''} ${hasil.detail} — ` +
        (pasti
          ? 'klaim dilepas, kembali ke daftar kerja.'
          : `klaim DIPERTAHANKAN (ref ${claimReference}); uang mungkin terkirim, PERIKSA DASHBOARD.`),
    )
    return NextResponse.json(
      {
        error:
          hasil.reason === 'not-refundable'
            ? `Xendit menolak: kanal pembayaran ini tidak bisa dikembalikan lewat API (${hasil.errorCode ?? hasil.detail}). Kembalikan manual, lalu catat lewat "Catat pengembalian".`
            : `Pengembalian dana gagal: ${hasil.detail}`,
        code: hasil.reason,
        metode: METODE,
        // Timeout TIDAK berarti uangnya tak terkirim — permintaannya bisa saja diproses setelah
        // kita berhenti menunggu. Admin harus MEMERIKSA, bukan mengulang.
        periksaDashboard: !pasti,
        ...(pasti ? {} : { reference: claimReference }),
      },
      { status: hasil.reason === 'not-refundable' ? 422 : 502 },
    )
  }

  // ── Selesai, atau baru diterima? ──
  // `POST /refunds` bisa menjawab SUCCEEDED (tuntas) atau PENDING (asinkron; hasil sesungguhnya
  // lewat callback refund.succeeded / refund.failed, bisa sampai ~1 hari kerja).
  //
  // Menuliskan SUDAH_REFUND untuk keduanya berarti menyatakan dana sudah kembali padahal masih
  // diproses. Hanya SUCCEEDED yang dianggap tuntas. Status apa pun selain itu (termasuk yang belum
  // pernah kita lihat) tetap SEDANG_DIPROSES — "sudah dikirim, jangan diulang, tapi belum dipastikan".
  const tuntas = hasil.status.toUpperCase() === 'SUCCEEDED'
  const note =
    `Dikembalikan lewat Xendit ke ${info?.channel ?? 'sumber pembayaran'}` +
    (hasil.status ? ` — status ${hasil.status}` : '') +
    (hasil.feeAmount ? ` — biaya refund Rp${hasil.feeAmount}` : '')

  const updated = await finalizeClaimedRefund(orderId, claimReference, {
    status: tuntas ? 'SUDAH_REFUND' : 'SEDANG_DIPROSES',
    note,
    reference: hasil.reference,
  })

  if (!updated) {
    // Penulisan penutup kalah — dan ada tiga kemungkinan yang artinya berbeda jauh, jadi barisnya
    // dibaca ulang dulu sebelum admin diberi tahu apa pun.
    //
    // Klaim menyimpan payment_request_id yang juga dibawa callback, sehingga callback yang tiba
    // lebih cepat daripada balasan HTTP ini bisa menutup barisnya lebih dulu. CAS di
    // finalizeClaimedRefund lalu wajar kalah. Melaporkannya sebagai "gagal dicatat" akan membuat
    // admin memeriksa dashboard dan menutup manual pengembalian yang sebenarnya sudah beres.
    const terkini = await getOrderByOrderId(orderId)

    if (terkini?.refundStatus === 'SUDAH_REFUND') {
      console.log(`[oms/refunds/xendit] ${orderId} sudah ditutup callback sebelum balasan HTTP diproses.`)
      return NextResponse.json({
        success: true,
        metode: METODE,
        reference: hasil.reference || claimReference,
        status: 'SUCCEEDED',
        tuntas: true,
        pesan: 'Dana sudah dikembalikan (dikonfirmasi Xendit).',
        order: terkini,
      })
    }

    if (terkini?.refundStatus === 'PERLU_REFUND') {
      // Callback GAGAL tiba lebih dulu dan sudah mengembalikan barisnya ke daftar kerja.
      console.warn(`[oms/refunds/xendit] ${orderId} dinyatakan GAGAL lewat callback sebelum balasan HTTP diproses.`)
      return NextResponse.json(
        {
          error:
            'Xendit menyatakan pengembalian dana ini GAGAL. Pesanan sudah kembali ke daftar dan boleh dicoba lagi.',
          code: 'REFUND_FAILED_BY_CALLBACK',
          metode: METODE,
        },
        { status: 502 },
      )
    }

    // Benar-benar gagal ditulis. Uang sudah dikembalikan, tapi barisnya sudah berstatus
    // SEDANG_DIPROSES sejak klaim, jadi ia TIDAK bisa dikembalikan dua kali — yang hilang hanya
    // catatan penutupnya, bukan pagarnya.
    console.error(
      `[oms/refunds/xendit] ${orderId} UANG SUDAH DIKEMBALIKAN (ref ${hasil.reference || claimReference}) ` +
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
    `[oms/refunds/xendit] ${orderId} ref=${hasil.reference || claimReference} status=${hasil.status} → ${tuntas ? 'SUDAH_REFUND' : 'SEDANG_DIPROSES'} oleh ${by}`,
  )

  // Jalur B laporan refund GA4 — hanya bila tuntas DI SINI. Kalau masih SEDANG_DIPROSES, callback
  // refund.succeeded yang akan melaporkannya (jalur A). Cabang "sudah ditutup callback" di atas
  // sengaja tidak melapor: callback itulah pemenangnya dan sudah melapor sendiri.
  if (tuntas) await reportRefundToGa(updated, '[oms/refunds/xendit]')

  return NextResponse.json({
    success: true,
    metode: METODE,
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
