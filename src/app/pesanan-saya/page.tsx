// src/app/pesanan-saya/page.tsx
// Halaman hub "Pesanan Saya" (guest). Kumpulan pintasan: lacak, batalkan, & review pesanan.
// Server Component — konten statis (navigasi). Punya header hijau sendiri (di luar route group store).

import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { Search, XCircle, Star, ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import ActiveOrdersSummary from '@/components/pesanan-saya/ActiveOrdersSummary'

export const metadata: Metadata = {
  title: 'Pesanan Saya — infarm.id',
  description: 'Lacak, batalkan, atau beri ulasan untuk pesanan Anda di infarm.id.',
}

// Satu item menu hub
type MenuItem = {
  icon: LucideIcon
  title: string
  description: string
  href: string
}

const MENU: MenuItem[] = [
  {
    icon: Search,
    title: 'Lacak Pesanan',
    description: 'Cek status pengiriman pesanan Anda',
    href: '/track-order',
  },
  {
    icon: XCircle,
    title: 'Batalkan Pesanan',
    description: 'Batalkan pesanan yang belum dikirim',
    href: '/cancel-order',
  },
  {
    icon: Star,
    title: 'Beri Review Produk',
    description: 'Bagikan pengalaman belanja Anda',
    href: '/review',
  },
]

export default function PesananSayaPage() {
  return (
    <div className="flex min-h-screen flex-col bg-brand-surface pt-14 text-zinc-900">
      {/* Header hijau brand + tombol kembali */}
      <header className="fixed inset-x-0 top-0 z-50 rounded-b-[2rem] bg-brand-header/90 text-white shadow-sm backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
          <Link href="/" aria-label="Kembali ke beranda" className="rounded-md p-1 transition active:scale-95">
            <BackIcon />
          </Link>
          <Link href="/" className="flex items-center gap-2">
            <Image src="/images/logo-infarm.png" alt="Logo Infarm" width={32} height={32} priority unoptimized className="h-8 w-auto object-contain" />
            <span className="text-xl font-bold tracking-tight">Pesanan Saya</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-4 py-6">
        <p className="mb-4 text-sm text-zinc-500">
          Kelola pesanan Anda: lacak pengiriman, batalkan, atau beri ulasan.
        </p>

        {/* Ringkasan pesanan aktif (refresh akurat dari server + perbarui cookie badge header) */}
        <ActiveOrdersSummary />

        <div className="space-y-3">
          {MENU.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-4 rounded-2xl border border-brand-light bg-white p-4 shadow-sm transition hover:border-brand-primary hover:bg-brand-surface active:scale-[0.99]"
            >
              {/* Ikon dalam lingkaran hijau lembut */}
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-light/30 text-brand-primary">
                <item.icon className="h-6 w-6" />
              </span>

              {/* Judul + deskripsi */}
              <span className="min-w-0 flex-1">
                <span className="block font-bold text-zinc-900">{item.title}</span>
                <span className="block text-sm text-zinc-500">{item.description}</span>
              </span>

              {/* Panah navigasi */}
              <ChevronRight className="h-5 w-5 shrink-0 text-zinc-400" />
            </Link>
          ))}
        </div>
      </main>
    </div>
  )
}

function BackIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m15 18-6-6 6-6" />
    </svg>
  )
}
