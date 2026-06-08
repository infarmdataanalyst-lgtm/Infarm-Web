// src/app/(store)/products/page.tsx
// Halaman katalog produk (/products). Berada di route group (store) → otomatis dapat AppBar.
// useSearchParams (di ProductCatalog) wajib dibungkus <Suspense> agar build Next.js tidak error.

import { Suspense } from 'react'
import ProductCatalog from '@/components/product/ProductCatalog'

export default function ProductsPage() {
  return (
    // pt-14: ruang untuk AppBar fixed (h-14) yang dirender di layout (store)
    <main className="flex flex-1 flex-col bg-brand-surface pt-14">
      <Suspense fallback={<CatalogFallback />}>
        <ProductCatalog />
      </Suspense>
    </main>
  )
}

// Placeholder sederhana saat ProductCatalog (client) belum siap di-hidrasi
function CatalogFallback() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="h-8 w-48 animate-pulse rounded bg-zinc-200" />
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="aspect-[3/4] animate-pulse rounded-xl bg-zinc-200" />
        ))}
      </div>
    </div>
  )
}
