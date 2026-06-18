// src/components/home/BestSellingProducts.tsx
// Section 4 homepage: grid produk terlaris dari dummy data. Server Component, responsive.
// Menyertakan placeholder trigger infinite scroll (logika fetch belum diimplementasi).

import Image from 'next/image'
import Link from 'next/link'
import type { Product } from '@/types/product'
import { dummyProducts } from '@/lib/data/dummy-products'
import { readProducts } from '@/lib/mock-db/products'
import { formatRupiah } from '@/lib/format'

// Menampilkan section "Katalog Terlaris": produk baru dari OMS + dummy.
export default async function BestSellingProducts() {
  // Produk hasil input OMS (mock DB) tampil paling depan, lalu dummy bawaan.
  // Produk yang diarsipkan disembunyikan dari ecommerce (tetap ada di OMS).
  // TODO: ganti dengan query Supabase setelah OMS selesai (urut berdasarkan penjualan)
  const omsProducts = (await readProducts()).filter((p) => !p.archived)
  const products: Product[] = [...omsProducts, ...dummyProducts].slice(0, 10)

  return (
    <section className="w-full">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        {/* === Heading === */}
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Produk Pilihan
        </p>
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

// === Sub-komponen ===

// Kartu satu produk: foto 1:1, badge promo (opsional), nama (maks 2 baris), harga coret + harga promo
function ProductCard({ product }: { product: Product }) {
  const { id, name, originalPrice, promoPrice, imageUrl, badge } = product

  return (
    <Link
      href={`/produk/${id}`}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-zinc-100 bg-white shadow-sm transition hover:shadow-md"
    >
      {/* Foto produk dengan rasio 1:1 */}
      <div className="relative aspect-square w-full bg-zinc-50">
        {/* unoptimized dipakai karena imageUrl masih SVG placeholder; hapus saat memakai foto raster asli */}
        <Image
          src={imageUrl}
          alt={name}
          fill
          unoptimized
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
          className="object-cover transition group-hover:scale-[1.02]"
        />
        {/* Badge promo merah — hanya tampil jika produk punya badge */}
        {badge && (
          <span className="absolute left-0 top-2 rounded-r-md bg-red-600 px-2 py-1 text-xs font-semibold text-white shadow">
            + {badge}
          </span>
        )}
      </div>

      {/* Info produk */}
      <div className="flex flex-1 flex-col p-2.5">
        <h3 className="line-clamp-2 text-sm font-medium leading-snug text-zinc-800">{name}</h3>
        <div className="mt-auto pt-2">
          <p className="text-xs text-zinc-400 line-through">{formatRupiah(originalPrice)}</p>
          <p className="text-base font-bold text-red-600">{formatRupiah(promoPrice)}</p>
        </div>
      </div>
    </Link>
  )
}
