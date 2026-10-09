'use client'

// src/components/analytics/SpeedInsightsGate.tsx
// Memasang Vercel Speed Insights HANYA di halaman toko (buyer-facing), tidak di OMS/admin dan
// tidak di halaman maintenance — pola yang sama dengan GoogleAnalyticsGate. Dipasang di root layout
// karena halaman toko tersebar di luar route group (store) (checkout, keranjang, track, review…),
// sehingga tidak ada satu layout toko yang membungkus semuanya.
//
// Dua lapis pengecualian, dan keduanya perlu:
//   1. Gate pathname di sini — skrip tidak pernah disuntik bila halaman PERTAMA yang dibuka adalah
//      /oms atau /maintenance.
//   2. `beforeSend` (src/lib/speed-insights-filter.ts) — skrip yang sudah tersuntik di halaman toko
//      tetap hidup saat pengguna berpindah ke /oms lewat navigasi client; lapis inilah yang
//      membuang event-nya, sekaligus membersihkan query/hash dan pengenal pembeli dari URL.
//
// Kenapa komponen client: `beforeSend` adalah fungsi, dan fungsi tidak bisa dikirim dari Server
// Component ke Client Component — jadi ia harus didefinisikan di berkas client.

import { usePathname } from 'next/navigation'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { filterSpeedInsightsEvent, isSpeedInsightsExcludedPath } from '@/lib/speed-insights-filter'

// Porsi kunjungan yang mengirim data (1 = semua). Paket gratis: 10.000 event / 30 hari untuk satu
// tim; bila terlampaui pengumpulan dijeda ≥14 hari. Trafik toko masih kecil, jadi 1 dulu — turunkan
// (mis. 0.5) begitu jumlah event di dashboard Speed Insights mendekati kuota.
export const SPEED_INSIGHTS_SAMPLE_RATE = 1

// Render <SpeedInsights> kecuali di area OMS, halaman maintenance, /api, dan /dev.
export default function SpeedInsightsGate() {
  const pathname = usePathname()
  if (isSpeedInsightsExcludedPath(pathname ?? '')) return null
  return <SpeedInsights sampleRate={SPEED_INSIGHTS_SAMPLE_RATE} beforeSend={filterSpeedInsightsEvent} />
}
