// src/app/dev/kartu-penjemputan/page.tsx
// Pratinjau developer kartu "Penjemputan hari ini" (PickupScheduleView) dengan DATA CONTOH: tiga
// gudang (satu punya paket terlewat, satu kosong), hari Minggu, kondisi bersih, dan tampilan satu
// gudang. Database pengembangan hanya punya satu gudang, jadi kondisi banyak gudang tak bisa dilihat
// dari data asli.
//
//   http://localhost:3000/dev/kartu-penjemputan?skenario=hari-ini|minggu|bersih|satu-gudang
//
// Gate NODE_ENV sama dengan /dev/email-preview (SEC-027): notFound() di luar `next dev`.

import Link from 'next/link'
import { notFound } from 'next/navigation'
import PickupScheduleView from '@/components/oms/PickupScheduleView'
import type { PickupScheduleSummary } from '@/lib/mock-db/pickup-summary'

const SKENARIO = ['hari-ini', 'minggu', 'bersih', 'satu-gudang'] as const
type Skenario = (typeof SKENARIO)[number]

const COURIERS = [
  { courier: 'JT', label: 'J&T', pickupTime: '17:00', cutoffHour: 15, special: false },
  { courier: 'spx', label: 'Shopee Express', pickupTime: '15:00', cutoffHour: 13, special: false },
]

// Tanggal YYYY-MM-DD (WIB), digeser n hari dari hari ini.
function tanggal(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' })
}

function contoh(skenario: Skenario): PickupScheduleSummary {
  const today = tanggal(0)
  const gudang = [
    {
      warehouseId: '11111111-1111-4111-8111-111111111111',
      name: 'Gudang Utama Surabaya',
      cells: { JT: { count: 4 }, spx: { count: 2 } },
      total: 6,
      overdue: 3,
    },
    {
      warehouseId: '22222222-2222-4222-8222-222222222222',
      name: 'Gudang Jakarta',
      // Sel dengan jam berbeda dari judul kolom — bentuk data yang disiapkan untuk jadwal per gudang.
      cells: { JT: { count: 4, pickupTime: '16:00' }, spx: { count: 0 } },
      total: 4,
      overdue: 2,
    },
    {
      warehouseId: '33333333-3333-4333-8333-333333333333',
      name: 'Gudang Semarang',
      cells: { JT: { count: 0 }, spx: { count: 0 } },
      total: 0,
      overdue: 0,
    },
  ]
  const base: PickupScheduleSummary = {
    available: true,
    today,
    status: 'hari-ini',
    targetDate: today,
    couriers: COURIERS,
    followingDate: tanggal(1),
    warehouses: gudang,
    targetTotal: 10,
    overdueCount: 5,
    unscheduledCount: 24,
    followingCount: 1,
  }
  switch (skenario) {
    case 'minggu':
      return {
        ...base,
        status: 'minggu',
        targetDate: tanggal(1),
        followingDate: null,
        followingCount: 0,
      }
    case 'bersih':
      return {
        ...base,
        overdueCount: 0,
        unscheduledCount: 0,
        warehouses: gudang.map((g) => ({ ...g, overdue: 0 })),
      }
    case 'satu-gudang':
      return {
        ...base,
        warehouseId: gudang[0].warehouseId,
        warehouses: [gudang[0]],
        targetTotal: 6,
        overdueCount: 3,
        unscheduledCount: 7,
      }
    default:
      return base
  }
}

// `?ponsel=1` menaruh kartu di kotak selebar ponsel (390 px). Kartu responsif terhadap LEBARNYA
// SENDIRI (container query), jadi tampilan accordion terlihat tanpa mengecilkan jendela browser.
// (iframe tak bisa dipakai: header keamanan situs melarang halaman dimuat di dalam bingkai.)
export default async function KartuPenjemputanPreview({
  searchParams,
}: {
  searchParams: Promise<{ skenario?: string; ponsel?: string }>
}) {
  if (process.env.NODE_ENV !== 'development') notFound()
  const { skenario: raw, ponsel } = await searchParams
  const skenario: Skenario = SKENARIO.find((s) => s === raw) ?? 'hari-ini'

  const tautan = (s: Skenario, p: boolean) => `/dev/kartu-penjemputan?skenario=${s}${p ? '&ponsel=1' : ''}`
  const chip = (aktif: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-semibold ${
      aktif ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-gray-300 bg-white text-gray-700'
    }`

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Pratinjau developer · data contoh</p>
        <nav className="mt-2 flex flex-wrap gap-2">
          {SKENARIO.map((s) => (
            <Link key={s} href={tautan(s, !!ponsel)} className={chip(s === skenario)}>
              {s}
            </Link>
          ))}
          <span className="mx-1 border-l border-gray-300" aria-hidden />
          <Link href={tautan(skenario, false)} className={chip(!ponsel)}>
            desktop
          </Link>
          <Link href={tautan(skenario, true)} className={chip(!!ponsel)}>
            ponsel
          </Link>
        </nav>
        {ponsel ? (
          <div className="mt-4 w-[390px] rounded-[2rem] border-8 border-gray-800 bg-gray-50 px-3 pb-6">
            <PickupScheduleView data={contoh(skenario)} />
          </div>
        ) : (
          <PickupScheduleView data={contoh(skenario)} />
        )}
      </div>
    </main>
  )
}
