// src/app/track/page.tsx
// Halaman Lacak Pesanan (guest checkout, publik). State berdasar query `?order=INV-...`:
//   - Tanpa param        → form pencarian nomor invoice
//   - Param ditemukan    → kartu status: nomor pesanan + stepper + riwayat + kurir + alamat
//   - Param tak ditemukan → kartu peringatan + form
// Server Component: order dibaca REAL dari Supabase (getOrderByOrderId).
// Riwayat perjalanan & stepper di-generate dari status+created_at (lib/tracking.ts) — sementara,
// sampai tracking asli Mengantar tersedia.

import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { Phone, MapPin, Package } from 'lucide-react'
import TrackSearchForm from '@/components/track/TrackSearchForm'
import TrackingTimeline from '@/components/track/TrackingTimeline'
import ShippingStepper from '@/components/track/ShippingStepper'
import { getOrderByOrderId } from '@/lib/mock-db/orders'
import {
  generateTrackingHistory,
  getCurrentStepIndex,
  isOrderCancelled,
} from '@/lib/tracking'
import { toTitleCase } from '@/lib/mengantar'
import { maskName, maskPhone, maskStreet } from '@/lib/mask'
import type { Order } from '@/types/order'

export const metadata: Metadata = {
  title: 'Lacak Pesanan — infarm',
  description: 'Pantau status pengiriman pesanan Infarm Anda.',
}

type TrackPageProps = {
  searchParams: Promise<{ order?: string }>
}

export default async function TrackPage({ searchParams }: TrackPageProps) {
  const { order } = await searchParams
  const hasQuery = typeof order === 'string' && order.trim().length > 0
  // Ambil order REAL dari Supabase (buang '#' di depan bila ada)
  const found = hasQuery ? await getOrderByOrderId(order!.trim().replace(/^#/, '')) : null

  return (
    <div className="flex min-h-screen flex-col bg-brand-surface pt-14 text-zinc-900">
      {/* Header hijau brand + tombol kembali */}
      <header className="fixed inset-x-0 top-0 z-50 bg-brand-primary text-white shadow-sm">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
          <Link href="/" aria-label="Kembali ke beranda" className="rounded-md p-1 transition active:scale-95">
            <BackIcon />
          </Link>
          <Link href="/" className="flex items-center gap-2">
            <Image src="/images/logo-infarm.png" alt="Logo Infarm" width={32} height={32} priority className="h-8 w-auto object-contain" />
            <span className="text-xl font-bold tracking-tight">Lacak Pesanan</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-4 py-5">
        {found ? (
          <TrackResult order={found} />
        ) : (
          <SearchState hasQuery={hasQuery} query={order} />
        )}
      </main>
    </div>
  )
}

// === Hasil pelacakan ===

function TrackResult({ order }: { order: Order }) {
  const cancelled = isOrderCancelled(order)
  const currentStep = getCurrentStepIndex(order.status)
  const history = generateTrackingHistory(order)
  const invoiceLabel = order.orderId.startsWith('#') ? order.orderId : `#${order.orderId}`

  return (
    <div className="space-y-4">
      {/* 1 — Nomor pesanan + badge status */}
      <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-gray-500">Nomor Pesanan</p>
            <p className="mt-1 text-lg font-bold text-gray-900">{invoiceLabel}</p>
          </div>
          <StatusBadge status={order.status ?? 'Diproses'} cancelled={cancelled} />
        </div>
      </section>

      {/* 2 — Stepper status pengiriman (disembunyikan bila dibatalkan) */}
      {!cancelled && (
        <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <h2 className="mb-5 text-sm font-bold text-gray-900">Status Pengiriman</h2>
          <ShippingStepper currentIndex={currentStep} />
        </section>
      )}

      {/* 3 — Riwayat perjalanan (timeline) */}
      <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-bold text-gray-900">Riwayat Perjalanan</h2>
        {history.length > 0 ? (
          <TrackingTimeline events={history} />
        ) : (
          <p className="text-sm text-gray-400">Belum ada riwayat perjalanan.</p>
        )}
      </section>

      {/* 4 — Info kurir */}
      <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-surface text-brand-primary">
              <Package className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-gray-900">{order.logistics?.courier || 'Kurir belum ditentukan'}</p>
              <p className="text-xs text-gray-500">
                {order.trackingNumber ? `No. Resi: ${order.trackingNumber}` : 'No. resi belum tersedia'}
              </p>
            </div>
          </div>
          {/* Placeholder: kontak kurir belum terintegrasi */}
          <button
            type="button"
            disabled
            title="Fitur akan segera hadir"
            className="cursor-not-allowed rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-400"
          >
            Hubungi
          </button>
        </div>
      </section>

      {/* 5 — Alamat pengiriman */}
      <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-gray-900">
          <MapPin className="h-4 w-4 text-brand-primary" />
          Alamat Pengiriman
        </h2>
        <p className="text-sm font-semibold text-gray-900">{maskName(order.customerName)}</p>
        <p className="mt-1 text-sm leading-relaxed text-gray-600">{formatAddress(order)}</p>
        {order.customerPhone && (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-gray-600">
            <Phone className="h-3.5 w-3.5 text-gray-400" />
            {maskPhone(order.customerPhone)}
          </p>
        )}
      </section>

      <div className="pt-1 text-center">
        <Link href="/track-order" className="text-sm font-medium text-brand-primary transition hover:brightness-90">
          ← Lacak pesanan lain
        </Link>
      </div>
    </div>
  )
}

// === State pencarian / tidak ditemukan ===

function SearchState({ hasQuery, query }: { hasQuery: boolean; query?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col justify-center">
      <div className="mx-auto w-full rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900">Lacak Pesanan Anda</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-gray-500">
            Masukkan nomor pesanan (INV-…) untuk melihat status pengiriman.
          </p>
        </div>

        {hasQuery && (
          <div role="alert" className="mt-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertIcon />
            <span>Nomor pesanan tidak ditemukan. Periksa kembali nomor pada email konfirmasi / nota belanja Anda.</span>
          </div>
        )}

        <div className="mt-6">
          <TrackSearchForm defaultValue={hasQuery ? query : ''} />
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">
          Nomor pesanan tertera pada email konfirmasi & halaman sukses pesanan.
        </p>
      </div>
    </div>
  )
}

// === Helper ===

// Susun alamat lengkap mengikuti data checkout: jalan, lalu kelurahan/kecamatan/kota/provinsi kodepos.
// Nilai dari Mengantar berupa UPPERCASE → di-Title Case agar enak dibaca.
// Detail jalan/no rumah DISAMARKAN (maskStreet) karena halaman publik (S-2); region tetap tampil
// agar user masih bisa mengenali pesanannya.
function formatAddress(order: Order): string {
  const a = order.address
  if (!a) return '-'
  const region = [a.kelurahan, a.kecamatan, a.kota, a.provinsi]
    .filter(Boolean)
    .map((s) => toTitleCase(s))
    .join(', ')
  const street = a.shippingAddress ? maskStreet(a.shippingAddress) : ''
  return [street, region, a.kodepos].filter(Boolean).join(', ')
}

// Badge status: hijau brand untuk alur normal, rose untuk dibatalkan.
function StatusBadge({ status, cancelled }: { status: string; cancelled: boolean }) {
  const cls = cancelled
    ? 'bg-rose-50 text-rose-600'
    : 'bg-brand-light/40 text-brand-primary'
  return <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${cls}`}>{status}</span>
}

function BackIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m15 18-6-6 6-6" />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0" aria-hidden>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  )
}
