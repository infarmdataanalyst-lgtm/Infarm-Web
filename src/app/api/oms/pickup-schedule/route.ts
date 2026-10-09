// src/app/api/oms/pickup-schedule/route.ts
// Ringkasan jadwal penjemputan kurir untuk kartu di halaman Pesanan OMS.
//   GET → ADMIN ONLY (sesi OMS apa pun perannya). Bentuk: PickupScheduleSummary
//         (src/lib/mock-db/pickup-summary.ts).
//
// Dihitung dari keadaan terkini tiap kali diminta — tak ada cache, karena angkanya berubah setiap
// ada pembayaran masuk, dan kartunya hanya dimuat saat admin membuka halaman Pesanan.

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/oms-guard'
import { readPickupScheduleSummary } from '@/lib/mock-db/pickup-summary'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  const summary = await readPickupScheduleSummary()
  return NextResponse.json(summary)
}
