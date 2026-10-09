'use client'

// src/components/ui/ProfileIconLink.tsx
// Ikon akun di header → langsung ke halaman Pesanan Saya (/pesanan-saya), dengan badge angka
// pesanan aktif.
//
// Dulu ikon ini membuka dropdown berisi tiga aksi (lacak/batalkan/review), lalu satu tautan.
// Sejak tiga halaman itu dilebur ke satu halaman (2026-10-09), pop-up perantara hanya menambah
// satu klik — pemilik meminta ikon langsung menuju halamannya. Semua aksi ada di sana: tab
// Aktif/Selesai, ulasan di kartu, pembatalan di halaman detail.
//
// Catatan: proyek ini GUEST CHECKOUT (tanpa login pelanggan), jadi tidak ada Profil/Logout/
// Alamat Tersimpan — identitas guest hanya email/no_telepon di cookie.
//
// Badge ANGKA menampilkan estimasi jumlah pesanan aktif dari cookie (infarm_active_orders).
// HANYA baca cookie (tanpa query DB) agar header ringan. Angka di-refresh akurat saat
// /pesanan-saya memuat daftar (OrdersView); di-increment saat checkout sukses. Event
// ACTIVE_ORDERS_EVENT memicu baca ulang.

import Link from 'next/link'
import Image from 'next/image'
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
    <Link
      href="/pesanan-saya"
      aria-label={count > 0 ? `Pesanan Saya, ${count} pesanan aktif` : 'Pesanan Saya'}
      className="relative p-1 transition active:scale-95"
    >
      <ProfileIcon />
      <CountBadge count={count} />
    </Link>
  )
}

// Badge angka pesanan aktif — style konsisten dengan badge keranjang. Tersembunyi bila 0.
function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
      {count > 99 ? '99+' : count}
    </span>
  )
}

// Ikon akun dari aset PNG (public/images/icons/user.png — 512px, putih, latar transparan).
// Lihat catatan pada CartIconLink: warna terkunci putih, tidak mengikuti currentColor.
function ProfileIcon() {
  return (
    <Image
      src="/images/icons/user.png"
      alt=""
      width={24}
      height={24}
      priority
      className="h-6 w-6 object-contain"
    />
  )
}
