'use client'

// src/app/track-order/page.tsx
// Lacak Pesanan by NO. TELEPON (guest). Berbeda dari /track (yang by nomor invoice).
// User cukup masukkan no_telepon → tampil daftar pesanan (bisa >1) dengan info NON-SENSITIF saja.
// Auto-fill no_telepon dari cookie (infarm_phone) bila pernah checkout di device ini.
// Honeypot field tersembunyi mencegah bot. (Rate-limit menyusul — lihat catatan di API.)

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Package, Search } from 'lucide-react'
import { getGuestPhone } from '@/lib/guest-phone'
import { isValidPhone } from '@/lib/phone'

// Bentuk pesanan aman-publik dari API (tanpa alamat/nama penuh)
type PublicTrackOrder = {
  orderId: string
  status: string
  paymentStatus: string
  trackingNumber: string | null
  courier: string | null
  date: string
  customerNameMasked: string
  items: { name: string; quantity: number }[]
}

export default function TrackOrderPage() {
  const [phone, setPhone] = useState('')
  const [honeypot, setHoneypot] = useState('') // field jebakan bot (tersembunyi dari user)
  const [orders, setOrders] = useState<PublicTrackOrder[] | null>(null) // null = belum cari
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Jalankan pencarian ke server untuk sebuah no_telepon. `hp` = nilai honeypot (kosong saat auto).
  const runSearch = useCallback(async (searchPhone: string, hp: string) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/orders/track-by-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: searchPhone, website: hp }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Gagal mencari pesanan. Coba lagi.')
        setOrders(null)
      } else {
        setOrders(data.orders ?? [])
      }
    } catch {
      setError('Terjadi kesalahan jaringan. Coba lagi.')
      setOrders(null)
    } finally {
      setLoading(false)
    }
  }, [])

  // Opsi A: auto-recognize. Bila cookie no_telepon ada & valid (pernah checkout di device ini) →
  // isi form + LANGSUNG cari (user tak perlu ketik/klik). Cookie kedaluwarsa/tak ada → input manual.
  useEffect(() => {
    const saved = getGuestPhone()
    if (saved && isValidPhone(saved)) {
      setPhone(saved)
      runSearch(saved, '') // honeypot kosong pada pencarian otomatis
    }
  }, [runSearch])

  // Hanya izinkan angka saat mengetik (konsisten dengan validasi checkout)
  function handlePhoneChange(e: React.ChangeEvent<HTMLInputElement>) {
    setPhone(e.target.value.replace(/\D/g, '').slice(0, 12))
    setError('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValidPhone(phone)) {
      setError('Nomor telepon tidak valid. Gunakan format 08xxxxxxxxxx.')
      return
    }
    runSearch(phone, honeypot)
  }

  return (
    <div className="flex min-h-screen flex-col bg-brand-surface pt-14 text-zinc-900">
      {/* Header hijau brand */}
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
        {/* === Form pencarian === */}
        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-bold text-gray-900">Lacak dengan Nomor Telepon</h1>
          <p className="mt-2 text-sm text-gray-500">
            Masukkan nomor telepon yang Anda gunakan saat checkout untuk melihat status pesanan.
          </p>

          <form onSubmit={handleSubmit} className="mt-5 space-y-3">
            {/* Honeypot: tersembunyi dari user, hanya bot yang mengisi. aria-hidden + tabIndex -1. */}
            <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden" >
              <label htmlFor="website">Website (jangan diisi)</label>
              <input
                id="website"
                name="website"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="phone" className="mb-1 block text-sm font-medium text-gray-700">
                Nomor Telepon
              </label>
              <input
                id="phone"
                type="tel"
                inputMode="numeric"
                placeholder="08xxxxxxxxxx"
                value={phone}
                onChange={handlePhoneChange}
                className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-900 focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
              />
              {error && <p className="mt-1.5 text-sm text-rose-600">{error}</p>}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-primary py-3 text-sm font-bold text-white transition hover:brightness-90 active:scale-[0.99] disabled:opacity-50"
            >
              <Search className="h-4 w-4" />
              {loading ? 'Mencari…' : 'Cari Pesanan'}
            </button>
          </form>
        </div>

        {/* === Hasil === */}
        {orders !== null && (
          <div className="mt-5 space-y-3">
            {orders.length === 0 ? (
              <p className="rounded-2xl border border-gray-100 bg-white px-4 py-8 text-center text-sm text-gray-400 shadow-sm">
                Tidak ada pesanan untuk nomor ini.
              </p>
            ) : (
              <>
                <p className="px-1 text-sm text-gray-500">
                  {orders.length} pesanan ditemukan untuk nomor ini
                </p>
                {orders.map((o) => (
                  <TrackOrderCard key={o.orderId} order={o} />
                ))}
              </>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

// Kartu ringkas satu pesanan (info non-sensitif) + tautan ke detail perjalanan.
function TrackOrderCard({ order }: { order: PublicTrackOrder }) {
  const invoiceLabel = order.orderId.startsWith('#') ? order.orderId : `#${order.orderId}`
  const cancelled = order.status === 'Dibatalkan'
  const itemSummary = order.items.map((i) => `${i.name} ×${i.quantity}`).join(', ')

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-gray-500">Nomor Pesanan</p>
          <p className="mt-0.5 font-bold text-gray-900">{invoiceLabel}</p>
          <p className="mt-0.5 text-xs text-gray-400">{formatShortDate(order.date)} · {order.customerNameMasked}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
            cancelled ? 'bg-rose-50 text-rose-600' : 'bg-brand-light/40 text-brand-primary'
          }`}
        >
          {order.status}
        </span>
      </div>

      {/* Ringkasan barang */}
      <p className="mt-3 line-clamp-2 text-sm text-gray-600">{itemSummary || '—'}</p>

      {/* Kurir + resi */}
      <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3 text-xs text-gray-500">
        <Package className="h-4 w-4 text-brand-primary" />
        <span>{order.courier || 'Kurir belum ditentukan'}</span>
        {order.trackingNumber && <span className="font-mono text-gray-700">· {order.trackingNumber}</span>}
      </div>

      {/* Tautan ke detail perjalanan (halaman /track by invoice) */}
      <Link
        href={`/track?order=${encodeURIComponent(order.orderId)}`}
        className="mt-3 inline-block text-sm font-medium text-brand-primary transition hover:brightness-90"
      >
        Lihat detail perjalanan →
      </Link>
    </div>
  )
}

// Format tanggal singkat: "22 Okt 2023"
function formatShortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(d)
}

function BackIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m15 18-6-6 6-6" />
    </svg>
  )
}
