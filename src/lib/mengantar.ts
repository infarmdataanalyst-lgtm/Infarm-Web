// src/lib/mengantar.ts
// Helper sisi-klien untuk Mengantar Public API:
//  - Pencarian alamat → lewat proxy internal (/api/mengantar/address/search) karena endpoint
//    search tidak mengirim header CORS.
//  - Cek ongkir (allEstimatePublic) → juga lewat proxy internal
//    (/api/mengantar/shipping/estimate). Endpoint Mengantar-nya sendiri mengizinkan CORS, tapi
//    fetch langsung dari browser mustahil di-rate-limit → diproksi agar bisa dibatasi per-IP.
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
  const json = (await res.json().catch(() => ({}))) as { data?: MengantarAddress[]; error?: string }
  // Pakai pesan dari server bila ada (mis. 429 rate limit) agar user tahu harus menunggu
  if (!res.ok) throw new Error(json.error ?? 'Gagal mencari alamat.')
  return json.data ?? []
}

// Mengubah teks UPPERCASE dari Mengantar menjadi Title Case agar enak dibaca
// (mis. 'JAWA BARAT' → 'Jawa Barat'). Hanya untuk tampilan, bukan nilai yang dikirim ke API.
export function toTitleCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

// === Cek ongkir (allEstimatePublic) ===

// Proxy internal cek ongkir (origin_id toko diisi di server, sekaligus titik rate limit per-IP)
const ESTIMATE_URL = '/api/mengantar/shipping/estimate'

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
  const params = new URLSearchParams({
    destination_id: destinationId,
    weight: String(weight),
  })

  const res = await fetch(`${ESTIMATE_URL}?${params.toString()}`, { signal })
  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean
    data?: Record<string, RawCourierEstimate>
    error?: string
  }
  // Pakai pesan dari server bila ada (mis. 429 rate limit)
  if (!res.ok) throw new Error(json.error ?? 'Gagal memuat ongkos kirim.')

  const data = json.data ?? {}

  return Object.entries(data).map(([id, raw]) => ({
    id,
    name: COURIER_DISPLAY_NAMES[id] ?? id,
    price: Number(raw.estimatedSpecialPrice ?? 0),
    estimatedDate: String(raw.estimatedDate ?? ''),
    unsupported: raw.unsupported === true,
  }))
}
