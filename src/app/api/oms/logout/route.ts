// src/app/api/oms/logout/route.ts
// API logout OMS: hapus cookie sesi. Cookie httpOnly tak bisa dihapus dari JS client,
// jadi penghapusan harus lewat route handler server ini.

import { NextResponse } from 'next/server'
import { OMS_SESSION_COOKIE } from '@/lib/oms-auth'

export const runtime = 'nodejs'

export async function POST() {
  const res = NextResponse.json({ success: true })
  res.cookies.set(OMS_SESSION_COOKIE, '', { path: '/', maxAge: 0 })
  return res
}
