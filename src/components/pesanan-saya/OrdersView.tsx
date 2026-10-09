'use client'

// src/components/pesanan-saya/OrdersView.tsx
// Isi halaman Pesanan Saya (guest): cari dengan email → daftar pesanan dalam dua tab (Aktif /
// Selesai) → aksi di dalam kartu: batalkan (sheet), beri ulasan (sheet), detail perjalanan.
//
// ── Satu halaman, dulu tiga ──
// Sampai 2026-10-09 lacak, batalkan, dan ulasan adalah tiga halaman yang masing-masing meminta
// email lagi lalu menampilkan daftar pesanan yang sama. Kini pencariannya satu kali, dan tiap aksi
// hidup di kartu pesanannya. Mekanismenya tidak berubah:
//   - identitas: email (cookie infarm_email → auto-cari; kedaluwarsa → ketik manual)
//   - pembatalan tetap menuntut no_telepon sebagai identitas KEDUA (lihat CancelOrderSheet)
//   - semua keputusan "boleh/tidak" datang dari server (review-eligibility, evaluateBuyerCancel)
//
// ── Pesanan lama tidak akan ditemukan ──
// Kolom orders.email baru diisi sejak field email dikembalikan ke form checkout. Pesanan yang
// dibuat saat field itu absen ber-email NULL dan hanya bisa dibuka lewat nomor invoice di /track.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Search, Star } from 'lucide-react'
import { getGuestEmail } from '@/lib/guest-email'
import { setActiveOrderCount } from '@/lib/guest-phone'
import { isValidEmail, normalizeEmail } from '@/lib/email'
import { needsReview, splitBuyerOrders } from '@/lib/buyer-orders'
import type { PublicTrackOrder } from '@/types/public-order'
import HoneypotField from '@/components/pesanan-saya/HoneypotField'
import OrderCard from '@/components/pesanan-saya/OrderCard'
import CancelOrderSheet from '@/components/pesanan-saya/CancelOrderSheet'
import ReviewSheet from '@/components/pesanan-saya/ReviewSheet'

// 'aktif' = masih berjalan (Menunggu Pembayaran / Diproses / Dikirim), 'selesai' = sudah final
// (Selesai maupun Dibatalkan — bagi pembeli keduanya "tak ada lagi yang ditunggu"; badge di kartu
// tetap membedakannya).
export type OrderTab = 'aktif' | 'selesai'

