'use client'

// src/components/review/ReviewProductCard.tsx
// Kartu ulasan satu produk: info produk, rating bintang interaktif (hover/klik), dan textarea opsional.
// Nilai rating & teks dikelola parent (per produk) — kartu hanya menyimpan state hover bintang lokal.

import Image from 'next/image'
import { useState } from 'react'
import type { ReviewProduct } from '@/lib/data/dummy-review'

// Menampilkan kartu input ulasan untuk satu produk.
export default function ReviewProductCard({
  product,
  rating,
  review,
  onRatingChange,
  onReviewChange,
}: {
  product: ReviewProduct
  rating: number
  review: string
  onRatingChange: (productId: string, rating: number) => void
  onReviewChange: (productId: string, review: string) => void
}) {
  // Bintang yang sedang di-hover (0 = tidak ada). Hover diprioritaskan untuk preview warna.
  const [hovered, setHovered] = useState(0)
  const activeStars = hovered || rating

  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      {/* a. Informasi produk */}
      <div className="flex gap-3">
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-gray-100 bg-gray-50">
          {/* unoptimized: placeholder sementara */}
          <Image src={product.imageUrl} alt={product.name} fill unoptimized sizes="56px" className="object-cover" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-sm font-bold leading-snug text-gray-800">
            {product.name}
          </h3>
          <p className="mt-0.5 text-xs text-gray-400">Varian: {product.variant}</p>
        </div>
      </div>

      {/* b. Rating bintang interaktif */}
      <div className="mt-4 flex items-center gap-1.5" onMouseLeave={() => setHovered(0)}>
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            aria-label={`Beri ${star} bintang`}
            onClick={() => onRatingChange(product.id, star)}
            onMouseEnter={() => setHovered(star)}
            className="transition-transform active:scale-90"
          >
            <StarIcon
              className={`h-8 w-8 transition-colors ${
                star <= activeStars ? 'text-yellow-400' : 'text-gray-300'
              }`}
            />
          </button>
        ))}
      </div>

      {/* c. Kolom ulasan (opsional) */}
      <div className="mt-4">
        <label htmlFor={`review-${product.id}`} className="mb-1 block text-sm font-medium text-gray-700">
          Tulis Ulasan <span className="text-xs font-normal text-gray-400">(Opsional)</span>
        </label>
        <textarea
          id={`review-${product.id}`}
          value={review}
          onChange={(e) => onReviewChange(product.id, e.target.value)}
          rows={3}
          placeholder="Bagaimana performa produk ini pada tanaman Kakak? Ceritakan pengalaman seru Kakak di sini..."
          className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 transition focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
        />
      </div>
    </div>
  )
}

// Ikon bintang (inline SVG, warna mengikuti class text-*)
function StarIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
    </svg>
  )
}
