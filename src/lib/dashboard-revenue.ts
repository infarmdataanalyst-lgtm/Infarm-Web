// src/lib/dashboard-revenue.ts
// Klasifikasi & agregasi pendapatan untuk Dashboard OMS.
//
// MURNI (tanpa akses DB) supaya perhitungannya bisa dipakai ulang, mudah dibaca, dan tidak
// tercampur dengan pemetaan skema Supabase. Data mentahnya dibaca lewat
// readOrdersForRevenue() di src/lib/mock-db/orders.ts.
//
// KENAPA pendapatan dipecah per status: sebelum Xendit terpasang, checkout menyimpan pesanan
// dengan status_pembayaran PENDING dan LANGSUNG memotong stok. Angka pendapatan gabungan karena
// itu menyesatkan — admin bisa menganggap uang sudah masuk padahal pesanan masih bisa batal.
// Dashboard wajib memisahkan "uang yang sudah pasti masuk" dari "uang yang masih berpotensi batal".

import type { OrderPaymentStatus, OrderFulfillmentStatus } from '@/types/order'
import { bucketKeyOf, type BucketSlot, type Granularity } from '@/lib/dashboard-period'

// === Tipe ===

export type RevenueCategory = 'lunas' | 'pending' | 'dibatalkan'

// Bentuk minimum satu pesanan yang dibutuhkan perhitungan pendapatan.
// Sengaja TANPA item/alamat/gudang: dashboard hanya menjumlahkan nilai pesanan.
export type RevenueOrderRow = {
  totalAmount: number
  paymentStatus: OrderPaymentStatus
  status?: OrderFulfillmentStatus // undefined untuk baris warisan yang order_status-nya NULL
  date: string // ISO instant = created_at
}

export type CategoryTotal = { amount: number; orderCount: number }

export type RevenueTotals = {
  lunas: CategoryTotal
  pending: CategoryTotal
  dibatalkan: CategoryTotal
  // lunas + pending = pendapatan yang belum hangus. TIDAK termasuk dibatalkan/gagal.
  berjalan: CategoryTotal
  // Seluruh pesanan pada rentang, TERMASUK yang dibatalkan (untuk kartu "Total Pesanan").
  semua: CategoryTotal
}

// Satu titik pada chart tren. Field per kategori dipakai langsung sebagai dataKey Recharts.
export type RevenueBucket = {
  key: string
  label: string
  lunas: number
  pending: number
  dibatalkan: number
  // Total pendapatan aktif bucket ini = lunas + pending, TANPA dibatalkan. Dipakai garis tren
  // overlay di chart. Namanya sengaja sama dengan RevenueTotals.berjalan supaya satu istilah
  // berarti satu hal di seluruh dashboard: "uang yang belum hangus".
  //
  // Perhatikan: ini BUKAN tinggi total batang. Batang menumpuk ketiga kategori, jadi pada bucket
  // yang punya pembatalan garisnya memang berada DI BAWAH puncak batang — itu benar, bukan bug.
  berjalan: number
}

// === Palet kategori ===
//
// SKEMA BIRU LEMBUT — dipilih pemilik toko (2026-08-13), menggantikan hijau/amber/rose.
// Biru dipakai atas persetujuan eksplisit; larangan biru/ungu di bagian Brand Colors CLAUDE.md
// tetap berlaku untuk tempat lain.
//
// Hex-nya BUKAN yang pertama diminta (#7C9CC4/#A8C5E8/#B8B8B8): pasangan itu gagal keras di
// validator — `#A8C5E8` ↔ `#B8B8B8` hanya ΔE 6.7 (normal-vision floor 15), tak terbedakan
// bahkan oleh mata normal, padahal keduanya segmen yang BERSINGGUNGAN di stack; kontrasnya juga
// 1,73:1 & 1,93:1 sehingga batangnya nyaris lenyap di kartu putih. Jaraknya diperlebar sampai
// semua check WAJIB lolos, dengan tetap mempertahankan kesan biru lembut.
//
// Hasil validator untuk pasangan yang BERSINGGUNGAN di stack (Lunas→Pending→Dibatalkan):
//   [PASS] lightness band · [PASS] CVD ΔE 25.1 · [PASS] normal-vision ΔE 25.6
//   [FAIL] chroma floor — MELEKAT pada skema pastel + netral (pastel = chroma rendah; abu = 0).
//          Diterima sadar: yang membedakan di sini lightness, dan identitas juga dibawa
//          legend + kartu KPI berangka + tampilan Tabel.
//   [WARN] kontras `#8FB4DE` 2,1:1 → relief sama seperti di atas.
// Lunas ↔ Dibatalkan hanya ΔE 8.2, tapi keduanya TIDAK PERNAH bersinggungan (Pending selalu
// di antaranya) dan dipisah celah 2px, jadi geometri chart-nya tak pernah menyandingkan mereka.
//
// JANGAN ganti hex di sini tanpa menjalankan ulang validator palet.
export const REVENUE_COLORS: Record<RevenueCategory, string> = {
  lunas: '#35577E', // biru tua lembut — uang yang sudah pasti masuk
  pending: '#8FB4DE', // biru muda pastel — masih berpotensi batal
  dibatalkan: '#5F6670', // abu netral gelap — "di luar hitungan", bukan warna alarm
}

