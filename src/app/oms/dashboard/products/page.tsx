'use client'

// src/app/oms/dashboard/products/page.tsx
// Halaman Manajemen Produk & Inventaris OMS — area internal Infarm.
// Menampilkan ringkasan stok + tabel produk dengan aksi Edit (lengkap) & Hapus.
// Produk hasil input OMS (mock DB) bisa diedit/dihapus permanen via API;
// produk contoh bawaan (dummy) hanya bisa diubah sementara di layar.

import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import OmsHeader from '@/components/oms/OmsHeader'
import { PRODUCT_CATEGORIES, getCategoryLabel } from '@/lib/data/categories'
import type { ProductCategory, StoredProduct } from '@/types/product'

// === Tipe Data ===

type Product = {
  id: string
  name: string
  sku: string
  categoryLabel: string // label tampilan kategori
  slug: ProductCategory | '' // slug kategori (untuk form edit)
  price: number
  stock: number
  image: string
  persisted: boolean // true bila tersimpan di mock DB (bisa diedit/dihapus permanen)
  archived: boolean // true = disembunyikan dari ecommerce, tetap ada di OMS
}

// Bentuk data form pada modal edit
type EditForm = {
  name: string
  sku: string
  slug: ProductCategory | ''
  price: number | ''
  stock: number | ''
  image: string
}

const LOW_STOCK_THRESHOLD = 10 // di bawah angka ini dianggap stok menipis
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB per foto

// Pilihan rentang waktu untuk kolom "Terjual". days=null berarti sepanjang waktu.
const SALES_RANGES: { label: string; days: number | null }[] = [
  { label: '7 Hari', days: 7 },
  { label: '30 Hari', days: 30 },
  { label: '90 Hari', days: 90 },
  { label: 'Semua', days: null },
]

// === Dummy Data Produk (contoh bawaan, tidak tersimpan di DB) ===
const INITIAL_PRODUCTS: Product[] = [
  { id: 'PRD-001', name: 'Benih Cabai Rawit Unggul', sku: 'BNH-CBR-01', categoryLabel: 'Benih Premium', slug: 'benih-premium', price: 18000, stock: 124, image: '/images/product-placeholder.png', persisted: false, archived: false },
  { id: 'PRD-002', name: 'Media Tanam Premium 5L', sku: 'MDT-PRM-5L', categoryLabel: 'Media Tanam', slug: 'media-tanam', price: 32000, stock: 7, image: '/images/product-placeholder.png', persisted: false, archived: false },
  { id: 'PRD-003', name: 'Pot Polybag 25cm (isi 10)', sku: 'POT-PLB-25', categoryLabel: 'Pot Polybag', slug: 'pot-polybag', price: 15000, stock: 0, image: '/images/product-placeholder.png', persisted: false, archived: false },
  { id: 'PRD-004', name: 'Pupuk Organik Cair 1L', sku: 'PPK-ORG-1L', categoryLabel: 'Pupuk Nutrisi', slug: 'pupuk-nutrisi', price: 45000, stock: 58, image: '/images/product-placeholder.png', persisted: false, archived: false },
  { id: 'PRD-005', name: 'Benih Selada Hidroponik', sku: 'BNH-SLD-02', categoryLabel: 'Benih Premium', slug: 'benih-premium', price: 22000, stock: 4, image: '/images/product-placeholder.png', persisted: false, archived: false },
]

// Memetakan produk mock DB → view model tabel
function mapStored(p: StoredProduct): Product {
  return {
    id: p.id,
    name: p.name,
    sku: p.sku,
    categoryLabel: getCategoryLabel(p.category) ?? p.category,
    slug: p.category,
    price: p.promoPrice,
    stock: p.stock,
    image: p.imageUrl,
    persisted: true,
    archived: p.archived ?? false,
  }
}

// Format angka ke Rupiah
function formatRupiah(value: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(value)
}

