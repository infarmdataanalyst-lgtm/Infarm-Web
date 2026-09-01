'use client'

// src/app/review/page.tsx
// Beri Review Produk by EMAIL (pembeli terverifikasi lewat riwayat pembelian).
//   LANGKAH 1: input email (auto-recognize cookie) → daftar produk yang BELUM diulas dari
//              semua pesanan email itu (foto, nama, invoice asal).
//   LANGKAH 2: pilih produk → form rating (1–5) + komentar → submit.
// Submit diverifikasi server (email↔order, produk∈order, dedup). Honeypot cegah bot.
//
// ── Kenapa email, bukan no_telepon seperti sebelumnya ──
// Menyamakan mekanisme pencarian dengan /track-order supaya pembeli tak perlu mengingat identitas
// mana yang dipakai halaman mana. Pola di sini sengaja disalin persis dari halaman itu: validasi
// + normalisasi di klien untuk UX, lalu DIULANG di server sebagai yang otoritatif.
//
// ── Tidak ada verifikasi kedua di sini, sengaja ──
// /cancel-order meminta no_telepon sebagai konfirmasi kedua karena aksinya destruktif. Memberi
// ulasan tidak merusak apa pun, jadi email saja sudah memadai.
//
// ── Nama tampilan tidak lagi diisi pembeli ──
// Dulu ada input "Nama Tampilan" yang di-auto-fill dari nama pelanggan yang dikirim server.
// Keduanya dihapus: endpoint publik tak boleh menukar "email seseorang" menjadi "nama lengkapnya"
// (aturan yang menutup SEC-007), dan nama penulis yang bisa diketik bebas berarti ulasan bisa
// dikirim atas nama orang lain. Server yang mengisinya sekarang, dari pesanan yang sudah
// diverifikasinya — sama seperti jalur ulasan lewat tautan pesanan.
//
// ── Pesanan tanpa email tak akan muncul ──
// orders.email baru terisi sejak field email kembali ke checkout. Pesanan lama ber-email NULL
// tidak bisa ditemukan dari sini sama sekali, dan itu memang disengaja.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Search, Star, CheckCircle2 } from 'lucide-react'
import { getGuestEmail } from '@/lib/guest-email'
import { isValidEmail, normalizeEmail } from '@/lib/email'

// Item yang bisa diulas — tanpa data pribadi apa pun (lihat catatan nama tampilan di atas).
type ReviewableItem = {
  orderInvoice: string
  productId: string
  name: string
  imageUrl: string | null
}

const PLACEHOLDER = '/images/product-placeholder.png'

