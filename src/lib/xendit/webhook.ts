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
//
// ── Dua bentuk callback Payments v3, satu pesanan ──
// Sejak migrasi ke Payment Sessions (2026-09-28) SATU pembayaran memicu DUA callback berbeda:
//
//   1. Tingkat PEMBAYARAN — `payment.capture` (docs lama menyebutnya `payment.succeeded`; keduanya
//      dikenali), `payment.failure`, `payment.expiry`, `payment.authorization`:
//        { event, business_id, created,
//          data: { payment_id "py-…", payment_request_id "pr-…", reference_id, status,
//                  request_amount "1234", currency, channel_code "DANA", captures: [...] } }
//      Satu-satunya yang membawa `channel_code` → orders.metode_pembayaran.
//
//   2. Tingkat SESI — `payment_session.completed` / `payment_session.expired`:
//        { event, business_id, created,
//          data: { payment_session_id "ps-…", reference_id, status, amount "10000", currency,
//                  payment_request_id, payment_id, expires_at, … } }
//      Yang menentukan NASIB sesi: expired = tautan mati, pesanan ditutup & stok dilepas.
//
// Urutan kedatangan keduanya TIDAK dijamin. Keduanya boleh menandai Lunas (route idempoten lewat
// cabang ALREADY_PAID), tapi HANYA `payment_session.expired` yang boleh membatalkan pesanan:
// `payment.failure` adalah SATU percobaan yang gagal, dan pembeli masih bisa mencoba metode lain
// selama sesinya hidup. Membatalkan pesanan pada percobaan pertama yang gagal berarti melepas stok
// untuk pembeli yang sebenarnya sedang mencoba membayar.
//
// Callback Invoice API v2 lama (`external_id` + `status` di akar) SENGAJA tak dikenali lagi — jalur
// itu dilepas utuh sebelum go-live, jadi tak ada tagihan v2 milik pembeli sungguhan yang beredar.

import { timingSafeEqual } from 'node:crypto'
import type { OrderFulfillmentStatus, OrderPaymentStatus } from '@/types/order'
import { asNumber, asString } from '@/lib/xendit/util'

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

// Hasil pemetaan: apa yang harus dilakukan pada pesanan.
export type PaymentOutcome =
  // Pembayaran berhasil & jumlahnya cukup
  | { kind: 'paid'; paymentStatus: 'Lunas'; orderStatus: 'Diproses' }
  // Sesi kedaluwarsa / dibatalkan → stok WAJIB dilepas kembali (checkout sudah memotongnya)
  | { kind: 'failed'; paymentStatus: 'Gagal'; orderStatus: 'Dibatalkan' }
  // Satu PERCOBAAN bayar gagal, tapi sesinya masih hidup → pesanan dibiarkan, pembeli bisa mengulang
  | { kind: 'attempt-failed' }
  // Masih menunggu pembayaran → tak ada yang perlu diubah
  | { kind: 'pending' }
  // Status yang tak dikenal → jangan tebak, catat & biarkan pesanan apa adanya
  | { kind: 'ignored'; rawStatus: string }
  // Nominal terbayar KURANG dari tagihan → jangan pernah tandai Lunas
  | { kind: 'underpaid'; paidAmount: number; expectedAmount: number }

export type ParsedCallback = {
  // nomor_invoice pesanan kita (= reference_id yang kita kirim saat membuat sesi)
  invoice: string
  // Nama event mentah — untuk log.
  event: string
  // id sesi `ps-…` (untuk orders.id_transaksi); hanya ada bila payload menyebutnya
  transactionId?: string
  // `pr-…` / `py-…` — untuk log & pencocokan; refund membacanya segar dari GET /sessions
  paymentRequestId?: string
  paymentId?: string
  rawStatus: string
  paidAmount: number
  // Kanal yang dipakai pembeli (`channel_code`, mis. 'DANA', 'BCA_VIRTUAL_ACCOUNT')
  // → orders.metode_pembayaran. Hanya ada di callback tingkat pembayaran.
  paymentMethod?: string
  // Bentuk payload yang cocok — menentukan aturan di resolvePaymentOutcome.
  source: 'payment_session' | 'payment'
}

