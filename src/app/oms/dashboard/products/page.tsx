'use client'

// src/app/oms/dashboard/products/page.tsx
// Halaman Manajemen Produk & Inventaris OMS — area internal Infarm.
// Menampilkan ringkasan stok, tabel produk, dan modal update stok instan.
// Catatan: data masih dummy hardcode; akan diganti query Supabase setelah OMS dibangun.

import { useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import OmsHeader from '@/components/oms/OmsHeader'

// === Tipe Data ===

type Product = {
  id: string
  name: string
  sku: string
  category: string
  price: number
  stock: number
  image: string
}

// Ambang batas stok menipis (di bawah angka ini dianggap perlu restock)
const LOW_STOCK_THRESHOLD = 10

// === Dummy Data Produk ===
// TODO: ganti dengan query Supabase setelah OMS selesai
const INITIAL_PRODUCTS: Product[] = [
  {
    id: 'PRD-001',
    name: 'Benih Cabai Rawit Unggul',
    sku: 'BNH-CBR-01',
    category: 'Benih',
    price: 18000,
    stock: 124,
    image: '/images/product-placeholder.png',
  },
  {
    id: 'PRD-002',
    name: 'Media Tanam Premium 5L',
    sku: 'MDT-PRM-5L',
    category: 'Media Tanam',
    price: 32000,
    stock: 7,
    image: '/images/product-placeholder.png',
  },
  {
    id: 'PRD-003',
    name: 'Pot Polybag 25cm (isi 10)',
    sku: 'POT-PLB-25',
    category: 'Perlengkapan',
    price: 15000,
    stock: 0,
    image: '/images/product-placeholder.png',
  },
  {
    id: 'PRD-004',
    name: 'Pupuk Organik Cair 1L',
    sku: 'PPK-ORG-1L',
    category: 'Pupuk',
    price: 45000,
    stock: 58,
    image: '/images/product-placeholder.png',
  },
  {
    id: 'PRD-005',
    name: 'Benih Selada Hidroponik',
    sku: 'BNH-SLD-02',
    category: 'Benih',
    price: 22000,
    stock: 4,
    image: '/images/product-placeholder.png',
  },
]

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
  // Produk yang sedang diedit stoknya (null = modal tertutup)
  const [editing, setEditing] = useState<Product | null>(null)
  const [newStock, setNewStock] = useState<number | ''>('')

  // === Ringkasan stok (dihitung dari daftar produk) ===
  const summary = useMemo(() => {
    const total = products.length
    const lowStock = products.filter(
      (p) => p.stock > 0 && p.stock < LOW_STOCK_THRESHOLD,
    ).length
    const outOfStock = products.filter((p) => p.stock === 0).length
    return { total, lowStock, outOfStock }
  }, [products])

  // === Aksi Modal Update Stok ===

  // Membuka modal dan mengisi nilai awal dengan stok produk terpilih
  function openStockModal(product: Product) {
    setEditing(product)
    setNewStock(product.stock)
  }

  function closeStockModal() {
    setEditing(null)
    setNewStock('')
  }

  // Menyimpan stok baru ke daftar produk (lokal; nanti diganti update Supabase)
  function saveStock() {
    if (editing === null || newStock === '') return
    setProducts((prev) =>
      prev.map((p) =>
        p.id === editing.id ? { ...p, stock: Number(newStock) } : p,
      ),
    )
    closeStockModal()
  }

  return (
    <>
      <OmsHeader title="Produk" notificationCount={3} />
      <div className="p-6 md:p-8">
        {/* === Header Halaman === */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Manajemen Produk &amp; Inventaris
            </h1>
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

        {/* === Ringkasan Stok (3 Mini Cards) === */}
        <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SummaryCard
            label="Total Produk"
            value={`${summary.total} Item`}
            valueClass="text-gray-900"
            accentClass="bg-emerald-50 text-emerald-700"
            icon={<BoxIcon />}
          />
          <SummaryCard
            label="Stok Menipis"
            value={`${summary.lowStock} Produk`}
            valueClass="text-amber-500"
            accentClass="bg-amber-50 text-amber-500"
            icon={<AlertIcon />}
          />
          <SummaryCard
            label="Stok Habis"
            value={`${summary.outOfStock} Produk`}
            valueClass="text-red-600"
            accentClass="bg-red-50 text-red-600"
            icon={<EmptyIcon />}
          />
        </section>

        {/* === Tabel Produk === */}
        <section className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-5 py-3.5">Produk</th>
                  <th className="px-5 py-3.5">SKU / Kode</th>
                  <th className="px-5 py-3.5">Kategori</th>
                  <th className="px-5 py-3.5">Harga</th>
                  <th className="px-5 py-3.5">Sisa Stok</th>
                  <th className="px-5 py-3.5 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {products.map((product) => (
                  <tr key={product.id} className="hover:bg-gray-50/70">
                    {/* Foto & Nama Produk */}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="relative h-11 w-11 flex-none overflow-hidden rounded-lg border border-gray-200 bg-gray-100">
                          <Image
                            src={product.image}
                            alt={product.name}
                            fill
                            unoptimized
                            sizes="44px"
                            className="object-cover"
                          />
                        </div>
                        <span className="font-medium text-gray-900">
                          {product.name}
                        </span>
                      </div>
                    </td>
                    {/* SKU */}
                    <td className="px-5 py-4 font-mono text-xs text-gray-500">
                      {product.sku}
                    </td>
                    {/* Kategori */}
                    <td className="px-5 py-4">
                      <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                        {product.category}
                      </span>
                    </td>
                    {/* Harga */}
                    <td className="px-5 py-4 text-gray-700">
                      {formatRupiah(product.price)}
                    </td>
                    {/* Sisa Stok dengan indikator warna */}
                    <td className="px-5 py-4">
                      <StockBadge stock={product.stock} />
                    </td>
                    {/* Aksi */}
                    <td className="px-5 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => openStockModal(product)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50"
                      >
                        <PencilIcon />
                        Update Stok
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* === Modal Update Stok === */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Overlay */}
          <button
            type="button"
            aria-label="Tutup modal"
            onClick={closeStockModal}
            className="absolute inset-0 bg-gray-900/50"
          />
          {/* Panel */}
          <div className="relative z-10 w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-gray-900">Update Stok</h3>
            <p className="mt-1 text-sm text-gray-500">{editing.name}</p>

            {/* Info stok saat ini */}
            <div className="mt-4 flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">
              <span className="text-sm text-gray-500">Sisa stok saat ini</span>
              <span className="font-semibold text-gray-900">
                {editing.stock} pcs
              </span>
            </div>

            {/* Input stok baru */}
            <div className="mt-4">
              <label
                htmlFor="new-stock"
                className="block text-sm font-medium text-gray-700"
              >
                Jumlah Stok Baru
              </label>
              <input
                id="new-stock"
                type="number"
                min={0}
                value={newStock}
                onChange={(e) =>
                  setNewStock(
                    e.target.value === '' ? '' : Math.max(0, Number(e.target.value)),
                  )
                }
                className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                placeholder="Masukkan jumlah stok"
              />
            </div>

            {/* Tombol aksi modal */}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeStockModal}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={saveStock}
                disabled={newStock === ''}
                className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Simpan Perubahan
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// === Sub-komponen ===

// Kartu ringkasan stok di atas tabel
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
      <div
        className={`flex h-11 w-11 flex-none items-center justify-center rounded-lg ${accentClass}`}
      >
        {icon}
      </div>
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
    return (
      <span className="inline-flex rounded-full bg-red-50 px-2.5 py-1 text-xs font-bold text-red-600">
        Habis (0)
      </span>
    )
  }
  if (stock < LOW_STOCK_THRESHOLD) {
    return (
      <span className="inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-600">
        {stock} pcs
      </span>
    )
  }
  return (
    <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
      {stock} pcs
    </span>
  )
}

// === Ikon (inline SVG, tanpa dependensi tambahan) ===

function PlusIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

function BoxIcon() {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

function EmptyIcon() {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  )
}
