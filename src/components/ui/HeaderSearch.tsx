'use client'

// src/components/ui/HeaderSearch.tsx
// Search bar autocomplete PERSISTEN di header (dulu di hero). Muncul di semua halaman store.
// Desktop (sm+): input inline penuh di tengah header. Mobile: hanya ikon kaca pembesar → tap
// membuka overlay full-width menutupi baris header (tombol kembali + input + dropdown).
// Saran diambil on-type dari server (GET /api/products/search) — payload ringan. Client Component
// (state, debounce, keyboard, klik-luar, toggle overlay mobile).

import { useEffect, useId, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, Search, X } from 'lucide-react'
import type { Product } from '@/types/product'
import { formatRupiah } from '@/lib/format'
import { useDebounce } from '@/hooks/use-debounce'

// Jeda debounce (ms) sebelum saran diambil dari server
const DEBOUNCE_DELAY = 350
const PLACEHOLDER = 'Cari pupuk, benih, media tanam…'

// Search bar header dengan autocomplete + mode overlay mobile.
export default function HeaderSearch() {
  const router = useRouter()
  const containerRef = useRef<HTMLDivElement>(null)
  const overlayInputRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false) // dropdown saran terbuka
  const [expanded, setExpanded] = useState(false) // overlay search mobile terbuka
  const [activeIndex, setActiveIndex] = useState(-1) // saran tersorot (keyboard)
  const [suggestions, setSuggestions] = useState<Product[]>([])
  const [fetching, setFetching] = useState(false)

  const debouncedQuery = useDebounce(query.trim(), DEBOUNCE_DELAY)
  const isSearching = (query.trim().length > 0 && query.trim() !== debouncedQuery) || fetching

  // === Ambil saran dari server saat query (ter-debounce) berubah ===
  // AbortController membatalkan request lama agar hasil basi tak menimpa hasil terbaru (race).
  useEffect(() => {
    if (!debouncedQuery) {
      setSuggestions([])
      setFetching(false)
      return
    }
    const controller = new AbortController()
    setFetching(true)
    fetch(`/api/products/search?q=${encodeURIComponent(debouncedQuery)}`, { signal: controller.signal })
      .then((res) => res.json())
      .then((data: { products?: Product[] }) => {
        setSuggestions(data.products ?? [])
        setActiveIndex(-1)
      })
      .catch(() => {
        // Abort (query berubah) diabaikan; error lain → kosongkan saran
      })
      .finally(() => setFetching(false))
    return () => controller.abort()
  }, [debouncedQuery])

  const showDropdown = open && query.trim().length > 0
  const showEmpty = showDropdown && !isSearching && debouncedQuery.length > 0 && suggestions.length === 0

  // Tutup dropdown saat klik di luar komponen (desktop)
  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [])

  // Fokuskan input overlay saat mobile search dibuka
  useEffect(() => {
    if (expanded) overlayInputRef.current?.focus()
  }, [expanded])

  // Arahkan ke detail produk lalu tutup dropdown & overlay
  function goToProduct(id: string) {
    setOpen(false)
    setExpanded(false)
    router.push(`/produk/${id}`)
  }

  // Tutup overlay mobile (reset dropdown)
  function closeOverlay() {
    setExpanded(false)
    setOpen(false)
  }

  // Navigasi keyboard: panah sorot, Enter pilih, Escape tutup
  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false)
      if (expanded) closeOverlay()
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
      const chosen = suggestions[activeIndex] ?? suggestions[0]
      if (chosen) {
        event.preventDefault()
        goToProduct(chosen.id)
      }
    }
  }

  // Props input yang dipakai bersama oleh varian desktop & overlay mobile
  const commonInputProps = {
    type: 'text' as const,
    value: query,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      setQuery(event.target.value)
      setOpen(true)
      setActiveIndex(-1)
    },
    onFocus: () => setOpen(true),
    onKeyDown: handleKeyDown,
    placeholder: PLACEHOLDER,
    'aria-label': 'Cari produk',
    role: 'combobox' as const,
    'aria-expanded': showDropdown,
    'aria-controls': listboxId,
    'aria-autocomplete': 'list' as const,
  }

  // Trigger pencarian dari ikon kanan (desktop): buka/pilih saran teratas bila ada.
  function triggerSearch() {
    if (suggestions[0]) goToProduct(suggestions[0].id)
    else setOpen(true)
  }

  // Ikon kanan kontekstual: spinner / hapus / kaca pembesar
  function TrailingIcon() {
    if (isSearching) {
      return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand-primary" aria-label="Mencari" />
    }
    if (query) {
      return (
        <button
          type="button"
          onClick={() => {
            setQuery('')
            setOpen(false)
          }}
          aria-label="Hapus pencarian"
          className="shrink-0 rounded-full p-0.5 text-zinc-500 transition hover:bg-zinc-200/70 hover:text-zinc-700"
        >
          <X className="h-4 w-4" />
        </button>
      )
    }
    return <Search className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
  }

  // Dropdown saran (dipakai desktop & overlay). Absolute terhadap kontainer relative pembungkus.
  function Dropdown() {
    if (!showDropdown) return null
    return (
      <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-2xl border border-zinc-100 bg-white shadow-xl">
        {isSearching ? (
          <div className="flex items-center gap-2 px-4 py-4 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin text-brand-primary" aria-hidden />
            Mencari produk…
          </div>
        ) : showEmpty ? (
          <div className="px-4 py-6 text-center text-sm text-zinc-500" aria-live="polite">
            Produk yang Anda cari tidak ditemukan.
          </div>
        ) : (
          <ul id={listboxId} role="listbox" className="max-h-80 overflow-auto py-1">
            {suggestions.map((product, index) => (
              <li key={product.id} role="option" aria-selected={index === activeIndex}>
                <Link
                  href={`/produk/${product.id}`}
                  onClick={() => {
                    setOpen(false)
                    setExpanded(false)
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`flex items-center gap-3 px-3 py-2 transition ${
                    index === activeIndex ? 'bg-brand-surface' : 'hover:bg-brand-surface'
                  }`}
                >
                  <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-zinc-50">
                    <Image src={product.imageUrl} alt="" fill unoptimized sizes="44px" className="object-cover" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="line-clamp-1 text-sm font-medium text-zinc-800">{product.name}</span>
                    <span className="text-sm font-bold text-brand-primary">{formatRupiah(product.promoPrice)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex flex-1 items-center sm:mx-4">
      {/* === Desktop: input inline (menyatu warna header) === */}
      {/* bg putih transparan (white/15) tanpa border → menyatu dgn header hijau. Teks putih.
          Placeholder rata kiri; ikon search di KANAN (trigger). Padding 8px/14px, pill radius 20px. */}
      <div className="relative hidden w-full max-w-[320px] sm:ml-auto sm:block">
        <div className="flex items-center justify-between gap-2 rounded-[20px] bg-white/15 px-3.5 py-2">
          <input
            {...commonInputProps}
            className="w-full bg-transparent text-sm text-white caret-white placeholder:text-white/85 focus:outline-none"
          />
          {/* Ikon kanan: spinner saat mencari, selain itu tombol search (putih 16px) */}
          {isSearching ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white/90" aria-label="Mencari" />
          ) : (
            <button
              type="button"
              onClick={triggerSearch}
              aria-label="Cari"
              className="shrink-0 text-white transition active:scale-90"
            >
              <Search className="h-4 w-4" />
            </button>
          )}
        </div>
        <Dropdown />
      </div>

      {/* === Mobile: tombol ikon (buka overlay) === */}
      <button
        type="button"
        aria-label="Cari"
        onClick={() => setExpanded(true)}
        className="ml-auto rounded-md p-1 transition active:scale-95 sm:hidden"
      >
        <Search className="h-6 w-6" />
      </button>

      {/* === Mobile: overlay search full-width menutupi baris header === */}
      {expanded && (
        <div className="fixed inset-0 z-[60] flex flex-col sm:hidden">
          {/* Baris search menggantikan header */}
          <div className="relative flex h-14 items-center gap-2 border-b border-black/5 bg-brand-header px-3 shadow-sm">
            <button
              type="button"
              aria-label="Tutup pencarian"
              onClick={closeOverlay}
              className="rounded-md p-1 text-zinc-800 transition active:scale-95"
            >
              <ArrowLeft className="h-6 w-6" />
            </button>
            <div className="relative flex-1">
              <div className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 shadow-sm">
                <input
                  {...commonInputProps}
                  ref={overlayInputRef}
                  className="w-full bg-transparent text-sm text-zinc-700 placeholder:text-zinc-500 focus:outline-none"
                />
                <TrailingIcon />
              </div>
              <Dropdown />
            </div>
          </div>
          {/* Backdrop bawah: tap untuk menutup */}
          <button aria-hidden tabIndex={-1} onClick={closeOverlay} className="flex-1 bg-black/20" />
        </div>
      )}
    </div>
  )
}
