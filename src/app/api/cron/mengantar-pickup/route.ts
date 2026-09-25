// src/app/api/cron/mengantar-pickup/route.ts
// Cron harian: membuat slot pickup Mengantar untuk hari ini, SATU PER ALAMAT PENJEMPUTAN
// (06:00 WIB, Senin–Sabtu).
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
import { listPickupAddressIds } from '@/lib/warehouse'
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

  // Satu slot per ALAMAT penjemputan. Sebelum tiap gudang punya alamat sendiri, satu panggilan
  // sudah cukup; sekarang alamat yang tak kebagian slot akan menjatuhkan booking-nya ke jalur
  // fallback saat checkout — mahal, dan tepat di jalur bayar.
  const addressIds = await listPickupAddressIds()
  if (addressIds.length === 0) {
    console.error(`${LOG} tak ada alamat penjemputan — isi warehouses.mengantar_address_id`)
    return NextResponse.json({ error: 'Alamat penjemputan belum dikonfigurasi.' }, { status: 500 })
  }

  console.log(
    `${LOG} mulai — hari ini ${today} jam ${wibHour(nowMs)} WIB, ${addressIds.length} alamat (target checkout saat ini: ${resolved.date}/${resolved.reason})`,
  )

  // PARALEL, bukan berurutan: tiap panggilan POST /time bertimeout 8 detik (TIME_REQUEST_TIMEOUT_MS)
  // sementara fungsi serverless Vercel punya anggaran waktunya sendiri. Dua alamat berurutan sudah
  // menghabiskan 16 detik pada kasus terburuk dan fungsinya dimatikan sebelum sempat menulis ke DB.
  // Tiap alamat menulis BARIS yang berbeda, jadi tak ada yang perlu diserialkan.
  const results = await Promise.all(
    addressIds.map(async (addressId) => ({
      addressId,
      outcome: await ensurePickupForDate(today, addressId),
    })),
  )

  const items = results.map(({ addressId, outcome }) => ({
    addressId,
    status: outcome.status,
    ...(outcome.status === 'failed' ? { reason: outcome.reason } : {}),
    ...('pickup' in outcome ? { timeId: outcome.pickup.timeId } : {}),
  }))

  // SEBAGIAN gagal tetap 500: satu alamat tanpa slot berarti seluruh pesanan dari gudang itu jatuh
  // ke fallback di jalur bayar. Menyembunyikannya di balik 200 membuat dasbor cron Vercel hijau
  // untuk keadaan yang perlu ditangani hari itu juga.
  const gagal = items.filter((i) => i.status === 'failed')
  if (gagal.length > 0) {
    console.error(
      `${LOG} gagal untuk ${today} pada ${gagal.length}/${items.length} alamat: ${gagal
        .map((i) => `${i.addressId}=${i.reason}`)
        .join(', ')}`,
    )
    return NextResponse.json({ date: today, status: 'failed', items }, { status: 500 })
  }

  // Minggu. Terjadi bila jadwal cron diubah atau cron dipicu manual — bukan kesalahan. Seluruh
  // alamat sama-sama dilewati karena isPickupDay tak bergantung pada alamat.
  if (items.every((i) => i.status === 'skipped-non-pickup-day')) {
    console.log(`${LOG} ${today} bukan hari pickup — dilewati`)
    return NextResponse.json({ date: today, status: 'skipped', reason: 'BUKAN_HARI_PICKUP' })
  }

  return NextResponse.json({ date: today, status: 'ok', items })
}
