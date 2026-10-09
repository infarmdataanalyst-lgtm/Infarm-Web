// src/app/api/health/route.ts
// Endpoint kesehatan untuk pemantau luar (uptime monitor) dan pengecekan manual.
//   GET /api/health → 200 { status: 'ok' } | 503 { status: 'degraded' }
//
// ── Apa yang diperiksa ──
// Satu query ringan ke Supabase lewat client anon (tunduk RLS): `select id from products limit 1`.
// Tabel products dipilih karena punya policy baca publik — jalur yang sama dengan storefront —
// sehingga hasilnya mencerminkan apa yang pembeli alami, bukan hak istimewa service_role.
// Nol baris tetap `ok`: yang diuji adalah database menjawab, bukan isinya.
//
// ── Apa yang TIDAK dibuka ──
// Body hanya `status`. Tanpa pesan error, versi, nama host, atau latensi — endpoint ini publik,
// dan detail semacam itu hanya berguna bagi penyerang yang memetakan infrastruktur. Alasan
// kegagalan dicatat ke log server (Vercel Logs) oleh src/lib/health-check.ts.
//
// ── Pengaman ──
//   - Rate limit per IP (RATE_LIMITS.HEALTH_IP): pemantau wajar memanggil tiap 1–5 menit dari
//     beberapa lokasi; 30/menit per IP longgar untuk itu, tapi menutup pemakaian endpoint ini
//     sebagai alat membanjiri database lewat kita.
//   - Cache-Control no-store: jawaban "sehat" yang tersimpan di CDN justru menyembunyikan gangguan.
//   - Tanpa guard auth: pemantau luar tak punya kredensial; isi balasannya memang tak rahasia.

import { NextResponse } from 'next/server'
import { createPublicClient } from '@/lib/supabase/server'
import { NO_STORE_CACHE_CONTROL } from '@/lib/cdn-cache'
import { RATE_LIMITS, enforceRateLimit, getClientIp } from '@/lib/rate-limit'
import { runHealthCheck } from '@/lib/health-check'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Probe dibatasi 3 detik di runHealthCheck; batas fungsi dibuat sedikit lebih longgar agar jawaban
// 503 sempat terkirim, bukan fungsinya yang dimatikan.
export const maxDuration = 10

export async function GET(request: Request) {
  const limited = enforceRateLimit(`health:ip:${getClientIp(request)}`, RATE_LIMITS.HEALTH_IP)
  if (limited) return limited

  const result = await runHealthCheck(async (signal) => {
    const { error } = await createPublicClient()
      .from('products')
      .select('id')
      .limit(1)
      .abortSignal(signal)
    return { error }
  })

  return NextResponse.json(
    { status: result.status },
    { status: result.httpStatus, headers: { 'Cache-Control': NO_STORE_CACHE_CONTROL } },
  )
}
