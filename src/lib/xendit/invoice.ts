// src/lib/xendit/invoice.ts
// Pembuatan Invoice Xendit (Invoice API v2) — halaman pembayaran yang di-host Xendit.
// SERVER ONLY.
//
// ⚠️ JANGAN pernah diimpor dari komponen 'use client' — modul ini memegang XENDIT_SECRET_KEY
// (lewat lib/xendit/config.ts). Satu-satunya pemanggil yang sah: route handler.
//
// ── Kenapa Invoice API, bukan Payment Request v3 ──
// Keputusan pemilik proyek 2026-08-21: pembeli dibawa ke halaman pembayaran Xendit yang sudah
// menyediakan SEMUA metode (VA, e-wallet, QRIS, retail) tanpa kita membangun UI apa pun. Jalur
// Payment Request / Virtual Account (`lib/xendit/payment-request.ts`) TIDAK dihapus tapi kini tak
// dipakai checkout — lihat ROADMAP.md.
//
// ── external_id WAJIB `orders.nomor_invoice` ──
// Webhook mencari pesanan dengan `getOrderByOrderId(external_id)` → `.eq('nomor_invoice', …)`.
// Mengisinya dengan `orders.id` (UUID) akan membuat SETIAP callback gagal menemukan pesanannya,
// dan pembayaran tak pernah tercatat meski uangnya masuk.
//
// ── Nominal ──
// `amount` = `orders.jumlah_total` apa adanya (INTEGER rupiah). Xendit IDR tak memakai sen, jadi
// TIDAK ADA pengalian 100. Selalu dari DB, tak pernah dari client.

import { xenditCredentials, xenditUrl } from '@/lib/xendit/config'
import { toE164Phone } from '@/lib/phone'
import type { Order } from '@/types/order'

const LOG = '[xendit-invoice]'

// Path Invoice API. Berbeda dari Payment Request: versinya ada di path (`/v2/`).
const INVOICE_PATH = '/v2/invoices'

// Batas waktu panggilan. Berjalan di dalam permintaan checkout, jadi pembeli menunggu.
const REQUEST_TIMEOUT_MS = 12_000

// Umur invoice. Sengaja pendek: pesanan yang menunggu bayar MENAHAN STOK (checkout sudah
// memotongnya), jadi invoice berumur panjang = stok terkunci tanpa uang masuk. Saat kedaluwarsa,
// Xendit mengirim callback EXPIRED → webhook membatalkan pesanan & mengembalikan stok.
export const INVOICE_DURATION_SECONDS = 24 * 60 * 60

// Saluran notifikasi ke pembeli.
//
// EMAIL, bukan lagi WhatsApp. Alasan lama ("field email sudah dihapus dari form checkout,
// orders.email NULL untuk semua pesanan baru") sudah TIDAK BERLAKU: email kembali menjadi field
// WAJIB di checkout dan kini justru menjadi kunci utama pembeli tamu — lacak pesanan, ulasan, dan
// pembatalan semuanya dicari lewat email. Saluran WhatsApp juga tak lagi dipakai di akun Xendit
// project ini.
//
// ⚠️ Nilai `customer_notification_preference` yang dikirim per-invoice MENIMPA setelan Dashboard
// Xendit. Mengganti saluran di dashboard saja tidak berpengaruh selama konstanta ini berkata lain.
//
// Nilai yang SAH hanya: 'email' | 'sms' | 'whatsapp' | 'viber' (huruf kecil). Diverifikasi
// terhadap enum NotificationChannel di SDK resmi xendit-php & xendit-go, yang di-generate dari
// spesifikasi OpenAPI Xendit. Jangan menulis 'Email' atau 'EMAIL'.
const NOTIFICATION_CHANNELS = ['email'] as const

export type XenditInvoice = {
  invoiceId: string // id invoice di Xendit → orders.id_transaksi
  invoiceUrl: string // halaman pembayaran, tujuan redirect pembeli
  amount: number // nominal tagihan (INTEGER rupiah)
  expiryDate: string // ISO 8601
  status: string // status invoice dari Xendit (mis. 'PENDING')
}

export type CreateInvoiceResult =
  | { ok: true; invoice: XenditInvoice }
  | { ok: false; reason: CreateInvoiceFailureReason; detail: string }

export type CreateInvoiceFailureReason =
  | 'not-configured' // XENDIT_SECRET_KEY belum di-set
  | 'blocked-environment' // kunci LIVE dipakai di luar deployment produksi (penjaga uang)
  | 'invalid-order' // data pesanan tak cukup
  | 'http-error' // Xendit menolak
  | 'no-invoice-url' // respons tanpa invoice_url
  | 'network' // timeout / jaringan

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined
}

