// src/components/home/BestSellingProducts.tsx
// Section 4 homepage: grid "Katalog Terlaris" dari produk OMS + dummy. Server Component, responsive.
// Menyertakan placeholder trigger infinite scroll (logika fetch belum diimplementasi).

import Link from 'next/link'
import type { Product } from '@/types/product'
import { dummyProducts } from '@/lib/data/dummy-products'
import { readProducts } from '@/lib/mock-db/products'
import { getSalesCountByProduct } from '@/lib/mock-db/orders'
import ProductCard from '@/components/product/ProductCard'

// Menampilkan section "Katalog Terlaris": produk paling banyak dibeli di depan.
export default async function BestSellingProducts() {
  // Produk OMS (non-arsip) + dummy, diurut berdasarkan unit terjual dari data order.
  // Produk yang diarsipkan disembunyikan dari ecommerce (tetap ada di OMS).
  const omsProducts = (await readProducts()).filter((p) => !p.archived)
  const soldCounts = await getSalesCountByProduct()

  // Urutkan berdasarkan unit terjual (terbanyak dulu). Produk tanpa penjualan
  // tetap pada urutan asalnya (OMS terbaru dulu, lalu dummy) via sort stabil.
  const products: Product[] = [...omsProducts, ...dummyProducts]
    .map((product, index) => ({ product, index, sold: soldCounts[product.id] ?? 0 }))
    .sort((a, b) => b.sold - a.sold || a.index - b.index)
    .slice(0, 10)
    .map((entry) => entry.product)

  return (
    <section className="w-full">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        {/* === Heading === */}
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Produk Pilihan</p>
        <h2 className="mt-1 text-2xl font-bold text-brand-primary sm:text-3xl">Katalog Terlaris</h2>

        {/* === Grid produk: 2 kolom mobile → bertambah di layar lebih besar === */}
        <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
          {products.map((product) => (
            <li key={product.id}>
              <ProductCard product={product} />
            </li>
          ))}
        </ul>

        {/* === Placeholder infinite scroll === */}
        {/* TODO: pasang IntersectionObserver di komponen client untuk fetch halaman berikutnya */}
        <div id="load-more-trigger" className="flex justify-center py-8">
          <span
            aria-label="Memuat produk lainnya"
            className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-200 border-t-brand-primary"
          />
        </div>

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
