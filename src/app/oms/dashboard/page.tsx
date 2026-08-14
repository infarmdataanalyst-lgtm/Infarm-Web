// src/app/oms/dashboard/page.tsx
// Halaman Dashboard OMS — Ringkasan Operasional Infarm.
//
// SEMUA angka di halaman ini berasal dari Supabase (tidak ada lagi data dummy): pendapatan
// dipecah per status pembayaran, tren pendapatan per bucket waktu, produk terlaris, pesanan
// terbaru, produk aktif, rata-rata rating, dan stok rendah.
//
// Periode aktif dibaca dari URL query params (?periode=&dari=&sampai=) supaya bisa
// di-bookmark/di-share; resolusinya (termasuk granularity chart) ada di
// src/lib/dashboard-period.ts, perhitungan pendapatannya di src/lib/dashboard-revenue.ts.
//
// CATATAN PENTING soal makna angka: selama Xendit belum terpasang, checkout menyimpan pesanan
// sebagai "Menunggu" pembayaran dan LANGSUNG memotong stok. Karena itu memajang satu angka
// "Total Pendapatan" gabungan menyesatkan — halaman ini WAJIB memisahkan uang yang sudah pasti
// masuk (Lunas) dari yang masih berpotensi batal (Pending). Jangan digabung lagi.

import Link from 'next/link'
import {
  Wallet,
  AlertTriangle,
  ShoppingBag,
  Receipt,
  TrendingUp,
  TrendingDown,
  Trophy,
  Info,
  PackageSearch,
} from 'lucide-react'
import OmsHeader from '@/components/oms/OmsHeader'
import RevenueChart from '@/components/oms/RevenueChart'
import DashboardPeriodFilter from '@/components/oms/DashboardPeriodFilter'
import DashboardTransition, { DashboardDim } from '@/components/oms/DashboardTransition'
import {
  getBestSellingProducts,
  getRecentOrders,
  readOrdersForRevenue,
} from '@/lib/mock-db/orders'
import { readProducts } from '@/lib/mock-db/products'
import {
  buildBuckets,
  granularityLabel,
  previousPeriod,
  resolvePeriod,
  toWibDateString,
} from '@/lib/dashboard-period'
import {
  averageOrderValue,
  bucketRevenue,
  growthPercent,
  REVENUE_CATEGORIES,
  REVENUE_COLORS,
  summarizeRevenue,
} from '@/lib/dashboard-revenue'
import { LOW_STOCK_THRESHOLD } from '@/lib/product-validation'
import { formatRupiah } from '@/lib/format'
import type { OrderPaymentStatus, BestSellingProduct } from '@/types/order'
import type { StoredProduct } from '@/types/product'

// Dashboard membaca data asli & bergantung pada query params → jangan di-cache.
export const dynamic = 'force-dynamic'

// Jumlah baris pada widget "Pesanan Terbaru" & "Stok Rendah".
const WIDGET_ROWS = 5

// Warna aksen ikon kartu operasional. Bukan pembawa data (hanya dekorasi kartu), jadi cukup
// nada brand; warna yang MENGENCODE data hanya ada di REVENUE_COLORS.
const TONE_BRAND = '#00843b'
const TONE_SOIL = '#6B4E3D'

// Penjelasan cakupan angka total. Dipisah jadi konstanta karena teksnya panjang dan mengganggu
// keterbacaan array kartu.
//
// Rujukan "chart Tren Pendapatan" WAJIB akurat: sejak Lunas & Pending tak lagi punya kartu
// sendiri, chart (beserta tampilan Tabel-nya) adalah SATU-SATUNYA tempat admin bisa melihat
// berapa dari angka ini yang benar-benar sudah lunas. Kalau chart dipindah/dihapus, perbarui
// kalimat ini — tooltip yang menunjuk ke tempat yang tak ada lebih buruk daripada tanpa tooltip.
const TOTAL_REVENUE_TOOLTIP =
  'Gabungan Pendapatan Lunas + Pendapatan Pending. TIDAK termasuk pesanan yang dibatalkan atau pembayarannya gagal. Sebagian angka ini masih bisa hangus — lihat pemecahan Lunas vs Pending di chart Tren Pendapatan di bawah.'