export default function ProductsPage() {
  // === State ===
  const [products, setProducts] = useState<Product[]>(INITIAL_PRODUCTS)

  // Modal Edit
  const [editTarget, setEditTarget] = useState<Product | null>(null)
  const [form, setForm] = useState<EditForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Modal Hapus
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Data terjual per produk (peta productId → unit terjual) + rentang waktu terpilih
  const [soldCounts, setSoldCounts] = useState<Record<string, number>>({})
  const [rangeDays, setRangeDays] = useState<number | null>(30) // default 30 hari terakhir

  // Ambil produk hasil input OMS (mock DB) lalu tampilkan di depan daftar dummy
  useEffect(() => {
    let active = true
    fetch('/api/products/list')
      .then((res) => res.json())
      .then((data: { products?: StoredProduct[] }) => {
        if (!active || !data.products?.length) return
        setProducts([...data.products.map(mapStored), ...INITIAL_PRODUCTS])
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  // Ambil jumlah terjual per produk sesuai rentang waktu terpilih
  useEffect(() => {
    let active = true
    const params = new URLSearchParams()
    // days=null → sepanjang waktu (tanpa filter from)
    if (rangeDays != null) {
      const from = new Date(Date.now() - rangeDays * 86_400_000).toISOString()
      params.set('from', from)
    }
    fetch(`/api/products/sales-count?${params.toString()}`)
      .then((res) => res.json())
      .then((data: { counts?: Record<string, number> }) => {
        if (!active) return
        setSoldCounts(data.counts ?? {})
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [rangeDays])

  // === Ringkasan stok ===
  const summary = useMemo(() => {
    const total = products.length
    const lowStock = products.filter((p) => p.stock > 0 && p.stock < LOW_STOCK_THRESHOLD).length
    const outOfStock = products.filter((p) => p.stock === 0).length
    return { total, lowStock, outOfStock }
  }, [products])

  // === Aksi Edit ===

  function openEdit(product: Product) {
    setEditTarget(product)
    setEditError(null)
    setForm({
      name: product.name,
      sku: product.sku,
      slug: product.slug,
      price: product.price,
      stock: product.stock,
      image: product.image,
    })
  }

  function closeEdit() {
    setEditTarget(null)
    setForm(null)
    setEditError(null)
  }

  // Membaca foto baru yang dipilih → preview (data URL)
  function handleEditImage(fileList: FileList | null) {
    const file = fileList?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setEditError('File yang dipilih bukan gambar.')
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      setEditError('Ukuran foto melebihi 5MB.')
      return
    }
    setEditError(null)
    const reader = new FileReader()
    reader.onload = () => setForm((f) => (f ? { ...f, image: reader.result as string } : f))
    reader.readAsDataURL(file)
  }

  async function handleSaveEdit() {
    if (!editTarget || !form) return
    if (!form.name.trim() || !form.sku.trim()) {
      setEditError('Nama dan SKU wajib diisi.')
      return
    }
    if (!form.slug) {
      setEditError('Silakan pilih kategori.')
      return
    }

    setSaving(true)
    const price = Number(form.price) || 0
    const stock = Number(form.stock) || 0

    if (editTarget.persisted) {
      // Produk mock DB → simpan permanen via API
      try {
        const res = await fetch('/api/products/update', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editTarget.id,
            name: form.name.trim(),
            sku: form.sku.trim(),
            category: form.slug,
            price,
            stock,
            imageUrl: form.image,
          }),
        })
        if (!res.ok) throw new Error()
        const { product } = (await res.json()) as { product: StoredProduct }
        const mapped = mapStored(product)
        setProducts((prev) => prev.map((p) => (p.id === mapped.id ? mapped : p)))
      } catch {
        setEditError('Gagal menyimpan perubahan. Coba lagi.')
        setSaving(false)
        return
      }
    } else {
      // Produk contoh → ubah sementara di layar saja
      setProducts((prev) =>
        prev.map((p) =>
          p.id === editTarget.id
            ? {
                ...p,
                name: form.name.trim(),
                sku: form.sku.trim(),
                slug: form.slug,
                categoryLabel: getCategoryLabel(form.slug) ?? p.categoryLabel,
                price,
                stock,
                image: form.image,
              }
            : p,
        ),
      )
    }

    setSaving(false)
    closeEdit()
  }

  // === Aksi Hapus ===

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)

    if (deleteTarget.persisted) {
      try {
        await fetch('/api/products/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: deleteTarget.id }),
        })
      } catch {
        // Mode prototipe: tetap hapus dari layar walau API gagal
      }
    }

    setProducts((prev) => prev.filter((p) => p.id !== deleteTarget.id))
    setDeleting(false)
    setDeleteTarget(null)
  }

  // === Aksi Arsip ===

  // Mengarsipkan / memulihkan produk. Diarsipkan = tetap di OMS, tapi hilang dari ecommerce.
  async function toggleArchive(product: Product) {
    const next = !product.archived

    if (product.persisted) {
      try {
        await fetch('/api/products/update', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: product.id, archived: next }),
        })
      } catch {
        // Mode prototipe: tetap ubah status di layar walau API gagal
      }
    }

    setProducts((prev) =>
      prev.map((p) => (p.id === product.id ? { ...p, archived: next } : p)),
    )
  }

  return (
    <>
      <OmsHeader title="Produk" notificationCount={3} />
      <div className="p-6 md:p-8">
        {/* === Header Halaman === */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Manajemen Produk &amp; Inventaris</h1>
            <p className="mt-1 text-sm text-gray-500">
              Kelola varian, harga, dan perbarui stok gudang aktif Infarm.
            </p>
          </div>
          <Link
            href="/oms/dashboard/products/upload"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
          >
            <PlusIcon />
            Tambah Produk Baru
          </Link>
        </header>

        {/* === Ringkasan Stok === */}
        <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SummaryCard label="Total Produk" value={`${summary.total} Item`} valueClass="text-gray-900" accentClass="bg-emerald-50 text-emerald-700" icon={<BoxIcon />} />
          <SummaryCard label="Stok Menipis" value={`${summary.lowStock} Produk`} valueClass="text-amber-500" accentClass="bg-amber-50 text-amber-500" icon={<AlertIcon />} />
          <SummaryCard label="Stok Habis" value={`${summary.outOfStock} Produk`} valueClass="text-red-600" accentClass="bg-red-50 text-red-600" icon={<EmptyIcon />} />
        </section>

        {/* === Filter Rentang Penjualan (kolom Terjual) === */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-gray-600">Terjual dalam:</span>
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
            {SALES_RANGES.map((range) => (
              <button
                key={range.label}
                type="button"
                onClick={() => setRangeDays(range.days)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  rangeDays === range.days
                    ? 'bg-emerald-700 text-white'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>

        {/* === Tabel Produk === */}
        <section className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-5 py-3.5">Produk</th>
                  <th className="px-5 py-3.5">SKU / Kode</th>
                  <th className="px-5 py-3.5">Kategori</th>
                  <th className="px-5 py-3.5">Harga</th>
                  <th className="px-5 py-3.5">Sisa Stok</th>
                  <th className="px-5 py-3.5">Terjual</th>
                  <th className="px-5 py-3.5 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {products.map((product) => (
                  <tr key={product.id} className={`hover:bg-gray-50/70 ${product.archived ? 'bg-gray-50/60' : ''}`}>
                    <td className="px-5 py-4">
                      <div className={`flex items-center gap-3 ${product.archived ? 'opacity-60' : ''}`}>
                        <div className="relative h-11 w-11 flex-none overflow-hidden rounded-lg border border-gray-200 bg-gray-100">
                          <Image src={product.image} alt={product.name} fill unoptimized sizes="44px" className="object-cover" />
                        </div>
                        <div>
                          <span className="font-medium text-gray-900">{product.name}</span>
                          {product.archived && (
                            <span className="ml-2 inline-flex rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                              Diarsipkan
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className={`px-5 py-4 font-mono text-xs text-gray-500 ${product.archived ? 'opacity-60' : ''}`}>{product.sku}</td>
                    <td className={`px-5 py-4 ${product.archived ? 'opacity-60' : ''}`}>
                      <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                        {product.categoryLabel}
                      </span>
                    </td>
                    <td className={`px-5 py-4 text-gray-700 ${product.archived ? 'opacity-60' : ''}`}>{formatRupiah(product.price)}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <StockBadge stock={product.stock} />
                        {/* Arsip cepat untuk produk stok habis yang belum diarsipkan */}
                        {product.stock === 0 && !product.archived && (
                          <button
                            type="button"
                            onClick={() => toggleArchive(product)}
                            className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-amber-600"
                          >
                            <ArchiveIcon />
                            Arsipkan
                          </button>
                        )}
                      </div>
                    </td>
                    {/* Terjual dalam rentang waktu terpilih */}
                    <td className={`px-5 py-4 ${product.archived ? 'opacity-60' : ''}`}>
                      <span className="font-semibold text-gray-900">
                        {(soldCounts[product.id] ?? 0).toLocaleString('id-ID')}
                      </span>
                      <span className="ml-1 text-xs text-gray-400">pcs</span>
                    </td>
                    {/* Aksi: Edit + Arsip + Hapus */}
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(product)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50"
                        >
                          <PencilIcon />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleArchive(product)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
                          title={product.archived ? 'Pulihkan ke ecommerce' : 'Arsipkan (sembunyikan dari ecommerce)'}
                        >
                          {product.archived ? <RestoreIcon /> : <ArchiveIcon />}
                          {product.archived ? 'Pulihkan' : 'Arsip'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(product)}
                          aria-label={`Hapus ${product.name}`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* === Modal Edit Produk === */}
      {editTarget && form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" aria-label="Tutup modal" onClick={closeEdit} className="absolute inset-0 bg-gray-900/50" />
          <div className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-gray-900">Edit Produk</h3>
            <p className="mt-1 text-sm text-gray-500">
              {editTarget.persisted ? 'Perubahan disimpan permanen & tampil di ecommerce.' : 'Produk contoh — perubahan hanya sementara di layar.'}
            </p>

            {/* Foto */}
            <div className="mt-4 flex items-center gap-4">
              <div className="relative h-20 w-20 flex-none overflow-hidden rounded-lg border border-gray-200 bg-gray-100">
                <Image src={form.image} alt={form.name} fill unoptimized sizes="80px" className="object-cover" />
              </div>
              <label className="cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-600 transition hover:bg-gray-50">
                Ganti Foto
                <input type="file" accept="image/*" className="hidden" onChange={(e) => { handleEditImage(e.target.files); e.target.value = '' }} />
              </label>
            </div>

            {/* Nama & SKU */}
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <EditField label="Nama Produk">
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={modalInput} />
              </EditField>
              <EditField label="SKU / Kode">
                <input type="text" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className={modalInput} />
              </EditField>
            </div>

            {/* Kategori */}
            <div className="mt-4">
              <EditField label="Kategori">
                <select value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value as ProductCategory })} className={modalInput}>
                  <option value="" disabled>Pilih kategori…</option>
                  {PRODUCT_CATEGORIES.map((c) => (
                    <option key={c.slug} value={c.slug}>{c.label}</option>
                  ))}
                </select>
              </EditField>
            </div>

            {/* Harga & Stok */}
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <EditField label="Harga (Rp)">
                <input type="number" min={0} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) })} className={modalInput} />
              </EditField>
              <EditField label="Sisa Stok (pcs)">
                <input type="number" min={0} value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) })} className={modalInput} />
              </EditField>
            </div>

            {editError && <p className="mt-3 text-xs font-medium text-red-600">{editError}</p>}

            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={closeEdit} className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50">
                Batal
              </button>
              <button type="button" onClick={handleSaveEdit} disabled={saving} className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60">
                {saving ? 'Menyimpan…' : 'Simpan Perubahan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === Modal Konfirmasi Hapus === */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" aria-label="Tutup modal" onClick={() => setDeleteTarget(null)} className="absolute inset-0 bg-gray-900/50" />
          <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-600">
              <TrashIcon />
            </div>
            <h3 className="mt-4 text-lg font-bold text-gray-900">Hapus Produk?</h3>
            <p className="mt-1 text-sm text-gray-500">
              Produk <span className="font-semibold text-gray-700">{deleteTarget.name}</span> akan dihapus
              {deleteTarget.persisted ? ' permanen dan tidak lagi tampil di ecommerce.' : ' dari daftar (sementara).'}
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setDeleteTarget(null)} className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50">
                Batal
              </button>
              <button type="button" onClick={handleDelete} disabled={deleting} className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60">
                {deleting ? 'Menghapus…' : 'Ya, Hapus'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// === Sub-komponen ===

const modalInput =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100'

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700">{label}</label>
      {children}
    </div>
  )
}

