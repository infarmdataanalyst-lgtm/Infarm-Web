'use client'

// src/components/oms/PickupScheduleView.tsx
// Tampilan kartu "Penjemputan hari ini" di halaman Pesanan OMS — MURNI (tanpa fetch), supaya bisa
// dipakai PickupScheduleCard (data asli) maupun halaman pratinjau /dev/kartu-penjemputan (data contoh).
//
// Susunan (desain ulang 2026-10-14, siap banyak gudang):
//   1. Judul: tanggal jemput (WIB) + tautan pengaturan
//   2. Peringatan agregat sebagai TOMBOL aksi — merah "terlewat jadwal", kuning "tanpa jadwal
//      tercatat"; disembunyikan bila nol
//   3. Tabel gudang × kurir: logo kurir HANYA di judul kolom, satu baris per gudang aktif (gudang
//      kosong tetap tampil "—"); di layar sempit berubah jadi accordion per gudang
//   4. Satu kalimat catatan kaki tentang jadwal berikutnya
//
// Angka "terlewat" sama dengan alarm lonceng 'jadwal_jemput_terlewat' — kartu ini tak pernah membuat
// notifikasi sendiri (keputusan pemilik 2026-10-09).

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CalendarClock, CalendarOff, ChevronDown, ChevronRight, Truck } from 'lucide-react'
import CourierLogo from '@/components/checkout/CourierLogo'
import type { CourierPickupTime, PickupScheduleSummary } from '@/lib/mock-db/pickup-summary'
import type { PickupWarehouseRow } from '@/lib/pickup-summary-aggregate'

const ORDERS = '/oms/dashboard/orders'
// Nilai filter gudang untuk pesanan tanpa gudang (WAREHOUSE_FILTER_NONE di lib/mock-db/orders.ts —
// tak diimpor karena berkas itu khusus server).
const GUDANG_KOSONG = 'none'
// Di atas jumlah ini, kolom kurir yang tak punya paket di gudang mana pun disembunyikan supaya tabel
// tak melebar. Dengan 2 kurir (J&T, Shopee Express) semua kolom selalu tampil.
const MAX_ALWAYS_SHOWN_COURIERS = 3

// "Rabu, 14 Okt" dari YYYY-MM-DD — di-parse sebagai tengah malam WIB supaya tak bergeser sehari di
// browser berzona lain.
export function hariTanggal(date: string): string {
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

function ordersHref(params: Record<string, string>): string {
  return `${ORDERS}?${new URLSearchParams(params).toString()}`
}

function overdueHref(warehouseId: string | null | undefined): string {
  return ordersHref({
    masalah: 'jadwal_jemput_terlewat',
    ...(warehouseId !== undefined ? { gudang: warehouseId ?? GUDANG_KOSONG } : {}),
  })
}

// === Bagian ===

function Header({ data }: { data: PickupScheduleSummary }) {
  const pickupToday = data.status === 'hari-ini' || data.status === 'lewat-cutoff'
  const alasan = data.status === 'minggu' ? 'Minggu' : data.holidayLabel ? `libur: ${data.holidayLabel}` : 'hari libur'
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
      <div className="flex min-w-0 items-start gap-2.5">
        {pickupToday ? (
          <Truck className="mt-0.5 h-5 w-5 flex-none text-emerald-700" aria-hidden />
        ) : (
          <CalendarOff className="mt-0.5 h-5 w-5 flex-none text-gray-500" aria-hidden />
        )}
        <h2 className="text-sm font-semibold text-gray-900 @md:text-base">
          {pickupToday ? (
            <>Penjemputan hari ini · {hariTanggal(data.today)}</>
          ) : (
            <>
              Tidak ada penjemputan hari ini <span className="font-normal text-gray-500">({alasan})</span>
              {data.targetDate && <> · berikutnya {hariTanggal(data.targetDate)}</>}
            </>
          )}
          {data.specialLabel && (
            <span className="ml-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 align-middle text-xs font-semibold text-amber-800">
              Jam khusus: {data.specialLabel}
            </span>
          )}
        </h2>
      </div>
      <Link
        href="/oms/dashboard/pengaturan"
        className="text-xs font-medium text-emerald-700 underline-offset-2 hover:underline"
      >
        Atur jadwal &amp; hari libur
      </Link>
    </div>
  )
}

