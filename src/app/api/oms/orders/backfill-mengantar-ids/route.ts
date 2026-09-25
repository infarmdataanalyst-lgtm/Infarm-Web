// src/app/api/oms/orders/backfill-mengantar-ids/route.ts
// Memulihkan identitas pengiriman Mengantar (_id / ORDER_ID / batch_id) pada pesanan yang sudah
// terlanjur dibooking SEBELUM migration 20260909120000 — saat kode kita hanya menyimpan nomor resi.
//
// ── Kenapa endpoint aplikasi, bukan skrip terminal ──
// Panggilan ke Mengantar memuat MENGANTAR_API_KEY sebagai segmen path URL, jadi ia hanya boleh
// berjalan di server. Menjalankannya lewat skrip lokal berarti kunci itu berkeliaran di riwayat
// shell dan log. Di sini ia tetap di dalam proses server, persis seperti halaman /track.
//
// ── Ini panggilan BACA ──
// `GET /order?tracking_id={resi}` tidak memotong saldo Mengantar dan tidak menerbitkan apa pun.
// Karena itu ia TIDAK melewati mengantarWriteHost(); penjaga itu khusus POST /order & POST /time.
// Tidak ada satu pun pembatalan yang terjadi di sini — endpoint ini hanya membaca lalu menulis ke
// tabel `orders` milik kita sendiri.
//
// ── Selalu coba dryRun lebih dulu ──
//   GET  ?dryRun=1  → daftar pesanan yang AKAN diproses, tanpa memanggil Mengantar sama sekali
//   POST ?dryRun=1  → memanggil Mengantar dan menampilkan hasilnya, TANPA menulis ke database
//   POST            → menulis

import { NextResponse } from 'next/server'
import { requireAdminRole } from '@/lib/oms-guard'
import { fetchTrackingDetail } from '@/lib/mengantar-tracking'
import { readOrdersMissingMengantarIds, setMengantarIds } from '@/lib/mock-db/orders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Pesanan yang diproses dalam satu panggilan. Tiap pesanan = satu permintaan ke Mengantar yang
// dijalankan BERURUTAN (lihat di bawah), jadi batas ini sekaligus menahan lama eksekusi.
const MAX_PER_RUN = 25

// Jeda antar permintaan. Mengantar tak mendokumentasikan batas lajunya, dan belasan permintaan
// beruntun dari satu kunci adalah cara paling mudah untuk menemukannya dengan cara yang tak
// menyenangkan. Sengaja berurutan, bukan Promise.all.
const JEDA_MS = 300

export const maxDuration = 60

type Hasil = {
  invoice: string
  resi: string
  // 'siap-diisi' HANYA muncul pada dryRun. Sengaja bukan 'terisi': label yang sama untuk "sudah
  // ditulis" dan "akan ditulis" membuat laporan uji terbaca seolah databasenya sudah berubah.
  status: 'terisi' | 'siap-diisi' | 'tidak-ditemukan' | 'gagal-simpan'
  objectId?: string
  orderId?: string
  batchId?: string
  detail?: string
}

const tidur = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Daftar sasaran tanpa menyentuh Mengantar — untuk melihat cakupannya lebih dulu.
export async function GET() {
  const denied = await requireAdminRole('Akun Anda tidak berwenang menjalankan backfill.')
  if (denied) return denied

  const kandidat = await readOrdersMissingMengantarIds(MAX_PER_RUN)
  return NextResponse.json({
    dryRun: true,
    catatan: 'Belum ada panggilan ke Mengantar. Jalankan POST untuk memulai.',
    jumlah: kandidat.length,
    kandidat,
  })
}

export async function POST(request: Request) {
  const denied = await requireAdminRole('Akun Anda tidak berwenang menjalankan backfill.')
  if (denied) return denied

  const dryRun = new URL(request.url).searchParams.get('dryRun') === '1'
  const kandidat = await readOrdersMissingMengantarIds(MAX_PER_RUN)

  if (kandidat.length === 0) {
    return NextResponse.json({ dryRun, jumlah: 0, hasil: [], ringkasan: 'Tak ada yang perlu diisi.' })
  }

  const hasil: Hasil[] = []

  for (const [i, pesanan] of kandidat.entries()) {
    if (i > 0) await tidur(JEDA_MS)

    const tracking = await fetchTrackingDetail(pesanan.trackingNumber)

    if (!tracking.ok) {
      hasil.push({
        invoice: pesanan.orderId,
        resi: pesanan.trackingNumber,
        status: 'tidak-ditemukan',
        detail: `${tracking.reason}: ${tracking.detail.slice(0, 120)}`,
      })
      continue
    }

    const ids = {
      ...(tracking.mengantarObjectId ? { mengantarObjectId: tracking.mengantarObjectId } : {}),
      ...(tracking.mengantarOrderId ? { mengantarOrderId: tracking.mengantarOrderId } : {}),
      ...(tracking.mengantarBatchId ? { mengantarBatchId: tracking.mengantarBatchId } : {}),
    }

    // Respons terbaca tapi tanpa satu pun identitas. Dibedakan dari kegagalan jaringan supaya
    // terlihat mana yang layak dicoba ulang dan mana yang memang tak akan pernah ada isinya.
    if (Object.keys(ids).length === 0) {
      hasil.push({
        invoice: pesanan.orderId,
        resi: pesanan.trackingNumber,
        status: 'tidak-ditemukan',
        detail: 'respons Mengantar terbaca tapi tanpa _id/ORDER_ID/batch_id',
      })
      continue
    }

    const baris: Hasil = {
      invoice: pesanan.orderId,
      resi: pesanan.trackingNumber,
      status: dryRun ? 'siap-diisi' : 'terisi',
      ...ids,
    }

    if (dryRun) {
      hasil.push({ ...baris, detail: 'dryRun — tidak ditulis' })
      continue
    }

    const tersimpan = await setMengantarIds(pesanan.orderId, ids)
    hasil.push(tersimpan ? baris : { ...baris, status: 'gagal-simpan' })
  }

  const terisi = hasil.filter((h) => h.status === 'terisi').length
  const gagal = hasil.filter((h) => h.status !== 'terisi' && h.status !== 'siap-diisi').length

  console.log(
    `[backfill-mengantar-ids] ${dryRun ? 'DRY RUN ' : ''}${kandidat.length} pesanan: ${terisi} terisi, ${gagal} gagal`,
  )

  return NextResponse.json({
    dryRun,
    jumlah: kandidat.length,
    terisi,
    gagal,
    hasil,
  })
}
