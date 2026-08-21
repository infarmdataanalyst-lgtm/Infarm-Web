// src/lib/xendit/payment-request.ts
// Pembuatan Virtual Account lewat Payment Request (Payments API v3) Xendit. SERVER ONLY.
//
// ⚠️ JANGAN pernah diimpor dari komponen 'use client' — modul ini memegang XENDIT_SECRET_KEY
// (lewat lib/xendit/config.ts). Satu-satunya pemanggil yang sah: route handler.
//
// ── Kontrak API: BELUM DIVERIFIKASI ──
// Belum ada satu pun panggilan Xendit yang pernah dijalankan dari project ini, jadi bentuk
// request/response di bawah disusun dari dokumentasi, BUKAN dari respons sungguhan. Pemetaannya
// dibuat TOLERAN (beberapa kandidat nama field) dan setiap tebakan ditandai `UNVERIFIED`.
// Setelah panggilan pertama berhasil, ganti komentar itu dengan bentuk respons yang sebenarnya —
// pola yang sama dipakai saat memetakan API Mengantar dan terbukti menghemat waktu.
//
// ── Nominal ──
// `request_amount` = `orders.jumlah_total` apa adanya (INTEGER rupiah). Xendit IDR tak memakai
// satuan sen, jadi TIDAK ADA pengalian 100. Nominal SELALU dibaca dari DB, tak pernah dari client.

import { XENDIT_PAYMENT_REQUEST_PATH, xenditCredentials, xenditUrl } from '@/lib/xendit/config'
import type { Order } from '@/types/order'

const LOG = '[xendit-payment-request]'

// Batas waktu panggilan. Dijalankan di dalam permintaan checkout, jadi pembeli menunggu.
const REQUEST_TIMEOUT_MS = 12_000

// Berapa lama VA berlaku. Sengaja pendek: setiap pesanan menunggu bayar MENAHAN STOK (checkout
// sudah memotongnya), jadi VA berumur panjang = stok terkunci lama tanpa uang masuk.
export const VA_EXPIRY_HOURS = 24

// === Peta bank → channel_code Xendit ===

// Kunci = id metode bayar di UI kita (`PAYMENT_METHODS` di lib/data/dummy-checkout.ts),
// nilai = channel_code Xendit.
//
// Sengaja daftar putih EKSPLISIT, bukan `id.toUpperCase()`: channel yang tak didukung akan ditolak
// Xendit setelah pembeli sudah menekan bayar, dan pesan errornya tak berguna baginya. Lebih baik
// ditolak di sini dengan pesan kita sendiri.
//
// ⚠️ UNVERIFIED: ketersediaan channel bergantung pada akun Xendit Anda (sebagian VA harus
// diaktifkan lewat dashboard). `danamon` DIHILANGKAN dari peta karena belum dipastikan tersedia
// sebagai channel VA — kalau ternyata ada, tambahkan satu baris di sini.
const VA_CHANNEL_CODES: Record<string, string> = {
  mandiri: 'MANDIRI',
  bri: 'BRI',
  bni: 'BNI',
  permata: 'PERMATA',
  bsi: 'BSI',
  cimb: 'CIMB',
  bca: 'BCA',
}

// channel_code Xendit untuk id metode bayar di UI, atau null bila tak didukung.
export function vaChannelCode(methodId: string): string | null {
  return VA_CHANNEL_CODES[methodId.trim().toLowerCase()] ?? null
}

// Daftar id bank yang benar-benar bisa dipakai — untuk menyaring pilihan di UI.
export function supportedVaMethodIds(): string[] {
  return Object.keys(VA_CHANNEL_CODES)
}

// === Hasil ===

export type VirtualAccount = {
  paymentRequestId: string // id Payment Request di Xendit → orders.id_transaksi
  bank: string // channel_code, mis. 'BNI'
  accountNumber: string // nomor VA yang dibayar pembeli
  amount: number // nominal tagihan (INTEGER rupiah)
  expiresAt: string // ISO 8601, batas waktu pembayaran
  status: string // status Payment Request dari Xendit (mis. 'REQUIRES_ACTION')
}

