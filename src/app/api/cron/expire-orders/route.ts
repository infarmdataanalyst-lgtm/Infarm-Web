// src/app/api/cron/expire-orders/route.ts
// Penyapu pesanan kedaluwarsa. Dua pekerjaan:
//   FASE 1 — pesanan hidup yang tenggat bayarnya lewat → tutup DAN kembalikan stoknya.
//   FASE 2 — pesanan yang sudah dibatalkan tapi status BAYARNYA masih "Menunggu" → rapikan
//            pembukuannya saja, tanpa menyentuh stok (stoknya sudah kembali saat dibatalkan).
//   GET (Authorization: Bearer $CRON_SECRET) → sapu, balas ringkasan.
//   GET ?dryRun=1 → laporkan saja, tidak mengubah apa pun.
//
// ── Kenapa penyapu ini ada ──
// Stok dipotong saat pesanan DIBUAT, bukan saat dibayar (anti-oversell). Konsekuensinya setiap
// pesanan yang mati WAJIB melepaskan stoknya kembali. Satu-satunya pelepas yang ada sebelumnya
// adalah callback "invoice expired" dari Xendit — dan callback itu hanya datang bila event-nya
// memang terdaftar di Dashboard, hanya dikirim sekali, dan tak pernah datang sama sekali untuk
// pesanan yang pembelinya tak pernah menekan "Bayar" (tak ada invoice, jadi tak ada yang
// kedaluwarsa). Akibatnya nyata dan sudah terukur: 8 pesanan menggantung di "Menunggu" sambil
// menahan 9 unit stok yang tak pernah terjual, sampai dibereskan tangan manusia.
//
// Penyapu ini menutup ketiga lubang itu sekaligus, karena tenggatnya dihitung dari `created_at`
// pesanan sendiri — tidak bertanya ke Xendit, tidak menunggu dikabari siapa pun.
//
// ── Kenapa tetap tidak menggantikan webhook ──
// Cron di Vercel plan Hobby hanya boleh 1×/hari, jadi pesanan bisa tertahan sampai ~24 jam lebih
// lama daripada bila callback-nya tiba. Webhook tetap jalur cepat; penyapu adalah jaring pengaman
// yang memastikan tak ada yang tertinggal selamanya.

import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import {
  getOrderByOrderId,
  readCancelledWithPendingPayment,
  readExpiredPendingInvoices,
  updatePaymentStatus,
} from '@/lib/mock-db/orders'
import { expireOrder, revalidateAfterExpiry } from '@/lib/order-expiry'
import { INVOICE_DURATION_SECONDS } from '@/lib/xendit/invoice'

// createAdminClient (Supabase) + node:crypto butuh runtime Node.js, bukan Edge
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LOG = '[cron:expire-orders]'

// Tenggang di atas umur invoice. Callback Xendit bisa terlambat beberapa menit, dan menutup
// pesanan lebih dulu daripada callback-nya hanya akan membuat dua jalur berebut baris yang sama.
// Satu jam cukup lapang tanpa membuat stok tertahan lama.
const GRACE_MS = 60 * 60 * 1000

// Batas pesanan per jalannya. Menahan durasi fungsi tetap terduga; sisanya terbawa ke hari
// berikutnya, dan karena urutannya terlama-dulu, yang paling lama tertahan selalu didahulukan.
const MAX_PER_RUN = 50