// === Tipe ===

type Stat = {
  label: string
  value: string
  hint?: string // keterangan kecil di bawah nilai (mis. cakupan angka)
  tooltip?: string // definisi lengkap, tampil saat ikon info di-hover/di-fokus
  delta?: number // persentase vs periode pembanding; undefined = badge disembunyikan
  upIsGood?: boolean // false untuk metrik yang naiknya buruk (mis. pesanan dibatalkan)
  icon: typeof Wallet
  tone: string // hex aksen ikon
}

// Query params bisa berupa array bila muncul lebih dari sekali di URL — ambil yang pertama.
function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const period = resolvePeriod({
    periode: firstParam(params.periode),
    dari: firstParam(params.dari),
    sampai: firstParam(params.sampai),
  })
  const comparison = previousPeriod(period)

  // Satu putaran fetch paralel. readOrdersForRevenue dipanggil dua kali (periode aktif &
  // pembanding) karena delta pertumbuhan harus dihitung dari rentang yang sama panjangnya.
  const [currentRows, previousRows, bestSellers, recentOrders, products] = await Promise.all([
    readOrdersForRevenue(period.fromIso, period.toIso),
    readOrdersForRevenue(comparison.fromIso, comparison.toIso),
    // getBestSellingProducts memakai .lte pada batas atas → pakai varian inklusif.
    getBestSellingProducts({
      from: period.fromIso,
      to: period.toIsoInclusive,
      limit: WIDGET_ROWS,
    }),
    getRecentOrders(WIDGET_ROWS),
    // Masih dibutuhkan widget "Stok Rendah" (bukan lagi untuk kartu Produk Aktif yang sudah dihapus).
    readProducts(),
  ])

  const totals = summarizeRevenue(currentRows)
  const previousTotals = summarizeRevenue(previousRows)

  // Kerangka bucket dibuat dari periode (bukan dari data) supaya jam/hari tanpa pesanan tetap
  // tampil sebagai nol di sumbu-X, bukan hilang dan membuat tren terlihat rapat.
  const buckets = bucketRevenue(currentRows, buildBuckets(period), period.granularity)

  const activeProducts = products.filter((p) => !p.archived)
  const lowStockProducts = activeProducts
    .filter((p) => p.stock < LOW_STOCK_THRESHOLD)
    .sort((a, b) => a.stock - b.stock)
    .slice(0, WIDGET_ROWS)

  const aov = averageOrderValue(totals)
  const previousAov = averageOrderValue(previousTotals)

  // === Kartu ringkasan (grid 2×2) ===
  //
  // Urutannya mengikuti pembacaan baris-per-baris: uang masuk → volume → nilai rata-rata → yang
  // hangus. Kartu "Produk Aktif" & "Rata-rata Rating" sudah dihapus (angkanya tersedia dengan
  // konteks lebih lengkap di halaman Produk & Ulasan) — jangan dihidupkan lagi di sini.
  //
  // CATATAN PENTING: Lunas & Pending TIDAK lagi punya kartu sendiri (keputusan pemilik toko
  // 2026-08-13). Konsekuensinya kartu "Total Pendapatan" menampilkan uang yang SEBAGIAN BESAR
  // belum diterima selama Xendit belum terpasang. Pemecahannya kini hanya hidup di chart Tren
  // Pendapatan + tampilan Tabel di bawah — JANGAN hapus keduanya, itu satu-satunya tempat admin
  // masih bisa melihat berapa yang benar-benar sudah lunas.
  const SUMMARY_STATS: Stat[] = [
    {
      label: 'Total Pendapatan Periode Ini',
      value: formatRupiah(totals.berjalan.amount),
      hint: `Lunas + Pending · ${totals.berjalan.orderCount} pesanan`,
      tooltip: TOTAL_REVENUE_TOOLTIP,
      delta: growthPercent(totals.berjalan.amount, previousTotals.berjalan.amount),
      icon: Wallet,
      tone: REVENUE_COLORS.lunas,
    },
    {
      label: 'Total Pesanan',
      value: totals.semua.orderCount.toLocaleString('id-ID'),
      hint: `${totals.dibatalkan.orderCount} di antaranya dibatalkan/gagal`,
      tooltip:
        'Jumlah pesanan yang masuk pada periode ini, termasuk yang dibatalkan atau pembayarannya gagal.',
      delta: growthPercent(totals.semua.orderCount, previousTotals.semua.orderCount),
      icon: ShoppingBag,
      tone: TONE_BRAND,
    },
    {
      label: 'Rata-rata Nilai Pesanan',
      value: formatRupiah(aov),
      hint: 'Dari pesanan yang tidak dibatalkan',
      tooltip:
        'Total Pendapatan dibagi jumlah pesanan yang tidak dibatalkan. Naiknya angka ini berarti pembeli belanja lebih banyak per transaksi.',
      delta: growthPercent(aov, previousAov),
      icon: Receipt,
      tone: TONE_SOIL,
    },
    {
      label: REVENUE_CATEGORIES[2].label,
      value: formatRupiah(totals.dibatalkan.amount),
      hint: `${totals.dibatalkan.orderCount} pesanan · tidak dihitung ke pendapatan`,
      tooltip: REVENUE_CATEGORIES[2].tooltip,
      delta: growthPercent(totals.dibatalkan.amount, previousTotals.dibatalkan.amount),
      // Naiknya pembatalan itu BURUK → badge merah saat naik, hijau saat turun.
      upIsGood: false,
      icon: AlertTriangle,
      tone: REVENUE_COLORS.dibatalkan,
    },
  ]

  return (
    <>
      <OmsHeader title="Dashboard" notificationCount={3} />

      <main className="p-6 md:p-8">
        {/* === Header Section === */}
        {/* Provider status "sedang memuat" — dibagi antara tombol filter (spinner) dan
            <DashboardDim> (meredupkan isi). Isi di dalamnya tetap Server Component; hanya
            dilewatkan sebagai children. */}
        <DashboardTransition>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Ringkasan Operasional</h2>
            <p className="mt-1 text-sm text-gray-500">
              Menampilkan data periode <span className="font-semibold">{period.label}</span> (zona
              WIB).
            </p>
          </div>
          {/* Satu baris filter di atas SEMUA yang dicakupnya — bukan filter per kartu/chart.
              TIDAK ada tombol "Ekspor Laporan" di sini: yang lama hanya bernavigasi ke halaman
              Pesanan tanpa mengunduh apa pun, jadi labelnya menjanjikan aksi yang tak terjadi.
              Halaman Pesanan (beserta ekspor CSV-nya yang asli) tetap dijangkau dari sidebar. */}
          <DashboardPeriodFilter
            preset={period.preset}
            fromDate={period.fromDate}
            toDate={period.toDate}
            today={toWibDateString(new Date().toISOString())}
          />
        </div>

        {/* Semua yang bergantung periode diredupkan selagi data baru dimuat (tanpa skeleton →
            tanpa lompatan layout). Widget yang TIDAK bergantung periode (Pesanan Terbaru, Stok
            Rendah) ikut di dalamnya agar halaman tidak berkedip sebagian-sebagian. */}
        <DashboardDim>
        {/* === Kartu ringkasan (grid 2×2) === */}
        <section className="mt-6" aria-labelledby="revenue-heading">
          <h3 id="revenue-heading" className="sr-only">
            Ringkasan pendapatan &amp; pesanan
          </h3>
          {/* Empat kartu berjejer satu baris di layar lebar. Turun bertahap ke 2 kolom lalu 1,
              BUKAN langsung 4→1: memaksa 4 kolom di bawah 1280px menyisakan ~160px per kartu,
              dan nilai serupa "Rp1.413.755" akan terpotong/terlipat. Jumlahnya genap sehingga
              tahap 2 kolom pun tetap rapi (2×2), tanpa kartu menggantung sendirian. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {SUMMARY_STATS.map((stat) => (
              <StatCard key={stat.label} stat={stat} />
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-400">
            Persentase dibandingkan dengan {period.comparisonLabel}. Kategori bersifat eksklusif:
            pesanan yang sudah dibayar lalu dibatalkan dihitung sebagai Dibatalkan, bukan Lunas.
          </p>
          {totals.pending.amount > 0 && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs leading-relaxed text-gray-600">
              <Info className="mt-0.5 h-3.5 w-3.5 flex-none text-gray-400" />
              <p>
                Payment gateway (Xendit) belum terpasang, jadi setiap pesanan baru masuk dengan
                status pembayaran <span className="font-semibold">Menunggu</span> sampai admin
                menandainya Lunas di halaman Pesanan. Itu sebabnya Pendapatan Pending biasanya jauh
                lebih besar daripada Pendapatan Lunas — bukan berarti pembeli gagal bayar.
              </p>
            </div>
          )}
        </section>

        {/* === Chart Tren Pendapatan === */}
        <section className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4">
            <h3 className="text-lg font-bold text-gray-900">Tren Pendapatan</h3>
            <p className="mt-1 text-sm text-gray-500">
              {period.label} · dikelompokkan {granularityLabel(period.granularity)}. Tinggi batang
              = nilai pesanan yang masuk, dipecah menurut status pembayarannya; garis abu-abu =
              total pendapatan aktif (Lunas + Pending), jadi pada titik yang punya pembatalan
              garisnya berada di bawah puncak batang.
            </p>
          </div>
          <RevenueChart
            buckets={buckets}
            granularity={period.granularity}
            periodLabel={period.label}
          />
        </section>

        {/* === Widget Produk Terlaris === */}
        <section className="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <div>
              <div className="flex items-center gap-2">
                <Trophy className="h-5 w-5 text-amber-500" />
                <h3 className="text-lg font-bold text-gray-900">Produk Terlaris</h3>
              </div>
              <p className="mt-0.5 text-xs text-gray-400">
                {period.label} · pesanan yang tidak dibatalkan
              </p>
            </div>
            <Link
              href="/oms/dashboard/products"
              className="text-sm font-semibold text-brand-primary hover:brightness-90"
            >
              Kelola Produk →
            </Link>
          </div>
          <div className="px-6 py-5">
            {bestSellers.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">
                Belum ada penjualan pada periode ini.
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
              <div>
                <h3 className="text-lg font-bold text-gray-900">Pesanan Terbaru</h3>
                {/* Sengaja TIDAK mengikuti filter periode: widget ini untuk memantau pesanan yang
                    baru masuk, dan akan selalu kosong bila admin sedang melihat periode lampau. */}
                <p className="mt-0.5 text-xs text-gray-400">
                  {WIDGET_ROWS} pesanan terakhir masuk (di luar filter periode)
                </p>
              </div>
              <Link
                href="/oms/dashboard/orders"
                className="text-sm font-semibold text-brand-primary hover:brightness-90"
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
                        <td className="px-6 py-4 tabular-nums text-gray-700">
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
              <div>
                <h3 className="text-lg font-bold text-gray-900">Stok Rendah</h3>
                <p className="mt-0.5 text-xs text-gray-400">
                  Stok efektif &lt; {LOW_STOCK_THRESHOLD}, semua gudang
                </p>
              </div>
              {lowStockProducts.length > 0 && (
                <span className="flex-none rounded-full bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-600">
                  {lowStockProducts.length} Peringatan
                </span>
              )}
            </div>
            <div className="space-y-5 px-6 py-5">
              {lowStockProducts.length === 0 ? (
                <p className="flex flex-col items-center gap-2 py-6 text-center text-sm text-gray-400">
                  <PackageSearch className="h-6 w-6 text-gray-300" />
                  Semua produk aktif stoknya masih di atas {LOW_STOCK_THRESHOLD}.
                </p>
              ) : (
                lowStockProducts.map((item) => <LowStockRow key={item.id} item={item} />)
              )}
              <Link
                href="/oms/dashboard/gudang/stok"
                className="block w-full rounded-lg border border-gray-200 py-2.5 text-center text-sm font-semibold text-gray-600 transition hover:bg-gray-50"
              >
                Kelola Stok Gudang
              </Link>
            </div>
          </div>
        </section>
        </DashboardDim>
        </DashboardTransition>
      </main>
    </>
  )
}

