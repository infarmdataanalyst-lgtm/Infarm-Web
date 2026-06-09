'use client'

// src/components/review/ReviewForm.tsx
// Form ulasan: header sticky (ID order dari query param), daftar kartu produk (multi-produk),
// dan tombol kirim. State rating & teks disimpan per produk (key = productId) agar tidak saling memengaruhi.

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { dummyReviewOrder } from '@/lib/data/dummy-review'
import ReviewProductCard from '@/components/review/ReviewProductCard'

// State ulasan per produk
type ReviewEntry = { rating: number; review: string }

export default function ReviewForm() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const { products } = dummyReviewOrder
  // ID order diambil dinamis dari URL (?order=...), fallback ke ID dummy
  const orderId = searchParams.get('order') ?? dummyReviewOrder.orderId

  // State ulasan: object dengan key productId → { rating, review } (terisolasi antar produk)
  const [reviews, setReviews] = useState<Record<string, ReviewEntry>>(() =>
    Object.fromEntries(products.map((p) => [p.id, { rating: 0, review: '' }])),
  )

  // Memperbarui rating satu produk saja
  function handleRatingChange(productId: string, rating: number) {
    setReviews((prev) => ({ ...prev, [productId]: { ...prev[productId], rating } }))
  }

  // Memperbarui teks ulasan satu produk saja
  function handleReviewChange(productId: string, review: string) {
    setReviews((prev) => ({ ...prev, [productId]: { ...prev[productId], review } }))
  }

  // Kirim ulasan — placeholder. TODO: simpan ke Supabase setelah OMS selesai.
  function handleSubmit() {
    const payload = products.map((p) => ({ productId: p.id, ...reviews[p.id] }))
    console.log('Kirim ulasan:', { orderId, items: payload })
    window.alert('Terima kasih! Ulasan Kakak berhasil dikirim.')
  }

  return (
    <div className="flex min-h-screen flex-col bg-brand-surface">
      {/* 1 — Header sticky */}
      <header className="sticky top-0 z-30 border-b border-gray-100 bg-white">
        <div className="relative mx-auto flex h-14 max-w-2xl items-center justify-center px-12">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Kembali"
            className="absolute left-3 rounded-md p-1 text-gray-700 transition active:scale-95"
          >
            <BackArrowIcon />
          </button>
          <h1 className="truncate text-center text-base font-bold text-gray-800">
            Berikan ulasan untuk pesanan #{orderId}
          </h1>
        </div>
      </header>

      {/* 2 + 3 — Daftar kartu produk (looping), dipisah garis tipis bila lebih dari satu */}
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-4 pb-28">
        <ul className="flex flex-col">
          {products.map((product) => (
            <li
              key={product.id}
              className="[&:not(:last-child)]:mb-6 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-gray-100 [&:not(:last-child)]:pb-6"
            >
              <ReviewProductCard
                product={product}
                rating={reviews[product.id].rating}
                review={reviews[product.id].review}
                onRatingChange={handleRatingChange}
                onReviewChange={handleReviewChange}
              />
            </li>
          ))}
        </ul>
      </main>

      {/* 4 — Tombol aksi utama (sticky bawah, full-width) */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-100 bg-white">
        <div className="mx-auto max-w-2xl px-4 py-3">
          <button
            type="button"
            onClick={handleSubmit}
            className="w-full rounded-xl bg-brand-primary py-3.5 text-base font-bold text-white transition-colors hover:bg-green-800 active:bg-green-800"
          >
            Kirim Ulasan
          </button>
        </div>
      </div>
    </div>
  )
}

function BackArrowIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  )
}
