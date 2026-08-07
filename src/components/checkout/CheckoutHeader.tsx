'use client'

// src/components/checkout/CheckoutHeader.tsx
// Header halaman checkout: bar hijau sticky dengan tombol kembali (←), logo, dan judul "Checkout".
//
// SENGAJA MINIMAL — halaman checkout berada di luar route group (store) sehingga `AppBar` tidak
// pernah dirender di sini: tidak ada search bar, ikon keranjang, maupun ikon akun. Tujuannya
// menjaga fokus penyelesaian pembayaran (FloatingWhatsApp juga self-gate di /checkout).
// JANGAN menambahkan navigasi keluar baru ke header ini.
//
// Logo TIDAK dibungkus <Link>: satu-satunya jalan keluar yang disengaja adalah tombol kembali,
// supaya user tidak tercampak dari alur pembayaran karena menyenggol logo.

import Image from 'next/image'
import { useRouter } from 'next/navigation'

// Menampilkan header hijau checkout dengan tombol kembali, logo non-tautan, dan judul halaman.
export default function CheckoutHeader() {
  const router = useRouter()

  return (
    <header className="sticky top-0 z-30 rounded-b-[2rem] bg-brand-header/90 text-white shadow-sm backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Kembali"
          className="rounded-md p-1 transition active:scale-95"
        >
          <BackArrowIcon />
        </button>

        {/* Logo — elemen statis (bukan tautan), hanya penanda brand */}
        <Image
          src="/images/logo-infarm.png"
          alt="infarm"
          width={32}
          height={32}
          priority
          unoptimized
          className="h-8 w-auto object-contain"
        />

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
