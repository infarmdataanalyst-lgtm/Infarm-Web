// src/lib/order-cancellation.ts
// Aturan SIAPA yang boleh membatalkan pesanan, dan kapan. Murni — tanpa I/O, aman diimpor dari
// komponen 'use client' maupun dari Route Handler.
//
// ── Kenapa satu fungsi, bukan daftar status di tiap endpoint ──
// Sebelumnya dua endpoint pembatalan masing-masing memegang salinan daftar status yang boleh
// dibatalkan. Dua salinan berarti dua kesempatan untuk menyimpang, dan menyimpang di sini berarti
// satu jalur mengizinkan apa yang jalur lain tolak. Tampilan pun perlu tahu jawabannya lebih dulu
// agar bisa menampilkan tombol yang benar — kalau ia menebak sendiri, layar dan server bisa
// berbeda pendapat.
//
// ── Kenapa RESI, bukan status pesanan, yang menjadi garis batas ──
// Ini inti perbaikannya. Booking kurir dijalankan tepat setelah pembayaran masuk
// (`bookShipmentForPaidOrder` dipanggil webhook Xendit), sementara `order_status` baru berpindah ke
// 'Dikirim' ketika admin menandainya. Akibatnya ada jendela — bisa berjam-jam — saat pesanan masih
// berstatus 'Diproses' PADAHAL resinya sudah tercetak dan kurir mungkin sudah menjemput.
//
// Selama jendela itu, aturan lama (yang hanya melihat `order_status`) mengizinkan pembeli
// membatalkan sendiri. Pembatalan mengembalikan stok dan menandai pesanan batal, tetapi TIDAK
// membatalkan booking di Mengantar — paketnya tetap berjalan. Kerugiannya berlapis: barang keluar,
// stok dikreditkan balik seolah barang masih ada, dan uang pembeli wajib dikembalikan.
//
// Karena itu garis batasnya digeser ke fakta yang benar-benar menentukan: apakah resi sudah ada.

import type { OrderFulfillmentStatus } from '@/types/order'

// Status yang secara prinsip masih boleh dibatalkan sendiri oleh pembeli.
// Pemeriksaan resi di bawah bisa mempersempitnya lagi.
const SELF_CANCELLABLE: OrderFulfillmentStatus[] = ['Menunggu Pembayaran', 'Diproses']

export type BuyerCancelVerdict =
  | { ok: true }
  | { ok: false; code: 'ALREADY_CANCELLED' | 'ALREADY_SHIPPED' | 'NEEDS_CS'; message: string }

// Bentuk minimum yang dibutuhkan. Sengaja longgar supaya bisa menerima Order utuh (server) maupun
// bentuk publik yang dikirim ke halaman pembatalan (klien).
export type CancelCandidate = {
  status?: OrderFulfillmentStatus | string | null
  trackingNumber?: string | null
  shipmentStatus?: string | null
}

// Apakah pembeli boleh membatalkan pesanan ini SENDIRI, tanpa persetujuan siapa pun.
//
// `NEEDS_CS` bukan penolakan permanen — ia berarti keputusannya pindah ke manusia. Pembeli
// diarahkan menghubungi CS, yang bisa memeriksa apakah paketnya benar-benar sudah dijemput
// sebelum memutuskan.
export function evaluateBuyerCancel(order: CancelCandidate): BuyerCancelVerdict {
  const status = (order.status ?? 'Diproses') as OrderFulfillmentStatus

  if (status === 'Dibatalkan') {
    return { ok: false, code: 'ALREADY_CANCELLED', message: 'Pesanan ini sudah dibatalkan.' }
  }

  if (!SELF_CANCELLABLE.includes(status)) {
    return {
      ok: false,
      code: 'ALREADY_SHIPPED',
      message: `Pesanan berstatus "${status}" tidak bisa dibatalkan.`,
    }
  }

  // Resi sudah ada = kurir sudah punya perintah jemput. Statusnya boleh saja masih 'Diproses';
  // yang menentukan adalah kertas yang sudah tercetak, bukan label di layar admin.
  const sudahDibooking = Boolean(order.trackingNumber?.trim()) || order.shipmentStatus === 'BOOKED'
  if (sudahDibooking) {
    return {
      ok: false,
      code: 'NEEDS_CS',
      message:
        'Pesanan ini sudah dijadwalkan penjemputan kurir, jadi pembatalannya perlu diperiksa admin lebih dulu.',
    }
  }

  return { ok: true }
}
