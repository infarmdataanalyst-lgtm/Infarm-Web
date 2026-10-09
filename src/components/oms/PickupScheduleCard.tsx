'use client'

// src/components/oms/PickupScheduleCard.tsx
// Kartu "Penjemputan kurir" di atas daftar Pesanan OMS: apakah hari ini kurir datang (Minggu dan
// hari libur admin tidak), berapa paket terjadwal dari gudang mana, dan jadwal berikutnya.
//
// Keputusan pemilik 2026-10-09: jadwal rutin di KARTU, penyimpangan di lonceng. Kartu ini tidak
// pernah "berbunyi"; satu-satunya hal merah di sini adalah tautan ke paket yang jadwalnya terlewat,
// yang juga ada di lonceng sebagai 'jadwal_jemput_terlewat'.
//
// Data dari GET /api/oms/pickup-schedule, dimuat saat halaman dibuka dan diulang tiap 5 menit —
// angkanya berubah setiap ada pembayaran masuk, tapi tak perlu lebih rapat dari itu.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CalendarOff, Truck } from 'lucide-react'
import type { PickupScheduleSummary } from '@/lib/mock-db/pickup-summary'

const REFRESH_MS = 5 * 60_000

// "Senin, 12 Okt" dari YYYY-MM-DD — tanggalnya tanggal WIB, jadi di-parse sebagai tengah malam WIB
// supaya tidak bergeser sehari di browser dengan zona waktu lain.
function hariTanggal(date: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(`${date}T00:00:00+07:00`))
}

function jam(hhmm: string): string {
  return hhmm.replace(':', '.')
}

export default function PickupScheduleCard() {
  const [data, setData] = useState<PickupScheduleSummary | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    const load = () => {
      fetch('/api/oms/pickup-schedule', { cache: 'no-store' })
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
  }, [])

  // Gagal memuat atau kolomnya belum di-migrate: jangan menampilkan angka nol yang menyesatkan.
  if (failed) return null
  if (!data) {
    return (
      <div className="mt-6 h-[76px] animate-pulse rounded-lg border border-gray-200 bg-white" aria-hidden />
    )
  }
  if (!data.available) {
    return (
      <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-500">
        Jadwal penjemputan belum bisa ditampilkan: migration <code>orders.pickup_date</code> belum
        dijalankan.
      </div>
    )
  }

  const pickupToday = data.status === 'hari-ini' || data.status === 'lewat-cutoff'
  const rincian = data.byWarehouse.map((w) => `${w.name} ${w.count}`).join(' · ')

  return (
    <div
      className={`mt-6 rounded-lg border px-4 py-3 shadow-sm ${
        pickupToday ? 'border-emerald-200 bg-emerald-50/60' : 'border-gray-200 bg-gray-50'
      }`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          {pickupToday ? (
            <Truck className="mt-0.5 h-5 w-5 flex-none text-emerald-700" aria-hidden />
          ) : (
            <CalendarOff className="mt-0.5 h-5 w-5 flex-none text-gray-500" aria-hidden />
          )}
          <div className="text-sm">
            {pickupToday ? (
              <>
                <p className="font-semibold text-gray-900">
                  Penjemputan hari ini · {hariTanggal(data.today)} · ±{jam(data.pickupTime)} WIB
                </p>
                <p className="mt-0.5 text-gray-700">
                  {data.todayCount === 0 ? (
                    'Belum ada paket terjadwal untuk hari ini.'
                  ) : (
                    <>
                      <span className="font-semibold">{data.todayCount} paket</span>
                      {rincian && <span className="text-gray-500"> — {rincian}</span>}
                    </>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {data.status === 'lewat-cutoff'
                    ? `Sudah lewat ${data.cutoffHour}.00: pesanan baru ikut penjemputan berikutnya`
                    : `Pesanan masuk setelah ${data.cutoffHour}.00 ikut penjemputan berikutnya`}
                  {data.nextDate && ` (${hariTanggal(data.nextDate)}${data.nextCount ? `, ${data.nextCount} paket sudah menunggu` : ''})`}
                  .
                </p>
              </>
            ) : (
              <>
                <p className="font-semibold text-gray-900">
                  Tidak ada penjemputan hari ini
                  <span className="font-normal text-gray-600">
                    {' '}
                    ({data.status === 'minggu' ? 'Minggu' : data.holidayLabel ? `libur: ${data.holidayLabel}` : 'hari libur'})
                  </span>
                </p>
                <p className="mt-0.5 text-gray-700">
                  {data.nextDate ? (
                    <>
                      Berikutnya <span className="font-semibold">{hariTanggal(data.nextDate)}</span> ±
                      {jam(data.pickupTime)} WIB
                      {data.nextCount > 0 ? (
                        <>
                          {' '}
                          · <span className="font-semibold">{data.nextCount} paket</span> menunggu
                          {rincian && <span className="text-gray-500"> — {rincian}</span>}
                        </>
                      ) : (
                        ' · belum ada paket menunggu'
                      )}
                    </>
                  ) : (
                    'Hari penjemputan berikutnya belum bisa ditentukan — periksa daftar libur.'
                  )}
                </p>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col items-start gap-1 text-xs sm:items-end">
          {data.overdueCount > 0 && (
            <Link
              href="/oms/dashboard/orders?masalah=jadwal_jemput_terlewat"
              className="rounded-full border border-red-300 bg-red-50 px-2.5 py-0.5 font-semibold text-red-700 transition hover:bg-red-100"
            >
              {data.overdueCount} paket terlewat jadwalnya
            </Link>
          )}
          {data.unscheduledCount > 0 && (
            <span className="text-gray-400" title="Dibooking sebelum jadwal penjemputan dicatat per pesanan">
              {data.unscheduledCount} pesanan Diproses tanpa jadwal tercatat
            </span>
          )}
          <Link href="/oms/dashboard/pengaturan" className="text-gray-400 underline-offset-2 hover:underline">
            Atur hari libur
          </Link>
        </div>
      </div>
    </div>
  )
}