// Status yang dianggap "uang sudah masuk".
//   sesi        : COMPLETED
//   pembayaran  : SUCCEEDED, CAPTURED
const PAID_STATUSES = new Set(['COMPLETED', 'SUCCEEDED', 'CAPTURED'])
// Sesi yang mati → uang TIDAK akan masuk lewat sesi ini → stok wajib dilepas.
const SESSION_DEAD_STATUSES = new Set(['EXPIRED', 'CANCELED', 'CANCELLED'])
// Satu percobaan bayar yang tidak jadi. Sesinya sendiri masih bisa hidup.
const ATTEMPT_FAILED_STATUSES = new Set(['FAILED', 'EXPIRED', 'CANCELED', 'CANCELLED', 'VOIDED'])
// Masih menunggu pembayaran → tak ada yang perlu diubah.
const PENDING_STATUSES = new Set(['ACTIVE', 'PENDING', 'REQUIRES_ACTION', 'AWAITING_CAPTURE', 'AUTHORIZED'])

// Status turunan dari nama peristiwa, dipakai HANYA bila `data.status` tak ada.
const EVENT_STATUS_FALLBACK: Record<string, string> = {
  'payment_session.completed': 'COMPLETED',
  'payment_session.expired': 'EXPIRED',
  'payment.capture': 'SUCCEEDED',
  'payment.succeeded': 'SUCCEEDED',
  'payment.failure': 'FAILED',
  'payment.failed': 'FAILED',
  'payment.expiry': 'EXPIRED',
  'payment.expired': 'EXPIRED',
  'payment.authorization': 'AUTHORIZED',
  'payment.pending': 'PENDING',
}

// Nama event mentah dari payload apa pun; '' bila tak ada.
export function callbackEventName(body: unknown): string {
  if (typeof body !== 'object' || body === null) return ''
  return (asString((body as Record<string, unknown>).event) ?? '').toLowerCase()
}

function dataOf(body: unknown): Record<string, unknown> | null {
  if (typeof body !== 'object' || body === null) return null
  const root = body as Record<string, unknown>
  if (typeof root.data !== 'object' || root.data === null) return null
  return root.data as Record<string, unknown>
}

// Callback tingkat SESI (`payment_session.*`). null = bukan callback jenis ini.
export function parsePaymentSessionCallback(body: unknown): ParsedCallback | null {
  const event = callbackEventName(body)
  if (!event.startsWith('payment_session.')) return null
  const data = dataOf(body)
  if (!data) return null

  const invoice = asString(data.reference_id)
  if (!invoice) return null

  const rawStatus = asString(data.status) ?? EVENT_STATUS_FALLBACK[event]
  if (!rawStatus) return null

  const transactionId = asString(data.payment_session_id)
  const paymentRequestId = asString(data.payment_request_id)
  const paymentId = asString(data.payment_id)
  return {
    invoice,
    event,
    ...(transactionId ? { transactionId } : {}),
    ...(paymentRequestId ? { paymentRequestId } : {}),
    ...(paymentId ? { paymentId } : {}),
    rawStatus: rawStatus.toUpperCase(),
    // `amount` sesi = nominal yang diminta; Xendit mengirimnya sebagai string.
    paidAmount: asNumber(data.amount),
    source: 'payment_session',
  }
}

