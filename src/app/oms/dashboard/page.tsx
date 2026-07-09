// src/app/oms/dashboard/page.tsx
// Halaman Dashboard OMS — Ringkasan Operasional Infarm.
// Berisi kartu statistik, grafik tren penjualan, tabel pesanan terbaru, dan widget stok rendah.
// TODO: ganti seluruh data dummy dengan query Supabase setelah OMS dibangun.

import Link from 'next/link'
import {
  Wallet,
  ShoppingBag,
  Boxes,
  Star,
  TrendingUp,
  TrendingDown,
  Download,
  Calendar,
  Trophy,
} from 'lucide-react'
import OmsHeader from '@/components/oms/OmsHeader'
import SalesChart from '@/components/oms/SalesChart'
import { readOrders, getBestSellingProducts } from '@/lib/mock-db/orders'
import type { OrderPaymentStatus, BestSellingProduct } from '@/types/order'

// Dashboard membaca order asli dari mock DB → selalu segarkan, jangan di-cache
export const dynamic = 'force-dynamic'

// === Tipe Data ===

type Stat = {
  label: string
  value: string
  delta: number // persentase pertumbuhan; 0 = tetap
  icon: typeof Wallet
  accent: string // kelas warna untuk wadah ikon
}

type LowStock = {
  name: string
  sku: string
  stock: number
  max: number
}

// === Data Dummy ===

const LOW_STOCKS: LowStock[] = [
  { name: 'Media Tanam Premium 5L', sku: 'MDT-PRM-5L', stock: 7, max: 100 },
  { name: 'Benih Cabai Rawit Unggul', sku: 'BNH-CBR-01', stock: 5, max: 100 },
  { name: 'Pupuk Organik Cair (POC) 1L', sku: 'PPK-POC-1L', stock: 22, max: 80 },
  { name: 'Pot Polybag 25cm (isi 10)', sku: 'POT-PLB-25', stock: 45, max: 100 },
]

// === Helper ===

function formatRupiah(value: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(value)
}

export default async function DashboardPage() {
  // Baca pesanan asli & produk terlaris dari mock DB (data dari checkout ecommerce)
  const [orders, bestSellers] = await Promise.all([
    readOrders(),
    getBestSellingProducts({ limit: 5 }),
  ])

  // 5 pesanan terbaru untuk widget "Pesanan Terbaru" (data disimpan newest-first)
  const recentOrders = orders.slice(0, 5)

  // Pendapatan = jumlah total pesanan yang sudah Lunas
  const totalRevenue = orders
    .filter((o) => o.paymentStatus === 'Lunas')
    .reduce((sum, o) => sum + o.totalAmount, 0)

  // Statistik dihitung dari data asli (kartu Produk Aktif & Rating masih dummy)
  const STATS: Stat[] = [
    {
      label: 'Total Pendapatan',
      value: formatRupiah(totalRevenue),
      delta: 12.5,
      icon: Wallet,
      accent: 'bg-emerald-50 text-emerald-700',
    },
    {
      label: 'Total Pesanan',
      value: orders.length.toLocaleString('id-ID'),
      delta: 8.2,
      icon: ShoppingBag,
      accent: 'bg-blue-50 text-blue-600',
    },
    {
      label: 'Produk Aktif',
      value: '450',
      delta: 0,
      icon: Boxes,
      accent: 'bg-amber-50 text-amber-600',
    },
    {
      label: 'Rata-rata Rating',
      value: '4.8/5.0',
      delta: 0.1,
      icon: Star,
      accent: 'bg-yellow-50 text-yellow-500',
    },
  ]

  return (
    <>
      <OmsHeader title="Dashboard" notificationCount={3} />

      <main className="p-6 md:p-8">
        {/* === Header Section === */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Ringkasan Operasional</h2>
            <p className="mt-1 text-sm text-gray-500">
              Pantau performa bisnis Anda secara real-time hari ini.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50"
            >
              <Calendar className="h-4 w-4" />
              Terakhir 30 Hari
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800"
            >
              <Download className="h-4 w-4" />
              Ekspor Laporan
            </button>
          </div>
        </div>

        {/* === Baris Statistik === */}
        <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {STATS.map((stat) => (
            <StatCard key={stat.label} stat={stat} />
          ))}
        </section>

        {/* === Area Grafik === */}
        <section className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h3 className="text-lg font-bold text-gray-900">Tren Penjualan Bulanan</h3>
              <p className="mt-1 text-sm text-gray-500">
                Analisis performa penjualan selama 6 bulan terakhir.
              </p>
            </div>
            <div className="hidden items-center gap-4 text-xs text-gray-500 sm:flex">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-700" />
                Penjualan
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
                Target
              </span>
            </div>
          </div>
          <SalesChart />
        </section>

        {/* === Widget Produk Terlaris === */}
        <section className="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <div className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-amber-500" />
              <h3 className="text-lg font-bold text-gray-900">Produk Terlaris</h3>
            </div>
            <Link
              href="/oms/dashboard/products"
              className="text-sm font-semibold text-emerald-700 hover:text-emerald-800"
            >
              Kelola Produk →
            </Link>
          </div>
          <div className="px-6 py-5">
            {bestSellers.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">
                Belum ada penjualan. Data terlaris muncul setelah ada pesanan lunas.
              </p>
            ) : (
              <ol className="space-y-4">
                {bestSellers.map((product, index) => (
                  <BestSellerRow key={product.productId} product={product} rank={index + 1} />
                ))}
              </ol>
            )}
          </div>
        </section>

        {/* === Grid Bawah: Pesanan Terbaru + Stok Rendah === */}
        <section className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Tabel Pesanan Terbaru */}
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm lg:col-span-2">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <h3 className="text-lg font-bold text-gray-900">Pesanan Terbaru</h3>
              <Link
                href="/oms/dashboard/orders"
                className="text-sm font-semibold text-emerald-700 hover:text-emerald-800"
              >
                Lihat Semua →
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  <tr>
                    <th className="px-6 py-3">No. Invoice</th>
                    <th className="px-6 py-3">Pelanggan</th>
                    <th className="px-6 py-3">Total</th>
                    <th className="px-6 py-3">Pembayaran</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {recentOrders.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-10 text-center text-sm text-gray-400">
                        Belum ada pesanan masuk.
                      </td>
                    </tr>
                  ) : (
                    recentOrders.map((order) => (
                      <tr key={order.orderId} className="hover:bg-gray-50/70">
                        <td className="px-6 py-4 font-semibold text-gray-900">
                          {order.orderId.startsWith('#') ? order.orderId : `#${order.orderId}`}
                        </td>
                        <td className="px-6 py-4 text-gray-700">{order.customerName}</td>
                        <td className="px-6 py-4 text-gray-700">
                          {formatRupiah(order.totalAmount)}
                        </td>
                        <td className="px-6 py-4">
                          <PaymentBadge status={order.paymentStatus} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Widget Stok Rendah */}
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <h3 className="text-lg font-bold text-gray-900">Stok Rendah</h3>
              <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-bold text-red-600">
                {LOW_STOCKS.length} Peringatan
              </span>
            </div>
            <div className="space-y-5 px-6 py-5">
              {LOW_STOCKS.map((item) => (
                <LowStockRow key={item.sku} item={item} />
              ))}
              <Link
                href="/oms/dashboard/products"
                className="block w-full rounded-lg border border-gray-200 py-2.5 text-center text-sm font-semibold text-gray-600 transition hover:bg-gray-50"
              >
                Kelola Persediaan
              </Link>
            </div>
          </div>
        </section>
      </main>
    </>
  )
}

// === Sub-komponen ===

// Kartu statistik dengan ikon, nilai besar, dan indikator pertumbuhan
function StatCard({ stat }: { stat: Stat }) {
  const Icon = stat.icon
  const isUp = stat.delta > 0
  const isFlat = stat.delta === 0
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${stat.accent}`}>
          <Icon className="h-5 w-5" />
        </div>
        {/* Indikator pertumbuhan */}
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
            isFlat
              ? 'bg-gray-100 text-gray-500'
              : isUp
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-red-50 text-red-600'
          }`}
        >
          {isFlat ? (
            'Tetap'
          ) : (
            <>
              {isUp ? (
                <TrendingUp className="h-3 w-3" />
              ) : (
                <TrendingDown className="h-3 w-3" />
              )}
              {isUp ? '+' : ''}
              {stat.delta}%
            </>
          )}
        </span>
      </div>
      <p className="mt-4 text-sm text-gray-500">{stat.label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{stat.value}</p>
    </div>
  )
}

