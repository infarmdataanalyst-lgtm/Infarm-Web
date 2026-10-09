// src/lib/mock-db/pickup-summary.ts
// Ringkasan JADWAL penjemputan kurir untuk kartu di halaman Pesanan OMS: hari ini ada penjemputan
// atau tidak (Minggu / libur admin), berapa paket yang dijadwalkan dari gudang mana, dan berapa
// yang jadwalnya sudah terlewat.
//
// Keputusan pemilik 2026-10-09: jadwal rutin tampil di KARTU, bukan di lonceng — lonceng hanya
// memuat penyimpangan (lihat order-issues.ts: 'jadwal_jemput_terlewat'). Karena itu berkas ini
// tak menghasilkan notifikasi apa pun; ia hanya menghitung angka untuk ditampilkan.
//
// Sumber angkanya orders.pickup_date (migration 20261009120000). Pesanan yang dibooking sebelum
// kolom itu ada tak punya jadwal tercatat dan TIDAK ikut dihitung — kartu menyebutkan jumlah
// pesanan Diproses tanpa jadwal supaya admin tahu angkanya bukan keseluruhan.
//
// SERVER-ONLY: memakai createAdminClient() (service_role). Jangan diimpor dari komponen 'use client'.

import { createAdminClient } from '@/lib/supabase/server'
import { readWarehouses } from '@/lib/mock-db/warehouses'
import { getPickupHolidays } from '@/lib/mock-db/settings'
import {
  PICKUP_CUTOFF_HOUR_WIB,
  PICKUP_TIME_HHMM,
  nextPickupDate,
  resolvePickupDate,
  toHolidaySet,
} from '@/lib/pickup-schedule'

export type PickupDayStatus =
  | 'hari-ini' // hari pickup, sebelum cutoff: pesanan baru masih ikut hari ini
  | 'lewat-cutoff' // hari pickup, lewat cutoff: kurir tetap datang untuk yang sudah terjadwal
  | 'minggu'
  | 'libur'

export type PickupWarehouseCount = {
  warehouseId: string | null // null = pesanan lama tanpa gudang pemenuh
  name: string
  count: number
}

export type PickupScheduleSummary = {
  // false bila kolom pickup_date belum di-migrate — kartu menampilkan keterangan, bukan angka nol
  // yang menyesatkan.
  available: boolean
  today: string // YYYY-MM-DD (WIB)
  hour: number // jam dinding WIB saat dihitung
  status: PickupDayStatus
  holidayLabel?: string // keterangan libur hari ini, bila admin mengisinya
  cutoffHour: number
  pickupTime: string // HH:mm slot penjemputan
  // Hari pickup berikutnya SETELAH hari ini (selalu ada, kecuali konfigurasi rusak).
  nextDate: string | null
  // Paket terjadwal hari ini (0 bila hari ini bukan hari pickup) dan pada hari pickup berikutnya.
  todayCount: number
  nextCount: number
  // Rincian per gudang untuk tanggal yang RELEVAN: hari ini bila hari pickup, selain itu nextDate.
  byWarehouse: PickupWarehouseCount[]
  // Jadwalnya sudah lewat tapi masih Diproses — angka yang sama dengan 'jadwal_jemput_terlewat'.
  overdueCount: number
  // Pesanan Diproses ber-resi yang tak punya jadwal tercatat (dibooking sebelum migration).
  unscheduledCount: number
}

type Row = { warehouse_id: string | null; pickup_date: string | null }

// Pagar, bukan paginasi — paket Diproses yang menembus angka ini berarti gudang punya masalah lain.
const SOURCE_LIMIT = 2000

export async function readPickupScheduleSummary(
  nowMs: number = Date.now(),
): Promise<PickupScheduleSummary> {
  const holidayList = await getPickupHolidays()
  const holidays = toHolidaySet(holidayList)
  const resolved = resolvePickupDate(nowMs, holidays)
  const today = resolved.today

  const status: PickupDayStatus =
    resolved.reason === 'hari-libur'
      ? 'libur'
      : resolved.reason === 'bukan-hari-pickup'
        ? 'minggu'
        : resolved.reason
  const holidayLabel = holidayList.find((h) => h.date === today)?.label
  const nextDate = nextPickupDate(today, holidays)
  const isPickupToday = status === 'hari-ini' || status === 'lewat-cutoff'

  const base: PickupScheduleSummary = {
    available: true,
    today,
    hour: resolved.hour,
    status,
    ...(holidayLabel ? { holidayLabel } : {}),
    cutoffHour: PICKUP_CUTOFF_HOUR_WIB,
    pickupTime: PICKUP_TIME_HHMM,
    nextDate,
    todayCount: 0,
    nextCount: 0,
    byWarehouse: [],
    overdueCount: 0,
    unscheduledCount: 0,
  }

  const supabase = createAdminClient()
  // Hanya paket yang menunggu kurir: lunas, Diproses, resi sudah terbit. Pesanan tanpa jadwal ikut
  // ditarik (pickup_date null) supaya bisa dihitung terpisah sebagai "tanpa jadwal".
  const { data, error } = await supabase
    .from('orders')
    .select('warehouse_id, pickup_date')
    .eq('order_status', 'PROCESSING')
    .eq('shipment_status', 'BOOKED')
    .limit(SOURCE_LIMIT)

  if (error) {
    if (error.code === '42703' || error.code === 'PGRST204') {
      console.error('[pickup-summary] kolom pickup_date belum di-migrate — kartu jadwal nonaktif')
      return { ...base, available: false }
    }
    console.error('[pickup-summary] gagal membaca pesanan:', error.message)
    return { ...base, available: false }
  }

  const rows = (data ?? []) as Row[]
  const targetDate = isPickupToday ? today : nextDate
  const perGudang = new Map<string | null, number>()

  for (const row of rows) {
    if (!row.pickup_date) {
      base.unscheduledCount += 1
      continue
    }
    if (row.pickup_date < today) base.overdueCount += 1
    if (row.pickup_date === today) base.todayCount += 1
    if (nextDate && row.pickup_date === nextDate) base.nextCount += 1
    if (targetDate && row.pickup_date === targetDate) {
      perGudang.set(row.warehouse_id, (perGudang.get(row.warehouse_id) ?? 0) + 1)
    }
  }

  if (perGudang.size > 0) {
    // Nama gudang di-resolve sekali untuk semua baris; gudang yang sudah dihapus tetap tampil
    // sebagai id-nya supaya angkanya tidak hilang dari jumlah.
    const names = new Map((await readWarehouses()).map((w) => [w.id, w.nama]))
    base.byWarehouse = [...perGudang.entries()]
      .map(([warehouseId, count]) => ({
        warehouseId,
        name: warehouseId ? (names.get(warehouseId) ?? warehouseId) : 'Belum ditentukan',
        count,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }

  return base
}
