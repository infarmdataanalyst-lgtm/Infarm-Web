'use client'

// src/components/oms/RevenueChart.tsx
// Chart tren pendapatan Dashboard OMS: stacked bar Lunas / Pending / Dibatalkan per bucket waktu.
// Menggantikan SalesChart lama yang datanya dummy 6 bulan hardcode.
//
// Granularity sumbu-X (jam / hari / bulan) DITENTUKAN DI SERVER (lihat dashboard-period.ts) dan
// bucket-nya sudah lengkap termasuk yang bernilai nol, jadi komponen ini murni menggambar —
// tak ada perhitungan tanggal di sini.
//
// Kenapa stacked bar, bukan area/line: tiap titik waktu adalah komposisi part-to-whole (bagian
// mana dari pendapatan hari itu yang sudah pasti masuk), dan tinggi total bar tetap terbaca
// sebagai nilai pesanan hari itu.

import { useState } from 'react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { BarChart3, Table2 } from 'lucide-react'
import { formatRupiah } from '@/lib/format'
import {
  REVENUE_CATEGORIES,
  REVENUE_TREND_COLOR,
  type RevenueBucket,
} from '@/lib/dashboard-revenue'
import type { Granularity } from '@/lib/dashboard-period'

// Warna permukaan kartu. Dipakai sebagai "surface gap" 2px antar segmen tumpukan — pemisah
// antar segmen dibuat dari celah warna latar, BUKAN dari garis tepi berwarna (garis tepi
// menambah tinta yang bukan data).
const SURFACE = '#ffffff'

type Props = {
  buckets: RevenueBucket[]
  granularity: Granularity
  // Keterangan periode untuk judul tabel & keterangan sumbu ("30 hari terakhir").
  periodLabel: string
}

// Format ringkas untuk tick sumbu-Y & sel tabel sempit, mis. 1250000 → "Rp1,3 jt".
function formatCompactRupiah(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return `Rp${trimDecimal(value / 1_000_000_000)} M`
  if (abs >= 1_000_000) return `Rp${trimDecimal(value / 1_000_000)} jt`
  if (abs >= 1_000) return `Rp${trimDecimal(value / 1_000)} rb`
  return `Rp${value}`
}

function trimDecimal(n: number): string {
  return String(Math.round(n * 10) / 10).replace('.', ',')
}

// Nama kolom waktu di tampilan tabel, mengikuti granularity.
function timeColumnLabel(granularity: Granularity): string {
  if (granularity === 'hour') return 'Jam'
  if (granularity === 'month') return 'Bulan'
  return 'Tanggal'
}

// Label garis tren mengikuti granularity aktif — "Total Harian" akan berbohong saat sumbu-X
// dikelompokkan per jam (Hari ini) atau per bulan (Tahun ini).
function trendLabel(granularity: Granularity): string {
  if (granularity === 'hour') return 'Total per Jam'
  if (granularity === 'month') return 'Total Bulanan'
  return 'Total Harian'
}

