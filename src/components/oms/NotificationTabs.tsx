'use client'

// src/components/oms/NotificationTabs.tsx
// Tab jenis notifikasi (Semua / Pesanan / Stok / Ulasan) beserta jumlahnya. Dipakai panel lonceng
// (NotificationBell) dan halaman /oms/dashboard/notifikasi supaya keduanya berperilaku sama.

import { NOTIFICATION_GROUPS, type NotificationGroup } from '@/lib/notification-groups'

// Menampilkan deretan tab; tab aktif berwarna hijau brand.
export default function NotificationTabs({
  active,
  counts,
  onChange,
  compact = false,
}: {
  active: NotificationGroup
  // undefined = jumlahnya belum termuat; tab tetap bisa diklik, hanya tanpa angka.
  counts?: Record<NotificationGroup, number>
  onChange: (group: NotificationGroup) => void
  // Ukuran rapat untuk panel dropdown yang sempit.
  compact?: boolean
}) {
  return (
    <div
      role="tablist"
      aria-label="Jenis notifikasi"
      className={`flex gap-1 overflow-x-auto ${compact ? 'px-3 py-2' : 'pb-1'}`}
    >
      {NOTIFICATION_GROUPS.map(({ key, label }) => {
        const selected = key === active
        const count = counts?.[key]
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(key)}
            className={`flex flex-none items-center gap-1 rounded-full font-semibold transition ${
              compact ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm'
            } ${
              selected
                ? 'bg-brand-primary text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {label}
            {count !== undefined && (
              <span className={selected ? 'text-white/80' : 'text-gray-400'}>{count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
