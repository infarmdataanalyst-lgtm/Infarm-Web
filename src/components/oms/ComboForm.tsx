'use client'

// src/components/oms/ComboForm.tsx
// Form bersama untuk Buat & Edit paket/combo OMS.
// - mode 'create' → POST /api/combos/create ; mode 'edit' → PATCH /api/combos/update
// - Produk dipilih dari /api/products/list (hanya stok > 0 & tidak diarsipkan)
// - Harga Normal & Hemat dihitung otomatis; validasi ditampilkan inline di tiap field
// Mengikuti tema emerald & pola form OMS (OmsHeader, breadcrumb, sticky footer).

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronRight, Search, Plus, Trash2 } from 'lucide-react'
import OmsHeader from '@/components/oms/OmsHeader'
import { formatRupiah } from '@/lib/format'
import { calcNormalPrice, type ComboItem, type ProductCombo } from '@/types/combo'
import type { StoredProduct } from '@/types/product'

type Mode = 'create' | 'edit'

export default function ComboForm({
  mode,
  initialCombo,
}: {
  mode: Mode
  initialCombo?: ProductCombo
}) {
  const router = useRouter()

  // === State form (controlled) ===
  const [name, setName] = useState(initialCombo?.name ?? '')
  const [isActive, setIsActive] = useState(initialCombo?.isActive ?? true)
  const [items, setItems] = useState<ComboItem[]>(initialCombo?.items ?? [])
  const [comboPrice, setComboPrice] = useState<number | ''>(initialCombo?.comboPrice ?? '')

  // === State produk (sumber pilihan) ===
  const [products, setProducts] = useState<StoredProduct[]>([])
  const [query, setQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [productNotice, setProductNotice] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // === State submit ===
  const [attempted, setAttempted] = useState(false) // true setelah tombol simpan ditekan sekali
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Ambil produk dari mock DB (Supabase). Hanya yang stok > 0 & tidak diarsipkan yang boleh dipilih.
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

  // === Kalkulasi harga (otomatis) ===
  const normalPrice = useMemo(() => calcNormalPrice(items), [items])
  const comboPriceNum = comboPrice === '' ? 0 : comboPrice
  const savings = Math.max(0, normalPrice - comboPriceNum)
  const savingsPercent = normalPrice > 0 ? Math.round((savings / normalPrice) * 100) : 0

  // === Hasil pencarian produk (kecualikan yang sudah ditambahkan) ===
  const selectedIds = useMemo(() => new Set(items.map((i) => i.productId)), [items])
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase()
    return products
      .filter((p) => p.stock > 0 && !p.archived && !selectedIds.has(p.id))
      .filter((p) => (q ? p.name.toLowerCase().includes(q) : true))
      .slice(0, 8)
  }, [products, query, selectedIds])

  // === Validasi (inline) ===
  const nameError = name.trim().length < 3 ? 'Nama combo wajib diisi minimal 3 karakter.' : null
  const itemsError = items.length < 2 ? 'Minimal 2 produk wajib ditambahkan.' : null
  const comboPriceError =
    comboPrice === '' || comboPriceNum <= 0
      ? 'Harga combo wajib diisi.'
      : comboPriceNum >= normalPrice
        ? 'Harga combo harus lebih murah dari total harga satuan'
        : null

  // === Aksi item ===

  // Menambahkan produk ke combo (default quantity 1). Tolak bila sudah ada.
  function addProduct(product: StoredProduct) {
    if (selectedIds.has(product.id)) {
      setProductNotice('Produk sudah ditambahkan')
      return
    }
    setItems((prev) => [
      ...prev,
      { productId: product.id, name: product.name, unitPrice: product.promoPrice, quantity: 1 },
    ])
    setProductNotice(null)
    setQuery('')
    searchRef.current?.focus()
  }

  function removeItem(productId: string) {
    setItems((prev) => prev.filter((i) => i.productId !== productId))
  }

  function updateQuantity(productId: string, quantity: number) {
    setItems((prev) =>
      prev.map((i) => (i.productId === productId ? { ...i, quantity: Math.max(1, quantity) } : i)),
    )
  }

  // === Simpan ===
  async function handleSave() {
    setAttempted(true)
    setSubmitError(null)

    // Hentikan bila ada error inline
    if (nameError || itemsError || comboPriceError) return

    setSaving(true)
    const payload = {
      name: name.trim(),
      isActive,
      comboPrice: comboPriceNum,
      items,
      ...(mode === 'edit' && initialCombo ? { id: initialCombo.id } : {}),
    }

    try {
      const res = await fetch(mode === 'create' ? '/api/combos/create' : '/api/combos/update', {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? 'Gagal menyimpan combo.')
      }
      // Sukses → kembali ke daftar combo dengan flag toast
      router.push(`/oms/dashboard/paket-combo?toast=${mode === 'create' ? 'created' : 'updated'}`)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Gagal menyimpan combo.')
      setSaving(false)
    }
  }

  const isEdit = mode === 'edit'

  return (
    <>
      <OmsHeader title="Paket & Combo" notificationCount={3} />

      {/* pb-28 memberi ruang agar konten tidak tertutup footer sticky */}
      <main className="p-6 pb-28 md:p-8 md:pb-28">
        {/* === Breadcrumbs === */}
        <nav className="flex items-center gap-1.5 text-sm text-gray-400">
          <Link href="/oms/dashboard/paket-combo" className="hover:text-gray-600">
            Paket &amp; Combo
          </Link>
          <ChevronRight className="h-4 w-4" />
          <span className="font-medium text-gray-600">{isEdit ? 'Edit Combo' : 'Buat Combo Baru'}</span>
        </nav>

        {/* === Judul === */}
        <div className="mt-2">
          <h2 className="text-2xl font-bold text-gray-900">{isEdit ? 'Edit Combo' : 'Buat Combo Baru'}</h2>
          <p className="mt-1 text-sm text-gray-500">
            Gabungkan beberapa produk menjadi satu paket hemat untuk ditawarkan ke pelanggan.
          </p>
        </div>

        <div className="mx-auto mt-6 max-w-3xl space-y-6">
          {/* --- Seksi 1: Informasi Combo --- */}
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="text-base font-bold text-gray-900">Informasi Combo</h3>

            <div className="mt-5">
              <Field label="Nama Combo" error={attempted ? nameError : null}>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Contoh: Paket Berkebun Pemula"
                  className={inputClass}
                />
              </Field>
            </div>

            <div className="mt-5">
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Status</label>
              <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
                <button
                  type="button"
                  onClick={() => setIsActive(true)}
                  className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${
                    isActive ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Aktif
                </button>
                <button
                  type="button"
                  onClick={() => setIsActive(false)}
                  className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${
                    !isActive ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Nonaktif
                </button>
              </div>
            </div>
          </section>

          {/* --- Seksi 2: Produk dalam Combo --- */}
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-gray-900">Produk dalam Combo</h3>
              <button
                type="button"
                onClick={() => searchRef.current?.focus()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50"
              >
                <Plus className="h-3.5 w-3.5" />
                Tambah Produk
              </button>
            </div>

            {/* Searchable dropdown */}
            <div className="relative mt-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setTimeout(() => setSearchFocused(false), 120)}
                  placeholder="Cari produk untuk ditambahkan…"
                  className={`${inputClass} pl-10`}
                />
              </div>

              {/* Daftar hasil pencarian (muncul saat input fokus) */}
              {searchFocused && (
                <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                  {searchResults.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-gray-400">
                      {products.length === 0
                        ? 'Belum ada produk. Tambahkan produk dulu di menu Produk.'
                        : 'Tidak ada produk cocok (atau semua sudah ditambahkan / stok habis).'}
                    </p>
                  ) : (
                    searchResults.map((p) => (
                      // onMouseDown agar terpilih sebelum input kehilangan fokus (blur)
                      <button
                        key={p.id}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          addProduct(p)
                        }}
                        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition hover:bg-emerald-50"
                      >
                        <span className="truncate text-sm font-medium text-gray-800">{p.name}</span>
                        <span className="flex-none text-xs text-gray-500">
                          {formatRupiah(p.promoPrice)} · stok {p.stock}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {productNotice && <p className="mt-2 text-xs font-medium text-amber-600">{productNotice}</p>}

            {/* Baris produk terpilih */}
            <div className="mt-4 space-y-3">
              {items.length === 0 ? (
                <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-400">
                  Belum ada produk. Tambahkan minimal 2 produk untuk membentuk combo.
                </p>
              ) : (
                items.map((item) => (
                  <div
                    key={item.productId}
                    className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50/60 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900">{item.name}</p>
                      <p className="text-xs text-gray-500">{formatRupiah(item.unitPrice)} / item</p>
                    </div>
                    {/* Quantity */}
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-gray-500">Qty</label>
                      <input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) =>
                          updateQuantity(item.productId, e.target.value === '' ? 1 : Number(e.target.value))
                        }
                        className="w-16 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-center text-sm text-gray-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                      />
                    </div>
                    {/* Subtotal */}
                    <p className="w-24 flex-none text-right text-sm font-semibold text-gray-700">
                      {formatRupiah(item.unitPrice * item.quantity)}
                    </p>
                    {/* Hapus */}
                    <button
                      type="button"
                      onClick={() => removeItem(item.productId)}
                      aria-label={`Hapus ${item.name}`}
                      className="flex-none rounded-lg border border-red-200 bg-white p-2 text-red-600 transition hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))
              )}
            </div>

            {attempted && itemsError && (
              <p className="mt-3 text-xs font-medium text-red-600">{itemsError}</p>
            )}
          </section>

          {/* --- Seksi 3: Ringkasan Harga --- */}
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="text-base font-bold text-gray-900">Ringkasan Harga</h3>

            <div className="mt-5 space-y-4">
              {/* Harga Normal (read-only, otomatis) */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Harga Normal (total satuan)</span>
                <span className="text-sm font-semibold text-gray-900">{formatRupiah(normalPrice)}</span>
              </div>

              {/* Harga Combo (input) */}
              <Field label="Harga Combo" error={comboPrice !== '' || attempted ? comboPriceError : null}>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center border-r border-gray-200 px-3 text-sm font-medium text-gray-500">
                    Rp
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={comboPrice}
                    onChange={(e) =>
                      setComboPrice(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))
                    }
                    placeholder="0"
                    className={`${inputClass} pl-12`}
                  />
                </div>
              </Field>

              {/* Hemat (read-only, otomatis) */}
              <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-4 py-3">
                <span className="text-sm font-medium text-emerald-800">Hemat</span>
                <span className="text-sm font-bold text-emerald-700">
                  {formatRupiah(savings)} {savingsPercent > 0 && `(${savingsPercent}%)`}
                </span>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* === Footer Sticky === */}
      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white px-6 py-3.5 md:left-64">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {submitError ? (
            <p className="text-xs font-medium text-red-600">{submitError}</p>
          ) : (
            <p className="flex items-center gap-2 text-xs text-gray-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Harga normal &amp; hemat dihitung otomatis dari produk yang dipilih.
            </p>
          )}
          <div className="flex items-center gap-3">
            <Link
              href="/oms/dashboard/paket-combo"
              className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50"
            >
              Batal
            </Link>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {saving ? 'Menyimpan…' : isEdit ? 'Simpan Perubahan' : 'Simpan Combo'}
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

// Wrapper label + field + pesan error inline
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
