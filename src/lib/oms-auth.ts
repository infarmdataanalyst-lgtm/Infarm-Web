// src/lib/oms-auth.ts
// Auth ringan OMS sementara (sebelum Supabase Auth). Satu cookie penanda sesi admin,
// dipakai bersama oleh proxy.ts (guard server) dan halaman login/sidebar (client).
// TODO: ganti dengan sesi Supabase Auth saat OMS auth real dibangun (lihat checklist CLAUDE.md).

// Nama cookie penanda sesi admin OMS.
export const OMS_SESSION_COOKIE = 'oms_session'

// Tujuan default setelah login bila tak ada ?redirect yang valid.
export const OMS_DEFAULT_REDIRECT = '/oms/dashboard'

// Pastikan target redirect aman: hanya path internal area dashboard OMS (cegah open redirect
// ke URL absolut / domain luar). Selain itu, kembalikan tujuan default.
export function sanitizeOmsRedirect(target: string | null | undefined): string {
  if (!target) return OMS_DEFAULT_REDIRECT
  if (target.startsWith('/oms/dashboard')) return target
  return OMS_DEFAULT_REDIRECT
}

// Tandai sesi admin aktif lewat cookie (client-only). remember=true → bertahan 30 hari,
// selain itu jadi cookie sesi (hilang saat browser ditutup).
export function setOmsSession(remember: boolean): void {
  const maxAge = remember ? '; max-age=2592000' : '' // 30 hari
  document.cookie = `${OMS_SESSION_COOKIE}=1; path=/; SameSite=Lax${maxAge}`
}

// Hapus sesi admin (logout) dengan mengosongkan cookie.
export function clearOmsSession(): void {
  document.cookie = `${OMS_SESSION_COOKIE}=; path=/; max-age=0; SameSite=Lax`
}
