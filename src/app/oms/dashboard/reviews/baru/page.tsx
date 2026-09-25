'use client'

// src/app/oms/dashboard/reviews/baru/page.tsx
// Form "Tambah Ulasan" OMS — memasukkan ULASAN INTERNAL (bukan dari pembeli) untuk mengisi katalog
// yang masih kosong menjelang peluncuran. Disimpan lewat POST /api/reviews/create-manual, yang
// menandainya source='internal' dan menolak sesi non-admin.
//
// Produk dipilih lewat PENCARIAN NAMA, bukan id. Itu inti kenapa halaman ini ada: menulis ulasan
// awal langsung ke database berarti mencari UUID tiap produk lebih dulu, dan itulah bagian yang
// melelahkan — bukan menulis kalimat ulasannya.
//
// Setelah ulasan pembeli sungguhan berdatangan, ulasan yang dibuat di sini bisa dihapus dari
// halaman daftar Ulasan (tombol Hapus hanya muncul pada baris bertanda "Internal").

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronRight, Search, Star } from 'lucide-react'
import OmsHeader from '@/components/oms/OmsHeader'
import { formatRupiah } from '@/lib/format'
import { REVIEW_COMMENT_MAX } from '@/lib/review-validation'
import type { StoredProduct } from '@/types/product'

// Kategori ulasan — sama dengan yang dipakai filter di halaman produk storefront.
const KATEGORI = ['Umum', 'Kualitas', 'Pengiriman', 'Harga', 'Kemasan']

