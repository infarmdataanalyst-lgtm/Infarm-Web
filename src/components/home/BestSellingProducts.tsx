'use client'

// src/components/home/BestSellingProducts.tsx
// Section beranda "Katalog Terlaris": grid produk diurut penjualan, dengan INFINITE SCROLL.
// Client Component — paginasi via GET /api/products/best-selling-catalog (page/pageSize),
// trigger fetch berikutnya pakai IntersectionObserver native (tanpa library).

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { Product } from '@/types/product'
import ProductCard from '@/components/product/ProductCard'

const PAGE_SIZE = 10

export default function BestSellingProducts() {
  const [products, setProducts] = useState<Product[]>([]) // akumulasi semua produk
  const [page, setPage] = useState(0) // halaman berikutnya yang akan diambil
  const [hasMore, setHasMore] = useState(true) // masih ada produk?
  const [isLoading, setIsLoading] = useState(false) // sedang fetch?
  const [error, setError] = useState(false)

  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const loadingRef = useRef(false) // guard sinkron: cegah dua fetch bersamaan

  // Ambil satu halaman berikutnya lalu APPEND (bukan replace)
  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore) return
    loadingRef.current = true
    setIsLoading(true)
    setError(false)
    try {
      const res = await fetch(`/api/products/best-selling-catalog?page=${page}&pageSize=${PAGE_SIZE}`)
      if (!res.ok) throw new Error('fetch failed')
      const data = (await res.json()) as { products: Product[]; hasMore: boolean }
      setProducts((prev) => [...prev, ...data.products])
      setHasMore(data.hasMore)
      setPage((p) => p + 1)
    } catch {
      setError(true)
    } finally {
      setIsLoading(false)
      loadingRef.current = false
    }
  }, [page, hasMore])

  // Muat halaman pertama saat mount
  useEffect(() => {
    loadMore()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // IntersectionObserver: fetch berikutnya saat sentinel mendekati viewport
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore()
      },
      { rootMargin: '200px' }, // mulai memuat sebelum benar-benar terlihat
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [loadMore, hasMore])

  const showInitialSkeleton = isLoading && products.length === 0
  const showEmpty = !isLoading && !error && products.length === 0 && !hasMore

  return (
    <section className="w-full">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        {/* === Heading === */}
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Produk Pilihan</p>
        <h2 className="mt-1 text-2xl font-bold text-brand-primary sm:text-3xl">Katalog Terlaris</h2>

        {/* === Grid produk === */}
        <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
          {products.map((product) => (
            <li key={product.id}>
              <ProductCard product={product} />
            </li>
          ))}
          {/* Skeleton saat fetch (baik load awal maupun halaman berikutnya) */}
          {isLoading &&
            Array.from({ length: showInitialSkeleton ? PAGE_SIZE : 5 }).map((_, i) => (
              <li key={`skeleton-${i}`}>
                <SkeletonCard />
              </li>
            ))}
        </ul>

        {/* === Kondisi kosong === */}
        {showEmpty && (
          <p className="py-16 text-center text-sm text-zinc-400">Belum ada produk.</p>
        )}

        {/* === Error + retry === */}
        {error && (
          <div className="py-8 text-center">
            <p className="text-sm text-zinc-500">Gagal memuat produk.</p>
            <button
              type="button"
              onClick={loadMore}
              className="mt-2 rounded-lg border border-brand-primary px-4 py-2 text-sm font-semibold text-brand-primary transition hover:bg-brand-surface"
            >
              Coba lagi
            </button>
          </div>
        )}

        {/* === Sentinel infinite scroll (hanya saat masih ada & tak error) === */}
        {hasMore && !error && <div ref={sentinelRef} aria-hidden className="h-1 w-full" />}

        {/* === Pesan akhir === */}
        {!hasMore && products.length > 0 && (
          <p className="py-6 text-center text-sm text-zinc-400">Semua produk sudah ditampilkan</p>
        )}

        {/* === Tombol lihat semua produk === */}
        <div className="pb-2">
          <Link
            href="/products"
            className="flex w-full items-center justify-center rounded-xl bg-brand-primary px-6 py-3 text-base font-bold text-white shadow-sm transition hover:brightness-90 active:scale-[0.99]"
          >
            Lihat Semua Produk
          </Link>
        </div>
      </div>
    </section>
  )
}

// Kartu skeleton (placeholder) saat produk sedang dimuat
function SkeletonCard() {
  return (
    <div className="animate-pulse overflow-hidden rounded-xl border border-zinc-100 bg-white">
      <div className="aspect-square w-full bg-zinc-100" />
      <div className="space-y-2 p-3">
        <div className="h-3 w-3/4 rounded bg-zinc-100" />
        <div className="h-3 w-1/2 rounded bg-zinc-100" />
      </div>
    </div>
  )
}
