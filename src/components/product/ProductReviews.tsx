'use client'

// src/components/product/ProductReviews.tsx
// Seksi ulasan produk: skor kepuasan ringkas, filter rating bintang + media, dan daftar komentar.
// Client Component karena filter memakai state interaktif.

import Image from 'next/image'
import { useMemo, useState } from 'react'
import { Star } from 'lucide-react'
import type { ProductReview } from '@/types/product'
import StarRating from '@/components/product/StarRating'

// Tipe filter media (berdasarkan ada/tidaknya foto pada ulasan)
type MediaFilter = 'all' | 'with-photo' | 'comment-only'

// Nilai filter rating; 0 = "Semua Rating", 1–5 = jumlah bintang tepat
const RATING_VALUES = [0, 5, 4, 3, 2, 1]

// Opsi filter media
const MEDIA_FILTERS: { label: string; value: MediaFilter }[] = [
  { label: 'Semua Konten', value: 'all' },
  { label: 'Dengan Foto', value: 'with-photo' },
  { label: 'Hanya Komentar', value: 'comment-only' },
]

// Menampilkan ringkasan rating + filter bintang/media + daftar ulasan yang bisa difilter.
export default function ProductReviews({
  rating,
  reviewCount,
  reviews,
}: {
  rating: number
  reviewCount: number
  reviews: ProductReview[]
}) {
  // === State filter ===
  const [selectedRating, setSelectedRating] = useState<number>(0) // 0 = semua rating
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all')

  // === Logika filter (kuantitatif + media) ===
  const visibleReviews = useMemo(() => {
    return reviews.filter((review) => {
      // Filter rating bintang: 0 = semua, selain itu cocokkan nilai persis
      const ratingMatch = selectedRating === 0 || review.rating === selectedRating

      // Filter media: cek apakah ulasan punya lampiran foto (imageUrls = field foto yang ada)
      const hasPhoto = (review.imageUrls?.length ?? 0) > 0
      const mediaMatch =
        mediaFilter === 'all' ||
        (mediaFilter === 'with-photo' && hasPhoto) ||
        (mediaFilter === 'comment-only' && !hasPhoto)

      return ratingMatch && mediaMatch
    })
  }, [reviews, selectedRating, mediaFilter])

  return (
    <section className="bg-white px-4 py-4">
      <h2 className="mb-3 text-sm font-bold text-zinc-800">Ulasan Pembeli</h2>

      {/* === Skor kepuasan ringkas === */}
      <div className="flex items-center gap-4 rounded-xl bg-brand-surface p-4">
        <div className="text-center">
          <p className="text-3xl font-extrabold text-zinc-800">{rating.toFixed(1)}</p>
          <p className="text-xs text-zinc-500">dari 5</p>
        </div>
        <div>
          <StarRating rating={rating} size={18} />
          <p className="mt-1 text-xs text-zinc-500">{reviewCount} ulasan terverifikasi</p>
        </div>
      </div>

      {/* === Filter rating bintang (ikon) === */}
      <div className="mt-4 flex flex-wrap gap-2">
        {RATING_VALUES.map((value) => (
          <RatingPill
            key={value}
            value={value}
            active={selectedRating === value}
            onClick={() => setSelectedRating(value)}
          />
        ))}
      </div>

      {/* === Filter media (foto vs teks) === */}
      <div className="mt-2 flex flex-wrap gap-2">
        {MEDIA_FILTERS.map((filter) => (
          <FilterPill
            key={filter.value}
            label={filter.label}
            active={mediaFilter === filter.value}
            onClick={() => setMediaFilter(filter.value)}
          />
        ))}
      </div>

      {/* === Daftar ulasan === */}
      <ul className="mt-4 divide-y divide-zinc-100">
        {visibleReviews.map((review) => (
          <li key={review.id} className="py-4 first:pt-0">
            <ReviewItem review={review} />
          </li>
        ))}
        {visibleReviews.length === 0 && (
          <li className="py-8 text-center text-sm text-zinc-400">
            Tidak ada ulasan yang cocok dengan kriteria filter.
          </li>
        )}
      </ul>
    </section>
  )
}

// === Sub-komponen ===

// Tombol filter rating berbentuk kapsul berisi ikon bintang.
// value 0 = "Semua Rating" (teks + 1 bintang), 1–5 = sejumlah ikon bintang.
function RatingPill({
  value,
  active,
  onClick,
}: {
  value: number
  active: boolean
  onClick: () => void
}) {
  // Bintang: putih saat aktif, emas saat nonaktif
  const starClass = active ? 'fill-white stroke-white' : 'fill-amber-400 stroke-amber-400'

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={value === 0 ? 'Semua rating' : `${value} bintang`}
      className={`flex shrink-0 items-center gap-1 rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
        active
          ? 'border-emerald-600 bg-emerald-600 text-white'
          : 'border-zinc-200 bg-white text-zinc-600 hover:bg-slate-50'
      }`}
    >
      {value === 0 ? (
        <>
          <span>Semua Rating</span>
          <Star className={`h-3.5 w-3.5 ${starClass}`} />
        </>
      ) : (
        Array.from({ length: value }, (_, i) => (
          <Star key={i} className={`h-3.5 w-3.5 ${starClass}`} />
        ))
      )}
    </button>
  )
}

// Tombol filter berbentuk kapsul: hijau Infarm saat aktif, abu terang saat nonaktif
function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
        active
          ? 'bg-emerald-600 text-white'
          : 'bg-slate-50 text-zinc-600 hover:bg-slate-100'
      }`}
    >
      {label}
    </button>
  )
}

// === Sub-komponen ===

// Satu baris ulasan: avatar inisial, nama, tanggal, bintang, komentar, dan foto (opsional)
function ReviewItem({ review }: { review: ProductReview }) {
  const { authorName, rating, date, comment, imageUrls } = review

  return (
    <div>
      <div className="flex items-center gap-2">
        {/* Avatar inisial */}
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-light text-sm font-bold text-white">
          {authorName.charAt(0)}
        </span>
        <div>
          <p className="text-sm font-semibold text-zinc-800">{authorName}</p>
          <p className="text-xs text-zinc-400">{formatReviewDate(date)}</p>
        </div>
      </div>

      <div className="mt-2">
        <StarRating rating={rating} size={14} />
      </div>

      <p className="mt-1.5 text-sm leading-relaxed text-zinc-600">{comment}</p>

      {/* Foto ulasan (opsional) */}
      {imageUrls && imageUrls.length > 0 && (
        <div className="mt-2 flex gap-2">
          {imageUrls.map((src, i) => (
            <div
              key={i}
              className="relative h-16 w-16 overflow-hidden rounded-lg border border-zinc-100 bg-zinc-50"
            >
              {/* unoptimized: placeholder SVG sementara */}
              <Image src={src} alt={`Foto ulasan ${i + 1}`} fill unoptimized sizes="64px" className="object-cover" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Memformat tanggal ISO menjadi format Indonesia, mis. '2026-05-28' -> '28 Mei 2026'
function formatReviewDate(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
}
