// src/lib/mengantar-shipment.ts
// Booking kurir (create shipment order) ke Mengantar. SERVER ONLY — memegang MENGANTAR_API_KEY.
//
// ⚠️ JANGAN pernah diimpor dari komponen 'use client'. API key Mengantar berada di dalam URL
// (segmen path), jadi satu import dari client component akan membocorkannya utuh ke tab Network.
// Satu-satunya pemanggil yang sah: route handler (webhook pembayaran & endpoint simulasi dev).
//
// ── Kapan dipanggil ──
// SETELAH pembayaran sukses. Sebelum itu belum ada kepastian uang masuk, dan resi yang terbit untuk
// pesanan yang tak pernah dibayar akan menyisakan paket hantu di sistem kurir.
//
// ── Kontrak POST /order (TERVERIFIKASI terhadap sandbox) ──
//   POST {BASE}/api/public/{API_KEY}/order
//   { courier: "JT",
//     pickup: { type, volume, address_id, time_id },
//     orders: [ { goodsValue, customerName, customerPhone, customerAddress,
//                 customerAddressDataId, parcelContent, weight, quantity } ] }
// Respons: { success, data: [ { cnote_no, ORDER_ID, SERVICE_CODE, … } ],
//            batch, batch_id, courier, errors: [], ordersClosedDestination: [] }
// Nomor resi = data[0].cnote_no (mis. "JO9253592535").
//
// KODE KURIR = "JT" KAPITAL. Huruf kecil "jt" ditolak dengan 400 {"message":"Invalid courier"} —
// sudah diuji. Kebetulan sama dengan key kurir di respons cek ongkir, jadi satu konstanta saja.

import { JT_COURIER_ID } from '@/lib/mengantar-estimate'
import { mengantarWriteHost } from '@/lib/mengantar-host'
import { getTodayPickupTimeId } from '@/lib/mengantar-pickup'
import { readProducts } from '@/lib/mock-db/products'
import { shippingWeightKg } from '@/lib/shipping-weight'
import type { Order } from '@/types/order'

const LOG = '[mengantar-shipment]'

// Booking berjalan di dalam permintaan webhook; Xendit punya batas waktu callback sendiri.
const ORDER_REQUEST_TIMEOUT_MS = 12_000

// Jenis penjemputan & kendaraan. 'scheduledPickup' = memakai slot time_id yang sudah dibuat cron
// (lihat lib/mengantar-pickup.ts). 'volumeMotor' = paket ukuran motor; pilihan konservatif —
// menaikkannya ke mobil tanpa perlu membuat kurir mengirim kendaraan yang lebih mahal.
const PICKUP_TYPE = 'scheduledPickup'
const PICKUP_VOLUME = 'volumeMotor'

// Satu order kita = satu paket. Mengantar memakai `quantity` sebagai jumlah KOLI, bukan jumlah
// barang — mengirim total pcs akan membuat kurir menagih beberapa paket untuk satu kiriman.
const PARCEL_QUANTITY = 1

// Panjang maksimal deskripsi isi paket yang dikirim ke kurir.
const PARCEL_CONTENT_MAX = 100

export type ShipmentResult =
  | {
      ok: true
      trackingNumber: string // cnote_no — nomor resi
      serviceCode: string // SERVICE_CODE (mis. 'REG')
      mengantarOrderId?: string // ORDER_ID internal Mengantar
      batchId?: string
    }
  | { ok: false; reason: ShipmentFailureReason; detail: string }

export type ShipmentFailureReason =
  | 'not-configured' // env belum lengkap
  | 'blocked-environment' // host produksi ditulis dari luar deployment produksi (penjaga saldo)
  | 'no-pickup-time' // time_id tak bisa didapat (cron & fallback gagal)
  | 'incomplete-order' // data pesanan kurang (alamat/telepon/destination_id)
  | 'http-error' // Mengantar menolak
  | 'partial-error' // success:true tapi ada entri di `errors`/`ordersClosedDestination`
  | 'no-awb' // respons tanpa cnote_no
  | 'network' // timeout / jaringan

// === Penyusunan payload ===

