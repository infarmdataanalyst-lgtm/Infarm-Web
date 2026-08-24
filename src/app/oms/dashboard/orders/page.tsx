'use client'

// src/app/oms/dashboard/orders/page.tsx
// Halaman Manajemen Pesanan OMS Infarm dengan filter tanggal, kurir, status pembayaran, & sorting.
// Membaca pesanan via GET /api/orders/list dengan query params untuk filter server-side.
// Filter tersimpan di URL query params untuk persistence saat reload/share link.

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Download, ChevronLeft, ChevronRight, Inbox, Eye, AlertTriangle } from 'lucide-react'
import OmsHeader from '@/components/oms/OmsHeader'
import OrderStatusModal from '@/components/oms/OrderStatusModal'
import WarehouseMultiFilter from '@/components/oms/WarehouseMultiFilter'
import type {
  Order,
  OrderFulfillmentStatus,
  OrderPaymentStatus,
} from '@/types/order'

// Shortcut tanggal untuk filter range
type DateShortcut = {
  label: string
  days: number
  isMonthStart?: boolean
}
const DATE_SHORTCUTS: DateShortcut[] = [
  { label: 'Hari Ini', days: 0 },
  { label: '7 Hari', days: 7 },
  { label: 'Bulan Ini', days: 0, isMonthStart: true },
]

// Jeda polling sinkronisasi status kurir selama tab OMS dibuka.
// 90 detik: cukup rapat untuk terasa hidup bagi admin yang sedang memantau, cukup longgar untuk
// tidak menghujani API kurir. Scan kurir sendiri tertunda menit-an, jadi memperkecil angka ini
// tak membuat datanya lebih segar — hanya menambah panggilan.
const SYNC_INTERVAL_MS = 90_000

// === Konfigurasi Tab & Pagination ===

// Tab filter; 'Semua' = tanpa filter, sisanya cocokkan dengan Order.status
const TABS: Array<'Semua' | OrderFulfillmentStatus> = [
  'Semua',
  'Menunggu Pembayaran',
  'Diproses',
  'Dikirim',
  'Selesai',
  'Dibatalkan',
]

const PAGE_SIZE = 10

// Nilai filter gudang untuk pesanan lama yang belum punya gudang pemenuh (warehouse_id NULL).
// Harus sama dengan WAREHOUSE_FILTER_NONE di src/lib/mock-db/orders.ts.
const WAREHOUSE_NONE = 'none'

// Label kolom Gudang untuk pesanan tanpa gudang pemenuh (pesanan sebelum fitur multi-gudang,
// atau gudangnya sudah dihapus).
const WAREHOUSE_UNSET_LABEL = 'Belum ditentukan'

// Wrapper: useSearchParams (di OrdersContent) wajib dibungkus <Suspense> agar build Next.js tidak error.
export default function OrdersPage() {
  return (
    <Suspense fallback={<OmsHeader title="Pesanan" />}>
      <OrdersContent />
    </Suspense>
  )
}

function OrdersContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // === State ===
  const [orders, setOrders] = useState<Order[]>([])
  const [couriers, setCouriers] = useState<string[]>([])
  // Gudang aktif untuk dropdown filter (dari endpoint list, bukan /api/warehouses/list — supaya
  // halaman ini tetap satu request).
  const [warehouses, setWarehouses] = useState<{ id: string; nama: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [toast, setToast] = useState('')
  // Waktu sinkronisasi terakhir dengan kurir. null = belum pernah (atau gagal terus).
  const [syncedAt, setSyncedAt] = useState<Date | null>(null)

  // === Filter State (baca dari URL searchParams) ===
  const activeTab = (searchParams.get('status') as (typeof TABS)[number]) || 'Semua'
  const dari = searchParams.get('dari') || ''
  const sampai = searchParams.get('sampai') || ''
  const kurir = searchParams.get('kurir') || ''
  // Gudang = MULTI-SELECT. Di URL disimpan sebagai daftar berkoma (`gudang=id1,id2`), pola sama
  // dengan `?category=a,b` di katalog. Array kosong = "Semua gudang" (tanpa filter).
  const gudang = searchParams.get('gudang') || ''
  const gudangList = gudang ? gudang.split(',').filter(Boolean) : []
  const pembayaran = (searchParams.get('pembayaran') as OrderPaymentStatus | null) || null
  const sortBy = (searchParams.get('sortBy') as 'total' | 'tanggal' | null) || null
  const order = (searchParams.get('order') as 'asc' | 'desc' | null) || null

  // Auto-sembunyikan toast
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 3000)
    return () => clearTimeout(t)
  }, [toast])

  // Ganti data order di tabel (in-place) setelah update sukses, lalu tutup modal + toast
  function handleUpdated(updated: Order) {
    setOrders((prev) => prev.map((o) => (o.orderId === updated.orderId ? updated : o)))
    setSelectedOrder(null)
    setToast(`Status pesanan ${updated.orderId} diperbarui menjadi "${updated.status}".`)
  }

  // Ambil pesanan dengan filter dari URL params
  useEffect(() => {
    let active = true
    setLoading(true)

    // Build query string dari filter state
    const params = new URLSearchParams()
    if (dari) params.set('dari', dari)
    if (sampai) params.set('sampai', sampai)
    if (kurir) params.set('kurir', kurir)
    if (gudang) params.set('gudang', gudang)
    if (pembayaran) params.set('pembayaran', pembayaran)
    if (sortBy) params.set('sortBy', sortBy)
    if (order) params.set('order', order)
    if (activeTab !== 'Semua') params.set('status', activeTab)

    const queryString = params.toString()
    const url = `/api/orders/list${queryString ? '?' + queryString : ''}`

    fetch(url)
      .then((res) => res.json())
      .then((data: { orders?: Order[]; couriers?: string[]; warehouses?: { id: string; nama: string }[] }) => {
        if (active) {
          setOrders(data.orders ?? [])
          if (data.couriers) setCouriers(data.couriers)
          if (data.warehouses) setWarehouses(data.warehouses)
        }
      })
      .catch(() => {
        if (active) setOrders([])
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [dari, sampai, kurir, gudang, pembayaran, sortBy, order, activeTab])

  // Pesanan untuk halaman saat ini (orders sudah di-filter di server)
  const totalPages = Math.max(1, Math.ceil(orders.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageOrders = orders.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  )

  // === Sinkronisasi status dari kurir ===
  //
  // Dipicu otomatis saat baris yang tampil berubah (buka halaman, refresh, ganti halaman/filter) —
  // TANPA tombol manual. Admin butuh data benar saat ia melihat layar, dan menyuruhnya mengklik
  // untuk itu hanya memindahkan pekerjaan ke orangnya.
  //
  // Dependensi effect ini sengaja `pageInvoices` (string nomor invoice), BUKAN `pageOrders`:
  // sinkronisasi mengubah `orders` → `pageOrders` jadi objek baru → effect jalan lagi → tak
  // berujung. Nomor invoice tak berubah saat status naik, jadi rantai itu putus.
  const pageInvoices = pageOrders.map((o) => o.orderId).join(',')

  useEffect(() => {
    if (!pageInvoices) return
    let active = true

    async function sync() {
      try {
        const res = await fetch('/api/orders/sync-tracking', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invoices: pageInvoices.split(',') }),
        })
        if (!res.ok || !active) return
        const data: { updated?: { orderId: string; status: OrderFulfillmentStatus }[] } =
          await res.json()
        if (!active) return

        setSyncedAt(new Date())
        const changes = data.updated ?? []
        if (changes.length === 0) return

        // Baris di-patch di tempat, bukan memuat ulang seluruh tabel: memuat ulang akan
        // mengembalikan scroll & membuat layar berkedip untuk perubahan beberapa sel saja.
        // Konsekuensi yang disengaja: baris yang naik status bisa jadi tak lagi cocok dengan tab
        // filter aktif dan tetap tampil sampai muat ulang berikutnya — itu lebih jujur daripada
        // membuatnya hilang tepat saat admin sedang melihatnya.
        setOrders((prev) =>
          prev.map((o) => {
            const hit = changes.find((c) => c.orderId === o.orderId)
            return hit ? { ...o, status: hit.status } : o
          }),
        )
      } catch {
        // Gangguan jaringan: biarkan tabel apa adanya. Data DB tetap tampil, cuma tak sesegar
        // mungkin — jauh lebih baik daripada pesan error untuk sesuatu yang tak bisa
        // ditindaklanjuti admin.
      }
    }

    sync()

    // Polling ringan selama tab dibuka, supaya admin yang sedang memantau tak perlu me-refresh.
    // Dilewati saat tab tersembunyi: tak ada yang melihat = tak perlu memanggil kurir.
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') sync()
    }, SYNC_INTERVAL_MS)

    return () => {
      active = false
      clearInterval(timer)
    }
  }, [pageInvoices])

  // === Helper: Date Shortcuts ===
  function applyDateShortcut(days: number, isMonthStart: boolean = false) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const fromDate = new Date(today)
    if (isMonthStart) {
      fromDate.setDate(1)
    } else {
      fromDate.setDate(today.getDate() - days)
    }

    const formatDate = (d: Date) => d.toISOString().split('T')[0]
    return { dari: formatDate(fromDate), sampai: formatDate(today) }
  }

  // === Helper: Check if ANY filter is active ===
  function hasActiveFilters() {
    return !!(dari || sampai || kurir || gudang || pembayaran || sortBy || (activeTab !== 'Semua'))
  }

  // Nama gudang untuk ditampilkan di kolom tabel. warehouseName di-resolve server; kosong berarti
  // pesanan lama (warehouse_id NULL) atau gudangnya sudah dihapus.
  function warehouseLabel(o: Order): string {
    return o.warehouseName ?? WAREHOUSE_UNSET_LABEL
  }

  // === Helper: Reset all filters ===
  function resetFilters() {
    router.push('/oms/dashboard/orders', { scroll: false })
    setPage(1)
  }

  // === Helper: Update URL with new filter values ===
  function updateFilters(newFilters: Record<string, string | null | undefined>) {
    const params = new URLSearchParams(searchParams)

    Object.entries(newFilters).forEach(([key, value]) => {
      if (value === null || value === '') {
        params.delete(key)
      } else if (value !== undefined) {
        params.set(key, value)
      }
    })

    const queryString = params.toString()
    const href = `/oms/dashboard/orders${queryString ? '?' + queryString : ''}`
    router.push(href, { scroll: false })
    setPage(1)
  }

  // === Helper: Select tab (update URL) ===
  function selectTab(tab: (typeof TABS)[number]) {
    updateFilters({ status: tab === 'Semua' ? null : tab })
  }

  // === Helper: Ekspor pesanan ter-filter ke CSV ===
  // Mengekspor `orders` (sudah difilter server-side sesuai filter aktif) sebagai file CSV.
  function exportCsv() {
    if (orders.length === 0) return

    // Bungkus nilai dengan tanda kutip + escape kutip ganda (aman untuk koma/newline)
    const esc = (val: string | number | undefined | null): string => {
      const s = String(val ?? '')
      return `"${s.replace(/"/g, '""')}"`
    }

    const headers = [
      'No. Invoice',
      'Customer',
      'Telepon',
      'Total',
      'Kurir',
      'Layanan',
      'No. Resi',
      'Status Booking Kurir',
      'Pembayaran',
      'Status',
      'Gudang',
      'Tanggal',
    ]

    const rows = orders.map((o) =>
      [
        formatInvoice(o.orderId),
        o.customerName,
        o.customerPhone ?? '',
        o.totalAmount,
        o.logistics?.courier ?? '',
        o.logistics?.service ?? '',
        o.trackingNumber ?? '',
        o.shipmentStatus === 'FAILED' ? `GAGAL: ${o.shipmentError ?? ''}` : (o.shipmentStatus ?? ''),
        o.paymentStatus,
        o.status ?? '',
        warehouseLabel(o),
        formatDate(o.date),
      ]
        .map(esc)
        .join(','),
    )

    // BOM (﻿) agar Excel membaca UTF-8 dengan benar (karakter Indonesia)
    const csv = '﻿' + [headers.map(esc).join(','), ...rows].join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)

    // Nama file mengandung rentang tanggal filter bila ada, agar mudah dibedakan
    const rangeLabel = dari || sampai ? `_${dari || 'awal'}_sd_${sampai || 'kini'}` : ''
    const link = document.createElement('a')
    link.href = url
    link.download = `pesanan${rangeLabel}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <OmsHeader title="Pesanan" />

      <main className="p-6 md:p-8">
        {/* === Header Section === */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Manajemen Pesanan</h2>
            <p className="mt-1 text-sm text-gray-500">
              Kelola seluruh alur pesanan masuk dari berbagai channel penjualan.
            </p>
            {/* Penanda kesegaran data — menggantikan tombol "perbarui": admin cukup tahu data ini
                sesegar apa, tak perlu disuruh mengkliknya. */}
            {syncedAt && (
              <p className="mt-1 text-xs text-gray-400">
                Status kurir disinkronkan {formatClock(syncedAt)}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={exportCsv}
            disabled={loading || orders.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="h-4 w-4" />
            Ekspor Laporan
          </button>
        </div>

        {/* === Filter Section === */}
        <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Tanggal Dari */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Tanggal Dari
              </label>
              <input
                type="date"
                value={dari}
                onChange={(e) => updateFilters({ dari: e.target.value || null })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
              />
              {/* Date shortcuts */}
              <div className="mt-2 flex gap-1.5 flex-wrap">
                {DATE_SHORTCUTS.map((shortcut) => (
                  <button
                    key={shortcut.label}
                    type="button"
                    onClick={() => {
                      const { dari: d, sampai: s } = applyDateShortcut(
                        shortcut.days,
                        shortcut.isMonthStart,
                      )
                      updateFilters({ dari: d, sampai: s })
                    }}
                    className="text-xs px-2 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-medium transition"
                  >
                    {shortcut.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tanggal Sampai */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Tanggal Sampai
              </label>
              <input
                type="date"
                value={sampai}
                onChange={(e) => updateFilters({ sampai: e.target.value || null })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
              />
            </div>

            {/* Filter Kurir */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Kurir
              </label>
              <select
                value={kurir}
                onChange={(e) => updateFilters({ kurir: e.target.value || null })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
              >
                <option value="">Semua Kurir</option>
                {couriers.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* Filter Pembayaran */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Status Pembayaran
              </label>
              <select
                value={pembayaran || ''}
                onChange={(e) => updateFilters({ pembayaran: e.target.value || null })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
              >
                <option value="">Semua Status</option>
                <option value="Menunggu">Menunggu</option>
                <option value="Lunas">Lunas</option>
                <option value="Gagal">Gagal</option>
              </select>
            </div>

            {/* Filter Gudang — MULTI-SELECT, bisa dikombinasikan dengan filter lain
                (semua disaring di server). Bukan <select> native: elemen itu tak bisa memuat
                checkbox dan highlight opsinya digambar OS (biru), tak bisa diwarnai lewat CSS. */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Gudang</label>
              <WarehouseMultiFilter
                warehouses={warehouses}
                value={gudangList}
                onChange={(next) => updateFilters({ gudang: next.length > 0 ? next.join(',') : null })}
                noneValue={WAREHOUSE_NONE}
                noneLabel={WAREHOUSE_UNSET_LABEL}
              />
            </div>
          </div>

          {/* Sorting & Reset */}
          <div className="mt-4 flex items-center gap-3 pt-4 border-t border-gray-100">
            <label className="text-sm font-semibold text-gray-700">Urutkan:</label>
            <select
              value={sortBy || 'tanggal'}
              onChange={(e) => updateFilters({ sortBy: e.target.value })}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900"
            >
              <option value="tanggal">Tanggal</option>
              <option value="total">Total Pesanan</option>
            </select>

            <button
              type="button"
              onClick={() => updateFilters({ order: order === 'asc' ? 'desc' : 'asc' })}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
              title={order === 'asc' ? 'Ascending' : 'Descending'}
            >
              {order === 'asc' ? '↑' : '↓'}
              <span className="text-xs">{order === 'asc' ? 'Naik' : 'Turun'}</span>
            </button>

            {/* Reset Button - hanya tampil jika ada filter aktif */}
            {hasActiveFilters() && (
              <button
                type="button"
                onClick={resetFilters}
                className="ml-auto rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-100 transition"
              >
                Reset Filter
              </button>
            )}
          </div>
        </div>

        {/* === Tabs Status === */}
        <div className="mt-6 flex gap-6 overflow-x-auto border-b border-gray-200">
          {TABS.map((tab) => {
            const active = tab === activeTab
            return (
              <button
                key={tab}
                type="button"
                onClick={() => selectTab(tab)}
                className={`whitespace-nowrap border-b-2 pb-3 text-sm font-medium transition-colors ${
                  active
                    ? 'border-emerald-600 text-emerald-700'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                {tab}
              </button>
            )
          })}
        </div>

        {/* === Tabel Pesanan === */}
        <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-emerald-50/60 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-5 py-3.5">No. Invoice</th>
                  <th className="px-5 py-3.5">Customer</th>
                  <th className="px-5 py-3.5">Total</th>
                  <th className="px-5 py-3.5">Logistik</th>
                  <th className="px-5 py-3.5">No. Resi</th>
                  <th className="px-5 py-3.5">Pembayaran</th>
                  <th className="px-5 py-3.5">Status</th>
                  {/* Ditaruh setelah Status agar status pesanan & gudang pemenuhnya terbaca sekali scan */}
                  <th className="px-5 py-3.5">Gudang</th>
                  <th className="px-5 py-3.5">Tanggal</th>
                  <th className="px-5 py-3.5 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {/* Loading / kosong */}
                {loading ? (
                  <tr>
                    <td colSpan={10} className="px-5 py-12 text-center text-sm text-gray-400">
                      Memuat pesanan…
                    </td>
                  </tr>
                ) : pageOrders.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-5 py-16 text-center">
                      <Inbox className="mx-auto h-8 w-8 text-gray-300" />
                      <p className="mt-2 text-sm font-medium text-gray-500">
                        Belum ada pesanan
                      </p>
                      <p className="text-xs text-gray-400">
                        Pesanan dari checkout ecommerce akan muncul di sini.
                      </p>
                    </td>
                  </tr>
                ) : (
                  pageOrders.map((order) => (
                    <tr key={order.orderId} className="hover:bg-gray-50/70">
                      {/* No. Invoice */}
                      <td className="px-5 py-4 font-semibold text-emerald-700">
                        {formatInvoice(order.orderId)}
                      </td>
                      {/* Customer + telepon */}
                      <td className="px-5 py-4">
                        <p className="font-semibold text-gray-900">{order.customerName}</p>
                        {order.customerPhone && (
                          <p className="text-xs text-gray-400">{order.customerPhone}</p>
                        )}
                      </td>
                      {/* Total */}
                      <td className="px-5 py-4 font-semibold text-gray-900">
                        {formatRupiah(order.totalAmount)}
                      </td>
                      {/* Logistik */}
                      <td className="px-5 py-4">
                        {order.logistics ? (
                          <>
                            <p className="font-medium text-gray-700">
                              {order.logistics.courier}
                            </p>
                            <p className="text-xs text-gray-400">
                              {order.logistics.service}
                            </p>
                          </>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      {/* No. Resi — plus penanda bila booking kurir GAGAL.
                          Pembayaran sudah masuk pada titik itu, jadi baris seperti ini WAJIB
                          terlihat: tanpa penanda, resi kosong tak bisa dibedakan dari pesanan
                          yang memang belum waktunya dibooking. */}
                      <td className="px-5 py-4 font-mono text-xs text-gray-500">
                        {order.trackingNumber ? (
                          order.trackingNumber
                        ) : order.shipmentStatus === 'FAILED' ? (
                          <span
                            title={order.shipmentError ?? 'Booking kurir gagal'}
                            className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-red-50 px-2 py-1 font-sans text-[11px] font-semibold text-red-700"
                          >
                            <AlertTriangle className="h-3 w-3" />
                            Booking gagal
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      {/* Pembayaran */}
                      <td className="px-5 py-4">
                        <PaymentBadge status={order.paymentStatus} />
                      </td>
                      {/* Status alur */}
                      <td className="px-5 py-4">
                        {order.status ? (
                          <StatusBadge status={order.status} />
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      {/* Gudang pemenuh — pesanan lama (warehouse_id NULL) tampil netral, tak kosong */}
                      <td className="px-5 py-4">
                        {order.warehouseName ? (
                          <span className="text-gray-700">{order.warehouseName}</span>
                        ) : (
                          <span className="text-xs italic text-gray-400">{WAREHOUSE_UNSET_LABEL}</span>
                        )}
                      </td>
                      {/* Tanggal */}
                      <td className="px-5 py-4 whitespace-nowrap text-gray-500">
                        {formatDate(order.date)}
                      </td>
                      {/* Aksi: buka modal update status */}
                      <td className="px-5 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => setSelectedOrder(order)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Lihat Detail
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* === Footer: info jumlah + pagination === */}
          <div className="flex flex-col gap-3 border-t border-gray-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-gray-400">
              Menampilkan {pageOrders.length} dari {orders.length} pesanan
            </p>
            <div className="flex items-center gap-1.5">
              <PagerButton
                disabled={currentPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Halaman sebelumnya"
              >
                <ChevronLeft className="h-4 w-4" />
              </PagerButton>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPage(p)}
                  className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm font-semibold transition ${
                    p === currentPage
                      ? 'bg-emerald-700 text-white'
                      : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {p}
                </button>
              ))}
              <PagerButton
                disabled={currentPage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                aria-label="Halaman berikutnya"
              >
                <ChevronRight className="h-4 w-4" />
              </PagerButton>
            </div>
          </div>
        </div>
      </main>

      {/* === Modal update status pesanan === */}
      {selectedOrder && (
        <OrderStatusModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onUpdated={handleUpdated}
        />
      )}

      {/* === Toast sukses === */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2" role="status">
          <p className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white shadow-lg">
            {toast}
          </p>
        </div>
      )}
    </>
  )
}

// === Sub-komponen & Helper ===

function PagerButton({
  children,
  disabled,
  onClick,
  ...rest
}: React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
      {...rest}
    >
      {children}
    </button>
  )
}

// Badge pembayaran: Lunas=hijau, Menunggu=kuning, Gagal=merah
function PaymentBadge({ status }: { status: OrderPaymentStatus }) {
  const styles: Record<OrderPaymentStatus, string> = {
    Lunas: 'bg-emerald-50 text-emerald-700',
    Menunggu: 'bg-amber-50 text-amber-600',
    Gagal: 'bg-red-50 text-red-600',
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${styles[status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  )
}

// Badge status alur pesanan dengan warna per tahap
function StatusBadge({ status }: { status: OrderFulfillmentStatus }) {
  const styles: Record<OrderFulfillmentStatus, string> = {
    'Menunggu Pembayaran': 'text-amber-600',
    Diproses: 'text-blue-600',
    Dikirim: 'text-emerald-700',
    Selesai: 'text-gray-600',
    Dibatalkan: 'text-red-600',
  }
  // Tampilkan "Menunggu" agar ringkas, sisanya apa adanya
  const label = status === 'Menunggu Pembayaran' ? 'Menunggu' : status
  return <span className={`text-sm font-semibold ${styles[status]}`}>{label}</span>
}

// Jam:menit saja, mis. "12.07" — untuk penanda "disinkronkan". Tanpa tanggal: sinkronisasi selalu
// terjadi di sesi yang sedang berjalan, jadi tanggalnya tak menambah informasi.
function formatClock(d: Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
}

// Format angka ke Rupiah
function formatRupiah(value: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(value)
}

// Pastikan invoice diawali '#'
function formatInvoice(id: string): string {
  return id.startsWith('#') ? id : `#${id}`
}

// Format ISO date → "24 Mei 2024, 14:20"
function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const tanggal = new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d)
  const jam = new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
  return `${tanggal}, ${jam}`
}