// Callback tingkat PEMBAYARAN (`payment.*`). null = bukan callback jenis ini.
export function parsePaymentCallback(body: unknown): ParsedCallback | null {
  const event = callbackEventName(body)
  if (!event.startsWith('payment.')) return null
  const data = dataOf(body)
  if (!data) return null

  const invoice = asString(data.reference_id)
  if (!invoice) return null

  const rawStatus = asString(data.status) ?? EVENT_STATUS_FALLBACK[event]
  if (!rawStatus) return null

  // Nominal yang BENAR-BENAR tertangkap: jumlah `captures[].capture_amount` bila ada, lalu
  // `amount`, lalu `request_amount`. Nol berarti tak terbaca dan akan tertangkap sebagai kurang
  // bayar oleh resolvePaymentOutcome (menolak-dengan-aman).
  const captures = Array.isArray(data.captures) ? (data.captures as unknown[]) : []
  const captured = captures.reduce<number>((sum, c) => {
    if (typeof c !== 'object' || c === null) return sum
    return sum + asNumber((c as Record<string, unknown>).capture_amount)
  }, 0)
  const paidAmount = captured || asNumber(data.amount) || asNumber(data.request_amount)

  // Sesi induknya, bila Xendit menyertakannya. Tidak dijadikan syarat: id sesi sudah tersimpan
  // saat sesi dibuat, jadi hilangnya di sini tak merugikan apa pun.
  const transactionId = asString(data.payment_session_id)
  const paymentRequestId = asString(data.payment_request_id)
  const paymentId = asString(data.payment_id) ?? asString(data.id)
  const paymentMethod = asString(data.channel_code)

  return {
    invoice,
    event,
    ...(transactionId ? { transactionId } : {}),
    ...(paymentRequestId ? { paymentRequestId } : {}),
    ...(paymentId ? { paymentId } : {}),
    rawStatus: rawStatus.toUpperCase(),
    paidAmount,
    ...(paymentMethod ? { paymentMethod } : {}),
    source: 'payment',
  }
}

// === Pintu masuk tunggal ===

// Membaca callback pembayaran Xendit apa pun bentuknya (sesi dulu, lalu pembayaran).
// null = bukan callback pembayaran yang kita tangani (refund punya parsernya sendiri di
// refund-callback.ts; callback Invoice v2 lama pun jatuh ke sini).
export function parseXenditCallback(body: unknown): ParsedCallback | null {
  return parsePaymentSessionCallback(body) ?? parsePaymentCallback(body)
}

// true bila payload ini callback Invoice API v2 LAMA (`external_id` + `status` di akar). Hanya
// untuk log: jalur v2 sudah dilepas, dan callback seperti ini berarti masih ada tagihan lama
// (dari masa uji) yang beredar di akun Xendit.
export function isLegacyInvoiceCallback(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false
  const root = body as Record<string, unknown>
  return Boolean(asString(root.external_id) && asString(root.status))
}

// Menentukan tindakan atas sebuah pesanan dari status callback + nominal tagihan pesanan itu.
//
// `expectedAmount` diambil dari DB (orders.jumlah_total), BUKAN dari payload — kalau nominalnya
// dibaca dari callback juga, penyerang yang berhasil menebak token cukup mengirim
// `amount == paid_amount` untuk menandai pesanan Lunas tanpa membayar.
export function resolvePaymentOutcome(parsed: ParsedCallback, expectedAmount: number): PaymentOutcome {
  if (PAID_STATUSES.has(parsed.rawStatus)) {
    // Toleransi Rp0: Xendit mengirim nominal bulat rupiah, jadi tak ada urusan pembulatan sen.
    if (parsed.paidAmount < expectedAmount) {
      return { kind: 'underpaid', paidAmount: parsed.paidAmount, expectedAmount }
    }
    return { kind: 'paid', paymentStatus: 'Lunas', orderStatus: 'Diproses' }
  }

  if (parsed.source === 'payment_session') {
    if (SESSION_DEAD_STATUSES.has(parsed.rawStatus)) {
      return { kind: 'failed', paymentStatus: 'Gagal', orderStatus: 'Dibatalkan' }
    }
  } else if (ATTEMPT_FAILED_STATUSES.has(parsed.rawStatus)) {
    // Gagal di tingkat PEMBAYARAN ≠ sesi mati. Lihat catatan di kepala berkas.
    return { kind: 'attempt-failed' }
  }

  if (PENDING_STATUSES.has(parsed.rawStatus)) return { kind: 'pending' }
  return { kind: 'ignored', rawStatus: parsed.rawStatus }
}

// Ekspor tipe bantu agar route tak perlu meng-impor tipe order langsung untuk hal ini.
export type { OrderPaymentStatus, OrderFulfillmentStatus }
