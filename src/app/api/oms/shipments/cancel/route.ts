// src/app/api/oms/shipments/cancel/route.ts
// Memicu DELETE /order ke Mengantar untuk SATU pengiriman. Wajib sesi admin (bukan staff).
//
// ── Peran endpoint ini: PERBAIKAN, bukan pembatalan ──
// Pembatalan yang sah selalu dimulai dari `PATCH /api/orders/update-status`, yang sejak 2026-09-09
// memanggil DELETE sendiri. Yang tersisa di sini adalah pesanan yang sudah dibatalkan tapi
// penjemputannya gagal terhapus (shipment_status CANCEL_FAILED) — karena itu prasyaratnya status
// pesanan "Dibatalkan", bukan peran pemanggilnya.
//
// ── Yang DIUBAH di database kita, dan yang tidak ──
// Sejak MGT-66, hasil percobaan ulang ini DICATAT: berhasil → shipment_status CANCELLED dan
// shipment_error dikosongkan; gagal → CANCEL_FAILED dengan pesan terbaru. Tanpa itu, penghapusan
// yang akhirnya berhasil tak pernah membersihkan tandanya, dan pesanan yang sudah beres tetap
// terlihat menuntut pekerjaan manual — persis yang terjadi 22 Sep 2026 pada resi JO6451515051.
// `order_status` dan stok TETAP tidak disentuh: keduanya sudah selesai saat pesanan dibatalkan.
//
// ── Tiga mode ──
//   { "probe": true }                    → DELETE dengan _id KARANGAN. Tak ada yang terhapus;
//                                          gunanya melihat bentuk respons penolakan Mengantar.
//   { "invoice": "INV-…", "dryRun": true } → tampilkan payload yang AKAN dikirim, tanpa memanggil.
//   { "invoice": "INV-…" }               → hapus sungguhan. PERMANEN, tak bisa diurungkan.

