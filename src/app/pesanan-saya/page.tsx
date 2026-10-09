// src/app/pesanan-saya/page.tsx
// Halaman "Pesanan Saya" (guest) — SATU halaman untuk lacak, batalkan, dan ulas pesanan.
// Server Component tipis: metadata + header; isinya OrdersView (client). Punya header hijau sendiri
// (di luar route group store), seperti /checkout.
//
// ?tab=selesai membuka tab Selesai langsung — dipakai redirect dari /review lama dan tautan
// "Beri Ulasan" di halaman sukses checkout.

import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import OrdersView, { type OrderTab } from '@/components/pesanan-saya/OrdersView'

export const metadata: Metadata = {
  title: 'Pesanan Saya — infarm.id',
  description: 'Lacak, batalkan, atau beri ulasan untuk pesanan Anda di infarm.id.',
}

export default async function PesananSayaPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  const initialTab: OrderTab | undefined = tab === 'selesai' ? 'selesai' : tab === 'aktif' ? 'aktif' : undefined

  return (
    <div className="flex min-h-screen flex-col bg-brand-surface pt-14 text-zinc-900">
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

      <main className="mx-auto w-full max-w-md flex-1 px-4 py-5">
        <OrdersView initialTab={initialTab} />
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
