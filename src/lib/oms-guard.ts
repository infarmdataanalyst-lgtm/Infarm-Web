// src/lib/oms-guard.ts
// Guard otorisasi untuk route handler OMS (server-only).
// Memverifikasi cookie sesi admin bertanda tangan (HMAC) — dipakai di awal tiap route
// mutasi/baca khusus OMS agar tidak bisa dipanggil anonim (menutup temuan K-1 & K-2).
//
// Catatan: proxy.ts hanya menjaga HALAMAN /oms/dashboard/*; route /api/* TIDAK tersentuh
// proxy, jadi setiap endpoint OMS wajib memanggil requireAdmin() sendiri.

import { cookies, headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { OMS_SESSION_COOKIE, verifySessionToken } from '@/lib/oms-auth'
import { getAdminById, type AdminIdentity } from '@/lib/mock-db/admins'

// === Penjagaan lintas-situs (CSRF) ===
//
// Project ini TIDAK memakai Server Action sama sekali, jadi tak mendapat pengecekan origin otomatis
// dari Next.js; seluruh mutasi lewat Route Handler custom. Sampai SEC-026 ditutup, satu-satunya
// penahan adalah cookie SameSite.
//
// ⚠️ Yang dulu dicatat sebagai peredam kedua — "Content-Type application/json memicu preflight
// CORS" — TIDAK BERLAKU di sini: tak ada satu pun route yang memvalidasi Content-Type, dan
// `request.json()` mengabaikan header itu. Form lintas-situs ber-`enctype="text/plain"` karena itu
// lolos tanpa preflight sama sekali. Jangan mengandalkan alasan itu lagi.
//
// Yang diperiksa, berurutan:
//   1. `Sec-Fetch-Site` — ditulis browser, tak bisa disetel skrip halaman. Inilah sinyal utama.
//      'same-origin' = fetch dari halaman kita. 'none' = navigasi langsung (ketik URL/bookmark).
//      'cross-site' dan 'same-site' DITOLAK; subdomain lain tak punya urusan memanggil API OMS.
//   2. `Origin` — cadangan untuk browser lama yang belum mengirim Sec-Fetch-Site.
//   3. Keduanya absen → diloloskan. Ini BUKAN celah CSRF: serangan CSRF selalu berasal dari
//      browser, dan setiap browser yang bisa melakukannya mengirim salah satu header di atas.
//      Yang tersisa di cabang ini adalah curl, skrip server-to-server, dan uji otomatis.
async function isSameOriginRequest(): Promise<boolean> {
  const h = await headers()

  const fetchSite = h.get('sec-fetch-site')
  if (fetchSite) return fetchSite === 'same-origin' || fetchSite === 'none'

  const origin = h.get('origin')
  if (!origin) return true

  // x-forwarded-host lebih dulu: di belakang proxy Vercel, `host` bisa berisi host internal.
  const host = h.get('x-forwarded-host') ?? h.get('host')
  if (!host) return false

  try {
    return new URL(origin).host === host
  } catch {
    return false // Origin tak bisa di-parse = tidak dipercaya.
  }
}

// 403, bukan 401: pemanggilnya boleh jadi admin yang sah dengan sesi yang sah — yang ditolak adalah
// ASAL permintaannya. Menjawab 401 akan menyuruh UI melempar admin ke halaman login, padahal
// login ulang tak memperbaiki apa pun.
function crossSiteDenied(): NextResponse {
  return NextResponse.json(
    { error: 'Permintaan lintas situs ditolak.', code: 'CROSS_SITE_DENIED' },
    { status: 403 },
  )
}

// Mengembalikan adminId dari cookie sesi bila valid, atau null bila tidak terautentikasi.
export async function getAdminId(): Promise<string | null> {
  const store = await cookies()
  const token = store.get(OMS_SESSION_COOKIE)?.value
  return verifySessionToken(token)
}

// Identitas lengkap admin yang sedang login (id, nama, peran). null bila tak terautentikasi
// atau akunnya sudah tidak ada. Cookie sesi hanya menyimpan id — peran SELALU dibaca ulang dari
// DB, supaya menurunkan peran seseorang langsung berlaku tanpa menunggu sesinya kedaluwarsa.
export async function getAdminIdentity(): Promise<AdminIdentity | null> {
  const adminId = await getAdminId()
  if (!adminId) return null
  return getAdminById(adminId)
}

// Guard untuk route handler OMS.
// Kembalikan Response 401 bila pemanggil bukan admin, atau null bila lolos (boleh lanjut).
// Pola pakai:
//   const unauthorized = await requireAdmin()
//   if (unauthorized) return unauthorized
export async function requireAdmin(): Promise<NextResponse | null> {
  // Asal permintaan diperiksa LEBIH DULU: permintaan lintas situs ditolak tanpa perlu menyentuh
  // cookie maupun database sama sekali.
  if (!(await isSameOriginRequest())) return crossSiteDenied()

  const adminId = await getAdminId()
  if (adminId) return null
  return NextResponse.json(
    { error: 'Tidak terautentikasi. Silakan login sebagai admin OMS.' },
    { status: 401 },
  )
}

// Guard untuk aksi yang menuntut peran 'admin' (bukan sekadar sesi valid).
// Peran 'staff' boleh MELIHAT tapi tidak mengubah → 403 (bukan 401: ia sudah login, yang kurang
// adalah wewenang). Pesan penolakan bisa disesuaikan agar admin tahu aksi mana yang ditolak.
//
// Pola pakai:
//   const denied = await requireAdminRole('Akun Anda tidak berwenang mengubah pengaturan.')
//   if (denied) return denied
export async function requireAdminRole(forbiddenMessage: string): Promise<NextResponse | null> {
  // Jalur ini TIDAK lewat requireAdmin, jadi pemeriksaan asal harus diulang di sini — kalau tidak,
  // endpoint yang justru paling sensitif (pengaturan toko, tulis stok) menjadi satu-satunya yang
  // tak terjaga dari lintas situs.
  if (!(await isSameOriginRequest())) return crossSiteDenied()

  const identity = await getAdminIdentity()
  if (!identity) {
    return NextResponse.json(
      { error: 'Tidak terautentikasi. Silakan login sebagai admin OMS.' },
      { status: 401 },
    )
  }
  if (identity.role !== 'admin') {
    return NextResponse.json({ error: forbiddenMessage, code: 'FORBIDDEN_ROLE' }, { status: 403 })
  }
  return null
}

// Guard khusus PENULISAN STOK — requireAdminRole dengan pesan spesifik stok.
export async function requireStockEditor(): Promise<NextResponse | null> {
  return requireAdminRole('Akun Anda tidak berwenang mengubah stok. Hubungi admin utama.')
}