function SummaryCard({
  label,
  value,
  valueClass,
  accentClass,
  icon,
}: {
  label: string
  value: string
  valueClass: string
  accentClass: string
  icon: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className={`flex h-11 w-11 flex-none items-center justify-center rounded-lg ${accentClass}`}>{icon}</div>
      <div>
        <p className="text-sm text-gray-500">{label}</p>
        <p className={`text-xl font-bold ${valueClass}`}>{value}</p>
      </div>
    </div>
  )
}

// Badge sisa stok dengan indikator warna: hijau (aman), kuning (menipis), merah (habis)
function StockBadge({ stock }: { stock: number }) {
  if (stock === 0) {
    return <span className="inline-flex rounded-full bg-red-50 px-2.5 py-1 text-xs font-bold text-red-600">Habis (0)</span>
  }
  if (stock < LOW_STOCK_THRESHOLD) {
    return <span className="inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-600">{stock} pcs</span>
  }
  return <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">{stock} pcs</span>
}

// === Ikon (inline SVG) ===

function PlusIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}

function ArchiveIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="20" height="5" rx="1" />
      <path d="M4 8v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  )
}

function RestoreIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7v6h6" />
      <path d="M3 13a9 9 0 1 0 3-7.7L3 8" />
    </svg>
  )
}

function BoxIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

function EmptyIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  )
}
