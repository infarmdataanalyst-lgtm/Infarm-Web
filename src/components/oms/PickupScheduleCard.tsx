'use client'

// src/components/oms/PickupScheduleCard.tsx
// Kartu "Penjemputan hari ini" di atas daftar Pesanan OMS — pembungkus yang memuat data; tampilannya
// ada di PickupScheduleView (dipakai juga pratinjau /dev/kartu-penjemputan).
//
// Data dari GET /api/oms/pickup-schedule, dimuat saat halaman dibuka dan diulang tiap 5 menit —
// angkanya berubah setiap ada pembayaran masuk, tapi tak perlu lebih rapat dari itu.
//
// `warehouseId` opsional = kartu satu gudang (tabel satu baris, peringatan hanya gudang itu).
// Disiapkan untuk admin per gudang; peran itu belum ada, jadi halaman Pesanan belum mengisinya.

import { useEffect, useState } from 'react'
import PickupScheduleView from '@/components/oms/PickupScheduleView'
import type { PickupScheduleSummary } from '@/lib/mock-db/pickup-summary'

const REFRESH_MS = 5 * 60_000

export default function PickupScheduleCard({ warehouseId }: { warehouseId?: string } = {}) {
  const [data, setData] = useState<PickupScheduleSummary | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    const url = `/api/oms/pickup-schedule${warehouseId ? `?gudang=${encodeURIComponent(warehouseId)}` : ''}`
    const load = () => {
      fetch(url, { cache: 'no-store' })
        .then((res) => (res.ok ? (res.json() as Promise<PickupScheduleSummary>) : null))
        .then((json) => {
          if (!active) return
          if (json) {
            setData(json)
            setFailed(false)
          } else {
            setFailed(true)
          }
        })
        .catch(() => {
          if (active) setFailed(true)
        })
    }
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [warehouseId])

  // Gagal memuat: jangan menampilkan angka nol yang menyesatkan.
  if (failed) return null
  if (!data) {
    return <div className="mt-6 h-[150px] animate-pulse rounded-xl border border-gray-200 bg-white" aria-hidden />
  }
  return <PickupScheduleView data={data} />
}
