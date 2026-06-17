// src/components/cart/CartRecentlyViewed.tsx
// Seksi "Kamu sempat lihat ini" pada halaman keranjang: grid 2 kartu produk dengan badge promo,
// harga coret, dan harga diskon. Presentational.

import Image from 'next/image'
import Link from 'next/link'
import type { Product } from '@/types/product'
import { formatRupiah } from '@/lib/format'

// Menampilkan judul + grid 2 kartu produk yang baru dilihat.
export default function CartRecentlyViewed({ products }: { products: Product[] }) {
  if (products.length === 0) return null

  return (
    <section className="mt-2 bg-white px-4 py-4">
      <h2 className="mb-3 text-lg font-bold text-zinc-800">Kamu sempat lihat ini</h2>

      <ul className="grid grid-cols-2 gap-3">
        {products.map((product) => (
          <li key={product.id}>
            <RecentCard product={product} />
          </li>
        ))}
      </ul>
    </section>
  )
}

// === Sub-komponen ===

// Kartu produk dengan badge "+ Baru" (bila ada), harga coret, dan harga diskon
function RecentCard({ product }: { product: Product }) {
  const { id, name, originalPrice, promoPrice, imageUrl, badge } = product

  return (
    <Link
      href={`/produk/${id}`}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-zinc-100 bg-white shadow-sm transition hover:shadow-md"
    >
      <div className="relative aspect-square w-full bg-zinc-50">
        {/* unoptimized: placeholder SVG sementara */}
        <Image
          src={imageUrl}
          alt={name}
          fill
          unoptimized
          sizes="(max-width: 640px) 50vw, 240px"
          className="object-cover transition group-hover:scale-[1.02]"
        />
        {/* Badge promo merah */}
        {badge && (
          <span className="absolute left-0 top-2 rounded-r-md bg-red-500 px-2 py-1 text-xs font-semibold text-white shadow">
            + {badge}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-2.5">
        <h3 className="line-clamp-2 text-sm leading-snug text-zinc-800">{name}</h3>
        <div className="mt-auto pt-2">
          <p className="text-xs text-zinc-400 line-through">{formatRupiah(originalPrice)}</p>
          <p className="text-base font-bold text-red-500">{formatRupiah(promoPrice)}</p>
        </div>
      </div>
    </Link>
  )
}
