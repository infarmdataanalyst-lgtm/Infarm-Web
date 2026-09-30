// src/lib/xendit/session.ts
// Payment Session Xendit (mode PAYMENT_LINK) — halaman pembayaran yang di-host Xendit.
// SERVER ONLY.
//
// ⚠️ JANGAN pernah diimpor dari komponen 'use client' — modul ini memegang XENDIT_SECRET_KEY
// (lewat lib/xendit/config.ts). Satu-satunya pemanggil yang sah: route handler & modul server.
//
// ── Kenapa Payment Sessions, bukan Invoice API v2 ──
// Invoice API v2 (`POST /v2/invoices`) resmi digolongkan Xendit sebagai LEGACY, dan mulai
// 1 Okt 2026 akun yang masih memakainya dikenai Monthly Maintenance Fee USD 250 (Xendit Pricing
// Policy, diperbarui 14 Sep 2026). Pengganti resminya untuk halaman pembayaran ter-host adalah
// Payment Sessions: `POST /sessions` mode `PAYMENT_LINK` — pembeli tetap memilih metode bayar di
// halaman Xendit, jadi keputusan pemilik proyek 2026-09-18 ("satu tempat memilih, di halaman
// Xendit") tetap berlaku. Migrasi 2026-09-28, sebelum go-live, sehingga tak ada masa transisi.
//
// ── Kenapa BUKAN Payment Requests v3 (`/v3/payment_requests`) ──
// Endpoint itu menuntut `channel_code` DIPILIH SEBELUM permintaan dikirim: pemilih metode bayar,
// halaman nomor VA/QR, dan penanganan REQUIRES_ACTION per kanal harus dibangun sendiri. Itu
// membalik keputusan 2026-09-18 dan menambah ±50% pekerjaan tanpa manfaat bagi pembeli.
//
// ── Pemetaan dari Invoice API ──
//   external_id           → reference_id            (= orders.nomor_invoice, kunci webhook)
//   invoice_duration      → expires_at (ISO 8601)
//   payer_email/customer  → customer + notification_channels ['EMAIL']
//   success/failure_redirect_url → success/cancel_return_url (WAJIB https)
//   id (invoice)          → payment_session_id `ps-…`  (→ orders.id_transaksi)
//   invoice_url           → payment_link_url            (→ orders.invoice_url)
//   expiry_date           → expires_at                  (→ orders.invoice_expires_at)
//   POST /invoices/{id}/expire! → POST /sessions/{id}/cancel
//
// ── reference_id WAJIB `orders.nomor_invoice` ──
// Webhook mencari pesanan dengan `getOrderByOrderId(reference_id)` → `.eq('nomor_invoice', …)`.
// Mengisinya dengan `orders.id` (UUID) akan membuat SETIAP callback gagal menemukan pesanannya,
// dan pembayaran tak pernah tercatat meski uangnya masuk.
//
// ── Nominal ──
// `amount` = `orders.jumlah_total` apa adanya (INTEGER rupiah). Xendit IDR tak memakai sen, jadi
// TIDAK ADA pengalian 100. Selalu dari DB, tak pernah dari client.

// Gagalkan BUILD bila modul ini pernah tertarik ke bundle komponen client (SEC-050).
// Berkas ini memegang XENDIT_SECRET_KEY; ia tak boleh sampai ke browser dalam keadaan apa pun.
import 'server-only'

import { xenditCredentials, xenditUrl } from '@/lib/xendit/config'
import { asString, describeXenditError, potong, xenditErrorCode } from '@/lib/xendit/util'
import { toE164Phone } from '@/lib/phone'
import type { Order } from '@/types/order'

const LOG = '[xendit-session]'

// Path Payment Sessions. TANPA prefiks versi — berbeda dari `/v3/payment_requests`; Sessions
// memang berjalan di atas objek Payments v3 (payment_request `pr-`, payment `py-`) tapi
// path-nya sendiri polos. Dicocokkan dengan referensi API Xendit (apidocs/create-session,
// get-session, cancel-session) 2026-09-28.
const SESSION_PATH = '/sessions'

// Batas waktu panggilan. Berjalan di dalam permintaan checkout, jadi pembeli menunggu.
const REQUEST_TIMEOUT_MS = 12_000

