'use client'

// src/components/analytics/GoogleAnalyticsGate.tsx
// Memasang GA4 HANYA di routing e-commerce (buyer-facing), TIDAK di OMS/admin (/oms/*).
// GA4 tak boleh melacak aktivitas back-office admin. Gate ini membaca pathname di client
// dan tidak me-render script GA saat berada di area /oms.

import { usePathname } from 'next/navigation'
import { GoogleAnalytics } from '@next/third-parties/google'

// Render <GoogleAnalytics> kecuali di area OMS.
export default function GoogleAnalyticsGate({ gaId }: { gaId: string }) {
  const pathname = usePathname()
  // Jangan pasang tracking di back-office admin
  if (pathname?.startsWith('/oms')) return null
  return <GoogleAnalytics gaId={gaId} />
}
