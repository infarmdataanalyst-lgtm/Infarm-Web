'use client'

// src/components/order-cancellation/OrderCancellationView.tsx
// Tampilan utama halaman Pembatalan Pesanan (Guest). Menangani 4 fase:
//   loading → memeriksa token & status pesanan ke API
//   error   → tautan tidak valid / pesanan tidak ditemukan
//   ready   → tampil detail pesanan + (form alasan & tombol batal) ATAU banner terkunci
//   success → pembatalan berhasil (atau pesanan memang sudah dibatalkan)
// Mobile-first, responsif, memakai palet brand + warna aksi sesuai permintaan (rose/slate/orange).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { X, Loader2, AlertTriangle, Ban, CheckCircle2 } from 'lucide-react'
import { formatRupiah } from '@/lib/format'
import type { OrderItem, OrderFulfillmentStatus, OrderPaymentStatus } from '@/types/order'

// Order versi publik (tanpa data pribadi) yang dikembalikan API /api/orders/cancel
type CancellationOrder = {
  orderId: string
  date: string
  items: OrderItem[]
  totalAmount: number
  status: OrderFulfillmentStatus
  paymentStatus: OrderPaymentStatus
}

// Status yang masih boleh dibatalkan mandiri (kondisi "aman" sesuai spesifikasi)
const CANCELLABLE_STATUSES: OrderFulfillmentStatus[] = ['Menunggu Pembayaran', 'Diproses']

// Opsi alasan pembatalan
const CANCEL_REASONS = [
  'Salah pilih varian produk',
  'Ingin mengubah alamat pengiriman',
  'Menemukan harga lebih murah',
  'Lainnya',
] as const

// Warna badge per status (hindari biru/ungu sesuai aturan palet brand)
const STATUS_BADGE: Record<OrderFulfillmentStatus, string> = {
  'Menunggu Pembayaran': 'bg-amber-100 text-amber-700',
  Diproses: 'bg-brand-light/50 text-brand-primary',
  Dikirim: 'bg-orange-100 text-orange-700',
  Selesai: 'bg-emerald-100 text-emerald-700',
  Dibatalkan: 'bg-rose-100 text-rose-700',
}

type Phase = 'loading' | 'error' | 'ready' | 'success'

