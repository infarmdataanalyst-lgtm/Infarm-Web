// src/proxy.ts
// Network boundary OMS (Next.js 16 Proxy — pengganti middleware lama).
// Guard area dashboard: tanpa cookie sesi admin → redirect ke /oms/login dengan ?redirect
// berisi tujuan awal, agar setelah login bisa diarahkan balik ke halaman yang dituju.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { OMS_SESSION_COOKIE } from '@/lib/oms-auth'

export function proxy(request: NextRequest) {
  // Sudah punya sesi → lanjutkan request seperti biasa.
  if (request.cookies.has(OMS_SESSION_COOKIE)) return NextResponse.next()

  // Belum login → arahkan ke login, bawa tujuan awal (path + query) untuk redirect-after-login.
  const loginUrl = new URL('/oms/login', request.url)
  const { pathname, search } = request.nextUrl
  loginUrl.searchParams.set('redirect', `${pathname}${search}`)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  // Hanya jalankan guard di area dashboard OMS. Halaman /oms/login tidak ikut diproteksi.
  matcher: '/oms/dashboard/:path*',
}
