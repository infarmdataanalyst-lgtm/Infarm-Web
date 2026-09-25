// src/app/api/oms/me/route.ts
// Identitas admin yang sedang login — dipakai header OMS (nama & peran asli, menggantikan teks
// hardcode) dan halaman Pengaturan (menyembunyikan tombol Simpan untuk peran 'staff').
//   GET → sesi valid apa pun perannya. Balas 401 bila tak login.
//
// Peran SELALU dibaca ulang dari DB lewat getAdminIdentity(), bukan dari cookie — menurunkan
// peran seseorang langsung berlaku tanpa menunggu sesinya kedaluwarsa.
//
// CATATAN: `canEdit` di sini HANYA untuk menyembunyikan tombol. Penjagaan sebenarnya ada di
// requireAdminRole() pada tiap endpoint tulis — UI bukan penjagaan.

import { NextResponse } from 'next/server'
import { getAdminIdentity } from '@/lib/oms-guard'

// getAdminById (Supabase) butuh runtime Node.js, bukan Edge
export const runtime = 'nodejs'

export async function GET() {
  const identity = await getAdminIdentity()
  if (!identity) {
    return NextResponse.json(
      { error: 'Tidak terautentikasi. Silakan login sebagai admin OMS.' },
      { status: 401 },
    )
  }

  return NextResponse.json({
    name: identity.name,
    role: identity.role,
    canEdit: identity.role === 'admin',
  })
}