export type CreateVaResult =
  | { ok: true; va: VirtualAccount }
  | { ok: false; reason: CreateVaFailureReason; detail: string }

export type CreateVaFailureReason =
  | 'not-configured' // XENDIT_SECRET_KEY belum di-set
  | 'blocked-environment' // kunci LIVE dipakai di luar deployment produksi (penjaga uang)
  | 'unsupported-channel' // bank tak ada di daftar putih
  | 'invalid-order' // data pesanan tak cukup
  | 'http-error' // Xendit menolak
  | 'no-va-number' // respons tanpa nomor VA
  | 'network' // timeout / jaringan

// === Pemetaan respons ===

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined
}

// Mengambil nomor VA & tanggal kedaluwarsa dari respons.
//
// ⚠️ UNVERIFIED. Bentuk yang DIHARAPKAN (Payments API v3):
//   { id, reference_id, status, payment_method: { virtual_account: {
//       channel_code, channel_properties: { virtual_account_number, expires_at } } } }
// Kandidat lain ikut dicoba karena sebagian dokumentasi menaruh nomor VA di `actions` atau
// langsung di `virtual_account`. Semua kandidat dibaca dengan aman — tak ada yang dilempar.
function extractVirtualAccount(body: unknown): {
  accountNumber: string
  bank?: string
  expiresAt?: string
} | null {
  if (typeof body !== 'object' || body === null) return null
  const root = body as Record<string, unknown>

  const pm = (root.payment_method ?? {}) as Record<string, unknown>
  const va = (pm.virtual_account ?? root.virtual_account ?? {}) as Record<string, unknown>
  const props = (va.channel_properties ?? {}) as Record<string, unknown>

  const accountNumber =
    asString(props.virtual_account_number) ??
    asString(va.account_number) ??
    asString(props.account_number)
  if (!accountNumber) return null

  return {
    accountNumber,
    ...(asString(va.channel_code) ? { bank: asString(va.channel_code)! } : {}),
    ...(asString(props.expires_at) ?? asString(va.expires_at)
      ? { expiresAt: (asString(props.expires_at) ?? asString(va.expires_at))! }
      : {}),
  }
}

// Pesan error Xendit yang layak dicatat (BUKAN diteruskan mentah ke client).
// Xendit membalas { error_code, message, errors: [...] }.
function describeXenditError(status: number, text: string): string {
  let code: string | undefined
  let message: string | undefined
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    code = asString(parsed.error_code)
    message = asString(parsed.message)
  } catch {
    // Bukan JSON → cukup potongan teksnya
  }
  return `${status} ${[code, message].filter(Boolean).join(': ') || text.slice(0, 200)}`
}

// === Pemanggilan ===

