'use client'

// src/components/product/ProductCatalog.tsx
// Katalog produk dengan filter kategori dari URL (?category=<slug>).
// Menampilkan HANYA produk asli OMS (Supabase, via /api/products/list) — tanpa dummy —
// lalu menyaring berdasarkan slug kategori. Slug konsisten di seluruh app → cocok exact.

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { Product, StoredProduct } from '@/types/product'
import { getCategoryLabel } from '@/lib/data/categories'
import ProductCard from '@/components/product/ProductCard'

// Menampilkan judul + grid produk (OMS + dummy) yang disaring sesuai kategori di URL.
export default function ProductCatalog() {
  const searchParams = useSearchParams()
  const category = searchParams.get('category') // mis. 'benih-premium' | null

  // Produk OMS (Supabase) diambil via API. Produk terarsip disembunyikan dari storefront.
  const [omsProducts, setOmsProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    fetch('/api/products/list')
      .then((res) => res.json())
      .then((data: { products?: StoredProduct[] }) => {
        if (!active) return
        const visible = (data.products ?? []).filter((p) => !p.archived)
        setOmsProducts(visible)
      })
      .catch(() => {
        // Mode prototipe: bila gagal, fallback ke dummy saja
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  // Saring produk OMS per kategori (slug exact) bila ada param.
  const products = useMemo(() => {
    if (!category) return omsProducts
    return omsProducts.filter((p) => p.category === category)
  }, [omsProducts, category])

  // Judul: pakai label kategori bila dikenali, selain itu "Semua Produk"
  const heading = getCategoryLabel(category) ?? 'Semua Produk'

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      {/* === Heading === */}
      <h1 className="text-2xl font-bold text-brand-primary sm:text-3xl">{heading}</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {loading ? 'Memuat produk…' : `${products.length} produk ditemukan`}
      </p>

      {/* === Grid produk === */}
      {products.length > 0 ? (
        <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
          {products.map((product) => (
            <li key={product.id}>
              <ProductCard product={product} />
            </li>
          ))}
        </ul>
      ) : (
        !loading && (
          <p className="py-16 text-center text-sm text-zinc-400">
            Belum ada produk untuk kategori ini.
          </p>
        )
      )}
    </div>
  )
}
