// src/lib/warehouse.ts
// Lapisan terpusat pergudangan — SATU-SATUNYA tempat kode lain boleh bertanya
// "gudang mana?" dan "stok efektifnya berapa?". SERVER ONLY (memanggil mock-db/warehouses
// yang memakai service_role).
//
// Kenapa terpusat: peralihan mode 1 gudang ↔ gudang cabang cukup mengubah SATU baris di
// store_settings tanpa menyentuh route/komponen mana pun. Pemanggil TIDAK boleh membaca
// setting mode, *MENGANTAR_ORIGIN_ID, atau kolom stok mentah sendiri.
//
// MODE OPERASI SISTEM = 'multi' (gudang cabang) — keputusan bisnis 2026-08-11, sudah final.
// Sumber kebenarannya BARIS DATABASE `store_settings.warehouse_mode`, bukan environment variable:
// toko dijalankan satu developer, jadi tuas rollback harus bisa ditarik dari OMS kapan saja tanpa
// redeploy. Env WAREHOUSE_MODE sudah TIDAK dibaca lagi (dihapus agar tak ada dua sumber kebenaran).
//
// Gagal membaca setting (DB down / tabel belum di-migrate) → 'multi', konsisten dengan mode resmi.
// Aman karena query stok per gudang juga akan gagal saat itu, sehingga pemilihan otomatis jatuh
// ke gudang default.

import type { StockTarget, Warehouse, WarehouseMode } from '@/types/warehouse'
import {
  adjustWarehouseStock,
  getDefaultWarehouseRow,
  getWarehouseById,
  readStockRows,
  readWarehouses,
  setWarehouseStock,
} from '@/lib/mock-db/warehouses'
import { getSetting, setSetting, WAREHOUSE_MODE_KEY } from '@/lib/mock-db/settings'

// === Mode ===

// Membaca mode pergudangan dari store_settings. HANYA nilai eksplisit 'single' yang menurunkan
// sistem ke satu gudang; nilai lain / baris tak ada / gagal baca → 'multi' (mode resmi).
export async function getWarehouseMode(): Promise<WarehouseMode> {
  const value = await getSetting(WAREHOUSE_MODE_KEY)
  return value?.trim().toLowerCase() === 'single' ? 'single' : 'multi'
}

// true bila sistem sedang menjalankan lebih dari satu gudang.
export async function isMultiWarehouse(): Promise<boolean> {
  return (await getWarehouseMode()) === 'multi'
}

// Mengubah mode pergudangan (dipakai toggle di OMS → Gudang). Mengembalikan mode tersimpan.
// Nilai divalidasi di sini agar tak ada teks liar masuk ke store_settings.
export async function setWarehouseMode(mode: WarehouseMode): Promise<WarehouseMode> {
  const safe: WarehouseMode = mode === 'single' ? 'single' : 'multi'
  await setSetting(WAREHOUSE_MODE_KEY, safe)
  return safe
}

// === Gudang ===

// Mengambil gudang default (is_default = true). null bila tabel/baris belum ada — pemanggil
// wajib tetap berfungsi tanpanya (fallback ke env origin id / kolom stok lama).
export async function getDefaultWarehouse(): Promise<Warehouse | null> {
  return getDefaultWarehouseRow()
}

// Item yang perlu dipenuhi satu gudang. Bentuk minimal agar bisa dipanggil dari mana saja
// (keranjang, cek ongkir, pembuatan order) tanpa menyeret tipe CartItem/OrderItem.
export type StockRequirement = StockTarget & { quantity: number }

