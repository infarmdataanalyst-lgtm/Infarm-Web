'use client'

// src/components/oms/VariantManagerModal.tsx
// Modal OMS untuk mengelola varian sebuah produk (tambah/edit/hapus/set default).
// Data via API /api/variants/{list,create,update,delete}. Validasi server; SKU unik dijaga DB.
// Dipakai dari halaman Manajemen Produk (tombol "Varian").

import { useEffect, useState } from 'react'
import type { ProductVariant } from '@/types/variant'
import { validateName, validateSkuFormat, validatePrice, validateStock } from '@/lib/product-validation'

// Bentuk draft form varian (harga/stok bisa string kosong saat mengetik)
type Draft = { name: string; sku: string; price: number | ''; stock: number | ''; isDefault: boolean }

const EMPTY_DRAFT: Draft = { name: '', sku: '', price: '', stock: '', isDefault: false }

// Modal kelola varian. onChanged dipanggil setelah setiap perubahan agar list produk bisa refresh.
export default function VariantManagerModal({
  productId,
  productName,
  onClose,
  onChanged,
}: {
  productId: string
  productName: string
  onClose: () => void
  onChanged?: () => void
}) {
  const [variants, setVariants] = useState<ProductVariant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [newDraft, setNewDraft] = useState<Draft>(EMPTY_DRAFT)
  const [adding, setAdding] = useState(false)

  // Muat varian saat modal dibuka
  useEffect(() => {
    let active = true
    fetch(`/api/variants/list?productId=${encodeURIComponent(productId)}`)
      .then((res) => res.json())
      .then((data: { variants?: ProductVariant[] }) => {
        if (active) setVariants(data.variants ?? [])
      })
      .catch(() => setError('Gagal memuat varian.'))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [productId])

  function draftError(d: Draft): string | undefined {
    return validateName(d.name) ?? validateSkuFormat(d.sku) ?? validatePrice(d.price) ?? validateStock(d.stock)
  }

  // Tambah varian baru
  async function handleAdd() {
    const err = draftError(newDraft)
    if (err) {
      setError(err)
      return
    }
    setAdding(true)
    setError('')
    try {
      const res = await fetch('/api/variants/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          name: newDraft.name.trim(),
          sku: newDraft.sku.trim(),
          price: Number(newDraft.price),
          stock: Number(newDraft.stock),
          isDefault: newDraft.isDefault,
        }),
      })
      const data = (await res.json()) as { variant?: ProductVariant; error?: string }
      if (!res.ok || !data.variant) {
        setError(data.error ?? 'Gagal menambah varian.')
        return
      }
      // Muat ulang agar flag default lain ikut ter-update
      await reload()
      setNewDraft(EMPTY_DRAFT)
      onChanged?.()
    } catch {
      setError('Terjadi kesalahan jaringan.')
    } finally {
      setAdding(false)
    }
  }

  async function reload() {
    const res = await fetch(`/api/variants/list?productId=${encodeURIComponent(productId)}`)
    const data = (await res.json()) as { variants?: ProductVariant[] }
    setVariants(data.variants ?? [])
  }

  // Simpan perubahan sebuah varian
  async function handleSave(id: string, d: Draft) {
    const err = draftError(d)
    if (err) {
      setError(err)
      return false
    }
    setError('')
    const res = await fetch('/api/variants/update', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        productId,
        name: d.name.trim(),
        sku: d.sku.trim(),
        price: Number(d.price),
        stock: Number(d.stock),
        isDefault: d.isDefault,
      }),
    })
    const data = (await res.json()) as { error?: string }
    if (!res.ok) {
      setError(data.error ?? 'Gagal menyimpan varian.')
      return false
    }
    await reload()
    onChanged?.()
    return true
  }

  // Hapus varian
  async function handleDelete(id: string) {
    setError('')
    const res = await fetch('/api/variants/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, productId }),
    })
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      setError(data.error ?? 'Gagal menghapus varian.')
      return
    }
    setVariants((prev) => prev.filter((v) => v.id !== id))
    onChanged?.()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Tutup modal" onClick={onClose} className="absolute inset-0 bg-gray-900/50" />
      <div className="relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-bold text-gray-900">Kelola Varian</h3>
        <p className="mt-1 text-sm text-gray-500">
          Produk: <span className="font-semibold text-gray-700">{productName}</span>. Varian punya harga
          &amp; stok sendiri. Bila produk punya varian, harga/stok di ecommerce mengikuti varian.
        </p>

        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-600">{error}</p>}

        {/* Daftar varian */}
        <div className="mt-4 space-y-3">
          {loading ? (
            <p className="py-6 text-center text-sm text-gray-400">Memuat varian…</p>
          ) : variants.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-200 py-6 text-center text-sm text-gray-400">
              Belum ada varian. Tambahkan di bawah.
            </p>
          ) : (
            variants.map((v) => (
              <VariantRow key={v.id} variant={v} onSave={handleSave} onDelete={handleDelete} />
            ))
          )}
        </div>

        {/* Form tambah varian */}
        <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
          <p className="mb-3 text-sm font-semibold text-emerald-800">Tambah Varian Baru</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldInput label="Nama Varian" placeholder="mis. 50 Biji" value={newDraft.name} onChange={(name) => setNewDraft({ ...newDraft, name })} />
            <FieldInput label="SKU" placeholder="mis. BNH-MLN-50" value={newDraft.sku} onChange={(sku) => setNewDraft({ ...newDraft, sku })} />
            <FieldNumber label="Harga (Rp)" value={newDraft.price} onChange={(price) => setNewDraft({ ...newDraft, price })} />
            <FieldNumber label="Stok" value={newDraft.stock} onChange={(stock) => setNewDraft({ ...newDraft, stock })} />
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={newDraft.isDefault} onChange={(e) => setNewDraft({ ...newDraft, isDefault: e.target.checked })} className="h-4 w-4 accent-emerald-600" />
            Jadikan varian default (terpilih otomatis di halaman produk)
          </label>
          <button
            type="button"
            onClick={handleAdd}
            disabled={adding}
            className="mt-3 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-60"
          >
            {adding ? 'Menambah…' : '+ Tambah Varian'}
          </button>
        </div>

        <div className="mt-6 flex justify-end">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50">
            Selesai
          </button>
        </div>
      </div>
    </div>
  )
}

