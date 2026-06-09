// src/app/review/page.tsx
// Halaman input ulasan (/review). Di luar route group (store) karena punya header putih sendiri.
// useSearchParams (di ReviewForm) wajib dibungkus <Suspense> agar build Next.js tidak error.

import { Suspense } from 'react'
import ReviewForm from '@/components/review/ReviewForm'

export default function ReviewPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-brand-surface" />}>
      <ReviewForm />
    </Suspense>
  )
}
