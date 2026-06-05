// src/components/ui/AppBar.tsx
// Navbar atas storefront infarm — fixed di puncak halaman dan selalu berada di lapisan teratas.
// Dirender di layout (store) agar tidak terjebak dalam stacking context section manapun.
// Server Component — menu/search masih placeholder visual.

import Link from 'next/link'

// Menampilkan app bar global: tombol menu (kiri), logo infarm (tengah), aksi search/cart/profile (kanan)
export default function AppBar() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 bg-brand-primary text-white shadow-sm">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Tombol menu (kiri) */}
        <button
          type="button"
          aria-label="Buka menu"
          className="rounded-md p-1 transition active:scale-95"
        >
          <HamburgerIcon />
        </button>

        {/* Logo (tengah) */}
        <Link href="/" className="text-2xl font-bold lowercase tracking-tight">
          infarm
        </Link>

        {/* Aksi (kanan): Search, Cart, Profile */}
        <nav className="flex items-center gap-3 sm:gap-4">
          <button type="button" aria-label="Cari" className="p-1 transition active:scale-95">
            <SearchIcon />
          </button>
          <Link href="/keranjang" aria-label="Keranjang" className="p-1">
            <CartIcon />
          </Link>
          <Link href="/akun" aria-label="Akun" className="p-1">
            <ProfileIcon />
          </Link>
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

function CartIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="9" cy="21" r="1.5" />
      <circle cx="19" cy="21" r="1.5" />
      <path d="M2.5 3h2l2.6 12.4a2 2 0 0 0 2 1.6h8.7a2 2 0 0 0 2-1.6L23 7H6" />
    </svg>
  )
}

function ProfileIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  )
}
