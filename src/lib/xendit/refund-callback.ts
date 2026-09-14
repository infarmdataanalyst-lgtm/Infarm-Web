// src/lib/xendit/refund-callback.ts
// Pengurai callback PENGEMBALIAN DANA dari Xendit. Murni — tanpa I/O, tanpa rahasia — supaya
// bentuknya bisa diuji dengan payload sungguhan tanpa menjalankan server.
//
// ── Dua API refund, dua bentuk callback ──
//
//   1. API Refund umum (POST /refunds, Payments v3) — dari dokumentasi Xendit:
//        { "event": "refund.succeeded" | "refund.failed",
//          "data": { "id": "rfd-…", "payment_id": "…", "status": "…", "failure_code": … } }
//
//   2. API refund eWallet (POST /ewallets/charges/{id}/refunds) — YANG DIPAKAI APLIKASI INI.
//      TERUKUR dari callback sungguhan 2026-09-14 untuk INV-20260910-8CDENJVM:
//        { "event": "ewallet.refund",
//          "data": { "id": "ewr_…", "charge_id": "ewc_…", "status": "SUCCEEDED",
//                    "failure_code": null, "refund_amount": 79080, "channel_code": "ID_SHOPEEPAY", … } }
//
// ── Kenapa modul ini ada ──
// Versi pertama hanya mengenali bentuk 1, ditulis dari dokumentasi sebelum satu pun callback
// sungguhan terlihat. Callback eWallet yang SUDAH berhasil pun ditolak di pintu masuk sebagai
// UNSUPPORTED_PAYLOAD dan dibalas 200 — Xendit menganggapnya selesai dan tak mengirim ulang, sehingga
// pesanannya tertahan di SEDANG_DIPROSES padahal uangnya sudah kembali ke pembeli. Id-nya sendiri
// cocok persis dengan yang tersimpan; yang meleset hanya nama event dan nama field id charge.

export type RefundCallback = {
  event: string
  /** `data.id` — nomor refund: `ewr_…` (eWallet) atau `rfd-…` (API Refund umum). */
  id: string
  /** Id charge aslinya: `data.charge_id` (eWallet) atau `data.payment_id` (API Refund umum). */
  chargeId: string
  status: string
  detail: string
}

function asText(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''
}

// Nama event mentah dari payload apa pun; '' bila tak ada.
//
// Diekspor terpisah supaya callback yang BELUM ditangani bisa dicatat dengan namanya. Kasus pertama
// lenyap sebagai "payload tanpa external_id" tanpa menyebut bahwa ia sebenarnya `ewallet.refund` —
// nama itu saja sudah cukup untuk langsung menemukan penyebabnya.
export function callbackEventName(body: unknown): string {
  if (typeof body !== 'object' || body === null) return ''
  return asText((body as Record<string, unknown>).event)
}

// Apakah nama event ini callback pengembalian dana yang dikenali.
//
// eWallet dicocokkan PERSIS, bukan lewat awalan `ewallet.`: jalur yang sama juga mengirim peristiwa
// lain, dan memperlakukannya sebagai refund bisa menutup pesanan yang salah.
//
// `ewallet.void` SENGAJA BELUM dikenali. Belum pernah terlihat sungguhan, dan pembatalan hari yang sama
// bisa saja membawa bentuk data yang berbeda. Lebih baik ia tercatat jelas sebagai belum ditangani
// daripada dipetakan dari tebakan — kesalahan persis itulah yang melahirkan modul ini.
export function isRefundEvent(event: string): boolean {
  const e = event.trim().toLowerCase()
  return e === 'ewallet.refund' || e.startsWith('refund.')
}

// Mengurai callback pengembalian dana. null = bukan callback pengembalian dana.
//
// Pengenalannya lewat nama `event`, BUKAN lewat ada-tidaknya field tertentu: callback lain juga punya
// `data` dan `status`, dan menebak dari bentuk akan membuat callback asing diperlakukan sebagai refund.
export function parseRefundCallback(body: unknown): RefundCallback | null {
  const event = callbackEventName(body)
  if (!isRefundEvent(event)) return null

  const root = body as Record<string, unknown>
  const data =
    typeof root.data === 'object' && root.data !== null
      ? (root.data as Record<string, unknown>)
      : {}

  return {
    event,
    id: asText(data.id),
    chargeId: asText(data.charge_id) || asText(data.payment_id),
    status: asText(data.status),
    detail: [asText(data.status), asText(data.failure_code)].filter(Boolean).join(' / '),
  }
}
