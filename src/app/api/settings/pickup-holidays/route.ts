// src/app/api/settings/pickup-holidays/route.ts
// Hari libur penjemputan kurir (gudang tutup) — store_settings.pickup_holidays.
//   GET   → ADMIN ONLY (sesi OMS apa pun perannya). { holidays: [{ date, label? }], today }
//           `today` = tanggal WIB menurut server, dipakai form sebagai batas bawah input tanggal —
//           dihitung di sini supaya komponen klien tak perlu memanggil Date.now() saat render.
//   PATCH → peran 'admin' saja. Body { holidays: [{ date, label? }] } = SELURUH daftar baru;
//           bukan tambah/hapus satu-satu, supaya yang tersimpan selalu persis yang terlihat admin
//           di layar. Balasan { success, holidays, dropped } — `dropped` = tanggal lampau yang
//           dibuang diam-diam (lihat normalizePickupHolidays).
//
// Aturan jadwalnya sendiri ada di lib/pickup-schedule.ts; pemakainya cron slot pickup dan booking
// kurir. Tak ada revalidateTag: pembacanya tidak lewat unstable_cache, jadi perubahan berlaku pada
// pesanan berikutnya tanpa invalidasi apa pun.

import { NextResponse } from 'next/server'
import { requireAdmin, requireAdminRole } from '@/lib/oms-guard'
import { getPickupHolidays, setPickupHolidays } from '@/lib/mock-db/settings'
import { normalizePickupHolidays, wibDateString } from '@/lib/pickup-schedule'

export const runtime = 'nodejs'

export async function GET() {
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  const holidays = await getPickupHolidays()
  return NextResponse.json({ holidays, today: wibDateString(Date.now()) })
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

  // "Hari ini" dalam WIB, bukan UTC: libur yang didaftarkan pukul 05.00 WIB untuk hari itu juga
  // masih sah, meski di jam UTC server tanggalnya belum berganti.
  const result = normalizePickupHolidays(body.holidays, wibDateString(Date.now()))
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 })
  }

  try {
    const saved = await setPickupHolidays(result.holidays)
    return NextResponse.json({ success: true, holidays: saved, dropped: result.dropped })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Gagal menyimpan pengaturan.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
