// src/lib/xendit/ewallet-refund.ts
// Mengembalikan dana pembayaran E-WALLET ke sumbernya. SERVER ONLY (memegang XENDIT_SECRET_KEY).
//
// ⚠️ INI MEMINDAHKAN UANG SUNGGUHAN. Berbeda dari seluruh panggilan Xendit lain di project ini
// (membuat tagihan, mematikan tagihan, membaca invoice), yang ini mengirim uang keluar dan TIDAK
// BISA ditarik kembali. Satu-satunya pemanggil yang sah: route handler ber-requireAdminRole.
//
// ── Kenapa eWallets API, bukan POST /refunds ──
// `POST /refunds` (Payments API v3) menuntut `payment_request_id` berformat `pr-<uuid>`. Terukur
// 2026-09-10: invoice yang dibayar lewat Invoice API v2 TIDAK PERNAH menghasilkannya — baik untuk
// transfer bank maupun e-wallet. Tebakan `pr-` + payment_id dijawab 404 DATA_NOT_FOUND.
//
// Yang diberikan objek invoice adalah `payment_id` berawalan `ewc_` — id eWallet Charge, dan
// eWallets API punya endpoint pengembalian dananya sendiri yang menerima id itu. Dokumentasi
// Xendit menyatakan eksplisit bahwa keduanya berlaku untuk "payment made through Invoice".
//
// ── Transfer bank TIDAK BISA sama sekali ──
// Bukan "belum dibangun" — Xendit memang tak menyediakannya, tidak lewat API maupun dashboard.
// Pengembaliannya adalah transfer BARU ke rekening pembeli. Modul ini menolak dipanggil untuk
// pembayaran non-e-wallet supaya kekeliruan itu berhenti di sini, bukan di respons Xendit yang
// membingungkan.
//
// ── Dua endpoint, dan yang benar tergantung TANGGAL ──
//   void    hari yang SAMA (T+0, cutoff 23:50 WIB) · hanya penuh · hampir seketika · tanpa body
//   refunds H+1 dan seterusnya · penuh atau sebagian · ~1 hari kerja
// Salah pilih ditolak Xendit. Pembatalan paling sering terjadi di hari yang sama, jadi `void`
// justru jalur yang paling sering dipakai — padahal `refunds` yang lebih dulu terpikir.

import { xenditCredentials, xenditUrl } from '@/lib/xendit/config'

const LOG = '[xendit-ewallet-refund]'

const REQUEST_TIMEOUT_MS = 15_000

// Batas waktu `void` menurut Xendit: 23:50 waktu setempat pada hari pembayaran.
// Disisakan margin 10 menit dari cutoff — permintaan yang dikirim pukul 23:49 bisa saja tiba
// setelah 23:50, dan ditolak. Lebih baik memakai `refunds` yang tetap berhasil.
const VOID_CUTOFF_HHMM = 23 * 60 + 40

// Charge id eWallet selalu berawalan ini. Dipakai sebagai pagar terakhir: id transfer bank atau
// invoice id yang tersasar ke sini akan berhenti sebelum menyentuh jaringan.
const EWALLET_CHARGE_PREFIX = 'ewc_'

export type RefundMethod = 'void' | 'refunds'

export type EwalletRefundResult =
  | { ok: true; method: RefundMethod; reference: string; status: string; raw: string }
  | { ok: false; reason: EwalletRefundFailure; detail: string; method?: RefundMethod }

export type EwalletRefundFailure =
  | 'not-configured' // env belum lengkap / kunci LIVE di luar produksi
  | 'not-ewallet' // charge id bukan ewc_ → jalur ini tak berlaku
  | 'http-error' // ditolak Xendit
  | 'bad-shape' // respons tak terbaca
  | 'network' // timeout / jaringan

// Tanggal & menit dalam sehari menurut Asia/Jakarta. Zona WIB dipakai eksplisit karena server
// berjalan di UTC (Vercel) — memakai waktu server akan menggeser batas hari sampai 7 jam, dan
// tepat di sekitar batas itulah pilihan void/refunds berubah.
function jakarta(ms: number): { tanggal: string; menit: number } {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
  return {
    tanggal: `${p.year}-${p.month}-${p.day}`,
    menit: Number(p.hour) * 60 + Number(p.minute),
  }
}

// Endpoint mana yang berlaku untuk pembayaran pada `paidAtIso`, dilihat dari `nowMs`.
//
// `paidAtIso` tak terbaca → 'refunds'. Menolak-dengan-aman: `refunds` berlaku untuk rentang waktu
// yang jauh lebih luas, sedangkan `void` hanya sah beberapa jam. Menebak `void` saat waktunya tak
// diketahui berarti gagal pada hampir semua kasus.
export function pilihMetode(paidAtIso: string | undefined, nowMs = Date.now()): RefundMethod {
  if (!paidAtIso) return 'refunds'
  const paidMs = Date.parse(paidAtIso)
  if (Number.isNaN(paidMs)) return 'refunds'

  const bayar = jakarta(paidMs)
  const sekarang = jakarta(nowMs)
  if (bayar.tanggal !== sekarang.tanggal) return 'refunds'
  return sekarang.menit < VOID_CUTOFF_HHMM ? 'void' : 'refunds'
}

