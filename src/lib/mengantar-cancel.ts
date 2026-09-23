// src/lib/mengantar-cancel.ts
// Membatalkan pengiriman di Mengantar (DELETE /order). SERVER ONLY — memegang MENGANTAR_API_KEY.
//
// ⚠️ JANGAN pernah diimpor dari komponen 'use client'. API key Mengantar berada di dalam URL
// (segmen path), jadi satu import dari client component membocorkannya utuh ke tab Network.
//
// ── Kontrak DELETE /order (dari app.mengantar.com/docs, BELUM diuji terhadap sandbox) ──
//   DELETE {BASE}/api/public/{API_KEY}/order
//   { "courier": "JT", "ids": ["6a8fa18a0088b39607d5a991"] }
//   atau
//   { "courier": "JT", "orderIds": ["2608270XVUXE"] }
// Respons: { success, message, deletedCount, deletedOrderIds, deletedOrderIdsHumanReadable }
//
// `ids` = Mengantar `_id`; `orderIds` = `ORDER_ID`. Dokumentasi memperingatkan: bila `ids` ada,
// JANGAN mengirim `orderIds` — ia akan menimpa `ids`. Karena itu di bawah hanya SATU yang dikirim.
// Nomor resi TIDAK diterima endpoint ini sama sekali.
//
// ── Yang BELUM dipastikan (per 2026-09-09) ──
//   1. Sampai kapan penghapusan masih diterima. Satu-satunya batas waktu tertulis adalah untuk
//      anteraja ("dapat dihapus setelah 5 menit") — itu batas BAWAH, dan bukan untuk J&T.
//      Kemungkinan besar ada titik di mana kurir sudah memanifes paketnya dan DELETE ditolak.
//   2. Apakah saldo dikembalikan. Ada tipe invoice `typeRefund` di GET /invoices, tapi tak satu
//      kalimat pun mengaitkannya dengan penghapusan order.
//
// Ketidaktahuan itu SENGAJA tidak menghalangi modul ini ditulis: cabang "ditolak" wajib ada apa pun
// jawabannya — Mengantar bisa sedang mati, atau paketnya sudah di truk. Yang ditentukan oleh kedua
// jawaban itu adalah apa yang DIJANJIKAN CS ke pembeli, bukan bentuk kode di sini.
//
// ── PENTING: modul ini TIDAK menyentuh database ──
// Ia hanya berbicara dengan Mengantar dan melaporkan hasilnya. Keputusan "apa yang dilakukan saat
// gagal" ada di pemanggil, mengikuti pola yang sama dengan createShipmentOrder().

// Gagalkan BUILD bila modul ini pernah tertarik ke bundle komponen client (SEC-050).
// Berkas ini memegang MENGANTAR_API_KEY; ia tak boleh sampai ke browser dalam keadaan apa pun.
// Sampai sekarang yang menahannya hanyalah tree-shaking dan sebuah komentar — optimisasi dan
// niat baik, bukan jaminan. Dengan baris ini, import dari komponen client menjadi GALAT BUILD,
// bukan kebocoran yang baru ketahuan setelah kuncinya terbaca di tab Network.
import 'server-only'

import { JT_COURIER_ID } from '@/lib/mengantar-estimate'
import { mengantarWriteHost } from '@/lib/mengantar-host'

const LOG = '[mengantar-cancel]'

// Pengganti kunci di teks yang keluar dari modul ini.
const RAHASIA = '***'

// Pembatalan berjalan di dalam permintaan admin yang sedang menunggu di layar OMS.
//
// Dipendekkan dari 12 detik menjadi 8 saat percobaan ulang ditambahkan (MGT-66): anggaran waktu
// admin tak bertambah, ia hanya dibagi ke beberapa percobaan. Tiga percobaan 8 detik plus jedanya
// masih di bawah maxDuration 30 detik milik route pemanggil; tiga percobaan 12 detik tidak.
const CANCEL_REQUEST_TIMEOUT_MS = 8_000

// Percobaan ulang untuk kegagalan yang SEMENTARA (MGT-66).
//
// Terjadi 22 Sep 2026: DELETE pertama untuk resi JO6451515051 dijawab halaman galat HTML Cloudflare,
// pesanan ditandai CANCEL_FAILED, dan penjemputannya tetap hidup sampai perintah yang SAMA PERSIS
// dijalankan manual beberapa menit kemudian — lalu berhasil, dan saldo Rp66.720 kembali. Satu
// gangguan sesaat di depan Mengantar berubah menjadi pekerjaan manual yang hanya ketahuan kalau ada
// yang membaca kolom shipment_error.
//
// Jedanya pendek dan tetap (bukan eksponensial panjang): yang ditunggu adalah gangguan sesaat,
// sementara admin menunggu di depan layar. Kalau tiga percobaan gagal, memang perlu manusia.
const CANCEL_MAX_ATTEMPTS = 3
const CANCEL_RETRY_DELAY_MS = [600, 2000]