// Umur sesi pembayaran. Sengaja pendek: pesanan yang menunggu bayar MENAHAN STOK (checkout sudah
// memotongnya), jadi sesi berumur panjang = stok terkunci tanpa uang masuk. Saat kedaluwarsa,
// Xendit mengirim `payment_session.expired` → webhook membatalkan pesanan & mengembalikan stok.
// Penyapu cron (expire-orders) memakai angka yang SAMA untuk tenggatnya.
//
// ⚠️ UNVERIFIED: dokumentasi hanya menyebut minimum 10 menit, bawaan 30 menit, dan "tidak boleh
// melebihi durasi maksimum" tanpa menyebut angkanya. Bila panggilan pertama ditolak dengan
// `INVALID_EXPIRY_DATE`, angka ini yang harus diturunkan — dan cron ikut menyesuaikan otomatis.
export const SESSION_DURATION_SECONDS = 24 * 60 * 60

// Bahasa halaman pembayaran Xendit (ISO 639-1). Pembeli Infarm berbahasa Indonesia.
const HOSTED_PAGE_LOCALE = 'id'

// Nama env berisi daftar kanal yang boleh tampil di halaman Xendit, dipisah koma, mis.
// `BCA_VIRTUAL_ACCOUNT,QRIS,DANA,OVO,SHOPEEPAY,BRI_DIRECT_DEBIT`.
//
// KOSONG = TIDAK dikirim = semua kanal yang aktif di akun tampil (perilaku Invoice API yang lama,
// dan sumber kebenarannya tetap pengaturan dashboard Xendit). Sengaja opsional: kanal yang
// disebut di sini tapi belum diaktifkan di akun membuat Xendit menolak SELURUH sesi dengan
// `INVALID_PAYMENT_CHANNEL` — checkout mati total karena satu nama salah. Isi hanya bila daftar
// kanal yang aktif di dashboard sudah pasti (kesepakatan 2026-09-28: VA semua bank, QRIS,
// DANA/OVO/ShopeePay, direct debit BRI).
export const ALLOWED_CHANNELS_ENV = 'XENDIT_ALLOWED_CHANNELS'

