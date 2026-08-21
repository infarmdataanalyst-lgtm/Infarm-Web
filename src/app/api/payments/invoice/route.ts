// src/app/api/payments/invoice/route.ts
// Membuat Invoice Xendit (halaman pembayaran) untuk sebuah pesanan yang SUDAH tersimpan.
//   POST /api/payments/invoice  { invoice: "INV-..." }
//   → { invoiceUrl, invoiceId, expiryDate }
//
// ── Yang TIDAK dipercaya dari client ──
// Client hanya mengirim NOMOR INVOICE. Nominal, nama, dan nomor telepon dibaca dari tabel
// `orders`. Kalau nominal diambil dari body, siapa pun bisa membuat invoice Rp1.000 untuk pesanan
// Rp1.000.000 lalu membayarnya — dan meski webhook menolaknya sebagai kurang bayar, pembeli sudah
// melihat "pembayaran berhasil" di halaman Xendit.
//
// ── Pesanan tidak dibuat di sini ──
// Order sudah ada sebelum endpoint ini dipanggil: `POST /api/orders/create` menjalankan RPC atomik
// `create_order_with_items` (insert orders + order_items + potong stok). Endpoint ini HANYA
// menerbitkan tagihannya.
//
// ── Pesanan mana yang boleh ditagih ──
// Hanya yang `status_pembayaran` masih `Menunggu` dan belum dibatalkan. Menerbitkan invoice untuk
// pesanan yang sudah Lunas berarti pembeli bisa membayar dua kali untuk satu pesanan.

import { NextResponse } from 'next/server'
import { getOrderByOrderId, setOrderTransactionId } from '@/lib/mock-db/orders'
import { createXenditInvoice } from '@/lib/xendit/invoice'
import { RATE_LIMITS, enforceRateLimit, getClientIp } from '@/lib/rate-limit'

// createAdminClient (Supabase) butuh runtime Node.js, bukan Edge
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LOG = '[payments-invoice]'

// Pesan yang boleh dilihat pembeli. Detail teknis (respons Xendit, alasan penjaga lingkungan)
// SENGAJA tak diteruskan — bisa memuat konfigurasi internal, dan tak berguna bagi pembeli.
const PUBLIC_ERRORS: Record<string, string> = {
  'not-configured': 'Pembayaran belum dikonfigurasi. Silakan hubungi kami.',
  'blocked-environment': 'Pembayaran belum dikonfigurasi. Silakan hubungi kami.',
  'invalid-order': 'Data pesanan tidak lengkap. Silakan hubungi kami.',
  'http-error': 'Gagal membuat halaman pembayaran. Silakan coba lagi.',
  'no-invoice-url': 'Gagal membuat halaman pembayaran. Silakan coba lagi.',
  network: 'Gagal menghubungi layanan pembayaran. Silakan coba lagi.',
}

// Asal URL situs, untuk menyusun success/failure redirect.
//
// Header proxy DIDAHULUKAN atas `request.url`: di belakang proxy Vercel, `request.url` bisa memuat
// host internal, dan redirect ke host internal akan membuat pembeli mendarat di halaman yang tak
// bisa dibuka. `NEXT_PUBLIC_SITE_URL` menang di atas segalanya untuk kasus domain kustom.
function resolveOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (configured) return configured.replace(/\/+$/, '')

  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  if (host) {
    const proto = request.headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
    return `${proto}://${host}`
  }

  try {
    return new URL(request.url).origin
  } catch {
    return ''
  }
}

export async function POST(request: Request) {
  const limited = enforceRateLimit(
    `payments-invoice:ip:${getClientIp(request)}`,
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
  if (!invoice) return NextResponse.json({ error: 'Field `invoice` wajib diisi.' }, { status: 400 })

  // Limit kedua: per nomor invoice, agar satu pesanan tak dipakai menerbitkan invoice berulang.
  const limitedInvoice = enforceRateLimit(
    `payments-invoice:invoice:${invoice}`,
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

  const result = await createXenditInvoice(order, resolveOrigin(request))
  if (!result.ok) {
    // Detail lengkap HANYA ke log server.
    console.error(`${LOG} invoice=${invoice} gagal (${result.reason}): ${result.detail}`)
    // 502 untuk kegagalan di sisi Xendit/jaringan (bukan salah pembeli); 400 untuk input/konfigurasi.
    const status = result.reason === 'http-error' || result.reason === 'network' ? 502 : 400
    return NextResponse.json(
      { error: PUBLIC_ERRORS[result.reason] ?? 'Gagal membuat halaman pembayaran.' },
      { status },
    )
  }

  // Simpan id invoice → orders.id_transaksi. Ini yang menghubungkan pesanan kita dengan objek
  // pembayaran di dashboard Xendit; tanpanya, pembayaran bermasalah tak bisa dilacak balik.
  //
  // Gagal menyimpan TIDAK membatalkan respons: invoice sudah terbit dan pembeli berhak
  // membayarnya. Webhook tetap menemukan pesanan lewat `external_id` (= nomor invoice), bukan
  // lewat kolom ini. Tapi dicatat sekeras mungkin karena jejaknya jadi tak lengkap.
  const saved = await setOrderTransactionId(invoice, result.invoice.invoiceId)
  if (!saved) {
    console.error(
      `${LOG} invoice=${invoice} tagihan terbit (${result.invoice.invoiceId}) tapi GAGAL disimpan ke id_transaksi`,
    )
  }

  console.log(`${LOG} invoice=${invoice} tagihan terbit, kedaluwarsa ${result.invoice.expiryDate}`)

  return NextResponse.json({
    invoiceUrl: result.invoice.invoiceUrl,
    invoiceId: result.invoice.invoiceId,
    expiryDate: result.invoice.expiryDate,
    transactionSaved: saved,
  })
}
