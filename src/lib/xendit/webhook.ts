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
  // id invoice di Xendit (untuk orders.id_transaksi); kosong bila tak dikirim
  transactionId?: string
  rawStatus: string
  paidAmount: number
  paymentMethod?: string
}

// Status Xendit yang dianggap "uang sudah masuk".
// SETTLED = dana sudah diteruskan ke saldo merchant; PAID = pembayaran diterima. Keduanya sah.
const PAID_STATUSES = new Set(['PAID', 'SETTLED'])
// EXPIRED = invoice lewat batas waktu. FAILED muncul di sebagian channel.
const FAILED_STATUSES = new Set(['EXPIRED', 'FAILED'])

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
  }
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
  if (parsed.rawStatus === 'PENDING') return { kind: 'pending' }
  return { kind: 'ignored', rawStatus: parsed.rawStatus }
}

// Ekspor tipe bantu agar route tak perlu meng-impor tipe order langsung untuk hal ini.
export type { OrderPaymentStatus, OrderFulfillmentStatus }
