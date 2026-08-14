'use client'

// src/components/oms/OmsHeader.tsx
// Header atas OMS yang reusable: tombol menu mobile, judul halaman dinamis,
// search bar, pengaturan, notifikasi, dan profil admin.
//
// Nama & peran admin diambil dari /api/oms/me (sesi cookie HMAC), BUKAN teks hardcode.
// Sebelumnya header menampilkan "Admin Utama / Manager Operasional" untuk siapa pun yang login —
// dua jabatan yang tak pernah ada di sistem peran (`admin_users.role` hanya 'admin' | 'staff').

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Search, Settings, Menu } from 'lucide-react'
import { useSidebar } from './SidebarContext'
import NotificationBell from './NotificationBell'

type OmsHeaderProps = {
  // Judul halaman yang ditampilkan di sisi kiri header (mis. "Dashboard")
  title: string
}

type AdminMe = { name?: string; role?: 'admin' | 'staff' }

// Label peran yang ditampilkan ke admin. Nilai DB ('admin'/'staff') terlalu telanjang untuk UI.
const ROLE_LABEL: Record<'admin' | 'staff', string> = {
  admin: 'Admin Utama',
  staff: 'Staf Operasional',
}

// Inisial untuk avatar: maksimal dua huruf dari kata pertama & terakhir nama.
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '—'
  const first = parts[0]![0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : ''
  return (first + last).toUpperCase()
}

export default function OmsHeader({ title }: OmsHeaderProps) {
  const { toggle } = useSidebar()
  const [me, setMe] = useState<AdminMe | null>(null)

  useEffect(() => {
    let active = true
    fetch('/api/oms/me', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: AdminMe | null) => {
        if (active && data) setMe(data)
      })
      .catch(() => {
        // Gagal memuat identitas tidak boleh mematikan header — avatar tampil sebagai placeholder.
      })
    return () => {
      active = false
    }
  }, [])

  const name = me?.name ?? 'Memuat…'
  const roleLabel = me?.role ? ROLE_LABEL[me.role] : ''

  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3.5 sm:gap-4 sm:px-6">
      {/* === Tombol menu (hamburger) — hanya tampil di mobile === */}
      <button
        type="button"
        onClick={toggle}
        aria-label="Buka menu navigasi"
        className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* === Judul halaman === */}
      <h1 className="hidden text-lg font-bold text-gray-900 lg:block">{title}</h1>

      {/* === Search bar (tengah) === */}
      <div className="relative flex-1 lg:max-w-xl lg:mx-auto">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          placeholder="Cari pesanan, telusuri stok, atau pembeli"
          className="w-full rounded-full border border-gray-200 bg-gray-50 py-2.5 pl-11 pr-4 text-sm text-gray-700 placeholder-gray-400 outline-none transition focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-100"
        />
      </div>

      {/* === Aksi kanan: pengaturan, notifikasi, profil === */}
      <div className="flex items-center gap-2 sm:gap-3">
        <Link
          href="/oms/dashboard/pengaturan"
          aria-label="Pengaturan"
          className="flex h-10 w-10 items-center justify-center rounded-full text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
        >
          <Settings className="h-5 w-5" />
        </Link>

        <NotificationBell />

        {/* Profil admin yang sedang login */}
        <div className="flex items-center gap-3 border-l border-gray-200 pl-3">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-semibold text-gray-900">{name}</p>
            {roleLabel && <p className="text-xs text-gray-500">{roleLabel}</p>}
          </div>
          <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-emerald-700 text-sm font-bold text-white">
            {me?.name ? initialsOf(me.name) : '—'}
          </div>
        </div>
      </div>
    </header>
  )
}
