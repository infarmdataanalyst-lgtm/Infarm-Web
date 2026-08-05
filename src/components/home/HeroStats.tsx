'use client'

// src/components/home/HeroStats.tsx
// Tiga indicator kepercayaan di hero (3,4 Juta+, 4.9, 100%). Tiap indicator dibungkus box solid
// abu-abu muda (angka gelap bold + label muted). Angka beranimasi count-up saat mount (section
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

// Menampilkan tiga indicator kepercayaan dalam box solid abu-abu muda dengan count-up.
export default function HeroStats() {
  return (
    <ul className="grid max-w-xl grid-cols-3 gap-3 sm:gap-4">
      {STATS.map((stat) => (
        <StatItem key={stat.label} stat={stat} />
      ))}
    </ul>
  )
}

// Satu box indicator: background solid abu-abu muda, angka gelap bold + label muted, count-up.
function StatItem({ stat }: { stat: Stat }) {
  const current = useCountUp(stat.value)
  return (
    <li className="rounded-2xl bg-[#ECEAE3]/80 px-2.5 py-2.5 text-center backdrop-blur-sm sm:rounded-[18px] sm:px-5 sm:py-4">
      <p className="text-lg font-bold leading-tight text-zinc-900 sm:text-[22px] sm:leading-none">
        {formatNumber(current, stat.decimals, stat.sep)}
        {stat.suffix}
      </p>
      <p className="mt-0.5 text-[11px] font-normal leading-tight text-zinc-500 sm:mt-1 sm:text-[13px]">
        {stat.label}
      </p>
    </li>
  )
}
