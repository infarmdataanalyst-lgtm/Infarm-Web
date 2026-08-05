'use client'

// src/components/product/ProductCatalog.tsx
// Katalog produk (/products) dengan panel filter lengkap:
//   - Desktop (lg+): sidebar kiri (kategori multi-checkbox + rentang harga + tombol Terapkan).
//   - Mobile: baris kontrol (Filter, Urutkan, chip kategori aktif) → bottom-sheet untuk filter & sort.
//   - Sort (Terbaru / harga terendah / tertinggi) berlaku instan; filter kategori & harga staged
//     (baru berlaku saat "Terapkan"). Chip kategori aktif bisa dihapus (langsung berlaku).
// Data HANYA produk asli OMS (Supabase, /api/products/list) — tanpa dummy. Palet mengikuti brand.

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/react'
import { Filter, ArrowUpDown, X, ChevronDown, Check } from 'lucide-react'
import type { Product, StoredProduct } from '@/types/product'
import { PRODUCT_CATEGORIES, getCategoryLabel } from '@/lib/data/categories'
import ProductCard from '@/components/product/ProductCard'
import BottomSheet from '@/components/checkout/BottomSheet'

// Opsi pengurutan katalog
type SortKey = 'terbaru' | 'termurah' | 'termahal'
const SORTS: { value: SortKey; label: string }[] = [
  { value: 'terbaru', label: 'Terbaru' },
  { value: 'termurah', label: 'Harga Terendah' },
  { value: 'termahal', label: 'Harga Tertinggi' },
]

