// src/app/api/orders/sync-tracking/route.ts
// Menyelaraskan `order_status` dengan peristiwa nyata dari kurir (Mengantar).
//   POST { invoices: string[] } → periksa tiap pesanan ke API kurir, naikkan status bila perlu.
//
// ── Kenapa endpoint ini ada ──
// `order_status` hanya bergerak bila ada yang menggerakkannya: webhook Xendit (→ Diproses) atau
// admin lewat OMS. Booking kurir mengisi `no_tracking` tapi SENGAJA tak mengubah status (booking ≠
// barang sudah jalan), dan Mengantar tak punya webhook. Akibatnya pesanan yang paketnya sudah di
// jalan tetap tampil "Diproses" di OMS sampai ada admin yang mengubahnya manual.
//
// ── Kenapa dipicu saat halaman dibuka, bukan cron ──
// Admin butuh data benar SAAT IA MELIHAT layar. Vercel plan Hobby hanya mengizinkan cron 1×/hari,
// jadi cron tak akan pernah cukup segar untuk itu. Menariknya saat halaman Pesanan dibuka membuat
// data sesegar detik itu juga, dan nol panggilan saat tak ada yang membuka OMS.
//
// Keamanan: WAJIB sesi admin (requireAdmin). Endpoint ini menulis status pesanan.

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/oms-guard'
import { readTrackingSyncCandidates, updateOrderStatus } from '@/lib/mock-db/orders'
import { fetchTrackingDetail } from '@/lib/mengantar-tracking'
import { planStatusAdvance } from '@/lib/tracking'
import type { OrderFulfillmentStatus } from '@/types/order'

// createAdminClient (Supabase) butuh runtime Node.js, bukan Edge
export const runtime = 'nodejs'

const LOG = '[sync-tracking]'

// Batas jumlah invoice per permintaan. Halaman Pesanan OMS menampilkan 20 baris; angka ini memberi
// ruang tanpa membuka pintu bagi permintaan yang memanggil kurir ratusan kali sekaligus.
const MAX_INVOICES = 40

// Berapa pesanan diperiksa bersamaan. `fetchTrackingDetail` bertimeout 4 detik, jadi pemeriksaan
// berurutan akan menabrak batas durasi fungsi Vercel (default 10 detik di plan Hobby) hanya dengan
// tiga pesanan. Paralel penuh juga bukan jawabannya — itu menghantam Mengantar dengan 40 permintaan
// serentak dari satu kali buka halaman.
const CONCURRENCY = 5

// Batas durasi fungsi. WAJIB dinaikkan dari default: satu gelombang berisi 5 pemeriksaan yang
// masing-masing bisa memakan 4 detik, dan sebuah permintaan penuh bisa berisi beberapa gelombang.
export const maxDuration = 60

type SyncedOrder = { orderId: string; status: OrderFulfillmentStatus }

export async function POST(request: Request) {
  // Guard: hanya admin OMS terautentikasi
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  const invoices = Array.isArray(body.invoices)
    ? body.invoices
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim().replace(/^#/, ''))
        .filter(Boolean)
        .slice(0, MAX_INVOICES)
    : []

  if (invoices.length === 0) {
    // Bukan error: halaman yang isinya hanya pesanan tanpa resi memang tak punya yang perlu
    // disinkronkan. Balas bentuk yang sama supaya klien tak perlu cabang khusus.
    return NextResponse.json({ checked: 0, updated: [], syncedAt: new Date().toISOString() })
  }

  // Penyaringan (lunas + status masih bisa maju + punya resi) dilakukan di DB, bukan di sini.
  const candidates = await readTrackingSyncCandidates(invoices)
  if (candidates.length === 0) {
    return NextResponse.json({ checked: 0, updated: [], syncedAt: new Date().toISOString() })
  }

  const updated: SyncedOrder[] = []
  let failed = 0

  // Diproses per gelombang, bukan sekaligus — lihat CONCURRENCY.
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY)
    const results = await Promise.all(batch.map(syncOne))
    for (const result of results) {
      if (result.status === 'failed') failed++
      else if (result.status === 'advanced') updated.push(result.order)
    }
  }

  // Revalidasi HANYA bila memang ada yang berubah. Memanggilnya tiap sinkronisasi berarti setiap
  // pembukaan halaman OMS membuang cache halaman /track yang mungkin tak berubah sama sekali.
  if (updated.length > 0) {
    revalidatePath('/track')
    console.log(`${LOG} ${updated.length} pesanan naik status`)
  }

  return NextResponse.json({
    checked: candidates.length,
    updated,
    failed,
    syncedAt: new Date().toISOString(),
  })
}

type SyncOutcome =
  | { status: 'unchanged' }
  | { status: 'advanced'; order: SyncedOrder }
  | { status: 'failed' }

// Memeriksa satu pesanan ke kurir dan menaikkan statusnya bila peristiwanya menunjukkan kemajuan.
//
// Kegagalan satu pesanan TIDAK menggagalkan pesanan lain — resi yang belum aktif di sistem kurir
// adalah keadaan normal, bukan error yang perlu menghentikan seluruh sinkronisasi.
async function syncOne(candidate: {
  orderId: string
  status: OrderFulfillmentStatus
  trackingNumber: string
}): Promise<SyncOutcome> {
  const result = await fetchTrackingDetail(candidate.trackingNumber)
  if (!result.ok) {
    // 'no-awb' tak mungkin sampai sini (kandidat sudah disaring), sisanya gangguan/keterbatasan
    // yang tak bisa ditindaklanjuti per pesanan.
    return { status: 'failed' }
  }

  // Jalur & pagarnya (hanya maju, satu langkah per transisi, tak pernah sampai 'Selesai') ada di
  // planStatusAdvance — satu tempat, dipakai bersama bila nanti ada pemicu lain (mis. cron).
  const path = planStatusAdvance(
    candidate.status,
    result.events.map((e) => e.label),
  )
  if (path.length === 0) return { status: 'unchanged' }

  let current = candidate.status
  for (const next of path) {
    // Resi & kurir sudah tersimpan sejak booking, jadi `logistics` tak perlu dikirim ulang —
    // updateOrderStatus hanya menulis field yang disertakan.
    const saved = await updateOrderStatus(candidate.orderId, next)
    if (!saved) {
      console.error(`${LOG} gagal menulis ${candidate.orderId} → ${next}`)
      // Sebagian jalur mungkin sudah tersimpan; laporkan sejauh yang berhasil, bukan anggap gagal
      // total — status yang sudah naik memang sudah naik.
      break
    }
    current = next
  }

  if (current === candidate.status) return { status: 'failed' }

  console.log(`${LOG} ${candidate.orderId}: ${candidate.status} → ${current}`)
  return { status: 'advanced', order: { orderId: candidate.orderId, status: current } }
}
