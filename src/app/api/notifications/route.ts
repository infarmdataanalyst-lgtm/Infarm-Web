// src/app/api/notifications/route.ts
// Daftar notifikasi OMS (dihitung real-time, lihat lib/mock-db/notifications.ts).
//   GET → ADMIN ONLY. Mengembalikan { items, total, unreadCount, lastSeen }.
//
// ADMIN ONLY termasuk untuk peran 'staff': isinya memuat nama pembeli & nilai pesanan, jadi tak
// boleh terbuka ke publik. proxy.ts hanya menjaga HALAMAN /oms/dashboard/*, route /api/* wajib
// memanggil requireAdmin() sendiri.

import { NextResponse } from 'next/server'
import { getAdminId, requireAdmin } from '@/lib/oms-guard'
import { getOmsNotifications } from '@/lib/mock-db/notifications'
import { getNotifLastSeen } from '@/lib/mock-db/settings'

// createAdminClient (Supabase) butuh runtime Node.js, bukan Edge
export const runtime = 'nodejs'

// Batas atas per permintaan — panel header minta 10, halaman /notifikasi minta 20.
const MAX_LIMIT = 50

export async function GET(request: Request) {
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  // requireAdmin() sudah lolos, jadi id-nya pasti ada; guard ini hanya untuk penyempitan tipe.
  const adminId = await getAdminId()
  if (!adminId) return NextResponse.json({ error: 'Sesi tidak valid.' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  // Nilai tak masuk akal DIABAIKAN (jatuh ke default), bukan dijadikan error — pola sama dengan
  // filter gudang di halaman Pesanan: URL lama/bookmark harus tetap menampilkan data.
  const rawLimit = Number.parseInt(searchParams.get('limit') ?? '', 10)
  const rawOffset = Number.parseInt(searchParams.get('offset') ?? '', 10)
  const limit = Number.isFinite(rawLimit) ? Math.min(MAX_LIMIT, Math.max(1, rawLimit)) : 10
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0

  const lastSeen = await getNotifLastSeen(adminId)
  const page = await getOmsNotifications({ lastSeen, limit, offset })

  return NextResponse.json({ ...page, lastSeen })
}
