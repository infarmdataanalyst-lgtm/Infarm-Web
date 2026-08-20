// src/lib/mengantar-pickup.ts
// Jadwal pickup Mengantar: SATU PINTU pengambilan `time_id` untuk booking kurir.
// SERVER ONLY — memegang MENGANTAR_API_KEY & MENGANTAR_STORE_ADDRESS_ID. Jangan pernah diimpor
// dari komponen 'use client'; api key tidak boleh sampai ke bundel browser.
//
// ── Kenapa ada tabel perantara, bukan panggil POST /time per transaksi ──
// Booking kurir butuh `time_id` yang mewakili slot penjemputan. Satu slot dipakai untuk SEMUA
// paket hari itu, jadi memanggil POST /time tiap checkout berarti: satu round-trip API tambahan di
// jalur bayar, kuota terbuang, dan satu titik gagal baru tepat saat pembeli menekan bayar.
// Cron harian membuatnya sekali; checkout hanya membaca baris DB.
//
// ── Tiga jebakan kontrak API Mengantar ──
// 1. API KEY ADA DI DALAM URL, bukan header: {BASE}/api/public/{API_KEY}/time. Konsekuensinya URL
//    ini RAHASIA — jangan pernah menuliskannya ke log, pesan error, atau respons. Semua log di
//    bawah hanya menyebut tanggal & status, tak pernah URL-nya.
// 2. Tanggal berformat MM-DD-YYYY (gaya AS), bukan ISO. Dikonversi lewat toMengantarDate().
// 3. Nama field `time_id` di respons belum dipastikan (contoh curl tak menyertakan responsnya),
//    jadi extractTimeId sengaja toleran terhadap beberapa penamaan.

import { getPickupByDate, savePickup, type DailyPickup } from '@/lib/mock-db/pickup'
import {
  PICKUP_TIME_HHMM,
  isPickupDay,
  parsePickupDate,
  resolvePickupDate,
  toMengantarDate,
  type PickupDateReason,
} from '@/lib/pickup-schedule'

const LOG = '[mengantar-pickup]'

// Batas waktu panggilan ke Mengantar. Ketat karena dua alasan:
//   1. Jalur fallback berjalan DI DALAM permintaan checkout — pembeli tak boleh menunggu lama
//      hanya untuk penjadwalan pickup.
//   2. Fungsi serverless Vercel punya anggaran waktu sendiri (10 detik di paket Hobby tanpa
//      penyesuaian `maxDuration`). Timeout 10 detik akan MENGHABISKAN seluruh anggaran itu dan
//      fungsinya dimatikan sebelum bisa menulis hasilnya ke DB, jadi disisakan ruang untuk
//      round-trip Supabase.
const TIME_REQUEST_TIMEOUT_MS = 8_000

