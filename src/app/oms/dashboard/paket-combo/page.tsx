'use client'

// src/app/oms/dashboard/paket-combo/page.tsx
// Halaman Daftar Paket & Combo OMS.
// Menampilkan tabel combo (harga normal & hemat dihitung otomatis), filter status,
// aksi Edit / Aktif-Nonaktif / Hapus, empty state, dan toast sukses.
// Operasi data lewat API Routes (/api/combos/*) sesuai pola OMS.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, Pencil, Power, PowerOff, Trash2, Boxes, CheckCircle2 } from 'lucide-react'
import OmsHeader from '@/components/oms/OmsHeader'
import { formatRupiah } from '@/lib/format'
import { calcNormalPrice, type ProductCombo } from '@/types/combo'

type StatusFilter = 'all' | 'active' | 'inactive'

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'active', label: 'Aktif' },
  { key: 'inactive', label: 'Nonaktif' },
]

// Ringkas daftar nama produk: maksimal 3 nama, sisanya jadi "+N lainnya".
function summarizeProducts(combo: ProductCombo): string {
  const names = combo.items.map((i) => i.name)
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 3).join(', ')} +${names.length - 3} lainnya`
}

export default function PaketComboPage() {
  const [combos, setCombos] = useState<ProductCombo[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<StatusFilter>('all')

  // Toast sukses
  const [toast, setToast] = useState<string | null>(null)

  // Aksi per-baris yang sedang berjalan (loading state)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProductCombo | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Ambil daftar combo
  useEffect(() => {
    let active = true
    fetch('/api/combos/list')
      .then((res) => res.json())
      .then((data: { combos?: ProductCombo[] }) => {
        if (!active) return
        setCombos(data.combos ?? [])
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  // Tampilkan toast bila datang dari form (?toast=created|updated), lalu bersihkan URL.
  // Pakai window.location (bukan useSearchParams) agar tidak perlu Suspense boundary.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get('toast')
    if (param === 'created') showToast('Combo berhasil dibuat.')
    else if (param === 'updated') showToast('Perubahan combo berhasil disimpan.')
    if (param) window.history.replaceState(null, '', '/oms/dashboard/paket-combo')
  }, [])

  // Tampilkan toast yang otomatis hilang setelah 3 detik
  function showToast(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(null), 3000)
  }

  const filtered = useMemo(() => {
    if (filter === 'active') return combos.filter((c) => c.isActive)
    if (filter === 'inactive') return combos.filter((c) => !c.isActive)
    return combos
  }, [combos, filter])

  // === Aksi: Aktif / Nonaktif ===
  async function toggleActive(combo: ProductCombo) {
    setTogglingId(combo.id)
    const next = !combo.isActive
    try {
      const res = await fetch('/api/combos/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: combo.id, isActive: next }),
      })
      if (!res.ok) throw new Error()
      setCombos((prev) => prev.map((c) => (c.id === combo.id ? { ...c, isActive: next } : c)))
      showToast(next ? 'Combo diaktifkan.' : 'Combo dinonaktifkan.')
    } catch {
      showToast('Gagal mengubah status combo.')
    } finally {
      setTogglingId(null)
    }
  }

  // === Aksi: Hapus ===
  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch('/api/combos/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deleteTarget.id }),
      })
      if (!res.ok) throw new Error()
      setCombos((prev) => prev.filter((c) => c.id !== deleteTarget.id))
      showToast('Combo berhasil dihapus.')
    } catch {
      showToast('Gagal menghapus combo.')
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  return (
    <>
      <OmsHeader title="Paket & Combo" notificationCount={3} />
      <div className="p-6 md:p-8">
        {/* === Header Halaman === */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Paket &amp; Combo</h1>
            <p className="mt-1 text-sm text-gray-500">
              Gabungkan beberapa produk menjadi satu paket hemat untuk pelanggan.
            </p>
          </div>
          <Link
            href="/oms/dashboard/paket-combo/baru"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
          >
            <Plus className="h-4 w-4" />
            Buat Combo Baru
          </Link>
        </header>

        {/* === Filter status === */}
        <div className="mt-6 inline-flex rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${
                filter === f.key ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* === Tabel Combo / Empty State === */}
        <section className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {loading ? (
            <div className="p-10 text-center text-sm text-gray-400">Memuat combo…</div>
          ) : filtered.length === 0 ? (
            <EmptyState hasAny={combos.length > 0} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-5 py-3.5">Nama Combo</th>
                    <th className="px-5 py-3.5">Produk Tergabung</th>
                    <th className="px-5 py-3.5">Harga Normal</th>
                    <th className="px-5 py-3.5">Harga Combo</th>
                    <th className="px-5 py-3.5">Hemat</th>
                    <th className="px-5 py-3.5">Status</th>
                    <th className="px-5 py-3.5 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((combo) => {
                    const normal = calcNormalPrice(combo.items)
                    const savings = Math.max(0, normal - combo.comboPrice)
                    const percent = normal > 0 ? Math.round((savings / normal) * 100) : 0
                    return (
                      <tr key={combo.id} className={`hover:bg-gray-50/70 ${combo.isActive ? '' : 'bg-gray-50/60'}`}>
                        <td className="px-5 py-4">
                          <span className="font-medium text-gray-900">{combo.name}</span>
                        </td>
                        <td className="px-5 py-4 text-gray-500">{summarizeProducts(combo)}</td>
                        <td className="px-5 py-4 text-gray-400 line-through">{formatRupiah(normal)}</td>
                        <td className="px-5 py-4 font-semibold text-gray-900">{formatRupiah(combo.comboPrice)}</td>
                        <td className="px-5 py-4">
                          <span className="font-semibold text-emerald-700">{formatRupiah(savings)}</span>
                          {percent > 0 && <span className="ml-1 text-xs text-emerald-600">({percent}%)</span>}
                        </td>
                        <td className="px-5 py-4">
                          {combo.isActive ? (
                            <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                              Aktif
                            </span>
                          ) : (
                            <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-500">
                              Nonaktif
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center justify-end gap-2">
                            <Link
                              href={`/oms/dashboard/paket-combo/${combo.id}/edit`}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Edit
                            </Link>
                            <button
                              type="button"
                              onClick={() => toggleActive(combo)}
                              disabled={togglingId === combo.id}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 disabled:opacity-60"
                              title={combo.isActive ? 'Nonaktifkan combo' : 'Aktifkan combo'}
                            >
                              {combo.isActive ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                              {togglingId === combo.id ? '…' : combo.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(combo)}
                              aria-label={`Hapus ${combo.name}`}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* === Modal Konfirmasi Hapus === */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" aria-label="Tutup modal" onClick={() => setDeleteTarget(null)} className="absolute inset-0 bg-gray-900/50" />
          <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-600">
              <Trash2 className="h-5 w-5" />
            </div>
            <h3 className="mt-4 text-lg font-bold text-gray-900">Hapus combo ini?</h3>
            <p className="mt-1 text-sm text-gray-500">
              <span className="font-semibold text-gray-700">{deleteTarget.name}</span> akan dihapus.
              Tindakan ini tidak dapat dibatalkan.
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

      {/* === Toast sukses === */}
      {toast && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 md:left-auto md:right-6 md:translate-x-0">
          <div className="flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-3 text-sm font-medium text-white shadow-lg">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            {toast}
          </div>
        </div>
      )}
    </>
  )
}

// === Sub-komponen ===

// Empty state: berbeda saat memang belum ada combo vs hanya filter yang kosong
function EmptyState({ hasAny }: { hasAny: boolean }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
        <Boxes className="h-7 w-7" />
      </div>
      <h3 className="mt-4 text-base font-bold text-gray-900">
        {hasAny ? 'Tidak ada combo pada filter ini' : 'Belum ada paket / combo'}
      </h3>
      <p className="mt-1 max-w-sm text-sm text-gray-500">
        {hasAny
          ? 'Coba ganti filter status untuk melihat combo lainnya.'
          : 'Gabungkan beberapa produk menjadi satu paket hemat untuk mulai menjual combo.'}
      </p>
      {!hasAny && (
        <Link
          href="/oms/dashboard/paket-combo/baru"
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800"
        >
          <Plus className="h-4 w-4" />
          Buat Combo Baru
        </Link>
      )}
    </div>
  )
}
