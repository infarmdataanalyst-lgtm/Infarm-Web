// src/components/home/CategoryGrid.tsx
// Section 3 homepage: grid navigasi kategori produk. Server Component, responsive.
// Tiap kartu memakai foto latar per kategori (dari public/images/categories/<slug>.jpg)
// dengan overlay gelap agar judul putih tetap kontras.

import Link from 'next/link'
import Image from 'next/image'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { PRODUCT_CATEGORIES } from '@/lib/data/categories'

// Cari foto latar kategori di public/images/categories/. Coba .webp lalu .jpg;
// kembalikan path publik yang ada, atau null bila belum ada foto (pakai fallback hijau).
// Server-only: aman memakai fs karena komponen ini Server Component.
function resolveCategoryImage(slug: string): string | null {
  const dir = path.join(process.cwd(), 'public', 'images', 'categories')
  for (const ext of ['webp', 'jpg'] as const) {
    if (existsSync(path.join(dir, `${slug}.${ext}`))) {
      return `/images/categories/${slug}.${ext}`
    }
  }
  return null
}

// Menampilkan grid kategori produk yang bisa diklik untuk menuju katalog terfilter.
export default function CategoryGrid() {
  return (
    <section className="w-full">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <h2 className="mb-4 text-xl font-bold text-zinc-900 sm:text-2xl">Kategori Produk</h2>

        {/* 2 kolom di mobile, 3 di tablet ke atas */}
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
          {PRODUCT_CATEGORIES.map((cat) => {
            const bgImage = resolveCategoryImage(cat.slug)
            return (
            <li key={cat.slug}>
              <Link
                href={`/products?category=${cat.slug}`}
                className="relative flex aspect-[16/10] items-center justify-center overflow-hidden rounded-xl shadow-sm transition active:scale-[0.98]"
              >
                {/* Foto latar per kategori (.webp/.jpg). bg-brand-primary = fallback bila belum ada foto. */}
                <span aria-hidden className="absolute inset-0 bg-brand-primary" />
                {bgImage && (
                  <Image
                    src={bgImage}
                    alt=""
                    fill
                    sizes="(max-width: 640px) 50vw, 33vw"
                    className="object-cover"
                  />
                )}
                {/* Overlay gelap agar judul putih tetap kontras di atas foto */}
                <span aria-hidden className="absolute inset-0 bg-black/40" />

                <span className="relative px-2 text-center text-lg font-extrabold leading-tight text-white drop-shadow sm:text-xl">
                  {cat.label}
                </span>
              </Link>
            </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
