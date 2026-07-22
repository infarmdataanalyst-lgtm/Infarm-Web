// src/components/ui/AppBar.tsx
// Navbar atas storefront infarm — fixed di puncak halaman dan selalu berada di lapisan teratas.
// Dirender di layout (store) agar tidak terjebak dalam stacking context section manapun.
// Server Component — menu/search masih placeholder visual.

import Link from 'next/link'
import Image from 'next/image'
import CartIconLink from '@/components/ui/CartIconLink'
import ProfileIconLink from '@/components/ui/ProfileIconLink'

// Menampilkan app bar global: grup kiri (menu + logo + nama brand) dan aksi search/cart/profile (kanan)
export default function AppBar() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 bg-brand-primary text-white shadow-sm">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Grup kiri: menu, logo, nama brand — jarak antarelemen disamakan via gap */}
        <div className="flex items-center gap-3 sm:gap-4">
          {/* Tombol menu */}
          <button
            type="button"
            aria-label="Buka menu"
            className="rounded-md p-1 transition active:scale-95"
          >
            <HamburgerIcon />
          </button>

          {/* Logo + nama brand */}
          <Link href="/" className="flex items-center gap-3 sm:gap-4">
            <Image
              src="/images/logo-infarm.png"
              alt="Logo Infarm"
              width={36}
              height={36}
              priority
              className="h-9 w-auto object-contain"
            />
            <span className="text-2xl font-bold tracking-tight">Infarm</span>
          </Link>
        </div>

        {/* Aksi (kanan): Search, Cart, Profile */}
        <nav className="flex items-center gap-3 sm:gap-4">
          <button type="button" aria-label="Cari" className="p-1 transition active:scale-95">
            <SearchIcon />
          </button>
          {/* Ikon keranjang + badge jumlah reaktif (client component) */}
          <CartIconLink />
          {/* Ikon profil → hub "Pesanan Saya" + badge bila ada jejak checkout (client component) */}
          <ProfileIconLink />
        </nav>
      </div>
    </header>
  )
}

// === Ikon inline (SVG) ===
// Inline SVG agar tidak menambah dependency icon library (lihat aturan CLAUDE.md).

function HamburgerIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}
