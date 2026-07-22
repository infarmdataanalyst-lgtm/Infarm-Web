'use client'

// src/components/ui/ProfileIconLink.tsx
// Ikon profil di header → menuju hub "Pesanan Saya" (/pesanan-saya).
// Badge (dot merah) tampil bila ada jejak checkout di device ini (cookie infarm_phone).
// Cek RINGAN dari cookie saja (tanpa query DB) agar tak membebani tiap render header.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { getGuestPhone } from '@/lib/guest-phone'

export default function ProfileIconLink() {
  // Badge = ada no_telepon tersimpan (pernah checkout). Dibaca client setelah mount agar
  // tidak mismatch hidrasi (server tak punya akses cookie ini lewat path client).
  const [hasOrders, setHasOrders] = useState(false)

  useEffect(() => {
    setHasOrders(getGuestPhone().length > 0)
  }, [])

  return (
    <Link href="/pesanan-saya" aria-label="Pesanan Saya" className="relative p-1">
      <ProfileIcon />
      {/* Dot merah penanda kemungkinan ada pesanan aktif (jejak checkout di device ini) */}
      {hasOrders && (
        <span
          aria-hidden
          className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full border-2 border-brand-primary bg-red-500"
        />
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
