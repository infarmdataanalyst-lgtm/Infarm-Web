'use client'

// src/components/oms/GudangTabs.tsx
// Sub-navigasi area Gudang (Daftar Gudang / Kelola Stok / Riwayat Mutasi).
//
// Sengaja diulang di dalam halaman meski sidebar sudah punya sub-menu: ketiga halaman ini saling
// merujuk (matrix → riwayat, daftar gudang → stok), dan di mobile sidebar-nya tertutup drawer.

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { label: 'Daftar Gudang', href: '/oms/dashboard/gudang' },
  { label: 'Kelola Stok', href: '/oms/dashboard/gudang/stok' },
  { label: 'Riwayat Mutasi', href: '/oms/dashboard/gudang/riwayat' },
]

export default function GudangTabs() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Sub-halaman Gudang"
      className="mb-6 flex gap-1 overflow-x-auto border-b border-zinc-200"
    >
      {TABS.map((tab) => {
        // Cocok PERSIS: href "Daftar Gudang" adalah prefiks dua href lainnya.
        const active = pathname === tab.href
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              active
                ? 'border-emerald-700 text-emerald-800'
                : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700'
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
