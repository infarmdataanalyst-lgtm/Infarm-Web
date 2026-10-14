// src/app/api/oms/pickup-schedule/route.ts
// Ringkasan jadwal penjemputan kurir untuk kartu di halaman Pesanan OMS.
//   GET [?gudang=<uuid>] → ADMIN ONLY (sesi OMS apa pun perannya). Bentuk: PickupScheduleSummary
//         (src/lib/mock-db/pickup-summary.ts). `gudang` = ringkasan satu gudang saja — disiapkan
//         untuk admin per gudang; peran itu belum ada, jadi kartu saat ini tak mengirimnya.
//
// Dihitung dari keadaan terkini tiap kali diminta — tak ada cache, karena angkanya berubah setiap
// ada pembayaran masuk, dan kartunya hanya dimuat saat admin membuka halaman Pesanan.

import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/oms-guard'
import { readPickupScheduleSummary } from '@/lib/mock-db/pickup-summary'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: NextRequest) {
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  // Nilai tak valid diabaikan (ringkasan semua gudang), bukan galat — pola filter gudang lainnya.
  const raw = request.nextUrl.searchParams.get('gudang')
  const warehouseId = raw && UUID_REGEX.test(raw) ? raw : undefined

  const summary = await readPickupScheduleSummary({ warehouseId })
  return NextResponse.json(summary)
}
