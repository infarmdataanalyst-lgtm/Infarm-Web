// src/app/api/oms/login/route.ts
// API login OMS: verifikasi kredensial ke tabel admin_users (Supabase), lalu set cookie sesi
// BERTANDA TANGAN & httpOnly. Menggantikan login dummy client-side yang lama (cookie forgeable).

import { NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/mock-db/admins'
import {
  RATE_LIMITS,
  getClientIp,
  isOverLimit,
  rateLimitResponse,
  recordAttempt,
} from '@/lib/rate-limit'
import {
  createSessionToken,
  OMS_SESSION_COOKIE,
  OMS_SESSION_MAX_AGE_DEFAULT,
  OMS_SESSION_MAX_AGE_REMEMBER,
} from '@/lib/oms-auth'

// createAdminClient (Supabase) + node:crypto butuh runtime Node.js, bukan Edge
export const runtime = 'nodejs'

// === Rate limit login ===
//
// Dulu berkas ini memelihara limiter sendiri (Map lokal + pembacaan `x-forwarded-for` sendiri).
// Duplikat itu dibuang dan diganti limiter bersama di `@/lib/rate-limit`, karena dua salinan yang
// sama pasti menyimpang: perbaikan sumber IP yang menutup pemalsuan `X-Forwarded-For` hanya
// diterapkan di satu tempat, dan berkas ini akan diam-diam tertinggal memakai versi rapuh.
//
// Tiga perubahan perilaku yang menutup temuan SEC-010:
//   1. IP diambil lewat `getClientIp()` yang tak lagi memercayai entri pertama `x-forwarded-for`
//      (entri itu dipilih klien, jadi bisa diganti tiap permintaan untuk mengelak dari limit).
//   2. HANYA percobaan GAGAL yang dihitung. Sebelumnya login yang BERHASIL pun ikut menghabiskan
//      jatah, sehingga admin yang keluar-masuk beberapa kali bisa mengunci dirinya sendiri —
//      dan itu pula yang membuat ambangnya dulu terpaksa dibuat longgar.
//   3. Ditambah lapis per-AKUN lintas IP (`OMS_LOGIN_USER`). Tanpa itu, penyerang cukup berganti
//      IP untuk mendapat jatah tebakan baru berulang kali, dan pembatasan per-IP tak berarti.
//
// Sisa yang TIDAK ditutup di sini: hitungannya masih di memori tiap instance, sehingga di
// serverless multi-instance batas efektifnya berlipat sebanyak instance aktif. Itu dilacak
// terpisah sebagai temuan SEC-029 dan butuh penyimpanan bersama (tabel Supabase / Redis).

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

  const ip = getClientIp(request)
  const akun = username.toLowerCase()

  // Tiga lapis, masing-masing menutup celah yang tak ditutup lapis lain:
  //   ipKey     — satu sumber membanjiri banyak akun sekaligus
  //   ipUserKey — satu sumber menebak satu akun
  //   userKey   — BANYAK sumber menebak satu akun (brute-force terdistribusi)
  const ipKey = `oms-login:ip:${ip}`
  const ipUserKey = `oms-login:ip-user:${ip}:${akun}`
  const userKey = `oms-login:user:${akun}`

  // Diperiksa TANPA mencatat: pencatatan ditunda sampai hasil autentikasi diketahui, supaya login
  // yang benar tidak ikut menghabiskan jatah.
  for (const [key, rule] of [
    [ipKey, RATE_LIMITS.OMS_LOGIN_IP],
    [ipUserKey, RATE_LIMITS.OMS_LOGIN_IP_USER],
    [userKey, RATE_LIMITS.OMS_LOGIN_USER],
  ] as const) {
    if (isOverLimit(key, rule)) return rateLimitResponse(rule, key)
  }

  const admin = await authenticateAdmin(username, password)
  if (!admin) {
    // Gagal → baru dicatat ke ketiga lapis.
    recordAttempt(ipKey, RATE_LIMITS.OMS_LOGIN_IP)
    recordAttempt(ipUserKey, RATE_LIMITS.OMS_LOGIN_IP_USER)
    recordAttempt(userKey, RATE_LIMITS.OMS_LOGIN_USER)
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