// Daftar kanal dari env; undefined bila kosong. Diekspor untuk unit test.
export function allowedChannelsFromEnv(raw: string | undefined): string[] | undefined {
  const list = (raw ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
  return list.length > 0 ? [...new Set(list)] : undefined
}

export type XenditSession = {
  sessionId: string // payment_session_id `ps-…` → orders.id_transaksi
  paymentUrl: string // payment_link_url — halaman pembayaran, tujuan redirect pembeli
  amount: number // nominal tagihan (INTEGER rupiah)
  expiresAt: string // ISO 8601
  status: string // ACTIVE | COMPLETED | EXPIRED | CANCELED
}

export type CreateSessionResult =
  | { ok: true; session: XenditSession }
  | { ok: false; reason: CreateSessionFailureReason; detail: string }

export type CreateSessionFailureReason =
  | 'not-configured' // XENDIT_SECRET_KEY belum di-set
  | 'blocked-environment' // kunci LIVE dipakai di luar deployment produksi (penjaga uang)
  | 'invalid-order' // data pesanan tak cukup
  | 'http-error' // Xendit menolak
  | 'no-session-url' // respons tanpa payment_link_url
  | 'network' // timeout / jaringan

// Deskripsi yang tampil di halaman pembayaran Xendit & email notifikasi ke pembeli.
function buildDescription(order: Order): string {
  const count = order.items.length
  return `Pembayaran pesanan ${order.orderId} (${count} produk) — infarm.id`
}

// === Payload ===

export type SessionPayloadOptions = {
  now?: Date
  allowedChannels?: string[]
  durationSeconds?: number
}

// Menyusun badan `POST /sessions`. MURNI (tanpa I/O) supaya bentuknya bisa diuji tanpa jaringan;
// createXenditSession() yang mengirimkannya.
//
// `origin` = asal URL situs (mis. 'https://infarm.id'). Xendit MEWAJIBKAN https untuk
// `success_return_url`/`cancel_return_url` (`INVALID_URL` bila tidak). Di `next dev` origin-nya
// http://localhost, jadi kedua URL DIHILANGKAN dan pembeli tak dipulangkan otomatis — pembayaran
// tetap tercatat lewat webhook, hanya redirect-nya yang hilang. Itu terbatas ke pengembangan lokal;
// di Vercel (preview maupun produksi) origin selalu https.
export function buildSessionPayload(
  order: Order,
  origin: string,
  opts: SessionPayloadOptions = {},
): Record<string, unknown> {
  const now = opts.now ?? new Date()
  const duration = opts.durationSeconds ?? SESSION_DURATION_SECONDS

  // Kedua return URL menuju halaman yang SAMA. Halaman itu membaca status FRESH dari Supabase,
  // jadi ia menampilkan keadaan sungguhan (Lunas / masih Menunggu / Dibatalkan) tanpa mempercayai
  // parameter redirect — status yang sah hanya datang dari webhook, bukan dari URL yang bisa
  // diketik siapa pun.
  const base = origin.replace(/\/+$/, '')
  const returnUrl = `${base}/checkout/success?invoice=${encodeURIComponent(order.orderId)}`
  const returnUrls = /^https:\/\//i.test(base)
    ? { success_return_url: returnUrl, cancel_return_url: returnUrl }
    : {}

  // Email pembeli — TUJUAN notifikasi. Pesanan BARU selalu punya email: field-nya wajib di checkout
  // dan divalidasi ulang di server (SEC-022). Yang bisa kosong hanya pesanan warisan.
  const payerEmail = order.customerEmail?.trim() ?? ''

  // Nomor telepon dalam format E.164, hanya ikut dititipkan sebagai data kontak bila formatnya
  // sah. Nomor tak valid → field-nya dihilangkan (mengirim mobile_number kosong ditolak Xendit).
  const mobileNumber = order.customerPhone ? toE164Phone(order.customerPhone) : ''

  // `customer.reference_id` WAJIB (terbukti 2026-09-30: tanpanya Xendit membalas 400
  // API_VALIDATION_ERROR "customer must have required property 'reference_id'"). Tapi Xendit
  // menjadikannya kunci unik pelanggan (409 DUPLICATE_ERROR), dan pembeli tamu Infarm tak punya
  // identitas tetap — jadi nilainya dibuat unik PER PERCOBAAN: nomor invoice + cap waktu. Nomor
  // invoice saja tak cukup, karena "Bayar Sekarang" bisa membuat sesi baru untuk pesanan yang sama.
  const customer = payerEmail
    ? {
        customer: {
          reference_id: `${order.orderId}-${now.getTime()}`,
          type: 'INDIVIDUAL',
          email: payerEmail,
          ...(mobileNumber ? { mobile_number: mobileNumber } : {}),
          individual_detail: { given_names: order.customerName.slice(0, 100) },
        },
        // Satu-satunya saluran yang didukung Sessions saat ini. Tanpa email tak ada tujuannya,
        // jadi blok ini digantungkan pada ada-tidaknya email.
        notification_channels: ['EMAIL'],
      }
    : {}

  return {
    reference_id: order.orderId, // = nomor_invoice, kunci pencocokan webhook
    session_type: 'PAY',
    mode: 'PAYMENT_LINK',
    amount: order.totalAmount,
    currency: 'IDR',
    country: 'ID',
    description: buildDescription(order),
    expires_at: new Date(now.getTime() + duration * 1000).toISOString(),
    locale: HOSTED_PAGE_LOCALE,
    ...(opts.allowedChannels && opts.allowedChannels.length > 0
      ? { allowed_payment_channels: opts.allowedChannels }
      : {}),
    ...returnUrls,
    ...customer,
    // `items` SENGAJA tidak dikirim. Jumlah harga item tidak sama dengan `amount` (amount sudah
    // memuat ongkir dan dikurangi diskon), dan daftar item yang tak berjumlah sama dengan tagihan
    // lebih membingungkan pembeli daripada tidak ada daftar sama sekali.
    //
    // Nomor invoice ikut sebagai metadata supaya terbaca di dashboard/laporan Xendit tanpa harus
    // menebak dari reference_id — berguna saat FAT merekonsiliasi.
    metadata: { nomor_invoice: order.orderId },
  }
}

// === Membuat sesi ===

// Membuat Payment Session untuk sebuah pesanan yang SUDAH tersimpan di DB.
//
// `origin` diteruskan dari route handler karena hanya di situ header request tersedia — modul
// ini tak boleh menebak domainnya sendiri.
export async function createXenditSession(order: Order, origin: string): Promise<CreateSessionResult> {
  // Validasi INPUT lebih dulu, kredensial belakangan: galat data pesanan harus dilaporkan apa
  // adanya, bukan tersamar sebagai "belum dikonfigurasi".
  if (!Number.isInteger(order.totalAmount) || order.totalAmount <= 0) {
    return { ok: false, reason: 'invalid-order', detail: `nominal pesanan tidak valid: ${order.totalAmount}` }
  }
  if (!origin) {
    return { ok: false, reason: 'invalid-order', detail: 'origin situs tak diketahui' }
  }

  const credentials = xenditCredentials()
  if (!credentials.ok) {
    console.warn(`${LOG} ${order.orderId} DIBATALKAN — ${credentials.detail}`)
    return { ok: false, reason: credentials.reason, detail: credentials.detail }
  }

  const payload = buildSessionPayload(order, origin, {
    allowedChannels: allowedChannelsFromEnv(process.env[ALLOWED_CHANNELS_ENV]),
  })

  const hasEmail = 'customer' in payload
  console.log(
    `${LOG} membuat sesi ${order.orderId} nominal=${order.totalAmount} email=${hasEmail ? 'ya' : 'TIDAK ADA'} (kunci ${credentials.live ? 'LIVE' : 'test'})`,
  )
  if (!hasEmail) {
    // Bukan kegagalan — sesi tetap dibuat dan tetap bisa dibayar lewat tautannya. Yang hilang
    // hanya notifikasinya.
    console.warn(`${LOG} ${order.orderId} TANPA email — sesi tetap terbit tapi notifikasi tak dikirim ke siapa pun.`)
  }
  if (!('success_return_url' in payload)) {
    console.warn(`${LOG} ${order.orderId} origin bukan https (${origin}) — return URL tak dikirim, pembeli tak dipulangkan otomatis.`)
  }

  try {
    const res = await fetch(xenditUrl(SESSION_PATH), {
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
      // Kode-kode yang berarti KONFIGURASI kita yang salah, bukan gangguan sementara. Disebut
      // eksplisit supaya orang yang membaca log tahu ke mana harus melihat.
      const code = xenditErrorCode(text)
      if (code === 'INVALID_PAYMENT_CHANNEL') {
        console.error(`${LOG} ${ALLOWED_CHANNELS_ENV} memuat kanal yang tak aktif di akun Xendit — kosongkan env itu atau samakan dengan dashboard.`)
      } else if (code === 'INVALID_EXPIRY_DATE') {
        console.error(`${LOG} SESSION_DURATION_SECONDS (${SESSION_DURATION_SECONDS}) ditolak Xendit — turunkan angkanya di lib/xendit/session.ts.`)
      }
      return { ok: false, reason: 'http-error', detail: describeXenditError(res.status, text) }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return { ok: false, reason: 'no-session-url', detail: `respons bukan JSON: ${potong(text, 200)}` }
    }

    const root = parsed as Record<string, unknown>
    const sessionId = asString(root.payment_session_id)
    const paymentUrl = asString(root.payment_link_url)
    if (!sessionId || !paymentUrl) {
      // Tanpa URL, pembeli tak punya tempat membayar; tanpa id, pembayarannya tak bisa dilacak
      // balik ke pesanan. Keduanya wajib — lebih baik gagal terang-terangan.
      return { ok: false, reason: 'no-session-url', detail: `respons tak lengkap: ${potong(text)}` }
    }

    return {
      ok: true,
      session: {
        sessionId,
        paymentUrl,
        amount: order.totalAmount,
        expiresAt: asString(root.expires_at) ?? '',
        status: asString(root.status) ?? 'ACTIVE',
      },
    }
  } catch (e) {
    // Hanya `name`: pesan error fetch di sebagian runtime memuat detail request.
    return { ok: false, reason: 'network', detail: e instanceof Error ? e.name : 'unknown' }
  }
}

// === Membaca sesi ===

export type SessionPayment = {
  /** `payment_request_id` `pr-…` — yang dituntut POST /refunds. */
  paymentRequestId: string
  /** `payment_id` `py-…` — id pembayaran yang tertangkap; kosong bila Xendit tak menyertakannya. */
  paymentId: string
  /** Status sesi: COMPLETED bila sudah dibayar. */
  sessionStatus: string
}

// Membaca satu sesi untuk mendapatkan id PAYMENT REQUEST-nya.
//
// ── Kenapa dibaca saat dibutuhkan, bukan disimpan saat webhook masuk ──
// `orders.id_transaksi` menyimpan id SESI, bukan id payment request. Untuk mengembalikan dana yang
// dibutuhkan adalah `payment_request_id` — nomor berbeda. Pengembalian dana jarang, selalu dimulai
// manusia, dan tak berkejaran dengan apa pun, jadi membaca saat dibutuhkan berarti nilainya selalu
// segar tanpa menuntut kolom baru. Ini panggilan BACA — tak memindahkan uang.
export async function fetchSessionPayment(
  sessionId: string,
): Promise<{ ok: true; payment: SessionPayment } | { ok: false; detail: string }> {
  const id = sessionId.trim()
  if (!id) return { ok: false, detail: 'id sesi kosong' }

  const credentials = xenditCredentials()
  if (!credentials.ok) return { ok: false, detail: credentials.detail }

  try {
    const res = await fetch(xenditUrl(`${SESSION_PATH}/${encodeURIComponent(id)}`), {
      headers: { Authorization: credentials.authHeader },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const text = await res.text()
    if (!res.ok) return { ok: false, detail: describeXenditError(res.status, text) }

    const root = JSON.parse(text) as Record<string, unknown>
    const paymentRequestId = asString(root.payment_request_id)
    const sessionStatus = asString(root.status) ?? ''
    if (!paymentRequestId) {
      // Sesi yang belum dibayar memang tak punya ini — dan tak ada yang perlu dikembalikan.
      return { ok: false, detail: `sesi ${id} tak punya payment_request_id (status ${sessionStatus || '?'})` }
    }

    return {
      ok: true,
      payment: { paymentRequestId, paymentId: asString(root.payment_id) ?? '', sessionStatus },
    }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.name : 'unknown' }
  }
}

// === Membatalkan sesi ===

export type CancelSessionResult =
  | { ok: true; status: string }
  | { ok: false; reason: CancelFailureReason; detail: string }

export type CancelFailureReason =
  | 'not-configured' // XENDIT_SECRET_KEY belum di-set / ditolak penjaga lingkungan
  | 'already-settled' // sesi sudah COMPLETED (dibayar) — tak bisa & tak perlu dibatalkan
  | 'not-found' // id tak dikenal Xendit
  | 'http-error' // ditolak Xendit
  | 'bad-shape' // respons tak terbaca
  | 'network' // timeout / jaringan

// Status sesi yang berarti tautannya SUDAH MATI dengan sendirinya. Membatalkan yang seperti ini
// ditolak Xendit (422), tapi tujuannya — pembeli tak bisa membayar lagi — sudah tercapai.
const SUDAH_MATI = new Set(['EXPIRED', 'CANCELED', 'CANCELLED'])

// Membatalkan sesi Xendit supaya TIDAK BISA dibayar lagi. Dipanggil saat pesanan dibatalkan.
//
// ── Kenapa ini penting, dan kenapa bukan refund ──
// Pembayaran lewat Virtual Account TIDAK BISA di-refund Xendit (terverifikasi 2026-09-10). Uang yang
// terlanjur masuk untuk pesanan yang sudah batal hanya bisa dikembalikan lewat payout BARU ke
// rekening pembeli — menuntut nomor rekening yang tak pernah kita kumpulkan, dan berbiaya.
// Mencegah uang itu masuk jauh lebih murah daripada mengembalikannya: fungsi ini TIDAK memindahkan
// uang, ia menutup pintunya.
//
// ── Hanya sesi ACTIVE yang bisa dibatalkan ──
// Sesi lain dijawab 422 INVALID_SESSION_STATUS. Karena itu penolakan 422 dibaca ulang lewat GET:
// COMPLETED berarti sudah dibayar (dilaporkan `already-settled`, admin perlu memikirkan refund),
// EXPIRED/CANCELED berarti sudah mati sendiri (dilaporkan ok — pintunya memang sudah tertutup).
//
// ── TIDAK menyentuh database ──
// Pemanggil yang menyimpan hasilnya, mengikuti pola createXenditSession() & cancelShipmentOrder().
export async function cancelXenditSession(sessionId: string): Promise<CancelSessionResult> {
  const id = sessionId.trim()
  if (!id) return { ok: false, reason: 'not-found', detail: 'id sesi kosong' }

  // Penjaga lingkungan ada DI DALAM xenditCredentials(): kunci LIVE ditolak di luar deployment
  // produksi. Sengaja dilewati juga di sini meski panggilan ini tak memindahkan uang — membatalkan
  // sesi pembeli SUNGGUHAN dari mesin lokal tetap tak boleh terjadi.
  const credentials = xenditCredentials()
  if (!credentials.ok) {
    console.warn(`${LOG} membatalkan sesi ${id} DIBATALKAN — ${credentials.detail}`)
    return { ok: false, reason: 'not-configured', detail: credentials.detail }
  }

  console.log(`${LOG} membatalkan sesi ${id} (kunci ${credentials.live ? 'LIVE' : 'test'})`)

  try {
    const res = await fetch(xenditUrl(`${SESSION_PATH}/${encodeURIComponent(id)}/cancel`), {
      method: 'POST',
      headers: { Authorization: credentials.authHeader, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const text = await res.text()

    if (res.ok) {
      let status = ''
      try {
        status = asString((JSON.parse(text) as Record<string, unknown>).status) ?? ''
      } catch {
        return { ok: false, reason: 'bad-shape', detail: `respons bukan JSON: ${potong(text, 200)}` }
      }
      console.log(`${LOG} sesi ${id} dibatalkan (status ${status || 'tak disebut'})`)
      return { ok: true, status: status || 'CANCELED' }
    }

    // 404 dibedakan: id tak dikenal berarti ada yang salah pada DATA kita (id_transaksi basi,
    // milik lingkungan Xendit lain, atau invoice lama dari sebelum migrasi ke Sessions), bukan
    // gangguan sementara. Mengulangnya tak menolong.
    if (res.status === 404) return { ok: false, reason: 'not-found', detail: describeXenditError(res.status, text) }

    if (res.status === 422 && xenditErrorCode(text) === 'INVALID_SESSION_STATUS') {
      // Ditolak karena bukan ACTIVE. Statusnya dibaca supaya jawabannya jujur: sudah dibayar
      // (masalah) atau sudah mati sendiri (bukan masalah).
      const current = await readSessionStatus(id, credentials.authHeader)
      if (current === 'COMPLETED') {
        return { ok: false, reason: 'already-settled', detail: 'sesi berstatus COMPLETED — sudah dibayar, tak bisa dibatalkan' }
      }
      if (current && SUDAH_MATI.has(current)) {
        console.log(`${LOG} sesi ${id} sudah ${current} — tak perlu dibatalkan`)
        return { ok: true, status: current }
      }
      return { ok: false, reason: 'http-error', detail: `${describeXenditError(res.status, text)} (status sesi: ${current || 'tak terbaca'})` }
    }

    return { ok: false, reason: 'http-error', detail: describeXenditError(res.status, text) }
  } catch (e) {
    // Hanya `name`: pesan error fetch di sebagian runtime memuat detail request.
    return { ok: false, reason: 'network', detail: e instanceof Error ? e.name : 'unknown' }
  }
}

// Status sesi saat ini, atau '' bila tak terbaca. Hanya untuk melengkapi penolakan pembatalan.
async function readSessionStatus(id: string, authHeader: string): Promise<string> {
  try {
    const res = await fetch(xenditUrl(`${SESSION_PATH}/${encodeURIComponent(id)}`), {
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) return ''
    const root = JSON.parse(await res.text()) as Record<string, unknown>
    return (asString(root.status) ?? '').toUpperCase()
  } catch {
    return ''
  }
}
