// src/lib/review-eligibility.ts
// Aturan SATU-SATUNYA tentang pesanan mana yang boleh diulas. Murni — tanpa I/O, tanpa rahasia,
// dipakai bersama oleh route handler (otoritatif) DAN halaman /review (tampilan).
//
// Pola yang sama dengan `evaluateBuyerCancel` di src/lib/order-cancellation.ts, dan alasannya
// sama: selama keduanya memanggil fungsi ini dengan status yang sama, mustahil layar menjanjikan
// sesuatu yang lalu ditolak server.
//
// ── Kenapa "harus Selesai", bukan "asal bukan Dibatalkan" ──
// Versi sebelumnya hanya menolak status `Dibatalkan` di kelima titik pemeriksaan. Akibatnya
// pesanan berstatus `Menunggu Pembayaran` — yang BELUM DIBAYAR SAMA SEKALI — ikut muncul sebagai
// bisa diulas, dan `create-by-email` menerimanya. Seseorang bisa checkout, tidak membayar, lalu
// menulis ulasan; di mata sistem ia tetap terhitung "pembeli terverifikasi".
//
// Ulasan menyatakan pengalaman MEMAKAI barang. Satu-satunya status yang menjamin barangnya sudah
// sampai adalah `Selesai`, jadi itulah syaratnya — bukan daftar hitam status yang bocor setiap
// kali status baru ditambahkan.

import type { OrderFulfillmentStatus } from '@/types/order'

// Kenapa sebuah pesanan tak bisa diulas. Dibedakan, bukan satu pesan gabungan, karena tindakan
// pembeli berbeda untuk masing-masing: yang dibatalkan tak akan pernah bisa, yang belum selesai
// hanya perlu menunggu.
export type ReviewBlockCode = 'CANCELLED' | 'NOT_COMPLETED'

export type ReviewEligibility =
  | { ok: true }
  | { ok: false; code: ReviewBlockCode; message: string }

// Apakah pesanan berstatus ini boleh diulas.
//
// Status `undefined` (pesanan lama sebelum kolomnya ada) diperlakukan BELUM SELESAI — menolak
// dengan aman. Menganggapnya boleh berarti membuka kembali persis celah yang ditutup di sini.
export function evaluateReviewEligibility(
  status: OrderFulfillmentStatus | undefined,
): ReviewEligibility {
  if (status === 'Dibatalkan') {
    return {
      ok: false,
      code: 'CANCELLED',
      message: 'Pesanan ini dibatalkan, jadi tidak bisa diulas.',
    }
  }

  if (status !== 'Selesai') {
    return {
      ok: false,
      code: 'NOT_COMPLETED',
      message: `Bisa diulas setelah pesanan selesai. Status sekarang: ${status ?? 'belum diketahui'}.`,
    }
  }

  return { ok: true }
}
