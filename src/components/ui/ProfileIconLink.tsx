'use client'

// src/components/ui/ProfileIconLink.tsx
// Ikon profil di header → menuju hub "Pesanan Saya" (/pesanan-saya).
// Badge ANGKA menampilkan estimasi jumlah pesanan aktif dari cookie (infarm_active_orders).
// HANYA baca cookie (tanpa query DB) agar header ringan. Angka di-refresh akurat saat buka
// /pesanan-saya; di-increment saat checkout sukses. Event ACTIVE_ORDERS_EVENT memicu baca ulang.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { getActiveOrderCount, ACTIVE_ORDERS_EVENT } from '@/lib/guest-phone'

export default function ProfileIconLink() {
  // Jumlah pesanan aktif (estimasi cookie). Dibaca client setelah mount agar tak mismatch hidrasi.
  const [count, setCount] = useState(0)

  useEffect(() => {
    const read = () => setCount(getActiveOrderCount())
    read()
    // Update saat cookie berubah (checkout sukses / refresh di /pesanan-saya) tanpa reload halaman.
    window.addEventListener(ACTIVE_ORDERS_EVENT, read)
    return () => window.removeEventListener(ACTIVE_ORDERS_EVENT, read)
  }, [])

  return (
    <Link href="/pesanan-saya" aria-label="Pesanan Saya" className="relative p-1">
      <ProfileIcon />
      {/* Badge angka pesanan aktif — style konsisten dengan badge keranjang. Tersembunyi bila 0. */}
      {count > 0 && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
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
