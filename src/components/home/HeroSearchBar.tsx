// src/components/home/HeroSearchBar.tsx
// Kolom pencarian hero dengan autocomplete: saat user mengetik, tampilkan daftar saran produk
// (dropdown) di bawah kolom — TIDAK langsung redirect/scroll. User memilih produk dari saran,
// lalu diarahkan ke halaman detail. Client Component (state, debounce, keyboard, klik di luar).

'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, Search, X } from 'lucide-react'
import type { Product } from '@/types/product'
import { formatRupiah } from '@/lib/format'
import { useDebounce } from '@/hooks/use-debounce'

// Jeda debounce (ms) sebelum daftar saran diperbarui
const DEBOUNCE_DELAY = 350
// Maksimal jumlah saran yang ditampilkan di dropdown
const MAX_SUGGESTIONS = 6

// Input pencarian produk dengan saran autocomplete. `products` = seluruh produk (OMS + dummy).
export default function HeroSearchBar({ products }: { products: Product[] }) {
  const router = useRouter()
  const containerRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false) // dropdown terbuka (input difokus & ada teks)
  const [activeIndex, setActiveIndex] = useState(-1) // saran yang sedang disorot (keyboard)

  // Debounce nilai ter-trim agar filter tak jalan tiap ketukan
  const debouncedQuery = useDebounce(query.trim(), DEBOUNCE_DELAY)
  // Sedang menunggu jeda debounce → tampilkan indikator loading
  const isSearching = query.trim().length > 0 && query.trim() !== debouncedQuery

  // === Logika filter (case-insensitive, cocokkan nama atau kategori) ===
  const suggestions = useMemo(() => {
    if (!debouncedQuery) return []
    const keyword = debouncedQuery.toLowerCase()
    return products
      .filter((product) => {
        const name = product.name.toLowerCase()
        const category = product.category.toLowerCase()
        // Cocokkan juga kategori tanpa tanda hubung (mis. "pupuk-nutrisi" → "pupuk nutrisi")
        return (
          name.includes(keyword) ||
          category.includes(keyword) ||
          category.replace(/-/g, ' ').includes(keyword)
        )
      })
      .slice(0, MAX_SUGGESTIONS)
  }, [products, debouncedQuery])

  // Dropdown tampil saat fokus & input terisi
  const showDropdown = open && query.trim().length > 0
  // Pesan kosong hanya setelah debounce selesai (bukan saat masih mengetik)
  const showEmpty = showDropdown && !isSearching && debouncedQuery.length > 0 && suggestions.length === 0

  // Tutup dropdown saat klik di luar komponen
  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [])

  // Arahkan ke halaman detail produk lalu tutup dropdown
  function goToProduct(id: string) {
    setOpen(false)
    router.push(`/produk/${id}`)
  }

  // Navigasi keyboard: panah untuk menyorot, Enter untuk memilih, Escape untuk menutup
  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!suggestions.length) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => (index + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1))
    } else if (event.key === 'Enter') {
      // Pilih yang disorot, atau saran teratas bila belum ada yang disorot
      const chosen = suggestions[activeIndex] ?? suggestions[0]
      if (chosen) {
        event.preventDefault()
        goToProduct(chosen.id)
      }
    }
  }

  return (
    <div ref={containerRef} className="relative max-w-xl">
      {/* === Kolom input === */}
      <div className="flex items-center gap-2 rounded-full border border-white/60 bg-white/70 px-5 py-3 shadow-md backdrop-blur-sm">
        <input
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
            setActiveIndex(-1) // reset sorotan tiap teks berubah (daftar saran ikut berubah)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Cari pupuk, benih, media tanam…"
          aria-label="Cari produk"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={listboxId}
          aria-autocomplete="list"
          className="w-full bg-transparent text-base text-zinc-700 placeholder:text-zinc-500 focus:outline-none"
        />

        {/* Ikon kanan kontekstual: spinner (loading) / hapus (X) / kaca pembesar */}
        {isSearching ? (
          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-brand-primary" aria-label="Mencari" />
        ) : query ? (
          <button
            type="button"
            onClick={() => {
              setQuery('')
              setOpen(false)
            }}
            aria-label="Hapus pencarian"
            className="shrink-0 rounded-full p-0.5 text-zinc-500 transition hover:bg-zinc-200/70 hover:text-zinc-700"
          >
            <X className="h-5 w-5" />
          </button>
        ) : (
          <Search className="h-5 w-5 shrink-0 text-zinc-600" aria-hidden />
        )}
      </div>

      {/* === Dropdown saran (autocomplete) === */}
      {showDropdown && (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-2xl border border-zinc-100 bg-white shadow-xl">
          {isSearching ? (
            // State loading
            <div className="flex items-center gap-2 px-4 py-4 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin text-brand-primary" aria-hidden />
              Mencari produk…
            </div>
          ) : showEmpty ? (
            // State hasil kosong
            <div className="px-4 py-6 text-center text-sm text-zinc-500" aria-live="polite">
              Produk yang Anda cari tidak ditemukan.
            </div>
          ) : (
            // State ada saran
            <ul id={listboxId} role="listbox" className="max-h-80 overflow-auto py-1">
              {suggestions.map((product, index) => (
                <li key={product.id} role="option" aria-selected={index === activeIndex}>
                  <Link
                    href={`/produk/${product.id}`}
                    onClick={() => setOpen(false)}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={`flex items-center gap-3 px-3 py-2 transition ${
                      index === activeIndex ? 'bg-brand-surface' : 'hover:bg-brand-surface'
                    }`}
                  >
                    {/* Thumbnail produk */}
                    <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-zinc-50">
                      {/* unoptimized karena imageUrl masih placeholder; hapus saat memakai foto asli */}
                      <Image src={product.imageUrl} alt="" fill unoptimized sizes="44px" className="object-cover" />
                    </span>
                    {/* Nama + harga */}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="line-clamp-1 text-sm font-medium text-zinc-800">{product.name}</span>
                      <span className="text-sm font-bold text-red-500">{formatRupiah(product.promoPrice)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
