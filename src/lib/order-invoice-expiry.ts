// src/lib/order-invoice-expiry.ts
// Membatalkan sesi pembayaran Xendit sebuah pesanan yang BARU SAJA dibatalkan. SERVER ONLY.
//
// ⚠️ JANGAN diimpor dari komponen 'use client' — modul ini memanggil lib/xendit/session.ts yang
// memegang XENDIT_SECRET_KEY.
//
// Nama berkas & kolom DB (`invoice_expired_at`, `invoice_expire_error`) dipertahankan dari era
// Invoice API v2: maknanya sama persis — "tautan pembayaran pesanan ini sudah ditutup" — hanya
// mekanismenya yang berganti dari `POST /invoices/{id}/expire!` ke `POST /sessions/{id}/cancel`.
//
// ── Masalah yang ditutup ──
// Membatalkan pesanan tidak mematikan sesi pembayarannya. Tautan pembayaran tetap hidup sampai
// kedaluwarsa sendiri (24 jam), dan selama itu pembeli masih bisa membayarnya — dari email lama,
// atau tab yang belum ditutup. Webhook SUDAH menolak menghidupkan pesanannya kembali, tapi uangnya
// tetap masuk dan pembeli tak menerima apa pun.
//
// ── Kenapa mencegah jauh lebih penting daripada menyembuhkan ──
// Pembayaran lewat Virtual Account / transfer bank TIDAK BISA di-refund Xendit (terverifikasi
// 2026-09-10). Uang yang terlanjur masuk hanya bisa dikembalikan lewat payout BARU ke rekening
// pembeli — data yang tak pernah kita kumpulkan — dan menanggung biaya tersendiri. Satu panggilan
// pembatalan sesi menutup pintu itu sebelum uangnya masuk.
//
// ── Dipakai di TIGA jalur pembatalan ──
// Berbeda dari penghapusan penjemputan Mengantar, yang hanya relevan di OMS karena pembeli tak
// pernah bisa membatalkan pesanan ber-resi. Di sini justru KEBALIKANNYA: pembatalan oleh pembeli
// hampir selalu terjadi pada pesanan yang BELUM dibayar — persis keadaan yang sesinya masih hidup.
// Jadi ketiganya wajib memanggil ini:
//   - PATCH /api/orders/update-status   (admin OMS)
//   - PATCH /api/orders/cancel          (pembeli, tautan token)
//   - POST  /api/orders/cancel-by-phone (pembeli, no. telepon)
//
// Jalur keempat — `expireOrder` (cron kedaluwarsa) — SENGAJA tidak memakainya: sesi di sana memang
// sudah mati dengan sendirinya, dan justru itulah yang memicu pembatalannya.

import { cancelXenditSession } from '@/lib/xendit/session'
import { setInvoiceExpiry } from '@/lib/mock-db/orders'
import type { Order } from '@/types/order'

const LOG = '[invoice-expiry]'

export type InvoiceExpiryReport =
  | { attempted: false; reason: 'NO_INVOICE' | 'ALREADY_PAID' | 'ALREADY_EXPIRED' }
  | { attempted: true; ok: true }
  | { attempted: true; ok: false; reason: string; detail: string; needsManual: true }

// Membatalkan sesi pembayaran pesanan yang sudah dibatalkan.
//
// TIDAK PERNAH melempar dan TIDAK PERNAH menggagalkan pembatalan. Pembatalannya sendiri sudah
// tersimpan sebelum fungsi ini dipanggil; kegagalan di sini hanya berarti satu lapis perlindungan
// tak terpasang, dan itu dicatat supaya bisa ditindaklanjuti — bukan dilempar balik ke pemanggil
// yang lalu membatalkan pembatalan.
export async function expireInvoiceForCancelledOrder(order: Order): Promise<InvoiceExpiryReport> {
  // Tak pernah ada sesi yang diterbitkan → tak ada yang perlu dibatalkan. Ini normal: pembeli
  // bisa membatalkan sebelum pernah menekan "Bayar Sekarang".
  const sessionId = order.transactionId?.trim()
  if (!sessionId) return { attempted: false, reason: 'NO_INVOICE' }

  // Sudah dibayar → sesinya tak bisa dan tak perlu dibatalkan. Uangnya sudah masuk; yang
  // dibutuhkan pesanan seperti ini adalah pengembalian dana, bukan penutupan sesi.
  if (order.paymentStatus === 'Lunas') return { attempted: false, reason: 'ALREADY_PAID' }

  // Idempoten. Pembatalan bisa dicoba berulang (double-click, retry jaringan), dan membatalkan sesi
  // yang sudah mati hanya membuang satu panggilan lalu memancing galat yang membingungkan.
  if (order.invoiceExpiredAt) return { attempted: false, reason: 'ALREADY_EXPIRED' }

  const hasil = await cancelXenditSession(sessionId)

  if (hasil.ok) {
    await setInvoiceExpiry(order.orderId, { expired: true })
    console.log(`${LOG} ${order.orderId} sesi pembayaran dibatalkan (${hasil.status})`)
    return { attempted: true, ok: true }
  }

  const detail = `${hasil.reason}: ${hasil.detail}`
  await setInvoiceExpiry(order.orderId, { expired: false, error: detail })
  console.error(
    `${LOG} ${order.orderId} DIBATALKAN tapi sesi pembayarannya MASIH HIDUP — ${detail}. ` +
      'Batalkan manual di dashboard Xendit; pembayaran yang terlanjur masuk lewat VA tak bisa di-refund.',
  )
  return { attempted: true, ok: false, reason: hasil.reason, detail: hasil.detail, needsManual: true }
}
