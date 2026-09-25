// src/app/api/cron/sync-delivered/route.ts
// Penyapu tanggal terima. Menanyakan ke kurir pesanan mana yang paketnya sudah sampai, lalu
// mengunci `orders.delivered_at` — yang memberi pembeli hak mengulas selama 14 hari.
//   GET (Authorization: Bearer $CRON_SECRET) → sapu, balas ringkasan.
//   GET ?dryRun=1 → laporkan saja, tidak menulis apa pun.
//
// ── Kenapa route tersendiri, bukan memakai /api/orders/sync-tracking ──
// Endpoint itu menerima `POST { invoices: string[] }` — daftarnya datang dari 20 baris yang sedang
// TAMPIL di halaman Pesanan OMS. Bentuk itu tak bisa dipakai cron: cron tak punya layar, jadi tak
// tahu harus menanyakan yang mana. Di sini kandidatnya disusun sendiri dari database.
//
// ── Perannya: jaring pengaman, bukan jalur utama ──
// Ada tiga pemicu yang mengisi `delivered_at`, dan ini yang paling lambat:
//   1. Halaman /track dibuka pembeli — seketika, nol panggilan tambahan (halaman itu memang sudah
//      memanggil kurir), dan mengenai tepat orang yang ingin mengulas.
//   2. Sinkronisasi resi di halaman Pesanan OMS — saat admin bekerja.
//   3. Cron ini — ≤24 jam, menangkap pesanan yang pembelinya tak pernah membuka halaman lacak dan
//      yang tak kebetulan tampil di layar admin.
// Cron di Vercel plan Hobby hanya boleh 1×/hari, jadi ia memang tak bisa menjadi jalur utama.
// Tanpa pemicu 1, pembeli bisa menunggu sehari penuh meski paketnya sudah di tangan.
//
// ── Kenapa biayanya menyusut sendiri ──
// Kandidatnya disaring `delivered_at is null`, jadi pesanan yang tanggalnya sudah terkunci tak
// pernah ditanyakan lagi. Yang tersisa hanya paket yang benar-benar masih di jalan.

import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { readDeliveredCheckCandidates, markOrderDelivered } from '@/lib/mock-db/orders'
import { fetchTrackingDetail, trackingLabelsOf } from '@/lib/mengantar-tracking'
import { isDeliveredByCourier } from '@/lib/tracking'

// createAdminClient (Supabase) + node:crypto butuh runtime Node.js, bukan Edge
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LOG = '[cron:sync-delivered]'

// Batas pesanan per jalan. Kandidat diurutkan dari yang TERLAMA, jadi sisa antrean tak pernah
// kelaparan — ia hanya tertunda ke hari berikutnya.
const MAX_PER_RUN = 50

// Sama dengan sync-tracking: `fetchTrackingDetail` bertimeout 4 detik, jadi pemeriksaan berurutan
// akan menabrak batas durasi fungsi, sementara paralel penuh menghantam Mengantar dengan puluhan
// permintaan serentak.
const CONCURRENCY = 5

export const maxDuration = 60

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
    // `not-configured` adalah salah konfigurasi KITA, bukan serangan — dibedakan agar tak tersamar
    // sebagai 401 yang membuat orang mencari penyusup yang tak ada. Pola sama dengan expire-orders.
    if (auth.reason === 'not-configured') {
      console.error(`${LOG} CRON_SECRET belum di-set`)
      return NextResponse.json({ error: 'CRON_SECRET belum dikonfigurasi.' }, { status: 500 })
    }
    return NextResponse.json({ error: 'Tidak berwenang.' }, { status: 401 })
  }

  const dryRun = new URL(request.url).searchParams.get('dryRun') === '1'
  const candidates = await readDeliveredCheckCandidates(MAX_PER_RUN)

  if (candidates.length === 0) {
    return NextResponse.json({ dryRun, diperiksa: 0, ditandai: [], gagal: 0 })
  }

  const ditandai: string[] = []
  let gagal = 0
  let sudahSampaiTapiDryRun = 0

  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const gelombang = candidates.slice(i, i + CONCURRENCY)
    await Promise.all(
      gelombang.map(async (kandidat) => {
        const hasil = await fetchTrackingDetail(kandidat.trackingNumber)
        if (!hasil.ok) {
          // Resi yang belum aktif di sistem kurir adalah keadaan NORMAL, bukan galat yang perlu
          // menghentikan sapuan. Dihitung saja, lalu lanjut.
          gagal += 1
          return
        }

        if (!isDeliveredByCourier(trackingLabelsOf(hasil))) return

        if (dryRun) {
          sudahSampaiTapiDryRun += 1
          return
        }

        // `false` juga berarti "sudah ditandai lebih dulu oleh /track atau sinkronisasi OMS" —
        // bukan kegagalan. Hanya yang benar-benar dikunci di sini yang dilaporkan.
        if (await markOrderDelivered(kandidat.orderId)) ditandai.push(kandidat.orderId)
      }),
    )
  }

  console.log(
    `${LOG} ${dryRun ? '[dryRun] ' : ''}diperiksa ${candidates.length}, ` +
      `ditandai ${dryRun ? sudahSampaiTapiDryRun : ditandai.length}, gagal ${gagal}`,
  )

  return NextResponse.json({
    dryRun,
    diperiksa: candidates.length,
    ...(dryRun ? { akanDitandai: sudahSampaiTapiDryRun } : { ditandai }),
    gagal,
  })
}
