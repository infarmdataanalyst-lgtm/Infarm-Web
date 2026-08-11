// src/lib/warehouse.ts
// Lapisan terpusat pergudangan — SATU-SATUNYA tempat kode lain boleh bertanya
// "gudang mana?" dan "stok efektifnya berapa?". SERVER ONLY (memanggil mock-db/warehouses
// yang memakai service_role).
//
// Kenapa terpusat: supaya peralihan mode 1 gudang ↔ multi gudang cukup mengubah satu env
// (WAREHOUSE_MODE) tanpa menyentuh route/komponen mana pun. Pemanggil TIDAK boleh membaca
// process.env.WAREHOUSE_MODE, process.env.*MENGANTAR_ORIGIN_ID, atau kolom stok mentah sendiri.
//
// MODE OPERASI SISTEM = 'multi' (gudang cabang) — keputusan bisnis 2026-08-11, sudah final.
// Env kosong/typo/tak diset → 'multi', jadi tak ada deployment yang diam-diam kembali ke satu
// gudang hanya karena env belum diisi. `WAREHOUSE_MODE=single` kini berfungsi sebagai TUAS
// ROLLBACK darurat saja (mis. data gudang cabang belum siap), bukan mode normal.

import type { StockTarget, Warehouse, WarehouseMode } from '@/types/warehouse'
import {
  adjustWarehouseStock,
  getDefaultWarehouseRow,
  getWarehouseById,
  readStockRows,
  readWarehouses,
  setWarehouseStock,
} from '@/lib/mock-db/warehouses'

// === Mode ===

// Membaca mode pergudangan dari env. HANYA nilai eksplisit 'single' yang menurunkan sistem ke
// satu gudang; apa pun selain itu (termasuk env tak diset) → 'multi', sesuai mode operasi resmi.
export function getWarehouseMode(): WarehouseMode {
  return process.env.WAREHOUSE_MODE?.trim().toLowerCase() === 'single' ? 'single' : 'multi'
}

// true bila sistem sedang menjalankan lebih dari satu gudang.
export function isMultiWarehouse(): boolean {
  return getWarehouseMode() === 'multi'
}

// === Gudang ===

// Mengambil gudang default (is_default = true). null bila tabel/baris belum ada — pemanggil
// wajib tetap berfungsi tanpanya (fallback ke env origin id / kolom stok lama).
export async function getDefaultWarehouse(): Promise<Warehouse | null> {
  return getDefaultWarehouseRow()
}

// Titik koordinat tujuan pengiriman (opsional). Mengantar TIDAK mengembalikan lat/long pada
// hasil pencarian alamat, jadi selama sumber koordinat belum ada, parameter ini undefined dan
// pemilihan gudang jatuh ke urutan berjenjang di resolveWarehouseForOrder.
export type DestinationPoint = { latitude: number; longitude: number }

// Item yang perlu dipenuhi satu gudang. Bentuk minimal agar bisa dipanggil dari mana saja
// (keranjang, cek ongkir, pembuatan order) tanpa menyeret tipe CartItem/OrderItem.
export type StockRequirement = StockTarget & { quantity: number }

// Menentukan gudang mana yang memenuhi satu pesanan.
//
// Mode single  : LANGSUNG gudang default — tanpa query stok, tanpa hitung jarak sama sekali.
// Mode multi   : hanya gudang aktif yang stoknya cukup untuk SELURUH item; diurutkan berdasarkan
//                jarak terdekat ke tujuan (Haversine) bila koordinat tujuan & gudang tersedia.
//                Tidak ada yang memenuhi → fallback ke gudang default (pesanan tetap bisa dibuat,
//                kekurangan stok ditangani RPC checkout yang akan menolak secara atomik).
export async function resolveWarehouseForOrder(
  orderItems: StockRequirement[],
  destinationId?: string,
  destination?: DestinationPoint,
): Promise<Warehouse | null> {
  if (!isMultiWarehouse()) return getDefaultWarehouse()

  const [warehouses, fallback] = await Promise.all([readWarehouses(true), getDefaultWarehouse()])
  if (warehouses.length === 0) return fallback

  const needed = mergeRequirements(orderItems)
  if (needed.length === 0) return fallback

  // Satu query untuk semua produk yang dibutuhkan (hindari N+1 per gudang).
  const rows = await readStockRows({ productIds: [...new Set(needed.map((n) => n.productId))] })

  // stok[warehouseId][kunci produk/varian] = jumlah
  const perWarehouse = new Map<string, Map<string, number>>()
  for (const row of rows) {
    const byKey = perWarehouse.get(row.warehouseId) ?? new Map<string, number>()
    byKey.set(stockKey(row), row.stok)
    perWarehouse.set(row.warehouseId, byKey)
  }

  const eligible = warehouses.filter((w) => {
    const byKey = perWarehouse.get(w.id)
    if (!byKey) return false
    return needed.every((n) => (byKey.get(stockKey(n)) ?? 0) >= n.quantity)
  })

  if (eligible.length === 0) return fallback

  // Tanpa koordinat tujuan, "terdekat" tak bisa dihitung → dahulukan gudang default agar
  // hasilnya deterministik, bukan bergantung urutan baris dari DB.
  if (!destination) {
    return eligible.find((w) => w.isDefault) ?? eligible[0]
  }

  const withDistance = eligible.map((w) => ({
    warehouse: w,
    // Gudang tanpa koordinat ditaruh paling belakang (Infinity), bukan dianggap jarak 0.
    distance:
      w.latitude !== undefined && w.longitude !== undefined
        ? haversineDistanceKm(
            { latitude: w.latitude, longitude: w.longitude },
            destination,
          )
        : Number.POSITIVE_INFINITY,
  }))
  withDistance.sort((a, b) => a.distance - b.distance)
  return withDistance[0]?.warehouse ?? fallback
}