// Deskripsi isi paket dari nama produk. Kurir hanya butuh gambaran umum, bukan rincian lengkap.
function buildParcelContent(order: Order): string {
  const names = order.items.map((i) => i.name).filter(Boolean)
  const joined = names.length > 0 ? names.join(', ') : 'Produk pertanian'
  return joined.length > PARCEL_CONTENT_MAX
    ? `${joined.slice(0, PARCEL_CONTENT_MAX - 1)}…`
    : joined
}

// Nilai barang (rupiah, INTEGER) — dasar asuransi kurir.
// Dihitung dari harga snapshot di order_items, BUKAN `totalAmount`: total sudah memuat ongkir dan
// dikurangi diskon, jadi memakainya akan melaporkan nilai barang yang salah ke kurir.
function buildGoodsValue(order: Order): number {
  const sum = order.items.reduce((acc, i) => acc + i.price * i.quantity, 0)
  return Math.max(0, Math.round(sum))
}

// Berat kirim (kg) DIHITUNG ULANG dari berat produk di DB.
// Tidak ada nilai berat yang tersimpan di order_items, dan berat dari client tak pernah dipercaya —
// lihat docs/checkout-flow.md → "Berat Kirim".
async function buildWeightKg(order: Order): Promise<number> {
  const products = await readProducts()
  const beratById = new Map(products.map((p) => [p.id, p.berat]))
  return shippingWeightKg(
    order.items.map((i) => ({ quantity: i.quantity, berat: beratById.get(i.productId) })),
  )
}

// Membaca nomor resi & kode layanan dari respons. null bila tak ada resi — booking tanpa resi tak
// ada gunanya bagi pembeli, jadi diperlakukan gagal alih-alih disimpan setengah jadi.
function extractShipment(body: unknown): {
  trackingNumber: string
  serviceCode: string
  mengantarOrderId?: string
} | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>
  const data = Array.isArray(b.data) ? b.data : []
  const first = data[0]
  if (typeof first !== 'object' || first === null) return null
  const row = first as Record<string, unknown>

  const awb = typeof row.cnote_no === 'string' ? row.cnote_no.trim() : ''
  if (!awb) return null

  return {
    trackingNumber: awb,
    serviceCode: typeof row.SERVICE_CODE === 'string' && row.SERVICE_CODE ? row.SERVICE_CODE : 'REG',
    ...(typeof row.ORDER_ID === 'string' && row.ORDER_ID ? { mengantarOrderId: row.ORDER_ID } : {}),
  }
}

// Mengumpulkan pesan kegagalan sebagian. Mengantar bisa membalas success:true sambil menaruh
// order yang bermasalah di `errors` / `ordersClosedDestination` — dianggap sukses padahal paketnya
// tak pernah terdaftar.
function collectPartialErrors(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>
  const parts: string[] = []
  if (Array.isArray(b.errors) && b.errors.length > 0) {
    parts.push(`errors=${JSON.stringify(b.errors).slice(0, 200)}`)
  }
  if (Array.isArray(b.ordersClosedDestination) && b.ordersClosedDestination.length > 0) {
    parts.push(`tujuan tutup=${JSON.stringify(b.ordersClosedDestination).slice(0, 200)}`)
  }
  return parts.length > 0 ? parts.join(' | ') : null
}

// === Pemanggilan ===