// `_id` karangan untuk PROBE — 24 nol heksadesimal.
//
// Dipakai untuk mempelajari BENTUK RESPONS PENOLAKAN Mengantar tanpa menghapus apa pun: id ini tak
// mungkin cocok dengan pengiriman mana pun. Tanpa probe, penanganan gagal di bawah hanyalah tebakan
// atas respons yang belum pernah kita lihat — dan penanganan gagal yang salah justru paling
// berbahaya di sini, karena di situlah pembeli sudah dijanjikan pembatalan sementara paketnya tetap
// berjalan.
export const PROBE_OBJECT_ID = '000000000000000000000000'

export type CancelShipmentTarget = {
  objectId?: string // orders.mengantar_order_object_id
  orderId?: string // orders.mengantar_order_id (cadangan)
}

export type CancelFailureReason =
  | 'not-configured' // env belum lengkap
  | 'blocked-environment' // host produksi dihapus dari luar deployment produksi
  | 'no-identity' // pesanan tak punya _id maupun ORDER_ID
  | 'http-error' // Mengantar menolak dengan status non-2xx
  | 'rejected' // HTTP 200 tapi success:false
  | 'not-deleted' // success:true tapi deletedCount 0 — lihat catatan di bawah
  | 'bad-shape' // respons bukan JSON / tak terbaca
  | 'network' // timeout / jaringan

export type CancelShipmentResult =
  | {
      ok: true
      deletedCount: number
      deletedIds: string[]
      deletedHumanReadable: string[]
      raw: string // potongan respons, untuk dicatat admin
      attempts: number // percobaan yang dipakai sampai berhasil (1 = langsung berhasil)
    }
  | {
      ok: false
      reason: CancelFailureReason
      detail: string
      httpStatus?: number
      attempts: number // percobaan yang sudah dijalankan sebelum menyerah
    }

// Apakah kegagalan ini layak dicoba ulang dengan permintaan yang SAMA PERSIS.
//
// Yang boleh: gangguan di jalan menuju Mengantar — jaringan putus, timeout, rem lalu lintas (429),
// galat sisi server (5xx), dan respons yang bukan JSON (halaman galat HTML dari CDN — inilah bentuk
// yang muncul pada MGT-66).
//
// Yang TIDAK boleh, dan alasannya penting: `rejected` dan `not-deleted` adalah JAWABAN Mengantar,
// bukan gangguan. Mengulangnya hanya menghasilkan jawaban yang sama sambil menahan admin lebih lama
// — dan "sudah dihapus sebelumnya" pun masuk ke sini. Sisanya (`not-configured`, `no-identity`,
// `blocked-environment`) adalah keadaan kita sendiri yang tak berubah dalam dua detik.
//
// Diekspor supaya aturannya bisa diuji tanpa memanggil Mengantar.
export function isRetryableCancelFailure(
  reason: CancelFailureReason,
  httpStatus?: number,
): boolean {
  if (reason === 'network' || reason === 'bad-shape') return true
  if (reason === 'http-error') return httpStatus === 429 || (httpStatus ?? 0) >= 500
  return false
}

// Payload yang AKAN dikirim — dipisah supaya bisa ditinjau tanpa memanggil apa pun (dryRun).
export function buildCancelPayload(
  target: CancelShipmentTarget,
): { courier: string; ids: string[] } | { courier: string; orderIds: string[] } | null {
  const objectId = target.objectId?.trim()
  if (objectId) return { courier: JT_COURIER_ID, ids: [objectId] }

  const orderId = target.orderId?.trim()
  if (orderId) return { courier: JT_COURIER_ID, orderIds: [orderId] }

  return null
}

function potong(text: string, n = 300): string {
  return text.length > n ? `${text.slice(0, n)}…` : text
}