// Mengambil origin_id Mengantar (kelurahan asal kirim) milik satu gudang.
// Fallback berjenjang: kolom DB → env server-only → env NEXT_PUBLIC lama. String kosong bila
// semuanya kosong; pemanggil harus memperlakukannya sebagai "konfigurasi belum lengkap".
export async function getOriginIdForWarehouse(warehouseId?: string): Promise<string> {
  const warehouse = warehouseId ? await getWarehouseById(warehouseId) : await getDefaultWarehouse()
  return (
    warehouse?.mengantarOriginId?.trim() ||
    process.env.MENGANTAR_ORIGIN_ID?.trim() ||
    process.env.NEXT_PUBLIC_MENGANTAR_ORIGIN_ID?.trim() ||
    ''
  )
}

// === Stok efektif ===

// Stok yang "berlaku" untuk satu produk/varian.
//
// Mode single : JUMLAH stok produk itu di SEMUA gudang → satu angka, seperti yang dilihat
//               pembeli sekarang (tak ada konsep gudang di UI).
// Mode multi  : stok di gudang tertentu; `warehouseId` wajib diisi. Bila tidak diisi, nilainya
//               dijumlahkan seperti mode single agar pemanggil lama tidak mendadak dapat 0.
//
// null bila tabel gudang belum di-migrate / produk belum punya baris stok — pemanggil harus
// jatuh ke kolom stok lama (products.stock / product_variants.stok).
export async function getEffectiveStock(
  productId: string,
  options?: { variantId?: string; warehouseId?: string },
): Promise<number | null> {
  const rows = await readStockRows({ productIds: [productId] })
  if (rows.length === 0) return null

  const wantVariant = options?.variantId
  const relevant = rows.filter((r) =>
    wantVariant ? r.variantId === wantVariant : r.variantId === undefined,
  )
  if (relevant.length === 0) return null

  const warehouseId = isMultiWarehouse() ? options?.warehouseId : undefined
  if (warehouseId) {
    const row = relevant.find((r) => r.warehouseId === warehouseId)
    return row ? row.stok : null
  }

  return relevant.reduce((total, r) => total + r.stok, 0)
}

// Versi BATCH dari getEffectiveStock — wajib dipakai untuk daftar produk (katalog, keranjang,
// tabel OMS). Tanpa ini, memanggil getEffectiveStock per produk = N+1 query ke Supabase.
//
// Mengembalikan dua peta: `byProduct` (stok produk tanpa varian) dan `byVariant` (per varian).
// Peta kosong bila tabel belum di-migrate → pemanggil memakai kolom stok lama.
export async function getEffectiveStockMaps(
  productIds?: string[],
  options?: { warehouseId?: string },
): Promise<{ byProduct: Map<string, number>; byVariant: Map<string, number> }> {
  const rows = await readStockRows(productIds ? { productIds } : undefined)
  const byProduct = new Map<string, number>()
  const byVariant = new Map<string, number>()

  const warehouseId = isMultiWarehouse() ? options?.warehouseId : undefined

  for (const row of rows) {
    // Mode multi dengan gudang spesifik → abaikan baris gudang lain.
    if (warehouseId && row.warehouseId !== warehouseId) continue
    if (row.variantId) {
      byVariant.set(row.variantId, (byVariant.get(row.variantId) ?? 0) + row.stok)
    } else {
      byProduct.set(row.productId, (byProduct.get(row.productId) ?? 0) + row.stok)
    }
  }

  return { byProduct, byVariant }
}

