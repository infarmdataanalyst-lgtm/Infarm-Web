// src/lib/courier-tracking-url.ts
// SATU PINTU tautan pelacakan publik milik kurir. Modul MURNI (tanpa fetch/DB).
//
// ── Kenapa perlu ──
// Riwayat scan per-peristiwa TIDAK tersedia lewat API Mengantar. Terverifikasi 2026-08-21: endpoint
// yang dipakai dashboard (`POST /api/order/advanced`) membalas `401 "user data not found 1"` bila
// dipanggil dari server kami, dan enam varian ber-API-key membalas 404/401. Jadi satu-satunya cara
// pembeli melihat riwayat lengkap adalah membukanya di situs kurir.
//
// Ini BUKAN pengganti permanen. Begitu Mengantar membuka endpoint tracking untuk API key, riwayat
// tampil di dalam situs kita (lihat src/lib/mengantar-tracking.ts) dan tautan ini turun pangkat
// menjadi pelengkap.

import { normalizeCourierKey } from '@/lib/courier-logo'

// Pola URL pelacakan publik per kurir. `{awb}` diganti nomor resi.
//
// Kunci = kode kurir yang SUDAH dinormalkan (lihat lib/courier-logo.ts), jadi 'JT' dari
// `courier.id` dan 'J&T' dari `orders.nama_ekspedisi` sama-sama cocok.
//
// ⚠️ Pola J&T BELUM diverifikasi otomatis: situs mereka memblokir permintaan non-browser (HTTP 418),
// jadi ia tak bisa diuji dari server. Bila ternyata tak memuat nomor resi otomatis, pembeli masih
// bisa menempelkannya — komponen pemakainya SELALU menampilkan resi beserta tombol salin.
const TRACKING_URLS: Record<string, string> = {
  JT: 'https://jet.co.id/track/{awb}',
}

// URL pelacakan publik untuk sebuah resi, atau null bila kurirnya belum punya pola.
// Menerima `courier.id` ('JT'), `courier.name` ('J&T'), maupun `orders.nama_ekspedisi`.
export function courierTrackingUrl(
  courier: string | null | undefined,
  awb: string | null | undefined,
): string | null {
  const resi = awb?.trim()
  if (!courier || !resi) return null
  const pattern = TRACKING_URLS[normalizeCourierKey(courier)]
  if (!pattern) return null
  return pattern.replace('{awb}', encodeURIComponent(resi))
}
