'use client'

// src/components/ui/CartIconLink.tsx
// Ikon keranjang di header dengan badge jumlah item yang REAKTIF terhadap cookie keranjang.
// Badge dibaca via useSyncExternalStore (sumber: cookie) dan ikon "pop" saat menerima CART_BUMP_EVENT.
//
// Perilaku berbeda per lebar layar (batas sm = 640px, sama dengan breakpoint header lain):
//  - Mobile (<640px): tetap <Link> ke /keranjang — TIDAK berubah dari sebelumnya.
//  - Desktop (≥640px): tombol yang membuka mini cart (lihat MiniCart), tanpa pindah halaman.
// Pemilihan varian memakai useMediaQuery (bukan kelas `sm:hidden`) supaya hanya SATU elemen ikon
// yang ada di DOM: id="cart-anchor" harus unik & punya ukuran nyata karena dipakai animasi
// fly-to-cart (StickyBuyBar) untuk menghitung titik akhir. Elemen `display:none` akan memberi
// rect 0×0 dan membuat animasi terbang ke pojok layar.

import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { subscribeCart, getCartCount, CART_BUMP_EVENT } from '@/lib/cart-client'
import { useMediaQuery } from '@/hooks/use-media-query'
import MiniCart from '@/components/ui/MiniCart'

// Menampilkan ikon keranjang + badge merah (jumlah total item di cookie). Badge tersembunyi bila 0.
export default function CartIconLink() {
  // Jumlah total item di keranjang (primitif number → aman jadi snapshot tanpa cache khusus).
  // Snapshot server selalu 0 agar tidak mismatch saat hidrasi.
  const count = useSyncExternalStore(subscribeCart, getCartCount, () => 0)

  // Desktop = ≥640px. Snapshot server false → HTML awal memakai varian mobile (<Link>),
  // aman untuk pengguna tanpa JS maupun sebelum hidrasi.
  const isDesktop = useMediaQuery('(min-width: 640px)')

  // Status buka mini cart (hanya dipakai di desktop)
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Status animasi "pop" sesaat saat barang baru masuk
  const [bump, setBump] = useState(false)

  // Dengarkan event bump (dikirim saat animasi terbang menyentuh ikon)
  useEffect(() => {
    function handleBump() {
      setBump(true)
      window.setTimeout(() => setBump(false), 450) // selaras durasi keyframe cart-bump
    }
    window.addEventListener(CART_BUMP_EVENT, handleBump)
    return () => window.removeEventListener(CART_BUMP_EVENT, handleBump)
  }, [])

  // Tutup mini cart saat klik di luar area ikon/panel atau menekan Escape
  useEffect(() => {
    if (!open) return

    const onPointerDown = (e: PointerEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // Isi ikon + badge (dipakai varian mobile & desktop)
  const iconWithBadge = (
    <>
      <span className={`inline-block ${bump ? 'animate-cart-bump' : ''}`}>
        <CartIcon />
      </span>

      {/* Badge jumlah — hanya tampil bila ada item */}
      {count > 0 && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </>
  )

  return (
    <div ref={wrapperRef} className="relative">
      {isDesktop ? (
        <>
          <button
            id="cart-anchor"
            type="button"
            aria-label="Keranjang"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="relative block p-1 transition active:scale-95"
          >
            {iconWithBadge}
          </button>
          <MiniCart open={open} onClose={() => setOpen(false)} />
        </>
      ) : (
        <Link id="cart-anchor" href="/keranjang" aria-label="Keranjang" className="relative block p-1">
          {iconWithBadge}
        </Link>
      )}
    </div>
  )
}

// Ikon keranjang dari aset PNG (public/images/icons/cart.png — 512px, putih, latar transparan).
// Sumber 512px sengaja jauh lebih besar dari ukuran render 24px agar tajam di layar retina;
// next/image menurunkan skalanya sesuai DPR perangkat.
// Catatan: berbeda dengan versi SVG sebelumnya, warna ikon TERKUNCI putih (tak ikut currentColor).
function CartIcon() {
  return (
    <Image
      src="/images/icons/cart.png"
      alt=""
      width={24}
      height={24}
      priority
      className="h-6 w-6 object-contain"
    />
  )
}
