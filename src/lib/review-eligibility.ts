// src/lib/review-eligibility.ts
// Aturan SATU-SATUNYA tentang pesanan mana yang boleh diulas. Murni — tanpa I/O, tanpa rahasia,
// dipakai bersama oleh route handler (otoritatif) DAN halaman /review (tampilan).
//
// Pola yang sama dengan `evaluateBuyerCancel` di src/lib/order-cancellation.ts, dan alasannya
// sama: selama keduanya memanggil fungsi ini dengan data yang sama, mustahil layar menjanjikan
// sesuatu yang lalu ditolak server.
//
// ── Dua sumber hak ulas, dan yang satu MENGALAHKAN yang lain ──
//   delivered_at  — diisi otomatis saat kurir menyatakan paket diterima. Ini jalur utamanya.
//   order_status  — 'Selesai' yang ditandai admin. Hanya berlaku bila delivered_at KOSONG.
//
// Begitu `delivered_at` terisi, dialah yang memutuskan — termasuk saat jendelanya sudah tutup.
// Menandai 'Selesai' TIDAK menghidupkan kembali jendela yang lewat. Kalau tidak, tenggat itu bisa
// terbuka lagi tanpa sengaja oleh pekerjaan administratif biasa, dan tak ada yang menyadarinya.
//
// ── Kenapa "harus sudah diterima", bukan "asal bukan Dibatalkan" ──
// Versi pertama hanya menolak status `Dibatalkan` di kelima titik pemeriksaan, sehingga pesanan
// yang BELUM DIBAYAR pun bisa diulas: checkout, tidak membayar, lalu menulis ulasan sebagai
// "pembeli terverifikasi" (SEC-054).
//
// Versi kedua mensyaratkan `Selesai` — benar secara aturan, tapi tak ada apa pun di sistem yang
// menulis status itu otomatis (AUTO_ADVANCE_MAX_STEP = 2 di tracking.ts), jadi praktis SEMUA
// ulasan terblokir sampai admin menandai satu per satu. Karena itu sekarang bersandar pada
// peristiwa kurir, bukan pada kerajinan admin.

import type { OrderFulfillmentStatus } from '@/types/order'

// Panjang jendela ulasan, dihitung dalam HARI KALENDER Asia/Jakarta.
//
// Hari pengiriman TIDAK dihitung: hari ke-1 adalah hari berikutnya, dan jendelanya tutup pada
// pukul 23:59:59 WIB di hari ke-14. Paket yang diterima 1 September masih bisa diulas sampai
// akhir 15 September.
export const REVIEW_WINDOW_DAYS = 14

export type ReviewBlockCode = 'CANCELLED' | 'NOT_COMPLETED' | 'WINDOW_EXPIRED'

export type ReviewEligibility =
  | { ok: true; deadlineMs?: number; sisaHari?: number }
  | { ok: false; code: ReviewBlockCode; message: string }

export type ReviewEligibilityInput = {
  status: OrderFulfillmentStatus | undefined
  deliveredAt?: string // ISO 8601, dari orders.delivered_at
}

const SEHARI_MS = 86_400_000

// Tanggal kalender Asia/Jakarta untuk suatu waktu, sebagai 'YYYY-MM-DD'.
//
// Zona WIB dipakai eksplisit karena server berjalan di UTC (Vercel): memakai waktu server akan
// menggeser batas hari sampai 7 jam, dan tepat di sekitar tengah malam itulah jendela ini tutup.
// Pola yang sama sudah dipakai `pilihMetode` di xendit/ewallet-refund.ts.
function tanggalJakarta(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms))
}

// Milidetik TERAKHIR yang masih diterima untuk mengulas. `null` bila waktunya tak terbaca.
//
// Offset +07:00 ditulis tetap, bukan dihitung: WIB tidak mengenal daylight saving, jadi tak ada
// tanggal di mana nilainya berbeda. Menghitungnya dinamis hanya menambah cara untuk salah.
export function reviewDeadlineMs(deliveredAtIso: string): number | null {
  const ms = Date.parse(deliveredAtIso)
  if (Number.isNaN(ms)) return null

  const awalHariKirim = Date.parse(`${tanggalJakarta(ms)}T00:00:00+07:00`)
  if (Number.isNaN(awalHariKirim)) return null

  // Tengah malam SESUDAH hari ke-14, dikurangi satu milidetik → 23:59:59.999 di hari ke-14.
  return awalHariKirim + (REVIEW_WINDOW_DAYS + 1) * SEHARI_MS - 1
}

function formatTanggalWib(ms: number): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(ms))
}

// Apakah pesanan ini boleh diulas sekarang.
//
// `nowMs` disuntikkan supaya batas jendelanya bisa diuji tanpa menunggu 14 hari — batas hari
// adalah tempat kesalahan off-by-one bersembunyi, dan ia harus bisa diperiksa, bukan diandaikan.
export function evaluateReviewEligibility(
  input: ReviewEligibilityInput,
  nowMs = Date.now(),
): ReviewEligibility {
  if (input.status === 'Dibatalkan') {
    return {
      ok: false,
      code: 'CANCELLED',
      message: 'Pesanan ini dibatalkan, jadi tidak bisa diulas.',
    }
  }

  // === Jalur utama: kurir sudah menyatakan diterima ===
  if (input.deliveredAt) {
    const deadlineMs = reviewDeadlineMs(input.deliveredAt)

    // Waktu tersimpan yang tak terbaca. Diperlakukan seolah belum diterima — menolak-dengan-aman,
    // dan pesanan itu masih punya jalan keluar lewat penandaan 'Selesai' oleh admin.
    if (deadlineMs === null) {
      return {
        ok: false,
        code: 'NOT_COMPLETED',
        message: 'Waktu penerimaan pesanan ini tidak terbaca. Hubungi CS bila ingin mengulas.',
      }
    }

    if (nowMs > deadlineMs) {
      return {
        ok: false,
        code: 'WINDOW_EXPIRED',
        message: `Batas waktu ulasan sudah lewat pada ${formatTanggalWib(deadlineMs)}.`,
      }
    }

    return {
      ok: true,
      deadlineMs,
      // Dibulatkan KE ATAS: sisa 3 jam tetap berarti "tersisa 1 hari", bukan nol. Menampilkan nol
      // pada jendela yang masih terbuka akan membuat pembeli mengira ia sudah terlambat.
      sisaHari: Math.max(1, Math.ceil((deadlineMs - nowMs) / SEHARI_MS)),
    }
  }

  // === Jalur warisan: tak ada catatan penerimaan dari kurir ===
  //
  // Pesanan lama (kolomnya baru), pesanan tanpa resi (ambil sendiri), atau paket yang scan
  // "diterima"-nya tak pernah sampai. Penandaan 'Selesai' oleh admin tetap membuka hak ulas, dan
  // SENGAJA tanpa tenggat: tak ada tanggal penerimaan yang bisa dijadikan titik mulai hitungan.
  if (input.status === 'Selesai') return { ok: true }

  return {
    ok: false,
    code: 'NOT_COMPLETED',
    message: `Bisa diulas setelah pesanan diterima. Status sekarang: ${input.status ?? 'belum diketahui'}.`,
  }
}