// Badge status pembayaran berwarna (pill)
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

// Baris produk terlaris: peringkat, nama, unit terjual, dan total pendapatan
function BestSellerRow({ product, rank }: { product: BestSellingProduct; rank: number }) {
  // Peringkat 1-3 diberi warna medali; sisanya netral
  const rankColor =
    rank === 1
      ? 'bg-amber-100 text-amber-700'
      : rank === 2
        ? 'bg-gray-100 text-gray-600'
        : rank === 3
          ? 'bg-orange-100 text-orange-700'
          : 'bg-gray-50 text-gray-400'

  return (
    <li className="flex items-center gap-4">
      <span
        className={`flex h-8 w-8 flex-none items-center justify-center rounded-full text-sm font-bold ${rankColor}`}
      >
        {rank}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-gray-900">{product.name}</p>
        <p className="text-xs text-gray-400">{formatRupiah(product.totalRevenue)}</p>
      </div>
      <span className="flex-none text-sm font-bold text-emerald-700">
        {product.totalSold.toLocaleString('id-ID')} terjual
      </span>
    </li>
  )
}

// Baris stok rendah dengan progress bar berwarna sesuai tingkat kekritisan
function LowStockRow({ item }: { item: LowStock }) {
  const ratio = item.stock / item.max
  // Merah jika sangat kritis (<15%), kuning jika menipis, selebihnya emerald
  const barColor =
    ratio < 0.15 ? 'bg-red-500' : ratio < 0.4 ? 'bg-amber-400' : 'bg-emerald-600'
  const textColor =
    ratio < 0.15 ? 'text-red-600' : ratio < 0.4 ? 'text-amber-600' : 'text-emerald-700'

  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-gray-400">SKU: {item.sku}</p>
          <p className="text-sm font-semibold text-gray-900">{item.name}</p>
        </div>
        <span className={`flex-none text-sm font-bold ${textColor}`}>
          {item.stock}/{item.max}
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full ${barColor}`}
          style={{ width: `${Math.max(ratio * 100, 4)}%` }}
        />
      </div>
    </div>
  )
}