export default function RevenueChart({ buckets, granularity, periodLabel }: Props) {
  // Tampilan tabel = "table view twin" chart: setiap angka bisa dibaca tanpa mengandalkan
  // hover maupun perbedaan warna (syarat aksesibilitas untuk chart berkategori warna).
  const [view, setView] = useState<'chart' | 'table'>('chart')

  const grandTotal = buckets.reduce(
    (sum, b) => sum + b.lunas + b.pending + b.dibatalkan,
    0,
  )

  return (
    <div>
      {/* === Legend + pengalih tampilan === */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {/* Legend selalu ada (4 seri) — identitas seri tak boleh bergantung warna saja.
            Teks legend memakai token teks, bukan warna seri; warna dibawa titik di sebelahnya. */}
        <ul className="flex flex-wrap items-center gap-4 text-xs text-gray-600">
          {REVENUE_CATEGORIES.map((category) => (
            <li key={category.key} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: category.color }}
              />
              {category.label}
            </li>
          ))}
          {/* Swatch garis tren memakai bentuk GARIS + dot, bukan titik bulat seperti seri batang —
              jenis mark-nya ikut jadi penanda identitas, tak hanya warnanya. */}
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="relative inline-flex h-2.5 w-5 items-center">
              <span
                className="h-0.5 w-full rounded-full"
                style={{ backgroundColor: REVENUE_TREND_COLOR }}
              />
              <span
                className="absolute left-1/2 h-2 w-2 -translate-x-1/2 rounded-full border-2 border-white"
                style={{ backgroundColor: REVENUE_TREND_COLOR }}
              />
            </span>
            {trendLabel(granularity)}
          </li>
        </ul>

        <div className="flex items-center gap-1 rounded-lg border border-gray-200 p-1">
          <ViewToggleButton
            active={view === 'chart'}
            onClick={() => setView('chart')}
            icon={<BarChart3 className="h-3.5 w-3.5" />}
            label="Grafik"
          />
          <ViewToggleButton
            active={view === 'table'}
            onClick={() => setView('table')}
            icon={<Table2 className="h-3.5 w-3.5" />}
            label="Tabel"
          />
        </div>
      </div>

      {grandTotal === 0 ? (
        <p className="py-20 text-center text-sm text-gray-400">
          Belum ada pesanan pada periode ini ({periodLabel}).
        </p>
      ) : view === 'chart' ? (
        // Tinggi container sudah termasuk pita label sumbu-X supaya kartu tidak memunculkan
        // scroll vertikal kecil di dalamnya.
        <ResponsiveContainer width="100%" height={320}>
          {/* ComposedChart (bukan BarChart) supaya batang bertumpuk & garis tren berbagi satu
              sumbu-Y yang sama. SATU sumbu — garis dan batang memakai satuan identik (rupiah),
              jadi tak ada sumbu kedua yang skalanya sewenang-wenang. */}
          <ComposedChart data={buckets} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
            {/* Grid hairline solid (bukan putus-putus) & recessive — data yang boleh menonjol */}
            <CartesianGrid stroke="#f1f5f9" vertical={false} />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#6B7280', fontSize: 11 }}
              interval="preserveStartEnd"
              minTickGap={12}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#6B7280', fontSize: 11 }}
              tickFormatter={formatCompactRupiah}
              width={72}
            />
            <Tooltip
              cursor={{ fill: '#f8fafc' }}
              content={(props) => {
                if (!props.active || !props.payload?.length) return null
                const valueOf = (key: string) =>
                  Number(props.payload?.find((p) => p.dataKey === key)?.value ?? 0)
                const rows = REVENUE_CATEGORIES.map((category) => ({
                  key: category.key,
                  label: category.label,
                  color: category.color,
                  value: valueOf(category.key),
                }))
                return (
                  <TooltipCard
                    title={String(props.label ?? '')}
                    rows={rows}
                    trendLabel={trendLabel(granularity)}
                    trendValue={valueOf('berjalan')}
                  />
                )
              }}
            />
            {/* Urutan render = urutan tumpukan dari dasar: Lunas di bawah (uang paling pasti),
                Dibatalkan di puncak. stroke setebal 2px berwarna permukaan = celah pemisah
                antar segmen; maxBarSize menjaga bar tetap tipis walau bucket sedikit.
                radius diberikan ke SEMUA segmen karena Recharts tidak bisa membulatkan hanya
                segmen teratas yang nilainya > 0 — dengan celah 2px, tiap segmen terbaca sebagai
                kepingan tersendiri dan hasilnya konsisten apa pun kombinasi nilai nol-nya. */}
            {REVENUE_CATEGORIES.map((category) => (
              <Bar
                key={category.key}
                dataKey={category.key}
                stackId="pendapatan"
                name={category.label}
                fill={category.color}
                stroke={SURFACE}
                strokeWidth={2}
                radius={[4, 4, 0, 0]}
                maxBarSize={24}
              />
            ))}
            {/* Garis tren DI URUTAN TERAKHIR: di Recharts urutan render = urutan gambar, jadi
                garis otomatis berada di atas batang tanpa perlu z-index. Opacity dibiarkan penuh —
                menyamarkan garis justru mengurangi keterbacaannya; yang menjaga garis tetap
                terbaca di atas fill adalah cincin 2px berwarna permukaan pada tiap dot.
                type="linear", BUKAN "monotone": interpolasi melengkung akan mengarang puncak &
                lembah di antara titik pada deret yang banyak nol-nya. */}
            <Line
              type="linear"
              dataKey="berjalan"
              name={trendLabel(granularity)}
              stroke={REVENUE_TREND_COLOR}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={{ r: 4, fill: REVENUE_TREND_COLOR, stroke: SURFACE, strokeWidth: 2 }}
              activeDot={{ r: 6, fill: REVENUE_TREND_COLOR, stroke: SURFACE, strokeWidth: 2 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <RevenueTable buckets={buckets} granularity={granularity} />
      )}
    </div>
  )
}

// === Sub-komponen ===

function ViewToggleButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition ${
        active ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

// Kartu tooltip: label bucket + rincian ketiga kategori + nilai garis tren.
//
// Baris tren memakai label yang sama dengan legend & kolom tabel, dan hanya menjumlahkan
// lunas + pending. Tinggi batang (ketiga kategori) ditampilkan sebagai baris terpisah HANYA
// bila ada pembatalan — kalau tidak, dua baris total dengan angka identik hanya membingungkan.
function TooltipCard({
  title,
  rows,
  trendLabel: trendRowLabel,
  trendValue,
}: {
  title: string
  rows: { key: string; label: string; color: string; value: number }[]
  trendLabel: string
  trendValue: number
}) {
  const withCancelled = rows.reduce((sum, r) => sum + r.value, 0)
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1.5 font-semibold text-gray-900">{title}</p>
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-gray-600">
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: row.color }}
              />
              {row.label}
            </span>
            <span className="font-semibold tabular-nums text-gray-900">
              {formatRupiah(row.value)}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-1.5 space-y-1 border-t border-gray-100 pt-1.5">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-gray-600">
            <span
              aria-hidden
              className="h-0.5 w-4 rounded-full"
              style={{ backgroundColor: REVENUE_TREND_COLOR }}
            />
            {trendRowLabel}
          </span>
          <span className="font-bold tabular-nums text-gray-900">{formatRupiah(trendValue)}</span>
        </div>
        {withCancelled !== trendValue && (
          <div className="flex items-center justify-between gap-4">
            <span className="pl-5 text-gray-400">Termasuk dibatalkan</span>
            <span className="tabular-nums text-gray-400">{formatRupiah(withCancelled)}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// Tampilan tabel: kembaran chart yang bisa dibaca tanpa warna & tanpa hover.
// tabular-nums dipakai di sini (bukan pada angka besar di kartu) karena kolom angka harus rata.
function RevenueTable({
  buckets,
  granularity,
}: {
  buckets: RevenueBucket[]
  granularity: Granularity
}) {
  return (
    <div className="max-h-80 overflow-auto rounded-lg border border-gray-100">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-3 py-2">{timeColumnLabel(granularity)}</th>
            {REVENUE_CATEGORIES.map((category) => (
              <th key={category.key} className="px-3 py-2 text-right">
                {category.label}
              </th>
            ))}
            {/* Kolom total = nilai GARIS TREN (lunas + pending), bukan tinggi batang. Tinggi
                batang (ikut dibatalkan) tidak dijadikan kolom karena itu bukan besaran bisnis —
                mencampur pendapatan dengan pembatalan; ketiga komponennya sudah ada di kolom
                sebelah bila admin perlu menjumlahkannya sendiri. */}
            <th className="px-3 py-2 text-right">{trendLabel(granularity)}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {buckets.map((bucket) => {
            const empty = bucket.lunas + bucket.pending + bucket.dibatalkan === 0
            return (
              <tr key={bucket.key} className={empty ? 'text-gray-400' : ''}>
                <td className="px-3 py-2 font-medium text-gray-700">{bucket.label}</td>
                {REVENUE_CATEGORIES.map((category) => (
                  <td key={category.key} className="px-3 py-2 text-right tabular-nums">
                    {formatRupiah(bucket[category.key])}
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900">
                  {formatRupiah(bucket.berjalan)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