// Membuang MENGANTAR_API_KEY dari teks apa pun yang akan meninggalkan modul ini (SEC-046).
//
// Kunci Mengantar adalah SEGMEN PATH, bukan header — jadi URL-nya sendiri rahasia. Respons galat
// pihak ketiga lazim memantulkan kembali URL yang diminta, dan detail/raw di bawah diteruskan apa
// adanya ke klien oleh route handler. Satu pesan galat yang memuat URL sudah cukup menaruh kunci
// produksi di tab Network seorang admin — dan dari sana ia bisa membuat maupun menghapus
// pengiriman atas nama toko.
//
// Disensor DI SINI, bukan di pemanggil: modul ini satu-satunya yang tahu nilai kuncinya, jadi ini
// satu-satunya tempat yang penyensorannya tak bisa lupa diterapkan.
function tanpaKunci(text: string, key: string): string {
  let bersih = text
  // Bentuk mentah maupun ter-encode — URL memakai encodeURIComponent.
  for (const varian of [key, encodeURIComponent(key)]) {
    if (varian) bersih = bersih.split(varian).join(RAHASIA)
  }
  // Jaring kedua: segmen apa pun di posisi kunci, kalau-kalau Mengantar memantulkannya dalam
  // bentuk lain (mis. sebagian ter-escape) sehingga pencocokan harfiah di atas meleset.
  return bersih.replace(/[/]api[/]public[/][^/\s]+/g, "/api/public/" + RAHASIA)
}

// Hasil SATU percobaan DELETE. Tanpa percobaan ulang — itu urusan cancelShipmentOrder di bawah.
type AttemptResult =
  | {
      ok: true
      deletedCount: number
      deletedIds: string[]
      deletedHumanReadable: string[]
      raw: string
    }
  | { ok: false; reason: CancelFailureReason; detail: string; httpStatus?: number }

async function attemptCancel(
  base: string,
  key: string,
  payload: { courier: string; ids: string[] } | { courier: string; orderIds: string[] },
): Promise<AttemptResult> {
  // Setiap potongan respons yang keluar dari modul ini lewat sini lebih dulu.
  const aman = (t: string, n = 300) => potong(tanpaKunci(t, key), n)

  try {
    // URL memuat API key → JANGAN pernah dicetak ke log.
    const url = `${base.replace(/\/+$/, '')}/api/public/${encodeURIComponent(key)}/order`
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(CANCEL_REQUEST_TIMEOUT_MS),
    })
    const text = await res.text()

    if (!res.ok) {
      return { ok: false, reason: 'http-error', detail: aman(text), httpStatus: res.status }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      // Bentuk khas gangguan CDN: HTTP 200 berisi halaman HTML, bukan JSON. Terjadi pada MGT-66.
      return {
        ok: false,
        reason: 'bad-shape',
        detail: `respons bukan JSON: ${aman(text, 200)}`,
        httpStatus: res.status,
      }
    }

    const body = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<
      string,
      unknown
    >

    if (body.success === false) {
      return { ok: false, reason: 'rejected', detail: aman(text), httpStatus: res.status }
    }

    const deletedCount = typeof body.deletedCount === 'number' ? body.deletedCount : 0

    // ⚠️ CABANG PALING PENTING DI BERKAS INI.
    //
    // `success: true` dengan `deletedCount: 0` berarti Mengantar menerima permintaannya tapi TIDAK
    // menghapus apa pun — inilah bentuk yang paling mungkin diambil "paket sudah dijemput, sudah
    // terlambat dibatalkan". Memperlakukannya sebagai sukses hanya karena `success: true` akan
    // membuat OMS melaporkan "penjemputan sudah dibatalkan" untuk paket yang tetap dikirim, dan
    // admin tak punya satu pun tanda untuk mencurigainya.
    //
    // Pola yang sama sudah dipakai saat booking (collectPartialErrors di mengantar-shipment.ts):
    // `success: true` dari Mengantar tak pernah cukup sendirian.
    //
    // TIDAK diulang otomatis (lihat isRetryableCancelFailure): ini jawaban Mengantar, bukan
    // gangguan — mengulanginya hanya menghasilkan jawaban yang sama.
    if (deletedCount < 1) {
      return {
        ok: false,
        reason: 'not-deleted',
        detail: `success:true tapi deletedCount=${deletedCount} — ${aman(text, 200)}`,
        httpStatus: res.status,
      }
    }

    const deletedIds = Array.isArray(body.deletedOrderIds)
      ? body.deletedOrderIds.filter((v): v is string => typeof v === 'string')
      : []
    const deletedHumanReadable = Array.isArray(body.deletedOrderIdsHumanReadable)
      ? body.deletedOrderIdsHumanReadable.filter((v): v is string => typeof v === 'string')
      : []

    return { ok: true, deletedCount, deletedIds, deletedHumanReadable, raw: aman(text) }
  } catch (e) {
    // Hanya `name`, bukan `message`: pesan error fetch di sebagian runtime memuat URL — yang di
    // sini berisi API key.
    return { ok: false, reason: 'network', detail: e instanceof Error ? e.name : 'unknown' }
  }
}

