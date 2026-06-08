// src/components/home/CategoryGrid.tsx
// Section 3 homepage: grid navigasi kategori produk. Server Component, responsive.

import Link from 'next/link'
import { PRODUCT_CATEGORIES } from '@/lib/data/categories'

// Menampilkan grid kategori produk yang bisa diklik untuk menuju katalog terfilter.
export default function CategoryGrid() {
  return (
    <section className="w-full">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <h2 className="mb-4 text-xl font-bold text-zinc-900 sm:text-2xl">Kategori Produk</h2>

        {/* 2 kolom di mobile, 3 di tablet ke atas */}
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
          {PRODUCT_CATEGORIES.map((cat) => (
            <li key={cat.slug}>
              <Link
                href={`/products?category=${cat.slug}`}
                className="relative flex aspect-[16/10] items-center justify-center overflow-hidden rounded-xl shadow-sm transition active:scale-[0.98]"
              >
                {/* TODO: ganti dengan gambar kategori asli (background bertema tanaman) */}
                <span aria-hidden className="absolute inset-0 bg-brand-primary" />
                {/* Overlay transparan agar judul tetap kontras saat nanti memakai gambar */}
                <span aria-hidden className="absolute inset-0 bg-black/10" />

                <span className="relative px-2 text-center text-lg font-extrabold uppercase leading-tight text-white drop-shadow sm:text-xl">
                  {cat.label}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
