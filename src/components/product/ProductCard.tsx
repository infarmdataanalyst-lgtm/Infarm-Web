// src/components/product/ProductCard.tsx
// Kartu produk reusable untuk grid katalog/listing. Menampilkan foto, badge promo (opsional),
// nama, harga jual (hijau brand) + harga coret inline, dan sosial-proof (rating + jumlah terjual).
// CATATAN: kategori sengaja TIDAK ditampilkan (hanya filter internal).
// rating/terjual OPSIONAL (tipe CatalogCardProduct) → bila data tak ada, baris itu disembunyikan.

import Image from 'next/image'
import Link from 'next/link'
import { type CatalogCardProduct, isProductOnSale } from '@/types/product'
import { formatRupiah, formatSold } from '@/lib/format'

// Menampilkan satu kartu produk yang menautkan ke halaman detail produk.
export default function ProductCard({ product }: { product: CatalogCardProduct }) {
  const { id, name, originalPrice, promoPrice, imageUrl, badge, rating, reviewCount, soldCount } =
    product
  const onSale = isProductOnSale(product)
  const showRating = (reviewCount ?? 0) > 0 // hanya tampil bila ada ulasan
  const soldLabel = formatSold(soldCount ?? 0) // '' bila 0 → disembunyikan

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
          {/* Baris harga: harga jual (hijau brand) + harga coret inline (bila diskon) */}
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <span className="text-base font-bold text-brand-primary">{formatRupiah(promoPrice)}</span>
            {onSale && (
              <span className="text-xs text-zinc-400 line-through">{formatRupiah(originalPrice)}</span>
            )}
          </div>

          {/* Baris sosial-proof: rating (bintang kuning + angka) | jumlah terjual */}
          {(showRating || soldLabel) && (
            <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500">
              {showRating && (
                <span className="flex items-center gap-0.5">
                  <StarIcon />
                  <span className="font-medium text-zinc-700">{(rating ?? 0).toFixed(1)}</span>
                </span>
              )}
              {/* Separator tipis hanya bila kedua info tampil */}
              {showRating && soldLabel && <span className="text-zinc-300">|</span>}
              {soldLabel && <span>{soldLabel} terjual</span>}
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}

// Ikon bintang terisi (kuning) untuk rating. Inline SVG agar tak menambah dependency.
function StarIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="#facc15"
      aria-hidden
      className="shrink-0"
    >
      <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
    </svg>
  )
}
