// src/app/api/settings/pickup-schedule/route.ts
// Jam penjemputan kurir & batas pesanan (cutoff) — store_settings.pickup_schedule.
//   GET   → ADMIN ONLY (sesi OMS apa pun perannya).
//           { schedule: { default: {pickupHour, cutoffHour}, overrides: [{date, pickupHour,
//             cutoffHour, label?}] }, today, holidays: string[] }
//           `today` = tanggal WIB menurut server (batas bawah input tanggal); `holidays` = tanggal
//           libur terdaftar, supaya form bisa mencegah jam khusus baru pada hari libur dan menandai
//           jam khusus lama yang tak berlaku karena tanggalnya kemudian dijadikan libur.
//   PATCH → peran 'admin' saja. Body { schedule } = SELURUH jadwal baru (pola yang sama dengan
//           pickup-holidays). Balasan { success, schedule, dropped, resetDates, bookedOnOldTime }.
//
// ── Slot yang sudah dibuat ──
// mengantar_daily_pickup menyimpan satu time_id per tanggal & alamat, dibuat dengan jam yang berlaku
// saat itu. Bila admin mengubah JAM JEMPUT sebuah tanggal yang slotnya sudah ada (biasanya hari ini,
// dibuat cron 06.00, atau besok bila sudah ada pesanan lewat cutoff), slot lama dibuang supaya
// booking berikutnya membuat slot baru berjam baru. Paket yang SUDAH dibooking tetap pada slot
// lamanya — API Mengantar tak menyediakan penjadwalan ulang — dan jumlahnya dikembalikan di
// `bookedOnOldTime` agar admin bisa mengaturnya di dashboard Mengantar.
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
  countBookedOrdersOnDates,
  deletePickupSlotsForDates,
  listPickupSlotDatesFrom,
} from '@/lib/mock-db/pickup'
import { normalizePickupSchedule, slotDatesToReset, wibDateString } from '@/lib/pickup-schedule'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  const [schedule, holidays] = await Promise.all([getPickupSchedule(), getPickupHolidays()])
  return NextResponse.json({
    schedule,
    today: wibDateString(Date.now()),
    holidays: holidays.map((h) => h.date),
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
  const before = await getPickupSchedule()
  const result = normalizePickupSchedule(body.schedule, today)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 })
  }
  const after = result.schedule

  const resetDates = slotDatesToReset(before, after, await listPickupSlotDatesFrom(today))

  try {
    // Urutan: buang slot lama → simpan jadwal → buang sekali lagi.
    //   - Bila pembuangan pertama gagal, jadwal TIDAK disimpan: jadwal baru dengan slot berjam lama
    //     yang masih tertinggal adalah keadaan paling menyesatkan (layar bilang 13.00, kurir 17.00).
    //   - Pembuangan kedua menutup celah sempit: booking yang masuk di antara dua langkah pertama
    //     masih membaca jadwal lama dan bisa membuat ulang slot berjam lama.
    await deletePickupSlotsForDates(resetDates)
    const saved = await setPickupSchedule(after)
    await deletePickupSlotsForDates(resetDates)

    const bookedOnOldTime = await countBookedOrdersOnDates(resetDates)
    if (resetDates.length > 0) {
      console.log(
        `[pickup-schedule] jam jemput berubah untuk ${resetDates.join(', ')} — slot lama dibuang, ${bookedOnOldTime ?? '?'} paket tetap pada slot lama`,
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
