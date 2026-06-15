'use client'

// src/components/oms/Sidebar.tsx
// Sidebar navigasi OMS yang reusable & fixed di sisi kiri.
// Menyorot item menu aktif berdasarkan rute saat ini (usePathname).

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Star,
  Boxes,
  HelpCircle,
  type LucideIcon,
} from 'lucide-react'

// === Definisi Menu Navigasi ===
type NavItem = {
  label: string
  href: string
  icon: LucideIcon
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/oms/dashboard', icon: LayoutDashboard },
  { label: 'Produk', href: '/oms/dashboard/products', icon: Package },
  { label: 'Pesanan', href: '/oms/dashboard/orders', icon: ShoppingCart },
  { label: 'Ulasan', href: '/oms/dashboard/reviews', icon: Star },
  { label: 'Inventaris', href: '/oms/dashboard/inventory', icon: Boxes },
]

export default function Sidebar() {
  const pathname = usePathname()

  // Menentukan item aktif: cocok persis, atau pathname berada di bawah href tersebut.
  // Dashboard (/oms/dashboard) hanya aktif saat persis, agar tidak ikut menyala di sub-rute.
  function isActive(href: string): boolean {
    if (href === '/oms/dashboard') return pathname === href
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-emerald-950 text-emerald-100 md:flex">
      {/* === Logo / Brand === */}
      <div className="flex items-center gap-3 px-6 py-6">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-emerald-700">
          <Image
            src="/images/logo-infarm.png"
            alt="Infarm"
            width={28}
            height={28}
            className="h-7 w-7 object-contain"
            priority
          />
        </div>
        <div className="leading-tight">
          <p className="text-base font-bold text-white">Infarm OMS</p>
        </div>
      </div>

      {/* === Menu Navigasi === */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.href)
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg border-l-4 px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? 'border-emerald-400 bg-emerald-800 text-white'
                  : 'border-transparent text-emerald-200/80 hover:bg-emerald-900 hover:text-white'
              }`}
            >
              <Icon className="h-5 w-5 flex-none" />
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* === Pusat Bantuan (bawah) === */}
      <div className="border-t border-emerald-900 p-3">
        <Link
          href="/oms/dashboard/help"
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-emerald-200/80 transition-colors hover:bg-emerald-900 hover:text-white"
        >
          <HelpCircle className="h-5 w-5 flex-none" />
          Pusat Bantuan
        </Link>
      </div>
    </aside>
  )
}
