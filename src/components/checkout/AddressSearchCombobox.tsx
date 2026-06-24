'use client'

// src/components/checkout/AddressSearchCombobox.tsx
// Combobox pencarian alamat ke API Mengantar (lewat proxy /api/mengantar).
// Perilaku: mulai fetch setelah ≥3 karakter, debounce 500ms, tampilkan loading/empty/error,
// dan hasil dalam format "Kelurahan, Kecamatan, Kota, Provinsi". Memanggil onSelect saat dipilih.
// Tanpa dependency eksternal — interaksi ditangani native React.

import { useEffect, useRef, useState } from 'react'
import { Search, Loader2, MapPin } from 'lucide-react'
import { searchAddress, toTitleCase, type MengantarAddress } from '@/lib/mengantar'

const MIN_CHARS = 3 // jumlah karakter minimal sebelum mulai mencari
const DEBOUNCE_MS = 500 // jeda sebelum menembak API agar tidak terlalu banyak request

// Menampilkan input pencarian alamat + panel hasil. onSelect dipanggil dengan alamat terpilih.
export default function AddressSearchCombobox({
  onSelect,
}: {
  onSelect: (address: MengantarAddress) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MengantarAddress[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hasSearched, setHasSearched] = useState(false) // sudah pernah dapat respons untuk keyword aktif?
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const keyword = query.trim()
  const tooShort = keyword.length < MIN_CHARS

  // Perbarui input. Reset hasil saat keyword < minimal ditangani di sini (bukan di effect)
  // agar tidak ada setState sinkron di badan effect.
  function handleChange(value: string) {
    setQuery(value)
    setOpen(true)
    if (value.trim().length < MIN_CHARS) {
      setResults([])
      setError('')
      setHasSearched(false)
    }
  }

  // === Debounce + fetch saat keyword ≥ minimal ===
  useEffect(() => {
    if (keyword.length < MIN_CHARS) return
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const data = await searchAddress(keyword, ctrl.signal)
        if (ctrl.signal.aborted) return
        setResults(data)
        setHasSearched(true)
      } catch {
        if (!ctrl.signal.aborted) {
          setError('Gagal mencari alamat. Coba lagi.')
          setResults([])
        }
      } finally {
        if (!ctrl.signal.aborted) setLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [keyword])

  // Tutup panel saat klik di luar komponen
  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  function handleSelect(address: MengantarAddress) {
    onSelect(address)
    setOpen(false)
  }

  // Panel hasil hanya relevan saat fokus & keyword cukup panjang
  const showPanel = open && !tooShort

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 transition focus-within:border-brand-primary focus-within:ring-2 focus-within:ring-brand-primary/30">
        <Search className="h-4 w-4 flex-none text-zinc-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Cari kelurahan, kecamatan, atau kota…"
          className="w-full bg-transparent py-2.5 text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none"
        />
        {loading && <Loader2 className="h-4 w-4 flex-none animate-spin text-zinc-400" />}
      </div>

      {/* Petunjuk minimal karakter */}
      {open && tooShort && keyword.length > 0 && (
        <p className="mt-1 text-xs text-zinc-400">Ketik minimal {MIN_CHARS} karakter untuk mencari.</p>
      )}

      {showPanel && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg">
          {error ? (
            <p className="px-3 py-3 text-sm text-red-500">{error}</p>
          ) : loading ? (
            <p className="flex items-center gap-2 px-3 py-3 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin text-brand-primary" />
              Mencari alamat…
            </p>
          ) : hasSearched && results.length === 0 ? (
            <p className="px-3 py-3 text-sm text-zinc-500">Alamat tidak ditemukan</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto py-1" role="listbox">
              {results.map((address) => (
                <li key={address._id} role="option" aria-selected={false}>
                  <button
                    type="button"
                    onClick={() => handleSelect(address)}
                    className="flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm text-zinc-700 transition hover:bg-brand-surface"
                  >
                    <MapPin className="mt-0.5 h-4 w-4 flex-none text-brand-primary" />
                    <span>
                      {/* Format: Kelurahan, Kecamatan, Kota, Provinsi */}
                      {toTitleCase(
                        `${address.SUBDISTRICT_NAME}, ${address.DISTRICT_NAME}, ${address.CITY_NAME}, ${address.PROVINCE_NAME}`,
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
