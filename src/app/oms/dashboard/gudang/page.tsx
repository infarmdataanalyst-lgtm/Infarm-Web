'use client'

// src/app/oms/dashboard/gudang/page.tsx
// Halaman "Kelola Gudang" OMS — master data gudang: nama, alamat, origin id Mengantar (asal kirim),
// koordinat, gudang default, aktif/nonaktif.
//
// Kenapa halaman terpisah dari Pengaturan: gudang adalah data berjumlah banyak (list + CRUD),
// bukan satu nilai setting. Stok per gudang TIDAK diatur di sini — itu urusan form produk /
// halaman stok, karena ritme pemakaiannya berbeda (harian vs sesekali).
//
// Operasi data via API Route /api/warehouses/* (bukan server action) sesuai pola OMS lain.
// Semua endpoint itu ADMIN ONLY karena memuat origin id & koordinat gudang.

import { useEffect, useState } from 'react'
import { CheckCircle2, MapPin, Pencil, Plus, Star, Trash2, Warehouse as WarehouseIcon } from 'lucide-react'
import OmsHeader from '@/components/oms/OmsHeader'
import GudangTabs from '@/components/oms/GudangTabs'
import {
  validateWarehouseForm,
  WAREHOUSE_FIELD_ORDER,
  type WarehouseErrors,
  type WarehouseFormValues,
} from '@/lib/warehouse-validation'
import type { Warehouse } from '@/types/warehouse'

// Baris gudang + jumlah keterikatan data (dari endpoint list) → menentukan aksi hapus boleh atau tidak.
type WarehouseRow = Warehouse & { usage?: { stockRows: number; orders: number } }

const EMPTY_FORM: WarehouseFormValues = {
  nama: '',
  alamat: '',
  mengantarOriginId: '',
  latitude: '',
  longitude: '',
}

