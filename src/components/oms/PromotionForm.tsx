'use client'

// src/components/oms/PromotionForm.tsx
// Form bersama untuk Buat & Edit promo OMS.
// - mode 'create' → POST /api/promotions/create ; mode 'edit' → PATCH /api/promotions/update
// - Detail hadiah tampil kondisional sesuai Tipe Hadiah yang dipilih
// - Produk hadiah (free_product) dipilih dari /api/products/list (stok > 0 & tidak diarsipkan)
// - Validasi inline di tiap field; preview pesan progres memakai token {sisa}
// Mengikuti tema emerald & pola form OMS (OmsHeader, breadcrumb, sticky footer) — lihat ComboForm.

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronRight, Search, Truck } from 'lucide-react'
import OmsHeader from '@/components/oms/OmsHeader'
import { formatRupiah } from '@/lib/format'
import { PROMOTION_TYPE_LABELS, type Promotion, type PromotionType } from '@/types/promotion'
import type { StoredProduct } from '@/types/product'

type Mode = 'create' | 'edit'

// Token yang akan diganti nilai kekurangan pembelian otomatis di keranjang
const PROGRESS_TOKEN = '{sisa}'

// Ambil bagian tanggal (YYYY-MM-DD) dari ISO untuk mengisi input date saat edit
function toDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : ''
}

