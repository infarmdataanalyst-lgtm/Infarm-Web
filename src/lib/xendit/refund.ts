// src/lib/xendit/refund.ts
// Mengembalikan dana sebuah pembayaran ke sumbernya lewat Payments API v3 (`POST /refunds`).
// SERVER ONLY (memegang XENDIT_SECRET_KEY).
//
// ⚠️ INI MEMINDAHKAN UANG SUNGGUHAN. Berbeda dari seluruh panggilan Xendit lain di project ini
// (membuat sesi, membatalkan sesi, membaca sesi), yang ini mengirim uang keluar dan TIDAK BISA
// ditarik kembali. Satu-satunya pemanggil yang sah: route handler ber-requireAdminRole.
//
// ── Satu endpoint untuk semua kanal yang bisa di-refund ──
// Pengganti `POST /ewallets/charges/{ewc_}/refunds` & `/void` dari eWallets API lama (legacy).
// Perbedaan void (hari yang sama) vs refunds (H+1) TIDAK ada lagi: satu `POST /refunds` dengan
// `payment_request_id` `pr-…`, dan Xendit yang menentukan jalurnya. Status jawabannya bisa
// SUCCEEDED (tuntas) atau PENDING (asinkron; hasil sesungguhnya lewat callback refund.succeeded /
// refund.failed).
//
// ── Transfer bank / VA TIDAK BISA ──
// Bukan "belum dibangun" — Xendit menjawab 403 REFUND_NOT_SUPPORTED. Pengembaliannya adalah payout
// BARU ke rekening pembeli (dijadwalkan terpisah lewat Payouts API; sementara manual dari
// dashboard). Pemanggil menyaring keluarga metode bayarnya SEBELUM sampai ke sini; modul ini
// hanya memastikan id-nya berbentuk payment request supaya kekeliruan berhenti sebelum jaringan.

// Gagalkan BUILD bila modul ini pernah tertarik ke bundle komponen client (SEC-050).
import 'server-only'

import { xenditCredentials, xenditUrl } from '@/lib/xendit/config'
import { asNumber, asString, potong, xenditErrorCode } from '@/lib/xendit/util'

const LOG = '[xendit-refund]'

const REFUND_PATH = '/refunds'
const REQUEST_TIMEOUT_MS = 15_000

// Payment request id selalu berawalan ini. Pagar terakhir: id sesi (`ps-`) atau invoice lama yang
// tersasar ke sini akan berhenti sebelum menyentuh jaringan.
export const PAYMENT_REQUEST_PREFIX = 'pr-'

// Alasan refund yang dikenal Xendit (enum Payments_API_Reason).
export type RefundReason = 'FRAUDULENT' | 'DUPLICATE' | 'REQUESTED_BY_CUSTOMER' | 'CANCELLATION' | 'OTHERS'

export type RefundResult =
  | { ok: true; reference: string; status: string; feeAmount: number; raw: string }
  | { ok: false; reason: RefundFailure; detail: string; errorCode?: string }

export type RefundFailure =
  | 'not-configured' // env belum lengkap / kunci LIVE di luar produksi
  | 'not-refundable' // bukan payment request, atau kanalnya tak mendukung refund (403)
  | 'http-error' // ditolak Xendit dengan kode yang jelas
  | 'bad-shape' // respons tak terbaca
  | 'network' // timeout / jaringan

// Kode 403 Xendit yang berarti kanal pembayarannya memang tak bisa dikembalikan lewat API.
const TAK_DIDUKUNG = new Set(['REFUND_NOT_SUPPORTED', 'PARTIAL_REFUND_NOT_SUPPORTED'])