export default function ReviewPage() {
  const [email, setEmail] = useState('')
  const [honeypot, setHoneypot] = useState('')
  const [items, setItems] = useState<ReviewableItem[] | null>(null) // null = belum cari
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Produk yang sedang diulas (null = tampil daftar)
  const [active, setActive] = useState<ReviewableItem | null>(null)
  const [toast, setToast] = useState('')

  // === LANGKAH 1: cari produk yang bisa diulas ===
  const runSearch = useCallback(async (searchEmail: string, hp: string) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/reviews/reviewable-by-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: searchEmail, website: hp }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Gagal mencari pesanan. Coba lagi.')
        setItems(null)
      } else {
        setItems(data.items ?? [])
      }
    } catch {
      setError('Terjadi kesalahan jaringan. Coba lagi.')
      setItems(null)
    } finally {
      setLoading(false)
    }
  }, [])

  // Auto-recognize cookie → auto-cari. Cookie `infarm_email` ditulis setelah checkout sukses;
  // bila masih ada dan sah, pembeli tak perlu mengetik apa pun. Honeypot dikirim kosong pada
  // pencarian otomatis karena tak ada form yang diisi.
  useEffect(() => {
    const saved = getGuestEmail()
    if (saved && isValidEmail(saved)) {
      setEmail(saved)
      runSearch(normalizeEmail(saved), '')
    }
  }, [runSearch])

  // Auto-sembunyikan toast
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 3000)
    return () => clearTimeout(t)
  }, [toast])

  function handleEmailChange(e: React.ChangeEvent<HTMLInputElement>) {
    setEmail(e.target.value)
    setError('')
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!isValidEmail(email)) {
      setError('Email tidak valid. Contoh: nama@gmail.com')
      return
    }
    // Dinormalisasi sebelum dikirim supaya cocok dengan bentuk yang tersimpan di orders.email.
    // Server menormalkannya lagi — sengaja, agar pemanggil lain pun tak bisa lolos tanpa itu.
    runSearch(normalizeEmail(email), honeypot)
  }

  // Dipanggil ReviewForm setelah submit sukses: buang item + kembali ke daftar + toast
  function handleReviewed(item: ReviewableItem) {
    setItems((prev) =>
      (prev ?? []).filter(
        (i) => !(i.orderInvoice === item.orderInvoice && i.productId === item.productId),
      ),
    )
    setActive(null)
    setToast('Ulasan berhasil dikirim. Terima kasih!')
  }

  return (
    <div className="flex min-h-screen flex-col bg-brand-surface pt-14 text-zinc-900">
      {/* Header hijau brand */}
      <header className="fixed inset-x-0 top-0 z-50 rounded-b-[2rem] bg-brand-header/90 text-white shadow-sm backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
          <Link href="/pesanan-saya" aria-label="Kembali" className="rounded-md p-1 transition active:scale-95">
            <BackIcon />
          </Link>
          <Link href="/" className="flex items-center gap-2">
            <Image src="/images/logo-infarm.png" alt="Logo Infarm" width={32} height={32} priority unoptimized className="h-8 w-auto object-contain" />
            <span className="text-xl font-bold tracking-tight">Beri Review Produk</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-4 py-5">
        {/* === Form review satu produk === */}
        {active ? (
          <ReviewForm item={active} email={email} honeypot={honeypot} onCancel={() => setActive(null)} onDone={() => handleReviewed(active)} />
        ) : (
          <>
            {/* === LANGKAH 1: cari === */}
            <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
              <h1 className="text-xl font-bold text-gray-900">Beri Review Produk</h1>
              <p className="mt-2 text-sm text-gray-500">
                Masukkan email yang Anda gunakan saat checkout untuk melihat produk yang bisa Anda ulas.
              </p>
              <form onSubmit={handleSearch} className="mt-5 space-y-3">
                <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
                  <label htmlFor="website">Website (jangan diisi)</label>
                  <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">Email</label>
                  <input
                    id="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    spellCheck={false}
                    placeholder="nama@gmail.com"
                    value={email}
                    onChange={handleEmailChange}
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
                  {loading ? 'Mencari…' : 'Cari Produk'}
                </button>
              </form>
            </div>

            {/* === Daftar produk yang bisa diulas === */}
            {items !== null && (
              <div className="mt-5 space-y-3">
                {items.length === 0 ? (
                  <div className="rounded-2xl border border-gray-100 bg-white px-4 py-8 text-center shadow-sm">
                    <p className="text-sm text-gray-400">
                      Tidak ada produk yang bisa diulas. Mungkin semua sudah Anda ulas, atau email tidak ditemukan.
                    </p>
                    {/* Pesanan sebelum field email kembali ke checkout ber-email NULL dan tak akan
                        pernah muncul di sini. Tautan ulasan per-pesanan (/review?order=INV-…) tetap
                        bekerja untuk pesanan itu karena kuncinya nomor invoice, bukan email. */}
                    <p className="mt-2 text-xs text-gray-400">
                      Pesanan lama mungkin dibuat tanpa email. Pakai tautan ulasan pada bukti pesanan Anda.
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="px-1 text-sm text-gray-500">{items.length} produk bisa Anda ulas:</p>
                    {items.map((it) => (
                      <div key={`${it.orderInvoice}-${it.productId}`} className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                        <div className="relative h-14 w-14 flex-none overflow-hidden rounded-lg border border-zinc-100 bg-zinc-50">
                          <Image src={it.imageUrl || PLACEHOLDER} alt={it.name} fill unoptimized sizes="56px" className="object-cover" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-sm font-semibold text-gray-900">{it.name}</p>
                          <p className="mt-0.5 text-xs text-gray-400">Pesanan {fmtInvoice(it.orderInvoice)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setActive(it)}
                          className="shrink-0 rounded-xl bg-brand-primary px-3 py-2 text-xs font-bold text-white transition hover:brightness-90 active:scale-[0.99]"
                        >
                          Beri Review
                        </button>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* Toast sukses */}
      {toast && (
        <div className="fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4" role="status">
          <p className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white shadow-lg">
            <CheckCircle2 className="h-4 w-4" /> {toast}
          </p>
        </div>
      )}
    </div>
  )
}

// === Form review satu produk ===
function ReviewForm({
  item,
  email,
  honeypot,
  onCancel,
  onDone,
}: {
  item: ReviewableItem
  email: string
  honeypot: string
  onCancel: () => void
  onDone: () => void
}) {
  const [rating, setRating] = useState(0)
  const [hover, setHover] = useState(0)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (rating < 1) {
      setError('Beri rating bintang terlebih dahulu.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      // `authorName` sengaja tidak dikirim — server mengisinya dari pesanan yang sudah
      // diverifikasinya. Lihat catatan "Nama tampilan" di kepala berkas.
      const res = await fetch('/api/reviews/create-by-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: normalizeEmail(email),
          website: honeypot,
          orderInvoice: item.orderInvoice,
          productId: item.productId,
          rating,
          comment: comment.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Gagal mengirim ulasan. Coba lagi.')
        setSubmitting(false)
        return
      }
      onDone()
    } catch {
      setError('Terjadi kesalahan jaringan. Coba lagi.')
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      {/* Produk yang diulas */}
      <div className="flex items-center gap-3 border-b border-gray-100 pb-4">
        <div className="relative h-14 w-14 flex-none overflow-hidden rounded-lg border border-zinc-100 bg-zinc-50">
          <Image src={item.imageUrl || PLACEHOLDER} alt={item.name} fill unoptimized sizes="56px" className="object-cover" />
        </div>
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm font-semibold text-gray-900">{item.name}</p>
          <p className="mt-0.5 text-xs text-gray-400">Pesanan {fmtInvoice(item.orderInvoice)}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        {/* Rating bintang */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">Rating</label>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => { setRating(n); setError('') }}
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(0)}
                aria-label={`${n} bintang`}
                className="p-0.5"
              >
                <Star className={`h-8 w-8 transition ${n <= (hover || rating) ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`} />
              </button>
            ))}
          </div>
        </div>

        {/* Komentar */}
        <div>
          <label htmlFor="comment" className="mb-1.5 block text-sm font-medium text-gray-700">Komentar</label>
          <textarea
            id="comment"
            rows={4}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Bagikan pengalaman Anda dengan produk ini…"
            className="w-full resize-none rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-900 focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
          />
        </div>

        {/* Nama penulis diisi server dari pesanan — tak ada input di sini (lihat kepala berkas) */}
        <p className="text-xs text-gray-400">
          Ulasan ditampilkan memakai nama pemesan pada pesanan ini.
        </p>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-zinc-300 bg-white py-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 active:scale-[0.99]"
          >
            Kembali
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 rounded-xl bg-brand-primary py-3 text-sm font-bold text-white transition hover:brightness-90 active:scale-[0.99] disabled:opacity-50"
          >
            {submitting ? 'Mengirim…' : 'Kirim Ulasan'}
          </button>
        </div>
      </form>
    </div>
  )
}

function fmtInvoice(id: string): string {
  return id.startsWith('#') ? id : `#${id}`
}

function BackIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m15 18-6-6 6-6" />
    </svg>
  )
}
