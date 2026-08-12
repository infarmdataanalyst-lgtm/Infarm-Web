// src/lib/oms-guard.ts
// Guard otorisasi untuk route handler OMS (server-only).
// Memverifikasi cookie sesi admin bertanda tangan (HMAC) — dipakai di awal tiap route
// mutasi/baca khusus OMS agar tidak bisa dipanggil anonim (menutup temuan K-1 & K-2).
//
// Catatan: proxy.ts hanya menjaga HALAMAN /oms/dashboard/*; route /api/* TIDAK tersentuh
// proxy, jadi setiap endpoint OMS wajib memanggil requireAdmin() sendiri.

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { OMS_SESSION_COOKIE, verifySessionToken } from '@/lib/oms-auth'
import { getAdminById, type AdminIdentity } from '@/lib/mock-db/admins'

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
  const adminId = await getAdminId()
  if (adminId) return null
  return NextResponse.json(
    { error: 'Tidak terautentikasi. Silakan login sebagai admin OMS.' },
    { status: 401 },
  )
}

// Guard khusus PENULISAN STOK. Selain sesi valid, akun wajib berperan 'admin'.
// Peran 'staff' boleh melihat stok tapi tidak menulisnya → 403 (bukan 401: ia sudah login,
// yang kurang adalah wewenang).
//
// Pola pakai:
//   const denied = await requireStockEditor()
//   if (denied) return denied
export async function requireStockEditor(): Promise<NextResponse | null> {
  const identity = await getAdminIdentity()
  if (!identity) {
    return NextResponse.json(
      { error: 'Tidak terautentikasi. Silakan login sebagai admin OMS.' },
      { status: 401 },
    )
  }
  if (identity.role !== 'admin') {
    return NextResponse.json(
      {
        error: 'Akun Anda tidak berwenang mengubah stok. Hubungi admin utama.',
        code: 'FORBIDDEN_ROLE',
      },
      { status: 403 },
    )
  }
  return null
}