// Membuat shipment order J&T untuk sebuah pesanan yang SUDAH dibayar.
// Tidak menyentuh DB — pemanggil yang menyimpan hasil/kegagalannya, supaya modul ini bisa diuji
// dan supaya keputusan "apa yang dilakukan saat gagal" ada di satu tempat (route handler).
export async function createShipmentOrder(order: Order): Promise<ShipmentResult> {
  // Host lewat penjaga tulis (lib/mengantar-host.ts): host PRODUKSI hanya boleh dibooking dari
  // deployment produksi. Ini dicek PALING AWAL — sebelum menyentuh DB atau membuat slot pickup —
  // supaya lingkungan yang diblokir tak meninggalkan efek samping apa pun.
  const writeHost = mengantarWriteHost()
  if (!writeHost.allowed) {
    console.warn(`${LOG} booking ${order.orderId} DIBATALKAN — ${writeHost.reason}`)
    return { ok: false, reason: 'blocked-environment', detail: writeHost.reason }
  }
  const base = writeHost.host

  const key = process.env.MENGANTAR_API_KEY
  const addressId = process.env.MENGANTAR_STORE_ADDRESS_ID
  if (!key || !addressId) {
    return { ok: false, reason: 'not-configured', detail: 'env Mengantar belum lengkap' }
  }

  // Data wajib kurir. Dicek di sini, bukan dibiarkan ditolak Mengantar, supaya pesan
  // kegagalannya bisa dibaca admin OMS tanpa menerjemahkan error pihak ketiga.
  const address = order.address
  if (!address?.destinationId) {
    return { ok: false, reason: 'incomplete-order', detail: 'destination_id pesanan kosong' }
  }
  if (!order.customerPhone) {
    return { ok: false, reason: 'incomplete-order', detail: 'nomor telepon pembeli kosong' }
  }
  if (!address.shippingAddress?.trim()) {
    return { ok: false, reason: 'incomplete-order', detail: 'alamat pengiriman kosong' }
  }

  // Slot penjemputan. Tanpa time_id, `scheduledPickup` tak bisa dipakai.
  const pickup = await getTodayPickupTimeId()
  if (!pickup) {
    return { ok: false, reason: 'no-pickup-time', detail: 'time_id pickup tak tersedia' }
  }

  const weight = await buildWeightKg(order)
  const payload = {
    courier: JT_COURIER_ID,
    pickup: {
      type: PICKUP_TYPE,
      volume: PICKUP_VOLUME,
      address_id: addressId,
      time_id: pickup.timeId,
    },
    orders: [
      {
        goodsValue: buildGoodsValue(order),
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        // Detail jalan saja. Kota/kecamatan/kelurahan di-resolve Mengantar dari
        // customerAddressDataId — mengulangnya di sini hanya memperpanjang label paket.
        customerAddress: address.shippingAddress.trim(),
        customerAddressDataId: address.destinationId,
        parcelContent: buildParcelContent(order),
        weight,
        quantity: PARCEL_QUANTITY,
      },
    ],
  }

  console.log(
    `${LOG} booking ${order.orderId}: kurir=${JT_COURIER_ID} berat=${weight}kg time_id=${pickup.timeId} (sumber ${pickup.source}, tanggal ${pickup.date})`,
  )

  try {
    // URL memuat API key → JANGAN pernah dicetak ke log.
    const url = `${base.replace(/\/+$/, '')}/api/public/${encodeURIComponent(key)}/order`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(ORDER_REQUEST_TIMEOUT_MS),
    })
    const text = await res.text()

    if (!res.ok) {
      return { ok: false, reason: 'http-error', detail: `${res.status} ${text.slice(0, 300)}` }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return { ok: false, reason: 'no-awb', detail: `respons bukan JSON: ${text.slice(0, 200)}` }
    }

    // success:false → ditolak secara logis meski HTTP 200
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as Record<string, unknown>).success === false
    ) {
      return { ok: false, reason: 'http-error', detail: text.slice(0, 300) }
    }

    const partial = collectPartialErrors(parsed)
    if (partial) return { ok: false, reason: 'partial-error', detail: partial }

    const shipment = extractShipment(parsed)
    if (!shipment) {
      return { ok: false, reason: 'no-awb', detail: `tanpa cnote_no: ${text.slice(0, 200)}` }
    }

    const batchId =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>).batch
        : undefined

    return {
      ok: true,
      trackingNumber: shipment.trackingNumber,
      serviceCode: shipment.serviceCode,
      ...(shipment.mengantarOrderId ? { mengantarOrderId: shipment.mengantarOrderId } : {}),
      ...(typeof batchId === 'string' && batchId ? { batchId } : {}),
    }
  } catch (e) {
    // Hanya `name`, bukan `message`: pesan error fetch di sebagian runtime memuat URL — yang di
    // sini berisi API key.
    return { ok: false, reason: 'network', detail: e instanceof Error ? e.name : 'unknown' }
  }
}