// Menyimpan stok absolut ke gudang. Mode single → selalu gudang default (admin tak perlu
// memilih gudang di form). false bila gudang/tabel belum ada → pemanggil tetap menulis
// kolom stok lama sebagai satu-satunya sumber (perilaku sebelum migration).
export async function writeEffectiveStock(input: {
  productId: string
  variantId?: string
  stok: number
  warehouseId?: string
}): Promise<boolean> {
  const warehouseId = input.warehouseId ?? (await getDefaultWarehouse())?.id
  if (!warehouseId) return false
  return setWarehouseStock({
    productId: input.productId,
    variantId: input.variantId,
    warehouseId,
    stok: input.stok,
  })
}

// Satu entri rincian stok per gudang dari form OMS.
export type StockPerWarehouseInput = { warehouseId: string; stok: number }

// Memvalidasi & menormalkan payload `stockPerWarehouse` dari route handler.
// undefined bila key tak dikirim (mode single / klien lama) → pemanggil pakai `stock` tunggal.
// Pesan error dikembalikan sebagai string agar route bisa membalas 422 dengan alasan yang jelas.
export function parseStockPerWarehouse(
  raw: unknown,
): { entries?: StockPerWarehouseInput[]; error?: string } {
  if (raw === undefined || raw === null) return {}
  if (!Array.isArray(raw)) return { error: 'Rincian stok per gudang tidak valid.' }

  const entries: StockPerWarehouseInput[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) {
      return { error: 'Rincian stok per gudang tidak valid.' }
    }
    const { warehouseId, stok } = item as Record<string, unknown>
    if (typeof warehouseId !== 'string' || warehouseId.trim().length === 0) {
      return { error: 'ID gudang pada rincian stok tidak valid.' }
    }
    if (typeof stok !== 'number' || !Number.isFinite(stok) || stok < 0) {
      return { error: 'Nilai stok per gudang tidak valid.' }
    }
    entries.push({ warehouseId, stok: Math.floor(stok) })
  }
  return { entries }
}

// Menyimpan rincian stok per gudang satu produk (mode multi).
// Dipakai /api/products/{create,update} SETELAH produknya tersimpan.
export async function writeStockPerWarehouse(
  productId: string,
  entries: StockPerWarehouseInput[],
): Promise<void> {
  for (const entry of entries) {
    await setWarehouseStock({
      productId,
      warehouseId: entry.warehouseId,
      stok: entry.stok,
    })
  }
}

// Mengembalikan stok ke gudang saat pesanan dibatalkan (delta positif).
// `warehouseId` = gudang pesanan tsb (orders.warehouse_id); kosong → gudang default.
export async function returnStockToWarehouse(
  items: StockRequirement[],
  warehouseId?: string,
): Promise<void> {
  const targetId = warehouseId ?? (await getDefaultWarehouse())?.id
  if (!targetId) return
  for (const item of mergeRequirements(items)) {
    await adjustWarehouseStock({
      productId: item.productId,
      variantId: item.variantId,
      warehouseId: targetId,
      delta: item.quantity,
    })
  }
}

// === Jarak (Haversine) ===

const EARTH_RADIUS_KM = 6371

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180
}

// Jarak dua titik bumi dalam kilometer (rumus Haversine, tanpa library eksternal).
// Cukup akurat untuk memilih gudang terdekat; bukan jarak tempuh jalan raya.
export function haversineDistanceKm(a: DestinationPoint, b: DestinationPoint): number {
  const dLat = toRadians(b.latitude - a.latitude)
  const dLon = toRadians(b.longitude - a.longitude)
  const lat1 = toRadians(a.latitude)
  const lat2 = toRadians(b.latitude)

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

// === Util internal ===

// Kunci gabungan produk+varian. Produk tanpa varian dan varian-nya sendiri TIDAK boleh
// bertabrakan, karena stoknya disimpan di baris berbeda.
function stockKey(target: StockTarget): string {
  return `${target.productId}::${target.variantId ?? ''}`
}

// Menjumlahkan kuantitas item yang menunjuk produk/varian sama (mis. produk muncul dua kali
// karena satu baris biasa + satu baris hadiah promo) agar pengecekan stok tidak kelewat longgar.
function mergeRequirements(items: StockRequirement[]): StockRequirement[] {
  const merged = new Map<string, StockRequirement>()
  for (const item of items) {
    if (!item.productId || !item.quantity || item.quantity <= 0) continue
    const key = stockKey(item)
    const prev = merged.get(key)
    if (prev) prev.quantity += item.quantity
    else merged.set(key, { ...item })
  }
  return [...merged.values()]
}
