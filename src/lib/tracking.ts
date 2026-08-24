// src/lib/tracking.ts
// Logika pelacakan pesanan (murni, tanpa UI) — dipakai halaman /track.
//
// SEMENTARA: stepper & riwayat perjalanan di-generate dari order_status + created_at,
// bukan dari API kurir (Mengantar belum menyediakan riwayat transit + belum ada resi asli).
// Dibuat terpisah agar mudah diganti data asli (GET /order?tracking_id=) begitu tersedia:
// cukup ganti isi generateTrackingHistory() tanpa menyentuh komponen tampilan.

import { canTransition } from '@/lib/order-status-machine'
import type { Order, OrderFulfillmentStatus } from '@/types/order'

// === Stepper status pengiriman (4 tahap horizontal) ===

export type ShippingStepKey = 'created' | 'processing' | 'shipped' | 'arrived'

export type ShippingStep = { key: ShippingStepKey; label: string }

// Urutan tetap 4 tahap.
//
// Tahap "Sedang Diantar" DIHAPUS (2026-08-21). Alasannya: `order_status` di DB tak punya padanan
// untuk tahap itu — nilainya hanya PENDING/PROCESSING/SHIPPED/COMPLETED/CANCELLED. Akibatnya
// tahap itu tak pernah bisa jadi tahap "saat ini": ia langsung terlewati dari `Dikirim` ke
// `Selesai`, jadi yang dilihat pembeli cuma bulatan abu-abu yang tak pernah menyala.
// Menambahkannya kembali berarti menambah status baru di DB lebih dulu, bukan sekadar menambah
// entri di sini.
export const SHIPPING_STEPS: ShippingStep[] = [
  { key: 'created', label: 'Pesanan Dibuat' },
  { key: 'processing', label: 'Diproses' },
  { key: 'shipped', label: 'Dikirim' },
  { key: 'arrived', label: 'Sampai Tujuan' },
]

// Indeks tahap terakhir — dipakai sebagai satu-satunya sumber angka "tahap selesai" supaya
// penambahan/pengurangan tahap tak menyisakan angka ajaib di beberapa tempat.
const LAST_STEP_INDEX = SHIPPING_STEPS.length - 1

// Indeks tahap "saat ini" berdasar order_status. -1 = dibatalkan (di luar alur normal).
export function getCurrentStepIndex(status: OrderFulfillmentStatus | undefined): number {
  switch (status) {
    case 'Menunggu Pembayaran':
      return 0
    case 'Diproses':
      return 1
    case 'Dikirim':
      return 2
    case 'Selesai':
      return LAST_STEP_INDEX
    case 'Dibatalkan':
      return -1
    default:
      return 0 // status tak dikenal / kosong (baris lama) → anggap baru dibuat
  }
}

