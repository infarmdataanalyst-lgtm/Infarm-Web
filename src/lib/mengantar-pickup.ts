// src/lib/mengantar-pickup.ts
// Jadwal pickup Mengantar: SATU PINTU pengambilan `time_id` untuk booking kurir.
// SERVER ONLY — memegang MENGANTAR_API_KEY. Jangan pernah diimpor dari komponen 'use client';
// api key tidak boleh sampai ke bundel browser.
//
// Alamat penjemputan TIDAK dibaca dari env di sini: pemanggil mengirimkannya (alamat gudang pemenuh,
// lewat lib/warehouse.ts). MENGANTAR_STORE_ADDRESS_ID hanya disentuh untuk membatasi slot statis
// ke alamat pemiliknya — lihat lapis ketiga getTodayPickupTimeId.
//
// ── Kenapa ada tabel perantara, bukan panggil POST /time per transaksi ──
// Booking kurir butuh `time_id` yang mewakili slot penjemputan. Satu slot dipakai untuk SEMUA
// paket hari itu dari alamat yang sama, jadi memanggil POST /time tiap checkout berarti: satu
// round-trip API tambahan di jalur bayar, kuota terbuang, dan satu titik gagal baru tepat saat
// pembeli menekan bayar. Cron harian membuatnya sekali per alamat; checkout hanya membaca baris DB.
//
// ── Tiga jebakan kontrak API Mengantar ──
// 1. API KEY ADA DI DALAM URL, bukan header: {BASE}/api/public/{API_KEY}/time. Konsekuensinya URL
//    ini RAHASIA — jangan pernah menuliskannya ke log, pesan error, atau respons. Semua log di
//    bawah hanya menyebut tanggal & status, tak pernah URL-nya.
// 2. Tanggal berformat MM-DD-YYYY (gaya AS), bukan ISO. Dikonversi lewat toMengantarDate().
// 3. Nama field `time_id` di respons belum dipastikan (contoh curl tak menyertakan responsnya),
//    jadi extractTimeId sengaja toleran terhadap beberapa penamaan.

// Gagalkan BUILD bila modul ini pernah tertarik ke bundle komponen client (SEC-050).
// Berkas ini memegang MENGANTAR_API_KEY; ia tak boleh sampai ke browser dalam keadaan apa pun.
// Sampai sekarang yang menahannya hanyalah tree-shaking dan sebuah komentar — optimisasi dan
// niat baik, bukan jaminan. Dengan baris ini, import dari komponen client menjadi GALAT BUILD,
// bukan kebocoran yang baru ketahuan setelah kuncinya terbaca di tab Network.
import 'server-only'

import { mengantarWriteHost } from '@/lib/mengantar-host'
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
      reason: 'not-configured' | 'blocked-environment' | 'http-error' | 'no-time-id' | 'network'
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

