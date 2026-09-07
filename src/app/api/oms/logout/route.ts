// src/app/api/oms/logout/route.ts
// API logout OMS: hapus cookie sesi. Cookie httpOnly tak bisa dihapus dari JS client,
// jadi penghapusan harus lewat route handler server ini.

import { NextResponse } from 'next/server'
import { OMS_SESSION_COOKIE } from '@/lib/oms-auth'

export const runtime = 'nodejs'

export async function POST() {
  const res = NextResponse.json({ success: true })
  // Atribut WAJIB sama persis dengan saat cookie dibuat di /api/oms/login (httpOnly, secure,
  // sameSite, path). Browser mencocokkan cookie berdasarkan atributnya; kalau berbeda, yang
  // terjadi bukan penghapusan melainkan penulisan cookie KEDUA bernama sama, dan sesi lama tetap
  // hidup sampai kedaluwarsa sendiri.
  res.cookies.set(OMS_SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  })
  return res
}
