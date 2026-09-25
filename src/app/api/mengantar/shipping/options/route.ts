// src/app/api/mengantar/shipping/options/route.ts
// Cek ongkir MULTI-GUDANG: membandingkan tarif dari setiap gudang yang stoknya cukup, lalu
// mengembalikan gabungan pilihan kurir yang sudah diurutkan termurah.
//   POST { destinationId, weight, items: [{ productId, quantity, variantId? }] }
//
// POST (bukan GET) karena daftar item bisa panjang — URL query punya batas panjang dan isi
// keranjang bukan sesuatu yang perlu tersimpan di riwayat/log URL.
//
// Menggantikan /api/mengantar/shipping/estimate untuk checkout. Endpoint lama dipertahankan
// (satu gudang) agar pemanggil lain tidak rusak.

import { NextResponse } from 'next/server'
import { RATE_LIMITS, enforceRateLimit, getClientIp } from '@/lib/rate-limit'
import { cheapestPerCourier } from '@/lib/mengantar-estimate'
import { resolveShippingOptions } from '@/lib/warehouse-shipping'
import type { StockRequirement } from '@/lib/warehouse'

export const runtime = 'nodejs'

// Batas jumlah item yang diterima — jaring pengaman payload sampah.
const MAX_ITEMS = 100

// Mengurai daftar item dari body. Item cacat dibuang, bukan menggagalkan seluruh request:
// cek ongkir hanya butuh gambaran isi keranjang untuk menilai kelayakan stok gudang.
function parseItems(raw: unknown): StockRequirement[] {
  if (!Array.isArray(raw)) return []
  const items: StockRequirement[] = []
  for (const entry of raw.slice(0, MAX_ITEMS)) {
    if (typeof entry !== 'object' || entry === null) continue
    const { productId, quantity, variantId } = entry as Record<string, unknown>
    if (typeof productId !== 'string' || !productId) continue
    const qty = typeof quantity === 'number' ? Math.floor(quantity) : 0
    if (!Number.isFinite(qty) || qty <= 0) continue
    items.push(
      typeof variantId === 'string' && variantId
        ? { productId, quantity: qty, variantId }
        : { productId, quantity: qty },
    )
  }
  return items
}

export async function POST(request: Request) {
  // Satu request di sini bisa memicu beberapa panggilan ke Mengantar (satu per gudang), jadi
  // pembatasan per-IP justru lebih penting daripada di endpoint satu-gudang.
  const limited = enforceRateLimit(
    `mengantar-ongkir:ip:${getClientIp(request)}`,
    RATE_LIMITS.MENGANTAR_IP,
  )
  if (limited) return limited

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  const destinationId = typeof body.destinationId === 'string' ? body.destinationId.trim() : ''
  const weight = typeof body.weight === 'number' ? body.weight : Number(body.weight)

  if (!destinationId || !Number.isFinite(weight) || weight <= 0) {
    return NextResponse.json({ error: 'Parameter tujuan/berat tidak valid.' }, { status: 400 })
  }

  const items = parseItems(body.items)

  try {
    const result = await resolveShippingOptions(items, destinationId, weight)

    if (result.options.length === 0) {
      // Bedakan "J&T tak melayani alamat itu" dari "semua gudang gagal merespons" supaya UI
      // menyarankan tindakan yang tepat (ganti alamat vs coba lagi).
      //
      // Karena daftar putih kurir kini hanya J&T (lihat isOfferableCourier), gudang yang MENJAWAB
      // tapi tak menghasilkan opsi berarti tepatnya: J&T tak melayani rute itu. Kurir lain memang
      // ada di respons Mengantar, tapi sengaja tidak ditawarkan.
      const reason =
        result.warehousesResponded === 0 ? 'ESTIMATE_UNAVAILABLE' : 'NO_JT_SERVICE'
      return NextResponse.json({ options: [], reason }, { status: 200 })
    }

    // Satu baris per kurir (termurah) untuk pembeli. Daftar LENGKAP tetap di cache server dan
    // dipakai orders/create sebagai jalur fallback gudang — lihat cheapestPerCourier().
    return NextResponse.json({
      options: cheapestPerCourier(result.options),
      warehousesConsidered: result.warehousesConsidered,
      warehousesResponded: result.warehousesResponded,
    })
  } catch {
    return NextResponse.json({ error: 'Gagal memuat ongkos kirim.' }, { status: 502 })
  }
}