function Alerts({ data }: { data: PickupScheduleSummary }) {
  if (data.overdueCount === 0 && data.unscheduledCount === 0) return null
  const scope: Record<string, string> = data.warehouseId ? { gudang: data.warehouseId } : {}
  return (
    <div className="mt-3 flex flex-col gap-2 @md:flex-row @md:flex-wrap">
      {data.overdueCount > 0 && (
        <Link
          href={overdueHref(data.warehouseId)}
          className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100"
        >
          <AlertTriangle className="h-4 w-4 flex-none" aria-hidden />
          {data.overdueCount} paket terlewat jadwal
          <ChevronRight className="ml-auto h-4 w-4 flex-none @md:ml-1" aria-hidden />
        </Link>
      )}
      {data.unscheduledCount > 0 && (
        <Link
          href={ordersHref({ jadwal: 'belum', ...scope })}
          title="Sudah dibooking ke Mengantar sebelum jadwal jemput dicatat per pesanan (9 Okt 2026)"
          className="inline-flex items-center gap-2 rounded-lg border border-[#F2DD8C] bg-[#FFF3C4] px-3 py-2 text-sm font-semibold text-[#7A5A00] transition hover:bg-[#FBE7A1]"
        >
          <CalendarClock className="h-4 w-4 flex-none" aria-hidden />
          {data.unscheduledCount} tanpa jadwal tercatat
          <ChevronRight className="ml-auto h-4 w-4 flex-none @md:ml-1" aria-hidden />
        </Link>
      )}
    </div>
  )
}

function CourierHeader({ c }: { c: CourierPickupTime }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5">
        <CourierLogo courier={c.courier} label={c.label} size="xs" />
        <span className="font-semibold text-gray-800">{c.label}</span>
      </span>
      <span className="font-normal text-gray-500">
        ±{jam(c.pickupTime)} · batas {c.cutoffHour}.00
        {c.special && <span className="ml-1 font-semibold text-amber-700">(khusus)</span>}
      </span>
    </div>
  )
}

function CellText({ count, pickupTime }: { count: number; pickupTime?: string }) {
  if (count === 0) return <span className="text-gray-300">—</span>
  return (
    <span className="text-gray-800">
      {count} paket
      {pickupTime && <span className="text-xs text-gray-500"> · ±{jam(pickupTime)}</span>}
    </span>
  )
}

function OverdueBadge({ row }: { row: PickupWarehouseRow }) {
  if (row.overdue === 0) return <span className="text-gray-300">—</span>
  return (
    <Link
      href={overdueHref(row.warehouseId)}
      className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 transition hover:bg-red-200"
    >
      {row.overdue} terlewat
    </Link>
  )
}