import { NextResponse } from 'next/server'
import { requireAdminRole } from '@/lib/oms-guard'
import {
  PROBE_OBJECT_ID,
  buildCancelPayload,
  cancelShipmentOrder,
} from '@/lib/mengantar-cancel'
import { getOrderByOrderId, setShipmentCancellation } from '@/lib/mock-db/orders'
import { normalizeInvoiceId } from '@/lib/invoice-id'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(request: Request) {
  const denied = await requireAdminRole('Akun Anda tidak berwenang membatalkan pengiriman.')
  if (denied) return denied

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  // === Mode PROBE ===
  // Sengaja TIDAK menyentuh database sama sekali dan tidak menerima invoice: satu-satunya sasaran
  // yang mungkin adalah id karangan, jadi mode ini mustahil menghapus pengiriman sungguhan
  // sekalipun dipanggil dengan parameter yang salah.
  if (body.probe === true) {
    const hasil = await cancelShipmentOrder({ objectId: PROBE_OBJECT_ID })
    return NextResponse.json({
      mode: 'probe',
      catatan:
        'DELETE dikirim dengan _id karangan (24 nol). Tak ada pengiriman yang terhapus — ini hanya untuk melihat bentuk respons penolakan Mengantar.',
      payloadTerkirim: buildCancelPayload({ objectId: PROBE_OBJECT_ID }),
      hasil,
    })
  }

  // Bentuknya divalidasi, bukan sekadar dirapikan (SEC-052) — nilai ini ikut masuk ke log yang
  // dipakai menelusuri penjemputan mana yang dihapus.
  const invoice = normalizeInvoiceId(body.invoice)
  if (!invoice) {
    return NextResponse.json(
      {
        error:
          'Sertakan `invoice` yang berbentuk nomor invoice, atau `probe: true` untuk uji tanpa menghapus.',
      },
      { status: 400 },
    )
  }

  const order = await getOrderByOrderId(invoice)
  if (!order) {
    return NextResponse.json({ error: `Pesanan ${invoice} tidak ditemukan.` }, { status: 404 })
  }

  // === Prasyarat keadaan (SEC-047) ===
  //
  // Menghapus penjemputan pesanan yang MASIH BERJALAN berarti kurir tak akan datang untuk paket
  // yang pembelinya sudah membayar dan masih menunggu — dan endpoint ini sengaja tak menulis
  // apa pun ke database kita, jadi tak ada satu pun kolom yang akan menyebutkan hal itu terjadi.
  // Pesanannya tetap terbaca "Diproses" selamanya sementara paketnya tak pernah dijemput.
  //
  // Pembatalan yang sah SELALU dimulai dari OMS (PATCH /api/orders/update-status), yang kini
  // memanggil penghapusan Mengantar sendiri. Yang tersisa untuk endpoint ini adalah PERBAIKAN:
  // pesanan yang sudah dibatalkan tapi penjemputannya gagal terhapus. Karena itu prasyaratnya
  // status pesanan, bukan peran pemanggilnya — admin yang berwenang pun tak punya alasan sah
  // menghapus penjemputan pesanan yang masih hidup.
  //
  // Sengaja TANPA tuas paksa. Jalan keluarnya sudah ada dan lebih benar: batalkan pesanannya
  // lewat OMS, dan penghapusan ini ikut berjalan dengan jejak yang lengkap.
  const bolehDihapus = order.status === 'Dibatalkan'

  const target = {
    ...(order.mengantarObjectId ? { objectId: order.mengantarObjectId } : {}),
    ...(order.mengantarOrderId ? { orderId: order.mengantarOrderId } : {}),
  }
  const payload = buildCancelPayload(target)

  if (!payload) {
    return NextResponse.json(
      {
        error: `Pesanan ${invoice} tak punya _id maupun ORDER_ID Mengantar — jalankan backfill lebih dulu.`,
        code: 'NO_IDENTITY',
      },
      { status: 409 },
    )
  }

  if (body.dryRun === true) {
    return NextResponse.json({
      mode: 'dryRun',
      catatan: bolehDihapus
        ? 'Tidak ada panggilan ke Mengantar. Ulangi tanpa dryRun untuk menghapus sungguhan.'
        : `Tidak ada panggilan ke Mengantar. Penghapusan sungguhan AKAN DITOLAK: status pesanan "${order.status ?? 'tidak diketahui'}", bukan "Dibatalkan".`,
      invoice,
      statusPesanan: order.status ?? null,
      prasyaratTerpenuhi: bolehDihapus,
      resi: order.trackingNumber ?? null,
      payloadAkanDikirim: payload,
    })
  }

  if (!bolehDihapus) {
    return NextResponse.json(
      {
        error: `Pesanan ${invoice} berstatus "${order.status ?? 'tidak diketahui'}", bukan "Dibatalkan". Penjemputan hanya boleh dihapus untuk pesanan yang sudah dibatalkan — batalkan dulu lewat OMS, dan penghapusannya ikut berjalan otomatis.`,
        code: 'ORDER_NOT_CANCELLED',
        statusPesanan: order.status ?? null,
      },
      { status: 409 },
    )
  }

  const hasil = await cancelShipmentOrder(target)

  console.log(
    `[oms/shipments/cancel] ${invoice} (resi ${order.trackingNumber ?? '-'}) → ${
      hasil.ok ? `TERHAPUS ${hasil.deletedCount}` : `GAGAL ${hasil.reason}`
    } (${hasil.attempts}x percobaan)`,
  )

  // Hasilnya dicatat supaya tanda CANCEL_FAILED bisa BERSIH sendiri saat percobaan ulang berhasil.
  // Sampai di sini `order.status` dipastikan "Dibatalkan" (lihat bolehDihapus di atas), jadi menulis
  // shipment_status tak bisa menyentuh pesanan yang masih berjalan.
  const status = !hasil.ok && hasil.httpStatus !== undefined ? ` [HTTP ${hasil.httpStatus}]` : ''
  const dbDiperbarui = await setShipmentCancellation(
    invoice,
    hasil.ok
      ? { cancelled: true }
      : {
          cancelled: false,
          error: `${hasil.reason}${status} setelah ${hasil.attempts}x percobaan: ${hasil.detail}`,
        },
  )

  return NextResponse.json({
    mode: 'hapus',
    catatan: hasil.ok
      ? 'Penjemputan terhapus di Mengantar; shipment_status pesanan ini diperbarui menjadi CANCELLED. Status pesanan dan stok tidak disentuh.'
      : 'Penghapusan GAGAL; shipment_status tetap CANCEL_FAILED dengan pesan terbaru. Status pesanan dan stok tidak disentuh.',
    invoice,
    resi: order.trackingNumber ?? null,
    payloadTerkirim: payload,
    dbDiperbarui,
    hasil,
  })
}