// Meminta slot pickup baru ke Mengantar untuk satu tanggal DI SATU ALAMAT. TIDAK menyentuh DB —
// pemisahan ini membuat pemanggil yang menyimpan hasilnya bisa memutuskan sendiri apa yang
// dilakukan saat gagal.
//
// `addressId` datang dari pemanggil (warehouses.mengantar_address_id lewat lib/warehouse.ts),
// BUKAN dari env: sejak tiap gudang punya alamat sendiri, membaca env di sini berarti seluruh
// gudang kembali berbagi satu slot — persis keadaan yang hendak ditinggalkan.
export async function createPickupTime(
  date: string,
  addressId: string,
): Promise<CreateTimeResult> {
  const key = process.env.MENGANTAR_API_KEY

  // Host lewat penjaga tulis (lib/mengantar-host.ts): host produksi hanya boleh ditulis dari
  // deployment produksi. Membaca MENGANTAR_BASE_URL langsung di sini akan memutar balik penjaganya.
  const writeHost = mengantarWriteHost()
  if (!writeHost.allowed) {
    console.warn(`${LOG} slot pickup ${date} alamat ${addressId} DIBATALKAN — ${writeHost.reason}`)
    return { ok: false, reason: 'blocked-environment', detail: writeHost.reason }
  }
  const base = writeHost.host

  if (!key || !addressId) {
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

// Memastikan sebuah tanggal punya time_id DI SATU ALAMAT. Idempoten — inilah yang membuat cron
// aman di-run ulang.
//
// Urutan disengaja: BACA DULU, baru panggil Mengantar. Kalau dibalik, setiap re-run cron membuat
// slot pickup baru di sisi Mengantar (sampah di sistem kurir) meski barisnya sudah ada di DB kita.
export async function ensurePickupForDate(
  date: string,
  addressId: string,
): Promise<EnsurePickupOutcome> {
  if (parsePickupDate(date) === null) {
    return { status: 'failed', reason: `format tanggal tidak valid: ${date}` }
  }
  if (!addressId.trim()) {
    // Alamat kosong berarti konfigurasi gudang belum lengkap, bukan gangguan Mengantar —
    // dibedakan supaya log cron tidak menuding pihak ketiga untuk kesalahan kita sendiri.
    return { status: 'failed', reason: 'alamat-pickup-kosong' }
  }
  if (!isPickupDay(date)) {
    // Minggu: tak ada penjemputan, jadi tak ada slot yang perlu dibuat.
    return { status: 'skipped-non-pickup-day' }
  }

  const existing = await getPickupByDate(date, addressId)
  if (existing) {
    console.log(`${LOG} ${date} alamat ${addressId} sudah ada time_id — dilewati (idempoten)`)
    return { status: 'existing', pickup: existing }
  }

  const created = await createPickupTime(date, addressId)
  if (!created.ok) {
    console.error(
      `${LOG} gagal membuat time_id ${date} alamat ${addressId}: ${created.reason} ${created.detail ?? ''}`,
    )
    return { status: 'failed', reason: created.reason }
  }

  const saved = await savePickup(date, addressId, created.timeId)
  if (!saved) {
    // time_id sudah TERBUAT di Mengantar tapi gagal tercatat. Dilaporkan gagal supaya cron
    // tampak merah dan admin memeriksanya — bukan disimpan diam-diam di memori yang akan
    // hilang begitu fungsi serverless selesai.
    return { status: 'failed', reason: 'db-write-failed' }
  }

  console.log(
    `${LOG} ${date} alamat ${addressId} -> time_id ${saved.inserted ? 'dibuat' : 'sudah ditulis pemanggil lain'}`,
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
  addressId: string // alamat yang slot ini miliki — dicatat agar log booking bisa dicocokkan
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
//      supaya gangguan Mengantar/DB tak sampai menggagalkan pesanan. Bukan sumber utama, dan HANYA
//      berlaku untuk alamat pemiliknya.
//
// `addressId` = alamat penjemputan gudang PEMENUH pesanan ini. Parameter pertama, bukan opsional:
// slot penjemputan hanya sah untuk alamatnya sendiri, jadi tak ada nilai bawaan yang masuk akal.
//
// null hanya bila ketiga lapis gagal; pemanggil yang memutuskan apakah order tetap dibuat tanpa
// jadwal pickup (dijadwalkan manual) atau ditolak.
export async function getTodayPickupTimeId(
  addressId: string,
  nowMs: number = Date.now(),
): Promise<PickupTimeId | null> {
  const { date, reason, today, hour } = resolvePickupDate(nowMs)

  const existing = await getPickupByDate(date, addressId)
  if (existing) return { timeId: existing.timeId, addressId, date, reason, source: 'tabel' }

  console.warn(
    `${LOG} tabel kosong untuk ${date} alamat ${addressId} (sekarang ${today} jam ${hour} WIB, alasan ${reason}) — fallback panggil Mengantar`,
  )
  const outcome = await ensurePickupForDate(date, addressId)
  if (outcome.status === 'created' || outcome.status === 'raced' || outcome.status === 'existing') {
    return { timeId: outcome.pickup.timeId, addressId, date, reason, source: 'fallback-api' }
  }

  // Slot statis MENGANTAR_PICKUP_TIME_ID dibuat untuk SATU alamat: alamat env lama. Memakainya
  // untuk alamat gudang lain berarti mendaftarkan paket ke slot penjemputan yang bukan miliknya.
  //
  // Penjaga ini WAJIB, bukan jaga-jaga. Uji sandbox 22 Sep 2026 (Notion Testing Mengantar MGT-57)
  // mengirim address_id Cengkareng berpasangan dengan time_id milik alamat lain, dan Mengantar
  // MENERIMANYA tanpa error: resi terbit, waybill mencatat lokasi jemput dari address_id sementara
  // slotnya milik alamat lain. Tidak ada yang menolak pasangan itu selain baris di bawah ini.
  const staticId = process.env.MENGANTAR_PICKUP_TIME_ID
  const legacyAddressId = process.env.MENGANTAR_STORE_ADDRESS_ID?.trim()
  if (staticId && legacyAddressId && addressId === legacyAddressId) {
    console.error(
      `${LOG} fallback API gagal untuk ${date} alamat ${addressId} — memakai MENGANTAR_PICKUP_TIME_ID statis. Periksa cron & konfigurasi Mengantar.`,
    )
    return { timeId: staticId, addressId, date, reason, source: 'env-statis' }
  }

  console.error(
    `${LOG} TIDAK ADA time_id untuk ${date} alamat ${addressId} (slot statis hanya berlaku untuk alamat ${legacyAddressId || 'env yang belum di-set'})`,
  )
  return null
}
