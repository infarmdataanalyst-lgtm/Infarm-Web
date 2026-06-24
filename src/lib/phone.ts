// src/lib/phone.ts
// Helper validasi & normalisasi nomor telepon Indonesia untuk form checkout.
// Aturan: hanya angka, wajib diawali '08', panjang 10–12 digit.
// Hasil normalisasi = angka bersih tanpa simbol (mis. '081234567890').

// Batas panjang nomor (digit bersih)
export const PHONE_MIN_LENGTH = 10
export const PHONE_MAX_LENGTH = 12

// Menormalkan nomor telepon → buang semua karakter non-digit.
export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '')
}

// Valid bila diawali '08' dan panjang 10–12 digit.
export function isValidPhone(raw: string): boolean {
  const n = normalizePhone(raw)
  return n.startsWith('08') && n.length >= PHONE_MIN_LENGTH && n.length <= PHONE_MAX_LENGTH
}

// Mengembalikan pesan error spesifik untuk sebuah nomor, atau '' bila valid.
// Urutan cek: kosong → tidak diawali 0 → tidak diawali 08 → terlalu pendek → terlalu panjang.
export function getPhoneError(raw: string): string {
  const n = normalizePhone(raw)
  if (n === '') return 'Nomor telepon wajib diisi'
  if (n[0] !== '0') return 'Nomor telepon harus diawali angka 0'
  if (n[1] !== '8') return 'Nomor telepon harus diawali 08'
  if (n.length < PHONE_MIN_LENGTH) return 'Nomor telepon terlalu pendek'
  if (n.length > PHONE_MAX_LENGTH) return 'Nomor telepon terlalu panjang, maksimal 12 digit'
  return ''
}

// Membersihkan input telepon: hanya pertahankan digit, lalu potong agar tidak melebihi
// batas maksimal. Dipakai sebagai jaring pengaman onChange (mis. saat paste);
// pemblokiran per-karakter ditangani onKeyDown di komponen.
export function sanitizePhoneInput(raw: string): {
  value: string
  blockedNonDigit: boolean
  blockedTooLong: boolean
} {
  const digits = raw.replace(/\D/g, '')
  const blockedNonDigit = digits.length !== raw.length

  let value = digits
  let blockedTooLong = false
  if (value.length > PHONE_MAX_LENGTH) {
    value = value.slice(0, PHONE_MAX_LENGTH)
    blockedTooLong = true
  }

  return { value, blockedNonDigit, blockedTooLong }
}
