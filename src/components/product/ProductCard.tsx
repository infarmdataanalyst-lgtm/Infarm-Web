// src/components/product/ProductCard.tsx
// Kartu produk reusable untuk grid katalog/listing. Menampilkan foto, badge promo (opsional),
// nama, harga coret, dan harga promo. CATATAN: kategori sengaja TIDAK ditampilkan (hanya filter internal).

import Image from 'next/image'
import Link from 'next/link'
import type { Product } from '@/types/product'
import { formatRupiah } from '@/lib/format'

// Menampilkan satu kartu produk yang menautkan ke halaman detail produk.
export default function ProductCard({ product }: { product: Product }) {
  const { id, name, originalPrice, promoPrice, imageUrl, badge } = product

  return (
    <Link
      href={`/produk/${id}`}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-zinc-100 bg-white shadow-sm transition hover:shadow-md"
    >
      {/* Foto produk dengan rasio 1:1 */}
      <div className="relative aspect-square w-full bg-zinc-50">
        {/* unoptimized dipakai karena imageUrl masih placeholder; hapus saat memakai foto produk asli */}
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
          <span className="absolute left-0 top-2 rounded-r-md bg-red-500 px-2 py-1 text-xs font-semibold text-white shadow">
            + {badge}
          </span>
        )}
      </div>

      {/* Info produk */}
      <div className="flex flex-1 flex-col p-2.5">
        <h3 className="line-clamp-2 text-sm font-medium leading-snug text-zinc-800">{name}</h3>
        <div className="mt-auto pt-2">
          <p className="text-xs text-zinc-400 line-through">{formatRupiah(originalPrice)}</p>
          <p className="text-base font-bold text-red-500">{formatRupiah(promoPrice)}</p>
        </div>
      </div>
    </Link>
  )
}
