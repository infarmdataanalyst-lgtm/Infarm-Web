'use client'

// src/app/oms/dashboard/gudang/riwayat/page.tsx
// Halaman OMS "Riwayat Mutasi" — daftar kronologis perubahan stok (tabel stock_mutations).
//
// Sengaja tanpa filter canggih: nilainya ada pada pertanyaan "kenapa stok berubah?", dan itu
// terjawab oleh daftar terbaru + tautan per produk dari matrix Kelola Stok (?productId=).
//
// Empat sumber perubahan yang tercatat: edit manual di Kelola Stok, form produk, pesanan masuk,
// dan pembatalan pesanan. Perubahan yang dipicu pembeli tak punya "diubah oleh" — kolomnya
// menampilkan "Sistem (pembeli)".

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { AlertCircle, ArrowRight, History, Loader2 } from 'lucide-react'
import OmsHeader from '@/components/oms/OmsHeader'
import GudangTabs from '@/components/oms/GudangTabs'
import { STOCK_MUTATION_REASON_LABELS, type StockMutation } from '@/types/stock-mutation'

export default function RiwayatMutasiPage() {
  return (
    <Suspense
      fallback={
        <>
          <OmsHeader title="Riwayat Mutasi Stok" />
          <div className="p-4 sm:p-6">
            <GudangTabs />
          </div>
        </>
      }
    >
      <RiwayatContent />
    </Suspense>
  )
}

function RiwayatContent() {
  const searchParams = useSearchParams()
  const productId = searchParams.get('productId') ?? ''

  const [mutations, setMutations] = useState<StockMutation[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const url = productId
          ? `/api/stock-mutations/list?productId=${encodeURIComponent(productId)}`
          : '/api/stock-mutations/list'
        const res = await fetch(url)
        const data = (await res.json().catch(() => ({}))) as {
          mutations?: StockMutation[]
          error?: string
        }
        if (cancelled) return
        if (!res.ok) {
          setLoadError(data.error ?? 'Gagal memuat riwayat mutasi stok.')
          return
        }
        setMutations(data.mutations ?? [])
        setLoadError('')
      } catch {
        if (!cancelled) setLoadError('Gagal memuat riwayat. Periksa koneksi lalu muat ulang.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [productId])

  // Nama produk untuk judul saat halaman dibuka dari tautan riwayat per produk.
  const filteredProductName = useMemo(
    () => (productId ? mutations[0]?.productName : undefined),
    [productId, mutations],
  )

  return (
    <>
      <OmsHeader title="Riwayat Mutasi Stok" />
      <div className="p-4 sm:p-6">
        <GudangTabs />

        {productId && (
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-800">
              Riwayat: {filteredProductName ?? 'produk terpilih'}
            </span>
            <Link
              href="/oms/dashboard/gudang/riwayat"
              className="text-gray-500 underline-offset-2 transition hover:text-gray-700 hover:underline"
            >
              Tampilkan semua produk
            </Link>
          </div>
        )}

        {loadError && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
            <p>{loadError}</p>
          </div>
        )}

        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[860px] table-fixed text-sm">
            <colgroup>
              <col className="w-[150px]" />
              <col className="w-[280px]" />
              <col className="w-[150px]" />
              <col className="w-[130px]" />
              <col className="w-[150px]" />
              <col className="w-[160px]" />
            </colgroup>
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Waktu</th>
                <th className="px-4 py-3 font-semibold">Produk</th>
                <th className="px-4 py-3 font-semibold">Gudang</th>
                <th className="px-4 py-3 font-semibold">Stok</th>
                <th className="px-4 py-3 font-semibold">Alasan</th>
                <th className="px-4 py-3 font-semibold">Diubah oleh</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-emerald-600" />
                  </td>
                </tr>
              ) : mutations.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <History className="mx-auto h-8 w-8 text-gray-300" />
                    <p className="mt-2 text-sm font-medium text-gray-600">Belum ada riwayat mutasi</p>
                    <p className="mt-1 text-xs text-gray-500">
                      Riwayat mulai terisi begitu stok diubah dari{' '}
                      <Link
                        href="/oms/dashboard/gudang/stok"
                        className="font-medium text-emerald-700 hover:underline"
                      >
                        Kelola Stok
                      </Link>{' '}
                      atau ada pesanan masuk.
                    </p>
                  </td>
                </tr>
              ) : (
                mutations.map((m) => {
                  const delta = m.stokAfter - m.stokBefore
                  return (
                    <tr key={m.id} className="align-top hover:bg-gray-50/60">
                      <td className="px-4 py-3 text-xs text-gray-500">{formatDateTime(m.createdAt)}</td>
                      <td className="px-4 py-3">
                        <p className="line-clamp-2 font-medium text-gray-800" title={m.productName}>
                          {m.productName}
                        </p>
                        {m.variantName && (
                          <p className="mt-0.5 text-xs text-gray-500">Varian: {m.variantName}</p>
                        )}
                        {m.orderInvoice && (
                          <Link
                            href={`/track?order=${encodeURIComponent(m.orderInvoice)}`}
                            className="mt-0.5 inline-block font-mono text-xs text-emerald-700 hover:underline"
                          >
                            {m.orderInvoice}
                          </Link>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{m.warehouseName}</td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1.5 tabular-nums text-gray-700">
                          {m.stokBefore}
                          <ArrowRight className="h-3.5 w-3.5 text-gray-400" />
                          <strong className="text-gray-900">{m.stokAfter}</strong>
                        </span>
                        <span
                          className={`mt-0.5 inline-block text-xs font-semibold ${
                            delta > 0 ? 'text-emerald-700' : 'text-red-600'
                          }`}
                        >
                          {delta > 0 ? `+${delta}` : delta}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
                          {STOCK_MUTATION_REASON_LABELS[m.reason] ?? m.reason}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {m.changedByName ?? (
                          // Pesanan masuk / pembatalan oleh pembeli: tak ada admin yang bertanggung jawab.
                          <span className="text-gray-400">Sistem (pembeli)</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {!loading && mutations.length > 0 && (
          <p className="mt-3 text-sm text-gray-500">
            {mutations.length} perubahan terakhir (terbaru di atas)
          </p>
        )}
      </div>
    </>
  )
}

// Waktu lokal Indonesia, ringkas: "12 Agu 2026, 14:03"
function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
