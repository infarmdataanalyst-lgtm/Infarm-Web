'use client'

// src/app/oms/dashboard/orders/page.tsx
// Halaman Manajemen Pesanan OMS Infarm.
// Membaca pesanan asli dari mock database via GET /api/orders/list (data dari checkout ecommerce).
// Sidebar disediakan otomatis oleh layout /oms/dashboard.

import { useEffect, useMemo, useState } from 'react'
import { Download, ChevronLeft, ChevronRight, Inbox } from 'lucide-react'
import OmsHeader from '@/components/oms/OmsHeader'
import type {
  Order,
  OrderFulfillmentStatus,
  OrderPaymentStatus,
} from '@/types/order'

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

export default function OrdersPage() {
  // === State ===
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>('Semua')
  const [page, setPage] = useState(1)

  // Ambil pesanan asli dari mock database saat halaman dibuka
  useEffect(() => {
    let active = true
    fetch('/api/orders/list')
      .then((res) => res.json())
      .then((data: { orders?: Order[] }) => {
        if (active) setOrders(data.orders ?? [])
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
  }, [])

  // Pesanan terfilter sesuai tab aktif
  const filtered = useMemo(() => {
    if (activeTab === 'Semua') return orders
    return orders.filter((o) => o.status === activeTab)
  }, [orders, activeTab])

  // Pesanan untuk halaman saat ini
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageOrders = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  )

  // Reset ke halaman 1 setiap ganti tab
  function selectTab(tab: (typeof TABS)[number]) {
    setActiveTab(tab)
    setPage(1)
  }

  return (
    <>
      <OmsHeader title="Pesanan" notificationCount={3} />

      <main className="p-6 md:p-8">
        {/* === Header Section === */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Manajemen Pesanan</h2>
            <p className="mt-1 text-sm text-gray-500">
              Kelola seluruh alur pesanan masuk dari berbagai channel penjualan.
            </p>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800"
          >
            <Download className="h-4 w-4" />
            Ekspor Laporan
          </button>
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
                  <th className="px-5 py-3.5">Tanggal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {/* Loading / kosong */}
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-12 text-center text-sm text-gray-400">
                      Memuat pesanan…
                    </td>
                  </tr>
                ) : pageOrders.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-16 text-center">
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
                      {/* No. Resi */}
                      <td className="px-5 py-4 font-mono text-xs text-gray-500">
                        {order.trackingNumber ?? '—'}
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
                      {/* Tanggal */}
                      <td className="px-5 py-4 whitespace-nowrap text-gray-500">
                        {formatDate(order.date)}
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
              Menampilkan {pageOrders.length} dari {filtered.length} pesanan
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
