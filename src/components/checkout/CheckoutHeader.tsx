'use client'

// src/components/checkout/CheckoutHeader.tsx
// Header halaman checkout: bar hijau sticky dengan tombol kembali (←) + judul "Checkout".

import { useRouter } from 'next/navigation'

// Menampilkan header hijau checkout dengan tombol kembali dan judul halaman.
export default function CheckoutHeader() {
  const router = useRouter()

  return (
    <header className="sticky top-0 z-30 bg-brand-primary text-white shadow-sm">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Kembali"
          className="rounded-md p-1 transition active:scale-95"
        >
          <BackArrowIcon />
        </button>
        <h1 className="text-lg font-bold">Checkout</h1>
      </div>
    </header>
  )
}

function BackArrowIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  )
}
