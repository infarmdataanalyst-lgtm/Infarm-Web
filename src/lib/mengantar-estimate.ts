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

// === Kurir yang diizinkan ditawarkan ke pembeli ===

// Kode kurir J&T pada respons allEstimatePublic. Terverifikasi lewat probe 4 rute: key-nya PERSIS
// 'JT' — dua huruf kapital, tanpa '&' dan tanpa spasi. Nama "J&T" hanya ada di
// COURIER_DISPLAY_NAMES (label tampilan kita), BUKAN di respons Mengantar.
export const JT_COURIER_ID = 'JT'

// Label yang disimpan ke orders.nama_ekspedisi & ditampilkan di OMS.
// Dipisah dari kode API supaya kolom DB tak berisi 'JT' yang tak bermakna bagi admin.
export const JT_COURIER_LABEL = 'J&T'

// Daftar putih kurir yang boleh ditawarkan. Saat ini hanya J&T (keputusan bisnis: satu kurir agar
// booking & penanganan resi seragam).
//
// Dicocokkan EKSAK, bukan substring 'jt' case-insensitive. Alasannya: respons memuat 16 key
// (JNE, JNECargo, SiCepat, SAPLite, iDexpress, JT, lion, anteraja, paxel, Ninja, pos, …) dan
// pencocokan substring akan ikut menyambar kurir lain begitu Mengantar menambah key baru yang
// kebetulan memuat huruf itu — pembeli tiba-tiba ditawari layanan yang belum kita dukung booking-nya.
// Menambah layanan lain = tambah satu entri di sini, bukan melonggarkan pencocokan.
const ALLOWED_COURIER_IDS = new Set<string>([JT_COURIER_ID])

// Apakah kurir ini boleh ditawarkan ke pembeli. DIPAKAI DI SISI SERVER — kurir yang tak lolos
// tak pernah melewati batas jaringan, jadi tak ada kedipan daftar kurir lain sebelum tersaring.
export function isAllowedCourier(courier: ShippingCourier): boolean {
  return ALLOWED_COURIER_IDS.has(courier.id)
}

// Kurir yang lolos SEMUA syarat: diizinkan bisnis + benar-benar melayani rute.
export function isOfferableCourier(courier: ShippingCourier): boolean {
  return isAllowedCourier(courier) && isSelectableCourier(courier)
}

// === Dedupe untuk tampilan pembeli ===

// Menyisakan SATU baris per kode kurir: yang termurah.
//
// Daftar mentah adalah gabungan hasil beberapa gudang, jadi kurir yang sama muncul sekali per
// gudang. Sejak kurir dibatasi J&T, pembeli melihat dua baris berlabel identik ("J&T", estimasi
// sama) yang hanya beda harga — tanpa cara apa pun untuk membedakannya, dan tanpa alasan seseorang
// memilih yang lebih mahal. Gudang asal memang bukan urusan pembeli (lihat header
// ShippingOptions.tsx), jadi yang ditawarkan cukup harga terbaik untuk kurir itu.
//
// PENTING: dipakai HANYA untuk respons ke pembeli. Daftar LENGKAP tetap disimpan di cache
// perbandingan ongkir, karena pembuatan order memakainya untuk jatuh ke gudang termurah BERIKUTNYA
// bila gudang pilihan gagal verifikasi stok. Men-dedupe sebelum cache akan menghapus jalur itu.
//
// Generik atas T supaya bisa dipakai untuk ShippingCourier maupun WarehouseShippingOption.
export function cheapestPerCourier<T extends { id: string; price: number }>(options: T[]): T[] {
  const best = new Map<string, T>()
  for (const o of options) {
    const current = best.get(o.id)
    if (!current || o.price < current.price) best.set(o.id, o)
  }
  return [...best.values()].sort((a, b) => a.price - b.price)
}