// === Sub-komponen ===

// Ikon info dengan tooltip CSS (hover + fokus keyboard). Tanpa JavaScript supaya kartu tetap
// Server Component — tak ada alasan mengirim bundel client hanya untuk sebuah tooltip.
//
// PENTING: wrapper ikon sengaja TIDAK `relative`. Panel tooltip dipaku ke ancestor
// ber-`relative` terdekat — yaitu kartu (atau baris subtotal) yang memanggilnya — dengan
// `left-0 right-0 max-w-[15rem]`, sehingga lebarnya = min(lebar kartu, 240px) dan tepi
// kanannya tak pernah melewati kontainer di ukuran layar apa pun.
//
// Jangan memaku panel ke ikonnya sendiri (`relative` di wrapper + `w-60`): ikon hanya 14px,
// jadi `max-w-full` akan mengecilkan panel ke 24px dan teksnya membeludak keluar; tanpa
// `max-w-full`, panel 240px menonjol keluar kontainer. Keduanya merembes ke `scrollWidth`
// root lewat rantai `overflow-x: visible` dan memunculkan scrollbar horizontal — panel tetap
// menempati layout walau `invisible`.
//
// Konsekuensi: setiap pemanggil WAJIB memberi elemen pembungkusnya class `relative`.
function InfoHint({ text }: { text: string }) {
  return (
    <span className="group inline-flex" tabIndex={0} role="note" aria-label={text}>
      <Info className="h-3.5 w-3.5 text-gray-300 transition group-hover:text-gray-500 group-focus:text-gray-500" />
      {/* Muncul di ATAS kartu, bukan di bawah ikon: ikon ada di sudut kanan-atas sedangkan
          angkanya persis di bawah, jadi tooltip yang membuka ke bawah akan menutupi angka
          yang sedang ia jelaskan. */}
      <span
        aria-hidden
        className="pointer-events-none invisible absolute bottom-full left-0 right-0 z-30 mb-1.5 max-w-[15rem] rounded-lg bg-gray-900 px-3 py-2 text-left text-xs font-normal leading-relaxed text-white opacity-0 shadow-lg transition group-focus:visible group-focus:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        {text}
      </span>
    </span>
  )
}

