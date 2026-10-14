// src/lib/mock-db/pickup-summary.ts
// Ringkasan JADWAL penjemputan kurir untuk kartu di halaman Pesanan OMS: hari ini ada penjemputan
// atau tidak (Minggu / libur admin), berapa paket per GUDANG × KURIR, dan berapa yang jadwalnya
// sudah terlewat. Hitungannya sendiri ada di lib/pickup-summary-aggregate.ts (murni, teruji unit).
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
import { getPickupHolidays, getPickupSchedule } from '@/lib/mock-db/settings'
import {
  nextPickupDate,
  pickupHoursFor,
  resolvePickupDate,
  toHolidaySet,
  type PickupSchedule,
} from '@/lib/pickup-schedule'
import { OFFERED_COURIER_IDS, courierDisplayName } from '@/lib/mengantar-estimate'
import { aggregatePickupRows, type PickupAggregate, type PickupRow } from '@/lib/pickup-summary-aggregate'

// "17:00" dari jam bulat — bentuk yang sudah dipakai kartu sejak awal (lihat jam() di kartu).
const hhmm = (hour: number) => `${String(hour).padStart(2, '0')}:00`

// Jam yang berlaku per ekspedisi pada satu tanggal.
export type CourierPickupTime = {
  courier: string // kode API ('JT', 'spx')
  label: string // 'J&T', 'Shopee Express'
  pickupTime: string // HH:mm
  cutoffHour: number
  special: boolean
}

function jamPerKurir(date: string, schedule: PickupSchedule): CourierPickupTime[] {
  return OFFERED_COURIER_IDS.map((courier) => {
    const h = pickupHoursFor(date, schedule, courier)
    return {
      courier,
      label: courierDisplayName(courier),
      pickupTime: hhmm(h.pickupHour),
      cutoffHour: h.cutoffHour,
      special: h.special,
    }
  })
}

export type PickupDayStatus =
  | 'hari-ini' // hari pickup, sebelum cutoff: pesanan baru masih ikut hari ini
  | 'lewat-cutoff' // hari pickup, lewat cutoff: kurir tetap datang untuk yang sudah terjadwal
  | 'minggu'
  | 'libur'

export type PickupScheduleSummary = PickupAggregate & {
  // false bila kolom pickup_date belum di-migrate — kartu menampilkan keterangan, bukan angka nol
  // yang menyesatkan.
  available: boolean
  today: string // YYYY-MM-DD (WIB)
  status: PickupDayStatus
  holidayLabel?: string // keterangan libur hari ini, bila admin mengisinya
  // Tanggal yang dirinci tabel: HARI INI bila hari jemput, selain itu (Minggu/libur) hari jemput
  // berikutnya — keputusan pemilik 2026-10-14. null hanya bila konfigurasi libur rusak.
  targetDate: string | null
  // Jam per ekspedisi pada targetDate (rutin atau khusus, diatur di OMS → Pengaturan) — judul kolom.
  couriers: CourierPickupTime[]
  specialLabel?: string // keterangan jam khusus pada targetDate, bila ada
  // Hari jemput SETELAH targetDate — catatan kaki "pesanan lewat batas masuk jadwal berikutnya".
  // Hanya diisi pada hari jemput; di hari Minggu/libur pesanan baru justru masuk targetDate.
  followingDate: string | null
  warehouseId?: string // terisi = ringkasan satu gudang saja
}

// Pagar, bukan paginasi — paket Diproses yang menembus angka ini berarti gudang punya masalah lain.
const SOURCE_LIMIT = 2000

// `warehouseId` diisi = ringkasan satu gudang (disiapkan untuk admin per gudang; peran itu belum ada,
// jadi saat ini hanya bisa dipakai lewat ?gudang= di API).
export async function readPickupScheduleSummary(
  options: { nowMs?: number; warehouseId?: string } = {},
): Promise<PickupScheduleSummary> {
  const nowMs = options.nowMs ?? Date.now()
  const [holidayList, schedule] = await Promise.all([getPickupHolidays(), getPickupSchedule()])
  const holidays = toHolidaySet(holidayList)
  const resolved = resolvePickupDate(nowMs, holidays, schedule)
  const today = resolved.today

  const status: PickupDayStatus =
    resolved.reason === 'hari-libur'
      ? 'libur'
      : resolved.reason === 'bukan-hari-pickup'
        ? 'minggu'
        : resolved.reason
  const holidayLabel = holidayList.find((h) => h.date === today)?.label
  const isPickupToday = status === 'hari-ini' || status === 'lewat-cutoff'
  const targetDate = isPickupToday ? today : nextPickupDate(today, holidays)
  const followingDate = isPickupToday && targetDate ? nextPickupDate(targetDate, holidays) : null
  const specialLabel = targetDate ? pickupHoursFor(targetDate, schedule).label : undefined

  const base: PickupScheduleSummary = {
    available: true,
    today,
    status,
    ...(holidayLabel ? { holidayLabel } : {}),
    targetDate,
    couriers: targetDate ? jamPerKurir(targetDate, schedule) : [],
    ...(specialLabel ? { specialLabel } : {}),
    followingDate,
    ...(options.warehouseId ? { warehouseId: options.warehouseId } : {}),
    warehouses: [],
    targetTotal: 0,
    overdueCount: 0,
    unscheduledCount: 0,
    followingCount: 0,
  }

  const supabase = createAdminClient()
  // Hanya paket yang menunggu kurir: Diproses dan resi sudah terbit (BOOKED). Tiga kolom ramping;
  // angka dihitung di server (keputusan pemilik 2026-10-14: tanpa fungsi SQL/migration — barisnya
  // hanya paket yang sedang menunggu dijemput, bukan seluruh riwayat pesanan).
  const [{ data, error }, allWarehouses] = await Promise.all([
    supabase
      .from('orders')
      .select('warehouse_id, pickup_date, nama_ekspedisi')
      .eq('order_status', 'PROCESSING')
      .eq('shipment_status', 'BOOKED')
      .limit(SOURCE_LIMIT),
    readWarehouses(),
  ])

  if (error) {
    if (error.code === '42703' || error.code === 'PGRST204') {
      console.error('[pickup-summary] kolom pickup_date belum di-migrate — kartu jadwal nonaktif')
    } else {
      console.error('[pickup-summary] gagal membaca pesanan:', error.message)
    }
    return { ...base, available: false }
  }

  const aggregate = aggregatePickupRows({
    rows: (data ?? []) as PickupRow[],
    // Gudang default lebih dulu, sisanya urutan pembuatan (readWarehouses sudah urut created_at).
    activeWarehouses: allWarehouses
      .filter((w) => w.isActive)
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault)),
    warehouseNames: new Map(allWarehouses.map((w) => [w.id, w.nama])),
    courierIds: OFFERED_COURIER_IDS,
    today,
    targetDate,
    followingDate,
    warehouseId: options.warehouseId,
  })

  return { ...base, ...aggregate }
}
