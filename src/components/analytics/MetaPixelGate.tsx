'use client'

// src/components/analytics/MetaPixelGate.tsx
// Memasang Meta Pixel HANYA di halaman toko (buyer-facing) — pengecualian yang sama persis dengan
// GoogleAnalyticsGate: tidak di /oms (tak melacak admin) dan tidak di /maintenance (halaman itu
// harus tampil tanpa skrip domain luar). Dipasang di root layout, hanya bila
// NEXT_PUBLIC_META_PIXEL_ID terisi DAN berbentuk angka (lib/meta-pixel.ts).
//
// ── PageView saat navigasi client ──
// Snippet Meta hanya mengirim PageView sekali, saat halaman pertama dimuat. Next.js berpindah
// halaman tanpa reload, jadi tanpa bantuan, kunjungan ke detail produk setelah beranda tak pernah
// tercatat. Efek di bawah mengirim PageView tiap pathname berubah — kecuali pathname PERTAMA, yang
// sudah ditangani snippet. Ia juga berhenti bila pengunjung berpindah ke area yang dikecualikan.

import { useEffect, useRef } from 'react'
import Script from 'next/script'
import { usePathname } from 'next/navigation'

// Halaman yang tak boleh dilacak — sama dengan GoogleAnalyticsGate.
export function isMetaPixelExcludedPath(pathname: string): boolean {
  if (pathname.startsWith('/oms')) return true
  if (pathname === '/maintenance' || pathname.startsWith('/maintenance/')) return true
  return false
}

// Snippet resmi Meta Pixel. `pixelId` SUDAH divalidasi angka oleh pemanggil (layout) — jangan
// menyisipkan nilai env mentah ke sini.
function buildPixelSnippet(pixelId: string): string {
  return (
    "!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};" +
    "if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;" +
    "s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');" +
    `fbq('init','${pixelId}');fbq('track','PageView');`
  )
}

// Render snippet pixel kecuali di area OMS dan halaman maintenance.
export default function MetaPixelGate({ pixelId }: { pixelId: string }) {
  const pathname = usePathname() ?? ''
  const excluded = isMetaPixelExcludedPath(pathname)
  // Pathname terakhir yang PageView-nya sudah dikirim. null = belum pernah: pathname pertama
  // adalah milik snippet, bukan efek ini.
  const lastTracked = useRef<string | null>(null)

  useEffect(() => {
    if (excluded) return
    if (lastTracked.current === null) {
      lastTracked.current = pathname
      return
    }
    if (lastTracked.current === pathname) return
    lastTracked.current = pathname
    if (typeof window.fbq === 'function') window.fbq('track', 'PageView')
  }, [pathname, excluded])

  if (excluded) return null
  return (
    <>
      {/* afterInteractive (sama dengan GA): akurasi analytics lebih penting daripada menunda skrip */}
      <Script id="meta-pixel" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: buildPixelSnippet(pixelId) }} />
      {/* Cadangan tanpa JavaScript: piksel gambar 1×1 yang direkomendasikan Meta */}
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: 'none' }}
          alt=""
          src={`https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1`}
        />
      </noscript>
    </>
  )
}
