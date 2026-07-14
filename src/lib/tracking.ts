// src/lib/tracking.ts
// Logika pelacakan pesanan (murni, tanpa UI) — dipakai halaman /track.
//
// SEMENTARA: stepper & riwayat perjalanan di-generate dari order_status + created_at,
// bukan dari API kurir (Mengantar belum menyediakan riwayat transit + belum ada resi asli).
// Dibuat terpisah agar mudah diganti data asli (GET /order?tracking_id=) begitu tersedia:
// cukup ganti isi generateTrackingHistory() tanpa menyentuh komponen tampilan.

import type { Order, OrderFulfillmentStatus } from '@/types/order'

// === Stepper status pengiriman (5 tahap horizontal) ===

export type ShippingStepKey = 'created' | 'processing' | 'shipped' | 'delivering' | 'arrived'

export type ShippingStep = { key: ShippingStepKey; label: string }

// Urutan tetap 5 tahap sesuai desain
export const SHIPPING_STEPS: ShippingStep[] = [
  { key: 'created', label: 'Pesanan Dibuat' },
  { key: 'processing', label: 'Diproses' },
  { key: 'shipped', label: 'Dikirim' },
  { key: 'delivering', label: 'Sedang Diantar' },
  { key: 'arrived', label: 'Sampai Tujuan' },
]

// Indeks tahap "saat ini" berdasar order_status. -1 = dibatalkan (di luar alur normal).
// Catatan: DB tak punya status "Sedang Diantar" tersendiri → step 3 hanya tercapai saat 'Selesai'.
export function getCurrentStepIndex(status: OrderFulfillmentStatus | undefined): number {
  switch (status) {
    case 'Menunggu Pembayaran':
      return 0
    case 'Diproses':
      return 1
    case 'Dikirim':
      return 2
    case 'Selesai':
      return 4
    case 'Dibatalkan':
      return -1
    default:
      return 0 // status tak dikenal / kosong (baris lama) → anggap baru dibuat
  }
}

// Apakah pesanan dibatalkan (tampilan stepper diganti keadaan khusus).
export function isOrderCancelled(order: Order): boolean {
  return order.status === 'Dibatalkan'
}

// === Riwayat perjalanan (timeline) ===

export type TrackingHistoryEntry = {
  timestamp: string // sudah diformat "22 Okt, 14.00"
  title: string
  description: string
}

// Format tanggal+jam Indonesia: "22 Okt, 14.00"
function formatStamp(date: Date): string {
  const tgl = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' }).format(date)
  const jam = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
  return `${tgl}, ${jam}`
}

// Definisi tiap tahap riwayat + offset jam (dari created_at) — nilai masuk akal, deterministik.
const HISTORY_STAGES: { minStep: number; offsetHours: number; title: string; description: string }[] = [
  { minStep: 0, offsetHours: 0, title: 'Pesanan berhasil dibuat', description: 'Pesanan Anda telah masuk ke sistem Infarm.' },
  { minStep: 0, offsetHours: 0.4, title: 'Pesanan dikonfirmasi', description: 'Pesanan dikonfirmasi dan menunggu proses pengecekan stok.' },
  { minStep: 1, offsetHours: 15, title: 'Pesanan sedang dikemas', description: 'Pesanan sedang dikemas oleh tim gudang Infarm.' },
  { minStep: 2, offsetHours: 20, title: 'Kurir menjemput paket', description: 'Kurir telah menjemput paket dari gudang Infarm dan menuju pusat penyortiran.' },
  { minStep: 4, offsetHours: 44, title: 'Paket sedang diantar', description: 'Paket sedang diantar menuju alamat tujuan.' },
  { minStep: 4, offsetHours: 52, title: 'Paket sampai tujuan', description: 'Paket telah sampai di alamat tujuan.' },
]

// Membuat riwayat perjalanan (terbaru di indeks 0) dari status & created_at pesanan.
// Hanya menampilkan tahap yang sudah tercapai sesuai currentStep. Kosong bila dibatalkan.
// GANTI fungsi ini dengan data asli dari API Mengantar saat tracking real tersedia.
export function generateTrackingHistory(order: Order): TrackingHistoryEntry[] {
  if (isOrderCancelled(order)) {
    const base = new Date(order.date)
    const t = Number.isNaN(base.getTime()) ? new Date(order.date) : base
    return [
      {
        timestamp: formatStamp(t),
        title: 'Pesanan dibatalkan',
        description: 'Pesanan ini telah dibatalkan.',
      },
    ]
  }

  const base = new Date(order.date)
  if (Number.isNaN(base.getTime())) return []
  const current = getCurrentStepIndex(order.status)

  const entries = HISTORY_STAGES.filter((s) => current >= s.minStep).map((s) => ({
    timestamp: formatStamp(new Date(base.getTime() + s.offsetHours * 3_600_000)),
    title: s.title,
    description: s.description,
  }))

  // Terbaru di atas (indeks 0)
  return entries.reverse()
}
