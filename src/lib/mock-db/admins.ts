// src/lib/mock-db/admins.ts
// Akses data akun admin OMS (tabel public.admin_users) + verifikasi password.
// SERVER-ONLY: memakai createAdminClient() (service_role) & node:crypto. Jangan diimpor dari 'use client'.
//
// Password disimpan sebagai hash scrypt berformat "saltHex:hashHex" (tanpa dependency eksternal).
// Login memverifikasi via verifyPassword; seed admin awal lewat SQL (lihat supabase/migrations).

import { createHash, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/server'

const SCRYPT_KEYLEN = 64

// === Daftar hitam kredensial yang sudah bocor (temuan SEC-011) ===
//
// Migration 20260708120000 dulu men-seed akun OMS pertama dengan password lemah BESERTA hash-nya,
// keduanya tertulis polos di file yang ikut ter-commit. Password itu sudah dirotasi di database,
// tapi rotasi saja belum menutup lubangnya: hash lama masih hidup di riwayat Git, di setiap klon
// repo, dan di setiap backup database. Satu `git revert`, satu restore, atau satu migration yang
// dijalankan ulang sudah cukup untuk menghidupkannya kembali tanpa ada yang sadar.
//
// Karena itu penolakannya dipasang di sini, di jalur login — bukan hanya di data. Selama hash
// tersimpan cocok dengan salah satu entri di bawah, login DITOLAK berapa pun kali password yang
// benar dimasukkan.
//
// Yang disimpan SIDIK JARI SHA-256 dari password_hash-nya, bukan hash itu sendiri. Sengaja: menaruh
// hash aslinya di sini sama saja memindahkan kebocoran dari satu file ke file lain. Sidik jari
// cukup untuk mencocokkan, tapi tak bisa dipakai menyerang apa pun.
//
// Menambah entri baru bila suatu saat ada kredensial bocor lagi:
//   node -e "console.log(require('node:crypto').createHash('sha256').update('<password_hash>').digest('hex'))"
const KNOWN_COMPROMISED_HASHES = new Set<string>([
  // Seed 'admin@infarm.id' dari migration 20260708120000 versi awal (bocor via Git).
  '80348f571c757ae8021f21f59f331228034c7d02ba7be99510ab5fb24eb2d797',
])

// true bila password_hash tersimpan adalah kredensial yang sudah diketahui bocor.
function isCompromisedHash(storedHash: string): boolean {
  return KNOWN_COMPROMISED_HASHES.has(createHash('sha256').update(storedHash).digest('hex'))
}

type AdminRow = {
  id: string
  username: string
  password_hash: string
  name: string | null
  is_active: boolean
  role?: string | null
}

// Peran akun OMS (kolom admin_users.role, migration 20260814120000).
// 'admin' = akses penuh termasuk menulis stok; 'staff' = hanya melihat stok.
export type AdminRole = 'admin' | 'staff'

// Identitas admin yang dipakai guard & pencatatan riwayat.
export type AdminIdentity = { id: string; name: string; role: AdminRole }

// Menormalkan nilai kolom role. Nilai tak dikenal / kolom belum di-migrate → 'admin', supaya
// menambahkan fitur role TIDAK pernah mengunci admin yang sudah ada dari pekerjaannya.
function toRole(value: string | null | undefined): AdminRole {
  return value?.trim().toLowerCase() === 'staff' ? 'staff' : 'admin'
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

// Mengambil identitas admin (termasuk peran) dari id sesi — dipakai guard otorisasi dan untuk
// mengisi kolom "diubah oleh" pada riwayat mutasi stok.
// null bila tak ditemukan (mis. akun sudah dihapus tapi cookie sesinya masih ada di browser).
export async function getAdminById(id: string): Promise<AdminIdentity | null> {
  const supabase = createAdminClient()
  let { data, error } = await supabase
    .from('admin_users')
    .select('id, username, name, role')
    .eq('id', id)
    .maybeSingle()

  // Kolom role belum di-migrate (42703 = kolom tak ada) → ulangi tanpa kolom itu, lalu perlakukan
  // sebagai 'admin'. Tanpa fallback ini, halaman OMS mati total sebelum migration dijalankan.
  if (error?.code === '42703') {
    ;({ data, error } = await supabase
      .from('admin_users')
      .select('id, username, name')
      .eq('id', id)
      .maybeSingle())
  }

  if (error) {
    console.error('Gagal membaca admin by id dari Supabase:', error.message)
    return null
  }
  const row = data as { id: string; username: string; name: string | null; role?: string | null } | null
  if (!row) return null
  // admin_users TIDAK punya kolom email; nama tampilan = name, fallback ke username.
  return { id: row.id, name: row.name ?? row.username, role: toRole(row.role) }
}

// Mencari admin aktif berdasarkan username (case-insensitive) & memverifikasi password.
// Mengembalikan { id, name } bila cocok, atau null bila tidak ada / password salah / nonaktif.
export async function authenticateAdmin(
  username: string,
  password: string,
): Promise<AdminIdentity | null> {
  const supabase = createAdminClient()
  let { data, error } = await supabase
    .from('admin_users')
    .select('id, username, password_hash, name, is_active, role')
    .ilike('username', username.trim())
    .maybeSingle()

  // Kolom role belum di-migrate → login tetap harus bisa jalan (lihat catatan di getAdminById).
  if (error?.code === '42703') {
    ;({ data, error } = await supabase
      .from('admin_users')
      .select('id, username, password_hash, name, is_active')
      .ilike('username', username.trim())
      .maybeSingle())
  }

  if (error) {
    console.error('Gagal membaca admin dari Supabase:', error.message)
    return null
  }
  const row = data as AdminRow | null
  if (!row || !row.is_active) return null

  // Kredensial yang sudah diketahui bocor ditolak SEBELUM password diperiksa — tak peduli
  // passwordnya benar. Lihat KNOWN_COMPROMISED_HASHES di atas.
  if (isCompromisedHash(row.password_hash)) {
    console.error(
      `[admins] Login ditolak: password_hash akun "${row.username}" masih kredensial yang bocor ` +
        `(SEC-011). Rotasi passwordnya lewat SQL — lihat supabase/migrations/20260708120000_init_admin_users.sql.`,
    )
    return null
  }

  if (!verifyPassword(password, row.password_hash)) return null

  return { id: row.id, name: row.name ?? row.username, role: toRole(row.role) }
}
