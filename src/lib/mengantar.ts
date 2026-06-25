// src/lib/mengantar.ts
// Helper sisi-klien untuk Mengantar Public API:
//  - Pencarian alamat → lewat proxy internal (/api/mengantar) karena endpoint search tanpa CORS.
//  - Cek ongkir (allEstimatePublic) → langsung dari client (endpoint ini mengizinkan CORS & tanpa key).
// _id alamat terpilih (destination_id) dipakai sebagai tujuan saat cek ongkir.

// Satu hasil alamat Mengantar (field yang dipakai checkout)
export type MengantarAddress = {
  _id: string
  PROVINCE_NAME: string
  CITY_NAME: string
  DISTRICT_NAME: string
  SUBDISTRICT_NAME: string
  ZIP_CODE: string
}

// Satu pilihan kurir hasil cek ongkir (sudah diringkas dari response Mengantar)
export type ShippingCourier = {
  id: string // key kurir dari response (mis. 'JNE')
  name: string // nama tampilan
  price: number // estimatedSpecialPrice (harga ongkir final)
  estimatedDate: string // estimatedDate (mis. '2-4 hari')
  unsupported: boolean // true = tidak melayani alamat tujuan
}

// Mencari alamat berdasarkan keyword (kelurahan/kecamatan/kota). Mengembalikan daftar hasil.
// Pemanggil bertanggung jawab atas debounce & syarat minimal panjang keyword.
export async function searchAddress(
  keyword: string,
  signal?: AbortSignal,
): Promise<MengantarAddress[]> {
  const res = await fetch(`/api/mengantar/address/search?keyword=${encodeURIComponent(keyword)}`, {
    signal,
  })
  if (!res.ok) throw new Error('Gagal mencari alamat.')
  const data = (await res.json()) as { data: MengantarAddress[] }
  return data.data ?? []
}

// Mengubah teks UPPERCASE dari Mengantar menjadi Title Case agar enak dibaca
// (mis. 'JAWA BARAT' → 'Jawa Barat'). Hanya untuk tampilan, bukan nilai yang dikirim ke API.
export function toTitleCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

// === Cek ongkir (allEstimatePublic) ===

// Origin (alamat toko) untuk cek ongkir — dari env, jangan hardcode di kode.
const ORIGIN_ID = process.env.NEXT_PUBLIC_MENGANTAR_ORIGIN_ID ?? ''

// Endpoint cek ongkir publik (mengizinkan CORS → boleh dipanggil langsung dari client)
const ESTIMATE_URL = 'https://app.mengantar.com/api/order/allEstimatePublic'

// Nama tampilan kurir (key respons → label ramah). Fallback ke key bila tak ada di peta.
const COURIER_DISPLAY_NAMES: Record<string, string> = {
  JNE: 'JNE',
  JNECargo: 'JNE Cargo',
  SiCepat: 'SiCepat',
  SiCepatCargo: 'SiCepat Cargo',
  SAP: 'SAP',
  SAPLite: 'SAP Lite',
  SapCargo: 'SAP Cargo',
  iDexpress: 'ID Express',
  iDlite: 'ID Express Lite',
  iDexpressCargo: 'ID Express Cargo',
  JT: 'J&T',
  lion: 'Lion Parcel',
  anteraja: 'AnterAja',
  paxel: 'Paxel',
  Ninja: 'Ninja Xpress',
  pos: 'POS Indonesia',
}

// Bentuk satu entri kurir mentah dari respons (field yang dipakai saja)
type RawCourierEstimate = {
  estimatedSpecialPrice?: number
  estimatedDate?: string
  unsupported?: boolean
}

// Mengambil daftar ongkir dari toko (origin) ke alamat tujuan (destination) untuk berat tertentu (kg).
// Mengembalikan SEMUA kurir (termasuk unsupported); pemanggil yang memfilter & mengurutkan.
export async function fetchShippingEstimate(
  destinationId: string,
  weight: number,
  signal?: AbortSignal,
): Promise<ShippingCourier[]> {
  if (!ORIGIN_ID) {
    throw new Error('NEXT_PUBLIC_MENGANTAR_ORIGIN_ID belum diset di environment.')
  }

  const params = new URLSearchParams({
    origin_id: ORIGIN_ID,
    destination_id: destinationId,
    weight: String(weight),
  })

  const res = await fetch(`${ESTIMATE_URL}?${params.toString()}`, { signal })
  if (!res.ok) throw new Error('Gagal memuat ongkos kirim.')

  const json = (await res.json()) as { success?: boolean; data?: Record<string, RawCourierEstimate> }
  const data = json.data ?? {}

  return Object.entries(data).map(([id, raw]) => ({
    id,
    name: COURIER_DISPLAY_NAMES[id] ?? id,
    price: Number(raw.estimatedSpecialPrice ?? 0),
    estimatedDate: String(raw.estimatedDate ?? ''),
    unsupported: raw.unsupported === true,
  }))
}
