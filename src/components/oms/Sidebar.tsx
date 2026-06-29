'use client'

// src/components/oms/Sidebar.tsx
// Sidebar navigasi OMS yang reusable.
// - Desktop (md+): fixed di sisi kiri, selalu tampil.
// - Mobile: drawer yang slide-in/out dari kiri, dibuka via tombol hamburger di header.
// Menyorot item menu aktif berdasarkan rute saat ini (usePathname).

import { useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Package,
  Boxes,
  Megaphone,
  ShoppingCart,
  Star,
  HelpCircle,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useSidebar } from './SidebarContext'

// === Definisi Menu Navigasi ===
type NavItem = {
  label: string
  href: string
  icon: LucideIcon
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/oms/dashboard', icon: LayoutDashboard },
  { label: 'Produk', href: '/oms/dashboard/products', icon: Package },
  { label: 'Paket & Combo', href: '/oms/dashboard/paket-combo', icon: Boxes },
  { label: 'Promosi', href: '/oms/dashboard/promosi', icon: Megaphone },
  { label: 'Pesanan', href: '/oms/dashboard/orders', icon: ShoppingCart },
  { label: 'Ulasan', href: '/oms/dashboard/reviews', icon: Star },
]

export default function Sidebar() {
  const pathname = usePathname()
  const { isOpen, close } = useSidebar()

  // Tutup drawer mobile setiap kali rute berpindah (mis. setelah klik menu).
  useEffect(() => {
    close()
  }, [pathname, close])

  // Kunci scroll body saat drawer mobile terbuka agar konten belakang tidak ikut bergeser.
  useEffect(() => {
    if (!isOpen) return
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = original
    }
  }, [isOpen])

  return (
    <>
      {/* === Sidebar desktop (md+) === */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-emerald-950 text-emerald-100 md:flex">
        <SidebarContent pathname={pathname} />
      </aside>

      {/* === Drawer mobile === */}
      {/* Overlay gelap: menutup drawer saat di-tap */}
      <div
        aria-hidden={!isOpen}
        onClick={close}
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 md:hidden ${
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      {/* Panel drawer yang slide-in dari kiri */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Menu navigasi"
        className={`fixed inset-y-0 left-0 z-50 flex w-64 max-w-[80%] flex-col bg-emerald-950 text-emerald-100 shadow-xl transition-transform duration-300 ease-in-out md:hidden ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Tombol tutup drawer */}
        <button
          type="button"
          onClick={close}
          aria-label="Tutup menu"
          className="absolute right-3 top-5 flex h-9 w-9 items-center justify-center rounded-lg text-emerald-200/80 transition hover:bg-emerald-900 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>
        <SidebarContent pathname={pathname} />
      </aside>
    </>
  )
}

// === Isi sidebar (dipakai bersama oleh versi desktop & drawer mobile) ===
function SidebarContent({ pathname }: { pathname: string }) {
  // Menentukan item aktif: cocok persis, atau pathname berada di bawah href tersebut.
  // Dashboard (/oms/dashboard) hanya aktif saat persis, agar tidak ikut menyala di sub-rute.
  function isActive(href: string): boolean {
    if (href === '/oms/dashboard') return pathname === href
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  return (
    <>
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
    </>
  )
}
