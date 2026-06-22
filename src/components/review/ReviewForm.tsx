'use client'

// src/components/review/ReviewForm.tsx
// Form ulasan: header sticky (Order ID dari query param), daftar kartu produk dari pesanan asli,
// dan tombol kirim. Produk yang diulas diambil dari pesanan (?order=...) via /api/orders/get,
// lalu disimpan ke Supabase via /api/reviews/create. State rating & teks per produk (key = productId).

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import type { ReviewProduct } from '@/lib/data/dummy-review'
import type { OrderItem } from '@/types/order'
import type { StoredProduct } from '@/types/product'
import ReviewProductCard from '@/components/review/ReviewProductCard'

// State ulasan per produk
type ReviewEntry = { rating: number; review: string }

const PLACEHOLDER_IMAGE = '/images/product-placeholder.png'

export default function ReviewForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const orderId = searchParams.get('order') ?? ''

  // Data produk yang akan diulas (dibangun dari item pesanan)
  const [products, setProducts] = useState<ReviewProduct[]>([])
  const [customerName, setCustomerName] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'notfound'>('loading')
  const [submitting, setSubmitting] = useState(false)

  // State ulasan: key productId → { rating, review }
  const [reviews, setReviews] = useState<Record<string, ReviewEntry>>({})

  // === Ambil pesanan asli + detail produk (untuk foto), lalu bangun daftar produk yang diulas ===
  useEffect(() => {
    if (!orderId) {
      setStatus('notfound')
      return
    }

    let active = true
    Promise.all([
      fetch(`/api/orders/get?orderId=${encodeURIComponent(orderId)}`).then((r) =>
        r.ok ? r.json() : null,
      ),
      fetch('/api/products/list').then((r) => (r.ok ? r.json() : { products: [] })),
    ])
      .then(([orderRes, productRes]) => {
        if (!active) return
        if (!orderRes?.order) {
          setStatus('notfound')
          return
        }

        // Peta id produk → foto, untuk melengkapi item pesanan yang tidak menyimpan imageUrl
        const imageById = new Map<string, string>()
        for (const p of (productRes.products ?? []) as StoredProduct[]) {
          imageById.set(p.id, p.imageUrl)
        }

        const items = orderRes.order.items as OrderItem[]
        const built: ReviewProduct[] = items.map((item) => ({
          id: item.productId,
          name: item.name,
          variant: '', // pesanan belum menyimpan varian
          imageUrl: imageById.get(item.productId) || PLACEHOLDER_IMAGE,
          price: item.price,
        }))

        setProducts(built)
        setCustomerName(orderRes.order.customerName ?? '')
        setReviews(Object.fromEntries(built.map((p) => [p.id, { rating: 0, review: '' }])))
        setStatus('ready')
      })
      .catch(() => {
        if (active) setStatus('notfound')
      })

    return () => {
      active = false
    }
  }, [orderId])

  // Memperbarui rating satu produk saja
  function handleRatingChange(productId: string, rating: number) {
    setReviews((prev) => ({ ...prev, [productId]: { ...prev[productId], rating } }))
  }

  // Memperbarui teks ulasan satu produk saja
  function handleReviewChange(productId: string, review: string) {
    setReviews((prev) => ({ ...prev, [productId]: { ...prev[productId], review } }))
  }

  // Hanya produk yang sudah diberi bintang yang akan dikirim
  const ratedCount = useMemo(
    () => products.filter((p) => (reviews[p.id]?.rating ?? 0) > 0).length,
    [products, reviews],
  )

  // Kirim ulasan ke Supabase (satu request per produk yang dirating), lalu ke halaman konfirmasi.
  async function handleSubmit() {
    if (submitting) return
    const toSubmit = products.filter((p) => (reviews[p.id]?.rating ?? 0) > 0)
    if (toSubmit.length === 0) return

    setSubmitting(true)
    try {
      await Promise.all(
        toSubmit.map((p) =>
          fetch('/api/reviews/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              productId: p.id,
              authorName: customerName || 'Pelanggan Infarm',
              rating: reviews[p.id].rating,
              comment: reviews[p.id].review,
            }),
          }),
        ),
      )
      router.push(`/review/submitted?order=${encodeURIComponent(orderId)}`)
    } catch {
      setSubmitting(false)
    }
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
            {orderId ? `Berikan ulasan untuk pesanan #${orderId}` : 'Berikan ulasan'}
          </h1>
        </div>
      </header>

      {/* 2 — Konten: loading / tidak ditemukan / daftar produk */}
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-4 pb-28">
        {status === 'loading' && (
          <p className="px-4 py-16 text-center text-sm text-gray-400">Memuat produk pesanan…</p>
        )}

        {status === 'notfound' && (
          <div className="px-4 py-16 text-center">
            <p className="text-sm text-gray-500">
              Pesanan tidak ditemukan. Pastikan kamu membuka halaman ini dari pesanan yang berhasil.
            </p>
          </div>
        )}

        {status === 'ready' && (
          <ul className="flex flex-col">
            {products.map((product) => (
              <li
                key={product.id}
                className="[&:not(:last-child)]:mb-6 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-gray-100 [&:not(:last-child)]:pb-6"
              >
                <ReviewProductCard
                  product={product}
                  rating={reviews[product.id]?.rating ?? 0}
                  review={reviews[product.id]?.review ?? ''}
                  onRatingChange={handleRatingChange}
                  onReviewChange={handleReviewChange}
                />
              </li>
            ))}
          </ul>
        )}
      </main>

      {/* 3 — Tombol aksi utama (sticky bawah, full-width) */}
      {status === 'ready' && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-100 bg-white">
          <div className="mx-auto max-w-2xl px-4 py-3">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={ratedCount === 0 || submitting}
              className="w-full rounded-xl bg-brand-primary py-3.5 text-base font-bold text-white transition-colors hover:bg-green-800 active:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Mengirim…' : 'Kirim Ulasan'}
            </button>
          </div>
        </div>
      )}
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