// Tanggal hari ini dalam format input date (YYYY-MM-DD, waktu lokal).
function hariIni(): string {
  const d = new Date()
  const bulan = `${d.getMonth() + 1}`.padStart(2, '0')
  const tanggal = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${bulan}-${tanggal}`
}

export default function TambahUlasanPage() {
  const router = useRouter()

  // === State form ===
  const [product, setProduct] = useState<StoredProduct | null>(null)
  const [authorName, setAuthorName] = useState('')
  const [rating, setRating] = useState(5)
  const [hoverRating, setHoverRating] = useState(0)
  const [comment, setComment] = useState('')
  const [category, setCategory] = useState(KATEGORI[0])
  const [tanggal, setTanggal] = useState(hariIni())

  // === State pencarian produk ===
  const [products, setProducts] = useState<StoredProduct[]>([])
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  // === State submit ===
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetch('/api/products/list')
      .then((res) => res.json())
      .then((data: { products?: StoredProduct[] }) => {
        if (!active) return
        setProducts(data.products ?? [])
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  const hasil = useMemo(() => {
    const q = query.trim().toLowerCase()
    // Produk diarsipkan tetap boleh diulas: ulasan lama bisa saja menyangkut produk yang kini
    // disembunyikan dari katalog. Yang disaring hanya kecocokan namanya.
    return products.filter((p) => (q ? p.name.toLowerCase().includes(q) : true)).slice(0, 8)
  }, [products, query])

  // === Validasi inline ===
  const productError = !product ? 'Pilih produk yang diulas' : null
  const namaError =
    authorName.trim().length < 2 ? 'Nama penulis minimal 2 karakter' : null
  const commentError =
    comment.trim().length < 3
      ? 'Komentar minimal 3 karakter'
      : comment.length > REVIEW_COMMENT_MAX
        ? `Komentar maksimal ${REVIEW_COMMENT_MAX} karakter`
        : null
  // Tanggal boleh mundur (menyalin testimoni lama), tapi tidak boleh maju — ulasan bertanggal besok
  // tampil aneh di storefront. Server menolaknya juga.
  const tanggalError = tanggal > hariIni() ? 'Tanggal tidak boleh di masa depan' : null

  const isValid = !productError && !namaError && !commentError && !tanggalError

  async function handleSave() {
    setAttempted(true)
    setSubmitError(null)
    if (!isValid || !product) return

    setSaving(true)
    try {
      const res = await fetch('/api/reviews/create-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: product.id,
          authorName: authorName.trim(),
          rating,
          comment: comment.trim(),
          category,
          // Jam sengaja dikunci tengah hari: tanpa jam, tanggal dianggap UTC 00:00 dan bisa
          // mundur sehari di zona WIB.
          createdAt: `${tanggal}T12:00:00`,
        }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? 'Gagal menyimpan ulasan.')
      }
      router.push('/oms/dashboard/reviews')
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Gagal menyimpan ulasan.')
      setSaving(false)
    }
  }

  return (
    <>
      <OmsHeader title="Ulasan" />

      <main className="p-6 pb-28 md:p-8 md:pb-28">
        <nav className="flex items-center gap-1.5 text-sm text-gray-400">
          <Link href="/oms/dashboard/reviews" className="hover:text-gray-600">
            Ulasan
          </Link>
          <ChevronRight className="h-4 w-4" />
          <span className="font-medium text-gray-600">Tambah Ulasan</span>
        </nav>

        <div className="mt-2">
          <h2 className="text-2xl font-bold text-gray-900">Tambah Ulasan</h2>
          <p className="mt-1 text-sm text-gray-500">
            Untuk mengisi katalog yang masih kosong, misalnya menyalin testimoni dari marketplace
            lain atau hasil uji produk internal.
          </p>
        </div>

        {/* Peringatan yang sengaja tidak bisa dilewati begitu saja: yang dibuat di sini bukan
            ulasan pembeli, dan di halaman produk ia tampil sama seperti ulasan pembeli. */}
        <div className="mx-auto mt-5 max-w-3xl rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">Ulasan ini ditandai Internal</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-800">
            Di halaman produk ulasan ini tampil sama seperti ulasan pembeli, dan ikut menggeser
            rata-rata rating produk. Tandanya hanya terlihat di OMS. Pakailah testimoni yang benar
            adanya — ulasan karangan yang menyamar sebagai pembeli bisa berujung masalah hukum
            perlindungan konsumen, dan sekali ketahuan seluruh ulasan di situs ikut diragukan.
          </p>
        </div>

        <div className="mx-auto mt-6 max-w-3xl space-y-6">
          {/* --- Produk --- */}
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="text-base font-bold text-gray-900">Produk yang Diulas</h3>

            {product ? (
              <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-900">{product.name}</p>
                  <p className="text-xs text-gray-500">
                    {product.sku} · {formatRupiah(product.promoPrice)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setProduct(null)
                    setQuery('')
                  }}
                  className="flex-none rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
                >
                  Ganti
                </button>
              </div>
            ) : (
              <div className="relative mt-4">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    ref={searchRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setTimeout(() => setFocused(false), 120)}
                    placeholder="Cari produk berdasarkan nama…"
                    className={`${inputClass} pl-10`}
                  />
                </div>

                {focused && (
                  <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                    {hasil.length === 0 ? (
                      <p className="px-4 py-3 text-sm text-gray-400">
                        {products.length === 0
                          ? 'Belum ada produk. Tambahkan produk dulu di menu Produk.'
                          : 'Tidak ada produk yang cocok.'}
                      </p>
                    ) : (
                      hasil.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault()
                            setProduct(p)
                          }}
                          className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition hover:bg-emerald-50"
                        >
                          <span className="truncate text-sm font-medium text-gray-800">{p.name}</span>
                          <span className="flex-none font-mono text-[11px] text-gray-400">{p.sku}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}

                {attempted && productError && (
                  <p className="mt-2 text-xs font-medium text-red-600">{productError}</p>
                )}
              </div>
            )}
          </section>

          {/* --- Isi ulasan --- */}
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="text-base font-bold text-gray-900">Isi Ulasan</h3>

            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <Field label="Nama Penulis" error={attempted ? namaError : null}>
                <input
                  type="text"
                  value={authorName}
                  maxLength={100}
                  onChange={(e) => setAuthorName(e.target.value)}
                  placeholder="Contoh: Rina S."
                  className={inputClass}
                />
              </Field>

              <Field label="Tanggal Ulasan" error={attempted ? tanggalError : null}>
                <input
                  type="date"
                  value={tanggal}
                  max={hariIni()}
                  onChange={(e) => setTanggal(e.target.value)}
                  className={inputClass}
                />
              </Field>
            </div>

            <div className="mt-5">
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Rating</label>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(n)}
                    onMouseEnter={() => setHoverRating(n)}
                    onMouseLeave={() => setHoverRating(0)}
                    aria-label={`${n} bintang`}
                    className="p-0.5"
                  >
                    <Star
                      className={`h-7 w-7 transition ${
                        n <= (hoverRating || rating)
                          ? 'fill-amber-400 text-amber-400'
                          : 'text-gray-300'
                      }`}
                    />
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Kategori</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={inputClass}
              >
                {KATEGORI.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-5">
              <Field label="Komentar" error={attempted ? commentError : null}>
                <textarea
                  rows={4}
                  value={comment}
                  maxLength={REVIEW_COMMENT_MAX}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Tulis isi ulasan seperti yang akan dibaca pembeli…"
                  className={`${inputClass} resize-none`}
                />
              </Field>
              <p className="mt-1 text-right text-xs text-gray-400">
                {comment.length}/{REVIEW_COMMENT_MAX}
              </p>
            </div>
          </section>
        </div>
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white px-6 py-3.5 md:left-64">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {submitError ? (
            <p className="text-xs font-medium text-red-600">{submitError}</p>
          ) : (
            <p className="flex items-center gap-2 text-xs text-gray-400">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Tersimpan sebagai ulasan internal — bisa dihapus massal nanti.
            </p>
          )}
          <div className="flex items-center gap-3">
            <Link
              href="/oms/dashboard/reviews"
              className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50"
            >
              Batal
            </Link>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !isValid}
              className="rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Menyimpan…' : 'Simpan Ulasan'}
            </button>
          </div>
        </div>
      </footer>
    </>
  )
}

// === Sub-komponen & Helper ===

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100'

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string | null
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700">{label}</label>
      {children}
      {error && <p className="mt-1.5 text-xs font-medium text-red-600">{error}</p>}
    </div>
  )
}
