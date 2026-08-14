// src/app/api/notifications/mark-read/route.ts
// Menandai seluruh notifikasi sebagai sudah dibaca untuk admin yang sedang login.
//   POST → ADMIN ONLY. Menyimpan timestamp "last seen" (store_settings, satu baris per admin).
//
// Karena notifikasi dihitung real-time (tak ada baris per notifikasi), yang disimpan adalah SATU
// timestamp: notifikasi lebih baru dari itu = belum dibaca. Waktu diambil dari SERVER, bukan dari
// body — jam browser admin bisa salah, dan waktu masa depan akan mematikan lencana selamanya.

import { NextResponse } from 'next/server'
import { getAdminId, requireAdmin } from '@/lib/oms-guard'
import { setNotifLastSeen } from '@/lib/mock-db/settings'

// createAdminClient (Supabase) butuh runtime Node.js, bukan Edge
export const runtime = 'nodejs'

export async function POST() {
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  const adminId = await getAdminId()
  if (!adminId) return NextResponse.json({ error: 'Sesi tidak valid.' }, { status: 401 })

  const at = new Date().toISOString()
  try {
    await setNotifLastSeen(adminId, at)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Gagal menandai notifikasi.'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  return NextResponse.json({ success: true, lastSeen: at })
}
