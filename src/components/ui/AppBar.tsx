// src/components/ui/AppBar.tsx
// Navbar atas storefront infarm — fixed di puncak halaman dan selalu berada di lapisan teratas.
// Dirender di layout (store) agar tidak terjebak dalam stacking context section manapun.
// Server Component; tombol menu (MenuDrawer) & search bar persisten (HeaderSearch) = client component.

import Link from 'next/link'
import Image from 'next/image'
import CartIconLink from '@/components/ui/CartIconLink'
import ProfileIconLink from '@/components/ui/ProfileIconLink'
import HeaderSearch from '@/components/ui/HeaderSearch'
import MenuDrawer from '@/components/ui/MenuDrawer'

// Menampilkan app bar global: logo (kiri), search bar persisten (tengah), aksi cart & profile (kanan)
export default function AppBar() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 rounded-b-[2rem] bg-brand-header/90 text-white shadow-sm backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:gap-4 sm:px-6 lg:px-8">
        {/* Grup kiri: menu + logo + nama brand */}
        <div className="flex shrink-0 items-center gap-3 sm:gap-4">
          {/* Tombol menu + drawer navigasi (kategori & layanan pesanan) */}
          <MenuDrawer />

          {/* Logo + nama brand (nama disembunyikan di mobile agar search bar dapat ruang) */}
          <Link href="/" className="flex items-center gap-3 sm:gap-4">
            <Image
              src="/images/logo-infarm.png"
              alt="Logo Infarm"
              width={36}
              height={36}
              priority
              unoptimized
              className="h-9 w-auto object-contain"
            />
            <span className="hidden text-2xl font-bold tracking-tight text-white sm:inline">Infarm</span>
          </Link>
        </div>

        {/* Tengah: search bar persisten (desktop inline, mobile ikon → overlay) */}
        <HeaderSearch />

        {/* Aksi (kanan): Cart, Profile */}
        <nav className="flex shrink-0 items-center gap-3 sm:gap-4">
          {/* Ikon keranjang + badge jumlah reaktif (client component) */}
          <CartIconLink />
          {/* Ikon profil → hub "Pesanan Saya" + badge bila ada jejak checkout (client component) */}
          <ProfileIconLink />
        </nav>
      </div>
    </header>
  )
}
