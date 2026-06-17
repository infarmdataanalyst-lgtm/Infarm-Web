'use client'

// src/app/oms/dashboard/reviews/page.tsx
// Halaman Manajemen Ulasan Pelanggan OMS Infarm — tata letak Top-Down Analytics:
// Header + filter produk (kemudi) → metrik & chart → sub-filter → tabel detail ulasan.
// Data masih dummy; moderasi (balas & tampilkan di web) dikelola di state lokal.
// TODO: hubungkan ke mock DB / Supabase + sinkron ke ulasan storefront setelah OMS dibangun.

import { useMemo, useState } from 'react'
import Image from 'next/image'
import { Star, MessageSquare, Clock4 } from 'lucide-react'
import OmsHeader from '@/components/oms/OmsHeader'

// === Tipe Data ===

type OmsReview = {
  id: string
  customerName: string
  productName: string
  productSku: string
  productImage: string
  rating: number // 1–5
  comment: string
  images: string[] // lampiran foto ulasan
  date: string // ISO datetime
  reply?: string // balasan admin
  visible: boolean // true = tampil di halaman produk ecommerce
}

type MediaFilter = 'all' | 'with-photo' | 'text-only'

const PLACEHOLDER = '/images/product-placeholder.png'
const RATING_VALUES = [0, 5, 4, 3, 2, 1] // 0 = semua rating

const MEDIA_FILTERS: { label: string; value: MediaFilter }[] = [
  { label: 'Semua Konten', value: 'all' },
  { label: 'Dengan Foto', value: 'with-photo' },
  { label: 'Hanya Teks', value: 'text-only' },
]

// === Data Dummy Ulasan ===
// TODO: ganti dengan query Supabase setelah OMS selesai
const INITIAL_REVIEWS: OmsReview[] = [
  { id: 'REV-001', customerName: 'Andi Wijaya', productName: 'Media Tanam Premium 5L', productSku: 'MDT-PRM-5L', productImage: PLACEHOLDER, rating: 5, comment: 'Kualitas media tanamnya gembur dan wangi kompos. Tanaman cabai saya tumbuh subur sejak pindah ke media ini.', images: [PLACEHOLDER, PLACEHOLDER], date: '2026-06-14T09:24:00.000Z', visible: true },
  { id: 'REV-002', customerName: 'Siti Aminah', productName: 'Pupuk Organik Cair (POC) 1L', productSku: 'PPK-POC-1L', rating: 4, productImage: PLACEHOLDER, comment: 'Tanaman lebih hijau setelah pakai POC ini. Baunya agak menyengat tapi wajar untuk pupuk organik.', images: [], date: '2026-06-13T15:40:00.000Z', reply: 'Terima kasih ulasannya, Kak Siti! Aroma alami menandakan kandungan mikroba aktif 🌱', visible: true },
  { id: 'REV-003', customerName: 'Budi Santoso', productName: 'Benih Cabai Rawit Unggul', productSku: 'BNH-CBR-01', productImage: PLACEHOLDER, rating: 2, comment: 'Daya tumbuh kurang, dari 20 benih hanya 8 yang berkecambah. Agak kecewa.', images: [PLACEHOLDER], date: '2026-06-12T11:05:00.000Z', visible: true },
  { id: 'REV-004', customerName: 'Rina Kartika', productName: 'Media Tanam Premium 5L', productSku: 'MDT-PRM-5L', productImage: PLACEHOLDER, rating: 5, comment: 'Pengiriman cepat dan kemasan rapi. Recommended!', images: [], date: '2026-06-12T08:10:00.000Z', visible: true },
  { id: 'REV-005', customerName: 'Joko Pratama', productName: 'Benih Selada Hidroponik', productSku: 'BNH-SLD-02', productImage: PLACEHOLDER, rating: 3, comment: 'Lumayan, sebagian tumbuh bagus tapi ada yang layu di minggu kedua.', images: [], date: '2026-06-11T19:32:00.000Z', visible: true },
  { id: 'REV-006', customerName: 'Dewi Lestari', productName: 'Pupuk Organik Cair (POC) 1L', productSku: 'PPK-POC-1L', productImage: PLACEHOLDER, rating: 5, comment: 'Hasilnya nyata di tanaman buah saya. Pasti beli lagi!', images: [PLACEHOLDER, PLACEHOLDER, PLACEHOLDER], date: '2026-06-11T07:48:00.000Z', visible: true },
  { id: 'REV-007', customerName: 'Agus Salim', productName: 'Benih Cabai Rawit Unggul', productSku: 'BNH-CBR-01', productImage: PLACEHOLDER, rating: 1, comment: 'Benih tidak tumbuh sama sekali. Mohon diperbaiki kualitasnya.', images: [], date: '2026-06-10T14:00:00.000Z', visible: false },
  { id: 'REV-008', customerName: 'Maya Putri', productName: 'Media Tanam Premium 5L', productSku: 'MDT-PRM-5L', productImage: PLACEHOLDER, rating: 4, comment: 'Bagus untuk semai. Teksturnya pas, tidak terlalu padat.', images: [PLACEHOLDER], date: '2026-06-10T10:15:00.000Z', visible: true },
  { id: 'REV-009', customerName: 'Hendra Gunawan', productName: 'Benih Selada Hidroponik', productSku: 'BNH-SLD-02', productImage: PLACEHOLDER, rating: 5, comment: 'Mantap, panen melimpah dan daunnya renyah.', images: [], date: '2026-06-09T16:50:00.000Z', reply: 'Senang mendengarnya, Kak Hendra! Selamat panen 🥬', visible: true },
]

