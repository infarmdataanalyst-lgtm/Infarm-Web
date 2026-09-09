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

  const invoice = typeof body.invoice === 'string' ? body.invoice.trim().replace(/^#/, '') : ''
  if (!invoice) {
    return NextResponse.json(
      { error: 'Sertakan `invoice`, atau `probe: true` untuk uji tanpa menghapus.' },
      { status: 400 },
    )
  }

  const order = await getOrderByOrderId(invoice)
  if (!order) {
    return NextResponse.json({ error: `Pesanan ${invoice} tidak ditemukan.` }, { status: 404 })
  }

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
      catatan: 'Tidak ada panggilan ke Mengantar. Ulangi tanpa dryRun untuk menghapus sungguhan.',
      invoice,
      resi: order.trackingNumber ?? null,
      payloadAkanDikirim: payload,
    })
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
