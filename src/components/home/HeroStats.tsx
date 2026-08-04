'use client'

// src/components/home/HeroStats.tsx
// Tiga indicator kepercayaan di hero (3,4 Juta+, 4.9, 100%). TANPA box — angka & label langsung
// di atas foto hero, dipisah garis vertikal tipis. Angka beranimasi count-up saat mount (section
// di atas fold → tak perlu scroll trigger). Count-up memakai requestAnimationFrame (tanpa library),
// selaras pola project (no dependency animasi). Hormati prefers-reduced-motion.

import { useEffect, useRef, useState } from 'react'

// Satu indicator: target angka + format tampilan.
type Stat = {
  value: number // nilai akhir yang dianimasikan
  decimals: number // jumlah angka desimal
  sep: '.' | ',' // pemisah desimal saat ditampilkan (ID pakai koma)
  suffix?: string // teks setelah angka (mis. ' Juta+', '%'), tetap muncul setelah animasi
  label: string
}

const STATS: Stat[] = [
  { value: 3.4, decimals: 1, sep: ',', suffix: ' Juta+', label: 'Pembeli Puas' },
  { value: 4.9, decimals: 1, sep: '.', suffix: '', label: 'Rating Produk' },
  { value: 100, decimals: 0, sep: '.', suffix: '%', label: 'Produk Original' },
]

const DURATION = 1500 // ms durasi animasi count-up

// Format angka: desimal tetap + ganti titik→koma bila sep koma.
function formatNumber(n: number, decimals: number, sep: '.' | ','): string {
  const s = n.toFixed(decimals)
  return sep === ',' ? s.replace('.', ',') : s
}

// Hook count-up: menganimasikan 0 → target sekali saat mount (ease-out). Mengembalikan nilai kini.
// Bila user minta gerakan minim → langsung ke nilai akhir tanpa animasi.
function useCountUp(target: number): number {
  const [current, setCurrent] = useState(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setCurrent(target)
      return
    }
    // startTime ditetapkan pada frame pertama (Date.now dihindari; pakai timestamp rAF).
    let startTime: number | null = null
    const tick = (now: number) => {
      if (startTime === null) startTime = now
      const elapsed = now - startTime
      const t = Math.min(elapsed / DURATION, 1)
      // ease-out cubic → cepat di awal, melambat di akhir
      const eased = 1 - Math.pow(1 - t, 3)
      setCurrent(target * eased)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
      else setCurrent(target) // pastikan nilai akhir presisi
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [target])

  return current
}

// Menampilkan tiga indicator kepercayaan tanpa box, dipisah garis vertikal, dengan count-up.
export default function HeroStats() {
  return (
    <ul className="grid max-w-xl grid-cols-3">
      {STATS.map((stat, i) => (
        <StatItem key={stat.label} stat={stat} showDivider={i > 0} />
      ))}
    </ul>
  )
}

// Satu kolom indicator + garis pemisah kiri (kecuali kolom pertama).
function StatItem({ stat, showDivider }: { stat: Stat; showDivider: boolean }) {
  const current = useCountUp(stat.value)
  return (
    <li className={`px-2 text-center ${showDivider ? 'border-l border-white/30' : ''}`}>
      <p
        className="text-[22px] font-bold leading-none text-white"
        style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}
      >
        {formatNumber(current, stat.decimals, stat.sep)}
        {stat.suffix}
      </p>
      <p className="mt-1 text-xs text-white/85">{stat.label}</p>
    </li>
  )
}