// Warna garis tren total (overlay di atas bar). Hampir hitam kebiruan.
//
// Sengaja di LUAR sistem kategorikal: warna ini gagal check `lightness band` & `chroma floor`
// validator palet, dan itu memang tujuannya — kedua check itu menjaga hue kategorikal saling
// terbedakan & setara bobot, sedangkan garis tren harus lebih gelap agar terbaca DI ATAS fill
// dan harus netral agar tak terbaca sebagai status keempat. Identitasnya dibawa JENIS MARK
// (garis + dot bercincin, bukan batang) — secondary encoding terkuat yang ada.
//
// Harus jauh lebih gelap daripada bar TERGELAP (`#35577E`). Usulan awal `#4A5568` dibuang karena
// hanya ΔE 4.2 dari warna Lunas → garisnya akan lenyap tiap kali melintasi segmen Lunas.
export const REVENUE_TREND_COLOR = '#1F2937'

// Metadata kategori: satu sumber untuk legend chart, header tabel, dan kartu KPI.
// Urutan array = urutan tumpukan bar (dari dasar ke atas) dan urutan kartu.
export const REVENUE_CATEGORIES: {
  key: RevenueCategory
  label: string
  color: string
  // Penjelasan definisi status — dirender sebagai tooltip ikon info pada kartu, supaya admin
  // tidak salah menafsirkan mana uang yang sudah pasti masuk.
  tooltip: string
}[] = [
  {
    key: 'lunas',
    label: 'Pendapatan Lunas',
    color: REVENUE_COLORS.lunas,
    tooltip:
      'Pesanan dengan status pembayaran "Lunas" dan tidak dibatalkan. Ini uang yang sudah pasti masuk.',
  },
  {
    key: 'pending',
    label: 'Pendapatan Pending',
    color: REVENUE_COLORS.pending,
    tooltip:
      'Pesanan yang masih menunggu pembayaran atau verifikasi. Belum tentu jadi — jangan dihitung sebagai kas.',
  },
  {
    key: 'dibatalkan',
    label: 'Dibatalkan / Gagal',
    color: REVENUE_COLORS.dibatalkan,
    tooltip:
      'Pesanan dibatalkan (pembeli atau admin) atau pembayarannya gagal. Tidak dihitung sebagai pendapatan; stoknya sudah dikembalikan.',
  },
]

// === Klasifikasi ===

// Menentukan kategori pendapatan sebuah pesanan. URUTAN pengecekan penting:
// pesanan yang sudah dibayar lalu dibatalkan (kasus refund) HARUS masuk 'dibatalkan',
// bukan 'lunas' — kalau dibalik, uang yang sudah dikembalikan tetap terhitung pendapatan.
//
// Pesanan warisan dengan order_status NULL (status undefined) jatuh ke penilaian berdasarkan
// status pembayarannya saja; itu benar, karena tidak ada bukti pesanan itu dibatalkan.
export function categorizeRevenue(order: {
  paymentStatus: OrderPaymentStatus
  status?: OrderFulfillmentStatus
}): RevenueCategory {
  if (order.status === 'Dibatalkan' || order.paymentStatus === 'Gagal') return 'dibatalkan'
  if (order.paymentStatus === 'Lunas') return 'lunas'
  return 'pending'
}

// === Agregasi ===

function emptyTotal(): CategoryTotal {
  return { amount: 0, orderCount: 0 }
}

function addTo(target: CategoryTotal, amount: number): void {
  target.amount += amount
  target.orderCount += 1
}

// Menjumlahkan pendapatan per kategori untuk satu rentang waktu.
export function summarizeRevenue(rows: RevenueOrderRow[]): RevenueTotals {
  const totals: RevenueTotals = {
    lunas: emptyTotal(),
    pending: emptyTotal(),
    dibatalkan: emptyTotal(),
    berjalan: emptyTotal(),
    semua: emptyTotal(),
  }

  for (const row of rows) {
    const category = categorizeRevenue(row)
    addTo(totals[category], row.totalAmount)
    addTo(totals.semua, row.totalAmount)
    if (category !== 'dibatalkan') addTo(totals.berjalan, row.totalAmount)
  }
  return totals
}

// Menyebar pesanan ke deret bucket chart. `slots` adalah kerangka bucket dari buildBuckets()
// sehingga periode tanpa pesanan tetap muncul sebagai nol di sumbu-X.
//
// Pesanan yang jatuh di luar kerangka (mis. bucket masa depan yang sengaja tidak dirender)
// diabaikan di chart, tapi TETAP ikut di summarizeRevenue — kartu KPI adalah sumber angka
// totalnya, chart hanya menggambarkan sebarannya.
export function bucketRevenue(
  rows: RevenueOrderRow[],
  slots: BucketSlot[],
  granularity: Granularity,
): RevenueBucket[] {
  const byKey = new Map<string, RevenueBucket>()
  for (const slot of slots) {
    byKey.set(slot.key, {
      key: slot.key,
      label: slot.label,
      lunas: 0,
      pending: 0,
      dibatalkan: 0,
      berjalan: 0,
    })
  }

  for (const row of rows) {
    const bucket = byKey.get(bucketKeyOf(row.date, granularity))
    if (!bucket) continue
    const category = categorizeRevenue(row)
    bucket[category] += row.totalAmount
    if (category !== 'dibatalkan') bucket.berjalan += row.totalAmount
  }

  return slots.map((slot) => byKey.get(slot.key)!)
}

// Rata-rata nilai pesanan (AOV) dari pesanan yang tidak dibatalkan. 0 bila belum ada pesanan.
export function averageOrderValue(totals: RevenueTotals): number {
  if (totals.berjalan.orderCount === 0) return 0
  return Math.round(totals.berjalan.amount / totals.berjalan.orderCount)
}

// Persentase pertumbuhan dibanding periode pembanding, dibulatkan 1 desimal.
// undefined bila pembanding 0 — "naik ∞%" bukan informasi, jadi badge delta disembunyikan
// alih-alih menampilkan angka yang tak bermakna.
export function growthPercent(current: number, previous: number): number | undefined {
  if (previous === 0) return undefined
  return Math.round(((current - previous) / previous) * 1000) / 10
}
