// src/app/api/oms/shipments/cancel/route.ts
// Memicu DELETE /order ke Mengantar untuk SATU pengiriman. Wajib sesi admin (bukan staff).
//
// ⚠️ ENDPOINT INI BELUM TERSAMBUNG KE ALUR PEMBATALAN OMS. Ia hanya bisa dipanggil dengan sengaja,
// satu pesanan sekali panggil. Penyambungannya ke `PATCH /api/orders/update-status` menunggu dua
// hal terjawab lebih dulu (lihat catatan di lib/mengantar-cancel.ts):
//   1. sampai kapan Mengantar masih menerima penghapusan
//   2. apakah saldonya dikembalikan
// Sampai itu jelas, membuat setiap pembatalan OMS otomatis memanggil DELETE berarti menyalakan
// perilaku yang belum pernah kita lihat sekali pun, pada jalur yang menyentuh pesanan pembeli.
//
// ⚠️ ENDPOINT INI TIDAK MENULIS APA PUN KE DATABASE KITA. Ia menghapus di Mengantar lalu melaporkan
// hasilnya, titik. `order_status`, `shipment_status`, dan stok tidak disentuh. Pemisahan itu
// disengaja: selama perilaku DELETE belum terbukti, mencatat "penjemputan sudah dibatalkan" ke DB
// berarti menyimpan keyakinan yang belum tentu benar — dan keyakinan salah di kolom itu jauh lebih
// sulit ditemukan daripada kolom yang dibiarkan kosong.
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
import { getOrderByOrderId } from '@/lib/mock-db/orders'
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
    }`,
  )

  return NextResponse.json({
    mode: 'hapus',
    catatan:
      'Database kita TIDAK diubah oleh endpoint ini — status pesanan, shipment_status, dan stok tetap seperti semula.',
    invoice,
    resi: order.trackingNumber ?? null,
    payloadTerkirim: payload,
    hasil,
  })
}
