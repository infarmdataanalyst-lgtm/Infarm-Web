// src/lib/guest-phone.ts
// Helper SISI-KLIEN menyimpan/membaca no_telepon guest terakhir di cookie (kenyamanan auto-fill
// di halaman Lacak/Batalkan Pesanan). BUKAN data sensitif kritis — hanya no. HP milik user sendiri
// di device-nya. Ditulis setelah checkout sukses; dibaca untuk auto-fill form (opsional, aman kosong).

const PHONE_COOKIE_NAME = 'infarm_phone'
const PHONE_COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 hari

// Menyimpan no_telepon (format 08xxxxxxxxx) ke cookie untuk auto-fill berikutnya.
export function setGuestPhone(phone: string): void {
  if (typeof document === 'undefined') return
  const clean = phone.trim()
  if (!clean) return
  document.cookie = `${PHONE_COOKIE_NAME}=${encodeURIComponent(clean)}; path=/; max-age=${PHONE_COOKIE_MAX_AGE}; SameSite=Lax`
}

// Membaca no_telepon tersimpan. Kosong ('') bila belum ada / kedaluwarsa.
export function getGuestPhone(): string {
  if (typeof document === 'undefined') return ''
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${PHONE_COOKIE_NAME}=`))
  return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : ''
}
