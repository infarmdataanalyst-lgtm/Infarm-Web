'use client'

// src/components/oms/ComboForm.tsx
// Form bersama untuk Buat & Edit paket/combo OMS.
// - mode 'create' → POST /api/combos/create ; mode 'edit' → PATCH /api/combos/update
// - Produk dipilih dari /api/products/list (hanya stok > 0 & tidak diarsipkan)
// - Validasi ditampilkan inline di tiap field
// Mengikuti tema emerald & pola form OMS (OmsHeader, breadcrumb, sticky footer).
//
// ── Dua section produk, bukan satu daftar (2026-09-18) ──
// Kiri PRODUK UTAMA: penentu paket ini tayang di halaman detail produk yang mana. Satu paket = satu
// pintu masuk, jadi produk pasangan yang marginnya tipis tak ikut terpajang di halaman produk
// bermargin tebal. Kanan PRODUK YANG DICOMBOKAN: pasangannya.
//
// ── Harga paket tidak diketik lagi ──
// Admin mengisi harga tiap produk DI DALAM paket; harga paket adalah hasil penjumlahannya. Dengan
// begitu potongan bisa ditumpuk di produk bermargin tebal, bukan dibagi rata ke semua produk
// seperti pembagian proporsional yang lama. Server menghitung ulang angka ini dari item yang sama
// (validateComboInput) — layar tidak pernah jadi sumber harga.

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronRight, Search, Star, Trash2 } from 'lucide-react'
import OmsHeader from '@/components/oms/OmsHeader'
import { formatRupiah } from '@/lib/format'
import {
  calcComboPrice,
  calcNormalPrice,
  hasDealPrices,
  type ComboItem,
  type ProductCombo,
} from '@/types/combo'
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

  // === State produk (sumber pilihan) ===
  const [products, setProducts] = useState<StoredProduct[]>([])
  const [productNotice, setProductNotice] = useState<string | null>(null)
  const utamaSearchRef = useRef<HTMLInputElement>(null)
  const comboSearchRef = useRef<HTMLInputElement>(null)

  // === State submit ===
  const [attempted, setAttempted] = useState(false) // true setelah tombol simpan ditekan sekali
  const [touchedName, setTouchedName] = useState(false)
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

  // === Pembagian dua section ===
  const primary = useMemo(() => items.find((i) => i.isPrimary) ?? null, [items])
  const companions = useMemo(() => items.filter((i) => !i.isPrimary), [items])

  // === Kalkulasi harga (otomatis, reactive) ===
  const normalPrice = useMemo(() => calcNormalPrice(items), [items])
  // Harga paket = jumlah harga per produk. 0 selama masih ada baris yang harganya kosong.
  const comboPrice = useMemo(() => calcComboPrice(items), [items])
  const priceFilled = hasDealPrices(items)
  const savings = priceFilled ? Math.max(0, normalPrice - comboPrice) : 0
  const savingsPercent = normalPrice > 0 ? Math.round((savings / normalPrice) * 100) : 0

  // === Validasi (inline) ===
  const trimmedName = name.trim()
  const nameError = !trimmedName
    ? 'Nama combo tidak boleh kosong'
    : trimmedName.length < 3
      ? 'Nama combo minimal 3 karakter'
      : trimmedName.length > 100
        ? 'Nama combo maksimal 100 karakter'
        : null
  const utamaError = !primary ? 'Pilih satu produk utama' : null
  const companionError =
    companions.length < 1 ? 'Tambahkan minimal satu produk yang dicombokan' : null
  const priceError = !priceFilled
    ? items.length > 0
      ? 'Isi harga paket untuk semua produk'
      : null
    : comboPrice < 100
      ? 'Total harga paket minimal Rp 100'
      : normalPrice > 0 && comboPrice >= normalPrice
        ? 'Total harga paket harus lebih murah dari harga gabungan'
        : null

  // Form valid → gating tombol simpan
  const isValid = !nameError && !utamaError && !companionError && !priceError

  // === Aksi item ===

  // Menambahkan produk. `asPrimary` menentukan ia masuk section kiri atau kanan.
  // Harga paket awal = harga jual normalnya; admin tinggal menurunkannya.
  function addProduct(product: StoredProduct, asPrimary: boolean) {
    if (product.archived) {
      setProductNotice('Produk ini sudah diarsipkan, tidak bisa ditambahkan')
      return
    }
    if (items.some((i) => i.productId === product.id)) {
      setProductNotice('Produk sudah ada dalam combo ini')
      return
    }
    setItems((prev) => [
      // Produk utama lama turun jadi produk pasangan, bukan terhapus — menukar produk utama tak
      // boleh diam-diam membuang barang yang sudah disusun admin.
      ...(asPrimary ? prev.map((i) => ({ ...i, isPrimary: false })) : prev),
      {
        productId: product.id,
        name: product.name,
        unitPrice: product.promoPrice,
        quantity: 1,
        isPrimary: asPrimary,
        dealPrice: product.promoPrice,
      },
    ])
    setProductNotice(null)
  }

  // Menjadikan produk pasangan sebagai produk utama (yang lama turun jadi pasangan).
  function setPrimary(productId: string) {
    setItems((prev) => prev.map((i) => ({ ...i, isPrimary: i.productId === productId })))
  }

  // Menghapus produk. Produk utama yang dihapus TIDAK otomatis digantikan: section kiri kembali
  // kosong dan form menolak disimpan, supaya penggantinya dipilih sadar, bukan ditebak sistem.
  function removeItem(productId: string) {
    setItems((prev) => prev.filter((i) => i.productId !== productId))
  }

  function updateQuantity(productId: string, quantity: number) {
    setItems((prev) =>
      prev.map((i) => (i.productId === productId ? { ...i, quantity: Math.max(1, quantity) } : i)),
    )
  }

  function updateDealPrice(productId: string, dealPrice: number | null) {
    setItems((prev) => prev.map((i) => (i.productId === productId ? { ...i, dealPrice } : i)))
  }

  // === Simpan ===
  async function handleSave() {
    setAttempted(true)
    setSubmitError(null)

    // Hentikan bila ada error inline + scroll ke section pertama yang bermasalah
    const firstBad = nameError
      ? 'name'
      : utamaError
        ? 'utama'
        : companionError
          ? 'companions'
          : priceError
            ? 'price'
            : null
    if (firstBad) {
      document
        .getElementById(`combo-${firstBad}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    setSaving(true)
    const payload = {
      name: name.trim(),
      isActive,
      // Dikirim untuk transparansi; server MENGHITUNG ULANG dari items dan memakai hitungannya.
      comboPrice,
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
  const selectedIds = useMemo(() => new Set(items.map((i) => i.productId)), [items])

  return (
    <>
      <OmsHeader title="Paket & Combo" />

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

        <div className="mx-auto mt-6 max-w-5xl space-y-6">
          {/* --- Seksi 1: Informasi Combo --- */}
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="text-base font-bold text-gray-900">Informasi Combo</h3>

            <div id="combo-name" className="mt-5">
              <Field label="Nama Combo" error={attempted || touchedName ? nameError : null}>
                <input
                  type="text"
                  value={name}
                  maxLength={100}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => setTouchedName(true)}
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

          {productNotice && (
            <p className="text-xs font-medium text-amber-600">{productNotice}</p>
          )}

          {/* --- Seksi 2: dua kolom produk --- */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Kiri: Produk Utama */}
            <section
              id="combo-utama"
              className="rounded-xl border border-emerald-200 bg-white p-6 shadow-sm"
            >
              <div className="flex items-center gap-2">
                <Star className="h-4 w-4 text-emerald-600" />
                <h3 className="text-base font-bold text-gray-900">Produk Utama</h3>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Paket ini hanya tayang di halaman detail produk utama — tidak di halaman produk
                pasangannya.
              </p>

              {primary ? (
                <div className="mt-4">
                  <ItemRow
                    item={primary}
                    onQuantity={(q) => updateQuantity(primary.productId, q)}
                    onDealPrice={(p) => updateDealPrice(primary.productId, p)}
                    onRemove={() => removeItem(primary.productId)}
                    highlight
                  />
                </div>
              ) : (
                <div className="mt-4">
                  <ProductPicker
                    inputRef={utamaSearchRef}
                    products={products}
                    excludeIds={selectedIds}
                    placeholder="Cari produk utama…"
                    onPick={(p) => addProduct(p, true)}
                  />
                  <p className="mt-3 rounded-lg border border-dashed border-emerald-200 bg-emerald-50/50 px-4 py-6 text-center text-sm text-emerald-700">
                    Belum ada produk utama.
                  </p>
                </div>
              )}

              {attempted && utamaError && (
                <p className="mt-3 text-xs font-medium text-red-600">{utamaError}</p>
              )}
            </section>

            {/* Kanan: Produk yang Dicombokan */}
            <section
              id="combo-companions"
              className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
            >
              <h3 className="text-base font-bold text-gray-900">Produk yang Dicombokan</h3>
              <p className="mt-1 text-xs text-gray-500">
                Produk pasangan. Bintang di tiap baris menukar posisinya dengan produk utama.
              </p>

              <div className="mt-4">
                <ProductPicker
                  inputRef={comboSearchRef}
                  products={products}
                  excludeIds={selectedIds}
                  placeholder="Cari produk untuk dicombokan…"
                  onPick={(p) => addProduct(p, false)}
                />
              </div>

              <div className="mt-4 space-y-3">
                {companions.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-400">
                    Belum ada produk pasangan.
                  </p>
                ) : (
                  companions.map((item) => (
                    <ItemRow
                      key={item.productId}
                      item={item}
                      onQuantity={(q) => updateQuantity(item.productId, q)}
                      onDealPrice={(p) => updateDealPrice(item.productId, p)}
                      onRemove={() => removeItem(item.productId)}
                      onMakePrimary={() => setPrimary(item.productId)}
                    />
                  ))
                )}
              </div>

              {attempted && companionError && (
                <p className="mt-3 text-xs font-medium text-red-600">{companionError}</p>
              )}
            </section>
          </div>

          {/* --- Seksi 3: Ringkasan Harga --- */}
          <section id="combo-price" className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="text-base font-bold text-gray-900">Ringkasan Harga</h3>

            <div className="mt-5 space-y-3">
              {/* Pembanding: harga bila produk-produk itu dibeli satuan */}
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                <span className="text-sm text-gray-600">Harga gabungan (beli satuan)</span>
                <span className="text-sm font-semibold text-gray-400 line-through">
                  {formatRupiah(normalPrice)}
                </span>
              </div>

              {/* Harga paket = jumlah harga per produk di dua section atas (tidak diketik manual) */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">
                  Harga combo
                  <span className="ml-1 text-xs font-normal text-gray-400">
                    (jumlah harga di atas)
                  </span>
                </span>
                <span className="text-lg font-bold text-gray-900">
                  {priceFilled ? formatRupiah(comboPrice) : '—'}
                </span>
              </div>

              {priceError && (attempted || priceFilled) && (
                <p className="text-xs font-medium text-red-600">{priceError}</p>
              )}

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
        <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {submitError ? (
            <p className="text-xs font-medium text-red-600">{submitError}</p>
          ) : (
            <p className="flex items-center gap-2 text-xs text-gray-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Harga combo dijumlahkan otomatis dari harga tiap produk.
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
              disabled={saving || !isValid}
              className="rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
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

// Pencarian produk dengan dropdown hasil. Dipakai dua kali (produk utama & produk pasangan);
// tiap pemakaian punya query sendiri agar mengetik di satu kolom tak mengubah kolom satunya.
function ProductPicker({
  inputRef,
  products,
  excludeIds,
  placeholder,
  onPick,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>
  products: StoredProduct[]
  excludeIds: Set<string>
  placeholder: string
  onPick: (product: StoredProduct) => void
}) {
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return products
      .filter((p) => p.stock > 0 && !p.archived && !excludeIds.has(p.id))
      .filter((p) => (q ? p.name.toLowerCase().includes(q) : true))
      .slice(0, 8)
  }, [products, query, excludeIds])

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          placeholder={placeholder}
          className={`${inputClass} pl-10`}
        />
      </div>

      {focused && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-400">
              {products.length === 0
                ? 'Belum ada produk. Tambahkan produk dulu di menu Produk.'
                : 'Tidak ada produk cocok (atau semua sudah ditambahkan / stok habis).'}
            </p>
          ) : (
            results.map((p) => (
              // onMouseDown agar terpilih sebelum input kehilangan fokus (blur)
              <button
                key={p.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  onPick(p)
                  setQuery('')
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
  )
}

// Satu baris produk di dalam paket: qty, harga normal (pembanding), harga di dalam paket, subtotal.
function ItemRow({
  item,
  onQuantity,
  onDealPrice,
  onRemove,
  onMakePrimary,
  highlight,
}: {
  item: ComboItem
  onQuantity: (quantity: number) => void
  onDealPrice: (dealPrice: number | null) => void
  onRemove: () => void
  onMakePrimary?: () => void
  highlight?: boolean
}) {
  const subtotal = (item.dealPrice ?? 0) * item.quantity

  return (
    <div
      className={`rounded-lg border p-3 ${
        highlight ? 'border-emerald-300 bg-emerald-50/60' : 'border-gray-200 bg-gray-50/60'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">{item.name}</p>
          <p className="text-xs text-gray-500">Harga satuan {formatRupiah(item.unitPrice)}</p>
        </div>
        {onMakePrimary && (
          <button
            type="button"
            onClick={onMakePrimary}
            aria-label={`Jadikan ${item.name} produk utama`}
            title="Jadikan produk utama"
            className="flex-none rounded-lg border border-emerald-200 bg-white p-2 text-emerald-600 transition hover:bg-emerald-50"
          >
            <Star className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Hapus ${item.name}`}
          className="flex-none rounded-lg border border-red-200 bg-white p-2 text-red-600 transition hover:bg-red-50"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-gray-500">Qty</label>
          <input
            type="number"
            min={1}
            value={item.quantity}
            onChange={(e) => onQuantity(e.target.value === '' ? 1 : Number(e.target.value))}
            className="w-16 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-center text-sm text-gray-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
          />
        </div>

        <div className="min-w-[9rem] flex-1">
          <label className="mb-1 block text-xs text-gray-500">Harga di paket / item</label>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center border-r border-gray-200 px-2 text-xs font-medium text-gray-500">
              Rp
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={item.dealPrice ?? ''}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, '')
                onDealPrice(digits === '' ? null : Number(digits))
              }}
              placeholder="0"
              aria-label={`Harga ${item.name} di dalam paket`}
              className="w-full rounded-lg border border-gray-300 bg-white py-1.5 pl-9 pr-3 text-sm text-gray-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
            />
          </div>
        </div>

        <div className="text-right">
          <span className="mb-1 block text-xs text-gray-500">Subtotal</span>
          <span className="block text-sm font-semibold text-gray-800">
            {item.dealPrice === null ? '—' : formatRupiah(subtotal)}
          </span>
        </div>
      </div>
    </div>
  )
}

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