// Menentukan gudang pemenuh pesanan TANPA membandingkan ongkir — dipakai sebagai FALLBACK saja:
// saat buyer tak membawa pilihan kurir (mis. order dibuat lewat jalur lain) atau saat gudang
// pilihannya ternyata sudah tak berstok.
//
// Perbandingan ongkir riil ada di src/lib/warehouse-shipping.ts (resolveShippingOptions) dan
// ITULAH jalur utama pemilihan gudang. Fungsi ini SENGAJA tidak memakai koordinat/jarak: jarak
// lurus bukan ukuran biaya kirim (lihat catatan di warehouse-shipping.ts).
//
// Mode single : LANGSUNG gudang default — tanpa query stok sama sekali.
// Mode multi  : gudang aktif ber-stok cukup untuk SELURUH item, gudang default didahulukan agar
//               hasilnya deterministik. Tak ada yang memenuhi → gudang default (kekurangan stok
//               tetap ditolak atomik oleh RPC checkout).
export async function resolveWarehouseForOrder(
  orderItems: StockRequirement[],
): Promise<Warehouse | null> {
  if (!(await isMultiWarehouse())) return getDefaultWarehouse()

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

  // Gudang default didahulukan agar hasilnya deterministik, bukan bergantung urutan baris dari DB.
  return eligible.find((w) => w.isDefault) ?? eligible[0]
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

// Mengambil _id ALAMAT PENJEMPUTAN Mengantar milik satu gudang — dipakai sebagai `address_id`
// pada POST /time dan `pickup.address_id` pada POST /order.
//
// Kenapa terpisah dari getOriginIdForWarehouse: origin adalah KELURAHAN (dipakai cek ongkir),
// alamat adalah BARIS ALAMAT milik akun kita (dipakai penjemputan & penagihan). Keduanya ObjectId
// 24 hex, jadi kalau dilayani satu fungsi yang sama, tertukarnya tak akan tertangkap tipe mana pun
// dan baru ketahuan saat kurir datang ke gudang yang salah.
//
// Fallback ke MENGANTAR_STORE_ADDRESS_ID DISENGAJA dan TIDAK BOLEH DIHAPUS: pesanan lama
// (orders.warehouse_id NULL) dan gudang yang belum didaftarkan alamatnya tetap harus bisa dibooking.
// String kosong hanya bila env itu pun kosong — pemanggil memperlakukannya sebagai 'not-configured'.
//
// SATU TUAS dengan getQuoteOriginId: selama MENGANTAR_PICKUP_ORIGIN_ID terpasang, fungsi ini SELALU
// mengembalikan alamat lama (lihat isSinglePickupMode). Dipanggil booking kurir (mengantar-shipment.ts)
// dengan orders.warehouse_id pesanan.
export async function getPickupAddressIdForWarehouse(warehouseId?: string): Promise<string> {
  const legacy = process.env.MENGANTAR_STORE_ADDRESS_ID?.trim() || ''
  if (isSinglePickupMode()) return legacy
  const warehouse = warehouseId ? await getWarehouseById(warehouseId) : await getDefaultWarehouse()
  return warehouse?.mengantarAddressId?.trim() || legacy
}

// true selama kutipan ongkir dipaku ke satu origin lewat MENGANTAR_PICKUP_ORIGIN_ID.
//
// KENAPA penjemputan ikut tuas ini, bukan berdiri sendiri: Mengantar menagih dari PICKUP_AUTOFILL
// alamat penjemputan (MGT-58, MGT-60), sedangkan pembeli melihat harga dari origin kutipan. Kalau
// penjemputan pindah ke alamat per gudang sementara kutipan masih dipaku, pesanan Gudang Utama
// (Surabaya) dikutip dari Cengkareng tapi ditagih dari Surabaya — di sandbox Rp5.100 lawan Rp83.400
// ke Jakarta Pusat. Itu insiden INV-20260820-4876 dengan arah terbalik, dan mengenai hampir semua
// pesanan karena Gudang Utama adalah gudang default.
//
// Dengan satu tuas, dua keadaan itu tak mungkin berselisih:
//   env terpasang → kutipan dari origin env,         penjemputan di MENGANTAR_STORE_ADDRESS_ID
//                   (PICKUP_AUTOFILL alamat itu = origin env — pasangan konfigurasi yang sama)
//   env dicabut   → kutipan dari origin tiap gudang, penjemputan di alamat tiap gudang
//                   (PICKUP_AUTOFILL tiap alamat = origin gudangnya — gerbang A3, MGT-62)
// Mencabut env = satu-satunya langkah yang memindahkan KEDUANYA sekaligus.
function isSinglePickupMode(): boolean {
  return Boolean(process.env.MENGANTAR_PICKUP_ORIGIN_ID?.trim())
}

// Seluruh alamat penjemputan yang perlu punya slot pickup harian — dipakai cron.
//
// De-duplikasi DISENGAJA: dua gudang boleh berbagi satu alamat Mengantar (mis. saat gudang baru
// belum didaftarkan alamatnya sendiri). Slot dibuat per ALAMAT, bukan per gudang, karena itulah
// satuan yang dikenal Mengantar — membuat dua slot untuk alamat yang sama hanya menumpuk sampah
// di sistem kurir.
//
// Hanya gudang AKTIF: gudang nonaktif tak memenuhi pesanan, jadi tak ada paket yang perlu dijemput.
// Gudang aktif yang kolomnya masih kosong ikut diwakili oleh MENGANTAR_STORE_ADDRESS_ID, karena
// booking pesanannya jatuh ke alamat itu (getPickupAddressIdForWarehouse) — tanpa slot untuk
// alamat itu, pesanan dari gudang tersebut akan jatuh ke jalur fallback di jalur bayar.
//
// Mode satu alamat (MENGANTAR_PICKUP_ORIGIN_ID terpasang): hanya alamat lama, persis seperti sebelum
// kolom ini ada — booking memang hanya memakai alamat itu (getPickupAddressIdForWarehouse).
export async function listPickupAddressIds(): Promise<string[]> {
  const fallback = process.env.MENGANTAR_STORE_ADDRESS_ID?.trim()
  if (isSinglePickupMode()) return fallback ? [fallback] : []

  const warehouses = await readWarehouses(true)
  const ids = new Set<string>()
  for (const w of warehouses) {
    const id = w.mengantarAddressId?.trim() || fallback
    if (id) ids.add(id)
  }
  // Tabel gudang kosong / belum di-migrate: cron tetap berjalan seperti sebelum kolom ini ada.
  if (ids.size === 0 && fallback) ids.add(fallback)
  return [...ids]
}

// === Origin KUTIPAN ongkir (boleh berbeda dari origin gudang) ===

// Origin yang dipakai untuk MENGUTIP ongkir ke pembeli.
//
// Kenapa terpisah dari getOriginIdForWarehouse: `POST /order` Mengantar TIDAK punya field origin
// sama sekali — biaya kirim dihitung dari `pickup.address_id`, yaitu satu alamat penjemputan milik
// akun (MENGANTAR_STORE_ADDRESS_ID). Selama akun cuma punya SATU alamat pickup, mengutip dari origin
// per-gudang membuat pembeli melihat harga rute yang tak pernah dipakai:
//   INV-20260820-4876 — dikutip Surabaya→Kemayoran Rp18.000, ditagih Cengkareng→Kemayoran Rp25.000.
//   Selisihnya keluar dari saldo Mengantar dan tak tercatat di pesanan mana pun.
//
// MENGANTAR_PICKUP_ORIGIN_ID = _id kelurahan alamat pickup tersebut. Bila di-set, SELURUH kutipan
// memakai origin ini sehingga harga yang dilihat pembeli = harga yang benar-benar ditagih.
// Konsekuensi yang disengaja: semua gudang berharga sama, jadi pemilihan gudang tak lagi berbasis
// ongkir — pemenangnya cukup gudang ber-stok (deterministik lewat resolveWarehouseForOrder).
//
// Kosong → perilaku lama (origin per gudang). Cabut env ini setelah tiap gudang punya alamat pickup
// sendiri di Mengantar (lihat ROADMAP.md → kolom warehouses.mengantar_address_id).
export async function getQuoteOriginId(warehouseId?: string): Promise<string> {
  const pinned = process.env.MENGANTAR_PICKUP_ORIGIN_ID?.trim()
  if (pinned) return pinned
  return getOriginIdForWarehouse(warehouseId)
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

  const warehouseId = (await isMultiWarehouse()) ? options?.warehouseId : undefined
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

  const warehouseId = (await isMultiWarehouse()) ? options?.warehouseId : undefined

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

// Catatan: fungsi jarak Haversine SUDAH DIHAPUS. Pemilihan gudang memakai perbandingan ongkir
// riil per gudang (src/lib/warehouse-shipping.ts), karena jarak lurus bukan ukuran biaya kirim.
// Kolom latitude/longitude di tabel warehouses tetap ada untuk keperluan lain (mis. tampilan
// peta), tapi TIDAK boleh dipakai lagi sebagai dasar keputusan gudang pemenuh pesanan.

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