function tunggu(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Membatalkan SATU pengiriman di Mengantar, dengan percobaan ulang untuk gangguan sesaat.
//
// Sengaja satu per satu meski endpointnya menerima array: pembatalan selalu berasal dari keputusan
// atas SATU pesanan, dan hasil per-pesanan yang jelas jauh lebih berguna bagi admin daripada satu
// `deletedCount` gabungan yang tak menyebut mana yang gagal.
//
// Mengulang permintaan yang sama AMAN di endpoint ini: terukur 2026-09-09, DELETE untuk `_id` yang
// sudah terhapus dijawab "Orders already deleted", bukan menghapus sesuatu yang lain. Jadi risiko
// terburuk dari percobaan ulang hanyalah jawaban yang sudah kita pahami bentuknya.
export async function cancelShipmentOrder(
  target: CancelShipmentTarget,
): Promise<CancelShipmentResult> {
  // Penjaga tulis DULUAN — sebelum menyentuh apa pun. DELETE adalah panggilan TULIS yang PERMANEN:
  // pengiriman yang terhapus tak bisa dikembalikan. Menjalankannya dari mesin lokal terhadap host
  // produksi berarti menghapus pengiriman pembeli sungguhan.
  const writeHost = mengantarWriteHost()
  if (!writeHost.allowed) {
    console.warn(`${LOG} pembatalan DIBATALKAN — ${writeHost.reason}`)
    return { ok: false, reason: 'blocked-environment', detail: writeHost.reason, attempts: 0 }
  }
  const base = writeHost.host

  const key = process.env.MENGANTAR_API_KEY
  if (!key) {
    return {
      ok: false,
      reason: 'not-configured',
      detail: 'MENGANTAR_API_KEY belum di-set',
      attempts: 0,
    }
  }

  const payload = buildCancelPayload(target)
  if (!payload) {
    // Pesanan yang dibooking sebelum migration 20260909120000 dan gagal di-backfill. Pemanggil
    // yang memutuskan apa berikutnya — biasanya: teruskan pembatalan, tandai perlu tindakan manual.
    return {
      ok: false,
      reason: 'no-identity',
      detail: 'pesanan tak punya _id maupun ORDER_ID Mengantar',
      attempts: 0,
    }
  }

  const penanda = 'ids' in payload ? `_id ${payload.ids[0]}` : `ORDER_ID ${payload.orderIds[0]}`
  console.log(`${LOG} menghapus pengiriman ${penanda}`)

  let terakhir: Extract<AttemptResult, { ok: false }> = {
    ok: false,
    reason: 'network',
    detail: 'tak ada percobaan yang berjalan',
  }

  for (let percobaan = 1; percobaan <= CANCEL_MAX_ATTEMPTS; percobaan++) {
    const hasil = await attemptCancel(base, key, payload)

    if (hasil.ok) {
      console.log(
        `${LOG} ${penanda} terhapus (deletedCount=${hasil.deletedCount}, percobaan ke-${percobaan})`,
      )
      return { ...hasil, attempts: percobaan }
    }

    terakhir = hasil
    const status = hasil.httpStatus !== undefined ? ` HTTP ${hasil.httpStatus}` : ''

    if (
      !isRetryableCancelFailure(hasil.reason, hasil.httpStatus) ||
      percobaan === CANCEL_MAX_ATTEMPTS
    ) {
      console.error(
        `${LOG} ${penanda} GAGAL setelah ${percobaan} percobaan — ${hasil.reason}${status}`,
      )
      return { ...hasil, attempts: percobaan }
    }

    const jeda = CANCEL_RETRY_DELAY_MS[percobaan - 1] ?? CANCEL_RETRY_DELAY_MS.at(-1) ?? 1000
    console.warn(
      `${LOG} ${penanda} percobaan ${percobaan}/${CANCEL_MAX_ATTEMPTS} gagal ` +
        `(${hasil.reason}${status}) — mengulang dalam ${jeda} ms`,
    )
    await tunggu(jeda)
  }

  // Tak tercapai: perulangan di atas selalu keluar lewat `return`. Ada demi kelengkapan tipe.
  return { ...terakhir, attempts: CANCEL_MAX_ATTEMPTS }
}