export default function ProductCatalog() {
  const searchParams = useSearchParams()

  // Sinkron URL tanpa memicu navigasi Next (hindari Suspense fallback / re-render yang
  // mengganggu animasi tutup bottom-sheet). URL tetap shareable/deep-link.
  function syncUrl(cats: string[]) {
    const href = cats.length ? `/products?category=${cats.join(',')}` : '/products'
    window.history.replaceState(null, '', href)
  }

  // Kategori awal dari URL (?category=a,b) → dukung deep-link dari beranda (slug tunggal juga jalan).
  const initialCategories = (searchParams.get('category') ?? '').split(',').filter(Boolean)

  // === Data produk OMS ===
  const [products, setProducts] = useState<StoredProduct[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    fetch('/api/products/list')
      .then((res) => res.json())
      .then((data: { products?: StoredProduct[] }) => {
        if (!active) return
        setProducts((data.products ?? []).filter((p) => !p.archived))
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  // === Filter TERPAKAI (dasar penyaringan) ===
  const [categories, setCategories] = useState<string[]>(initialCategories)
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [sort, setSort] = useState<SortKey>('terbaru')

  // === Draft filter (diedit di sidebar/sheet, berlaku saat "Terapkan") ===
  const [draftCategories, setDraftCategories] = useState<string[]>(initialCategories)
  const [draftMin, setDraftMin] = useState('')
  const [draftMax, setDraftMax] = useState('')

  // === State sheet mobile ===
  const [filterOpen, setFilterOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)

  // Toggle satu kategori di draft
  function toggleDraftCategory(slug: string) {
    setDraftCategories((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug],
    )
  }

  // Terapkan draft → filter terpakai (+ sinkron URL), tutup sheet
  function applyFilters() {
    setFilterOpen(false) // tutup sheet dulu agar animasi turun mulus
    setCategories(draftCategories)
    setMinPrice(draftMin)
    setMaxPrice(draftMax)
    syncUrl(draftCategories)
  }

  // Hapus satu kategori dari filter aktif (chip ×) — langsung berlaku
  function removeCategory(slug: string) {
    const next = categories.filter((s) => s !== slug)
    setCategories(next)
    setDraftCategories(next)
    syncUrl(next)
  }

  // Saat membuka sheet filter, samakan draft dengan filter terpakai
  function openFilterSheet() {
    setDraftCategories(categories)
    setDraftMin(minPrice)
    setDraftMax(maxPrice)
    setFilterOpen(true)
  }

  // === Produk hasil filter + sort ===
  const visible = useMemo(() => {
    const min = minPrice ? Number(minPrice) : undefined
    const max = maxPrice ? Number(maxPrice) : undefined
    let list = products.filter((p) => {
      if (categories.length && !categories.includes(p.category)) return false
      if (min !== undefined && p.promoPrice < min) return false
      if (max !== undefined && p.promoPrice > max) return false
      return true
    })
    list = [...list].sort((a, b) => {
      if (sort === 'termurah') return a.promoPrice - b.promoPrice
      if (sort === 'termahal') return b.promoPrice - a.promoPrice
      // terbaru: createdAt desc (string ISO → perbandingan aman)
      return (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
    })
    return list as Product[]
  }, [products, categories, minPrice, maxPrice, sort])

  const heading =
    categories.length === 1 ? getCategoryLabel(categories[0]) ?? 'Semua Produk' : 'Semua Produk'

  return (
    <div className="mx-auto flex w-full max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:px-8">
      {/* === Sidebar filter (desktop lg+) === */}
      <aside className="hidden w-64 shrink-0 lg:block">
        <div className="sticky top-20 rounded-2xl border border-zinc-100 bg-white p-5 shadow-sm">
          <FilterBody
            draftCategories={draftCategories}
            onToggleCategory={toggleDraftCategory}
            draftMin={draftMin}
            draftMax={draftMax}
            setDraftMin={setDraftMin}
            setDraftMax={setDraftMax}
            onApply={applyFilters}
          />
        </div>
      </aside>

      {/* === Konten utama === */}
      <section className="min-w-0 flex-1">
        {/* Baris kontrol mobile (Filter + Urutkan + chip) — disembunyikan di desktop */}
        <div className="mb-4 flex flex-wrap items-center gap-2 lg:hidden">
          <button
            type="button"
            onClick={openFilterSheet}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 transition active:scale-95"
          >
            <Filter className="h-4 w-4" /> Filter
          </button>
          <button
            type="button"
            onClick={() => setSortOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 transition active:scale-95"
          >
            <ArrowUpDown className="h-4 w-4" /> Urutkan
          </button>
          {/* Chip kategori aktif (bisa dihapus) */}
          {categories.map((slug) => (
            <CategoryChip key={slug} slug={slug} onRemove={() => removeCategory(slug)} />
          ))}
        </div>

        {/* Judul + jumlah + sort dropdown (desktop) */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-brand-primary sm:text-3xl">{heading}</h1>
            <p className="mt-1 text-sm text-zinc-500">
              {loading
                ? 'Memuat produk…'
                : // "{n} produk" + " · {Kategori}" bila TEPAT satu kategori aktif (label rapi, bukan slug).
                  // Multi-kategori/filter lain cukup terlihat dari state UI filter → tak ditambah ke label.
                  `${visible.length} produk${
                    categories.length === 1 ? ` · ${getCategoryLabel(categories[0]) ?? ''}` : ''
                  }`}
            </p>
          </div>
          {/* Sort dropdown — hanya desktop (mobile pakai tombol Urutkan). Custom Listbox (Headless UI)
              agar highlight opsi ikut tema hijau, bukan biru native <select>. */}
          <div className="hidden shrink-0 lg:block">
            <Listbox value={sort} onChange={setSort}>
              {/* Trigger: pertahankan gaya lama (border, rounded, chevron kanan) */}
              <ListboxButton className="relative rounded-xl border border-zinc-200 bg-white py-2 pl-4 pr-9 text-left text-sm font-semibold text-zinc-700 focus:border-brand-primary focus:outline-none">
                Urutkan: {SORTS.find((s) => s.value === sort)?.label}
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              </ListboxButton>
              {/* Panel: putih, border tipis, rounded, shadow + transisi fade/scale */}
              <ListboxOptions
                anchor="bottom end"
                transition
                className="z-50 mt-2 w-56 origin-top rounded-xl border border-zinc-100 bg-white p-1 shadow-lg transition duration-150 ease-out [--anchor-gap:4px] focus:outline-none data-[closed]:scale-95 data-[closed]:opacity-0"
              >
                {SORTS.map((s) => (
                  <ListboxOption
                    key={s.value}
                    value={s.value}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm text-zinc-700 transition-colors data-[focus]:bg-brand-surface data-[selected]:bg-brand-primary data-[selected]:text-white"
                  >
                    {({ selected }) => (
                      <>
                        <span>Urutkan: {s.label}</span>
                        {selected && <Check className="h-4 w-4 shrink-0" />}
                      </>
                    )}
                  </ListboxOption>
                ))}
              </ListboxOptions>
            </Listbox>
          </div>
        </div>

        {/* Chip kategori aktif (desktop, di bawah judul) */}
        {categories.length > 0 && (
          <div className="mt-3 hidden flex-wrap gap-2 lg:flex">
            {categories.map((slug) => (
              <CategoryChip key={slug} slug={slug} onRemove={() => removeCategory(slug)} />
            ))}
          </div>
        )}

        {/* Grid produk */}
        {visible.length > 0 ? (
          <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {visible.map((product) => (
              <li key={product.id}>
                <ProductCard product={product} />
              </li>
            ))}
          </ul>
        ) : (
          !loading && (
            <p className="py-16 text-center text-sm text-zinc-400">
              Tidak ada produk yang cocok dengan filter.
            </p>
          )
        )}
      </section>

      {/* === Bottom-sheet FILTER (mobile) === */}
      <BottomSheet open={filterOpen} onClose={() => setFilterOpen(false)}>
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
          <h2 className="text-lg font-bold text-zinc-900">Filter</h2>
          <button type="button" aria-label="Tutup" onClick={() => setFilterOpen(false)} className="rounded-full p-1 text-zinc-400 hover:bg-zinc-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          <FilterBody
            draftCategories={draftCategories}
            onToggleCategory={toggleDraftCategory}
            draftMin={draftMin}
            draftMax={draftMax}
            setDraftMin={setDraftMin}
            setDraftMax={setDraftMax}
            onApply={applyFilters}
          />
        </div>
      </BottomSheet>

      {/* === Bottom-sheet SORT (mobile) === */}
      <BottomSheet open={sortOpen} onClose={() => setSortOpen(false)}>
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
          <h2 className="text-lg font-bold text-zinc-900">Urutkan</h2>
          <button type="button" aria-label="Tutup" onClick={() => setSortOpen(false)} className="rounded-full p-1 text-zinc-400 hover:bg-zinc-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <ul className="px-2 py-2">
          {SORTS.map((s) => (
            <li key={s.value}>
              <button
                type="button"
                onClick={() => {
                  setSort(s.value)
                  setSortOpen(false)
                }}
                className="flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-sm font-medium text-zinc-700 transition hover:bg-brand-surface"
              >
                {s.label}
                {sort === s.value && <Check className="h-4 w-4 text-brand-primary" />}
              </button>
            </li>
          ))}
        </ul>
      </BottomSheet>
    </div>
  )
}

// === Sub-komponen ===

// Isi form filter (kategori multi-checkbox + rentang harga + tombol Terapkan).
// Dipakai bersama oleh sidebar desktop & bottom-sheet mobile.
function FilterBody({
  draftCategories,
  onToggleCategory,
  draftMin,
  draftMax,
  setDraftMin,
  setDraftMax,
  onApply,
}: {
  draftCategories: string[]
  onToggleCategory: (slug: string) => void
  draftMin: string
  draftMax: string
  setDraftMin: (v: string) => void
  setDraftMax: (v: string) => void
  onApply: () => void
}) {
  // Hanya angka untuk input harga
  const onlyDigits = (v: string) => v.replace(/[^0-9]/g, '')

  return (
    <div>
      {/* Kategori */}
      <h3 className="text-base font-bold text-zinc-900">Kategori</h3>
      <ul className="mt-3 space-y-2.5">
        {/* "Semua" = tak ada kategori terpilih */}
        <li>
          <label className="flex cursor-pointer items-center gap-3 text-sm text-zinc-700">
            <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center">
              <input
                type="checkbox"
                checked={draftCategories.length === 0}
                onChange={() => draftCategories.forEach((s) => onToggleCategory(s))}
                className="peer h-4 w-4 cursor-pointer appearance-none rounded border border-zinc-300 checked:border-brand-primary checked:bg-brand-primary"
              />
              <Check className="pointer-events-none absolute h-3 w-3 text-white opacity-0 peer-checked:opacity-100" strokeWidth={3} />
            </span>
            Semua
          </label>
        </li>
        {PRODUCT_CATEGORIES.map((cat) => {
          const checked = draftCategories.includes(cat.slug)
          return (
            <li key={cat.slug}>
              <label
                className={`flex cursor-pointer items-center gap-3 text-sm ${
                  checked ? 'font-semibold text-brand-primary' : 'text-zinc-700'
                }`}
              >
                <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggleCategory(cat.slug)}
                    className="peer h-4 w-4 cursor-pointer appearance-none rounded border border-zinc-300 checked:border-brand-primary checked:bg-brand-primary"
                  />
                  <Check className="pointer-events-none absolute h-3 w-3 text-white opacity-0 peer-checked:opacity-100" strokeWidth={3} />
                </span>
                {cat.label}
              </label>
            </li>
          )
        })}
      </ul>

      {/* Rentang harga */}
      <h3 className="mt-6 text-base font-bold text-zinc-900">Rentang harga</h3>
      <div className="mt-3 flex items-center gap-2">
        <input
          type="text"
          inputMode="numeric"
          value={draftMin}
          onChange={(e) => setDraftMin(onlyDigits(e.target.value))}
          placeholder="Min"
          className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 placeholder:text-zinc-400 focus:border-brand-primary focus:outline-none"
        />
        <span className="text-zinc-400">–</span>
        <input
          type="text"
          inputMode="numeric"
          value={draftMax}
          onChange={(e) => setDraftMax(onlyDigits(e.target.value))}
          placeholder="Maks"
          className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 placeholder:text-zinc-400 focus:border-brand-primary focus:outline-none"
        />
      </div>

      {/* Terapkan */}
      <button
        type="button"
        onClick={onApply}
        className="mt-6 w-full rounded-xl bg-brand-primary px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:brightness-90 active:scale-[0.99]"
      >
        Terapkan filter
      </button>
    </div>
  )
}

// Chip kategori aktif dengan tombol hapus (×)
function CategoryChip({ slug, onRemove }: { slug: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-primary bg-brand-surface px-3 py-1.5 text-sm font-semibold text-brand-primary">
      {getCategoryLabel(slug) ?? slug}
      <button type="button" aria-label={`Hapus filter ${getCategoryLabel(slug) ?? slug}`} onClick={onRemove} className="transition hover:opacity-70">
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
  )
}
