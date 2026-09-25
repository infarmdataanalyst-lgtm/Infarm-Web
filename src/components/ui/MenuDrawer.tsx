'use client'

// src/components/ui/MenuDrawer.tsx
// Tombol hamburger di AppBar + panel navigasi geser dari kiri (drawer).
// Isi: navigasi utama + daftar kategori produk. MURNI navigasi katalog — layanan pesanan
// (lacak/batalkan/review) pindah ke dropdown ikon akun (ProfileIconLink) agar tak tumpang tindih.
// Client component karena butuh state buka/tutup, tombol Escape, dan kunci scroll body.
//
// PENTING — panel & backdrop WAJIB di-portal ke <body>: AppBar memakai `backdrop-blur-md`, dan
// elemen ber-`backdrop-filter` menjadi containing block untuk anak `position: fixed`. Tanpa portal,
// `inset-y-0` mengacu ke tinggi AppBar (56px) sehingga drawer terpotong setinggi header dan
// backdrop hanya menggelapkan area header.

import Link from 'next/link'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { House, LayoutGrid, ShoppingCart, X, ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { PRODUCT_CATEGORIES } from '@/lib/data/categories'

// Satu tautan di drawer
type DrawerLink = {
  icon: LucideIcon
  label: string
  href: string
}

// Navigasi utama toko
const NAV_UTAMA: DrawerLink[] = [
  { icon: House, label: 'Beranda', href: '/' },
  { icon: LayoutGrid, label: 'Semua Produk', href: '/products' },
  { icon: ShoppingCart, label: 'Keranjang', href: '/keranjang' },
]

// Menampilkan tombol menu + drawer navigasi yang bisa dibuka/tutup
export default function MenuDrawer() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  // Portal butuh `document`, yang tak ada saat render server. Pakai useSyncExternalStore
  // (bukan setState di dalam useEffect — dilarang lint `react-hooks/set-state-in-effect`)
  // agar snapshot server = false dan klien = true tanpa mismatch hidrasi.
  const isClient = useSyncExternalStore(subscribeNoop, () => true, () => false)

  // Escape untuk menutup + kunci scroll body selama drawer terbuka
  useEffect(() => {
    if (!open) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        aria-label="Buka menu"
        aria-expanded={open}
        aria-controls="menu-drawer"
        onClick={() => setOpen(true)}
        className="rounded-md p-1 transition active:scale-95"
      >
        <HamburgerIcon />
      </button>

      {isClient &&
        createPortal(
          <>
            {/* Backdrop — tap untuk menutup. Tetap di DOM agar transisi fade jalan dua arah. */}
            <div
              aria-hidden
              onClick={() => setOpen(false)}
              className={`fixed inset-0 z-[70] bg-black/40 transition-opacity duration-200 ${
                open ? 'opacity-100' : 'pointer-events-none opacity-0'
              }`}
            />

            {/* Panel drawer. `inert` saat tertutup agar isinya tak bisa di-tab/dibaca screen reader. */}
            <aside
              id="menu-drawer"
              aria-label="Menu navigasi"
              inert={!open}
              className={`fixed inset-y-0 left-0 z-[80] flex w-[17rem] max-w-[85vw] flex-col bg-brand-surface shadow-xl transition-transform duration-300 ease-out ${
                open ? 'translate-x-0' : '-translate-x-full'
              }`}
            >
              {/* Kepala drawer — warna sama dengan AppBar */}
              <div className="flex h-14 shrink-0 items-center justify-between bg-brand-header px-4 text-white">
                <span className="text-lg font-bold tracking-tight">Menu</span>
                <button
                  type="button"
                  aria-label="Tutup menu"
                  onClick={() => setOpen(false)}
                  className="rounded-md p-1 transition active:scale-95"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Isi drawer — scrollable bila layar pendek.
                  onClick di kontainer menutup drawer begitu tautan mana pun diklik; tanpa ini
                  drawer tetap menutupi halaman tujuan setelah navigasi. */}
              <nav className="flex-1 overflow-y-auto px-3 py-4" onClick={() => setOpen(false)}>
                <DrawerSection title="Navigasi">
                  {NAV_UTAMA.map((item) => (
                    <DrawerItem key={item.href} item={item} active={pathname === item.href} />
                  ))}
                </DrawerSection>

                <DrawerSection title="Kategori Produk">
                  {/* Sumber kategori sama dengan grid beranda & filter katalog (satu sumber
                      kebenaran). Tanpa penanda aktif — membacanya butuh useSearchParams yang
                      memaksa halaman jadi dinamis, sementara katalog & beranda sengaja ISR. */}
                  {PRODUCT_CATEGORIES.map((cat) => (
                    <li key={cat.slug}>
                      <Link
                        href={`/products?category=${cat.slug}`}
                        className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-zinc-700 transition hover:bg-brand-light/30 active:scale-[0.99]"
                      >
                        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-primary" />
                        <span className="min-w-0 flex-1 truncate">{cat.label}</span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" />
                      </Link>
                    </li>
                  ))}
                </DrawerSection>
              </nav>
            </aside>
          </>,
          document.body,
        )}
    </>
  )
}

// Store kosong untuk useSyncExternalStore — nilainya tak pernah berubah setelah mount,
// jadi tak perlu langganan apa pun.
function subscribeNoop() {
  return () => {}
}

// Kelompok tautan dengan judul kecil
function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <h2 className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-zinc-400">
        {title}
      </h2>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  )
}

// Satu baris tautan berikon; halaman yang sedang dibuka ditandai hijau
function DrawerItem({ item, active }: { item: DrawerLink; active: boolean }) {
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition active:scale-[0.99] ${
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
}

// === Ikon inline (SVG) ===
// Dipindah dari AppBar bersama tombolnya agar tetap satu tempat dengan pemakainya.

function HamburgerIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  )
}