// Badge persentase pertumbuhan. Dipakai kartu statistik DAN teks subtotal pendapatan, jadi
// logika arah/warnanya tinggal di satu tempat.
//
// `upIsGood` false untuk metrik yang naiknya buruk (mis. pesanan dibatalkan) — warna badge =
// arah perubahan × apakah naik itu bagus, bukan sekadar tanda plus/minus.
function DeltaBadge({ delta, upIsGood = true }: { delta?: number; upIsGood?: boolean }) {
  // undefined = pembanding 0 → badge disembunyikan sepenuhnya (bukan menampilkan "+∞%").
  if (delta === undefined) return null
  const isFlat = delta === 0
  const isUp = delta > 0
  const isGood = isUp === upIsGood
  const className = isFlat
    ? 'bg-gray-100 text-gray-500'
    : isGood
      ? 'bg-emerald-50 text-emerald-700'
      : 'bg-rose-50 text-rose-600'

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}
    >
      {isFlat ? (
        'Tetap'
      ) : (
        <>
          {isUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {isUp ? '+' : ''}
          {delta.toLocaleString('id-ID')}%
        </>
      )}
    </span>
  )
}

// Kartu statistik: label, nilai besar, keterangan cakupan, dan badge delta vs periode pembanding.
// Nilai memakai angka proporsional (BUKAN tabular-nums) — pada ukuran besar, digit selebar '0'
// membuat angka terlihat renggang.
function StatCard({ stat }: { stat: Stat }) {
  const Icon = stat.icon
  return (
    // `relative` = kotak acuan panel tooltip InfoHint (lihat catatan di komponen itu).
    <div className="relative rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div
          className="flex h-11 w-11 flex-none items-center justify-center rounded-lg"
          // Aksen ikon: warna kategori dengan latar 10% (hex + alpha) — dibuat inline karena
          // nilainya berasal dari konstanta palet, bukan kelas Tailwind statis.
          style={{ backgroundColor: `${stat.tone}1A`, color: stat.tone }}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex items-center gap-1.5">
          <DeltaBadge delta={stat.delta} upIsGood={stat.upIsGood} />
          {stat.tooltip && <InfoHint text={stat.tooltip} />}
        </div>
      </div>
      <p className="mt-4 text-sm text-gray-500">{stat.label}</p>
      <p className="mt-1 text-xl font-bold text-gray-900 xl:text-2xl">{stat.value}</p>
      {stat.hint && <p className="mt-1 text-xs text-gray-400">{stat.hint}</p>}
    </div>
  )
}