// Deskripsi yang tampil di halaman pembayaran Xendit & email notifikasi ke pembeli.
function buildDescription(order: Order): string {
  const count = order.items.length
  return `Pembayaran pesanan ${order.orderId} (${count} produk) — infarm.id`
}

// Pesan error Xendit untuk LOG (bukan untuk client).
// Xendit membalas { error_code, message }. `error_code` sangat berguna di sini: mis.
// 'API_VALIDATION_ERROR' akan menyebut field mana yang ditolak.
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

// Membuat Invoice Xendit untuk sebuah pesanan yang SUDAH tersimpan di DB.
//
// `origin` = asal URL situs kita (mis. 'https://infarm-web-mu.vercel.app'), dipakai menyusun
// success/failure redirect. Diteruskan dari route handler karena hanya di situ header request
// tersedia — modul ini tak boleh menebak domainnya sendiri.
export async function createXenditInvoice(
  order: Order,
  origin: string,
): Promise<CreateInvoiceResult> {
  // Validasi INPUT lebih dulu, kredensial belakangan: galat data pesanan harus dilaporkan apa
  // adanya, bukan tersamar sebagai "belum dikonfigurasi".
  if (!Number.isInteger(order.totalAmount) || order.totalAmount <= 0) {
    return {
      ok: false,
      reason: 'invalid-order',
      detail: `nominal pesanan tidak valid: ${order.totalAmount}`,
    }
  }
  if (!origin) {
    return { ok: false, reason: 'invalid-order', detail: 'origin situs tak diketahui' }
  }

  const credentials = xenditCredentials()
  if (!credentials.ok) {
    console.warn(`${LOG} ${order.orderId} DIBATALKAN — ${credentials.detail}`)
    return { ok: false, reason: credentials.reason, detail: credentials.detail }
  }

  // Kedua redirect menuju halaman yang SAMA. Halaman itu membaca status FRESH dari Supabase, jadi
  // ia menampilkan keadaan sungguhan (Lunas / masih Menunggu / Dibatalkan) tanpa mempercayai
  // parameter redirect — status yang sah hanya datang dari webhook, bukan dari URL yang bisa
  // diketik siapa pun.
  const returnUrl = `${origin.replace(/\/+$/, '')}/checkout/success?invoice=${encodeURIComponent(order.orderId)}`

  // Email pembeli — TUJUAN notifikasi invoice. Kosong → blok notifikasi tak dikirim sama sekali
  // (lihat di bawah), karena meminta Xendit mengirim email tanpa memberi alamatnya hanya
  // menghasilkan invoice yang notifikasinya menguap tanpa jejak.
  //
  // Pesanan BARU selalu punya email: field-nya wajib di checkout dan divalidasi ulang di server
  // (SEC-022). Yang bisa kosong hanya pesanan warisan sebelum email dikembalikan ke form.
  const payerEmail = order.customerEmail?.trim() ?? ''

  // Nomor telepon dalam format E.164. TIDAK lagi menentukan apa pun soal notifikasi — hanya ikut
  // dititipkan ke Xendit sebagai data kontak bila formatnya sah. Nomor tak valid → field-nya
  // dihilangkan (mengirim mobile_number kosong ditolak Xendit).
  const mobileNumber = order.customerPhone ? toE164Phone(order.customerPhone) : ''

  const payload = {
    external_id: order.orderId, // = nomor_invoice, kunci pencocokan webhook
    amount: order.totalAmount,
    currency: 'IDR',
    description: buildDescription(order),
    invoice_duration: INVOICE_DURATION_SECONDS,
    success_redirect_url: returnUrl,
    failure_redirect_url: returnUrl,
    // `items` SENGAJA tidak dikirim. Jumlah harga item tidak sama dengan `amount` (amount sudah
    // memuat ongkir dan dikurangi diskon, sementara ongkir tak punya kolom tersendiri di tabel
    // orders), dan daftar item yang tak berjumlah sama dengan tagihan lebih membingungkan pembeli
    // daripada tidak ada daftar sama sekali.
    //
    // ── Alamat email dikirim DUA KALI, dan itu disengaja ──
    // `payer_email` (field tingkat atas, warisan Invoice API v1 yang masih didukung v2) dan
    // `customer.email`. Keduanya didokumentasikan Xendit sebagai sumber alamat notifikasi, dan
    // mana yang benar-benar dipakai berbeda antar versi API. Mengirim keduanya dengan nilai yang
    // sama menghilangkan pertanyaan itu tanpa risiko: tak ada konflik yang mungkin terjadi.
    ...(payerEmail
      ? {
          payer_email: payerEmail,
          // `should_send_email` SENGAJA TIDAK DIKIRIM. Field itu memang ada di CreateInvoiceRequest,
          // tetapi panggilan manual yang TERBUKTI mengirim email ke inbox pemilik proyek
          // (2026-09-04) tidak menyertakannya sama sekali. Menambahkannya berarti menyimpang dari
          // payload yang sudah terbukti, demi field yang nilai bawaannya pun tak dinyatakan
          // dokumentasi — risiko tanpa manfaat. Jangan tambahkan tanpa pengujian ulang.
          customer: {
            given_names: order.customerName.slice(0, 100),
            email: payerEmail,
            // Nomor hanya disertakan bila formatnya sah — lihat catatan di atas.
            ...(mobileNumber ? { mobile_number: mobileNumber } : {}),
          },
          // Catatan soal `invoice_expired`: SDK resmi Xendit (xendit-php & xendit-go, keduanya
          // di-generate dari spesifikasi OpenAPI) HANYA memuat invoice_created, invoice_reminder,
          // dan invoice_paid — invoice_expired tak ada di sana. TETAPI panggilan manual yang
          // terbukti bekerja menyertakannya dan API menerimanya tanpa keluhan.
          //
          // Ia dipertahankan karena dua hal itu tidak bertentangan: field yang tak dikenal
          // umumnya diabaikan diam-diam, jadi paling buruk ia tak berefek — sementara bila ia
          // memang dilayani, pembeli mendapat kabar saat invoicenya kedaluwarsa dan pesanannya
          // otomatis dibatalkan. Menghapusnya menukar manfaat yang mungkin dengan kerapian yang
          // tak ada gunanya.
          customer_notification_preference: {
            invoice_created: NOTIFICATION_CHANNELS,
            invoice_reminder: NOTIFICATION_CHANNELS,
            invoice_paid: NOTIFICATION_CHANNELS,
            invoice_expired: NOTIFICATION_CHANNELS,
          },
        }
      : {}),
    // ⚠️ Bila Xendit menolak salah satu field di atas, `describeXenditError()` menampilkan
    // `error_code` + `message` apa adanya di log (mis. API_VALIDATION_ERROR beserta nama
    // field-nya) — bukan tersembunyi sebagai kegagalan generik.
  }

  console.log(
    `${LOG} membuat invoice ${order.orderId} nominal=${order.totalAmount} email=${payerEmail ? 'ya' : 'TIDAK ADA'} (kunci ${credentials.live ? 'LIVE' : 'test'})`,
  )
  if (!payerEmail) {
    // Bukan kegagalan — invoice tetap dibuat dan tetap bisa dibayar lewat tautannya. Yang hilang
    // hanya notifikasinya. Diberi peringatan eksplisit supaya tidak terlihat seperti Xendit yang
    // bermasalah saat pembeli mengeluh tak menerima tagihan.
    console.warn(
      `${LOG} ${order.orderId} TANPA email — invoice tetap terbit tapi notifikasi tak dikirim ke siapa pun.`,
    )
  }

  try {
    const res = await fetch(xenditUrl(INVOICE_PATH), {
      method: 'POST',
      headers: {
        // Secret key ada di header, BUKAN di URL — jadi URL aman dicatat, header ini tidak.
        Authorization: credentials.authHeader,
        'Content-Type': 'application/json',
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
      return {
        ok: false,
        reason: 'no-invoice-url',
        detail: `respons bukan JSON: ${text.slice(0, 200)}`,
      }
    }

    const root = parsed as Record<string, unknown>
    const invoiceId = asString(root.id)
    const invoiceUrl = asString(root.invoice_url)
    if (!invoiceId || !invoiceUrl) {
      // Tanpa URL, pembeli tak punya tempat membayar; tanpa id, pembayarannya tak bisa dilacak
      // balik ke pesanan. Keduanya wajib — lebih baik gagal terang-terangan.
      return {
        ok: false,
        reason: 'no-invoice-url',
        detail: `respons tak lengkap: ${text.slice(0, 300)}`,
      }
    }

    return {
      ok: true,
      invoice: {
        invoiceId,
        invoiceUrl,
        amount: order.totalAmount,
        expiryDate: asString(root.expiry_date) ?? '',
        status: asString(root.status) ?? 'PENDING',
      },
    }
  } catch (e) {
    // Hanya `name`: pesan error fetch di sebagian runtime memuat detail request.
    return { ok: false, reason: 'network', detail: e instanceof Error ? e.name : 'unknown' }
  }
}
