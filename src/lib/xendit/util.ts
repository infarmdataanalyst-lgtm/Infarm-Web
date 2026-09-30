// src/lib/xendit/util.ts
// Pembantu kecil yang dipakai bersama oleh modul Xendit. MURNI — tanpa I/O, tanpa rahasia — jadi
// aman diimpor unit test maupun modul server.

// String non-kosong yang sudah dirapikan; undefined untuk apa pun selain itu.
export function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined
}

// Angka dari nilai apa pun. Payments API v3 mengirim nominal sebagai STRING ("10000"), jadi
// pembacaan lewat parseFloat memang disengaja; nilai yang tak terbaca jatuh ke 0 — pemanggil yang
// memakainya untuk membandingkan nominal akan menganggapnya kurang bayar (menolak-dengan-aman).
export function asNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

// Pesan galat Xendit untuk LOG (bukan untuk client).
// Xendit membalas { error_code, message }. `error_code` sangat berguna: mis. 'API_VALIDATION_ERROR'
// akan menyebut field mana yang ditolak, dan 'INVALID_SESSION_STATUS' menjelaskan kenapa
// pembatalan ditolak.
export function describeXenditError(status: number, text: string): string {
  return `${status} ${[xenditErrorCode(text), xenditErrorMessage(text)].filter(Boolean).join(': ') || text.slice(0, 200)}`
}

// `error_code` dari badan respons galat Xendit; undefined bila bukan JSON atau tak ada.
export function xenditErrorCode(text: string): string | undefined {
  try {
    return asString((JSON.parse(text) as Record<string, unknown>).error_code)
  } catch {
    return undefined
  }
}

function xenditErrorMessage(text: string): string | undefined {
  try {
    return asString((JSON.parse(text) as Record<string, unknown>).message)
  } catch {
    return undefined
  }
}

// Memotong teks respons untuk log — badan respons Xendit bisa panjang, dan yang dibutuhkan hanya
// cukup untuk mengenali bentuknya.
export function potong(text: string, n = 300): string {
  return text.length > n ? `${text.slice(0, n)}…` : text
}