// Membuat Virtual Account untuk sebuah pesanan.
//
// `reference_id` = `orders.nomor_invoice` apa adanya. Itulah kunci yang dipakai webhook untuk
// menemukan pesanannya kembali, jadi jangan pernah dimodifikasi/dipotong di sini.
export async function createVirtualAccount(
  order: Order,
  methodId: string,
  nowMs: number = Date.now(),
): Promise<CreateVaResult> {
  // Validasi INPUT lebih dulu, baru kredensial. Urutan ini penting bagi pesan yang dilihat
  // pembeli: kalau kredensial dicek dulu, bank yang tak didukung akan dilaporkan sebagai
  // "pembayaran belum dikonfigurasi" — pembeli menunggu perbaikan yang tak akan datang, padahal
  // ia hanya perlu memilih bank lain. Cek input tak menyentuh secret key, jadi tak ada kerugian
  // keamanan dari menempatkannya di depan.
  const channelCode = vaChannelCode(methodId)
  if (!channelCode) {
    return {
      ok: false,
      reason: 'unsupported-channel',
      detail: `metode pembayaran '${methodId}' belum didukung`,
    }
  }

  if (!Number.isInteger(order.totalAmount) || order.totalAmount <= 0) {
    return {
      ok: false,
      reason: 'invalid-order',
      detail: `nominal pesanan tidak valid: ${order.totalAmount}`,
    }
  }

  const credentials = xenditCredentials()
  if (!credentials.ok) {
    console.warn(`${LOG} ${order.orderId} DIBATALKAN — ${credentials.detail}`)
    return { ok: false, reason: credentials.reason, detail: credentials.detail }
  }

  const expiresAt = new Date(nowMs + VA_EXPIRY_HOURS * 60 * 60 * 1000).toISOString()

  // ⚠️ UNVERIFIED — bentuk payload dari dokumentasi, belum pernah dikirim sungguhan.
  const payload = {
    reference_id: order.orderId,
    type: 'PAY',
    country: 'ID',
    currency: 'IDR',
    request_amount: order.totalAmount,
    capture_method: 'AUTOMATIC',
    payment_method: {
      type: 'VIRTUAL_ACCOUNT',
      // ONE_TIME_USE: VA mati setelah dibayar sekali. Pesanan kita satu VA satu tagihan; VA
      // reusable akan menerima transfer kedua yang tak terhubung ke pesanan mana pun.
      reusability: 'ONE_TIME_USE',
      virtual_account: {
        channel_code: channelCode,
        channel_properties: {
          // Nama di mutasi rekening pembeli. Xendit membatasi panjangnya untuk sebagian bank.
          customer_name: order.customerName.slice(0, 50),
          expires_at: expiresAt,
        },
      },
    },
  }

  console.log(
    `${LOG} membuat VA ${channelCode} untuk ${order.orderId} nominal=${order.totalAmount} (kunci ${credentials.live ? 'LIVE' : 'test'})`,
  )

  try {
    const res = await fetch(xenditUrl(XENDIT_PAYMENT_REQUEST_PATH), {
      method: 'POST',
      headers: {
        // Secret key ada di header Authorization, BUKAN di URL (beda dari Mengantar) — jadi URL
        // aman dicatat di log, tapi header ini tak boleh pernah ikut dicetak.
        Authorization: credentials.authHeader,
        'Content-Type': 'application/json',
        // Idempotency: bila permintaan yang sama terkirim dua kali (pembeli menekan bayar
        // berulang, atau retry jaringan), Xendit mengembalikan Payment Request yang SAMA alih-alih
        // membuat VA kedua untuk satu pesanan.
        'Idempotency-key': order.orderId,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    const text = await res.text()
    if (!res.ok) {
      return { ok: false, reason: 'http-error', detail: describeXenditError(res.status, text) }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return { ok: false, reason: 'no-va-number', detail: `respons bukan JSON: ${text.slice(0, 200)}` }
    }

    const root = parsed as Record<string, unknown>
    const paymentRequestId = asString(root.id) ?? asString(root.payment_request_id)
    const va = extractVirtualAccount(parsed)
    if (!paymentRequestId || !va) {
      // Tanpa id atau nomor VA, hasilnya tak berguna bagi pembeli DAN tak bisa dilacak kembali —
      // lebih baik dianggap gagal daripada disimpan setengah jadi.
      return { ok: false, reason: 'no-va-number', detail: `respons tak lengkap: ${text.slice(0, 300)}` }
    }

    return {
      ok: true,
      va: {
        paymentRequestId,
        bank: va.bank ?? channelCode,
        accountNumber: va.accountNumber,
        amount: order.totalAmount,
        expiresAt: va.expiresAt ?? expiresAt,
        status: asString(root.status) ?? 'PENDING',
      },
    }
  } catch (e) {
    // Hanya `name`: pesan error fetch di sebagian runtime memuat detail request.
    return { ok: false, reason: 'network', detail: e instanceof Error ? e.name : 'unknown' }
  }
}