function potong(text: string, n = 300): string {
  return text.length > n ? `${text.slice(0, n)}…` : text
}

export type EwalletRefundInput = {
  chargeId: string // `payment_id` dari objek invoice, berawalan ewc_
  method: RefundMethod
  amount?: number // hanya dipakai `refunds`; dikosongkan = penuh
  reason?: string
  // Kunci idempotency (header X-IDEMPOTENCY-KEY). Xendit menjawab permintaan berkunci sama dengan
  // hasil yang SAMA alih-alih memproses ulang — jaring kedua di bawah klaim database, untuk kasus
  // permintaannya terkirim dua kali di luar kendali kita (retry platform, browser mengirim ulang).
  // Kuncinya = referensi klaim, jadi satu klaim tak akan pernah menjadi dua transfer.
  idempotencyKey?: string
}

// Menjalankan pengembalian dana. TIDAK menyentuh database — pemanggil yang menyimpan hasilnya.
export async function refundEwalletCharge(
  input: EwalletRefundInput,
): Promise<EwalletRefundResult> {
  const id = input.chargeId.trim()
  if (!id.startsWith(EWALLET_CHARGE_PREFIX)) {
    return {
      ok: false,
      reason: 'not-ewallet',
      detail: `charge id "${id.slice(0, 20)}" bukan eWallet (harus berawalan ${EWALLET_CHARGE_PREFIX}). Pembayaran transfer bank tak bisa dikembalikan lewat Xendit.`,
    }
  }

  const credentials = xenditCredentials()
  if (!credentials.ok) {
    console.warn(`${LOG} DIBATALKAN — ${credentials.detail}`)
    return { ok: false, reason: 'not-configured', detail: credentials.detail }
  }

  const path = `/ewallets/charges/${encodeURIComponent(id)}/${input.method}`

  // `void` WAJIB tanpa body — dokumentasi Xendit menyatakannya eksplisit. `refunds` menerima
  // body opsional; dikirim hanya bila ada isinya, supaya permintaan penuh tetap berbentuk
  // paling sederhana.
  const body =
    input.method === 'refunds'
      ? {
          ...(typeof input.amount === 'number' ? { amount: Math.round(input.amount) } : {}),
          ...(input.reason ? { reason: input.reason } : {}),
        }
      : null

  console.log(
    `${LOG} ${input.method} untuk ${id} (kunci ${credentials.live ? 'LIVE' : 'test'}${
      body && Object.keys(body).length > 0 ? `, ${JSON.stringify(body)}` : ''
    })`,
  )

  try {
    const res = await fetch(xenditUrl(path), {
      method: 'POST',
      headers: {
        Authorization: credentials.authHeader,
        'Content-Type': 'application/json',
        ...(input.idempotencyKey ? { 'X-IDEMPOTENCY-KEY': input.idempotencyKey } : {}),
      },
      ...(body && Object.keys(body).length > 0 ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const text = await res.text()

    if (!res.ok) {
      return {
        ok: false,
        reason: 'http-error',
        detail: potong(text),
        method: input.method,
      }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      // Uang MUNGKIN sudah terkirim (HTTP 200) tapi kita tak bisa memastikan apa pun dari
      // responsnya. Dilaporkan gagal supaya admin memeriksa dashboard — bukan dicatat berhasil
      // dengan referensi karangan.
      return {
        ok: false,
        reason: 'bad-shape',
        detail: `HTTP 200 tapi respons bukan JSON: ${potong(text, 200)}`,
        method: input.method,
      }
    }

    const root = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<
      string,
      unknown
    >
    const reference =
      (typeof root.id === 'string' && root.id) ||
      (typeof root.refund_id === 'string' && root.refund_id) ||
      ''
    const status = typeof root.status === 'string' ? root.status : ''

    console.log(`${LOG} ${input.method} ${id} → ${status || 'tanpa status'} ref=${reference || '-'}`)
    return {
      ok: true,
      method: input.method,
      reference,
      status: status || 'SUCCEEDED',
      raw: potong(text),
    }
  } catch (e) {
    // Hanya `name`: pesan error fetch di sebagian runtime memuat detail request.
    //
    // ⚠️ Timeout di sini TIDAK berarti uangnya tak terkirim — permintaannya bisa saja sampai dan
    // diproses setelah kita berhenti menunggu. Pemanggil WAJIB memperlakukan ini sebagai
    // "tidak diketahui" dan menyuruh admin memeriksa dashboard, bukan mengulang panggilannya.
    return {
      ok: false,
      reason: 'network',
      detail: e instanceof Error ? e.name : 'unknown',
      method: input.method,
    }
  }
}