// Menyusun URL endpoint publik Mengantar. API key jadi SEGMEN PATH, bukan header —
// karena itu nilai kembaliannya rahasia dan tak boleh masuk log.
// encodeURIComponent dipakai supaya key yang memuat karakter aneh tak merusak bentuk path
// (key saat ini "API-XXXX", tapi jangan bergantung pada format itu).
function publicEndpoint(base: string, apiKey: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/api/public/${encodeURIComponent(apiKey)}/${path}`
}

// === Panggilan ke Mengantar ===

export type CreateTimeResult =
  | { ok: true; timeId: string }
  | {
      ok: false
      reason: 'not-configured' | 'http-error' | 'no-time-id' | 'network'
      detail?: string
    }

// Membaca time_id dari respons POST /time.
//
// Bentuk respons SUDAH TERVERIFIKASI terhadap sandbox:
//   { success: true, data: { _id: "<24 hex>", date: "2026-08-20T00:00:00.000Z", time: "17:00",
//                            status: "empty", isSunday: false, address: {...}, ... } }
// Jadi time_id = `data._id` — Mengantar TIDAK memakai nama field `time_id` di responsnya, meski
// field itulah yang diminta saat create order. `data._id` dicoba lebih dulu; sisanya cadangan
// bila suatu saat bentuknya berubah.
//
// null bila tak satu pun cocok — lebih baik gagal terang-terangan daripada menyimpan string
// kosong sebagai time_id dan baru ketahuan saat booking kurir ditolak.
function extractTimeId(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>
  const nested =
    typeof b.data === 'object' && b.data !== null ? (b.data as Record<string, unknown>) : {}
  const candidates = [
    nested._id, // bentuk terverifikasi
    nested.time_id,
    nested.timeId,
    nested.id,
    b.time_id,
    b.timeId,
    b._id,
    b.id,
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c.trim()
  }
  return null
}

// Meminta slot pickup baru ke Mengantar untuk satu tanggal. TIDAK menyentuh DB — pemisahan ini
// membuat pemanggil yang menyimpan hasilnya bisa memutuskan sendiri apa yang dilakukan saat gagal.
export async function createPickupTime(date: string): Promise<CreateTimeResult> {
  const base = process.env.MENGANTAR_BASE_URL
  const key = process.env.MENGANTAR_API_KEY
  const addressId = process.env.MENGANTAR_STORE_ADDRESS_ID

  if (!base || !key || !addressId) {
    // Salah konfigurasi KITA, bukan gangguan Mengantar — dibedakan agar log tak menyesatkan.
    return { ok: false, reason: 'not-configured' }
  }

  // Tanggal WAJIB dikonversi ke MM-DD-YYYY. Gagal konversi = tanggal tak valid; berhenti di sini
  // daripada mengirim tanggal yang bisa ditafsirkan Mengantar sebagai hari lain.
  const mengantarDate = toMengantarDate(date)
  if (!mengantarDate) {
    return { ok: false, reason: 'not-configured', detail: `tanggal tak valid: ${date}` }
  }

  try {
    const res = await fetch(publicEndpoint(base, key, 'time'), {
      method: 'POST',
      // TANPA header auth: kredensialnya ada di path (lihat publicEndpoint).
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address_id: addressId,
        date: mengantarDate,
        time: PICKUP_TIME_HHMM,
      }),
      signal: AbortSignal.timeout(TIME_REQUEST_TIMEOUT_MS),
    })

    const text = await res.text()
    if (!res.ok) {
      return { ok: false, reason: 'http-error', detail: `${res.status} ${text.slice(0, 200)}` }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return { ok: false, reason: 'no-time-id', detail: `respons bukan JSON: ${text.slice(0, 120)}` }
    }

    // Mengantar membawa flag `success` di body. HTTP 200 dengan success:false berarti permintaan
    // ditolak secara logis (mis. address_id tak dikenal) — jangan diperlakukan sebagai berhasil
    // hanya karena status HTTP-nya 200.
    if (typeof parsed === 'object' && parsed !== null) {
      const s = (parsed as Record<string, unknown>).success
      if (s === false) {
        return { ok: false, reason: 'http-error', detail: `success=false ${text.slice(0, 200)}` }
      }
    }

    const timeId = extractTimeId(parsed)
    if (!timeId) return { ok: false, reason: 'no-time-id', detail: text.slice(0, 200) }
    return { ok: true, timeId }
  } catch (e) {
    // Timeout / DNS / jaringan. Detail tak pernah memuat api key: key hanya ada di header,
    // tak pernah di URL, jadi pesan error tak bisa membocorkannya.
    return { ok: false, reason: 'network', detail: e instanceof Error ? e.name : 'unknown' }
  }
}

// === Generate & simpan (dipakai cron) ===

export type EnsurePickupOutcome =
  | { status: 'existing'; pickup: DailyPickup } // sudah ada → Mengantar tak dipanggil
  | { status: 'created'; pickup: DailyPickup }
  | { status: 'raced'; pickup: DailyPickup } // dibuat pemanggil lain saat kita menulis
  | { status: 'skipped-non-pickup-day' }
  | { status: 'failed'; reason: string }

// Memastikan sebuah tanggal punya time_id. Idempoten — inilah yang membuat cron aman di-run ulang.
//
// Urutan disengaja: BACA DULU, baru panggil Mengantar. Kalau dibalik, setiap re-run cron membuat
// slot pickup baru di sisi Mengantar (sampah di sistem kurir) meski barisnya sudah ada di DB kita.
export async function ensurePickupForDate(date: string): Promise<EnsurePickupOutcome> {
  if (parsePickupDate(date) === null) {
    return { status: 'failed', reason: `format tanggal tidak valid: ${date}` }
  }
  if (!isPickupDay(date)) {
    // Minggu: tak ada penjemputan, jadi tak ada slot yang perlu dibuat.
    return { status: 'skipped-non-pickup-day' }
  }

  const existing = await getPickupByDate(date)
  if (existing) {
    console.log(`${LOG} ${date} sudah ada time_id — dilewati (idempoten)`)
    return { status: 'existing', pickup: existing }
  }

  const created = await createPickupTime(date)
  if (!created.ok) {
    console.error(`${LOG} gagal membuat time_id ${date}: ${created.reason} ${created.detail ?? ''}`)
    return { status: 'failed', reason: created.reason }
  }

  const saved = await savePickup(date, created.timeId)
  if (!saved) {
    // time_id sudah TERBUAT di Mengantar tapi gagal tercatat. Dilaporkan gagal supaya cron
    // tampak merah dan admin memeriksanya — bukan disimpan diam-diam di memori yang akan
    // hilang begitu fungsi serverless selesai.
    return { status: 'failed', reason: 'db-write-failed' }
  }

  console.log(
    `${LOG} ${date} -> time_id ${saved.inserted ? 'dibuat' : 'sudah ditulis pemanggil lain'}`,
  )
  return saved.inserted
    ? { status: 'created', pickup: saved.pickup }
    : { status: 'raced', pickup: saved.pickup }
}

// === Pembacaan untuk jalur checkout ===

export type PickupTimeIdSource =
  | 'tabel' // dibaca dari mengantar_daily_pickup (jalur normal)
  | 'fallback-api' // tabel kosong → dibuat saat itu juga lalu disimpan
  | 'env-statis' // lapis terakhir: MENGANTAR_PICKUP_TIME_ID

export type PickupTimeId = {
  timeId: string
  date: string // tanggal pickup yang berlaku
  reason: PickupDateReason
  source: PickupTimeIdSource
}

// time_id pickup yang berlaku untuk pesanan yang masuk SEKARANG.
//
// Tanggalnya bukan selalu hari ini: setelah cutoff 15:00 WIB, dan sepanjang hari Minggu, yang
// dipakai adalah hari kerja berikutnya (lihat resolvePickupDate di lib/pickup-schedule.ts).
//
// Tiga lapis, urut dari yang paling murah:
//   1. Tabel — jalur normal, nol panggilan keluar.
//   2. Fallback API — terjadi tiap sore untuk tanggal besok (cron besok belum jalan). Hasilnya
//      DISIMPAN, jadi hanya pesanan PERTAMA sore itu yang memanggil Mengantar; sisanya lapis 1.
//      Ini juga membuat cron esok hari melewati tanggal itu karena barisnya sudah ada.
//   3. MENGANTAR_PICKUP_TIME_ID — slot statis dari era sebelum tabel ini ada. Dipertahankan
//      supaya gangguan Mengantar/DB tak sampai menggagalkan pesanan. Bukan sumber utama.
//
// null hanya bila ketiga lapis gagal; pemanggil yang memutuskan apakah order tetap dibuat tanpa
// jadwal pickup (dijadwalkan manual) atau ditolak.
export async function getTodayPickupTimeId(
  nowMs: number = Date.now(),
): Promise<PickupTimeId | null> {
  const { date, reason, today, hour } = resolvePickupDate(nowMs)

  const existing = await getPickupByDate(date)
  if (existing) return { timeId: existing.timeId, date, reason, source: 'tabel' }

  console.warn(
    `${LOG} tabel kosong untuk ${date} (sekarang ${today} jam ${hour} WIB, alasan ${reason}) — fallback panggil Mengantar`,
  )
  const outcome = await ensurePickupForDate(date)
  if (outcome.status === 'created' || outcome.status === 'raced' || outcome.status === 'existing') {
    return { timeId: outcome.pickup.timeId, date, reason, source: 'fallback-api' }
  }

  const staticId = process.env.MENGANTAR_PICKUP_TIME_ID
  if (staticId) {
    console.error(
      `${LOG} fallback API gagal untuk ${date} — memakai MENGANTAR_PICKUP_TIME_ID statis. Periksa cron & konfigurasi Mengantar.`,
    )
    return { timeId: staticId, date, reason, source: 'env-statis' }
  }

  console.error(`${LOG} TIDAK ADA time_id untuk ${date} dan MENGANTAR_PICKUP_TIME_ID belum di-set`)
  return null
}
