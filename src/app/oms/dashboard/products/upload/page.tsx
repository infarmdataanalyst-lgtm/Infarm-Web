'use client'

// src/app/oms/dashboard/products/upload/page.tsx
// Halaman Upload Produk Baru OMS Infarm.
// Menyimpan produk ke Supabase via POST /api/products/create → langsung tampil di ecommerce.
// Validasi manual (pola project, tanpa lib) via src/lib/product-validation.ts.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { ChevronRight, UploadCloud, Check, X } from 'lucide-react'
import OmsHeader from '@/components/oms/OmsHeader'
import { PRODUCT_CATEGORIES } from '@/lib/data/categories'
import { formatRupiah } from '@/lib/format'
import type { ProductCategory } from '@/types/product'
import {
  validateProductForm,
  validateImageFile,
  validateSkuFormat,
  PRODUCT_FIELD_ORDER,
  MAX_PRODUCT_IMAGES,
  ACCEPTED_IMAGE_ACCEPT,
  DESC_MAX,
  NAME_MAX,
  type ProductFieldErrors,
  type ProductFieldKey,
} from '@/lib/product-validation'

// Gambar yang diunggah, disimpan sebagai data URL (base64) untuk preview & dikirim ke DB
type UploadedImage = {
  id: string
  src: string // data URL base64
  name: string
}

