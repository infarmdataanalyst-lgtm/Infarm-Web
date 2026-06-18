'use client'

// src/components/review/ReviewProductCard.tsx
// Blok ulasan satu produk, disusun dalam beberapa section card terpisah (sesuai desain):
//   1. Kartu produk (sesuai item yang di-checkout)
//   2. Section rating bintang interaktif (klik → kuning)
//   3. Section tulis ulasan
//   4. Section tambah foto (opsional, preview + hapus)
// Rating & teks dikelola parent (per produk). Foto dikelola lokal di kartu karena belum
// dikirim ke backend (placeholder sampai Supabase Storage siap).

import Image from 'next/image'
import { useEffect, useState } from 'react'
import { Camera, X } from 'lucide-react'
import type { ReviewProduct } from '@/lib/data/dummy-review'
import { formatRupiah } from '@/lib/format'

// Menampilkan blok input ulasan untuk satu produk.
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

  // Foto yang dipilih user (lokal). previews = object URL untuk pratinjau gambar.
  const [photos, setPhotos] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])

  // Buat & bersihkan object URL setiap kali daftar foto berubah (cegah memory leak)
  useEffect(() => {
    const urls = photos.map((file) => URL.createObjectURL(file))
    setPreviews(urls)
    return () => urls.forEach((url) => URL.revokeObjectURL(url))
  }, [photos])

  // Tambah foto dari input file (boleh pilih beberapa sekaligus)
  function handleAddPhotos(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files) return
    setPhotos((prev) => [...prev, ...Array.from(files)])
    // Reset value agar file yang sama bisa dipilih lagi setelah dihapus
    e.target.value = ''
  }

  // Hapus satu foto berdasarkan indeks
  function handleRemovePhoto(index: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-4">
      {/* === 1. Kartu produk === */}
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-gray-100 bg-gray-50">
            {/* unoptimized: placeholder sementara */}
            <Image src={product.imageUrl} alt={product.name} fill unoptimized sizes="64px" className="object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 text-sm font-bold leading-snug text-gray-800">
              {product.name}
            </h3>
            <p className="mt-0.5 text-xs text-gray-400">Varian: {product.variant}</p>
            <p className="mt-1 text-sm font-semibold text-gray-700">{formatRupiah(product.price)}</p>
          </div>
        </div>
      </div>

      {/* === 2. Section rating === */}
      <div className="rounded-xl bg-white p-4 text-center shadow-sm">
        <p className="text-sm font-semibold text-gray-800">Bagaimana kualitas produk ini?</p>
        <div className="mt-3 flex items-center justify-center gap-1.5" onMouseLeave={() => setHovered(0)}>
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
                className={`h-9 w-9 transition-colors ${
                  star <= activeStars ? 'text-yellow-400' : 'text-gray-300'
                }`}
              />
            </button>
          ))}
        </div>
      </div>

      {/* === 3. Section tulis ulasan === */}
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <label htmlFor={`review-${product.id}`} className="mb-2 block text-sm font-semibold text-gray-800">
          Tulis Ulasan Anda
        </label>
        <textarea
          id={`review-${product.id}`}
          value={review}
          onChange={(e) => onReviewChange(product.id, e.target.value)}
          rows={4}
          placeholder="Bagikan pengalaman berkebunmu dengan produk ini..."
          className="w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 transition focus:border-brand-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
        />
      </div>

      {/* === 4. Section tambah foto (opsional) === */}
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-gray-800">
          Tambahkan Foto <span className="text-xs font-normal text-gray-400">(Opsional)</span>
        </p>
        <div className="flex flex-wrap gap-3">
          {/* Pratinjau foto terpilih + tombol hapus */}
          {previews.map((src, index) => (
            <div key={src} className="relative h-20 w-20 overflow-hidden rounded-lg border border-gray-200">
              {/* unoptimized: object URL lokal */}
              <Image src={src} alt={`Foto ulasan ${index + 1}`} fill unoptimized sizes="80px" className="object-cover" />
              <button
                type="button"
                onClick={() => handleRemovePhoto(index)}
                aria-label="Hapus foto"
                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}

          {/* Kotak upload (dashed) */}
          <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-gray-300 text-gray-400 transition hover:border-brand-primary hover:text-brand-primary">
            <Camera className="h-5 w-5" />
            <span className="text-[10px] font-medium">Upload</span>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleAddPhotos}
              className="hidden"
            />
          </label>
        </div>
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