// === Helper ===

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const tgl = new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(d)
  const jam = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
  return `${tgl}, ${jam}`
}

export default function ReviewsPage() {
  // === State ===
  const [reviews, setReviews] = useState<OmsReview[]>(INITIAL_REVIEWS)
  const [selectedProduct, setSelectedProduct] = useState<string>('all') // 'all' = semua produk
  const [selectedRating, setSelectedRating] = useState<number>(0) // 0 = semua rating
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all')

  // Moderasi: balas inline
  const [replyingId, setReplyingId] = useState<string | null>(null)
  const [replyDraft, setReplyDraft] = useState('')

  // Daftar produk unik untuk dropdown filter
  const productOptions = useMemo(
    () => Array.from(new Set(reviews.map((r) => r.productName))).sort(),
    [reviews],
  )

  // === Kemudi utama: filter berdasarkan produk (menyaring chart & tabel) ===
  const byProduct = useMemo(
    () => (selectedProduct === 'all' ? reviews : reviews.filter((r) => r.productName === selectedProduct)),
    [reviews, selectedProduct],
  )

  // === Metrik & distribusi (dihitung dari produk terpilih) ===
  const metrics = useMemo(() => {
    const total = byProduct.length
    const sum = byProduct.reduce((acc, r) => acc + r.rating, 0)
    const average = total > 0 ? sum / total : 0
    // Distribusi bintang 5 → 1
    const distribution = [5, 4, 3, 2, 1].map((star) => {
      const count = byProduct.filter((r) => r.rating === star).length
      return { star, count, percent: total > 0 ? (count / total) * 100 : 0 }
    })
    // Ulasan bintang 1–3 yang belum dibalas (tugas CS)
    const unreplied = byProduct.filter((r) => r.rating <= 3 && !r.reply).length
    return { total, average, distribution, unreplied }
  }, [byProduct])

  // === Tabel: produk + rating + media ===
  const tableReviews = useMemo(() => {
    return byProduct.filter((r) => {
      const ratingMatch = selectedRating === 0 || r.rating === selectedRating
      const hasPhoto = r.images.length > 0
      const mediaMatch =
        mediaFilter === 'all' ||
        (mediaFilter === 'with-photo' && hasPhoto) ||
        (mediaFilter === 'text-only' && !hasPhoto)
      return ratingMatch && mediaMatch
    })
  }, [byProduct, selectedRating, mediaFilter])

  // === Aksi moderasi ===

  function openReply(review: OmsReview) {
    setReplyingId(review.id)
    setReplyDraft(review.reply ?? '')
  }

  function saveReply() {
    if (!replyingId) return
    const text = replyDraft.trim()
    setReviews((prev) =>
      prev.map((r) => (r.id === replyingId ? { ...r, reply: text || undefined } : r)),
    )
    setReplyingId(null)
    setReplyDraft('')
  }

  function toggleVisible(id: string) {
    setReviews((prev) => prev.map((r) => (r.id === id ? { ...r, visible: !r.visible } : r)))
  }

  return (
    <>
      <OmsHeader title="Ulasan" notificationCount={3} />

      <main className="p-6 md:p-8">
        {/* ===================== LANTAI 0: Header & Filter Produk ===================== */}
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Manajemen Ulasan</h2>
          <p className="mt-1 text-sm text-gray-500">
            Pantau reputasi toko dan kualitas produk dari e-commerce Infarm secara real-time.
          </p>
        </div>

        <div className="mt-4 max-w-md">
          <label htmlFor="product-filter" className="mb-1.5 block text-sm font-medium text-gray-700">
            Filter Produk Spesifik
          </label>
          <select
            id="product-filter"
            value={selectedProduct}
            onChange={(e) => setSelectedProduct(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
          >
            <option value="all">Semua Produk Infarm</option>
            {productOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        {/* ===================== LANTAI 1: Metrik & Chart Dinamis ===================== */}
        <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Kolom 1: Rata-rata rating */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-gray-500">Rata-rata Rating</p>
            <div className="mt-2 flex items-end gap-1">
              <span className="text-4xl font-bold text-gray-900">{metrics.average.toFixed(1)}</span>
              <span className="mb-1 text-sm text-gray-400">/ 5.0</span>
            </div>
            <div className="mt-2">
              <StarRow value={Math.round(metrics.average)} />
            </div>
            <p className="mt-2 text-xs text-gray-400">
              Total {metrics.total.toLocaleString('id-ID')} Ulasan
            </p>
          </div>

          {/* Kolom 2: Distribusi bintang */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-gray-500">Distribusi Bintang</p>
            <div className="mt-3 space-y-2">
              {metrics.distribution.map((row) => (
                <div key={row.star} className="flex items-center gap-2">
                  <span className="flex w-8 items-center gap-0.5 text-xs font-medium text-gray-600">
                    {row.star}
                    <Star className="h-3 w-3 fill-amber-400 stroke-amber-400" />
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full rounded-full bg-amber-400" style={{ width: `${row.percent}%` }} />
                  </div>
                  <span className="w-8 text-right text-xs text-gray-400">{row.count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Kolom 3: Respons kerja CS */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-gray-500">Respons Kerja CS</p>
            <div className="mt-3 flex items-center gap-4 rounded-lg bg-red-50 p-4">
              <div className="flex h-12 w-12 flex-none items-center justify-center rounded-lg bg-red-100 text-red-600">
                <Clock4 className="h-6 w-6" />
              </div>
              <div>
                <p className="text-3xl font-bold text-red-600">{metrics.unreplied}</p>
                <p className="text-xs text-gray-500">Ulasan 1–3★ belum dibalas</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-gray-400">Segera tanggapi untuk menjaga reputasi toko.</p>
          </div>
        </section>

        {/* ===================== LANTAI 2: Sub-filter interaktif ===================== */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {RATING_VALUES.map((value) => (
            <RatingPill key={value} value={value} active={selectedRating === value} onClick={() => setSelectedRating(value)} />
          ))}
          <span className="mx-1 hidden h-5 w-px bg-gray-200 sm:block" />
          {MEDIA_FILTERS.map((filter) => (
            <FilterPill key={filter.value} label={filter.label} active={mediaFilter === filter.value} onClick={() => setMediaFilter(filter.value)} />
          ))}
        </div>

        {/* ===================== LANTAI 3: Tabel detail ulasan ===================== */}
        <section className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-5 py-3.5">Pelanggan</th>
                  <th className="px-5 py-3.5">Produk</th>
                  <th className="px-5 py-3.5">Rating</th>
                  <th className="px-5 py-3.5">Komentar &amp; Media</th>
                  <th className="px-5 py-3.5">Tanggal</th>
                  <th className="px-5 py-3.5">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tableReviews.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-sm text-gray-400">
                      Tidak ada ulasan yang cocok dengan kriteria filter.
                    </td>
                  </tr>
                ) : (
                  tableReviews.map((review) => (
                    <tr key={review.id} className={`align-top ${review.visible ? '' : 'bg-gray-50/60'}`}>
                      {/* Pelanggan */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">
                            {review.customerName.charAt(0)}
                          </span>
                          <span className="font-medium text-gray-900">{review.customerName}</span>
                        </div>
                      </td>
                      {/* Produk */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2.5">
                          <div className="relative h-10 w-10 flex-none overflow-hidden rounded-lg border border-gray-200 bg-gray-100">
                            <Image src={review.productImage} alt={review.productName} fill unoptimized sizes="40px" className="object-cover" />
                          </div>
                          <div className="max-w-[180px]">
                            <p className="line-clamp-2 text-xs font-medium text-gray-800">{review.productName}</p>
                            <p className="font-mono text-[11px] text-gray-400">{review.productSku}</p>
                          </div>
                        </div>
                      </td>
                      {/* Rating */}
                      <td className="px-5 py-4">
                        <StarRow value={review.rating} />
                      </td>
                      {/* Komentar & Media */}
                      <td className="px-5 py-4">
                        <div className="max-w-xs">
                          <p className="text-sm leading-relaxed text-gray-700">{review.comment}</p>
                          {review.images.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {review.images.map((src, i) => (
                                <button key={i} type="button" className="relative h-12 w-12 overflow-hidden rounded-md border border-gray-200 bg-gray-50 transition hover:ring-2 hover:ring-emerald-400">
                                  <Image src={src} alt={`Foto ulasan ${i + 1}`} fill unoptimized sizes="48px" className="object-cover" />
                                </button>
                              ))}
                            </div>
                          )}
                          {review.reply && replyingId !== review.id && (
                            <div className="mt-2 rounded-lg border border-emerald-100 bg-emerald-50 p-2.5">
                              <p className="text-[11px] font-semibold text-emerald-700">Balasan Anda:</p>
                              <p className="text-xs text-emerald-800">{review.reply}</p>
                            </div>
                          )}
                          {/* Form balas inline */}
                          {replyingId === review.id && (
                            <div className="mt-2">
                              <textarea
                                value={replyDraft}
                                onChange={(e) => setReplyDraft(e.target.value)}
                                rows={3}
                                placeholder="Tulis balasan untuk pelanggan…"
                                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                              />
                              <div className="mt-2 flex gap-2">
                                <button type="button" onClick={saveReply} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-800">
                                  Simpan Balasan
                                </button>
                                <button type="button" onClick={() => setReplyingId(null)} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50">
                                  Batal
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                      {/* Tanggal */}
                      <td className="px-5 py-4 whitespace-nowrap text-xs text-gray-500">{formatDateTime(review.date)}</td>
                      {/* Aksi */}
                      <td className="px-5 py-4">
                        <div className="flex flex-col gap-2.5">
                          <button
                            type="button"
                            onClick={() => openReply(review)}
                            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50"
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                            {review.reply ? 'Edit Balasan' : 'Balas'}
                          </button>
                          {/* Toggle Tampilkan di Web (moderasi storefront) */}
                          <label className="flex cursor-pointer items-center gap-2">
                            <Toggle checked={review.visible} onChange={() => toggleVisible(review.id)} ariaLabel={`Tampilkan ulasan ${review.customerName} di web`} />
                            <span className={`text-[11px] font-medium ${review.visible ? 'text-gray-600' : 'text-gray-400'}`}>
                              {review.visible ? 'Tampil di web' : 'Disembunyikan'}
                            </span>
                          </label>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  )
}

// === Sub-komponen ===

// Barisan 5 bintang; terisi emas hingga `value`, sisanya abu-abu
function StarRow({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`Rating ${value} dari 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={`h-4 w-4 ${i < value ? 'fill-amber-400 stroke-amber-400' : 'fill-transparent stroke-gray-300'}`}
        />
      ))}
    </div>
  )
}

// Tombol filter rating berisi ikon bintang; aktif = hijau brand + bintang putih
function RatingPill({ value, active, onClick }: { value: number; active: boolean; onClick: () => void }) {
  const starClass = active ? 'fill-white stroke-white' : 'fill-amber-400 stroke-amber-400'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={value === 0 ? 'Semua rating' : `${value} bintang`}
      className={`flex shrink-0 items-center gap-1 rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
        active ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-slate-50'
      }`}
    >
      {value === 0 ? (
        <>
          <span>Semua Rating</span>
          <Star className={`h-3.5 w-3.5 ${starClass}`} />
        </>
      ) : (
        Array.from({ length: value }, (_, i) => <Star key={i} className={`h-3.5 w-3.5 ${starClass}`} />)
      )}
    </button>
  )
}

// Tombol filter teks berbentuk kapsul
function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
        active ? 'bg-emerald-600 text-white' : 'bg-slate-50 text-gray-600 hover:bg-slate-100'
      }`}
    >
      {label}
    </button>
  )
}

// Toggle switch kecil
function Toggle({ checked, onChange, ariaLabel }: { checked: boolean; onChange: () => void; ariaLabel: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onChange}
      className={`relative h-5 w-9 flex-none rounded-full transition-colors ${checked ? 'bg-emerald-600' : 'bg-gray-300'}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  )
}
