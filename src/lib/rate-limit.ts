// src/lib/rate-limit.ts
// Rate limiter in-memory sederhana (best-effort, per-instance) untuk endpoint publik yang rawan
// disalahgunakan bot: lacak/batalkan/review pesanan by no_telepon, proxy Mengantar (alamat & ongkir),
// pembuatan order, dan submit ulasan. Pola sama seperti limiter di /api/oms/login.
//
// Catatan arsitektur: in-memory per-instance — di lingkungan serverless multi-instance/multi-region
// ini BUKAN pengganti rate limit terpusat (tabel Supabase / Redis), tapi jauh lebih baik daripada
// tidak ada sama sekali (menutup temuan K-1 audit keamanan 2026-07-24). Semua ambang batas
// terkumpul di `RATE_LIMITS` agar mudah di-tuning tanpa menyentuh route handler.

import { NextResponse } from 'next/server'

// Satu aturan pembatasan: maksimal `max` percobaan dalam jendela `windowMs`
export type RateRule = { max: number; windowMs: number }

const MINUTE = 60_000

// === Ambang Batas Terpusat ===
// Ubah angka di sini bila perlu di-tuning (mis. terlalu ketat untuk user normal).
export const RATE_LIMITS = {
  // Endpoint BACA by no_telepon (track-by-phone, verify-cancel, reviewable-by-phone)
  PHONE_LOOKUP_IP: { max: 20, windowMs: 15 * MINUTE }, // throttle umum per sumber
  PHONE_LOOKUP_PHONE: { max: 15, windowMs: 60 * MINUTE }, // anti brute-force tertarget 1 nomor
  // Kombinasi IP + nomor yang dicoba. Hanya percobaan GAGAL (nomor tanpa pesanan / tidak cocok)
  // yang dihitung → user normal yang mengulang pencarian nomornya sendiri tidak pernah kena.
  PHONE_LOOKUP_IP_PHONE_MISS: { max: 5, windowMs: 15 * MINUTE },

  // Endpoint TULIS/destruktif by no_telepon (cancel-by-phone)
  PHONE_WRITE_IP: { max: 8, windowMs: 15 * MINUTE },
  PHONE_WRITE_PHONE: { max: 5, windowMs: 60 * MINUTE },

  // Proxy Mengantar (search alamat & cek ongkir) — cegah dipakai bot sebagai relay gratis.
  //
  // Dinaikkan 20 → 40 (2026-08-24) setelah pengukuran langsung ke app.mengantar.com:
  // 30 request beruntun berjeda 200ms (~167 req/menit dari satu IP) dijawab 200 semua, tanpa
  // satu pun 429 dan tanpa pelambatan (132–172 ms stabil). Lihat scripts/mengantar-test/rate-limit.ts.
  //
  // Angka 20 membatasi PEMBELI, bukan Mengantar. Combobox alamat memakai debounce 500ms + minimal
  // 3 karakter, jadi satu pencarian wajar = 3–6 request; pembeli yang salah ketik lalu mengoreksi
  // alamat bisa menyentuh 20 dalam satu sesi checkout dan pencarian alamatnya mati semenit tepat
  // saat hendak bayar. 40 memberi ruang itu dan tetap tak berguna bagi scraper (butuh ribuan),
  // serta masih jauh di bawah ambang Mengantar yang terukur.
  MENGANTAR_IP: { max: 40, windowMs: 1 * MINUTE },

  // Checkout / buat pesanan — cegah order spam
  ORDER_CREATE_IP: { max: 3, windowMs: 1 * MINUTE },

  // Submit ulasan — cegah spam review
  REVIEW_CREATE_IP: { max: 3, windowMs: 10 * MINUTE },

  // Pembuatan Virtual Account (Xendit). Lebih longgar dari ORDER_CREATE_IP karena pembeli yang sah
  // memang bisa mencoba beberapa bank berbeda untuk satu pesanan, tapi tetap dibatasi: setiap
  // panggilan menembus ke API Xendit dan menghabiskan kuota di sana.
  PAYMENT_CREATE_IP: { max: 6, windowMs: 5 * MINUTE },
  // Per nomor invoice — satu pesanan tak butuh belasan VA. Menahan skrip yang membuat VA berulang
  // untuk satu pesanan (setiap VA adalah objek baru di dashboard Xendit).
  PAYMENT_CREATE_INVOICE: { max: 5, windowMs: 30 * MINUTE },
} as const satisfies Record<string, RateRule>

// Pesan generik untuk user (JANGAN bocorkan angka limit persis ke klien)
export const RATE_LIMIT_MESSAGE = 'Terlalu banyak percobaan. Silakan coba lagi dalam beberapa menit.'

// === Penyimpanan Counter (in-memory) ===

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

// Map tidak pernah menyusut sendiri → sapu entri kedaluwarsa berkala agar tidak bocor memori
// pada instance yang berumur panjang (mis. server lokal / VPS).
let writesSinceSweep = 0
const SWEEP_EVERY_WRITES = 500

function sweepExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key)
  }
}

// === API Limiter ===

// Mengecek & mencatat satu percobaan untuk `key`. Mengembalikan true bila sudah melebihi
// `maxAttempts` dalam jendela waktu `windowMs` berjalan (request ini harus ditolak).
export function isRateLimited(key: string, maxAttempts: number, windowMs: number): boolean {
  const now = Date.now()
  if (++writesSinceSweep >= SWEEP_EVERY_WRITES) {
    writesSinceSweep = 0
    sweepExpired(now)
  }

  const entry = buckets.get(key)
  if (!entry || entry.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return false
  }
  entry.count += 1
  return entry.count > maxAttempts
}

// Mengecek TANPA mencatat percobaan. Dipakai saat pencatatan ditunda sampai hasil diketahui
// (mis. hanya percobaan gagal yang dihitung — lihat PHONE_LOOKUP_IP_PHONE_MISS).
export function isOverLimit(key: string, rule: RateRule): boolean {
  const entry = buckets.get(key)
  if (!entry || entry.resetAt < Date.now()) return false
  return entry.count >= rule.max
}

// Mencatat satu percobaan tanpa mengembalikan keputusan (pasangan `isOverLimit`).
export function recordAttempt(key: string, rule: RateRule): void {
  isRateLimited(key, rule.max, rule.windowMs)
}

// Mengecek + mencatat satu percobaan memakai aturan bernama dari RATE_LIMITS.
// Mengembalikan respons 429 siap-kirim bila limit terlampaui, atau null bila masih boleh lanjut.
export function enforceRateLimit(key: string, rule: RateRule): NextResponse | null {
  if (!isRateLimited(key, rule.max, rule.windowMs)) return null
  return rateLimitResponse(rule, key)
}

// Respons standar saat limit tercapai: 429 + pesan ramah (tanpa detail teknis) + Retry-After.
// `key` hanya untuk log server (masuk Vercel Logs) — sinyal dini brute-force/scraping, menutup
// temuan R3 audit 2026-07-24 (sebelumnya rate-limit terpicu tanpa jejak sama sekali).
export function rateLimitResponse(rule: RateRule, key?: string): NextResponse {
  console.warn(`[rate-limit] terpicu: ${key ?? 'unknown'} (max ${rule.max}/${rule.windowMs}ms)`)
  return NextResponse.json(
    { error: RATE_LIMIT_MESSAGE },
    { status: 429, headers: { 'Retry-After': String(Math.ceil(rule.windowMs / 1000)) } },
  )
}

// Ambil IP client dari header proxy (Vercel/umum). Fallback 'unknown' saat dev lokal/tak ada header.
export function getClientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}
