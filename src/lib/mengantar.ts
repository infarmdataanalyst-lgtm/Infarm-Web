// src/lib/mengantar.ts
// Helper sisi-klien untuk Mengantar Public API:
//  - Pencarian alamat → lewat proxy internal (/api/mengantar/address/search) karena endpoint
//    search tidak mengirim header CORS.
//  - Cek ongkir (allEstimatePublic) → juga lewat proxy internal
//    (/api/mengantar/shipping/estimate). Endpoint Mengantar-nya sendiri mengizinkan CORS, tapi
//    fetch langsung dari browser mustahil di-rate-limit → diproksi agar bisa dibatasi per-IP.
// _id alamat terpilih (destination_id) dipakai sebagai tujuan saat cek ongkir.

import {
  mapCourierEstimates,
  type RawCourierEstimate,
  type ShippingCourier as ShippingCourierType,
} from '@/lib/mengantar-estimate'

// Satu hasil alamat Mengantar (field yang dipakai checkout)
export type MengantarAddress = {
  _id: string
  PROVINCE_NAME: string
  CITY_NAME: string
  DISTRICT_NAME: string
  SUBDISTRICT_NAME: string
  ZIP_CODE: string
}

// Tipe & pemetaan kurir dipindah ke src/lib/mengantar-estimate.ts agar bisa dipakai server juga
// (perbandingan ongkir antar gudang). Di-re-export supaya import lama tetap jalan.
export type { ShippingCourier } from '@/lib/mengantar-estimate'

// Satu pilihan kurir BESERTA gudang asalnya — hasil perbandingan ongkir multi-gudang.
// `warehouseId` dikirim balik saat membuat order agar server tahu gudang mana yang dipilih buyer
// (dan tetap memvalidasinya ulang; client tak dipercaya).
export type WarehouseShippingOption = ShippingCourierType & {
  warehouseId: string
  warehouseName: string
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

// Endpoint perbandingan ongkir multi-gudang (POST — isi keranjang ikut dikirim)
const OPTIONS_URL = '/api/mengantar/shipping/options'

// Mengambil pilihan kurir dari SELURUH gudang yang stoknya cukup, sudah diurutkan termurah.
// Inilah jalur yang dipakai checkout: gudang pemenuh ditentukan oleh ongkir riil, bukan jarak.
// `reason` terisi bila daftarnya kosong: 'NO_JT_SERVICE' (J&T tak melayani alamat itu — kurir lain
// TIDAK ditawarkan, lihat daftar putih di mengantar-estimate.ts) atau 'ESTIMATE_UNAVAILABLE'
// (semua gudang gagal/timeout → layak dicoba ulang).
export async function fetchShippingOptions(
  destinationId: string,
  weight: number,
  items: { productId: string; quantity: number; variantId?: string }[],
  signal?: AbortSignal,
): Promise<{ options: WarehouseShippingOption[]; reason?: string }> {
  const res = await fetch(OPTIONS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ destinationId, weight, items }),
    signal,
  })
  const json = (await res.json().catch(() => ({}))) as {
    options?: WarehouseShippingOption[]
    reason?: string
    error?: string
  }
  if (!res.ok) throw new Error(json.error ?? 'Gagal memuat ongkos kirim.')
  return { options: json.options ?? [], reason: json.reason }
}

// Cek ongkir SATU gudang (gudang default) — jalur lama, TANPA pemanggil saat ini.
// Mengembalikan SEMUA kurir (termasuk unsupported) dan TIDAK menerapkan daftar putih J&T.
// ⚠️ Jangan pakai ini untuk checkout: hasilnya menawarkan kurir yang booking-nya belum kita dukung.
// Pakai fetchShippingOptions di atas. Bila kelak dipakai lagi, saring dengan isOfferableCourier()
// dari @/lib/mengantar-estimate.
export async function fetchShippingEstimate(
  destinationId: string,
  weight: number,
  signal?: AbortSignal,
): Promise<ShippingCourierType[]> {
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

  return mapCourierEstimates(json.data)
}