export default function OrdersView({ initialTab }: { initialTab?: OrderTab }) {
  const [email, setEmail] = useState('')
  const [honeypot, setHoneypot] = useState('')
  const [orders, setOrders] = useState<PublicTrackOrder[] | null>(null) // null = belum cari
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // true = email dikenali dari cookie → sembunyikan form, langsung tampilkan hasil.
  const [recognized, setRecognized] = useState(false)
  // null = pembeli belum memilih → tab awal mengikuti data (lihat `tab`). Dibedakan dari pilihan
  // eksplisit supaya hasil pencarian baru tak menimpa tab yang sedang dibuka.
  const [tabChoice, setTabChoice] = useState<OrderTab | null>(initialTab ?? null)
  const [cancelTarget, setCancelTarget] = useState<PublicTrackOrder | null>(null)
  const [reviewTarget, setReviewTarget] = useState<PublicTrackOrder | null>(null)
  const [toast, setToast] = useState('')

  const runSearch = useCallback(async (searchEmail: string, hp: string) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/orders/track-by-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: searchEmail, website: hp }),
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

  // Auto-recognize: cookie email ada & valid (pernah checkout di device ini) → langsung cari.
  useEffect(() => {
    const saved = getGuestEmail()
    if (saved && isValidEmail(saved)) {
      setEmail(saved)
      setRecognized(true)
      runSearch(normalizeEmail(saved), '')
    }
  }, [runSearch])

  // Daftar per tab. Server sudah mengurutkan (menunggu ulasan di atas, lalu terbaru); di sini
  // hanya dipecah supaya berpindah tab tak memanggil server lagi.
  const { active: activeOrders, finished: finishedOrders } = useMemo(
    () => splitBuyerOrders(orders ?? []),
    [orders],
  )
  const perluDiulas = useMemo(() => finishedOrders.filter(needsReview).length, [finishedOrders])

  // Tab awal: Aktif bila ada yang berjalan; kalau semuanya final, langsung Selesai.
  const tab: OrderTab =
    tabChoice ?? (activeOrders.length > 0 || finishedOrders.length === 0 ? 'aktif' : 'selesai')
  const shownOrders = tab === 'aktif' ? activeOrders : finishedOrders

  // Badge pesanan aktif di header ikut akurat — hanya untuk email milik device ini (cookie),
  // bukan email lain yang diketik manual.
  useEffect(() => {
    if (recognized && orders !== null) setActiveOrderCount(activeOrders.length)
  }, [recognized, orders, activeOrders.length])

  // Toast hilang sendiri
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 3500)
    return () => clearTimeout(t)
  }, [toast])

  function handleUseOtherEmail() {
    setRecognized(false)
    setEmail('')
    setOrders(null)
    setError('')
    setTabChoice(null) // daftar baru → tab awal dihitung ulang dari datanya
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValidEmail(email)) {
      setError('Email tidak valid. Contoh: nama@gmail.com')
      return
    }
    // Dinormalisasi sebelum dikirim supaya cocok dengan bentuk di orders.email; server
    // menormalkannya lagi — sengaja, agar pemanggil lain pun tak bisa lolos tanpa itu.
    runSearch(normalizeEmail(email), honeypot)
  }

  // Pesanan dibatalkan dari sheet: ubah statusnya di daftar (tanpa fetch ulang) → kartunya pindah
  // ke tab Selesai; buka tab itu supaya pembeli melihat hasilnya, bukan daftar yang berkurang.
  function handleCancelled(orderId: string) {
    setOrders((prev) =>
      (prev ?? []).map((o) => (o.orderId === orderId ? { ...o, status: 'Dibatalkan' } : o)),
    )
    setCancelTarget(null)
    setTabChoice('selesai')
    setToast('Pesanan berhasil dibatalkan. Stok produk telah dikembalikan.')
  }

  // Satu ulasan tersimpan: coret produknya dari daftar tunggu pesanan itu. Sheet tetap terbuka
  // (ReviewSheet membaca `reviewTarget` yang ikut diperbarui) supaya produk berikutnya bisa langsung
  // diulas; begitu semua selesai, badge di kartu berganti "Sudah diulas".
  function handleReviewed(orderId: string, productId: string) {
    const patch = (o: PublicTrackOrder): PublicTrackOrder =>
      o.orderId !== orderId
        ? o
        : {
            ...o,
            review: {
              ...o.review,
              pendingProductIds: o.review.pendingProductIds.filter((id) => id !== productId),
              reviewedCount: o.review.reviewedCount + 1,
            },
          }
    setOrders((prev) => (prev ?? []).map(patch))
    setReviewTarget((prev) => (prev ? patch(prev) : prev))
    setToast('Ulasan berhasil dikirim. Terima kasih!')
  }

  return (
    <>
      {recognized ? (
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-600">
            Menampilkan pesanan untuk email Anda ·{' '}
            <button
              type="button"
              onClick={handleUseOtherEmail}
              className="font-semibold text-brand-primary underline transition hover:no-underline"
            >
              Cari email lain
            </button>
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-bold text-gray-900">Lacak dengan Email</h1>
          <p className="mt-2 text-sm text-gray-500">
            Masukkan email yang Anda gunakan saat checkout untuk melihat, membatalkan, atau
            mengulas pesanan Anda.
          </p>

          <form onSubmit={handleSubmit} className="mt-5 space-y-3">
            <HoneypotField value={honeypot} onChange={setHoneypot} />
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">
                Email
              </label>
              <input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                spellCheck={false}
                placeholder="nama@gmail.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError('') }}
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
      )}

      {/* Galat saat pencarian otomatis (form tersembunyi) tetap harus terlihat */}
      {recognized && error && <p className="mt-3 px-1 text-sm text-rose-600">{error}</p>}

      {orders !== null && (
        <div className="mt-5 space-y-3">
          {orders.length === 0 ? (
            <div className="rounded-2xl border border-gray-100 bg-white px-4 py-8 text-center shadow-sm">
              <p className="text-sm text-gray-400">Tidak ada pesanan untuk email ini.</p>
              {/* Pesanan sebelum field email ada hanya bisa dibuka lewat nomor invoice. */}
              <p className="mt-2 text-xs text-gray-400">
                Pesanan lama mungkin dibuat tanpa email. Coba{' '}
                <Link href="/track" className="font-semibold text-brand-primary underline transition hover:no-underline">
                  cari dengan nomor pesanan
                </Link>{' '}
                yang ada di bukti checkout.
              </p>
            </div>
          ) : (
            <>
              <p className="px-1 text-sm text-gray-500">{orders.length} pesanan ditemukan untuk email ini</p>

              {/* Tab Aktif / Selesai. Angka kuning di Selesai = pesanan yang menunggu ulasan,
                  warnanya sama dengan badge "Beri Ulasan" di kartu supaya hubungannya terbaca. */}
              <div role="tablist" aria-label="Filter pesanan" className="flex gap-2">
                <TabButton active={tab === 'aktif'} count={activeOrders.length} onClick={() => setTabChoice('aktif')}>
                  Aktif
                </TabButton>
                <TabButton
                  active={tab === 'selesai'}
                  count={finishedOrders.length}
                  highlight={perluDiulas}
                  onClick={() => setTabChoice('selesai')}
                >
                  Selesai
                </TabButton>
              </div>
              {tab === 'selesai' && perluDiulas > 0 && (
                <p className="flex items-center gap-1.5 px-1 text-xs text-brand-accent-ink">
                  <Star className="h-3.5 w-3.5 fill-brand-accent text-brand-accent" />
                  {perluDiulas} pesanan menunggu ulasan Anda
                </p>
              )}

              {shownOrders.length === 0 ? (
                <div className="rounded-2xl border border-gray-100 bg-white px-4 py-8 text-center shadow-sm">
                  <p className="text-sm text-gray-400">
                    {tab === 'aktif' ? 'Tidak ada pesanan yang sedang berjalan.' : 'Belum ada pesanan yang selesai.'}
                  </p>
                </div>
              ) : (
                shownOrders.map((o) => (
                  <OrderCard key={o.orderId} order={o} onCancel={setCancelTarget} onReview={setReviewTarget} />
                ))
              )}
            </>
          )}
        </div>
      )}

      <CancelOrderSheet order={cancelTarget} email={email} onClose={() => setCancelTarget(null)} onCancelled={handleCancelled} />
      <ReviewSheet order={reviewTarget} email={email} honeypot={honeypot} onClose={() => setReviewTarget(null)} onReviewed={handleReviewed} />

      {toast && (
        <div role="status" className="fixed inset-x-4 bottom-6 z-[90] mx-auto max-w-md rounded-xl bg-zinc-900 px-4 py-3 text-center text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </>
  )
}

// Satu tombol tab: label + jumlah; `highlight` = angka kuning tambahan (pesanan menunggu ulasan).
function TabButton({
  active,
  count,
  highlight = 0,
  onClick,
  children,
}: {
  active: boolean
  count: number
  highlight?: number
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
        active ? 'border-brand-primary bg-brand-primary text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-brand-light'
      }`}
    >
      {children}
      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'}`}>
        {count}
      </span>
      {highlight > 0 && (
        <span
          aria-label={`${highlight} perlu diulas`}
          className="flex items-center gap-0.5 rounded-full bg-brand-accent px-2 py-0.5 text-xs font-bold text-brand-accent-ink"
        >
          <Star className="h-3 w-3 fill-current" />
          {highlight}
        </span>
      )}
    </button>
  )
}
