// src/lib/xendit/webhook.ts
// Verifikasi & pemetaan callback (webhook) Xendit. SERVER-ONLY — memegang XENDIT_CALLBACK_TOKEN.
//
// Xendit TIDAK menandatangani body-nya seperti Stripe (tak ada HMAC signature). Yang dikirim hanya
// header statis `x-callback-token` yang harus sama dengan token di dashboard Xendit. Artinya token
// itu SATU-SATUNYA pembeda antara callback asli dan request palsu — jangan pernah memproses payload
// sebelum token cocok, dan jangan pernah menuliskan token ke log.
//
// Modul ini sengaja TIDAK menyentuh DB: pemetaan payload dipisah dari efeknya supaya bisa diuji
// tanpa Supabase, dan supaya route handler yang mengorkestrasi tetap terbaca.

import { timingSafeEqual } from 'node:crypto'
import type { OrderFulfillmentStatus, OrderPaymentStatus } from '@/types/order'

// === Verifikasi token ===

export type TokenCheck =
  | { ok: true }
  // 'not-configured' dipisah dari 'mismatch': env yang lupa di-set adalah salah KITA (500),
  // sementara token tak cocok adalah request yang tak berwenang (401). Menyamakan keduanya
  // membuat webhook yang mati karena env kosong terlihat seperti serangan.
  | { ok: false; reason: 'not-configured' | 'missing-header' | 'mismatch' }

// Membandingkan header `x-callback-token` dengan XENDIT_CALLBACK_TOKEN secara waktu-konstan.
export function verifyCallbackToken(headerToken: string | null): TokenCheck {
  const expected = process.env.XENDIT_CALLBACK_TOKEN
  if (!expected) return { ok: false, reason: 'not-configured' }
  if (!headerToken) return { ok: false, reason: 'missing-header' }

  // timingSafeEqual melempar bila panjang buffer beda → cek panjang lebih dulu. Panjang token
  // bukan rahasia yang berguna bagi penyerang, jadi kebocoran informasi di sini tidak berarti.
  const a = Buffer.from(headerToken)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return { ok: false, reason: 'mismatch' }
  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: 'mismatch' }
}

// === Pemetaan payload ===

// Bentuk callback Invoice Xendit — hanya field yang benar-benar dipakai.
// Xendit boleh menambah field kapan saja; field asing diabaikan, bukan ditolak.
type XenditInvoiceCallback = {
  id?: unknown // id invoice di Xendit → disimpan ke orders.id_transaksi
  external_id?: unknown // referensi milik KITA → orders.nomor_invoice
  status?: unknown // PENDING | PAID | SETTLED | EXPIRED | FAILED
  paid_amount?: unknown
  amount?: unknown
  payment_method?: unknown
  payment_channel?: unknown
}

// Hasil pemetaan: apa yang harus dilakukan pada pesanan.
export type PaymentOutcome =
  // Pembayaran berhasil & jumlahnya cukup
  | { kind: 'paid'; paymentStatus: 'Lunas'; orderStatus: 'Diproses' }
  // Kedaluwarsa / gagal → stok WAJIB dilepas kembali (checkout sudah memotongnya)
  | { kind: 'failed'; paymentStatus: 'Gagal'; orderStatus: 'Dibatalkan' }
  // Masih menunggu pembayaran → tak ada yang perlu diubah
  | { kind: 'pending' }
  // Status yang tak dikenal → jangan tebak, catat & biarkan pesanan apa adanya
  | { kind: 'ignored'; rawStatus: string }
  // Nominal terbayar KURANG dari tagihan → jangan pernah tandai Lunas
  | { kind: 'underpaid'; paidAmount: number; expectedAmount: number }

export type ParsedCallback = {
  // nomor_invoice pesanan kita
  invoice: string
  // id transaksi di Xendit (untuk orders.id_transaksi); kosong bila tak dikirim
  transactionId?: string
  rawStatus: string
  paidAmount: number
  paymentMethod?: string
  // Bentuk payload yang cocok — hanya untuk log. Berguna saat dua jalur pembayaran hidup
  // berdampingan dan perlu tahu callback mana yang datang.
  source: 'invoice' | 'payment_request'
}

// Status Xendit yang dianggap "uang sudah masuk".
//   Invoice API v2      : PAID (pembayaran diterima), SETTLED (dana masuk saldo merchant)
//   Payments API v3     : SUCCEEDED, CAPTURED
const PAID_STATUSES = new Set(['PAID', 'SETTLED', 'SUCCEEDED', 'CAPTURED'])
// Status yang berarti uangnya TIDAK akan masuk → stok wajib dilepas kembali.
//   Invoice API v2      : EXPIRED (lewat batas waktu), FAILED
//   Payments API v3     : VOIDED, CANCELED (ejaan Xendit satu 'L')
const FAILED_STATUSES = new Set(['EXPIRED', 'FAILED', 'VOIDED', 'CANCELED', 'CANCELLED'])
// Masih menunggu pembayaran → tak ada yang perlu diubah.
// REQUIRES_ACTION = VA sudah terbit, pembeli belum transfer (status pertama Payment Request v3).
const PENDING_STATUSES = new Set(['PENDING', 'REQUIRES_ACTION', 'AWAITING_CAPTURE'])

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined
}

function asNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