// === Tahap dari peristiwa tracking kurir ===
//
// KENAPA PERLU: `order_status` di DB hanya bergerak bila ada yang menggerakkannya — booking kurir
// mengisi `no_tracking` tapi TIDAK mengubah status, dan tak ada proses yang memantau kurir. Jadi
// pesanan yang paketnya sudah di jalan tetap tampil "Diproses". Peristiwa dari kurir adalah sumber
// yang lebih tahu keadaan sebenarnya, jadi ia dipakai untuk MENDORONG stepper maju.
//
// Pencocokan berbasis kata kunci, bukan daftar status tertutup: daftar tertutup akan gagal senyap
// begitu Mengantar/J&T menambah satu status baru. Kata kunci dicek dari tahap TERJAUH ke terdekat.
//
// Kosakata di bawah diambil dari konstanta status di bundel dashboard Mengantar (2026-08-21):
//   IN TRANSIT TO ORIGIN HUB · IN TRANSIT TO NEXT SORTING HUB · ARRIVED AT ORIGIN HUB ·
//   ARRIVED AT DESTINATION HUB · PARCEL MEASUREMENT UPDATED · PARCEL WEIGHT · PARCEL LOST ·
//   ON VEHICLE FOR DELIVERY · ON DELIVERY · AT PUDO · DELIVERY EXCEPTION · PICKUP EXCEPTION ·
//   MAX ATTEMPTS REACHED · RETURNED TO SENDER
// SATU PINTU makna status kurir: kata kunci → tahap stepper + label Bahasa Indonesia.
//
// Tahap dan terjemahan sengaja disatukan di sini. Dua daftar terpisah (satu untuk stepper, satu
// untuk teks) pasti berbeda cepat atau lambat, dan bedanya muncul sebagai halaman yang bertentangan
// dengan dirinya sendiri: baris peristiwa berkata "Sedang diantar kurir" sementara stepper masih
// berhenti di "Diproses".
//
// ⚠️ URUTAN BERMAKNA — pencocokan berhenti di entri PERTAMA yang cocok, jadi yang lebih spesifik
// harus di atas ('arrived at destination' sebelum 'arrived at', 'pickup exception' sebelum apa pun
// yang memuat 'pickup'). Ini beda dari pendekatan sebelumnya yang mengambil tahap tertinggi tanpa
// peduli urutan.
//
// 'delivered' DITULIS PENUH, bukan 'deliver': "DELIVERY EXCEPTION" dan "ON VEHICLE FOR DELIVERY"
// sama-sama memuat "deliver" tapi keduanya BUKAN berarti sampai.
//
// Akhir yang buruk ('returned to sender', 'delivery exception', 'max attempts') tetap bertahap 2
// karena paket SUDAH pernah dikirim. Stepper menunjukkan sejauh mana paket berjalan, bukan apakah
// akhirnya berhasil — keterangannya ada di daftar peristiwa di bawah stepper.
export const COURIER_STATUS_MAP: { keywords: string[]; step: number; label: string }[] = [
  { keywords: ['delivered', 'diterima', 'received by', 'sampai tujuan', 'pod'], step: 3, label: 'Paket diterima' },
  { keywords: ['returned to sender', 'returned'], step: 2, label: 'Paket dikembalikan ke pengirim' },
  { keywords: ['max attempts'], step: 2, label: 'Pengantaran gagal berulang' },
  { keywords: ['delivery exception'], step: 2, label: 'Kendala pengantaran' },
  { keywords: ['on vehicle', 'on delivery', 'out for delivery', 'diantar'], step: 2, label: 'Sedang diantar kurir' },
  { keywords: ['arrived at destination'], step: 2, label: 'Tiba di hub tujuan' },
  { keywords: ['arrived at'], step: 2, label: 'Tiba di hub transit' },
  { keywords: ['in transit'], step: 2, label: 'Dalam perjalanan' },
  { keywords: ['departed'], step: 2, label: 'Berangkat dari hub' },
  { keywords: ['at pudo'], step: 2, label: 'Berada di titik ambil (PUDO)' },
  // 'picked up' (sudah terjadi), BUKAN 'pickup' — kata tunggal itu menyambar "PICKUP EXCEPTION",
  // yaitu penjemputan GAGAL: paketnya belum pernah diambil kurir.
  { keywords: ['picked up', 'manifest', 'shipped', 'dikirim'], step: 2, label: 'Paket dijemput kurir' },
  // Tahap 1: paket masih di gudang asal — belum boleh mendorong stepper ke "Dikirim".
  { keywords: ['pickup exception'], step: 1, label: 'Penjemputan gagal' },
  { keywords: ['parcel weight', 'measurement'], step: 1, label: 'Paket ditimbang di gudang' },
  { keywords: ['parcel lost'], step: 1, label: 'Paket dilaporkan hilang' },
]

// Makna satu teks peristiwa kurir.
// `label: null` = teks tak dikenali → pemanggil menampilkan teks aslinya apa adanya (jangan dibuang:
// bila pemetaan meleset, pembeli masih melihat kabar asli dari kurir). `step: -1` = tak menggerakkan
// stepper.
export function mapCourierEvent(raw: string): { step: number; label: string | null } {
  const text = raw.toLowerCase()
  const hit = COURIER_STATUS_MAP.find((m) => m.keywords.some((k) => text.includes(k)))
  return hit ? { step: hit.step, label: hit.label } : { step: -1, label: null }
}

// Tahap tertinggi yang tersirat dari daftar peristiwa kurir. -1 bila tak ada yang cocok.
// Yang diambil nilai TERTINGGI, jadi urutan daftar peristiwa (terbaru-dulu atau terlama-dulu) tak
// berpengaruh.
export function stepFromTrackingEvents(labels: string[]): number {
  let best = -1
  for (const raw of labels) {
    const { step } = mapCourierEvent(raw)
    if (step > best) best = step
  }
  return best
}

// Tahap final stepper: yang TERTINGGI antara status DB dan peristiwa kurir.
//
// Diambil yang tertinggi, bukan yang terbaru, karena keduanya bisa tak sinkron ke dua arah:
// admin mungkin sudah menandai "Dikirim" sebelum resi aktif di sistem kurir, dan sebaliknya paket
// bisa sudah bergerak sebelum ada yang memperbarui status di OMS. Mundur ke tahap sebelumnya tak
// pernah benar bagi pembeli yang sudah melihat paketnya berjalan.
//
// Pesanan DIBATALKAN tetap -1 apa pun isi peristiwanya — stepper memang disembunyikan untuk itu.
export function resolveStepIndex(
  status: OrderFulfillmentStatus | undefined,
  trackingLabels: string[] = [],
): number {
  const fromStatus = getCurrentStepIndex(status)
  if (fromStatus < 0) return fromStatus
  return Math.max(fromStatus, stepFromTrackingEvents(trackingLabels))
}

