'use client'

// src/app/oms/dashboard/promosi/page.tsx
// Halaman Daftar Promosi OMS.
// Tabel promo: tipe (badge warna), minimal pembelian, nilai hadiah, periode, status
// (Aktif/Nonaktif/Kedaluwarsa), aksi Edit / Aktif-Nonaktif / Hapus. Filter status, empty state, toast.
// Status "Kedaluwarsa" dihitung di frontend (end_at lewat). Promo free_product yang stok hadiahnya
// habis ditandai "Stok Habis" & otomatis dianggap nonaktif. Operasi data via API Routes (/api/promotions/*).

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, Pencil, Power, PowerOff, Trash2, Megaphone, CheckCircle2, AlertTriangle } from 'lucide-react'
import OmsHeader from '@/components/oms/OmsHeader'
import { formatRupiah } from '@/lib/format'
import {
  PROMOTION_TYPE_LABELS,
  isPromotionExpired,
  type Promotion,
  type PromotionType,
} from '@/types/promotion'
import type { StoredProduct } from '@/types/product'

type StatusFilter = 'all' | 'active' | 'inactive' | 'expired'
type EffectiveStatus = 'active' | 'inactive' | 'expired'

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'active', label: 'Aktif' },
  { key: 'inactive', label: 'Nonaktif' },
  { key: 'expired', label: 'Kedaluwarsa' },
]

// Warna badge per tipe hadiah (pakai palet yang diizinkan: emerald/amber/orange/rose)
const TYPE_BADGE: Record<PromotionType, string> = {
  free_shipping: 'bg-emerald-50 text-emerald-700',
  free_product: 'bg-amber-100 text-amber-700',
  discount_nominal: 'bg-orange-100 text-orange-700',
  discount_percent: 'bg-rose-100 text-rose-700',
}

// Nilai hadiah yang ditampilkan di kolom tabel
function rewardText(promo: Promotion): string {
  switch (promo.type) {
    case 'free_shipping':
      return 'Gratis Ongkir'
    case 'free_product':
      return promo.freeProductName ?? '—'
    case 'discount_nominal':
      return formatRupiah(promo.discountValue ?? 0)
    case 'discount_percent':
      return `${promo.discountValue ?? 0}%`
  }
}

// Format tanggal pendek Indonesia, mis. "22 Okt 2026"
function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(d)
}

// Teks periode: rentang tanggal, atau "Tidak Terbatas" bila kosong
function periodText(promo: Promotion): string {
  if (!promo.startAt && !promo.endAt) return 'Tidak Terbatas'
  const start = promo.startAt ? formatDate(promo.startAt) : '—'
  const end = promo.endAt ? formatDate(promo.endAt) : 'seterusnya'
  return `${start} – ${end}`
}

