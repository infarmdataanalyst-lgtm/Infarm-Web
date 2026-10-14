// src/app/api/settings/pickup-schedule/route.ts
// Jam penjemputan kurir & batas pesanan (cutoff) — store_settings.pickup_schedule.
//   GET   → ADMIN ONLY (sesi OMS apa pun perannya).
//           { schedule: { default: {pickupHour, cutoffHour}, couriers?: {[kode]: {pickupHour,
//             cutoffHour}}, overrides: [{date, pickupHour, cutoffHour, courier?, label?}] },
//             today, holidays: string[], couriers: [{id, label}], perCourierSlots: boolean }
//           `today` = tanggal WIB menurut server (batas bawah input tanggal); `holidays` = tanggal
//           libur terdaftar, supaya form bisa mencegah jam khusus baru pada hari libur dan menandai
//           jam khusus lama yang tak berlaku karena tanggalnya kemudian dijadikan libur.
//           `couriers` = ekspedisi yang ditawarkan ke pembeli (pilihan dropdown "Berlaku untuk").
//           `perCourierSlots` = false bila migration 20261014120000 belum dijalankan.
//   PATCH → peran 'admin' saja. Body { schedule } = SELURUH jadwal baru (pola yang sama dengan
//           pickup-holidays). Balasan { success, schedule, dropped, resetDates, bookedOnOldTime }.
//
// ── Slot yang sudah dibuat ──
// Sejak migration 20261014120000, slot di mengantar_daily_pickup menyimpan JAM-nya (pickup_hour).
// Mengubah jam jemput tak perlu membuang apa pun: booking berikutnya mencari slot dengan jam baru,
// tak menemukannya, lalu membuatnya. Sebelum migration itu (satu slot per tanggal & alamat), slot
// tanggal yang jamnya berubah DIBUANG supaya booking berikutnya membuat ulang dengan jam baru.
//
// Pada keduanya, paket yang SUDAH dibooking tetap pada slot lamanya — API Mengantar tak menyediakan
// penjadwalan ulang — dan jumlahnya dikembalikan di `bookedOnOldTime` agar admin bisa mengaturnya
// di dashboard Mengantar.
//
// Route ini sendiri TIDAK memanggil Mengantar. Slot baru baru dibuat oleh booking/cron berikutnya,
// lewat jalur yang sudah ada (getTodayPickupTimeId → ensurePickupForDate).

import { NextResponse } from 'next/server'
import { requireAdmin, requireAdminRole } from '@/lib/oms-guard'
import {
  getPickupHolidays,
  getPickupSchedule,
  setPickupSchedule,
} from '@/lib/mock-db/settings'
import {
  deletePickupSlotsForDates,
  listBookedOrdersFrom,
  listPickupSlotDatesFrom,
  pickupSlotsSupportHour,
} from '@/lib/mock-db/pickup'
import {
  countOrdersOnChangedHour,
  normalizePickupSchedule,
  slotDatesToReset,
  wibDateString,
} from '@/lib/pickup-schedule'
import {
  OFFERED_COURIER_IDS,
  courierDisplayName,
  courierIdFromLabel,
} from '@/lib/mengantar-estimate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  const [schedule, holidays, perCourierSlots] = await Promise.all([
    getPickupSchedule(),
    getPickupHolidays(),
    pickupSlotsSupportHour(),
  ])
  return NextResponse.json({
    schedule,
    today: wibDateString(Date.now()),
    holidays: holidays.map((h) => h.date),
    couriers: OFFERED_COURIER_IDS.map((id) => ({ id, label: courierDisplayName(id) })),
    perCourierSlots,
  })
}

export async function PATCH(request: Request) {
  const denied = await requireAdminRole(
    'Akun Anda tidak berwenang mengubah pengaturan. Hubungi admin utama.',
  )
  if (denied) return denied

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  const today = wibDateString(Date.now())
  const [before, perCourierSlots] = await Promise.all([getPickupSchedule(), pickupSlotsSupportHour()])
  const result = normalizePickupSchedule(body.schedule, today, OFFERED_COURIER_IDS)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 })
  }
  const after = result.schedule

  // Database lama (tanpa kolom jam): slot tanggal yang jamnya berubah harus dibuang.
  const resetDates = perCourierSlots
    ? []
    : slotDatesToReset(before, after, await listPickupSlotDatesFrom(today), OFFERED_COURIER_IDS)

  try {
    // Urutan (hanya relevan untuk database lama): buang slot lama → simpan jadwal → buang lagi.
    //   - Bila pembuangan pertama gagal, jadwal TIDAK disimpan: jadwal baru dengan slot berjam lama
    //     yang masih tertinggal adalah keadaan paling menyesatkan (layar bilang 13.00, kurir 17.00).
    //   - Pembuangan kedua menutup celah sempit: booking yang masuk di antara dua langkah pertama
    //     masih membaca jadwal lama dan bisa membuat ulang slot berjam lama.
    await deletePickupSlotsForDates(resetDates)
    const saved = await setPickupSchedule(after)
    await deletePickupSlotsForDates(resetDates)

    // Paket terbooking yang jam jemput EKSPEDISI-nya berubah — tertinggal pada jam lama.
    const booked = await listBookedOrdersFrom(today)
    const bookedOnOldTime =
      booked === null
        ? null
        : countOrdersOnChangedHour(
            before,
            after,
            booked.map((o) => ({
              pickupDate: o.pickupDate,
              courier: courierIdFromLabel(o.courierLabel),
              slotHour: o.slotHour,
            })),
          )
    if (resetDates.length > 0 || (bookedOnOldTime ?? 0) > 0) {
      console.log(
        `[pickup-schedule] jam jemput berubah — slot dibuang: ${resetDates.join(', ') || '-'}, paket tetap pada jam lama: ${bookedOnOldTime ?? '?'}`,
      )
    }
    return NextResponse.json({
      success: true,
      schedule: saved,
      dropped: result.dropped,
      resetDates,
      bookedOnOldTime,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Gagal menyimpan jadwal penjemputan.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
