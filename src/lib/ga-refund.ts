// src/lib/ga-refund.ts
// Melaporkan pengembalian dana ke GA4 (event `refund`) — SATU kali per pesanan. SERVER ONLY.
//
// ── Kapan dipanggil ──
// Saat pesanan BERPINDAH ke SUDAH_REFUND, yaitu dana benar-benar sudah kembali ke pembeli
// (keputusan pemilik 2026-10-05; bukan saat PERLU_REFUND, karena refund yang akhirnya ditutup
// TIDAK_PERLU tak bisa "ditarik" dari GA4). Ada tiga jalur, dan semuanya memanggil ini:
//   A. callback Xendit refund.succeeded      → webhooks/xendit (settleRefundByReference)
//   B. refund lewat Xendit dari OMS, SUCCEEDED → oms/refunds/xendit (finalizeClaimedRefund)
//   C. refund manual (transfer VA) ditandai selesai di OMS → oms/refunds (resolveRefund)
// Pemanggil hanya memanggilnya bila DIA pemenang compare-and-swap ke SUDAH_REFUND.
//
// Refund yang dimulai langsung dari dashboard Xendit TIDAK lewat jalur mana pun di atas (callback-nya
// tak cocok dengan pesanan mana pun), jadi tak pernah dilaporkan. Refund harus dijalankan dari OMS.
//
// ── Satu event per pesanan ──
// Lapis 1: hanya pemenang perpindahan ke SUDAH_REFUND yang memanggil fungsi ini.
// Lapis 2: klaim `orders.ga_refund_sent_at` (claimGaRefundSend) sebelum mengirim.
// GA4 sendiri TIDAK diandalkan untuk membuang refund kembar.
//
// TIDAK PERNAH melempar: dananya sudah kembali dan sudah tercatat. Laporan analitik yang gagal tak
// boleh menggagalkan penutupan refund maupun balasan webhook ke Xendit.

import 'server-only'

import { gaSkipReason, sendRefundEvent } from '@/lib/analytics-server'
import { claimGaRefundSend, releaseGaRefundClaim } from '@/lib/mock-db/orders'
import type { Order } from '@/types/order'

export type GaRefundReport =
  | 'SENT'
  | 'SKIPPED_NOT_REFUNDED'
  | 'SKIPPED_NOT_CONFIGURED'
  | 'SKIPPED_NO_CLIENT_ID'
  | 'ALREADY_REPORTED'
  | 'FAILED'

// Mengirim event `refund` untuk pesanan yang BARU SAJA dinyatakan SUDAH_REFUND.
// `order` harus hasil baca SETELAH status berubah.
export async function reportRefundToGa(order: Order, log: string): Promise<GaRefundReport> {
  try {
    if (order.refundStatus !== 'SUDAH_REFUND') return 'SKIPPED_NOT_REFUNDED'

    // Diperiksa SEBELUM klaim: klaim tanpa pengiriman akan menandai pesanan "sudah dilaporkan"
    // padahal tidak — dan menghapusnya dari daftar susulan selamanya.
    const skip = gaSkipReason(order)
    if (skip === 'not-configured') {
      console.log(`${log} GA4 refund dilewati: NEXT_PUBLIC_GA_ID / GA_API_SECRET belum di-set`)
      return 'SKIPPED_NOT_CONFIGURED'
    }
    if (skip === 'no-client-id') {
      // Tanpa client_id, purchase pesanan ini juga tak pernah terkirim. Refund untuknya akan
      // mengurangi revenue transaksi yang tak pernah ada di GA4.
      console.log(`${log} GA4 refund dilewati: pesanan ${order.orderId} tanpa ga_client_id`)
      return 'SKIPPED_NO_CLIENT_ID'
    }

    const claim = await claimGaRefundSend(order.orderId)
    if (claim === 'TAKEN') {
      console.log(`${log} GA4 refund ${order.orderId} sudah dilaporkan sebelumnya — dilewati`)
      return 'ALREADY_REPORTED'
    }

    const result = await sendRefundEvent(order, log)
    if (result.ok) return 'SENT'

    // Klaim dilepas HANYA bila Google pasti tak mencatatnya (balasan non-2xx). Timeout/jaringan
    // TIDAK dilepas: permintaannya bisa saja sampai, dan menyusulkannya lagi berarti refund ganda —
    // revenue minus untuk satu transaksi. Lebih baik satu refund yang mungkin hilang (terlihat di
    // log) daripada dua yang pasti salah.
    if (claim === 'CLAIMED' && result.reason === 'http-error') {
      await releaseGaRefundClaim(order.orderId)
    } else if (result.reason === 'network') {
      console.error(
        `${log} GA4 refund ${order.orderId} status TAK PASTI (jaringan/timeout) — ga_refund_sent_at dibiarkan terisi; periksa DebugView/laporan sebelum menyusulkan`,
      )
    }
    return 'FAILED'
  } catch (e) {
    console.error(
      `${log} GA4 refund ${order.orderId} galat tak terduga: ${e instanceof Error ? e.name : 'unknown'}`,
    )
    return 'FAILED'
  }
}
