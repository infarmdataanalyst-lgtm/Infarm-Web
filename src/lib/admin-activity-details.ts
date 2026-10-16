// src/lib/admin-activity-details.ts
// Aturan MURNI untuk isi kolom `details` di log aktivitas admin (tabel admin_activity_log).
// Dipisah dari admin-activity.ts (yang menyentuh Supabase & cookie sesi) supaya bisa diuji unit.
//
// Dua tugas:
//   1. sanitizeActivityDetails — membuang field rahasia & memangkas isi yang terlalu besar, supaya
//      log tak pernah menjadi tempat bocornya password/token dan tak membengkak.
//   2. diffFields — menyusun { field: { before, after } } HANYA untuk field yang benar-benar berubah.

// Nama field yang isinya tak boleh pernah masuk log, berapa pun dalamnya letaknya. Dicocokkan
// tanpa peduli huruf besar/kecil dan pemisah (password, passwordHash, api_key, x-callback-token…).
const SECRET_KEY_PATTERN = /(password|passwd|secret|token|api_?key|authorization|cookie|signature|hash)/i

// Penanda pengganti untuk field rahasia — terlihat jelas di Dashboard bahwa field itu ADA tapi
// sengaja disembunyikan, bukan kosong.
export const REDACTED = '[disembunyikan]'

// Batas supaya satu aksi massal tak menulis baris log berukuran megabyte.
const MAX_STRING_LENGTH = 500
const MAX_ARRAY_ITEMS = 50
const MAX_DEPTH = 5

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key)
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString()
  if (depth >= MAX_DEPTH) return '[terlalu dalam]'

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((v) => sanitizeValue(v, depth + 1))
    if (value.length > MAX_ARRAY_ITEMS) items.push(`… +${value.length - MAX_ARRAY_ITEMS} lainnya`)
    return items
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue
      out[key] = isSecretKey(key) ? REDACTED : sanitizeValue(v, depth + 1)
    }
    return out
  }

  // function, symbol, bigint — tak punya arti di log.
  return String(value)
}

// Membersihkan `details` sebelum ditulis: field rahasia → REDACTED, undefined dibuang, string
// panjang & array besar dipangkas. Selalu mengembalikan objek (kolom details NOT NULL).
export function sanitizeActivityDetails(details: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!details) return {}
  const cleaned = sanitizeValue(details, 0)
  return cleaned && typeof cleaned === 'object' && !Array.isArray(cleaned)
    ? (cleaned as Record<string, unknown>)
    : {}
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  // null & undefined dianggap sama: "tak diisi" vs "dikosongkan" bukan perubahan yang berarti.
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true
  if (typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b)
  return false
}

export type FieldChanges = Record<string, { before: unknown; after: unknown }>

// Membandingkan dua versi data dan mengembalikan HANYA field yang berubah.
// `fields` membatasi field yang dilihat — tanpa itu, semua key di `after` yang dibandingkan
// (key yang tak ada di `after` dianggap tak disentuh, cocok untuk body PATCH parsial).
export function diffFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  fields?: readonly string[],
): FieldChanges {
  const prev = before ?? {}
  const next = after ?? {}
  const keys = fields ?? Object.keys(next)
  const changes: FieldChanges = {}
  for (const key of keys) {
    if (!(key in next)) continue
    if (sameValue(prev[key], next[key])) continue
    changes[key] = { before: prev[key] ?? null, after: next[key] ?? null }
  }
  return changes
}
