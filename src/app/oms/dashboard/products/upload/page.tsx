'use client'

// src/app/oms/dashboard/products/upload/page.tsx
// Halaman Upload Produk Baru OMS Infarm.
// Menyimpan produk ke mock DB via POST /api/products/create → langsung tampil di ecommerce.
// Sidebar disediakan otomatis oleh layout /oms/dashboard.
// TODO: ganti POST mock DB dengan insert Supabase setelah OMS dibangun.

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { ChevronRight, UploadCloud, Check, X } from 'lucide-react'
import OmsHeader from '@/components/oms/OmsHeader'
import { PRODUCT_CATEGORIES } from '@/lib/data/categories'
import type { ProductCategory } from '@/types/product'

// Gambar yang diunggah, disimpan sebagai data URL (base64) untuk preview & dikirim ke mock DB
type UploadedImage = {
  id: string
  src: string // data URL base64
  name: string
}

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB per file

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

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Membaca file gambar yang dipilih/di-drop → validasi → buat preview (data URL)
  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    setUploadNotice(null)

    let added = 0
    Array.from(fileList).forEach((file) => {
      if (!file.type.startsWith('image/')) {
        setUploadNotice(`"${file.name}" bukan file gambar dan dilewati.`)
        return
      }
      if (file.size > MAX_FILE_SIZE) {
        setUploadNotice(`"${file.name}" melebihi 5MB dan dilewati.`)
        return
      }
      added += 1
      const reader = new FileReader()
      reader.onload = () => {
        const src = reader.result as string
        setImages((prev) => [
          ...prev,
          { id: `${file.name}-${file.size}-${prev.length}`, src, name: file.name },
        ])
      }
      reader.readAsDataURL(file)
    })

    if (added > 0) {
      setUploadNotice(`${added} foto berhasil ditambahkan.`)
    }
  }

  // Menghapus satu gambar dari preview
  function removeImage(id: string) {
    setImages((prev) => prev.filter((img) => img.id !== id))
  }

  // Validasi sederhana lalu kirim produk ke mock DB; sukses → kembali ke daftar produk
  async function handleSave() {
    setError(null)

    if (!sku.trim() || !name.trim()) {
      setError('SKU dan Nama Produk wajib diisi.')
      return
    }
    if (!category) {
      setError('Silakan pilih kategori produk.')
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
          description: description.trim() || undefined,
          // Gambar pertama = gambar utama (data URL base64); kosong → pakai placeholder
          imageUrl: images[0]?.src,
        }),
      })
      if (!res.ok) throw new Error('save failed')
      // Produk tersimpan → kembali ke daftar produk OMS (yang juga membaca mock DB)
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
                <Field label="SKU Produk">
                  <input
                    type="text"
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    placeholder="Contoh: INF-SM-001"
                    className={inputClass}
                  />
                </Field>
                <Field label="Nama Produk">
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Contoh: Media Tanam Organik Super"
                    className={inputClass}
                  />
                </Field>
              </div>

              {/* Kategori — menentukan pengelompokan produk di ecommerce */}
              <div className="mt-5">
                <Field label="Kategori Produk">
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as ProductCategory)}
                    className={inputClass}
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
              </div>

              <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label="Harga">
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center border-r border-gray-200 px-3 text-sm font-medium text-gray-500">
                      Rp
                    </span>
                    <input
                      type="number"
                      min={0}
                      value={price}
                      onChange={(e) =>
                        setPrice(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))
                      }
                      placeholder="0"
                      className={`${inputClass} pl-12`}
                    />
                  </div>
                </Field>
                <Field label="Stok Tersedia">
                  <input
                    type="number"
                    min={0}
                    value={stock}
                    onChange={(e) =>
                      setStock(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))
                    }
                    placeholder="0"
                    className={inputClass}
                  />
                </Field>
              </div>

              <div className="mt-5">
                <Field label="Deskripsi Produk">
                  <textarea
                    rows={5}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Jelaskan spesifikasi produk: komposisi media (sekam, kompos, cocopeat), volume kemasan, manfaat untuk pertumbuhan akar, anjuran pemakaian, serta informasi garansi mutu & kebijakan retur jika kemasan rusak saat diterima."
                    className={`${inputClass} resize-y leading-relaxed`}
                  />
                </Field>
              </div>
            </section>

            {/* --- Seksi 2: Media Produk --- */}
            <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-base font-bold text-gray-900">Media Produk</h3>

              {/* Kotak Drag & Drop — menangkap file via klik atau drop */}
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
                  atau klik untuk memilih file · Maksimal 5MB per file
                </span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    handleFiles(e.target.files)
                    e.target.value = '' // reset agar file sama bisa dipilih ulang
                  }}
                />
              </label>

              {/* Notifikasi upload (berhasil / dilewati) */}
              {uploadNotice && (
                <p className="mt-3 text-xs font-medium text-emerald-700">{uploadNotice}</p>
              )}

              {/* Area Preview gambar yang benar-benar diunggah */}
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
                      {/* Gambar pertama = gambar utama */}
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
            </section>
          </div>
        </div>
      </main>

      {/* === Footer Sticky === */}
      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white px-6 py-3.5 md:left-64">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Pesan error / status */}
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
              disabled={saving}
              className="rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {saving ? 'Menyimpan…' : 'Simpan & Upload ke e-commerce'}
            </button>
          </div>
        </div>
      </footer>
    </>
  )
}

// === Sub-komponen & Helper ===

// Kelas dasar input agar konsisten di seluruh form
const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100'

// Wrapper label + field
function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700">
        {label}
      </label>
      {children}
    </div>
  )
}