export default function PromotionForm({
  mode,
  initialPromotion,
}: {
  mode: Mode
  initialPromotion?: Promotion
}) {
  const router = useRouter()
  const isEdit = mode === 'edit'

  // === State form (controlled) ===
  const [name, setName] = useState(initialPromotion?.name ?? '')
  const [type, setType] = useState<PromotionType | ''>(initialPromotion?.type ?? '')
  const [isActive, setIsActive] = useState(initialPromotion?.isActive ?? true)
  const [minPurchase, setMinPurchase] = useState<number | ''>(initialPromotion?.minPurchase ?? '')

  // Detail hadiah
  const [freeProductId, setFreeProductId] = useState<string | null>(
    initialPromotion?.freeProductId ?? null,
  )
  const [freeProductName, setFreeProductName] = useState<string>(
    initialPromotion?.freeProductName ?? '',
  )
  const [discountValue, setDiscountValue] = useState<number | ''>(
    initialPromotion?.discountValue ?? '',
  )

  // Periode
  const [startDate, setStartDate] = useState(toDateInput(initialPromotion?.startAt ?? null))
  const [endDate, setEndDate] = useState(toDateInput(initialPromotion?.endAt ?? null))

  // Pesan progres
  const [progressMessage, setProgressMessage] = useState(
    initialPromotion?.progressMessage ?? '',
  )

  // === State produk (untuk free_product) ===
  const [products, setProducts] = useState<StoredProduct[]>([])
  const [query, setQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  // === State submit ===
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Ambil produk (hanya stok > 0 & tidak diarsipkan yang boleh jadi hadiah)
  useEffect(() => {
    let active = true
    fetch('/api/products/list')
      .then((res) => res.json())
      .then((data: { products?: StoredProduct[] }) => {
        if (active) setProducts(data.products ?? [])
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  // Hasil pencarian produk hadiah
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase()
    return products
      .filter((p) => p.stock > 0 && !p.archived)
      .filter((p) => (q ? p.name.toLowerCase().includes(q) : true))
      .slice(0, 8)
  }, [products, query])

  const minPurchaseNum = minPurchase === '' ? 0 : minPurchase
  const discountNum = discountValue === '' ? 0 : discountValue

  // === Validasi inline ===
  const nameError = name.trim().length < 3 ? 'Nama promo wajib diisi minimal 3 karakter.' : null
  const typeError = type === '' ? 'Tipe hadiah wajib dipilih.' : null
  const minPurchaseError =
    minPurchase === '' || minPurchaseNum < 1000
      ? 'Minimal pembelian wajib diisi, minimal Rp1.000.'
      : null

  const freeProductError =
    type === 'free_product' && !freeProductId ? 'Produk hadiah wajib dipilih.' : null
  const discountNominalError =
    type === 'discount_nominal'
      ? discountValue === '' || discountNum <= 0
        ? 'Nilai diskon wajib diisi.'
        : discountNum > minPurchaseNum
          ? 'Nilai diskon tidak boleh lebih besar dari minimal pembelian.'
          : null
      : null
  const discountPercentError =
    type === 'discount_percent'
      ? discountValue === '' || discountNum < 1 || discountNum > 100
        ? 'Persen diskon harus antara 1–100.'
        : null
      : null

  // Periode: bila berakhir diisi → mulai wajib; berakhir tidak boleh sebelum mulai
  const periodError =
    endDate && !startDate
      ? 'Tanggal mulai wajib diisi jika tanggal berakhir diatur.'
      : startDate && endDate && endDate < startDate
        ? 'Tanggal berakhir harus setelah tanggal mulai.'
        : null

  const progressError = progressMessage.trim() === '' ? 'Pesan progres wajib diisi.' : null

  const hasError = Boolean(
    nameError ||
      typeError ||
      minPurchaseError ||
      freeProductError ||
      discountNominalError ||
      discountPercentError ||
      periodError ||
      progressError,
  )

  // Preview pesan: ganti {sisa} dengan kekurangan contoh (keranjang kosong → sebesar minimal pembelian)
  const previewMessage = progressMessage
    ? progressMessage.split(PROGRESS_TOKEN).join(formatRupiah(minPurchaseNum))
    : ''

  // === Pilih / ganti produk hadiah ===
  function selectProduct(product: StoredProduct) {
    setFreeProductId(product.id)
    setFreeProductName(product.name)
    setQuery('')
    setSearchFocused(false)
  }
  function clearProduct() {
    setFreeProductId(null)
    setFreeProductName('')
  }

  // Saat tipe berubah, bersihkan detail hadiah yang tidak relevan
  function handleTypeChange(next: PromotionType | '') {
    setType(next)
    if (next !== 'free_product') {
      setFreeProductId(null)
      setFreeProductName('')
    }
    if (next !== 'discount_nominal' && next !== 'discount_percent') {
      setDiscountValue('')
    }
  }

  // === Simpan ===
  async function handleSave() {
    setAttempted(true)
    setSubmitError(null)
    if (hasError || type === '') return

    setSaving(true)
    const payload = {
      name: name.trim(),
      type,
      minPurchase: minPurchaseNum,
      isActive,
      progressMessage: progressMessage.trim(),
      // Detail hadiah sesuai tipe (null untuk yang tidak relevan)
      freeProductId: type === 'free_product' ? freeProductId : null,
      freeProductName: type === 'free_product' ? freeProductName : null,
      discountValue:
        type === 'discount_nominal' || type === 'discount_percent' ? discountNum : null,
      // Tanggal: simpan mulai pukul 00:00 & berakhir 23:59 (berakhir inklusif sepanjang hari)
      startAt: startDate ? `${startDate}T00:00:00` : null,
      endAt: endDate ? `${endDate}T23:59:59` : null,
      ...(isEdit && initialPromotion ? { id: initialPromotion.id } : {}),
    }

    try {
      const res = await fetch(
        mode === 'create' ? '/api/promotions/create' : '/api/promotions/update',
        {
          method: mode === 'create' ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? 'Gagal menyimpan promo.')
      }
      router.push(`/oms/dashboard/promosi?toast=${mode === 'create' ? 'created' : 'updated'}`)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Gagal menyimpan promo.')
      setSaving(false)
    }
  }

  return (
    <>
      <OmsHeader title="Promosi" notificationCount={3} />

      {/* pb-28 memberi ruang agar konten tidak tertutup footer sticky */}
      <main className="p-6 pb-28 md:p-8 md:pb-28">
        {/* === Breadcrumbs === */}
        <nav className="flex items-center gap-1.5 text-sm text-gray-400">
          <Link href="/oms/dashboard/promosi" className="hover:text-gray-600">
            Promosi
          </Link>
          <ChevronRight className="h-4 w-4" />
          <span className="font-medium text-gray-600">{isEdit ? 'Edit Promo' : 'Buat Promo Baru'}</span>
        </nav>

        {/* === Judul === */}
        <div className="mt-2">
          <h2 className="text-2xl font-bold text-gray-900">{isEdit ? 'Edit Promo' : 'Buat Promo Baru'}</h2>
          <p className="mt-1 text-sm text-gray-500">
            Atur hadiah, kondisi, periode, dan pesan progres promo untuk pelanggan.
          </p>
        </div>

        <div className="mx-auto mt-6 max-w-3xl space-y-6">
          {/* --- Seksi 1: Informasi Promo --- */}
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="text-base font-bold text-gray-900">Informasi Promo</h3>

            <div className="mt-5">
              <Field label="Nama Promo" error={attempted ? nameError : null}>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Contoh: Gratis Ongkir Spesial Panen"
                  className={inputClass}
                />
              </Field>
            </div>

            <div className="mt-5">
              <Field label="Tipe Hadiah" error={attempted ? typeError : null}>
                <select
                  value={type}
                  onChange={(e) => handleTypeChange(e.target.value as PromotionType | '')}
                  className={inputClass}
                >
                  <option value="" disabled>
                    Pilih tipe hadiah…
                  </option>
                  {(Object.keys(PROMOTION_TYPE_LABELS) as PromotionType[]).map((t) => (
                    <option key={t} value={t}>
                      {PROMOTION_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
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

          {/* --- Seksi 2: Kondisi Promo --- */}
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="text-base font-bold text-gray-900">Kondisi Promo</h3>
            <div className="mt-5">
              <Field label="Minimal Pembelian" error={attempted ? minPurchaseError : null}>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center border-r border-gray-200 px-3 text-sm font-medium text-gray-500">
                    Rp
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={minPurchase}
                    onChange={(e) =>
                      setMinPurchase(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))
                    }
                    placeholder="0"
                    className={`${inputClass} pl-12`}
                  />
                </div>
              </Field>
            </div>
          </section>

          {/* --- Seksi 3: Detail Hadiah (kondisional) --- */}
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="text-base font-bold text-gray-900">Detail Hadiah</h3>

            {type === '' && (
              <p className="mt-4 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-400">
                Pilih Tipe Hadiah terlebih dahulu untuk mengatur detailnya.
              </p>
            )}

            {type === 'free_shipping' && (
              <div className="mt-4 flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                <Truck className="h-5 w-5 flex-none" />
                Ongkos kirim akan ditanggung sepenuhnya.
              </div>
            )}

            {type === 'free_product' && (
              <div className="mt-4">
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Produk Hadiah</label>

                {/* Produk terpilih, atau pencarian */}
                {freeProductId ? (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3">
                    <span className="truncate text-sm font-semibold text-gray-900">{freeProductName}</span>
                    <button
                      type="button"
                      onClick={clearProduct}
                      className="flex-none text-xs font-semibold text-emerald-700 underline transition hover:no-underline"
                    >
                      Ganti
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                      <input
                        ref={searchRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onFocus={() => setSearchFocused(true)}
                        onBlur={() => setTimeout(() => setSearchFocused(false), 120)}
                        placeholder="Cari produk hadiah (stok > 0)…"
                        className={`${inputClass} pl-10`}
                      />
                    </div>

                    {searchFocused && (
                      <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                        {searchResults.length === 0 ? (
                          <p className="px-4 py-3 text-sm text-gray-400">
                            {products.length === 0
                              ? 'Belum ada produk. Tambahkan produk dulu di menu Produk.'
                              : 'Tidak ada produk cocok (atau stok habis).'}
                          </p>
                        ) : (
                          searchResults.map((p) => (
                            // onMouseDown agar terpilih sebelum input kehilangan fokus (blur)
                            <button
                              key={p.id}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault()
                                selectProduct(p)
                              }}
                              className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition hover:bg-emerald-50"
                            >
                              <span className="truncate text-sm font-medium text-gray-800">{p.name}</span>
                              <span className="flex-none text-xs text-gray-500">stok {p.stock}</span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}

                {attempted && freeProductError && (
                  <p className="mt-1.5 text-xs font-medium text-red-600">{freeProductError}</p>
                )}
              </div>
            )}

            {type === 'discount_nominal' && (
              <div className="mt-4">
                <Field label="Nominal Diskon" error={attempted ? discountNominalError : null}>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center border-r border-gray-200 px-3 text-sm font-medium text-gray-500">
                      Rp
                    </span>
                    <input
                      type="number"
                      min={0}
                      value={discountValue}
                      onChange={(e) =>
                        setDiscountValue(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))
                      }
                      placeholder="0"
                      className={`${inputClass} pl-12`}
                    />
                  </div>
                </Field>
              </div>
            )}

            {type === 'discount_percent' && (
              <div className="mt-4">
                <Field label="Persen Diskon" error={attempted ? discountPercentError : null}>
                  <div className="relative">
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={discountValue}
                      onChange={(e) =>
                        setDiscountValue(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))
                      }
                      placeholder="1 - 100"
                      className={`${inputClass} pr-10`}
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center border-l border-gray-200 px-3 text-sm font-medium text-gray-500">
                      %
                    </span>
                  </div>
                </Field>
              </div>
            )}
          </section>

          {/* --- Seksi 4: Periode Promo (opsional) --- */}
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="text-base font-bold text-gray-900">Periode Promo</h3>
            <p className="mt-1 text-sm text-gray-500">Opsional. Kosongkan untuk promo tanpa batas waktu.</p>

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Tanggal Mulai">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Tanggal Berakhir" error={attempted ? periodError : null}>
                <input
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(e) => setEndDate(e.target.value)}
                  className={inputClass}
                />
              </Field>
            </div>
          </section>

          {/* --- Seksi 5: Pesan Progres di Keranjang --- */}
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="text-base font-bold text-gray-900">Pesan Progres di Keranjang</h3>

            <div className="mt-5">
              <Field label="Pesan Progres" error={attempted ? progressError : null}>
                <input
                  type="text"
                  value={progressMessage}
                  onChange={(e) => setProgressMessage(e.target.value)}
                  placeholder="Tambah {sisa} lagi untuk gratis ongkir!"
                  className={inputClass}
                />
              </Field>
              <p className="mt-1.5 text-xs text-gray-400">
                Gunakan <code className="rounded bg-gray-100 px-1 py-0.5 text-gray-600">{PROGRESS_TOKEN}</code>{' '}
                untuk menampilkan kekurangan pembelian secara otomatis.
              </p>

              {previewMessage && (
                <div className="mt-3 rounded-lg bg-emerald-50 px-4 py-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-emerald-700/70">Preview</p>
                  <p className="mt-1 text-sm font-medium text-emerald-800">{previewMessage}</p>
                </div>
              )}
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
              Status Kedaluwarsa dihitung otomatis dari tanggal berakhir.
            </p>
          )}
          <div className="flex items-center gap-3">
            <Link
              href="/oms/dashboard/promosi"
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
              {saving ? 'Menyimpan…' : isEdit ? 'Simpan Perubahan' : 'Simpan Promo'}
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
