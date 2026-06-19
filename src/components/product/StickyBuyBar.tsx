'use client'

// src/components/product/StickyBuyBar.tsx
// Bilah aksi bawah yang menempel (fixed/sticky) di dasar layar: "Beli Langsung" & "+ Keranjang".
// Tombol "+ Keranjang" memicu animasi terbang ke ikon keranjang; cookie & badge baru di-update
// SAAT animasi tiba di ikon (lihat handleFlyComplete).

import { useRouter } from 'next/navigation'
import { useCallback, useRef, useState } from 'react'
import { addToCart, setCheckoutItems, showCartToast, CART_BUMP_EVENT } from '@/lib/cart-client'
import FlyToCart, { type FlyPoint } from '@/components/product/FlyToCart'

// Satu partikel animasi yang sedang berjalan
type Particle = { id: number; start: FlyPoint; end: FlyPoint }

// Menampilkan dua tombol aksi utama, animasi fly-to-cart, dan penyimpanan keranjang berbasis cookie.
export default function StickyBuyBar({
  productId,
  price,
}: {
  productId: string
  price: number
}) {
  const router = useRouter()
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const particleId = useRef(0) // penghasil id unik tiap partikel
  const [particles, setParticles] = useState<Particle[]>([])
  const [justAdded, setJustAdded] = useState(false)

  // Menyimpan ke cookie + memicu efek pop pada ikon. Dipakai saat animasi tiba (atau fallback).
  const commitAdd = useCallback(() => {
    addToCart({ productId, quantity: 1, price }) // tulis cookie → badge naik reaktif
    window.dispatchEvent(new CustomEvent(CART_BUMP_EVENT)) // pop ikon keranjang
    showCartToast() // toast sukses
    setJustAdded(true)
    window.setTimeout(() => setJustAdded(false), 1500)
  }, [productId, price])

  // Klik "+ Keranjang": hitung koordinat tombol → ikon keranjang, lalu luncurkan partikel.
  function handleAddToCart() {
    const cartEl = document.getElementById('cart-anchor')
    const button = addButtonRef.current

    // Fallback: bila ikon keranjang tak ditemukan (mis. halaman tanpa header), langsung simpan.
    if (!cartEl || !button) {
      commitAdd()
      return
    }

    const b = button.getBoundingClientRect()
    const c = cartEl.getBoundingClientRect()

    // Titik awal = tengah tombol; titik akhir = tengah ikon keranjang (koordinat viewport)
    const start: FlyPoint = { x: b.left + b.width / 2, y: b.top + b.height / 2 }
    const end: FlyPoint = { x: c.left + c.width / 2, y: c.top + c.height / 2 }

    particleId.current += 1
    setParticles((prev) => [...prev, { id: particleId.current, start, end }])
  }

  // Saat animasi sebuah partikel tiba di ikon: hapus partikel + commit ke cookie.
  const handleFlyComplete = useCallback(
    (id: number) => {
      setParticles((prev) => prev.filter((p) => p.id !== id))
      commitAdd()
    },
    [commitAdd],
  )

  // "Beli Langsung": masukkan ke keranjang, lalu set item checkout = HANYA produk ini, baru ke /checkout.
  // setCheckoutItems wajib dipanggil karena halaman /checkout membaca cookie checkout (infarm_checkout),
  // bukan seluruh isi keranjang. Tanpa ini, checkout menampilkan snapshot lama / dummy (produk berbeda).
  function handleBuyNow() {
    const item = { productId, quantity: 1, price }
    addToCart(item)
    setCheckoutItems([item])
    router.push('/checkout')
  }

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          {/* Tombol "Beli Langsung" — putih, border hitam */}
          <button
            type="button"
            onClick={handleBuyNow}
            className="flex-1 rounded-xl border-2 border-zinc-900 bg-white py-3 text-base font-bold text-zinc-900 transition hover:bg-zinc-50 active:scale-[0.99]"
          >
            Beli Langsung
          </button>

          {/* Tombol "+ Keranjang" — hijau brand */}
          <button
            ref={addButtonRef}
            type="button"
            onClick={handleAddToCart}
            className="flex-1 rounded-xl bg-brand-primary py-3 text-base font-bold text-white shadow-sm transition hover:brightness-90 active:scale-[0.99]"
          >
            {justAdded ? '✓ Ditambahkan' : '+ Keranjang'}
          </button>
        </div>
      </div>

      {/* Partikel animasi terbang (di-portal ke body oleh FlyToCart) */}
      {particles.map((p) => (
        <FlyToCart
          key={p.id}
          start={p.start}
          end={p.end}
          onComplete={() => handleFlyComplete(p.id)}
        />
      ))}
    </>
  )
}
