// src/lib/warehouse-validation.ts
// Validasi payload gudang — dipakai form OMS (client) DAN route handler (server).
// Satu sumber aturan agar pesan error di layar sama dengan yang ditegakkan server.

// Batas panjang teks. Nama gudang wajib; alamat & origin id opsional.
export const WAREHOUSE_NAME_MIN = 3
export const WAREHOUSE_NAME_MAX = 100
export const WAREHOUSE_ADDRESS_MAX = 300

// origin_id Mengantar = ObjectId 24 karakter hex (mis. 5fc6461ef8f44b34aa4cd807).
export const MENGANTAR_ORIGIN_ID_REGEX = /^[a-f0-9]{24}$/i

// Field yang bisa punya error, dipakai form untuk menandai input & auto-scroll.
export type WarehouseFieldKey = 'nama' | 'alamat' | 'mengantarOriginId' | 'latitude' | 'longitude'

// Urutan field pada form → menentukan field pertama yang di-fokus saat submit gagal.
export const WAREHOUSE_FIELD_ORDER: WarehouseFieldKey[] = [
  'nama',
  'alamat',
  'mengantarOriginId',
  'latitude',
  'longitude',
]

// Nilai form gudang. Koordinat memakai '' (bukan 0) untuk "belum diisi" — 0,0 adalah titik nyata
// di Samudra Atlantik, jadi tidak boleh dipakai sebagai penanda kosong.
export type WarehouseFormValues = {
  nama: string
  alamat: string
  mengantarOriginId: string
  latitude: number | ''
  longitude: number | ''
}

export type WarehouseErrors = Partial<Record<WarehouseFieldKey, string>>

// Validasi nama gudang (wajib).
export function validateWarehouseName(value: string): string | undefined {
  const trimmed = value.trim()
  if (trimmed.length === 0) return 'Nama gudang wajib diisi.'
  if (trimmed.length < WAREHOUSE_NAME_MIN) return `Nama minimal ${WAREHOUSE_NAME_MIN} karakter.`
  if (trimmed.length > WAREHOUSE_NAME_MAX) return `Nama maksimal ${WAREHOUSE_NAME_MAX} karakter.`
  return undefined
}

// Validasi alamat (opsional, hanya dibatasi panjangnya).
export function validateWarehouseAddress(value: string): string | undefined {
  if (value.trim().length > WAREHOUSE_ADDRESS_MAX)
    return `Alamat maksimal ${WAREHOUSE_ADDRESS_MAX} karakter.`
  return undefined
}

// Validasi origin id Mengantar (opsional). Bila diisi, formatnya harus ObjectId 24 hex —
// salah format berarti cek ongkir dari gudang ini akan gagal saat dipakai.
export function validateMengantarOriginId(value: string): string | undefined {
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  if (!MENGANTAR_ORIGIN_ID_REGEX.test(trimmed))
    return 'Format origin id tidak valid (24 karakter hex, mis. 5fc6461ef8f44b34aa4cd807).'
  return undefined
}

// Validasi latitude (opsional, -90..90).
export function validateLatitude(value: number | ''): string | undefined {
  if (value === '') return undefined
  if (!Number.isFinite(value)) return 'Latitude tidak valid.'
  if (value < -90 || value > 90) return 'Latitude harus antara -90 dan 90.'
  return undefined
}

// Validasi longitude (opsional, -180..180).
export function validateLongitude(value: number | ''): string | undefined {
  if (value === '') return undefined
  if (!Number.isFinite(value)) return 'Longitude tidak valid.'
  if (value < -180 || value > 180) return 'Longitude harus antara -180 dan 180.'
  return undefined
}

// Mengubah body JSON mentah (dari route handler) menjadi bentuk form yang bisa divalidasi,
// sehingga server memakai aturan yang sama persis dengan form. Nilai bertipe salah dianggap kosong
// lalu ditolak oleh validator — bukan diam-diam dipaksa jadi 0.
export function toWarehouseFormValues(body: Record<string, unknown>): WarehouseFormValues {
  const num = (v: unknown): number | '' => (typeof v === 'number' && Number.isFinite(v) ? v : '')
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  return {
    nama: str(body.nama),
    alamat: str(body.alamat),
    mengantarOriginId: str(body.mengantarOriginId),
    latitude: num(body.latitude),
    longitude: num(body.longitude),
  }
}

// Validasi seluruh form. Objek kosong = lolos.
//
// Koordinat divalidasi BERPASANGAN: satu titik butuh keduanya. Mengisi latitude saja membuat
// gudang tampak punya koordinat padahal jaraknya tak bisa dihitung (dianggap paling jauh).
export function validateWarehouseForm(values: WarehouseFormValues): WarehouseErrors {
  const errors: WarehouseErrors = {}

  const nama = validateWarehouseName(values.nama)
  if (nama) errors.nama = nama
  const alamat = validateWarehouseAddress(values.alamat)
  if (alamat) errors.alamat = alamat
  const origin = validateMengantarOriginId(values.mengantarOriginId)
  if (origin) errors.mengantarOriginId = origin

  const lat = validateLatitude(values.latitude)
  if (lat) errors.latitude = lat
  const lon = validateLongitude(values.longitude)
  if (lon) errors.longitude = lon

  if (!lat && !lon) {
    if (values.latitude !== '' && values.longitude === '')
      errors.longitude = 'Isi longitude juga — koordinat harus lengkap agar jarak bisa dihitung.'
    if (values.longitude !== '' && values.latitude === '')
      errors.latitude = 'Isi latitude juga — koordinat harus lengkap agar jarak bisa dihitung.'
  }

  return errors
}