// Membaca body callback menjadi bentuk yang dipakai route. null = payload tak bisa dipakai
// (tak ada external_id / status), yang berarti bukan callback Invoice yang kita tangani.
export function parseInvoiceCallback(body: unknown): ParsedCallback | null {
  if (typeof body !== 'object' || body === null) return null
  const raw = body as XenditInvoiceCallback

  const invoice = asString(raw.external_id)
  const rawStatus = asString(raw.status)
  if (!invoice || !rawStatus) return null

  const transactionId = asString(raw.id)
  return {
    invoice,
    ...(transactionId ? { transactionId } : {}),
    rawStatus: rawStatus.toUpperCase(),
    // Sebagian channel hanya mengirim `amount` saat lunas; pakai itu bila paid_amount kosong.
    paidAmount: asNumber(raw.paid_amount) || asNumber(raw.amount),
    ...(asString(raw.payment_method) || asString(raw.payment_channel)
      ? { paymentMethod: asString(raw.payment_method) ?? asString(raw.payment_channel)! }
      : {}),
    source: 'invoice',
  }
}

// === Payments API v3 (Payment Request / Virtual Account) ===
//
// Bentuk callback-nya BERBEDA dari Invoice API: datanya bersarang di `data`, referensi kita bernama
// `reference_id` (bukan `external_id`), dan jenis peristiwanya ada di `event`.
//
// ⚠️ UNVERIFIED — disusun dari dokumentasi, belum pernah menerima callback sungguhan. Bentuk yang
// DIHARAPKAN:
//   { event: "payment.succeeded",
//     data: { id, payment_request_id, reference_id, status, amount, currency,
//             payment_method: { type: "VIRTUAL_ACCOUNT", ... } } }
// Setelah callback pertama masuk, cocokkan dengan log `[xendit-webhook] masuk …` dan perbarui
// komentar ini beserta kandidat field di bawah.

// Status turunan dari nama peristiwa, dipakai HANYA bila `data.status` tak ada.
const EVENT_STATUS_FALLBACK: Record<string, string> = {
  'payment.succeeded': 'SUCCEEDED',
  'payment.failed': 'FAILED',
  'payment.pending': 'PENDING',
  'payment_method.expired': 'EXPIRED',
  'payment_method.activated': 'REQUIRES_ACTION',
}

export function parsePaymentRequestCallback(body: unknown): ParsedCallback | null {
  if (typeof body !== 'object' || body === null) return null
  const root = body as Record<string, unknown>
  if (typeof root.data !== 'object' || root.data === null) return null
  const data = root.data as Record<string, unknown>

  const invoice = asString(data.reference_id)
  if (!invoice) return null

  const event = asString(root.event)?.toLowerCase()
  const rawStatus = asString(data.status) ?? (event ? EVENT_STATUS_FALLBACK[event] : undefined)
  if (!rawStatus) return null

  // `payment_request_id` DIDAHULUKAN atas `data.id`: ia stabil untuk satu pesanan, sementara
  // `data.id` adalah id percobaan pembayaran yang bisa berbeda tiap callback. Kolom
  // orders.id_transaksi harus memuat id yang sama dengan yang disimpan saat VA dibuat.
  const transactionId = asString(data.payment_request_id) ?? asString(data.id)

  const paymentMethodType =
    typeof data.payment_method === 'object' && data.payment_method !== null
      ? asString((data.payment_method as Record<string, unknown>).type)
      : undefined

  return {
    invoice,
    ...(transactionId ? { transactionId } : {}),
    rawStatus: rawStatus.toUpperCase(),
    // `amount` = nominal yang benar-benar dibayar. `captured_amount`/`request_amount` sebagai
    // cadangan bila penamaannya berbeda; nol berarti tak terbaca dan akan tertangkap sebagai
    // kurang bayar oleh resolvePaymentOutcome (menolak-dengan-aman).
    paidAmount: asNumber(data.amount) || asNumber(data.captured_amount) || asNumber(data.request_amount),
    ...(paymentMethodType ? { paymentMethod: paymentMethodType } : {}),
    source: 'payment_request',
  }
}

// === Pintu masuk tunggal ===

// Membaca callback Xendit apa pun bentuknya. Invoice API dicoba lebih dulu (bentuknya lebih
// spesifik: `external_id` + `status` di akar), lalu Payment Request v3.
//
// Dua bentuk dipertahankan berdampingan supaya jalur pembayaran bisa dipindah tanpa mematikan
// callback yang sudah beredar di Xendit — invoice lama yang belum dibayar tetap tertangani.
export function parseXenditCallback(body: unknown): ParsedCallback | null {
  return parseInvoiceCallback(body) ?? parsePaymentRequestCallback(body)
}

// Menentukan tindakan atas sebuah pesanan dari status callback + nominal tagihan pesanan itu.
//
// `expectedAmount` diambil dari DB (orders.jumlah_total), BUKAN dari payload — kalau nominalnya
// dibaca dari callback juga, penyerang yang berhasil menebak token cukup mengirim
// `amount == paid_amount` untuk menandai pesanan Lunas tanpa membayar.
export function resolvePaymentOutcome(
  parsed: ParsedCallback,
  expectedAmount: number,
): PaymentOutcome {
  if (PAID_STATUSES.has(parsed.rawStatus)) {
    // Toleransi Rp0: Xendit mengirim nominal bulat rupiah, jadi tak ada urusan pembulatan sen.
    if (parsed.paidAmount < expectedAmount) {
      return { kind: 'underpaid', paidAmount: parsed.paidAmount, expectedAmount }
    }
    return { kind: 'paid', paymentStatus: 'Lunas', orderStatus: 'Diproses' }
  }
  if (FAILED_STATUSES.has(parsed.rawStatus)) {
    return { kind: 'failed', paymentStatus: 'Gagal', orderStatus: 'Dibatalkan' }
  }
  if (PENDING_STATUSES.has(parsed.rawStatus)) return { kind: 'pending' }
  return { kind: 'ignored', rawStatus: parsed.rawStatus }
}

// Ekspor tipe bantu agar route tak perlu meng-impor tipe order langsung untuk hal ini.
export type { OrderPaymentStatus, OrderFulfillmentStatus }
