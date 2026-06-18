// src/app/checkout/success/page.tsx
// Halaman "Pembayaran Sukses" (Order Confirmed) untuk ecommerce.
// Membaca order asli dari mock database via ?order=INV-xxxx; fallback ke contoh bila dibuka langsung.
// Warna mengikuti palet brand di CLAUDE.md (brand.primary/light/surface).

import Link from 'next/link'
import Image from 'next/image'
import { X, Leaf, Clock, MapPin, Star } from 'lucide-react'
import { readOrders } from '@/lib/mock-db/orders'
import { formatRupiah } from '@/lib/format'
import type { Order } from '@/types/order'

// Order contoh bila halaman dibuka tanpa ?order= (mis. preview langsung)
const FALLBACK_ORDER: Order = {
  orderId: 'INF-882910',
  customerName: 'Pelanggan Infarm',
  date: '2023-10-22T10:00:00.000Z',
  items: [
    { productId: 'PRD-101', name: 'Benih Premium', quantity: 1, price: 20000 },
    { productId: 'PRD-102', name: 'Pupuk Nutrisi Cair', quantity: 1, price: 25000 },
  ],
  totalAmount: 45000,
  paymentStatus: 'Lunas',
  status: 'Diproses',
}

// Format tanggal singkat: "22 Okt 2023"
function formatShortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d)
}

// Rentang estimasi tiba: tanggal order +2 s/d +4 hari → "24 Okt – 26 Okt"
function estimasiTiba(iso: string): string {
  const base = new Date(iso)
  if (Number.isNaN(base.getTime())) return '2–4 hari kerja'
  const fmt = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' })
  const from = new Date(base.getTime() + 2 * 86_400_000)
  const to = new Date(base.getTime() + 4 * 86_400_000)
  return `${fmt.format(from)} – ${fmt.format(to)}`
}

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>
}) {
  const { order: orderParam } = await searchParams

  // Cari order asli dari mock DB; fallback ke contoh bila tidak ketemu
  let order: Order | undefined
  if (orderParam) {
    const orders = await readOrders()
    order = orders.find(
      (o) => o.orderId === orderParam || `#${o.orderId}` === orderParam,
    )
  }
  const data = order ?? FALLBACK_ORDER
  const invoiceLabel = data.orderId.startsWith('#') ? data.orderId : `#${data.orderId}`

  return (
    <div className="flex min-h-screen justify-center bg-brand-surface">
      {/* Container: full-width di mobile (max-w-md), dibatasi & terpusat di desktop (xl → 2xl) */}
      <div className="mx-auto flex w-full max-w-md flex-col px-5 pb-8 md:max-w-xl lg:max-w-2xl">
        {/* === Header: tutup + judul (warna & tinggi disamakan dengan header beranda: bg-brand-primary, teks putih, h-14) === */}
        {/* -mx-5 px-5 agar latar hijau membentang penuh seperti header beranda */}
        <header className="-mx-5 flex h-14 items-center gap-3 bg-brand-primary px-5 text-white md:px-8">
          <Link
            href="/"
            aria-label="Tutup"
            className="flex h-9 w-9 items-center justify-center rounded-full text-white transition hover:bg-white/15"
          >
            <X className="h-5 w-5" />
          </Link>
          <h1 className="text-lg font-bold text-white">Order Confirmed</h1>
        </header>

        {/* === Ilustrasi sukses === */}
        <div className="relative mt-2 flex justify-center">
          {/* Lingkaran besar brand-light + ikon daun */}
          <div className="flex h-32 w-32 items-center justify-center rounded-full bg-brand-light/60">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-primary text-white shadow-lg">
              <Leaf className="h-9 w-9" />
            </div>
          </div>
        </div>

        {/* === Pesan utama === */}
        <div className="mt-6 text-center">
          <h2 className="text-2xl font-bold text-zinc-900">
            Yeay! Pesananmu Sedang Disiapkan
          </h2>
          <p className="mx-auto mt-2 max-w-xs text-sm text-zinc-500">
            Terima kasih telah berbelanja!
          </p>
        </div>

        {/* === Kartu detail pesanan === */}
        <div className="mt-6 w-full rounded-2xl bg-white p-5 shadow-sm md:shadow-md md:rounded-2xl">
          {/* Baris atas: Order ID + tanggal/status */}
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                Order ID
              </p>
              <p className="mt-0.5 text-sm font-bold text-zinc-900">{invoiceLabel}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-zinc-400">{formatShortDate(data.date)}</p>
              <p className="mt-0.5 text-sm font-semibold text-brand-primary">Berhasil</p>
            </div>
          </div>

          {/* Daftar item */}
          <div className="mt-4 space-y-3 border-t border-dashed border-zinc-200 pt-4">
            {data.items.map((item) => (
              <div key={item.productId} className="flex items-center gap-3">
                <div className="relative h-11 w-11 flex-none overflow-hidden rounded-lg border border-zinc-100 bg-zinc-50">
                  <Image
                    src="/images/product-placeholder.png"
                    alt={item.name}
                    fill
                    unoptimized
                    sizes="44px"
                    className="object-cover"
                  />
                </div>
                <div>
                  <p className="text-sm font-semibold text-zinc-900">{item.name}</p>
                  <p className="text-xs text-zinc-400">{item.quantity}× item</p>
                </div>
              </div>
            ))}
          </div>

          {/* Total */}
          <div className="mt-4 flex items-center justify-between border-t border-dashed border-zinc-200 pt-4">
            <span className="text-sm text-zinc-500">Total Terbayar</span>
            <span className="text-xl font-bold text-zinc-900">
              {formatRupiah(data.totalAmount)}
            </span>
          </div>
        </div>

        {/* === Kartu estimasi & aksi (brand-primary) === */}
        <div className="mt-4 rounded-2xl bg-brand-primary p-5 text-white">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            <p className="text-sm font-semibold">Estimasi Tiba: {estimasiTiba(data.date)}</p>
          </div>
          <p className="mt-1 text-sm text-white/80">
            Pesananmu akan segera dikirimkan oleh kurir kami.
          </p>

          {/* Tombol aksi */}
          <div className="mt-5 space-y-3">
            <Link
              href="/track"
              className="flex items-center justify-center gap-2 rounded-xl border border-white/40 bg-white/5 py-3 text-sm font-semibold text-white transition hover:bg-white/15"
            >
              <MapPin className="h-4 w-4" />
              Lacak Pesanan
            </Link>
            {/* Arahkan ke halaman ulasan dengan membawa Order ID agar item yang diulas sesuai pesanan ini */}
            <Link
              href={`/review?order=${encodeURIComponent(data.orderId)}`}
              className="flex items-center justify-center gap-2 rounded-xl border border-white/40 bg-white/5 py-3 text-sm font-semibold text-white transition hover:bg-white/15"
            >
              <Star className="h-4 w-4" />
              Beri Ulasan Produk
            </Link>
            <Link
              href="/"
              className="flex items-center justify-center rounded-xl bg-white py-3 text-sm font-bold text-brand-primary transition hover:brightness-95"
            >
              Kembali Belanja
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