export default function OrderCancellationView({
  orderId,
  token,
}: {
  orderId: string
  token: string
}) {
  // Param kosong bisa ditentukan langsung dari props → set sebagai state awal (bukan di dalam effect),
  // agar tidak memicu cascading render.
  const hasParams = Boolean(orderId && token)
  const [phase, setPhase] = useState<Phase>(hasParams ? 'loading' : 'error')
  const [order, setOrder] = useState<CancellationOrder | null>(null)
  const [errorMessage, setErrorMessage] = useState(
    hasParams ? '' : 'Tautan pembatalan tidak lengkap. Buka tautan resmi dari halaman pesanan Anda.',
  )

  // State form alasan
  const [reason, setReason] = useState('')
  const [customReason, setCustomReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // === Validasi token + ambil detail pesanan saat halaman dibuka ===
  useEffect(() => {
    // Param kosong sudah ditangani lewat state awal; tak perlu fetch.
    if (!orderId || !token) return

    const controller = new AbortController()

    async function validate() {
      try {
        const res = await fetch(
          `/api/orders/cancel?id=${encodeURIComponent(orderId)}&token=${encodeURIComponent(token)}`,
          { signal: controller.signal },
        )
        const data = await res.json()
        if (!res.ok) {
          setPhase('error')
          setErrorMessage(data.error ?? 'Pesanan tidak dapat diverifikasi.')
          return
        }

        const loaded = data.order as CancellationOrder
        setOrder(loaded)
        // Bila pesanan memang sudah dibatalkan sebelumnya, langsung tampilkan state sukses.
        setPhase(loaded.status === 'Dibatalkan' ? 'success' : 'ready')
      } catch {
        if (controller.signal.aborted) return
        setPhase('error')
        setErrorMessage('Terjadi kendala jaringan. Coba muat ulang halaman.')
      }
    }

    validate()
    return () => controller.abort()
  }, [orderId, token])

  const isCancellable = order ? CANCELLABLE_STATUSES.includes(order.status) : false
  const reasonText = reason === 'Lainnya' ? customReason.trim() : reason
  const canSubmit = isCancellable && reasonText.length > 0 && !submitting

  // === Jalankan pembatalan (PATCH) ===
  async function handleCancel() {
    if (!order || !canSubmit) return
    setSubmitting(true)
    setErrorMessage('')

    try {
      const res = await fetch('/api/orders/cancel', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.orderId, token, reason: reasonText }),
      })
      const data = await res.json()

      if (!res.ok) {
        setErrorMessage(data.error ?? 'Gagal membatalkan pesanan.')
        // Bila status keburu berubah di server, perbarui agar UI ikut mengunci.
        if (data.order) setOrder(data.order as CancellationOrder)
        setSubmitting(false)
        return
      }

      setOrder(data.order as CancellationOrder)
      setPhase('success')
    } catch {
      setErrorMessage('Terjadi kendala jaringan saat membatalkan. Coba lagi.')
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen justify-center bg-brand-surface text-zinc-900">
      <div className="mx-auto flex w-full max-w-md flex-col px-5 pb-10 md:max-w-xl">
        {/* === Header hijau (membentang penuh lewat -mx-5) === */}
        <header className="-mx-5 flex h-14 items-center gap-3 bg-brand-primary px-5 text-white md:px-8">
          <Link
            href="/"
            aria-label="Tutup"
            className="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-white/15"
          >
            <X className="h-5 w-5" />
          </Link>
          <h1 className="text-lg font-bold">Pembatalan Pesanan</h1>
        </header>

        {/* === Fase: Loading === */}
        {phase === 'loading' && <LoadingState />}

        {/* === Fase: Error === */}
        {phase === 'error' && <ErrorState message={errorMessage} />}

        {/* === Fase: Sukses === */}
        {phase === 'success' && <SuccessState order={order} />}

        {/* === Fase: Ready (detail + aksi) === */}
        {phase === 'ready' && order && (
          <>
            <div className="mt-5">
              <h2 className="text-xl font-bold">Tinjau Pesanan Anda</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Periksa kembali detail di bawah agar tidak salah membatalkan.
              </p>
            </div>

            <OrderDetailCard order={order} />

            {isCancellable ? (
              <>
                {/* === Form alasan pembatalan === */}
                <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-5">
                  <label htmlFor="reason" className="block text-sm font-semibold text-zinc-800">
                    Alasan pembatalan
                  </label>
                  <select
                    id="reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="mt-2 w-full rounded-xl border border-zinc-200 bg-brand-surface px-3 py-2.5 text-sm text-zinc-800 focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
                  >
                    <option value="" disabled>
                      Pilih alasan…
                    </option>
                    {CANCEL_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>

                  {/* Textarea hanya muncul saat memilih "Lainnya" */}
                  {reason === 'Lainnya' && (
                    <textarea
                      value={customReason}
                      onChange={(e) => setCustomReason(e.target.value)}
                      rows={3}
                      placeholder="Tuliskan alasan Anda…"
                      className="mt-3 w-full resize-none rounded-xl border border-zinc-200 bg-brand-surface px-3 py-2.5 text-sm text-zinc-800 placeholder:text-zinc-400 focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
                    />
                  )}
                </div>

                {errorMessage && (
                  <p className="mt-3 text-sm font-medium text-rose-600" role="alert">
                    {errorMessage}
                  </p>
                )}

                {/* === Tombol aksi === */}
                <div className="mt-5 space-y-3">
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={!canSubmit}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-rose-600 py-3 text-sm font-bold text-white transition hover:brightness-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Memproses…
                      </>
                    ) : (
                      <>
                        <Ban className="h-4 w-4" />
                        Batalkan Pesanan Ini
                      </>
                    )}
                  </button>
                  <Link
                    href="/track"
                    className="flex w-full items-center justify-center rounded-xl bg-slate-100 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
                  >
                    Kembali ke Pelacakan
                  </Link>
                </div>
              </>
            ) : (
              // === Kondisi terkunci: sembunyikan form, tampilkan banner peringatan ===
              <>
                <div className="mt-4 flex gap-3 rounded-2xl border border-orange-200 bg-orange-50 p-4 text-orange-800">
                  <AlertTriangle className="mt-0.5 h-5 w-5 flex-none" />
                  <p className="text-sm leading-relaxed">
                    Maaf, pesanan ini tidak dapat dibatalkan secara mandiri karena paket sudah dalam
                    proses pengemasan atau telah diserahkan ke pihak kurir logistik.
                  </p>
                </div>
                <Link
                  href="/track"
                  className="mt-5 flex w-full items-center justify-center rounded-xl bg-slate-100 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
                >
                  Kembali ke Pelacakan
                </Link>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// === Sub-komponen ===

// Indikator loading + skeleton kartu saat sistem memeriksa token & status pesanan
function LoadingState() {
  return (
    <div className="mt-8">
      <div className="flex items-center justify-center gap-2 text-sm text-zinc-500">
        <Loader2 className="h-5 w-5 animate-spin text-brand-primary" />
        Memeriksa keamanan &amp; status pesanan…
      </div>
      <div className="mt-6 animate-pulse rounded-2xl border border-zinc-200 bg-white p-5">
        <div className="h-3 w-20 rounded bg-zinc-100" />
        <div className="mt-2 h-4 w-32 rounded bg-zinc-100" />
        <div className="mt-5 space-y-3 border-t border-dashed border-zinc-200 pt-4">
          <div className="h-12 rounded-lg bg-zinc-100" />
          <div className="h-12 rounded-lg bg-zinc-100" />
        </div>
      </div>
    </div>
  )
}

// Tampilan ketika tautan tidak valid / pesanan tidak ditemukan
function ErrorState({ message }: { message: string }) {
  return (
    <div className="mt-12 flex flex-col items-center text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-100">
        <AlertTriangle className="h-8 w-8 text-rose-500" />
      </div>
      <h2 className="mt-5 text-lg font-bold">Pesanan tidak dapat dibuka</h2>
      <p className="mt-2 max-w-xs text-sm text-zinc-500">{message}</p>
      <Link
        href="/track"
        className="mt-6 flex w-full max-w-xs items-center justify-center rounded-xl bg-slate-100 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
      >
        Kembali ke Pelacakan
      </Link>
    </div>
  )
}

// Tampilan sukses pembatalan (juga dipakai bila pesanan sudah dibatalkan sebelumnya)
function SuccessState({ order }: { order: CancellationOrder | null }) {
  return (
    <div className="mt-12 flex flex-col items-center text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100">
        <CheckCircle2 className="h-10 w-10 text-emerald-600" />
      </div>
      <h2 className="mt-5 text-2xl font-bold">Pesanan Anda Berhasil Dibatalkan</h2>
      <p className="mt-2 max-w-sm text-sm text-zinc-500">
        Dana yang sudah Anda transfer (jika ada) akan diproses pengembaliannya oleh tim admin
        Infarm. Stok produk pun otomatis dilepaskan kembali.
      </p>

      {order && (
        <p className="mt-4 text-xs text-zinc-400">
          Order ID: <span className="font-semibold text-zinc-600">#{normalizeId(order.orderId)}</span>
        </p>
      )}

      <div className="mt-6 w-full max-w-xs space-y-3">
        <Link
          href="/track"
          className="flex w-full items-center justify-center rounded-xl bg-slate-100 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
        >
          Lacak Pesanan
        </Link>
        <Link
          href="/"
          className="flex w-full items-center justify-center rounded-xl bg-brand-primary py-3 text-sm font-bold text-white transition hover:brightness-90"
        >
          Kembali ke Beranda
        </Link>
      </div>
    </div>
  )
}

// Kartu putih bersih berisi ringkasan pesanan (Order ID, tanggal, daftar produk, total, badge status)
function OrderDetailCard({ order }: { order: CancellationOrder }) {
  return (
    <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      {/* Baris atas: Order ID + tanggal, dan badge status */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">Order ID</p>
          <p className="mt-0.5 text-sm font-bold">#{normalizeId(order.orderId)}</p>
          <p className="mt-1 text-xs text-zinc-400">{formatLongDate(order.date)}</p>
        </div>
        <span
          className={`flex-none rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_BADGE[order.status]}`}
        >
          {order.status}
        </span>
      </div>

      {/* Daftar produk */}
      <ul className="mt-4 space-y-3 border-t border-dashed border-zinc-200 pt-4">
        {order.items.map((item) => (
          <li key={item.productId} className="flex items-center gap-3">
            <div className="relative h-12 w-12 flex-none overflow-hidden rounded-lg border border-zinc-100 bg-zinc-50">
              {/* unoptimized: placeholder sementara; item pesanan belum menyimpan foto produk */}
              <Image
                src="/images/product-placeholder.png"
                alt={item.name}
                fill
                unoptimized
                sizes="48px"
                className="object-cover"
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-zinc-900">
                {item.quantity}× {item.name}
              </p>
              <p className="text-xs text-zinc-400">{formatRupiah(item.price)} / item</p>
            </div>
            <p className="flex-none text-sm font-semibold text-zinc-700">
              {formatRupiah(item.price * item.quantity)}
            </p>
          </li>
        ))}
      </ul>

      {/* Total */}
      <div className="mt-4 flex items-center justify-between border-t border-dashed border-zinc-200 pt-4">
        <span className="text-sm text-zinc-500">Total Pembayaran</span>
        <span className="text-lg font-bold">{formatRupiah(order.totalAmount)}</span>
      </div>
    </div>
  )
}

// === Util tampilan ===

// Hilangkan '#' di depan agar tidak dobel saat dirender "#{id}"
function normalizeId(orderId: string): string {
  return orderId.replace(/^#/, '')
}

// Format tanggal panjang Indonesia: "22 Oktober 2023"
function formatLongDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d)
}
