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
import CourierLogo from '@/components/checkout/CourierLogo'
import type { CourierPickupTime, PickupScheduleSummary } from '@/lib/mock-db/pickup-summary'

// true bila jam jemput atau batas pesanan antar ekspedisi berbeda — baru saat itu kartu merinci
// per ekspedisi; bila semua sama, satu jam di judul sudah cukup.
function berbedaPerKurir(list: CourierPickupTime[]): boolean {
  return new Set(list.map((c) => `${c.pickupTime}|${c.cutoffHour}`)).size > 1
}

// Baris kecil "[logo] J&T ±17.00 · batas 15.00   [logo] Shopee Express ±14.00 · batas 12.00".
function RincianKurir({ list, tampilkanBatas }: { list: CourierPickupTime[]; tampilkanBatas: boolean }) {
  return (
    <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
      {list.map((c) => (
        <span key={c.courier} className="inline-flex items-center gap-1.5">
          <CourierLogo courier={c.courier} label={c.label} size="xs" />
          <span>
            {c.label} ±{jam(c.pickupTime)}
            {tampilkanBatas && <span className="text-gray-400"> · batas {c.cutoffHour}.00</span>}
          </span>
        </span>
      ))}
    </span>
  )
}

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
  // `?? []`: respons dari deploy lama (sebelum jam per ekspedisi) belum membawa field ini.
  const perKurirHariIni = berbedaPerKurir(data.todayByCourier ?? [])
  const perKurirBerikutnya = berbedaPerKurir(data.nextByCourier ?? [])

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
                  Penjemputan hari ini · {hariTanggal(data.today)}
                  {!perKurirHariIni && <> · ±{jam(data.pickupTime)} WIB</>}
                  {data.todaySpecial && (
                    <span className="ml-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                      Jam khusus{data.todaySpecialLabel ? `: ${data.todaySpecialLabel}` : ''}
                    </span>
                  )}
                </p>
                {perKurirHariIni && <RincianKurir list={data.todayByCourier} tampilkanBatas />}
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
                  {perKurirHariIni
                    ? 'Pesanan setelah batas ekspedisinya ikut penjemputan berikutnya'
                    : data.status === 'lewat-cutoff'
                      ? `Sudah lewat ${data.cutoffHour}.00: pesanan baru ikut penjemputan berikutnya`
                      : `Pesanan masuk setelah ${data.cutoffHour}.00 ikut penjemputan berikutnya`}
                  {data.nextDate &&
                    ` (${hariTanggal(data.nextDate)}${data.nextPickupTime && !perKurirBerikutnya ? ` ±${jam(data.nextPickupTime)}` : ''}${data.nextCount ? `, ${data.nextCount} paket sudah menunggu` : ''})`}
                  .
                </p>
                {perKurirBerikutnya && data.nextDate && (
                  <RincianKurir list={data.nextByCourier} tampilkanBatas={false} />
                )}
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
                      Berikutnya <span className="font-semibold">{hariTanggal(data.nextDate)}</span>
                      {!perKurirBerikutnya && <> ±{jam(data.nextPickupTime ?? data.pickupTime)} WIB</>}
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
                {perKurirBerikutnya && data.nextDate && (
                  <RincianKurir list={data.nextByCourier} tampilkanBatas={false} />
                )}
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
            Atur hari libur &amp; jam jemput
          </Link>
        </div>
      </div>
    </div>
  )
}
