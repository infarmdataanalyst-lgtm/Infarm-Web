'use client'

// src/components/product/CartToast.tsx
// Toast notifikasi sukses "Berhasil ditambahkan ke keranjang". Muncul saat menerima
// CART_TOAST_EVENT, bertahan 2 detik, lalu memudar otomatis. Posisi: tengah-atas (di bawah header).

import { useEffect, useRef, useState } from 'react'
import { ShoppingCart, Check } from 'lucide-react'
import { CART_TOAST_EVENT } from '@/lib/cart-client'

const DEFAULT_MESSAGE = 'Berhasil ditambahkan ke keranjang belanja!'
const VISIBLE_MS = 2000 // lama tampil sebelum mulai memudar
const FADE_MS = 300 // durasi transisi fade (selaras duration-300)

// Menampilkan toast sukses melayang yang muncul & hilang otomatis dengan transisi halus.
export default function CartToast() {
  const [mounted, setMounted] = useState(false) // ada di DOM (agar bisa fade-out sebelum dilepas)
  const [show, setShow] = useState(false) // status opacity/transform untuk transisi
  const [message, setMessage] = useState(DEFAULT_MESSAGE)

  // Simpan id timer agar bisa di-reset bila toast dipicu lagi sebelum selesai
  const hideTimer = useRef<number | null>(null)
  const removeTimer = useRef<number | null>(null)

  useEffect(() => {
    function handleToast(event: Event) {
      const detail = (event as CustomEvent<{ message?: string }>).detail
      setMessage(detail?.message ?? DEFAULT_MESSAGE)

      // Reset timer lama bila ada (klik beruntun → durasi dihitung ulang dari awal)
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
      if (removeTimer.current) window.clearTimeout(removeTimer.current)

      setMounted(true)
      // rAF: pasang state "show" di frame berikutnya agar transisi masuk (fade-in) terpicu
      requestAnimationFrame(() => setShow(true))

      // Mulai fade-out setelah 2 detik, lalu lepas dari DOM setelah transisi selesai
      hideTimer.current = window.setTimeout(() => setShow(false), VISIBLE_MS)
      removeTimer.current = window.setTimeout(() => setMounted(false), VISIBLE_MS + FADE_MS)
    }

    window.addEventListener(CART_TOAST_EVENT, handleToast)
    return () => {
      window.removeEventListener(CART_TOAST_EVENT, handleToast)
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
      if (removeTimer.current) window.clearTimeout(removeTimer.current)
    }
  }, [])

  if (!mounted) return null

  return (
    <div
      role="status"
      aria-live="polite"
      // -translate-x-1/2 (selalu) untuk center; translate-y + opacity dianimasikan saat show berubah
      className={`fixed left-1/2 top-16 z-[60] -translate-x-1/2 transition-all duration-300 ease-out ${
        show ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'
      }`}
    >
      <div className="flex items-center gap-2.5 rounded-xl border border-brand-light bg-white px-4 py-3 shadow-lg">
        <CartCheckIcon />
        <p className="text-sm font-semibold text-zinc-800">{message}</p>
      </div>
    </div>
  )
}

// Ikon keranjang hijau dengan tanda centang yang diposisikan tepat di tengah wadah keranjang.
// Wrapper `relative` + centang `absolute inset-0` agar selalu terpusat di dalam ikon keranjang.
function CartCheckIcon() {
  return (
    <span className="relative inline-flex h-6 w-6 shrink-0 text-emerald-600" aria-hidden>
      <ShoppingCart className="h-6 w-6" strokeWidth={2} />
      {/* Centang kecil di tengah wadah keranjang.
          Digeser kanan ~2px (gagang keranjang ada di kiri) & atas ~1px agar pas di tengah wadah, bukan di roda. */}
      <span className="absolute inset-0 flex items-center justify-center">
        <Check className="h-2.5 w-2.5 translate-x-[2px] -translate-y-[1px]" strokeWidth={3.5} />
      </span>
    </span>
  )
}