export default function UploadProductPage() {
  const router = useRouter()

  // === State form (controlled) ===
  const [sku, setSku] = useState('INF-SM-001')
  const [name, setName] = useState('Media Tanam Organik Super')
  const [category, setCategory] = useState<ProductCategory | ''>('')
  const [price, setPrice] = useState<number | ''>(35000)
  const [stock, setStock] = useState<number | ''>(120)
  const [description, setDescription] = useState('')

  // === State gambar produk ===
  const [images, setImages] = useState<UploadedImage[]>([])
  const [uploadNotice, setUploadNotice] = useState<string | null>(null)

  // === State validasi ===
  // touched: field yang sudah disentuh (blur) → error baru ditampilkan setelah disentuh
  const [touched, setTouched] = useState<Partial<Record<ProductFieldKey, boolean>>>({})
  const [skuChecking, setSkuChecking] = useState(false) // sedang cek duplikat SKU ke server
  const [skuDuplicate, setSkuDuplicate] = useState(false) // hasil cek duplikat

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // === Error live (dihitung ulang tiap render dari nilai form) ===
  const liveErrors: ProductFieldErrors = useMemo(
    () =>
      validateProductForm({
        sku,
        name,
        category,
        price,
        stock,
        description,
        imageCount: images.length,
      }),
    [sku, name, category, price, stock, description, images.length],
  )

  // Error SKU gabungan: format dulu, lalu duplikat
  const skuError = liveErrors.sku ?? (skuDuplicate ? 'SKU sudah digunakan produk lain' : undefined)

  // Form valid bila tak ada error apa pun, tidak duplikat, dan tidak sedang cek SKU
  const isFormValid =
    Object.keys(liveErrors).length === 0 && !skuDuplicate && !skuChecking

  function markTouched(field: ProductFieldKey) {
    setTouched((t) => ({ ...t, [field]: true }))
  }

  // Tampilkan error field hanya bila sudah disentuh
  function shownError(field: ProductFieldKey): string | undefined {
    if (!touched[field]) return undefined
    return field === 'sku' ? skuError : liveErrors[field]
  }

  // === Handler gambar ===

  // Membaca file gambar terpilih → validasi tipe/ukuran → preview (data URL), maks 9 foto
  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    markTouched('images')
    setUploadNotice(null)

    if (images.length >= MAX_PRODUCT_IMAGES) {
      setUploadNotice(`Maksimal ${MAX_PRODUCT_IMAGES} gambar per produk.`)
      return
    }

    const available = MAX_PRODUCT_IMAGES - images.length
    let added = 0
    let capped = false
    for (const file of Array.from(fileList)) {
      // Validasi tipe & ukuran per file
      const fileError = validateImageFile(file)
      if (fileError) {
        setUploadNotice(`"${file.name}": ${fileError}`)
        continue
      }
      if (added >= available) {
        capped = true
        continue
      }
      added += 1
      const reader = new FileReader()
      reader.onload = () => {
        const src = reader.result as string
        setImages((prev) =>
          prev.length >= MAX_PRODUCT_IMAGES
            ? prev
            : [...prev, { id: `${file.name}-${file.size}-${prev.length}`, src, name: file.name }],
        )
      }
      reader.readAsDataURL(file)
    }

    if (added > 0) {
      setUploadNotice(
        capped
          ? `${added} foto ditambahkan (batas ${MAX_PRODUCT_IMAGES} foto tercapai).`
          : `${added} foto berhasil ditambahkan.`,
      )
    }
  }

  function removeImage(id: string) {
    setImages((prev) => prev.filter((img) => img.id !== id))
    markTouched('images')
  }

  // === Cek duplikat SKU (onBlur, server) ===
  async function checkSkuDuplicate() {
    markTouched('sku')
    // Lewati bila format SKU belum valid (percuma query)
    if (validateSkuFormat(sku)) {
      setSkuDuplicate(false)
      return
    }
    setSkuChecking(true)
    try {
      const res = await fetch(`/api/products/check-sku?sku=${encodeURIComponent(sku.trim())}`)
      const data = (await res.json()) as { exists?: boolean }
      setSkuDuplicate(data.exists === true)
    } catch {
      setSkuDuplicate(false) // jangan blok bila cek gagal; DB tetap jaga UNIQUE
    } finally {
      setSkuChecking(false)
    }
  }

  // === Handler input angka (blok non-digit) ===
  function handlePriceChange(raw: string) {
    const digits = raw.replace(/\D/g, '')
    setPrice(digits === '' ? '' : Number(digits))
  }
  function handleStockChange(raw: string) {
    const digits = raw.replace(/\D/g, '')
    setStock(digits === '' ? '' : Number(digits))
  }

  // === Submit ===
  async function handleSave() {
    setError(null)
    // Tandai semua field tersentuh agar seluruh error tampil
    setTouched({
      sku: true,
      name: true,
      category: true,
      price: true,
      stock: true,
      description: true,
      images: true,
    })

    // Validasi ulang seluruh field + status duplikat SKU
    const errors = validateProductForm({
      sku,
      name,
      category,
      price,
      stock,
      description,
      imageCount: images.length,
    })

    // Scroll ke field bermasalah pertama (termasuk duplikat SKU)
    const firstBad =
      PRODUCT_FIELD_ORDER.find((k) => errors[k]) ?? (skuDuplicate ? 'sku' : undefined)
    if (firstBad || skuDuplicate) {
      const el = document.getElementById(`pf-${firstBad ?? 'sku'}`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/products/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          sku: sku.trim(),
          category,
          price: Number(price) || 0,
          stock: Number(stock) || 0,
          description: description.trim(),
          imageUrl: images[0]?.src,
          images: images.map((img) => img.src),
        }),
      })
      if (!res.ok) throw new Error('save failed')
      // Sukses → kembali ke daftar produk (tandai sukses untuk toast di halaman daftar)
      try {
        sessionStorage.setItem('oms_product_saved', '1')
      } catch {
        // sessionStorage bisa gagal (mode privat) — abaikan, redirect tetap jalan
      }
      router.push('/oms/dashboard/products')
    } catch {
      setError('Gagal menyimpan produk. Silakan coba lagi.')
      setSaving(false)
    }
  }

  return (
    <>
      <OmsHeader title="Produk" notificationCount={3} />

      {/* pb-28 memberi ruang agar konten tidak tertutup footer sticky */}
      <main className="p-6 pb-28 md:p-8 md:pb-28">
        {/* === Breadcrumbs === */}
        <nav className="flex items-center gap-1.5 text-sm text-gray-400">
          <Link href="/oms/dashboard/products" className="hover:text-gray-600">
            Produk
          </Link>
          <ChevronRight className="h-4 w-4" />
          <span className="font-medium text-gray-600">Tambah Produk Baru</span>
        </nav>

        {/* === Judul Halaman === */}
        <div className="mt-2">
          <h2 className="text-2xl font-bold text-gray-900">Upload Produk Baru</h2>
          <p className="mt-1 text-sm text-gray-500">
            Lengkapi detail produk untuk ditampilkan di ecommerce Infarm.
          </p>
        </div>

        {/* === Konten Form === */}
        <div className="mx-auto mt-6 max-w-3xl">
          <div className="space-y-6">
            {/* --- Seksi 1: Informasi Dasar --- */}
            <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-base font-bold text-gray-900">Informasi Dasar</h3>

              <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
                {/* SKU */}
                <div id="pf-sku">
                  <Field label="SKU Produk">
                    <input
                      type="text"
                      value={sku}
                      onChange={(e) => setSku(e.target.value)}
                      onBlur={checkSkuDuplicate}
                      placeholder="Contoh: INF-SM-001"
                      className={inputClass(!!shownError('sku'))}
                      aria-invalid={!!shownError('sku')}
                    />
                  </Field>
                  {skuChecking && <p className="mt-1 text-xs text-gray-400">Memeriksa SKU…</p>}
                  <FieldError message={shownError('sku')} />
                </div>

                {/* Nama Produk */}
                <div id="pf-name">
                  <Field label="Nama Produk">
                    <input
                      type="text"
                      value={name}
                      maxLength={NAME_MAX}
                      onChange={(e) => setName(e.target.value)}
                      onBlur={() => markTouched('name')}
                      placeholder="Contoh: Media Tanam Organik Super"
                      className={inputClass(!!shownError('name'))}
                      aria-invalid={!!shownError('name')}
                    />
                  </Field>
                  <div className="mt-1 flex items-center justify-between">
                    <FieldError message={shownError('name')} />
                    <span className="ml-auto text-xs text-gray-400">
                      {name.length}/{NAME_MAX}
                    </span>
                  </div>
                </div>
              </div>

              {/* Kategori */}
              <div id="pf-category" className="mt-5">
                <Field label="Kategori Produk">
                  <select
                    value={category}
                    onChange={(e) => {
                      setCategory(e.target.value as ProductCategory)
                      markTouched('category')
                    }}
                    onBlur={() => markTouched('category')}
                    className={inputClass(!!shownError('category'))}
                    aria-invalid={!!shownError('category')}
                  >
                    <option value="" disabled>
                      Pilih kategori…
                    </option>
                    {PRODUCT_CATEGORIES.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <FieldError message={shownError('category')} />
              </div>

              <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
                {/* Harga */}
                <div id="pf-price">
                  <Field label="Harga">
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center border-r border-gray-200 px-3 text-sm font-medium text-gray-500">
                        Rp
                      </span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={price}
                        onChange={(e) => handlePriceChange(e.target.value)}
                        onBlur={() => markTouched('price')}
                        placeholder="0"
                        className={`${inputClass(!!shownError('price'))} pl-12`}
                        aria-invalid={!!shownError('price')}
                      />
                    </div>
                  </Field>
                  {/* Preview format Rupiah saat nilai valid */}
                  {price !== '' && !shownError('price') && (
                    <p className="mt-1 text-xs font-medium text-emerald-700">
                      {formatRupiah(Number(price))}
                    </p>
                  )}
                  <FieldError message={shownError('price')} />
                </div>

                {/* Stok */}
                <div id="pf-stock">
                  <Field label="Stok Tersedia">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={stock}
                      onChange={(e) => handleStockChange(e.target.value)}
                      onBlur={() => markTouched('stock')}
                      placeholder="0"
                      className={inputClass(!!shownError('stock'))}
                      aria-invalid={!!shownError('stock')}
                    />
                  </Field>
                  <FieldError message={shownError('stock')} />
                </div>
              </div>

              {/* Deskripsi */}
              <div id="pf-description" className="mt-5">
                <Field label="Deskripsi Produk">
                  <textarea
                    rows={5}
                    value={description}
                    maxLength={DESC_MAX}
                    onChange={(e) => setDescription(e.target.value)}
                    onBlur={() => markTouched('description')}
                    placeholder="Jelaskan spesifikasi produk: komposisi, volume kemasan, manfaat, anjuran pemakaian, serta garansi mutu & kebijakan retur."
                    className={`${inputClass(!!shownError('description'))} resize-y leading-relaxed`}
                    aria-invalid={!!shownError('description')}
                  />
                </Field>
                <div className="mt-1 flex items-center justify-between">
                  <FieldError message={shownError('description')} />
                  <span className="ml-auto text-xs text-gray-400">
                    {description.length}/{DESC_MAX}
                  </span>
                </div>
              </div>
            </section>

            {/* --- Seksi 2: Media Produk --- */}
            <section id="pf-images" className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-base font-bold text-gray-900">Media Produk</h3>

              {/* Kotak Drag & Drop */}
              <label
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  handleFiles(e.dataTransfer.files)
                }}
                className="mt-5 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center transition hover:border-emerald-400 hover:bg-emerald-50/40"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                  <UploadCloud className="h-6 w-6" />
                </span>
                <span className="mt-3 text-sm font-semibold text-gray-700">
                  Tarik dan lepas gambar di sini
                </span>
                <span className="mt-1 text-xs text-gray-400">
                  atau klik untuk memilih file · JPG/PNG/WEBP · Maksimal {MAX_PRODUCT_IMAGES} foto · 2MB per file
                </span>
                <input
                  type="file"
                  accept={ACCEPTED_IMAGE_ACCEPT}
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    handleFiles(e.target.files)
                    e.target.value = ''
                  }}
                />
              </label>

              {uploadNotice && (
                <p className="mt-3 text-xs font-medium text-emerald-700">{uploadNotice}</p>
              )}

              {/* Preview gambar */}
              {images.length > 0 ? (
                <div className="mt-4 grid grid-cols-3 gap-4 sm:grid-cols-4">
                  {images.map((img, index) => (
                    <div
                      key={img.id}
                      className="group relative aspect-square overflow-hidden rounded-lg border border-gray-200 bg-gray-100"
                    >
                      <Image
                        src={img.src}
                        alt={img.name}
                        fill
                        unoptimized
                        sizes="120px"
                        className="object-cover"
                      />
                      {index === 0 && (
                        <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                          <Check className="h-3 w-3" />
                          Utama
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeImage(img.id)}
                        aria-label={`Hapus ${img.name}`}
                        className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-gray-900/60 text-white opacity-0 transition group-hover:opacity-100"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs text-gray-400">
                  Belum ada gambar. Gambar pertama akan dijadikan gambar utama produk.
                </p>
              )}
              <FieldError message={shownError('images')} />
            </section>
          </div>
        </div>
      </main>

      {/* === Footer Sticky === */}
      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white px-6 py-3.5 md:left-64">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {error ? (
            <p className="text-xs font-medium text-red-600">{error}</p>
          ) : (
            <p className="flex items-center gap-2 text-xs text-gray-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Produk akan langsung tampil di ecommerce setelah disimpan.
            </p>
          )}
          <div className="flex items-center gap-3">
            <Link
              href="/oms/dashboard/products"
              className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50"
            >
              Batal
            </Link>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !isFormValid}
              className="rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Menyimpan…' : 'Simpan Produk'}
            </button>
          </div>
        </div>
      </footer>
    </>
  )
}

// === Sub-komponen & Helper ===

// Kelas input; border merah saat error
function inputClass(hasError: boolean): string {
  const base =
    'w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition focus:ring-2'
  return hasError
    ? `${base} border-red-400 focus:border-red-500 focus:ring-red-100`
    : `${base} border-gray-300 focus:border-emerald-500 focus:ring-emerald-100`
}

// Pesan error di bawah field (kosong bila tak ada)
function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="mt-1 text-xs font-medium text-red-600">{message}</p>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700">{label}</label>
      {children}
    </div>
  )
}
