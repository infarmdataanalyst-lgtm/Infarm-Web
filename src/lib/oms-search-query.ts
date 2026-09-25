// src/lib/oms-search-query.ts
// Mengurai teks dari search bar header OMS menjadi SATU jenis pencarian. Murni — tanpa I/O, aman
// diimpor dari komponen 'use client' maupun Route Handler.
//
// ── Kenapa satu kolom menebak jenisnya sendiri ──
// Admin tidak perlu memilih mode dulu. Tiga bentuk masukan yang dipakai tim sehari-hari hampir tak
// pernah tertukar:
//   - nomor pesanan / resi   → huruf+angka+tanda hubung, boleh BANYAK sekaligus (tempel dari chat)
//   - nomor HP pembeli        → hanya angka, diawali 08 / 628 / +628
//   - nama pembeli            → tanpa angka sama sekali
//
// ── Kenapa jenisnya penting bagi keamanan ──
// Nama & nomor HP adalah DATA PRIBADI yang dicari secara aktif (bukan sekadar terlihat di baris
// pesanan). Keputusan pemilik proyek 2026-09-17: pencarian lewat keduanya HANYA untuk peran 'admin'.
// Route memakai hasil pengurai ini untuk memutuskan guard mana yang berlaku — jadi pengurai ini yang
// menentukan batasnya, dan server tidak menerima "mode" dari client.

import { normalizeInvoiceId } from '@/lib/invoice-id'

// Batas nomor sekaligus. Cukup untuk satu daftar serah terima harian, dan menjaga query `.in()`
// tetap pendek.
export const OMS_SEARCH_MAX_TOKENS = 20

// Nama minimal 3 huruf: "Bu" cocok dengan terlalu banyak pembeli dan hanya menghasilkan daftar
// data pribadi yang tak dibutuhkan siapa pun.
export const OMS_SEARCH_NAME_MIN = 3

// Batas panjang teks mentah — penahan tempelan tak sengaja (mis. satu halaman chat utuh).
const RAW_MAX_LENGTH = 1000

export type OmsSearchQuery =
  | { kind: 'orders'; tokens: string[] } // nomor invoice dan/atau nomor resi
  | { kind: 'phone'; phone: string } // dinormalisasi ke format 08xxxxxxxxxx
  | { kind: 'name'; name: string }
  | { kind: 'invalid'; message: string }

// Pemisah antarnomor: spasi, baris baru, koma, titik koma. Tim menyalin daftar dari WhatsApp
// dan spreadsheet — keduanya memakai salah satu dari ini.
const SEPARATOR = /[\s,;]+/

// Huruf (termasuk huruf beraksen), titik, apostrof, tanda hubung — cukup untuk nama orang.
const NAME_TOKEN = /^[\p{L}.'-]+$/u

// Mengubah nomor HP berbagai format menjadi 08xxxxxxxxxx, atau null bila bukan nomor HP Indonesia.
// Format tersimpan di orders.no_telepon adalah angka bersih berawalan 08 (lihat lib/phone.ts).
function toLocalPhone(compact: string): string | null {
  if (!/^\d+$/.test(compact)) return null
  let local = compact
  if (local.startsWith('628')) local = `0${local.slice(2)}`
  if (!local.startsWith('08')) return null
  return local.length >= 10 && local.length <= 13 ? local : null
}

// Mengurai teks search bar menjadi satu jenis pencarian.
export function parseOmsSearchQuery(raw: string): OmsSearchQuery {
  const text = raw.trim()
  if (!text) return { kind: 'invalid', message: 'Ketik nomor pesanan, resi, nama, atau nomor HP pembeli.' }
  if (text.length > RAW_MAX_LENGTH) return { kind: 'invalid', message: 'Teks pencarian terlalu panjang.' }

  const tokens = text
    .split(SEPARATOR)
    .map((t) => t.replace(/^#/, ''))
    .filter(Boolean)

  // === Nomor HP ===
  // Dicek pada teks utuh yang dirapatkan, supaya "0812 3456 7890" tetap terbaca satu nomor.
  // Pengecualian: beberapa angka panjang terpisah (mis. daftar resi numerik) tetap diperlakukan
  // sebagai daftar nomor, bukan satu nomor HP hasil sambungan.
  const compact = text.replace(/[\s\-+().]/g, '')
  const phone = toLocalPhone(compact)
  const looksLikeList = tokens.length > 1 && tokens.every((t) => t.length >= 10)
  if (phone && !looksLikeList) return { kind: 'phone', phone }

  // === Nama ===
  if (tokens.every((t) => NAME_TOKEN.test(t))) {
    const name = tokens.join(' ')
    if (name.replace(/[.'-]/g, '').length < OMS_SEARCH_NAME_MIN) {
      return { kind: 'invalid', message: `Nama minimal ${OMS_SEARCH_NAME_MIN} huruf.` }
    }
    return { kind: 'name', name }
  }

  // === Nomor pesanan / resi ===
  const unique = [...new Set(tokens)]
  if (unique.length > OMS_SEARCH_MAX_TOKENS) {
    return { kind: 'invalid', message: `Maksimal ${OMS_SEARCH_MAX_TOKENS} nomor sekaligus.` }
  }
  const bad = unique.filter((t) => normalizeInvoiceId(t) === null)
  if (bad.length > 0) {
    return {
      kind: 'invalid',
      message: `Format tidak dikenali: ${bad.slice(0, 3).join(', ')}. Gunakan huruf, angka, dan tanda hubung.`,
    }
  }
  return { kind: 'orders', tokens: unique }
}
