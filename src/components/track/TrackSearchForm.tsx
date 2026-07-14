'use client'

// src/components/track/TrackSearchForm.tsx
// Form pencarian nomor pesanan pada halaman Lacak Pesanan.
// Saat disubmit, perbarui URL menjadi /track?order=NOMOR agar halaman (server) menampilkan hasil.

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

type TrackSearchFormProps = {
  // Nilai awal input (mis. saat URL sudah memuat ?order=... tapi tidak ditemukan)
  defaultValue?: string
}

// Form input nomor pesanan + tombol cari. Navigasi ke /track?order=... saat submit.
export default function TrackSearchForm({ defaultValue = '' }: TrackSearchFormProps) {
  const router = useRouter()
  const [query, setQuery] = useState(defaultValue)

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) return
    // Perbarui query params; halaman server akan membaca ?order= dan menampilkan hasil.
    router.push(`/track?order=${encodeURIComponent(trimmed)}`)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-gray-400">
          <SearchIcon />
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Contoh: INV-20260713-1234"
          aria-label="Nomor pesanan"
          className="block w-full rounded-xl border border-gray-300 bg-white py-3 pl-11 pr-4 text-sm text-gray-900 placeholder-gray-400 transition-colors focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100"
        />
      </div>
      <button
        type="submit"
        className="w-full rounded-xl bg-brand-primary py-3 font-semibold text-white transition-all hover:brightness-90 focus:outline-none focus:ring-2 focus:ring-brand-primary focus:ring-offset-2"
      >
        Cari Pesanan
      </button>
    </form>
  )
}

// Ikon kaca pembesar (search)
function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}
