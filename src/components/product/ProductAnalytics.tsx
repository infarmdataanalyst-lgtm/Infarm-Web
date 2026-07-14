'use client'

// src/components/product/ProductAnalytics.tsx
// Komponen tak-render (null) yang mengirim event GA4 `view_item` saat halaman detail produk
// pertama kali tampil. Dipasang di produk/[id]/page.tsx (Server Component).
// Anti double-fire: hanya kirim sekali per productId (aman dari re-render & React StrictMode).

import { useEffect, useRef } from 'react'
import { trackViewItem, type AnalyticsProduct } from '@/lib/analytics'

export default function ProductAnalytics({ product }: { product: AnalyticsProduct }) {
  const lastId = useRef<string | null>(null)

  useEffect(() => {
    // Lewati bila productId sama sudah dilaporkan (mount ganda StrictMode / re-render)
    if (lastId.current === product.id) return
    lastId.current = product.id
    trackViewItem(product)
  }, [product])

  return null
}
