// src/lib/email.ts
// Helper validasi & normalisasi email untuk form checkout (konfirmasi pesanan ke buyer).
// Pola validasi manual via regex (Zod belum dipakai di project ini).

// Aturan: ada '@', domain punya titik (TLD), tanpa spasi, tidak diawali/diakhiri titik,
// dan tidak ada titik ganda berurutan. Contoh valid: buyer@gmail.com, budi.santoso@email.co.id
const EMAIL_REGEX = /^[^\s@.]+(\.[^\s@.]+)*@[^\s@.]+(\.[^\s@.]+)+$/

// Normalisasi email sebelum disimpan: trim + lowercase.
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

// Valid bila cocok dengan pola email (dicek atas nilai yang sudah dinormalisasi).
export function isValidEmail(raw: string): boolean {
  return EMAIL_REGEX.test(normalizeEmail(raw))
}

// Mengembalikan pesan error untuk sebuah email, atau '' bila valid.
export function getEmailError(raw: string): string {
  const email = normalizeEmail(raw)
  if (email === '') return 'Email wajib diisi'
  if (!EMAIL_REGEX.test(email)) return 'Format email tidak valid, contoh: nama@email.com'
  return ''
}
