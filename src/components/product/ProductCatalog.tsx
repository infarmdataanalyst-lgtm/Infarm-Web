'use client'

// src/components/product/ProductCatalog.tsx
// Katalog produk dengan filter kategori dari URL. Membaca ?category=<slug> via useSearchParams,
// lalu menyaring dummy data secara client-side. Tanpa param → tampilkan semua produk.

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import type { ProductCategory } from '@/types/product'
import { dummyProducts } from '@/lib/data/dummy-products'
import ProductCard from '@/components/product/ProductCard'

// Label tampilan per slug kategori — hanya untuk judul halaman, BUKAN ditampilkan di kartu produk.
const CATEGORY_LABELS: Record<ProductCategory, string> = {
  'benih-premium': 'Benih Premium',
  'pupuk-nutrisi': 'Pupuk Nutrisi',
  'peralatan-berkebun': 'Peralatan Berkebun',
  'pot-polybag': 'Pot & Polybag',
  'media-tanam': 'Media Tanam',
  'paket-berkebun': 'Paket Berkebun',
}

// Menampilkan judul + grid produk yang sudah disaring sesuai kategori di URL.
export default function ProductCatalog() {
  const searchParams = useSearchParams()
  const category = searchParams.get('category') // mis. 'benih-premium' | null

  // Saring produk: jika ada kategori valid → hanya kategori itu; jika kosong → semua produk
  const products = useMemo(() => {
    if (!category) return dummyProducts
    return dummyProducts.filter((p) => p.category === category)
  }, [category])

  // Judul: pakai label kategori bila dikenali, selain itu "Semua Produk"
  const heading =
    category && category in CATEGORY_LABELS
      ? CATEGORY_LABELS[category as ProductCategory]
      : 'Semua Produk'

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      {/* === Heading === */}
      <h1 className="text-2xl font-bold text-brand-primary sm:text-3xl">{heading}</h1>
      <p className="mt-1 text-sm text-zinc-500">{products.length} produk ditemukan</p>

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
        <p className="py-16 text-center text-sm text-zinc-400">
          Belum ada produk untuk kategori ini.
        </p>
      )}
    </div>
  )
}
