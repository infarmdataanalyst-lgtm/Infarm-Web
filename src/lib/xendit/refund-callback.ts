// src/lib/xendit/refund-callback.ts
// Pengurai callback PENGEMBALIAN DANA dari Xendit. Murni — tanpa I/O, tanpa rahasia — supaya
// bentuknya bisa diuji dengan payload sungguhan tanpa menjalankan server.
//
// ── Bentuk callback Refund (Payments API v3) ──
// Dari referensi API Xendit (apidocs/refund-webhook-notification, 2026-09-28):
//   { "event": "refund.succeeded" | "refund.failed",
//     "business_id": "…", "created": "…",
//     "data": { "id": "rfd-…", "payment_request_id": "pr-…", "payment_id": "py-…",
//               "reference_id": "…", "status": "SUCCEEDED" | "FAILED" | "PENDING" | "CANCELLED",
//               "amount": 10000, "currency": "IDR", "reason": "CANCELLATION",
//               "failure_code": null, "refund_fee_amount": 4000, … } }
//
// ── Kenapa tiga id dikembalikan ──
// Benang penghubung ke pesanan adalah `orders.refund_reference`, dan isinya BERGANTI selama proses:
// saat diklaim ia berisi `payment_request_id` (sudah diketahui SEBELUM Xendit dipanggil), lalu
// ditimpa nomor refund `rfd-…` begitu balasan HTTP diterima. Callback yang tiba lebih cepat daripada
// balasan HTTP hanya bisa cocok lewat payment_request_id; yang tiba sesudahnya lewat `rfd-…`. Route
// mencoba semuanya berurutan.
//
// ── Sejarah ──
// Versi pertama modul ini (2026-09-14) lahir karena callback eWallet lama (`ewallet.refund`,
// `data.charge_id` "ewc_…") ditolak parser yang ditulis dari dokumentasi. Jalur eWallets API itu
// sudah dilepas (legacy) bersama migrasi ke Payments v3 2026-09-28; bentuk di atas adalah yang
// didokumentasikan untuk `POST /refunds`, dan — pelajaran dari kasus pertama — WAJIB dicocokkan
// dengan callback sungguhan pada refund pertama di mode test.

export type RefundCallback = {
  event: string
  /** `data.id` — nomor refund `rfd-…`. */
  id: string
  /** `data.payment_request_id` — kunci klaim sebelum nomor refund diketahui. */
  paymentRequestId: string
  /** `data.payment_id` — id pembayaran `py-…`; cadangan pencocokan. */
  paymentId: string
  status: string
  detail: string
}

function asText(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''
}

// Nama event mentah dari payload apa pun; '' bila tak ada.
//
// Diekspor terpisah supaya callback yang BELUM ditangani bisa dicatat dengan namanya — nama itu
// saja sering sudah cukup untuk langsung menemukan penyebabnya.
export function callbackEventName(body: unknown): string {
  if (typeof body !== 'object' || body === null) return ''
  return asText((body as Record<string, unknown>).event)
}

// Apakah nama event ini callback pengembalian dana yang dikenali.
export function isRefundEvent(event: string): boolean {
  return event.trim().toLowerCase().startsWith('refund.')
}

// Mengurai callback pengembalian dana. null = bukan callback pengembalian dana.
//
// Pengenalannya lewat nama `event`, BUKAN lewat ada-tidaknya field tertentu: callback pembayaran
// juga punya `data.payment_request_id` dan `data.status`, dan menebak dari bentuk akan membuat
// callback pembayaran diperlakukan sebagai refund.
export function parseRefundCallback(body: unknown): RefundCallback | null {
  const event = callbackEventName(body)
  if (!isRefundEvent(event)) return null

  const root = body as Record<string, unknown>
  const data = typeof root.data === 'object' && root.data !== null ? (root.data as Record<string, unknown>) : {}

  return {
    event,
    id: asText(data.id),
    paymentRequestId: asText(data.payment_request_id),
    paymentId: asText(data.payment_id),
    status: asText(data.status),
    detail: [asText(data.status), asText(data.failure_code)].filter(Boolean).join(' / '),
  }
}
