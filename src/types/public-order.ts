// src/types/public-order.ts
// Bentuk pesanan yang AMAN dikirim ke pembeli tamu (guest) — tanpa alamat, nama penuh, maupun
// nomor telepon. Inilah respons /api/orders/track-by-email dan bahan baku halaman Pesanan Saya.
//
// Dulu tipe ini disalin di tiga halaman (lacak, batalkan, ulasan). Sejak ketiganya dilebur ke satu
// halaman (2026-10-09), bentuknya hidup di satu tempat supaya API dan tampilan tak bisa berbeda.

import type { ReviewBlockCode } from '@/lib/review-eligibility'

export type PublicOrderItem = {
  productId: string
  name: string
  quantity: number
  imageUrl: string | null // foto produk (dari products.image_url) — non-sensitif
}

// Keadaan ulasan satu pesanan, dihitung SERVER dari aturan review-eligibility + tabel reviews.
// Klien hanya menampilkan — kalau ia menghitung sendiri, badge bisa menjanjikan sesuatu yang lalu
// ditolak endpoint tulis.
export type PublicOrderReview = {
  // Boleh menulis ulasan sekarang (paket sudah diterima / Selesai, jendela 14 hari belum tutup).
  eligible: boolean
  // Hanya bila eligible === false: alasan yang sudah siap tampil.
  blockCode?: ReviewBlockCode
  blockMessage?: string
  // Batas akhir mengulas (ISO), hanya bila masih boleh dan jendelanya terbatas.
  deadline?: string
  // Produk di pesanan ini yang BELUM diulas. Kosong = semua sudah diulas.
  pendingProductIds: string[]
  reviewedCount: number
  totalCount: number
}

export type PublicTrackOrder = {
  orderId: string
  status: string
  paymentStatus: string
  trackingNumber: string | null
  courier: string | null
  date: string
  customerNameMasked: string
  items: PublicOrderItem[]
  review: PublicOrderReview
}