export default function PromosiPage() {
  const [promotions, setPromotions] = useState<Promotion[]>([])
  const [stockById, setStockById] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<StatusFilter>('all')

  // "Sekarang" untuk hitung kedaluwarsa — diisi setelah mount (hindari Date.now() saat render)
  const [nowMs, setNowMs] = useState<number | null>(null)

  const [toast, setToast] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Promotion | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Ambil daftar promo + produk (untuk cek stok hadiah)
  useEffect(() => {
    let active = true
    Promise.all([
      fetch('/api/promotions/list').then((res) => res.json()),
      fetch('/api/products/list').then((res) => res.json()),
    ])
      .then(([promoData, productData]: [{ promotions?: Promotion[] }, { products?: StoredProduct[] }]) => {
        if (!active) return
        // Stempel "sekarang" diisi di callback (bukan badan effect) untuk hitung kedaluwarsa
        setNowMs(Date.now())
        setPromotions(promoData.promotions ?? [])
        const map: Record<string, number> = {}
        for (const p of productData.products ?? []) map[p.id] = p.stock
        setStockById(map)
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  // Toast dari form (?toast=created|updated), lalu bersihkan URL.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get('toast')
    if (param === 'created') showToast('Promo berhasil dibuat.')
    else if (param === 'updated') showToast('Perubahan promo berhasil disimpan.')
    if (param) window.history.replaceState(null, '', '/oms/dashboard/promosi')
  }, [])

  function showToast(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(null), 3000)
  }

  // Apakah produk hadiah promo free_product kehabisan stok
  function isOutOfStock(promo: Promotion): boolean {
    if (promo.type !== 'free_product') return false
    if (!promo.freeProductId) return true
    return (stockById[promo.freeProductId] ?? 0) <= 0
  }

  // Status efektif (dihitung frontend): kedaluwarsa > nonaktif (manual/stok habis) > aktif
  function getStatus(promo: Promotion): EffectiveStatus {
    if (nowMs !== null && isPromotionExpired(promo.endAt, nowMs)) return 'expired'
    if (!promo.isActive || isOutOfStock(promo)) return 'inactive'
    return 'active'
  }

  const filtered = useMemo(() => {
    if (filter === 'all') return promotions
    return promotions.filter((p) => getStatus(p) === filter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promotions, filter, nowMs, stockById])

  // === Aksi: Aktif / Nonaktif ===
  async function toggleActive(promo: Promotion) {
    setTogglingId(promo.id)
    const next = !promo.isActive
    try {
      const res = await fetch('/api/promotions/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: promo.id, isActive: next }),
      })
      if (!res.ok) throw new Error()
      setPromotions((prev) => prev.map((p) => (p.id === promo.id ? { ...p, isActive: next } : p)))
      showToast(next ? 'Promo diaktifkan.' : 'Promo dinonaktifkan.')
    } catch {
      showToast('Gagal mengubah status promo.')
    } finally {
      setTogglingId(null)
    }
  }

  // === Aksi: Hapus ===
  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch('/api/promotions/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deleteTarget.id }),
      })
      if (!res.ok) throw new Error()
      setPromotions((prev) => prev.filter((p) => p.id !== deleteTarget.id))
      showToast('Promo berhasil dihapus.')
    } catch {
      showToast('Gagal menghapus promo.')
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  return (
    <>
      <OmsHeader title="Promosi" notificationCount={3} />
      <div className="p-6 md:p-8">
        {/* === Header Halaman === */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Promosi</h1>
            <p className="mt-1 text-sm text-gray-500">
              Kelola promo gratis ongkir, gratis produk, dan diskon untuk pelanggan.
            </p>
          </div>
          <Link
            href="/oms/dashboard/promosi/baru"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
          >
            <Plus className="h-4 w-4" />
            Buat Promo Baru
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

        {/* === Tabel Promo / Empty State === */}
        <section className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {loading ? (
            <div className="p-10 text-center text-sm text-gray-400">Memuat promo…</div>
          ) : filtered.length === 0 ? (
            <EmptyState hasAny={promotions.length > 0} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-5 py-3.5">Nama Promo</th>
                    <th className="px-5 py-3.5">Tipe</th>
                    <th className="px-5 py-3.5">Minimal Pembelian</th>
                    <th className="px-5 py-3.5">Nilai Hadiah</th>
                    <th className="px-5 py-3.5">Periode</th>
                    <th className="px-5 py-3.5">Status</th>
                    <th className="px-5 py-3.5 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((promo) => {
                    const status = getStatus(promo)
                    const outOfStock = isOutOfStock(promo)
                    return (
                      <tr
                        key={promo.id}
                        className={`hover:bg-gray-50/70 ${status === 'expired' ? 'opacity-60' : ''} ${
                          status === 'inactive' ? 'bg-gray-50/60' : ''
                        }`}
                      >
                        <td className="px-5 py-4">
                          <span className="font-medium text-gray-900">{promo.name}</span>
                          {outOfStock && (
                            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600">
                              <AlertTriangle className="h-3 w-3" />
                              Stok Habis
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${TYPE_BADGE[promo.type]}`}>
                            {PROMOTION_TYPE_LABELS[promo.type]}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-gray-700">{formatRupiah(promo.minPurchase)}</td>
                        <td className="px-5 py-4 font-medium text-gray-900">{rewardText(promo)}</td>
                        <td className="px-5 py-4 text-gray-500">{periodText(promo)}</td>
                        <td className="px-5 py-4">
                          <StatusBadge status={status} />
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center justify-end gap-2">
                            <Link
                              href={`/oms/dashboard/promosi/${promo.id}/edit`}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Edit
                            </Link>
                            <button
                              type="button"
                              onClick={() => toggleActive(promo)}
                              disabled={togglingId === promo.id}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 disabled:opacity-60"
                              title={promo.isActive ? 'Nonaktifkan promo' : 'Aktifkan promo'}
                            >
                              {promo.isActive ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                              {togglingId === promo.id ? '…' : promo.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(promo)}
                              aria-label={`Hapus ${promo.name}`}
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
            <h3 className="mt-4 text-lg font-bold text-gray-900">Hapus promo ini?</h3>
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

function StatusBadge({ status }: { status: EffectiveStatus }) {
  if (status === 'active') {
    return <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Aktif</span>
  }
  if (status === 'expired') {
    return <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">Kedaluwarsa</span>
  }
  return <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-500">Nonaktif</span>
}

// Empty state: berbeda saat memang belum ada promo vs hanya filter yang kosong
function EmptyState({ hasAny }: { hasAny: boolean }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
        <Megaphone className="h-7 w-7" />
      </div>
      <h3 className="mt-4 text-base font-bold text-gray-900">
        {hasAny ? 'Tidak ada promo pada filter ini' : 'Belum ada promo'}
      </h3>
      <p className="mt-1 max-w-sm text-sm text-gray-500">
        {hasAny
          ? 'Coba ganti filter status untuk melihat promo lainnya.'
          : 'Buat promo gratis ongkir, gratis produk, atau diskon untuk menarik pelanggan.'}
      </p>
      {!hasAny && (
        <Link
          href="/oms/dashboard/promosi/baru"
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800"
        >
          <Plus className="h-4 w-4" />
          Buat Promo Baru
        </Link>
      )}
    </div>
  )
}