// Desktop / tablet: satu tabel, logo kurir hanya di judul kolom.
function WarehouseTable({ rows, couriers }: { rows: PickupWarehouseRow[]; couriers: CourierPickupTime[] }) {
  return (
    <div className="mt-4 hidden overflow-x-auto rounded-lg border border-gray-200 @2xl:block">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="bg-gray-50 text-left text-xs text-gray-500">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-semibold">Gudang</th>
            {couriers.map((c) => (
              <th key={c.courier} scope="col" className="px-4 py-2.5">
                <CourierHeader c={c} />
              </th>
            ))}
            <th scope="col" className="px-4 py-2.5 font-semibold">Total</th>
            <th scope="col" className="px-4 py-2.5 font-semibold">Perhatian</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row) => (
            <tr key={row.warehouseId ?? GUDANG_KOSONG}>
              <th scope="row" className="px-4 py-2.5 text-left font-medium text-gray-900">{row.name}</th>
              {couriers.map((c) => (
                <td key={c.courier} className="px-4 py-2.5">
                  <CellText {...(row.cells[c.courier] ?? { count: 0 })} />
                </td>
              ))}
              <td className="px-4 py-2.5 font-bold text-gray-900">
                {row.total > 0 ? `${row.total} paket` : <span className="font-normal text-gray-300">—</span>}
              </td>
              <td className="px-4 py-2.5">
                <OverdueBadge row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Ponsel: accordion per gudang — ringkasan di baris, rincian kurir saat dibuka.
function WarehouseAccordion({ rows, couriers }: { rows: PickupWarehouseRow[]; couriers: CourierPickupTime[] }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <ul className="mt-4 divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 @2xl:hidden">
      {rows.map((row) => {
        const key = row.warehouseId ?? GUDANG_KOSONG
        const expanded = open === key
        return (
          <li key={key}>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setOpen(expanded ? null : key)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-gray-900">{row.name}</span>
                <span className={`text-xs ${row.total > 0 ? 'font-semibold text-gray-800' : 'text-gray-400'}`}>
                  {row.total > 0 ? `${row.total} paket` : 'Tidak ada paket'}
                </span>
              </span>
              {row.overdue > 0 && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                  {row.overdue} terlewat
                </span>
              )}
              <ChevronDown
                className={`h-4 w-4 flex-none text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
                aria-hidden
              />
            </button>
            {expanded && (
              <div className="space-y-2 bg-gray-50 px-4 py-3">
                {couriers.map((c) => (
                  <div key={c.courier} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <CourierLogo courier={c.courier} label={c.label} size="xs" />
                      <span className="min-w-0 leading-tight">
                        <span className="block truncate text-gray-700">{c.label}</span>
                        <span className="block text-xs text-gray-500">
                          ±{jam(c.pickupTime)} · batas {c.cutoffHour}.00
                        </span>
                      </span>
                    </span>
                    <span className="flex-none whitespace-nowrap">
                      <CellText {...(row.cells[c.courier] ?? { count: 0 })} />
                    </span>
                  </div>
                ))}
                {row.overdue > 0 && (
                  <Link href={overdueHref(row.warehouseId)} className="inline-block text-xs font-semibold text-red-700 underline-offset-2 hover:underline">
                    Lihat {row.overdue} paket terlewat →
                  </Link>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function Footer({ data }: { data: PickupScheduleSummary }) {
  // Hanya di hari jemput: di Minggu/libur pesanan baru justru masuk tanggal yang ditampilkan tabel.
  if (!data.followingDate) return null
  return (
    <p className="mt-3 text-xs text-gray-500">
      Pesanan lewat batas input otomatis masuk jadwal berikutnya ({hariTanggal(data.followingDate)} ·{' '}
      {data.followingCount > 0 ? `${data.followingCount} paket menunggu` : 'belum ada paket'}).
    </p>
  )
}

// === Kartu ===

export default function PickupScheduleView({ data }: { data: PickupScheduleSummary }) {
  if (!data.available) {
    return (
      <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-500">
        Jadwal penjemputan belum bisa ditampilkan: data pesanan gagal dibaca atau migration{' '}
        <code>orders.pickup_date</code> belum dijalankan.
      </div>
    )
  }

  const hasPackages = (courier: string) => data.warehouses.some((w) => (w.cells[courier]?.count ?? 0) > 0)
  const couriers =
    data.couriers.length > MAX_ALWAYS_SHOWN_COURIERS ? data.couriers.filter((c) => hasPackages(c.courier)) : data.couriers

  return (
    <section className="mt-6 rounded-xl border border-gray-200 bg-white px-4 py-4 shadow-sm @container sm:px-5" aria-label="Jadwal penjemputan kurir">
      <Header data={data} />
      <Alerts data={data} />
      {data.targetDate &&
        (data.warehouses.length > 0 ? (
          <>
            <WarehouseTable rows={data.warehouses} couriers={couriers} />
            <WarehouseAccordion rows={data.warehouses} couriers={couriers} />
          </>
        ) : (
          <p className="mt-4 text-sm text-gray-500">Belum ada gudang aktif.</p>
        ))}
      {!data.targetDate && (
        <p className="mt-3 text-sm text-gray-500">Hari penjemputan berikutnya belum bisa ditentukan — periksa daftar libur.</p>
      )}
      <Footer data={data} />
    </section>
  )
}
