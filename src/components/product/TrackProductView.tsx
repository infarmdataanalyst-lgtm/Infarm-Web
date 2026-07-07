'use client'

// src/components/product/TrackProductView.tsx
// Komponen tak-render (null) yang mencatat produk ke riwayat "pernah dilihat" saat
// halaman detail produk dibuka. Dipasang di produk/[id]/page.tsx (Server Component).

import { useEffect } from 'react'
import { trackProductView } from '@/lib/recently-viewed'

export default function TrackProductView({ productId }: { productId: string }) {
  useEffect(() => {
    trackProductView(productId)
  }, [productId])
  return null
}
