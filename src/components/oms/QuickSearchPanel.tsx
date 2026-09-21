'use client'

// src/components/oms/QuickSearchPanel.tsx
// Panel mengambang hasil pencarian cepat OMS. Posisi awal pojok kanan bawah; bisa digeser lewat
// kepalanya (klik dua kali untuk kembali ke posisi awal). Bertahan lintas halaman karena
// dirender di layout dashboard. Isinya kartu ringkas per pesanan: status, pembayaran, resi, gudang,
// total — plus tombol "Detail" yang membuka modal pesanan yang sama dengan halaman Pesanan.
//
// ── z-index ──
// z-[45]: di atas backdrop drawer sidebar mobile (z-40) supaya tetap bisa diklik, tapi DI BAWAH
// modal pesanan (z-50) — modal yang dibuka dari panel ini harus menutupinya, bukan sebaliknya.

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import Link from 'next/link'
import { Check, ChevronDown, ChevronUp, Copy, GripHorizontal, Loader2, X } from 'lucide-react'
import OrderStatusModal from '@/components/oms/OrderStatusModal'
import { useQuickSearch } from '@/components/oms/QuickSearchContext'
import { formatRupiah } from '@/lib/format'
import type { OmsSearchResult } from '@/types/oms-search'
import type { Order, OrderFulfillmentStatus, OrderPaymentStatus, RefundStatus } from '@/types/order'

// === Gaya badge (sejalan dengan halaman Pesanan OMS) ===

const STATUS_STYLE: Record<OrderFulfillmentStatus, string> = {
  'Menunggu Pembayaran': 'bg-amber-50 text-amber-700',
  Diproses: 'bg-blue-50 text-blue-700',
  Dikirim: 'bg-emerald-50 text-emerald-700',
  Selesai: 'bg-gray-100 text-gray-700',
  Dibatalkan: 'bg-red-50 text-red-700',
}

const PAYMENT_STYLE: Record<OrderPaymentStatus, string> = {
  Lunas: 'bg-emerald-50 text-emerald-700',
  Menunggu: 'bg-amber-50 text-amber-700',
  Gagal: 'bg-red-50 text-red-700',
}

const REFUND_LABEL: Record<RefundStatus, string> = {
  PERLU_REFUND: 'Perlu refund',
  SEDANG_DIPROSES: 'Refund diproses',
  SUDAH_REFUND: 'Sudah refund',
  TIDAK_PERLU: 'Refund tidak perlu',
}

const MATCH_LABEL: Record<OmsSearchResult['matchedBy'], string> = {
  invoice: 'cocok: invoice',
  resi: 'cocok: resi',
  phone: 'cocok: nomor HP',
  name: 'cocok: nama',
}

// "17 Sep 2026, 10.42"
function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Jakarta',
  }).format(d)
}

// Jarak minimum panel dari tepi layar saat digeser (px).
const EDGE_GAP = 8

type Position = { x: number; y: number }

// Menjaga panel tetap di dalam layar. Yang dipastikan terlihat adalah KEPALA panel (pegangan
// geser): selama itu masih bisa diraih, panel selalu bisa ditarik kembali.
function clampPosition(pos: Position, width: number, height: number): Position {
  const maxX = Math.max(EDGE_GAP, window.innerWidth - width - EDGE_GAP)
  const maxY = Math.max(EDGE_GAP, window.innerHeight - Math.min(height, window.innerHeight) - EDGE_GAP)
  return {
    x: Math.min(Math.max(pos.x, EDGE_GAP), maxX),
    y: Math.min(Math.max(pos.y, EDGE_GAP), maxY),
  }
}

