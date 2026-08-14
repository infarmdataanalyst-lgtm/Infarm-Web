// src/app/api/settings/store-profile/route.ts
// Profil toko: nama & deskripsi (store_settings.store_name / store_description).
//   GET   → ADMIN ONLY (requireAdmin, peran apa pun)
//   PATCH → peran 'admin' saja (requireAdminRole)
//
// ALAMAT GUDANG TIDAK DIATUR DI SINI. Sumber kebenarannya tabel `warehouses`
// (kolom alamat + mengantar_origin_id), diubah di /oms/dashboard/gudang. Menyalinnya ke
// store_settings akan membuat dua sumber kebenaran — kesalahan yang sama seperti env
// WAREHOUSE_MODE yang sudah dibuang. Halaman pengaturan menampilkannya read-only + tautan.

import { NextResponse } from 'next/server'
import { requireAdmin, requireAdminRole } from '@/lib/oms-guard'
import {
  getStoreProfile,
  setStoreProfile,
  STORE_NAME_MAX,
  STORE_DESCRIPTION_MAX,
} from '@/lib/mock-db/settings'

// createAdminClient (Supabase) butuh runtime Node.js, bukan Edge
export const runtime = 'nodejs'

// Nama toko minimal 2 karakter — lebih pendek dari itu hampir pasti salah ketik, dan nama toko
// dipakai sebagai judul di UI sehingga tak boleh kosong.
const STORE_NAME_MIN = 2

export async function GET() {
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  const profile = await getStoreProfile()
  return NextResponse.json(profile)
}

export async function PATCH(request: Request) {
  const denied = await requireAdminRole(
    'Akun Anda tidak berwenang mengubah pengaturan. Hubungi admin utama.',
  )
  if (denied) return denied

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const description = typeof body.description === 'string' ? body.description.trim() : ''

  // Divalidasi ulang di server, bukan hanya di form — endpoint bisa dipanggil langsung.
  if (name.length < STORE_NAME_MIN) {
    return NextResponse.json(
      { error: `Nama toko minimal ${STORE_NAME_MIN} karakter.`, field: 'name' },
      { status: 422 },
    )
  }
  if (name.length > STORE_NAME_MAX) {
    return NextResponse.json(
      { error: `Nama toko maksimal ${STORE_NAME_MAX} karakter.`, field: 'name' },
      { status: 422 },
    )
  }
  if (description.length > STORE_DESCRIPTION_MAX) {
    return NextResponse.json(
      { error: `Deskripsi maksimal ${STORE_DESCRIPTION_MAX} karakter.`, field: 'description' },
      { status: 422 },
    )
  }

  try {
    const saved = await setStoreProfile({ name, description })
    return NextResponse.json({ success: true, ...saved })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Gagal menyimpan pengaturan.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
