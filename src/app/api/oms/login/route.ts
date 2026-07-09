// src/app/api/oms/login/route.ts
// API login OMS: verifikasi kredensial ke tabel admin_users (Supabase), lalu set cookie sesi
// BERTANDA TANGAN & httpOnly. Menggantikan login dummy client-side yang lama (cookie forgeable).

import { NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/mock-db/admins'
import {
  createSessionToken,
  OMS_SESSION_COOKIE,
  OMS_SESSION_MAX_AGE_DEFAULT,
  OMS_SESSION_MAX_AGE_REMEMBER,
} from '@/lib/oms-auth'

// createAdminClient (Supabase) + node:crypto butuh runtime Node.js, bukan Edge
export const runtime = 'nodejs'

// === Rate limit sederhana (in-memory, best-effort) ===
// Batasi percobaan login per kunci (IP + username) untuk melambatkan brute force.
// Catatan: in-memory per-instance — bukan pengganti rate limit terpusat di production.
const MAX_ATTEMPTS = 5
const WINDOW_MS = 60_000 // 1 menit
const attempts = new Map<string, { count: number; resetAt: number }>()

function rateLimited(key: string): boolean {
  const now = Date.now()
  const entry = attempts.get(key)
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }
  entry.count += 1
  return entry.count > MAX_ATTEMPTS
}

export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const remember = body.remember === true

  if (!username || !password) {
    return NextResponse.json({ error: 'Email kerja dan kata sandi wajib diisi.' }, { status: 400 })
  }

  // Kunci rate limit: IP (dari header proxy) + username
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  if (rateLimited(`${ip}:${username.toLowerCase()}`)) {
    return NextResponse.json(
      { error: 'Terlalu banyak percobaan login. Coba lagi dalam 1 menit.' },
      { status: 429 },
    )
  }

  const admin = await authenticateAdmin(username, password)
  if (!admin) {
    // Pesan generik (jangan bocorkan apakah username ada atau password yang salah)
    return NextResponse.json(
      { error: 'Email kerja atau kata sandi salah. Silakan periksa kembali.' },
      { status: 401 },
    )
  }

  const maxAge = remember ? OMS_SESSION_MAX_AGE_REMEMBER : OMS_SESSION_MAX_AGE_DEFAULT
  const token = await createSessionToken(admin.id, maxAge)

  const res = NextResponse.json({ success: true, name: admin.name })
  res.cookies.set(OMS_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  })
  return res
}
