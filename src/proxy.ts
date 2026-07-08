// src/proxy.ts
// Network boundary OMS (Next.js 16 Proxy — pengganti middleware lama).
// Guard area dashboard: tanpa cookie sesi admin → redirect ke /oms/login dengan ?redirect
// berisi tujuan awal, agar setelah login bisa diarahkan balik ke halaman yang dituju.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { OMS_SESSION_COOKIE, verifySessionToken } from '@/lib/oms-auth'

export async function proxy(request: NextRequest) {
  // Verifikasi TANDA TANGAN token sesi (bukan sekadar keberadaan cookie) — cookie tak bisa dipalsukan.
  const token = request.cookies.get(OMS_SESSION_COOKIE)?.value
  const adminId = await verifySessionToken(token)
  if (adminId) return NextResponse.next()

  // Belum login / token invalid / kedaluwarsa → arahkan ke login, bawa tujuan awal untuk redirect-after-login.
  const loginUrl = new URL('/oms/login', request.url)
  const { pathname, search } = request.nextUrl
  loginUrl.searchParams.set('redirect', `${pathname}${search}`)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  // Hanya jalankan guard di area dashboard OMS. Halaman /oms/login tidak ikut diproteksi.
  matcher: '/oms/dashboard/:path*',
}
