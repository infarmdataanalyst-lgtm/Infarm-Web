// src/app/api/cron/mengantar-pickup/route.ts
// Cron harian: membuat slot pickup Mengantar untuk hari ini (06:00 WIB, Senin–Sabtu).
//
// GET, bukan POST: Vercel Cron memanggil endpoint-nya dengan GET. Method lain otomatis 405 karena
// hanya GET yang diekspor di file ini.
//
// ── Kenapa endpoint ini WAJIB dijaga token ──
// Tanpa guard, siapa pun yang tahu URL-nya bisa memicunya berulang. Efeknya bukan cuma boros:
// setiap pemanggilan pada tanggal yang belum ada barisnya membuat slot pickup BARU di sistem
// Mengantar. Guard-nya CRON_SECRET, mekanisme resmi Vercel — Vercel menyisipkan header
// `Authorization: Bearer $CRON_SECRET` saat memanggil cron bila env itu ada.
//
// ── Jadwal ada di vercel.json, BUKAN di sini ──
// Cron Vercel memakai UTC. 06:00 WIB = 23:00 UTC HARI SEBELUMNYA, jadi "Senin–Sabtu WIB" ditulis
// sebagai hari Minggu–Jumat UTC: `0 23 * * 0-5`. Route ini sendiri tak berasumsi soal jam
// pemanggilan — ia memakai jam dinding WIB yang sebenarnya saat dieksekusi.

import { NextResponse } from 'next/server'
import { ensurePickupForDate } from '@/lib/mengantar-pickup'
import { resolvePickupDate, wibDateString, wibHour } from '@/lib/pickup-schedule'
import { timingSafeEqual } from 'node:crypto'

// createAdminClient (Supabase) + node:crypto butuh runtime Node.js, bukan Edge
export const runtime = 'nodejs'

// Hasil cron tak boleh di-cache: setiap pemanggilan harus benar-benar mengeksekusi.
export const dynamic = 'force-dynamic'

const LOG = '[cron:mengantar-pickup]'

// Membandingkan header Authorization dengan CRON_SECRET secara waktu-konstan.
// Panjang dicek lebih dulu karena timingSafeEqual melempar bila panjang buffer beda.
function authorized(request: Request): { ok: true } | { ok: false; reason: string } {
  const secret = process.env.CRON_SECRET
  if (!secret) return { ok: false, reason: 'not-configured' }

  const header = request.headers.get('authorization')
  if (!header) return { ok: false, reason: 'missing-header' }

  const expected = `Bearer ${secret}`
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return { ok: false, reason: 'mismatch' }
  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: 'mismatch' }
}

export async function GET(request: Request) {
  const auth = authorized(request)
  if (!auth.ok) {
    if (auth.reason === 'not-configured') {
      // Salah konfigurasi KITA → 500, bukan 401. Menyamakannya membuat cron yang mati karena env
      // kosong terlihat seperti serangan.
      console.error(`${LOG} CRON_SECRET belum di-set di environment`)
      return NextResponse.json({ error: 'Cron belum dikonfigurasi.' }, { status: 500 })
    }
    console.warn(`${LOG} ditolak: ${auth.reason}`)
    return NextResponse.json({ error: 'Tidak berwenang.' }, { status: 401 })
  }

  const nowMs = Date.now()
  // Tanggal yang di-generate = HARI INI (WIB), bukan resolvePickupDate: cron jalan pagi, jauh
  // sebelum cutoff, dan tugasnya menyiapkan slot untuk hari kerja berjalan. resolvePickupDate
  // hanya ikut dicatat sebagai konteks log agar mudah membandingkan saat menelusuri masalah.
  const today = wibDateString(nowMs)
  const resolved = resolvePickupDate(nowMs)

  console.log(
    `${LOG} mulai — hari ini ${today} jam ${wibHour(nowMs)} WIB (target checkout saat ini: ${resolved.date}/${resolved.reason})`,
  )

  const outcome = await ensurePickupForDate(today)

  switch (outcome.status) {
    case 'skipped-non-pickup-day':
      // Minggu. Terjadi bila jadwal cron diubah atau cron dipicu manual — bukan kesalahan.
      console.log(`${LOG} ${today} bukan hari pickup — dilewati`)
      return NextResponse.json({ date: today, status: 'skipped', reason: 'BUKAN_HARI_PICKUP' })

    case 'existing':
      return NextResponse.json({ date: today, status: 'existing', timeId: outcome.pickup.timeId })

    case 'created':
    case 'raced':
      return NextResponse.json({ date: today, status: outcome.status, timeId: outcome.pickup.timeId })

    case 'failed':
      // 500 supaya kegagalan terlihat di log & dasbor cron Vercel, bukan tenggelam sebagai 200.
      console.error(`${LOG} gagal untuk ${today}: ${outcome.reason}`)
      return NextResponse.json(
        { date: today, status: 'failed', reason: outcome.reason },
        { status: 500 },
      )
  }
}
