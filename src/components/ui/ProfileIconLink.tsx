'use client'

// src/components/ui/ProfileIconLink.tsx
// Ikon akun di header + akses layanan pesanan guest (lacak/batalkan/review).
// Klik/tap ikon → dropdown menempel di bawah ikon (rata kanan). SATU perilaku untuk semua ukuran
// layar: di mobile pun tidak berpindah halaman, supaya pembeli tak kehilangan konteks katalog/
// keranjang yang sedang dibuka. Dropdown langsung menuju tiga aksi (lacak/batalkan/review) —
// halaman hub /pesanan-saya tidak lagi ditautkan dari header (masih dipakai tombol "kembali"
// di ketiga halaman tersebut).
// Menu ini menggantikan section "Pesanan" yang dulu ada di MenuDrawer — drawer kini murni katalog.
//
// Catatan: proyek ini GUEST CHECKOUT (tanpa login pelanggan), jadi tidak ada Profil/Logout/
// Alamat Tersimpan — identitas guest hanya no_telepon di cookie.
//
// Badge ANGKA menampilkan estimasi jumlah pesanan aktif dari cookie (infarm_active_orders).
// HANYA baca cookie (tanpa query DB) agar header ringan. Angka di-refresh akurat saat buka
// /pesanan-saya; di-increment saat checkout sukses. Event ACTIVE_ORDERS_EVENT memicu baca ulang.

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Search, XCircle, Star } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { getActiveOrderCount, ACTIVE_ORDERS_EVENT } from '@/lib/guest-phone'

// Satu baris menu akun
type AccountLink = {
  icon: LucideIcon
  label: string
  href: string
}

// Layanan pesanan guest — tiga aksi langsung, tanpa perantara halaman hub.
// (Item "Pesanan Saya" → /pesanan-saya sengaja DIHAPUS: hub-nya hanya mengulang ketiga aksi ini.)
const ACCOUNT_MENU: AccountLink[] = [
  { icon: Search, label: 'Lacak Pesanan', href: '/track-order' },
  { icon: XCircle, label: 'Batalkan Pesanan', href: '/cancel-order' },
  { icon: Star, label: 'Beri Review Produk', href: '/review' },
]

export default function ProfileIconLink() {
  // Jumlah pesanan aktif (estimasi cookie). Dibaca client setelah mount agar tak mismatch hidrasi.
  const [count, setCount] = useState(0)
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const read = () => setCount(getActiveOrderCount())
    read()
    // Update saat cookie berubah (checkout sukses / refresh di /pesanan-saya) tanpa reload halaman.
    window.addEventListener(ACTIVE_ORDERS_EVENT, read)
    return () => window.removeEventListener(ACTIVE_ORDERS_EVENT, read)
  }, [])

  // Tutup dropdown saat klik di luar area ikon atau menekan Escape
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

  return (
    <>
      {/* Klik (bukan hover) agar satu implementasi melayani mouse, layar sentuh, dan keyboard. */}
      <div ref={wrapperRef} className="relative">
        <button
          type="button"
          aria-label="Menu pesanan"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="relative p-1 transition active:scale-95"
        >
          <ProfileIcon />
          <CountBadge count={count} />
        </button>

        {open && (
          // Dropdown memakai `absolute` (bukan `fixed`) sehingga tak terpengaruh containing block
          // dari `backdrop-filter` milik AppBar — beda dengan MenuDrawer yang harus di-portal.
          <div
            role="menu"
            aria-label="Layanan pesanan"
            onClick={() => setOpen(false)}
            className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-2xl border border-brand-light bg-white text-zinc-800 shadow-lg"
          >
            {/* Kepala: jumlah pesanan aktif bila ada (dari cookie, sama dengan badge) */}
            <div className="border-b border-brand-light/60 bg-brand-surface px-4 py-2.5">
              <p className="text-sm font-bold text-zinc-900">Pesanan Saya</p>
              <p className="text-xs text-zinc-500">
                {count > 0 ? `${count} pesanan aktif` : 'Kelola pesanan tanpa perlu akun'}
              </p>
            </div>

            <ul className="p-1.5">
              {ACCOUNT_MENU.map((item) => {
                const active = pathname === item.href
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      role="menuitem"
                      aria-current={active ? 'page' : undefined}
                      // py lebih tinggi di layar kecil → target sentuh nyaman (~48px)
                      className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm transition sm:py-2.5 ${
                        active
                          ? 'bg-brand-light/40 font-bold text-brand-primary'
                          : 'text-zinc-700 hover:bg-brand-light/30'
                      }`}
                    >
                      <item.icon className="h-5 w-5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </>
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
