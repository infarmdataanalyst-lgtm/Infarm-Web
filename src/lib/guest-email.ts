// src/lib/guest-email.ts
// Helper SISI-KLIEN menyimpan/membaca email guest terakhir di cookie, untuk auto-fill + auto-cari
// di halaman Lacak Pesanan (/track-order). Ditulis setelah checkout sukses; dibaca saat halaman
// dibuka. Opsional — halaman tetap berfungsi penuh bila cookienya kosong.
//
// ── Kenapa cookie TERPISAH dari infarm_phone, bukan menggantinya ──
// Setelah Lacak Pesanan pindah ke email, halaman lain TETAP berbasis no_telepon: /cancel-order,
// /review, dan badge jumlah pesanan aktif di header. Kalau satu cookie dipakai bergantian, salah
// satu kelompok halaman pasti kehilangan auto-fill-nya. Dua cookie berdampingan membuat tiap
// halaman membaca identitas yang memang dipakainya, dan pengguna lama yang sudah punya
// infarm_phone tak kehilangan apa pun.
//
// ── Kenapa boleh disimpan di cookie ──
// Sama seperti infarm_phone: ini alamat email milik pengguna sendiri, di perangkatnya sendiri,
// dan hanya dipakai mengisi ulang sebuah form. Cookie ini BUKAN kredensial — status pesanan
// SELALU diambil fresh dari server, cookie hanya menjawab "siapa yang terakhir checkout di sini".
// Jangan pernah menjadikannya dasar otorisasi.

const EMAIL_COOKIE_NAME = 'infarm_email'
const EMAIL_COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 hari, sama dengan infarm_phone

// Menyimpan email (sudah ternormalisasi huruf kecil) ke cookie untuk auto-fill berikutnya.
// Nilai kosong diabaikan agar cookie lama tak tertimpa string kosong.
export function setGuestEmail(email: string): void {
  if (typeof document === 'undefined') return
  const clean = email.trim().toLowerCase()
  if (!clean) return
  document.cookie = `${EMAIL_COOKIE_NAME}=${encodeURIComponent(clean)}; path=/; max-age=${EMAIL_COOKIE_MAX_AGE}; SameSite=Lax`
}

// Membaca email tersimpan. Kosong ('') bila belum ada / kedaluwarsa.
export function getGuestEmail(): string {
  if (typeof document === 'undefined') return ''
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${EMAIL_COOKIE_NAME}=`))
  return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : ''
}