export type RefundInput = {
  paymentRequestId: string // `pr-…` dari GET /sessions/{id}
  amount?: number // dikosongkan = penuh
  reason: RefundReason
  // Referensi milik kita (mis. nomor invoice) — muncul kembali di objek refund & callback-nya.
  referenceId?: string
  // Kunci idempotency. Dikirim sebagai `Idempotency-key` — header yang dipakai Payments/Payouts
  // API v3 (referensi `POST /refunds` sendiri tak menyebutnya, jadi ini jaring KEDUA yang
  // best-effort; jaring pertama adalah klaim database di pemanggil). Acak per percobaan dan
  // SENGAJA berbeda dari refund_reference: percobaan ulang yang sah setelah penolakan pasti harus
  // menjadi permintaan baru, bukan dijawab Xendit dengan penolakan lama dari cache-nya.
  idempotencyKey?: string
}

// Menjalankan pengembalian dana. TIDAK menyentuh database — pemanggil yang menyimpan hasilnya.
export async function refundPaymentRequest(input: RefundInput): Promise<RefundResult> {
  const id = input.paymentRequestId.trim()
  if (!id.startsWith(PAYMENT_REQUEST_PREFIX)) {
    return {
      ok: false,
      reason: 'not-refundable',
      detail: `id "${id.slice(0, 20)}" bukan payment request (harus berawalan ${PAYMENT_REQUEST_PREFIX}).`,
    }
  }

  const credentials = xenditCredentials()
  if (!credentials.ok) {
    console.warn(`${LOG} DIBATALKAN — ${credentials.detail}`)
    return { ok: false, reason: 'not-configured', detail: credentials.detail }
  }

  const body = {
    payment_request_id: id,
    reason: input.reason,
    currency: 'IDR',
    ...(typeof input.amount === 'number' ? { amount: Math.round(input.amount) } : {}),
    ...(input.referenceId ? { reference_id: input.referenceId } : {}),
  }

  console.log(`${LOG} refund ${id} (kunci ${credentials.live ? 'LIVE' : 'test'}, ${JSON.stringify(body)})`)

  try {
    const res = await fetch(xenditUrl(REFUND_PATH), {
      method: 'POST',
      headers: {
        Authorization: credentials.authHeader,
        'Content-Type': 'application/json',
        ...(input.idempotencyKey ? { 'Idempotency-key': input.idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const text = await res.text()

    if (!res.ok) {
      const errorCode = xenditErrorCode(text)
      return {
        ok: false,
        reason: errorCode && TAK_DIDUKUNG.has(errorCode) ? 'not-refundable' : 'http-error',
        detail: potong(text),
        ...(errorCode ? { errorCode } : {}),
      }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      // Uang MUNGKIN sudah terkirim (HTTP 200) tapi kita tak bisa memastikan apa pun dari
      // responsnya. Dilaporkan gagal supaya admin memeriksa dashboard — bukan dicatat berhasil
      // dengan referensi karangan.
      return { ok: false, reason: 'bad-shape', detail: `HTTP ${res.status} tapi respons bukan JSON: ${potong(text, 200)}` }
    }

    const root = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>
    const reference = asString(root.id) ?? ''
    const status = asString(root.status) ?? ''

    console.log(`${LOG} refund ${id} → ${status || 'tanpa status'} ref=${reference || '-'}`)
    return {
      ok: true,
      reference,
      // Status apa pun selain yang tertulis dianggap "belum pasti" oleh pemanggil; tanpa status
      // sama sekali diperlakukan PENDING, bukan SUCCEEDED — jangan pernah menebak uang sudah kembali.
      status: status || 'PENDING',
      feeAmount: asNumber(root.refund_fee_amount),
      raw: potong(text),
    }
  } catch (e) {
    // Hanya `name`: pesan error fetch di sebagian runtime memuat detail request.
    //
    // ⚠️ Timeout di sini TIDAK berarti uangnya tak terkirim — permintaannya bisa saja sampai dan
    // diproses setelah kita berhenti menunggu. Pemanggil WAJIB memperlakukan ini sebagai
    // "tidak diketahui" dan menyuruh admin memeriksa dashboard, bukan mengulang panggilannya.
    return { ok: false, reason: 'network', detail: e instanceof Error ? e.name : 'unknown' }
  }
}