// Panel hasil pencarian cepat. Tidak merender apa pun selama belum ada pencarian.
export default function QuickSearchPanel() {
  const qs = useQuickSearch()
  const [detail, setDetail] = useState<Order | null>(null)
  const [detailLoading, setDetailLoading] = useState<string | null>(null)
  const [detailError, setDetailError] = useState('')

  // === Posisi & geser ===
  // null = posisi bawaan (pojok kanan bawah, lewat kelas CSS). Begitu digeser, panel memakai
  // koordinat left/top. Posisi dilupakan saat panel ditutup: pencarian berikutnya selalu muncul
  // di tempat yang sudah dikenal admin.
  const panelRef = useRef<HTMLElement>(null)
  const [pos, setPos] = useState<Position | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragOffset = useRef<Position>({ x: 0, y: 0 })

  // Esc menutup panel — kecuali modal detail sedang terbuka (Esc milik modal itu).
  const isOpen = qs?.open ?? false
  const close = qs?.close
  const minimized = qs?.minimized ?? false
  const resultCount = qs?.data?.results.length ?? 0
  useEffect(() => {
    if (!isOpen || !close) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !detail) close?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, close, detail])

  // Panel ditutup → kembali ke posisi bawaan untuk pembukaan berikutnya. Disesuaikan SAAT RENDER
  // (pola "menyesuaikan state ketika prop berubah" dari dokumentasi React), bukan lewat effect,
  // supaya tidak ada render tambahan dengan posisi lama.
  const [wasOpen, setWasOpen] = useState(isOpen)
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen)
    if (!isOpen) setPos(null)
  }

  // Tinggi panel berubah (dibuka dari mode kecil, hasil baru masuk) atau jendela browser diubah
  // ukurannya → panel yang sudah digeser bisa terdorong keluar layar. Posisinya dijepit ulang.
  useLayoutEffect(() => {
    if (!pos || !panelRef.current) return
    const rect = panelRef.current.getBoundingClientRect()
    const clamped = clampPosition(pos, rect.width, rect.height)
    if (clamped.x !== pos.x || clamped.y !== pos.y) setPos(clamped)
  }, [pos, minimized, resultCount])

  useEffect(() => {
    if (!pos) return
    function onResize() {
      const el = panelRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setPos((p) => (p ? clampPosition(p, rect.width, rect.height) : p))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [pos])

  // Mulai geser dari kepala panel. Tombol di kepala (perkecil/tutup) tidak memulai geseran.
  function onDragStart(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    const el = panelRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    // Pointer capture: geseran tetap terbaca walau kursor bergerak lebih cepat dari panel dan
    // sempat keluar dari area kepala.
    e.currentTarget.setPointerCapture(e.pointerId)
    setPos({ x: rect.left, y: rect.top })
    setDragging(true)
  }

  function onDragMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging) return
    const el = panelRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPos(
      clampPosition(
        { x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y },
        rect.width,
        rect.height,
      ),
    )
  }

  function onDragEnd(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging) return
    setDragging(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  if (!qs || !qs.open) return null

  // Membuka modal pesanan lengkap. Data panel sengaja ramping, jadi pesanan utuh dibaca saat dibutuhkan.
  async function openDetail(invoice: string) {
    setDetailError('')
    setDetailLoading(invoice)
    try {
      const res = await fetch(`/api/oms/orders/detail?invoice=${encodeURIComponent(invoice)}`, {
        cache: 'no-store',
      })
      const body = (await res.json().catch(() => null)) as { order?: Order; error?: string } | null
      if (!res.ok || !body?.order) {
        setDetailError(body?.error ?? 'Gagal membuka detail pesanan.')
        return
      }
      setDetail(body.order)
    } catch {
      setDetailError('Tidak bisa terhubung ke server.')
    } finally {
      setDetailLoading(null)
    }
  }

  const { data, loading, error, query } = qs
  const count = data?.results.length ?? 0

  // Kata kunci yang ditawarkan ke halaman Produk / Kelola Stok saat pencarian NIHIL hasil.
  //
  // Dua keadaan yang sama-sama buntu bagi admin, dan keduanya perlu jalan keluar:
  //   - mode 'orders' dengan satu kata kunci tak dikenal → kemungkinan SKU produk yang salah kamar;
  //   - mode 'name' tanpa hasil → admin mengetik NAMA BARANG (mis. "polybag") ke kotak yang hanya
  //     mengenal nama pembeli. Ini yang paling sering terjadi, dan dulu justru tak ditawari apa pun.
  //
  // Mode 'phone' sengaja TIDAK ikut: nomor telepon tak pernah masuk akal dicari di katalog produk,
  // dan menawarkannya hanya membuat panel berisik.
  const fallbackTerm =
    count > 0 || !data
      ? null
      : data.mode === 'orders'
        ? (data.notFound.length === 1 ? (data.notFound[0] ?? null) : null)
        : data.mode === 'name'
          ? query.trim() || null
          : null

  return (
    <>
      <section
        ref={panelRef}
        aria-label="Hasil pencarian cepat"
        style={pos ? { left: pos.x, top: pos.y } : undefined}
        className={`fixed z-[45] flex w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl ${
          pos ? '' : 'bottom-4 right-4'
        } ${dragging ? 'ring-2 ring-emerald-400' : ''}`}
      >
        {/* === Kepala panel — sekaligus pegangan geser === */}
        <div
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          onDoubleClick={(e) => {
            if (!(e.target as HTMLElement).closest('button')) setPos(null)
          }}
          title="Geser untuk memindahkan · klik dua kali untuk kembali ke posisi awal"
          className={`flex touch-none select-none items-center gap-2 border-b border-gray-100 bg-emerald-950 px-4 py-2.5 text-white ${
            dragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
        >
          <GripHorizontal className="h-4 w-4 flex-none text-emerald-300" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Hasil pencarian</p>
            <p className="truncate text-xs text-emerald-200/80" title={query}>
              {loading ? 'Mencari…' : data ? `${count} pesanan · ${query}` : query}
            </p>
          </div>
          <button
            type="button"
            onClick={qs.toggleMinimized}
            aria-label={minimized ? 'Buka panel' : 'Perkecil panel'}
            className="rounded-lg p-1.5 text-emerald-200 transition hover:bg-emerald-900 hover:text-white"
          >
            {minimized ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={qs.close}
            aria-label="Tutup panel"
            className="rounded-lg p-1.5 text-emerald-200 transition hover:bg-emerald-900 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* === Isi panel === */}
        {!minimized && (
          <div className="max-h-[min(70vh,36rem)] space-y-2 overflow-y-auto bg-gray-50 p-3">
            {loading && (
              <p className="flex items-center gap-2 px-1 py-6 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Mencari pesanan…
              </p>
            )}

            {!loading && error && (
              <p className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>
            )}

            {detailError && (
              <p className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700">{detailError}</p>
            )}

            {!loading && data && (
              <>
                {data.results.map((r) => (
                  <ResultCard
                    key={`${r.orderId}-${r.matchedBy}`}
                    result={r}
                    opening={detailLoading === r.orderId}
                    onOpen={() => void openDetail(r.orderId)}
                  />
                ))}

                {data.truncated && (
                  <p className="px-1 text-xs text-gray-500">
                    Hanya 20 pesanan terbaru yang ditampilkan. Perjelas nama atau gunakan nomor pesanan.
                  </p>
                )}

                {count === 0 && data.mode !== 'orders' && (
                  <div className="px-1 py-4">
                    <p className="text-sm text-gray-500">Tidak ada pesanan yang cocok.</p>
                    {fallbackTerm && (
                      <>
                        <p className="mt-1 text-xs text-gray-400">
                          Kotak ini mencari pesanan. Kalau yang Anda maksud nama barang, lanjutkan ke:
                        </p>
                        <TautanLuar term={fallbackTerm} />
                      </>
                    )}
                  </div>
                )}

                {data.notFound.length > 0 && (
                  <div className="rounded-xl border border-dashed border-gray-300 bg-white px-3 py-2.5">
                    <p className="text-xs font-semibold text-gray-600">
                      Tidak ditemukan sebagai nomor pesanan atau resi ({data.notFound.length})
                    </p>
                    <p className="mt-1 break-all font-mono text-xs text-gray-500">
                      {data.notFound.join(', ')}
                    </p>
                    {/* Satu kata kunci yang tak cocok kemungkinan SKU/nama produk — tawarkan halaman
                        yang memang punya pencarian untuk itu, alih-alih jalan buntu. */}
                    {fallbackTerm && <TautanLuar term={fallbackTerm} />}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </section>

      {detail && (
        <OrderStatusModal
          order={detail}
          onClose={() => setDetail(null)}
          onUpdated={() => {
            setDetail(null)
            qs.rerun()
          }}
        />
      )}
    </>
  )
}

// === Kartu satu pesanan ===

// Dua tautan keluar: ke halaman yang MEMANG punya pencarian untuk barang.
//
// Dipakai di dua tempat (hasil nihil pada pencarian nama, dan kata kunci tak dikenal pada pencarian
// nomor) supaya keduanya tak pernah berbeda bunyi.
function TautanLuar({ term }: { term: string }) {
  const kunci = encodeURIComponent(term)
  return (
    <div className="mt-2 flex flex-wrap gap-2 text-xs">
      <Link
        href={`/oms/dashboard/products?q=${kunci}`}
        className="rounded-full border border-emerald-200 px-2.5 py-1 font-medium text-emerald-700 hover:bg-emerald-50"
      >
        Cari di Produk →
      </Link>
      <Link
        href={`/oms/dashboard/gudang/stok?search=${kunci}`}
        className="rounded-full border border-emerald-200 px-2.5 py-1 font-medium text-emerald-700 hover:bg-emerald-50"
      >
        Cari di Kelola Stok →
      </Link>
    </div>
  )
}

function ResultCard({
  result,
  opening,
  onOpen,
}: {
  result: OmsSearchResult
  opening: boolean
  onOpen: () => void
}) {
  return (
    <article className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <p className="truncate font-mono text-sm font-semibold text-gray-900">{result.orderId}</p>
            <CopyButton value={result.orderId} label="Salin nomor pesanan" />
          </div>
          <p className="truncate text-xs text-gray-500">
            {result.customerName} · {formatDateTime(result.date)}
          </p>
        </div>
        <span className="flex-none rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
          {MATCH_LABEL[result.matchedBy]}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {result.status && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[result.status]}`}>
            {result.status}
          </span>
        )}
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${PAYMENT_STYLE[result.paymentStatus]}`}>
          Bayar: {result.paymentStatus}
        </span>
        {result.refundStatus && (
          <span className="rounded-full bg-purple-50 px-2 py-0.5 text-xs font-semibold text-purple-700">
            {REFUND_LABEL[result.refundStatus]}
          </span>
        )}
      </div>

      <dl className="mt-2 grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1 text-xs">
        <dt className="text-gray-400">Metode</dt>
        <dd className="text-gray-700">{result.paymentMethodLabel ?? '—'}</dd>
        <dt className="text-gray-400">Resi</dt>
        <dd className="flex min-w-0 items-center gap-1 text-gray-700">
          {result.trackingNumber ? (
            <>
              <span className="truncate font-mono">{result.trackingNumber}</span>
              <CopyButton value={result.trackingNumber} label="Salin nomor resi" />
            </>
          ) : (
            <span className="text-gray-400">Belum terbit</span>
          )}
          {result.courier && <span className="text-gray-400">· {result.courier}</span>}
        </dd>
        <dt className="text-gray-400">Gudang</dt>
        <dd className="text-gray-700">{result.warehouseName ?? '—'}</dd>
        <dt className="text-gray-400">Total</dt>
        <dd className="font-semibold text-gray-900">{formatRupiah(result.totalAmount)}</dd>
      </dl>

      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={onOpen}
          disabled={opening}
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50"
        >
          {opening && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Detail &amp; ubah status
        </button>
      </div>
    </article>
  )
}

// Tombol salin kecil dengan tanda centang sesaat setelah berhasil.
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(value)
          .then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          })
          .catch(() => {})
      }}
      className="flex-none rounded p-0.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}
