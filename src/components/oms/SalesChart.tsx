'use client'

// src/components/oms/SalesChart.tsx
// Grafik tren penjualan bulanan (area chart emerald) menggunakan Recharts.
// TODO: ganti data dummy dengan agregasi penjualan dari Supabase setelah OMS dibangun.

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

type SalesPoint = {
  month: string
  penjualan: number
  target: number
}

// Data dummy 6 bulan terakhir (dalam ribuan Rupiah)
const DATA: SalesPoint[] = [
  { month: 'Jan', penjualan: 82000, target: 75000 },
  { month: 'Feb', penjualan: 105000, target: 85000 },
  { month: 'Mar', penjualan: 98000, target: 95000 },
  { month: 'Apr', penjualan: 134000, target: 110000 },
  { month: 'Mei', penjualan: 122000, target: 120000 },
  { month: 'Jun', penjualan: 150000, target: 130000 },
]

// Format nilai ribuan ke "Rp 150.000k" untuk tooltip & sumbu
function formatK(value: number): string {
  return `Rp ${new Intl.NumberFormat('id-ID').format(value)}`
}

export default function SalesChart() {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={DATA} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="fillPenjualan" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#46B33C" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#46B33C" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
        <XAxis
          dataKey="month"
          axisLine={false}
          tickLine={false}
          tick={{ fill: '#6B7280', fontSize: 12 }}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={{ fill: '#6B7280', fontSize: 12 }}
          tickFormatter={(v: number) => `${v / 1000}k`}
          width={48}
        />
        <Tooltip
          formatter={(value) => formatK(Number(value))}
          contentStyle={{
            borderRadius: 12,
            border: '1px solid #e5e7eb',
            fontSize: 13,
          }}
        />
        {/* Garis target (abu-abu putus-putus) sebagai pembanding */}
        <Area
          type="monotone"
          dataKey="target"
          stroke="#d1d5db"
          strokeWidth={2}
          strokeDasharray="5 5"
          fill="none"
          name="Target"
        />
        {/* Penjualan aktual (emerald, dengan area gradasi) */}
        <Area
          type="monotone"
          dataKey="penjualan"
          stroke="#15803d"
          strokeWidth={3}
          fill="url(#fillPenjualan)"
          name="Penjualan 2024"
          dot={{ r: 4, fill: '#15803d', strokeWidth: 2, stroke: '#fff' }}
          activeDot={{ r: 6 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