// Badge status pembayaran berwarna (pill)
function PaymentBadge({ status }: { status: OrderPaymentStatus }) {
  const styles: Record<OrderPaymentStatus, string> = {
    Lunas: 'bg-emerald-50 text-emerald-700',
    Menunggu: 'bg-amber-50 text-amber-600',
    Gagal: 'bg-rose-50 text-rose-600',
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

// Baris produk terlaris: peringkat, nama, total pendapatan, dan unit terjual
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
      <span className="flex-none text-sm font-bold text-brand-primary">
        {product.totalSold.toLocaleString('id-ID')} terjual
      </span>
    </li>
  )
}

// Baris stok rendah. Bar diukur relatif terhadap LOW_STOCK_THRESHOLD (ambang peringatan), bukan
// terhadap kapasitas maksimum — produk tidak punya kolom kapasitas, dan mengarang angka pembagi
// akan membuat bar-nya berbohong.
function LowStockRow({ item }: { item: StoredProduct }) {
  const ratio = Math.min(item.stock / LOW_STOCK_THRESHOLD, 1)
  const isOut = item.stock === 0
  const barColor = isOut ? 'bg-rose-500' : ratio < 0.4 ? 'bg-amber-400' : 'bg-brand-primary'
  const textColor = isOut ? 'text-rose-600' : ratio < 0.4 ? 'text-amber-600' : 'text-brand-primary'

  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs text-gray-400">SKU: {item.sku}</p>
          <p className="truncate text-sm font-semibold text-gray-900" title={item.name}>
            {item.name}
          </p>
        </div>
        <span className={`flex-none text-sm font-bold ${textColor}`}>
          {isOut ? 'Habis' : `${item.stock} pcs`}
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full ${barColor}`}
          // Minimal 4% agar stok 0/1 tetap terlihat sebagai batang, bukan hilang sama sekali.
          style={{ width: `${Math.max(ratio * 100, 4)}%` }}
        />
      </div>
    </div>
  )
}
