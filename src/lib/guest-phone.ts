// src/lib/guest-phone.ts
// Helper SISI-KLIEN menyimpan/membaca no_telepon guest terakhir di cookie (kenyamanan auto-fill
// di halaman Lacak/Batalkan Pesanan). BUKAN data sensitif kritis — hanya no. HP milik user sendiri
// di device-nya. Ditulis setelah checkout sukses; dibaca untuk auto-fill form (opsional, aman kosong).

const PHONE_COOKIE_NAME = 'infarm_phone'
const PHONE_COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 hari

// Cookie ESTIMASI jumlah pesanan aktif (untuk badge angka di ikon profil header). Bukan sumber
// kebenaran — di-refresh akurat tiap buka /pesanan-saya (query DB), di-increment saat checkout sukses.
const ACTIVE_ORDERS_COOKIE_NAME = 'infarm_active_orders'
// Event agar header (ProfileIconLink) langsung baca ulang cookie saat angka berubah (tanpa reload).
export const ACTIVE_ORDERS_EVENT = 'infarm:active-orders-updated'

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

// === Estimasi jumlah pesanan aktif (badge angka) ===

// Membaca jumlah pesanan aktif tersimpan. 0 bila belum ada / invalid / kedaluwarsa.
export function getActiveOrderCount(): number {
  if (typeof document === 'undefined') return 0
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${ACTIVE_ORDERS_COOKIE_NAME}=`))
  if (!match) return 0
  const n = parseInt(match.split('=').slice(1).join('='), 10)
  return Number.isNaN(n) || n < 0 ? 0 : n
}

// Menyimpan jumlah pesanan aktif ke cookie + memberi tahu header agar badge ikut ter-update.
export function setActiveOrderCount(count: number): void {
  if (typeof document === 'undefined') return
  const safe = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
  document.cookie = `${ACTIVE_ORDERS_COOKIE_NAME}=${safe}; path=/; max-age=${PHONE_COOKIE_MAX_AGE}; SameSite=Lax`
  window.dispatchEvent(new Event(ACTIVE_ORDERS_EVENT))
}

// Menambah 1 ke estimasi pesanan aktif (dipanggil setelah checkout sukses). Mulai dari 1 bila kosong.
export function incrementActiveOrderCount(): void {
  setActiveOrderCount(getActiveOrderCount() + 1)
}
