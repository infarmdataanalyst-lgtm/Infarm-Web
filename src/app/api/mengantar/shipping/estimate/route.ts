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

const ESTIMATE_URL = 'https://app.mengantar.com/api/order/allEstimatePublic'

// Origin (alamat toko). Utamakan var server-only; NEXT_PUBLIC_* tetap didukung agar env lama jalan.
const ORIGIN_ID =
  process.env.MENGANTAR_ORIGIN_ID ?? process.env.NEXT_PUBLIC_MENGANTAR_ORIGIN_ID ?? ''

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
  if (!ORIGIN_ID) {
    return NextResponse.json({ error: 'Konfigurasi pengiriman belum lengkap.' }, { status: 500 })
  }

  const params = new URLSearchParams({
    origin_id: ORIGIN_ID,
    destination_id: destinationId,
    weight: String(weight),
  })

  try {
    const res = await fetch(`${ESTIMATE_URL}?${params.toString()}`)
    if (!res.ok) throw new Error(`Upstream ${res.status}`)
    const json = await res.json()
    return NextResponse.json(json)
  } catch {
    return NextResponse.json({ error: 'Gagal memuat ongkos kirim.' }, { status: 502 })
  }
}
