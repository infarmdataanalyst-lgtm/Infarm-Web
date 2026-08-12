// src/lib/mengantar-estimate.ts
// Pemetaan respons cek ongkir Mengantar (allEstimatePublic) → daftar kurir yang dipakai UI.
// Modul MURNI (tanpa fetch, tanpa akses DB) supaya bisa dipakai DUA sisi:
//   - server: membandingkan ongkir beberapa gudang sekaligus (src/lib/warehouse-shipping.ts)
//   - client: memanggil proxy internal (src/lib/mengantar.ts)
// Sebelumnya logika ini hanya ada di sisi klien, sehingga server tak bisa menilai ongkir sendiri.

// Satu pilihan kurir yang sudah diringkas dari respons Mengantar.
export type ShippingCourier = {
  id: string // key kurir dari response (mis. 'JNE')
  name: string // nama tampilan
  price: number // estimatedSpecialPrice (ongkir final yang dibayar)
  estimatedDate: string // estimatedDate (mis. '2-4 hari')
  unsupported: boolean // true = kurir tidak melayani alamat tujuan
}

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
export type RawCourierEstimate = {
  estimatedSpecialPrice?: number
  estimatedDate?: string
  unsupported?: boolean
}

// Mengubah objek per-kurir dari Mengantar menjadi array ShippingCourier.
// Mengembalikan SEMUA kurir termasuk `unsupported` — penyaringan & pengurutan milik pemanggil,
// karena aturannya beda per konteks (satu gudang vs gabungan beberapa gudang).
export function mapCourierEstimates(
  data: Record<string, RawCourierEstimate> | undefined | null,
): ShippingCourier[] {
  if (!data) return []
  return Object.entries(data).map(([id, raw]) => ({
    id,
    name: COURIER_DISPLAY_NAMES[id] ?? id,
    price: Number(raw?.estimatedSpecialPrice ?? 0),
    estimatedDate: String(raw?.estimatedDate ?? ''),
    unsupported: raw?.unsupported === true,
  }))
}

// Kurir yang benar-benar bisa dipilih buyer: dilayani & harganya masuk akal (> 0).
// Harga 0 muncul untuk kurir yang tak melayani rute — menampilkannya sebagai "gratis" menyesatkan.
export function isSelectableCourier(courier: ShippingCourier): boolean {
  return !courier.unsupported && courier.price > 0
}
