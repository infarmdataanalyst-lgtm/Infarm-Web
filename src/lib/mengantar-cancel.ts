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

import { JT_COURIER_ID } from '@/lib/mengantar-estimate'
import { mengantarWriteHost } from '@/lib/mengantar-host'

const LOG = '[mengantar-cancel]'

// Pembatalan berjalan di dalam permintaan admin yang sedang menunggu di layar OMS.
const CANCEL_REQUEST_TIMEOUT_MS = 12_000

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
    }
  | { ok: false; reason: CancelFailureReason; detail: string; httpStatus?: number }

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

// Membatalkan SATU pengiriman di Mengantar.
//
// Sengaja satu per satu meski endpointnya menerima array: pembatalan selalu berasal dari keputusan
// atas SATU pesanan, dan hasil per-pesanan yang jelas jauh lebih berguna bagi admin daripada satu
// `deletedCount` gabungan yang tak menyebut mana yang gagal.
export async function cancelShipmentOrder(
  target: CancelShipmentTarget,
): Promise<CancelShipmentResult> {
  // Penjaga tulis DULUAN — sebelum menyentuh apa pun. DELETE adalah panggilan TULIS yang PERMANEN:
  // pengiriman yang terhapus tak bisa dikembalikan. Menjalankannya dari mesin lokal terhadap host
  // produksi berarti menghapus pengiriman pembeli sungguhan.
  const writeHost = mengantarWriteHost()
  if (!writeHost.allowed) {
    console.warn(`${LOG} pembatalan DIBATALKAN — ${writeHost.reason}`)
    return { ok: false, reason: 'blocked-environment', detail: writeHost.reason }
  }
  const base = writeHost.host

  const key = process.env.MENGANTAR_API_KEY
  if (!key) {
    return { ok: false, reason: 'not-configured', detail: 'MENGANTAR_API_KEY belum di-set' }
  }

  const payload = buildCancelPayload(target)
  if (!payload) {
    // Pesanan yang dibooking sebelum migration 20260909120000 dan gagal di-backfill. Pemanggil
    // yang memutuskan apa berikutnya — biasanya: teruskan pembatalan, tandai perlu tindakan manual.
    return {
      ok: false,
      reason: 'no-identity',
      detail: 'pesanan tak punya _id maupun ORDER_ID Mengantar',
    }
  }

  const penanda = 'ids' in payload ? `_id ${payload.ids[0]}` : `ORDER_ID ${payload.orderIds[0]}`
  console.log(`${LOG} menghapus pengiriman ${penanda}`)

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
      return { ok: false, reason: 'http-error', detail: potong(text), httpStatus: res.status }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return { ok: false, reason: 'bad-shape', detail: `respons bukan JSON: ${potong(text, 200)}` }
    }

    const body = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<
      string,
      unknown
    >

    if (body.success === false) {
      return { ok: false, reason: 'rejected', detail: potong(text) }
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
    if (deletedCount < 1) {
      return {
        ok: false,
        reason: 'not-deleted',
        detail: `success:true tapi deletedCount=${deletedCount} — ${potong(text, 200)}`,
      }
    }

    const deletedIds = Array.isArray(body.deletedOrderIds)
      ? body.deletedOrderIds.filter((v): v is string => typeof v === 'string')
      : []
    const deletedHumanReadable = Array.isArray(body.deletedOrderIdsHumanReadable)
      ? body.deletedOrderIdsHumanReadable.filter((v): v is string => typeof v === 'string')
      : []

    console.log(`${LOG} ${penanda} terhapus (deletedCount=${deletedCount})`)
    return { ok: true, deletedCount, deletedIds, deletedHumanReadable, raw: potong(text) }
  } catch (e) {
    // Hanya `name`, bukan `message`: pesan error fetch di sebagian runtime memuat URL — yang di
    // sini berisi API key.
    return { ok: false, reason: 'network', detail: e instanceof Error ? e.name : 'unknown' }
  }
}