// === Baris varian (editable) ===
function VariantRow({
  variant,
  onSave,
  onDelete,
}: {
  variant: ProductVariant
  onSave: (id: string, d: Draft) => Promise<boolean>
  onDelete: (id: string) => void
}) {
  const [draft, setDraft] = useState<Draft>({
    name: variant.name,
    sku: variant.sku,
    price: variant.price,
    stock: variant.stock,
    isDefault: variant.isDefault,
  })
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const dirty =
    draft.name !== variant.name ||
    draft.sku !== variant.sku ||
    Number(draft.price) !== variant.price ||
    Number(draft.stock) !== variant.stock ||
    draft.isDefault !== variant.isDefault

  async function save() {
    setSaving(true)
    await onSave(variant.id, draft)
    setSaving(false)
  }

  return (
    <div className="rounded-xl border border-gray-200 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FieldInput label="Nama Varian" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
        <FieldInput label="SKU" value={draft.sku} onChange={(sku) => setDraft({ ...draft, sku })} />
        <FieldNumber label="Harga (Rp)" value={draft.price} onChange={(price) => setDraft({ ...draft, price })} />
        <FieldNumber label="Stok" value={draft.stock} onChange={(stock) => setDraft({ ...draft, stock })} />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={draft.isDefault} onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })} className="h-4 w-4 accent-emerald-600" />
          Default
        </label>
        <div className="flex items-center gap-2">
          {confirmDelete ? (
            <>
              <span className="text-xs text-gray-500">Hapus?</span>
              <button type="button" onClick={() => onDelete(variant.id)} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700">
                Ya
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50">
                Batal
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={save}
                disabled={!dirty || saving}
                className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50"
              >
                {saving ? 'Menyimpan…' : 'Simpan'}
              </button>
              <button type="button" onClick={() => setConfirmDelete(true)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50">
                Hapus
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// === Field kecil ===
function FieldInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
      />
    </label>
  )
}

function FieldNumber({
  label,
  value,
  onChange,
}: {
  label: string
  value: number | ''
  onChange: (v: number | '') => void
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          const d = e.target.value.replace(/\D/g, '')
          onChange(d === '' ? '' : Number(d))
        }}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
      />
    </label>
  )
}
