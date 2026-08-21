// src/app/api/payments/create/route.ts
// Membuat Virtual Account pembayaran (Xendit Payment Request) untuk sebuah pesanan.
//   POST /api/payments/create  { invoice: "INV-...", method: "bni" }
//
// ── Kenapa Route Handler, bukan Server Action ──
// Project ini TIDAK memakai Server Action sama sekali (nol hasil untuk `'use server'`); seluruh
// logika server berjalan lewat Route Handler. Keamanannya identik — sama-sama server-only, dan
// XENDIT_SECRET_KEY tak pernah menyeberang ke browser — sementara helper yang sudah ada
// (rate-limit, requireAdmin) langsung bisa dipakai. Lihat CLAUDE.md → Code Style.
//
// ── Yang TIDAK dipercaya dari client ──
// Client hanya mengirim NOMOR INVOICE dan PILIHAN BANK. Nominalnya dibaca dari
// `orders.jumlah_total` di DB; nama pembeli dari kolomnya sendiri. Kalau nominal diambil dari body,
// siapa pun bisa membuat VA Rp1.000 untuk pesanan Rp1.000.000 lalu membayarnya — dan webhook akan
// menolaknya sebagai kurang bayar, tapi barangnya sudah tampak terbayar di mata pembeli.
//
// ── Pesanan mana yang boleh dibuatkan VA ──
// Hanya yang status pembayarannya masih `Menunggu` dan belum dibatalkan. Membuat VA untuk pesanan
// yang sudah Lunas berarti pembeli bisa membayar dua kali untuk satu pesanan.

import { NextResponse } from 'next/server'
import { getOrderByOrderId, setOrderTransactionId } from '@/lib/mock-db/orders'
import { createVirtualAccount } from '@/lib/xendit/payment-request'
import { RATE_LIMITS, enforceRateLimit, getClientIp } from '@/lib/rate-limit'

// createAdminClient (Supabase) butuh runtime Node.js, bukan Edge
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LOG = '[payments-create]'

// Pesan yang boleh dilihat pembeli per jenis kegagalan.
//
// Detail teknis (respons Xendit, alasan penjaga lingkungan) SENGAJA tidak diteruskan: ia bisa
// memuat konfigurasi internal, dan bagi pembeli tak ada gunanya. Detailnya masuk ke log server.
const PUBLIC_ERRORS: Record<string, string> = {
  'not-configured': 'Pembayaran belum dikonfigurasi. Silakan hubungi kami.',
  'blocked-environment': 'Pembayaran belum dikonfigurasi. Silakan hubungi kami.',
  'unsupported-channel': 'Bank yang dipilih belum tersedia. Silakan pilih bank lain.',
  'invalid-order': 'Nominal pesanan tidak valid. Silakan hubungi kami.',
  'http-error': 'Gagal membuat pembayaran. Silakan coba lagi atau pilih bank lain.',
  'no-va-number': 'Gagal membuat pembayaran. Silakan coba lagi.',
  network: 'Gagal menghubungi layanan pembayaran. Silakan coba lagi.',
}

export async function POST(request: Request) {
  const limited = enforceRateLimit(
    `payments-create:ip:${getClientIp(request)}`,
    RATE_LIMITS.PAYMENT_CREATE_IP,
  )
  if (limited) return limited

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  const invoice = typeof body.invoice === 'string' ? body.invoice.trim().replace(/^#/, '') : ''
  const method = typeof body.method === 'string' ? body.method.trim() : ''
  if (!invoice) return NextResponse.json({ error: 'Field `invoice` wajib diisi.' }, { status: 400 })
  if (!method) return NextResponse.json({ error: 'Field `method` wajib diisi.' }, { status: 400 })

  // Limit kedua: per nomor invoice, agar satu pesanan tak dipakai membuat VA berulang-ulang.
  const limitedInvoice = enforceRateLimit(
    `payments-create:invoice:${invoice}`,
    RATE_LIMITS.PAYMENT_CREATE_INVOICE,
  )
  if (limitedInvoice) return limitedInvoice

  const order = await getOrderByOrderId(invoice)
  if (!order) {
    // Pesan sengaja sama untuk "tak ada" dan "tak boleh": nomor invoice adalah satu-satunya kunci
    // endpoint ini, jadi membedakan keduanya memberi tahu penebak nomor mana yang benar-benar ada.
    return NextResponse.json({ error: 'Pesanan tidak ditemukan.' }, { status: 404 })
  }
  if (order.status === 'Dibatalkan') {
    return NextResponse.json(
      { error: 'Pesanan sudah dibatalkan — tidak bisa dibayar.' },
      { status: 409 },
    )
  }
  if (order.paymentStatus === 'Lunas') {
    return NextResponse.json({ error: 'Pesanan sudah dibayar.' }, { status: 409 })
  }

  const result = await createVirtualAccount(order, method)
  if (!result.ok) {
    // Detail lengkap HANYA ke log server.
    console.error(`${LOG} invoice=${invoice} gagal (${result.reason}): ${result.detail}`)
    // 502 untuk kegagalan di sisi Xendit/jaringan (bukan salah pembeli); 400 untuk input/konfigurasi.
    const status = result.reason === 'http-error' || result.reason === 'network' ? 502 : 400
    return NextResponse.json(
      { error: PUBLIC_ERRORS[result.reason] ?? 'Gagal membuat pembayaran.' },
      { status },
    )
  }

  // Simpan id Payment Request → orders.id_transaksi. Ini yang menghubungkan pesanan kita dengan
  // objek pembayaran di dashboard Xendit; tanpanya, pembayaran yang bermasalah tak bisa dilacak
  // balik ke pesanannya.
  //
  // Gagal menyimpan TIDAK membatalkan respons: VA-nya sudah terbit di Xendit dan pembeli berhak
  // melihat nomornya. Webhook tetap menemukan pesanan lewat `reference_id` (= nomor invoice),
  // bukan lewat kolom ini. Tapi dicatat sekeras mungkin karena jejaknya jadi tak lengkap.
  const saved = await setOrderTransactionId(invoice, result.va.paymentRequestId)
  if (!saved) {
    console.error(
      `${LOG} invoice=${invoice} VA terbit (${result.va.paymentRequestId}) tapi GAGAL disimpan ke id_transaksi`,
    )
  }

  console.log(
    `${LOG} invoice=${invoice} VA ${result.va.bank} terbit, kedaluwarsa ${result.va.expiresAt}`,
  )

  return NextResponse.json({ va: result.va, transactionSaved: saved })
}