export default function GudangPage() {
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [toast, setToast] = useState('')

  // Modal form: null = tertutup, 'new' = tambah, string = id gudang yang diedit
  const [editing, setEditing] = useState<'new' | string | null>(null)
  const [form, setForm] = useState<WarehouseFormValues>(EMPTY_FORM)
  const [formDefault, setFormDefault] = useState(false)
  const [formActive, setFormActive] = useState(true)
  const [errors, setErrors] = useState<WarehouseErrors>({})
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // Konfirmasi hapus (id gudang yang sedang dikonfirmasi)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 3000)
    return () => clearTimeout(t)
  }, [toast])

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/warehouses/list')
      // `mode` dari endpoint sengaja diabaikan: sistem berjalan MULTI-GUDANG permanen, jadi tak ada
      // lagi yang perlu ditampilkan atau diubah dari halaman ini. Lihat catatan di handleToggleMode
      // yang dihapus bersama togglenya.
      const data = (await res.json().catch(() => ({}))) as {
        warehouses?: WarehouseRow[]
        error?: string
      }
      if (!res.ok) {
        setLoadError(data.error ?? 'Gagal memuat daftar gudang.')
        return
      }
      setWarehouses(data.warehouses ?? [])
      setLoadError('')
    } catch {
      setLoadError('Gagal memuat daftar gudang. Periksa koneksi lalu muat ulang.')
    } finally {
      setLoading(false)
    }
  }


  function openNew() {
    setForm(EMPTY_FORM)
    setFormDefault(warehouses.length === 0) // gudang pertama otomatis jadi default
    setFormActive(true)
    setErrors({})
    setFormError('')
    setEditing('new')
  }

  function openEdit(w: WarehouseRow) {
    setForm({
      nama: w.nama,
      alamat: w.alamat ?? '',
      mengantarOriginId: w.mengantarOriginId ?? '',
      latitude: w.latitude ?? '',
      longitude: w.longitude ?? '',
    })
    setFormDefault(w.isDefault)
    setFormActive(w.isActive)
    setErrors({})
    setFormError('')
    setEditing(w.id)
  }

  async function handleSave() {
    const found = validateWarehouseForm(form)
    setErrors(found)
    if (Object.keys(found).length > 0) {
      // Fokuskan field invalid pertama sesuai urutan form (pola sama dengan form produk)
      const first = WAREHOUSE_FIELD_ORDER.find((k) => found[k])
      if (first) document.getElementById(`wh-${first}`)?.focus()
      return
    }

    setSaving(true)
    setFormError('')
    const isNew = editing === 'new'
    const payload = {
      ...(isNew ? {} : { id: editing }),
      nama: form.nama,
      alamat: form.alamat,
      mengantarOriginId: form.mengantarOriginId,
      latitude: form.latitude === '' ? null : form.latitude,
      longitude: form.longitude === '' ? null : form.longitude,
      isDefault: formDefault,
      isActive: formActive,
    }

    try {
      const res = await fetch(isNew ? '/api/warehouses/create' : '/api/warehouses/update', {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; errors?: WarehouseErrors }
      if (!res.ok) {
        if (data.errors) setErrors(data.errors)
        setFormError(data.error ?? 'Gagal menyimpan gudang.')
        return
      }
      setEditing(null)
      setToast(isNew ? 'Gudang ditambahkan.' : 'Gudang diperbarui.')
      await load()
    } catch {
      setFormError('Gagal menyimpan gudang. Periksa koneksi lalu coba lagi.')
    } finally {
      setSaving(false)
    }
  }

  async function handleSetDefault(id: string) {
    try {
      const res = await fetch('/api/warehouses/set-default', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setToast(res.ok ? 'Gudang default diperbarui.' : (data.error ?? 'Gagal menetapkan default.'))
      if (res.ok) await load()
    } catch {
      setToast('Gagal menetapkan gudang default.')
    }
  }

  async function handleToggleActive(w: WarehouseRow) {
    try {
      const res = await fetch('/api/warehouses/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: w.id, isActive: !w.isActive }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setToast(
        res.ok
          ? w.isActive
            ? 'Gudang dinonaktifkan.'
            : 'Gudang diaktifkan.'
          : (data.error ?? 'Gagal mengubah status gudang.'),
      )
      if (res.ok) await load()
    } catch {
      setToast('Gagal mengubah status gudang.')
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/warehouses/delete?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setToast(res.ok ? 'Gudang dihapus.' : (data.error ?? 'Gagal menghapus gudang.'))
      setConfirmDelete(null)
      if (res.ok) await load()
    } catch {
      setToast('Gagal menghapus gudang.')
    }
  }

  // Gudang yang aman dihapus: bukan default & belum punya stok/pesanan
  function canDelete(w: WarehouseRow): boolean {
    if (w.isDefault) return false
    return (w.usage?.stockRows ?? 0) === 0 && (w.usage?.orders ?? 0) === 0
  }

  return (
    <>
      <OmsHeader title="Kelola Gudang" />

      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <GudangTabs />

        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-sm text-gray-500">
            {loading ? 'Memuat…' : `${warehouses.length} gudang terdaftar`}
          </p>
          <button
            type="button"
            onClick={openNew}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-bold text-white transition hover:brightness-90 active:scale-[0.99]"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Tambah Gudang
          </button>
        </div>

        {loadError && (
          <p className="mb-4 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-600">{loadError}</p>
        )}

        {/* Daftar gudang */}
        {!loading && warehouses.length === 0 && !loadError && (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
            <WarehouseIcon className="mx-auto h-8 w-8 text-gray-300" aria-hidden />
            <p className="mt-3 text-sm font-semibold text-gray-700">Belum ada gudang</p>
            <p className="mt-1 text-sm text-gray-500">
              Tambahkan gudang pertama beserta origin id Mengantar-nya agar cek ongkir bisa berjalan.
            </p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {warehouses.map((w) => (
            <div
              key={w.id}
              className={`rounded-2xl border bg-white p-4 shadow-sm ${
                w.isActive ? 'border-gray-200' : 'border-gray-200 opacity-70'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h3 className="truncate text-sm font-bold text-gray-900">{w.nama}</h3>
                    {w.isDefault && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-brand-light/40 px-2 py-0.5 text-[11px] font-bold text-brand-primary">
                        <Star className="h-3 w-3" aria-hidden />
                        Default
                      </span>
                    )}
                    {!w.isActive && (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-500">
                        Nonaktif
                      </span>
                    )}
                  </div>
                  {w.alamat && <p className="mt-1 text-xs leading-relaxed text-gray-500">{w.alamat}</p>}
                </div>

                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => openEdit(w)}
                    aria-label={`Edit ${w.nama}`}
                    className="rounded-lg border border-gray-200 p-2 text-gray-500 transition hover:bg-gray-50"
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  {canDelete(w) && (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(w.id)}
                      aria-label={`Hapus ${w.nama}`}
                      className="rounded-lg border border-red-200 p-2 text-red-600 transition hover:bg-red-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                </div>
              </div>

              {/* Data operasional */}
              <dl className="mt-3 space-y-1 text-xs">
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 text-gray-400">Origin ID</dt>
                  <dd className="min-w-0 flex-1 font-mono text-gray-700">
                    {w.mengantarOriginId ?? (
                      <span className="font-sans text-orange-600">belum diisi — ongkir pakai fallback env</span>
                    )}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 text-gray-400">Koordinat</dt>
                  <dd className="min-w-0 flex-1 text-gray-700">
                    {w.latitude !== undefined && w.longitude !== undefined ? (
                      <span className="inline-flex items-center gap-1 font-mono">
                        <MapPin className="h-3 w-3 text-gray-400" aria-hidden />
                        {w.latitude}, {w.longitude}
                      </span>
                    ) : (
                      <span className="text-gray-400">belum diisi (opsional)</span>
                    )}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 text-gray-400">Terpakai</dt>
                  <dd className="min-w-0 flex-1 text-gray-700">
                    {w.usage?.stockRows ?? 0} baris stok · {w.usage?.orders ?? 0} pesanan
                  </dd>
                </div>
              </dl>

              {/* Aksi status */}
              <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
                {!w.isDefault && (
                  <button
                    type="button"
                    onClick={() => handleSetDefault(w.id)}
                    className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
                  >
                    Jadikan Default
                  </button>
                )}
                {!w.isDefault && (
                  <button
                    type="button"
                    onClick={() => handleToggleActive(w)}
                    className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
                  >
                    {w.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                )}
                {w.isDefault && (
                  <p className="text-xs text-gray-400">
                    Gudang default tidak bisa dinonaktifkan atau dihapus.
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* === Modal form tambah/edit === */}
      {editing !== null && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl">
            <h2 className="text-base font-bold text-gray-900">
              {editing === 'new' ? 'Tambah Gudang' : 'Edit Gudang'}
            </h2>

            <div className="mt-4 space-y-3">
              <Field
                id="wh-nama"
                label="Nama Gudang"
                required
                error={errors.nama}
                value={form.nama}
                onChange={(v) => setForm({ ...form, nama: v })}
                placeholder="Gudang Utama Infarm"
              />
              <Field
                id="wh-alamat"
                label="Alamat"
                error={errors.alamat}
                value={form.alamat}
                onChange={(v) => setForm({ ...form, alamat: v })}
                placeholder="Jl. Contoh No. 1, Kota"
              />
              <Field
                id="wh-mengantarOriginId"
                label="Origin ID Mengantar"
                error={errors.mengantarOriginId}
                value={form.mengantarOriginId}
                onChange={(v) => setForm({ ...form, mengantarOriginId: v.trim() })}
                placeholder="5fc6461ef8f44b34aa4cd807"
                mono
                hint="_id kelurahan asal kirim. Dapatkan dari pencarian alamat Mengantar. Kosong = pakai nilai env sebagai fallback."
              />

              <div className="grid grid-cols-2 gap-3">
                <Field
                  id="wh-latitude"
                  label="Latitude"
                  error={errors.latitude}
                  value={form.latitude === '' ? '' : String(form.latitude)}
                  onChange={(v) => setForm({ ...form, latitude: parseCoord(v) })}
                  placeholder="-6.2"
                  mono
                />
                <Field
                  id="wh-longitude"
                  label="Longitude"
                  error={errors.longitude}
                  value={form.longitude === '' ? '' : String(form.longitude)}
                  onChange={(v) => setForm({ ...form, longitude: parseCoord(v) })}
                  placeholder="106.816"
                  mono
                />
              </div>
              <p className="text-xs leading-relaxed text-gray-500">
                Koordinat <strong>opsional</strong> dan TIDAK memengaruhi pemilihan gudang — pemilihan
                memakai perbandingan ongkir riil Mengantar. Disimpan untuk keperluan tampilan/peta
                nanti. Bila diisi, keduanya wajib.
              </p>

              <label className="flex items-start gap-2 rounded-xl bg-gray-50 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={formDefault}
                  onChange={(e) => setFormDefault(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[#00843b]"
                />
                <span className="text-xs leading-relaxed text-gray-700">
                  <strong>Jadikan gudang default.</strong> Dipakai seluruh sistem saat mode satu
                  gudang, dan menjadi fallback di mode multi. Gudang default sebelumnya otomatis
                  dilepas.
                </span>
              </label>

              <label className="flex items-start gap-2 rounded-xl bg-gray-50 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={formActive}
                  disabled={formDefault}
                  onChange={(e) => setFormActive(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[#00843b] disabled:opacity-50"
                />
                <span className="text-xs leading-relaxed text-gray-700">
                  <strong>Aktif.</strong> Hanya gudang aktif yang dipilih untuk pesanan baru.
                  {formDefault && ' Gudang default wajib aktif.'}
                </span>
              </label>

              {formError && <p className="text-xs font-medium text-red-600">{formError}</p>}
            </div>

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex-1 rounded-xl bg-brand-primary py-2.5 text-sm font-bold text-white transition hover:brightness-90 disabled:opacity-60"
              >
                {saving ? 'Menyimpan…' : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === Konfirmasi hapus === */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5">
            <h2 className="text-base font-bold text-gray-900">Hapus gudang ini?</h2>
            <p className="mt-1 text-sm leading-relaxed text-gray-500">
              Gudang ini belum punya stok maupun pesanan, jadi aman dihapus. Tindakan ini tidak bisa
              dibatalkan.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => handleDelete(confirmDelete)}
                className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white transition hover:brightness-90"
              >
                Hapus
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden />
          {toast}
        </div>
      )}
    </>
  )
}

// Mengubah teks input koordinat → number | ''. Menerima minus & titik desimal, menolak sisanya.
// Dikembalikan '' saat kosong (bukan 0) karena 0,0 adalah koordinat nyata.
function parseCoord(raw: string): number | '' {
  const cleaned = raw.replace(/[^\d.-]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.' || cleaned === '-.') return ''
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : ''
}

// Satu field teks dengan label, pesan error, dan hint opsional.
function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  error,
  hint,
  required,
  mono,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  error?: string
  hint?: string
  required?: boolean
  mono?: boolean
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-gray-700">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={!!error}
        className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-brand-primary/20 ${
          mono ? 'font-mono' : ''
        } ${error ? 'border-red-400' : 'border-gray-300 focus:border-brand-primary'}`}
      />
      {hint && !error && <p className="mt-1 text-xs leading-relaxed text-gray-500">{hint}</p>}
      {error && <p className="mt-1 text-xs font-medium text-red-600">{error}</p>}
    </div>
  )
}
