// src/lib/mock-db/admins.ts
// Akses data akun admin OMS (tabel public.admin_users) + verifikasi password.
// SERVER-ONLY: memakai createAdminClient() (service_role) & node:crypto. Jangan diimpor dari 'use client'.
//
// Password disimpan sebagai hash scrypt berformat "saltHex:hashHex" (tanpa dependency eksternal).
// Login memverifikasi via verifyPassword; seed admin awal lewat SQL (lihat supabase/migrations).

import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/server'

const SCRYPT_KEYLEN = 64

type AdminRow = {
  id: string
  username: string
  password_hash: string
  name: string | null
  is_active: boolean
}

// Membuat hash password scrypt berformat "saltHex:hashHex" (dipakai saat seeding/ganti password).
export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

// Memverifikasi password terhadap hash tersimpan. Perbandingan waktu-konstan (anti timing attack).
export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false
  try {
    const salt = Buffer.from(saltHex, 'hex')
    const expected = Buffer.from(hashHex, 'hex')
    const actual = scryptSync(password, salt, expected.length)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

// Mencari admin aktif berdasarkan username (case-insensitive) & memverifikasi password.
// Mengembalikan { id, name } bila cocok, atau null bila tidak ada / password salah / nonaktif.
export async function authenticateAdmin(
  username: string,
  password: string,
): Promise<{ id: string; name: string } | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('admin_users')
    .select('id, username, password_hash, name, is_active')
    .ilike('username', username.trim())
    .maybeSingle()

  if (error) {
    console.error('Gagal membaca admin dari Supabase:', error.message)
    return null
  }
  const row = data as AdminRow | null
  if (!row || !row.is_active) return null
  if (!verifyPassword(password, row.password_hash)) return null

  return { id: row.id, name: row.name ?? row.username }
}
