// src/app/api/mengantar/shipping/estimate/route.ts
// Proxy server untuk cek ongkir Mengantar (allEstimatePublic), dipakai ShippingOptions di checkout.
//   GET /api/mengantar/shipping/estimate?destination_id=...&weight=...
//
// Kenapa diproksi padahal endpoint Mengantar mengizinkan CORS: request langsung browser→Mengantar
// TIDAK bisa kita rate-limit sama sekali (tak lewat server kita). Diproksi agar ada satu titik
// pembatasan (per-IP) sekaligus menyembunyikan origin_id toko dari bundel klien.
// Logika bisnisnya tidak berubah: respons Mengantar diteruskan apa adanya, pemetaan/pengurutan
// kurir tetap di src/lib/mengantar.ts.

import { NextResponse } from 'next/server'
import { RATE_LIMITS, enforceRateLimit, getClientIp } from '@/lib/rate-limit'
import { mengantarEstimateUrl } from '@/lib/mengantar-host'
import { getQuoteOriginId, resolveWarehouseForOrder } from '@/lib/warehouse'
import type { StockRequirement } from '@/lib/warehouse'

// createAdminClient (dipakai lapisan gudang) butuh runtime Node.js, bukan Edge
export const runtime = 'nodejs'

// Host mengikuti MENGANTAR_BASE_URL — lihat lib/mengantar-host.ts.

// Mengurai param opsional `items` → daftar kebutuhan stok, untuk memilih gudang asal di mode multi.
// Format ringkas agar tetap satu GET (bisa di-cache & di-rate-limit seperti sekarang):
//   items=<productId>:<qty>[:<variantId>],<productId>:<qty>
// Di mode single param ini diabaikan sepenuhnya oleh resolveWarehouseForOrder.
function parseItemsParam(raw: string | null): StockRequirement[] {
  if (!raw) return []
  const items: StockRequirement[] = []
  for (const entry of raw.split(',')) {
    const [productId, qty, variantId] = entry.split(':')
    const quantity = Number(qty)
    if (!productId || !Number.isFinite(quantity) || quantity <= 0) continue
    items.push(variantId ? { productId, quantity, variantId } : { productId, quantity })
  }
  return items
}

// GET: teruskan cek ongkir ke Mengantar, kembalikan respons mentahnya ({ data: {...} }).
export async function GET(request: Request) {
  const limited = enforceRateLimit(
    `mengantar-ongkir:ip:${getClientIp(request)}`,
    RATE_LIMITS.MENGANTAR_IP,
  )
  if (limited) return limited

  const { searchParams } = new URL(request.url)
  const destinationId = (searchParams.get('destination_id') ?? '').trim()
  const weight = Number(searchParams.get('weight'))

  if (!destinationId || !Number.isFinite(weight) || weight <= 0) {
    return NextResponse.json({ error: 'Parameter tujuan/berat tidak valid.' }, { status: 400 })
  }

  // Endpoint ini melayani SATU gudang saja (jalur lama). Perbandingan ongkir antar gudang untuk
  // checkout ada di /api/mengantar/shipping/options — lihat catatan di file itu.
  // Origin kutipan lewat getQuoteOriginId: MENGANTAR_PICKUP_ORIGIN_ID menang bila di-set (agar harga
  // yang dikutip = harga yang ditagih saat booking), sisanya origin gudang lalu env lama — jadi
  // ongkir tak pernah mati hanya karena data gudang belum lengkap.
  const warehouse = await resolveWarehouseForOrder(parseItemsParam(searchParams.get('items')))
  const originId = await getQuoteOriginId(warehouse?.id)

  if (!originId) {
    return NextResponse.json({ error: 'Konfigurasi pengiriman belum lengkap.' }, { status: 500 })
  }

  const params = new URLSearchParams({
    origin_id: originId,
    destination_id: destinationId,
    weight: String(weight),
  })

  try {
    const res = await fetch(`${mengantarEstimateUrl()}?${params.toString()}`)
    if (!res.ok) throw new Error(`Upstream ${res.status}`)
    const json = await res.json()
    return NextResponse.json(json)
  } catch {
    return NextResponse.json({ error: 'Gagal memuat ongkos kirim.' }, { status: 502 })
  }
}