// === Label status untuk badge ===

// Label per tahap. Indeksnya sejajar SHIPPING_STEPS, tapi kata-katanya sengaja mengikuti kosakata
// `order_status` di DB (bukan label stepper) supaya badge di /track berbunyi sama dengan status
// yang dilihat admin di OMS.
const STEP_STATUS_LABEL: Record<number, OrderFulfillmentStatus> = {
  0: 'Menunggu Pembayaran',
  1: 'Diproses',
  2: 'Dikirim',
  3: 'Selesai',
}

// Status yang DITAMPILKAN ke pembeli — diturunkan dari tahap final (status DB ∪ peristiwa kurir),
// bukan dari `order_status` mentah.
//
// KENAPA: `order_status` hanya bergerak bila ada yang menggerakkannya di OMS, sementara stepper
// sudah ikut peristiwa kurir. Tanpa ini badge bisa berkata "Diproses" tepat di atas stepper yang
// menyala sampai "Dikirim" — halaman yang bertentangan dengan dirinya sendiri.
//
// TAMPILAN SAJA — tidak menulis apa pun ke DB. OMS tetap satu-satunya penulis `order_status`.
export function displayStatus(
  status: OrderFulfillmentStatus | undefined,
  trackingLabels: string[] = [],
): OrderFulfillmentStatus {
  if (status === 'Dibatalkan') return 'Dibatalkan'
  const step = resolveStepIndex(status, trackingLabels)
  return STEP_STATUS_LABEL[step] ?? status ?? 'Diproses'
}

// === Rencana kenaikan status otomatis (dari peristiwa kurir) ===

// Tahap TERTINGGI yang boleh dicapai otomatis: 2 = 'Dikirim'.
//
// 'Selesai' SENGAJA tidak pernah ditulis otomatis. Ia status FINAL di state machine
// (`Selesai: []`) — sekali ke sana, admin tak punya jalan mundur lewat UI, hanya lewat SQL.
// Scan "delivered" yang keliru bukan hal langka pada kurir, dan mengunci pesanan karena satu scan
// salah jauh lebih mahal daripada satu klik manual di akhir.
export const AUTO_ADVANCE_MAX_STEP = 2

// Urutan status sesuai tangga tahap. Indeksnya sejajar SHIPPING_STEPS.
const STEP_LADDER: OrderFulfillmentStatus[] = [
  'Menunggu Pembayaran',
  'Diproses',
  'Dikirim',
  'Selesai',
]

// Urutan status yang harus DILALUI untuk menaikkan pesanan sesuai peristiwa kurir.
// Array kosong = tak ada yang perlu diubah.
//
// Mengembalikan JALUR, bukan satu status tujuan, karena state machine hanya mengizinkan transisi
// SATU LANGKAH (`Diproses` → `Selesai` ditolak). Pesanan yang tertinggal dua tahap harus menapak
// `Diproses` → `Dikirim` → dst., masing-masing transisi sah. Melonggarkan state machine demi
// lompatan ini akan ikut melonggarkan dropdown OMS — bukan itu yang diinginkan.
//
// Berhenti di transisi pertama yang ditolak state machine, bukan memaksakannya.
export function planStatusAdvance(
  current: OrderFulfillmentStatus | undefined,
  trackingLabels: string[],
): OrderFulfillmentStatus[] {
  const from = getCurrentStepIndex(current)
  // Dibatalkan (-1) tak pernah disentuh peristiwa kurir.
  if (from < 0) return []

  const target = Math.min(stepFromTrackingEvents(trackingLabels), AUTO_ADVANCE_MAX_STEP)
  if (target <= from) return []

  const path: OrderFulfillmentStatus[] = []
  let prev = STEP_LADDER[from] ?? 'Diproses'
  for (let i = from + 1; i <= target; i++) {
    const next = STEP_LADDER[i]
    if (!next || !canTransition(prev, next)) break
    path.push(next)
    prev = next
  }
  return path
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
  // minStep memakai LAST_STEP_INDEX, bukan angka 4 seperti sebelumnya: jumlah tahap sudah berubah
  // dari 5 ke 4, dan angka tetap di sini akan membuat kedua entri ini tak pernah muncul.
  { minStep: LAST_STEP_INDEX, offsetHours: 44, title: 'Paket sedang diantar', description: 'Paket sedang diantar menuju alamat tujuan.' },
  { minStep: LAST_STEP_INDEX, offsetHours: 52, title: 'Paket sampai tujuan', description: 'Paket telah sampai di alamat tujuan.' },
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
