// src/app/api/orders/get/route.ts
// API membaca satu pesanan berdasarkan ?orderId=... (dipakai form /review).
// Hanya mengembalikan field yang dibutuhkan form ulasan (bukan seluruh data pesanan).
//
// ── Kenapa endpoint ini dulu berbahaya (temuan SEC-007) ──
// Endpoint ini terbuka tanpa autentikasi maupun token — modal satu-satunya adalah menebak nomor
// invoice. Nomor invoice berpola `INV-YYYYMMDD-xxxx`, jadi ruang tebakan untuk satu hari tertentu
// kecil, dan dulu tak ada pembatas laju sama sekali: seluruh ruang satu hari bisa disapu dari satu
// IP dalam hitungan menit. Yang lebih parah, responsnya memuat `customerName` UTUH, sehingga hasil
// penyapuan itu berupa daftar nama pelanggan lengkap beserta isi belanjaannya.
//
// ── Dua perbaikan yang dipasang ──
// 1. NAMA PELANGGAN TIDAK LAGI DIKEMBALIKAN. Bukan disamarkan, tapi dihapus sepenuhnya — pemakai
//    satu-satunya (form ulasan) ternyata tak membutuhkannya: nama penulis ulasan kini diisi SERVER
//    dari pesanan itu sendiri di `reviews/create`. Menghapus lebih baik daripada menyamarkan,
//    karena nama tersamar pun masih membocorkan panjang kata dan huruf awal setiap nama.
// 2. PEMBATAS LAJU DUA LAPIS. Lapis umum per-IP, ditambah lapis khusus yang HANYA menghitung
//    tebakan MELESET. Pembeli sah datang membawa nomor yang benar dan tak pernah menyentuh lapis
//    kedua betapa pun seringnya ia memuat ulang; penyapu — yang menurut definisinya hampir selalu
//    meleset — berhenti cepat.
//
// Yang SENGAJA tidak diubah: endpoint ini tetap tanpa token. Mewajibkan token akan mematahkan
// tautan ulasan yang sudah beredar, sementara setelah nama dihapus, isi respons yang tersisa
// (nomor pesanan, daftar produk, status) tak lagi cukup untuk mengenali seseorang.

import { NextResponse } from 'next/server'
import { getOrderByOrderId } from '@/lib/mock-db/orders'
import {
  RATE_LIMITS,
  enforceRateLimit,
  getClientIp,
  isOverLimit,
  rateLimitResponse,
  recordAttempt,
} from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Mengembalikan { order: { orderId, items, status } } untuk nomor pesanan tertentu.
// CATATAN: `customerName` sengaja TIDAK disertakan — lihat penjelasan di kepala berkas.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const orderId = searchParams.get('orderId')

  if (!orderId) {
    return NextResponse.json({ error: 'Parameter orderId wajib ada.' }, { status: 400 })
  }

  const ip = getClientIp(request)

  // Lapis 1 — throttle umum, dihitung untuk setiap permintaan.
  const limitUmum = enforceRateLimit(`order-get:ip:${ip}`, RATE_LIMITS.ORDER_GET_IP)
  if (limitUmum) return limitUmum

  // Lapis 2 — khusus tebakan meleset. Diperiksa DULU tanpa mencatat; pencatatan menunggu sampai
  // ketahuan pesanannya memang tidak ada.
  const kunciMeleset = `order-get:ip-miss:${ip}`
  if (isOverLimit(kunciMeleset, RATE_LIMITS.ORDER_GET_IP_MISS)) {
    return rateLimitResponse(RATE_LIMITS.ORDER_GET_IP_MISS, kunciMeleset)
  }

  // Buang '#' di depan bila ada (label invoice memakai "#INF-...")
  const order = await getOrderByOrderId(orderId.replace(/^#/, ''))
  if (!order) {
    recordAttempt(kunciMeleset, RATE_LIMITS.ORDER_GET_IP_MISS)
    return NextResponse.json({ error: 'Pesanan tidak ditemukan.' }, { status: 404 })
  }

  return NextResponse.json({
    order: {
      orderId: order.orderId,
      items: order.items,
      // status disertakan agar form review bisa memblokir pesanan yang sudah dibatalkan
      status: order.status ?? 'Diproses',
    },
  })
}
