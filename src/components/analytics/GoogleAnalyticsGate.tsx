'use client'

// src/components/analytics/GoogleAnalyticsGate.tsx
// Memasang GA4 HANYA di routing e-commerce (buyer-facing), TIDAK di OMS/admin (/oms/*).
// GA4 tak boleh melacak aktivitas back-office admin. Gate ini membaca pathname di client
// dan tidak me-render script GA saat berada di area /oms.
//
// Halaman /maintenance juga dikecualikan: selama maintenance mode, halaman itu harus tampil tanpa
// memuat skrip dari domain luar, dan kunjungan ke sana bukan trafik belanja — mencatatnya hanya
// mengotori laporan GA4.

import { usePathname } from 'next/navigation'
import { GoogleAnalytics } from '@next/third-parties/google'

// Render <GoogleAnalytics> kecuali di area OMS dan halaman maintenance.
export default function GoogleAnalyticsGate({ gaId }: { gaId: string }) {
  const pathname = usePathname()
  // Jangan pasang tracking di back-office admin
  if (pathname?.startsWith('/oms')) return null
  // Jangan pasang tracking di halaman maintenance (tepat /maintenance atau di bawahnya)
  if (pathname === '/maintenance' || pathname?.startsWith('/maintenance/')) return null
  return <GoogleAnalytics gaId={gaId} />
}