// Satu pesanan bisa memicu beberapa penulisan (status, stok per gudang, riwayat mutasi), jadi
// batas durasi dinaikkan dari bawaan 10 detik.
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
    if (auth.reason === 'not-configured') {
      // Salah konfigurasi KITA → 500, bukan 401. Menyamakannya membuat cron yang mati karena env
      // kosong terlihat seperti serangan.
      console.error(`${LOG} CRON_SECRET belum di-set di environment`)
      return NextResponse.json({ error: 'Cron belum dikonfigurasi.' }, { status: 500 })
    }
    console.warn(`${LOG} ditolak: ${auth.reason}`)
    return NextResponse.json({ error: 'Tidak berwenang.' }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - INVOICE_DURATION_SECONDS * 1000 - GRACE_MS)
  const cutoffIso = cutoff.toISOString()

  // Dua pekerjaan berbeda, sengaja dibaca bersamaan:
  //   FASE 1 — pesanan hidup yang tenggat bayarnya lewat → tutup DAN kembalikan stoknya.
  //   FASE 2 — pesanan yang sudah dibatalkan tapi status BAYARNYA tertinggal di "Menunggu"
  //            → perbaiki pembukuannya saja, tanpa menyentuh stok sama sekali.
  const [invoices, staleCancelled] = await Promise.all([
    readExpiredPendingInvoices(cutoffIso, MAX_PER_RUN),
    readCancelledWithPendingPayment(cutoffIso, MAX_PER_RUN),
  ])

  // `?dryRun=1` → laporkan APA yang akan disentuh, jangan sentuh apa pun. Endpoint ini membatalkan
  // pesanan dan menggerakkan stok; sebelum menyalakannya di lingkungan yang datanya sudah lama
  // menumpuk, orang perlu bisa melihat daftarnya lebih dulu tanpa mengubah satu baris pun.
  // Vercel tak pernah mengirim parameter ini, jadi jalur terjadwal selalu yang sungguhan.
  if (new URL(request.url).searchParams.get('dryRun') === '1') {
    console.log(
      `${LOG} DRY RUN — ${invoices.length} akan ditutup, ${staleCancelled.length} akan dirapikan`,
    )
    return NextResponse.json({
      dryRun: true,
      checked: invoices.length,
      wouldExpire: invoices,
      wouldMarkFailed: staleCancelled,
      cutoff: cutoffIso,
    })
  }

  if (invoices.length === 0 && staleCancelled.length === 0) {
    console.log(`${LOG} tak ada yang perlu dibereskan (batas ${cutoffIso})`)
    return NextResponse.json({ checked: 0, expired: [], markedFailed: [], cutoff: cutoffIso })
  }

  console.log(
    `${LOG} ${invoices.length} kandidat tutup + ${staleCancelled.length} rapikan, batas ${cutoffIso}`,
  )

  const expired: string[] = []
  const skipped: { invoice: string; reason: string }[] = []
  const productIds: string[] = []
  let failed = 0

  // Berurutan, bukan paralel: beberapa pesanan bisa memuat produk yang sama, dan pengembalian
  // stok serentak untuk baris gudang yang sama saling menimpa.
  for (const invoice of invoices) {
    const order = await getOrderByOrderId(invoice)
    if (!order) {
      // Terbaca sebagai kandidat lalu hilang = terhapus di antara dua query. Bukan kegagalan.
      skipped.push({ invoice, reason: 'NOT_FOUND' })
      continue
    }

    const outcome = await expireOrder(order, invoice, 'cron')
    if (!outcome.ok) {
      failed++
      continue
    }
    if (!outcome.released) {
      skipped.push({ invoice, reason: outcome.reason })
      continue
    }

    expired.push(invoice)
    for (const item of order.items) productIds.push(item.productId)
  }

  // Sekali di akhir, bukan per pesanan — lihat catatan di revalidateAfterExpiry.
  if (expired.length > 0) revalidateAfterExpiry(productIds)

  // === FASE 2: rapikan status bayar pesanan yang sudah dibatalkan ===
  //
  // Murni pembukuan — TIDAK memanggil expireOrder dan TIDAK menyentuh stok. Pesanannya sudah
  // dibatalkan, jadi stoknya sudah kembali saat pembatalan itu; menggerakkannya lagi di sini akan
  // menggelembungkan stok. Yang diperbaiki hanya lencana pembayaran yang berbunyi "Menunggu" pada
  // pesanan yang sudah mati, sehingga admin tak lagi mengira uangnya masih mungkin masuk.
  const markedFailed: string[] = []
  for (const invoice of staleCancelled) {
    // Dibaca ulang, bukan percaya hasil query tadi: pembayaran bisa saja masuk di sela-sela.
    // Menandai Gagal pesanan yang ternyata sudah dibayar akan menghapus jejak uang yang nyata.
    const order = await getOrderByOrderId(invoice)
    if (!order || order.paymentStatus !== 'Menunggu') continue

    const saved = await updatePaymentStatus(invoice, 'Gagal')
    if (!saved) {
      console.error(`${LOG} invoice=${invoice} gagal merapikan status bayar`)
      failed++
      continue
    }
    markedFailed.push(invoice)
  }

  console.log(
    `${LOG} selesai — ${expired.length} ditutup, ${markedFailed.length} dirapikan, ` +
      `${skipped.length} dilewati, ${failed} gagal`,
  )

  return NextResponse.json({
    checked: invoices.length + staleCancelled.length,
    expired,
    markedFailed,
    skipped,
    failed,
    cutoff: cutoffIso,
    ranAt: new Date().toISOString(),
  })
}
