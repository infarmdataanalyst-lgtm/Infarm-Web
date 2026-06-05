// src/app/(store)/layout.tsx
// Layout untuk route group (store) — halaman publik ecommerce infarm.
// Memaksa tema terang & membungkus konten dalam kontainer lebar mobile (desain mobile-first).

import type { Metadata } from 'next'
import AppBar from '@/components/ui/AppBar'

export const metadata: Metadata = {
  title: 'infarm — Berkebun Jadi Mudah, Pasti Panen',
  description:
    'Belanja benih premium, pupuk nutrisi, media tanam, dan peralatan berkebun original di infarm. Harga lebih murah, gratis ongkir Jawa & Bali.',
}

// Membungkus seluruh halaman store dengan latar putih, full-width & responsive.
// Tiap section yang mengatur lebar maksimum kontennya sendiri (mobile → desktop).
export default function StoreLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-screen w-full flex-col bg-brand-surface text-zinc-900">
      {/* Navbar global — fixed & selalu di lapisan teratas (lihat AppBar) */}
      <AppBar />
      {children}
    </div>
  )
}
