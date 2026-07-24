// src/lib/rate-limit.ts
// Rate limiter in-memory sederhana (best-effort, per-instance) untuk endpoint publik guest
// (lacak/batalkan/review pesanan by no_telepon). Pola sama seperti limiter di /api/oms/login.
// Catatan: in-memory per-instance — di lingkungan serverless multi-instance/multi-region ini
// bukan pengganti rate limit terpusat (Supabase table/Redis), tapi jauh lebih baik daripada
// tidak ada sama sekali (menutup temuan K-1 audit keamanan 2026-07-24).

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

// Mengecek & mencatat satu percobaan untuk `key`. Mengembalikan true bila sudah melebihi
// `maxAttempts` dalam jendela waktu `windowMs` berjalan (request ini harus ditolak).
export function isRateLimited(key: string, maxAttempts: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = buckets.get(key)
  if (!entry || entry.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return false
  }
  entry.count += 1
  return entry.count > maxAttempts
}

// Ambil IP client dari header proxy (Vercel/umum). Fallback 'unknown' saat dev lokal/tak ada header.
export function getClientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}
