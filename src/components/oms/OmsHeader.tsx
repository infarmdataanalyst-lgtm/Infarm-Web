// src/components/oms/OmsHeader.tsx
// Header atas OMS yang reusable: judul halaman dinamis, search bar, notifikasi, dan profil admin.

import { Search, Bell, Settings } from 'lucide-react'

type OmsHeaderProps = {
  // Judul halaman yang ditampilkan di sisi kiri header (mis. "Dashboard")
  title: string
  // Jumlah notifikasi belum dibaca untuk badge merah (opsional)
  notificationCount?: number
}

export default function OmsHeader({ title, notificationCount = 0 }: OmsHeaderProps) {
  return (
    <header className="sticky top-0 z-20 flex items-center gap-4 border-b border-gray-200 bg-white px-6 py-3.5">
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

      {/* === Aksi kanan: settings, notifikasi, profil === */}
      <div className="flex items-center gap-2 sm:gap-3">
        <button
          type="button"
          aria-label="Pengaturan"
          className="flex h-10 w-10 items-center justify-center rounded-full text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
        >
          <Settings className="h-5 w-5" />
        </button>

        <button
          type="button"
          aria-label="Notifikasi"
          className="relative flex h-10 w-10 items-center justify-center rounded-full text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
        >
          <Bell className="h-5 w-5" />
          {notificationCount > 0 && (
            <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
              {notificationCount > 9 ? '9+' : notificationCount}
            </span>
          )}
        </button>

        {/* Profil admin */}
        <div className="flex items-center gap-3 border-l border-gray-200 pl-3">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-semibold text-gray-900">Admin Utama</p>
            <p className="text-xs text-gray-500">Manager Operasional</p>
          </div>
          <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-emerald-700 text-sm font-bold text-white">
            AU
          </div>
        </div>
      </div>
    </header>
  )
}
