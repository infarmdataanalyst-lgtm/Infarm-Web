// src/lib/buyer-orders.ts
// Aturan tampilan daftar pesanan pembeli di halaman Pesanan Saya. MURNI (tanpa I/O) supaya bisa
// diuji dan dipakai di server (API) maupun klien.
//
// Dua hal yang diatur di sini:
//   1. Ringkasan ulasan sebuah pesanan (boleh diulas? produk mana yang belum?)
//   2. Urutan daftar: pesanan yang MENUNGGU ULASAN naik ke atas, sisanya terbaru → terlama.
//
// Kenapa urutannya di sini, bukan di SQL: "belum diulas" lahir dari tabel reviews, bukan kolom
// orders, jadi SQL-nya butuh join + agregat untuk tiap permintaan. Dengan jumlah pesanan per email
// yang kecil, mengurutkan setelah data terkumpul jauh lebih sederhana dan hasilnya tetap datang dari
// server — klien mana pun menerima urutan yang sama.

import type { Order } from '@/types/order'
import type { PublicOrderReview, PublicTrackOrder } from '@/types/public-order'
import { evaluateReviewEligibility } from '@/lib/review-eligibility'
import { isActiveOrderStatus } from '@/lib/order-status-machine'

// Ringkasan ulasan satu pesanan. `reviewedProductIds` = product_id yang sudah punya ulasan untuk
// pesanan ini (dari tabel reviews). `nowMs` disuntikkan agar batas jendela 14 hari bisa diuji.
export function summarizeOrderReview(
  order: Pick<Order, 'status' | 'deliveredAt' | 'items'>,
  reviewedProductIds: Iterable<string>,
  nowMs = Date.now(),
): PublicOrderReview {
  const reviewed = new Set(reviewedProductIds)
  const pendingProductIds = order.items
    .map((it) => it.productId)
    .filter((id) => !reviewed.has(id))
  const kelayakan = evaluateReviewEligibility({ status: order.status, deliveredAt: order.deliveredAt }, nowMs)

  return {
    eligible: kelayakan.ok,
    ...(kelayakan.ok
      ? kelayakan.deadlineMs
        ? { deadline: new Date(kelayakan.deadlineMs).toISOString() }
        : {}
      : { blockCode: kelayakan.code, blockMessage: kelayakan.message }),
    pendingProductIds,
    reviewedCount: order.items.length - pendingProductIds.length,
    totalCount: order.items.length,
  }
}

// Pesanan yang masih menunggu ulasan dari pembeli: boleh diulas DAN masih ada produk yang belum.
export function needsReview(order: Pick<PublicTrackOrder, 'review'>): boolean {
  return order.review.eligible && order.review.pendingProductIds.length > 0
}

// Semua produk di pesanan sudah diulas. Pesanan tanpa produk tak pernah "sudah diulas".
export function fullyReviewed(order: Pick<PublicTrackOrder, 'review'>): boolean {
  return order.review.totalCount > 0 && order.review.pendingProductIds.length === 0
}

// Urutan daftar untuk pembeli. Tidak mengubah array masukan.
//
// Kunci pertama: menunggu ulasan (0) sebelum yang tidak (1). Pesanan aktif tak pernah menunggu
// ulasan (belum diterima), jadi di tab Aktif kunci ini seragam dan urutannya murni tanggal. Di tab
// Selesai, yang perlu diulas naik ke atas — itu satu-satunya pekerjaan yang masih menunggu pembeli
// di sana. Kunci kedua: tanggal terbaru dulu, di dalam tiap kelompok.
export function sortBuyerOrders<T extends Pick<PublicTrackOrder, 'review' | 'date'>>(orders: T[]): T[] {
  return [...orders].sort((a, b) => {
    const ka = needsReview(a) ? 0 : 1
    const kb = needsReview(b) ? 0 : 1
    if (ka !== kb) return ka - kb
    return Date.parse(b.date) - Date.parse(a.date)
  })
}

// Pemisah tab. Diekspor supaya hitungan di label tab dan isi daftar berasal dari fungsi yang sama.
export function splitBuyerOrders<T extends Pick<PublicTrackOrder, 'status'>>(orders: T[]): {
  active: T[]
  finished: T[]
} {
  return {
    active: orders.filter((o) => isActiveOrderStatus(o.status)),
    finished: orders.filter((o) => !isActiveOrderStatus(o.status)),
  }
}
