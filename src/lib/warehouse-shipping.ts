// src/lib/warehouse-shipping.ts
// Pemilihan gudang berdasarkan ONGKIR RIIL (bukan jarak lurus). SERVER ONLY.
//
// KENAPA bukan Haversine: jarak geografis tidak mewakili biaya kirim. Rute & zona tarif kurir bisa
// membuat gudang yang lebih jauh justru lebih murah. Yang dibandingkan sekarang = ongkir aktual
// dari `allEstimatePublic` Mengantar untuk tiap gudang yang stoknya cukup.
// Bukti nyata pada data infarm (tujuan sama, berat 1kg): dari Gudang Utama JNE Rp10.900,
// dari Gudang Jakarta JNE Rp8.000 — selisih yang tak akan terlihat dari koordinat.
//
// Alur: gudang aktif → filter stok cukup untuk SEMUA item → panggil Mengantar PARALEL per gudang
// (Promise.allSettled + timeout per panggilan) → gabungkan seluruh kurir → urutkan termurah.
// Buyer memilih kurir seperti biasa; gudang mana yang memenuhi tidak perlu ia ketahui.

import {
  isOfferableCourier,
  mapCourierEstimates,
  type RawCourierEstimate,
  type ShippingCourier,
} from '@/lib/mengantar-estimate'
import { mengantarEstimateUrl } from '@/lib/mengantar-host'
import { readStockRows, readWarehouses } from '@/lib/mock-db/warehouses'
import {
  getDefaultWarehouse,
  getQuoteOriginId,
  isMultiWarehouse,
  type StockRequirement,
} from '@/lib/warehouse'
import type { Warehouse } from '@/types/warehouse'

// Host cek ongkir mengikuti MENGANTAR_BASE_URL (lihat lib/mengantar-host.ts) supaya tarif yang
// dikutip ke pembeli berasal dari LINGKUNGAN YANG SAMA dengan booking kurir. Dulu hardcode ke
// produksi sementara booking di sandbox — dua tabel tarif berbeda, angkanya tak pernah cocok.

// Timeout per percobaan & jumlah percobaan per origin. Satu gudang yang lambat TIDAK boleh menahan
// seluruh cek ongkir; hasilnya cukup dibuang (gudang itu dianggap tak menawarkan opsi) selama masih
// ada gudang lain yang balas.
//
// Dulu 4,5 detik tanpa coba ulang. Ukuran 25 Sep 2026 (sandbox, Gudang Utama → Medan): 3 dari 15
// panggilan butuh ±5,2 detik → kehabisan waktu → saat membuat pesanan tak ada tarif untuk
// dicocokkan → pesanan ditolak "ongkos kirim sedang tidak bisa dipastikan". Kasus terburuk kini
// 2 × 8 detik; route pemanggil (orders/create, shipping/options) memasang maxDuration 30 detik
// agar fungsi Vercel tak dimatikan di tengah jalan (batas bawaan paket Hobby 10 detik).
const ESTIMATE_TIMEOUT_MS = 8000
const ESTIMATE_ATTEMPTS = 2

// Umur simpan hasil perbandingan. Dipakai saat pembuatan order untuk fallback gudang tanpa
// memanggil ulang Mengantar. Cukup pendek agar tarif tak jadi basi, cukup panjang untuk
// menutupi jeda buyer mengisi form checkout.
const OPTIONS_TTL_MS = 10 * 60 * 1000

// Satu pilihan kurir BESERTA gudang asalnya.
export type WarehouseShippingOption = ShippingCourier & {
  warehouseId: string
  warehouseName: string
}

export type ShippingOptionsResult = {
  options: WarehouseShippingOption[] // sudah difilter & diurutkan termurah → termahal
  warehousesConsidered: number // gudang yang stoknya cukup
  warehousesResponded: number // gudang yang berhasil memberi tarif
}

// === Cache hasil perbandingan (in-memory, per instance) ===
// Tujuannya BUKAN performa, tapi agar validasi ulang stok saat create order bisa jatuh ke opsi
// termurah berikutnya tanpa memanggil Mengantar lagi. Pola sama dengan rate-limit: best-effort,
// hilang saat instance mati — dan itu aman karena pemanggil selalu punya fallback gudang default.
type CacheEntry = { at: number; result: ShippingOptionsResult }
const optionsCache = new Map<string, CacheEntry>()

// Kunci cache: tujuan + berat + daftar item (produk/varian/qty), diurutkan agar stabil.
export function shippingOptionsKey(
  destinationId: string,
  weight: number,
  items: StockRequirement[],
): string {
  const itemKey = items
    .map((i) => `${i.productId}:${i.variantId ?? ''}:${i.quantity}`)
    .sort()
    .join(',')
  return `${destinationId}|${weight}|${itemKey}`
}

// Hasil perbandingan yang masih berlaku, atau null bila tak ada / sudah kedaluwarsa.
export function getCachedShippingOptions(key: string): ShippingOptionsResult | null {
  const entry = optionsCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.at > OPTIONS_TTL_MS) {
    optionsCache.delete(key)
    return null
  }
  return entry.result
}

function cacheShippingOptions(key: string, result: ShippingOptionsResult): void {
  // Sapu entri kedaluwarsa berkala agar Map tak tumbuh tanpa batas di instance berumur panjang
  if (optionsCache.size > 200) {
    const now = Date.now()
    for (const [k, v] of optionsCache) if (now - v.at > OPTIONS_TTL_MS) optionsCache.delete(k)
  }
  optionsCache.set(key, { at: Date.now(), result })
}

// === Hadiah promo yang tak bisa ikut dikirim ===
//
// Pesanan dikirim dari SATU gudang, dan hadiah promo ikut menentukan gudangnya (keputusan pemilik,
// 25 Sep 2026): gudang yang dipilih harus punya barang pesanan DAN hadiahnya. Celahnya: bila tak
// ada satu gudang pun yang punya semuanya (mis. Hidroton hanya di Jakarta, hadiah hanya di Utama),
// perbandingan ongkir jatuh ke gudang default dan pesanan gagal "stok tidak mencukupi" — pembeli
// kehilangan PESANANNYA gara-gara bonus.
//
// Aturannya: selama barang pesanan sendiri ada di satu gudang, hadiah yang tak bisa ikut dikirim
// DILEWATI (satu per satu, yang lain tetap diusahakan). Dipakai DUA pihak dengan fungsi yang sama —
// /api/mengantar/shipping/options (checkout diberi tahu lalu menjelaskannya ke pembeli) dan
// /api/orders/create — supaya keduanya selalu sepakat soal gudang, berat, dan tarif.
export type GiftAwareRequirement = StockRequirement & { isGift?: boolean }

function withoutGiftFlag(item: GiftAwareRequirement): StockRequirement {
  return item.variantId
    ? { productId: item.productId, quantity: item.quantity, variantId: item.variantId }
    : { productId: item.productId, quantity: item.quantity }
}

export async function dropUnshippableGifts(
  items: GiftAwareRequirement[],
): Promise<{ items: StockRequirement[]; droppedGiftIds: string[] }> {
  const all = items.map(withoutGiftFlag)
  const gifts = items.filter((i) => i.isGift)
  if (gifts.length === 0) return { items: all, droppedGiftIds: [] }

  // Mode satu gudang: stok per gudang tak dinilai di sini (perilaku lama tetap).
  if (!(await isMultiWarehouse())) return { items: all, droppedGiftIds: [] }

  // Kasus normal: ada gudang yang sanggup mengirim semuanya.
  if ((await getEligibleWarehouses(all)).length > 0) return { items: all, droppedGiftIds: [] }

  // Barang pesanan sendiri pun tak ada di satu gudang → bukan urusan hadiah; biarkan alur lama
  // (gudang default + penolakan stok oleh RPC) yang menanganinya.
  let kept = items.filter((i) => !i.isGift).map(withoutGiftFlag)
  if ((await getEligibleWarehouses(kept)).length === 0) return { items: all, droppedGiftIds: [] }

  const droppedGiftIds: string[] = []
  for (const gift of gifts) {
    const trial = [...kept, withoutGiftFlag(gift)]
    if ((await getEligibleWarehouses(trial)).length > 0) kept = trial
    else droppedGiftIds.push(gift.productId)
  }
  return { items: kept, droppedGiftIds }
}

// === Kelayakan stok ===

// Gudang aktif yang stoknya cukup untuk SELURUH item.
// Mode single → hanya gudang default (tanpa query stok), sesuai perilaku lama.
// Tak ada yang memenuhi → array kosong; pemanggil yang memutuskan fallback.
export async function getEligibleWarehouses(
  items: StockRequirement[],
): Promise<Warehouse[]> {
  if (!(await isMultiWarehouse())) {
    const def = await getDefaultWarehouse()
    return def ? [def] : []
  }

  const warehouses = await readWarehouses(true)
  if (warehouses.length === 0) return []

  const needed = mergeItems(items)
  if (needed.length === 0) return warehouses

  const rows = await readStockRows({
    productIds: [...new Set(needed.map((n) => n.productId))],
  })

  const perWarehouse = new Map<string, Map<string, number>>()
  for (const row of rows) {
    const byKey = perWarehouse.get(row.warehouseId) ?? new Map<string, number>()
    byKey.set(itemKey(row), row.stok)
    perWarehouse.set(row.warehouseId, byKey)
  }

  return warehouses.filter((w) => {
    const byKey = perWarehouse.get(w.id)
    if (!byKey) return false
    return needed.every((n) => (byKey.get(itemKey(n)) ?? 0) >= n.quantity)
  })
}

// === Perbandingan ongkir ===

// Mengambil tarif untuk SATU origin. null bila gagal/timeout — pemanggil MENGABAIKAN gudang yang
// memakai origin itu, tidak menggagalkan seluruh cek ongkir.
//
// Kunci pemanggilan = origin, bukan gudang: beberapa gudang bisa berbagi kelurahan asal (dan SELALU
// begitu ketika MENGANTAR_PICKUP_ORIGIN_ID di-set), sedangkan tarif Mengantar hanya bergantung pada
// origin+tujuan+berat. Satu panggilan per origin, bukan per gudang.
async function fetchCouriersForOrigin(
  originId: string,
  destinationId: string,
  weight: number,
): Promise<ShippingCourier[] | null> {
  // Cek ongkir adalah panggilan BACA yang gratis & tanpa efek samping, jadi aman diulang.
  for (let attempt = 1; attempt <= ESTIMATE_ATTEMPTS; attempt++) {
    const couriers = await fetchCouriersOnce(originId, destinationId, weight)
    if (couriers !== null) return couriers
  }
  return null
}

// Satu percobaan cek ongkir untuk satu origin. null = gagal (timeout / jaringan / HTTP / JSON rusak).
async function fetchCouriersOnce(
  originId: string,
  destinationId: string,
  weight: number,
): Promise<ShippingCourier[] | null> {
  const params = new URLSearchParams({
    origin_id: originId,
    destination_id: destinationId,
    weight: String(weight),
  })

  // AbortSignal.timeout dipakai (bukan setTimeout manual) agar fetch benar-benar dibatalkan,
  // bukan hanya diabaikan hasilnya.
  try {
    const res = await fetch(`${mengantarEstimateUrl()}?${params.toString()}`, {
      signal: AbortSignal.timeout(ESTIMATE_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { data?: Record<string, RawCourierEstimate> }
    // Penyaringan DI SISI SERVER: hanya kurir dalam daftar putih (saat ini J&T) yang melewati
    // batas jaringan. Kalau disaring di client, daftar kurir lain sempat terkirim dan bisa
    // terlihat sekejap sebelum ter-filter.
    return mapCourierEstimates(json.data).filter(isOfferableCourier)
  } catch {
    // Timeout / jaringan / JSON rusak → origin ini dilewati
    return null
  }
}

// Membandingkan ongkir SELURUH gudang yang stoknya cukup, lalu menggabungkan pilihan kurirnya.
//
// Semua panggilan Mengantar dijalankan PARALEL (Promise.allSettled): total waktu = panggilan
// terlambat, bukan jumlah seluruh panggilan. Gudang yang gagal/timeout tidak menggagalkan yang lain.
// Bila tak ada gudang ber-stok cukup, dicoba gudang default agar buyer tetap dapat pilihan kurir
// (kekurangan stok tetap ditolak secara atomik oleh RPC saat checkout).
export async function resolveShippingOptions(
  items: StockRequirement[],
  destinationId: string,
  weight: number,
): Promise<ShippingOptionsResult> {
  let candidates = await getEligibleWarehouses(items)
  if (candidates.length === 0) {
    const def = await getDefaultWarehouse()
    candidates = def ? [def] : []
  }

  // Kelompokkan gudang menurut origin kutipannya. Gudang tanpa origin (konfigurasi belum lengkap)
  // dibuang di sini — dulu tersaring di dalam fetch, sekarang tak boleh ikut membentuk kelompok.
  const origins = await Promise.all(candidates.map((w) => getQuoteOriginId(w.id)))
  const byOrigin = new Map<string, Warehouse[]>()
  candidates.forEach((w, i) => {
    const originId = origins[i]
    if (!originId) return
    const list = byOrigin.get(originId)
    if (list) list.push(w)
    else byOrigin.set(originId, [w])
  })

  const groups = [...byOrigin.entries()]
  const settled = await Promise.allSettled(
    groups.map(([originId]) => fetchCouriersForOrigin(originId, destinationId, weight)),
  )

  const merged: WarehouseShippingOption[] = []
  let responded = 0
  groups.forEach(([, warehouses], i) => {
    const s = settled[i]
    if (s.status !== 'fulfilled' || s.value === null) return
    // Satu tarif dipakai bersama seluruh gudang dalam kelompok — masing-masing tetap muncul sebagai
    // opsi tersendiri karena pembuatan order memakai daftar ini untuk fallback gudang.
    responded += warehouses.length
    for (const w of warehouses) {
      merged.push(...s.value.map((c) => ({ ...c, warehouseId: w.id, warehouseName: w.nama })))
    }
  })

  // Urut termurah → termahal. Harga sama → gudang default lebih dulu tidak dipaksakan di sini;
  // urutan alami hasil paralel sudah cukup dan tarifnya identik bagi buyer.
  merged.sort((a, b) => a.price - b.price)

  const result: ShippingOptionsResult = {
    options: merged,
    warehousesConsidered: candidates.length,
    warehousesResponded: responded,
  }

  cacheShippingOptions(shippingOptionsKey(destinationId, weight, items), result)
  return result
}

// === Util internal ===

function itemKey(target: { productId: string; variantId?: string }): string {
  return `${target.productId}::${target.variantId ?? ''}`
}

// Menjumlahkan item yang menunjuk produk/varian sama agar pengecekan stok tak kelewat longgar.
function mergeItems(items: StockRequirement[]): StockRequirement[] {
  const merged = new Map<string, StockRequirement>()
  for (const item of items) {
    if (!item.productId || !item.quantity || item.quantity <= 0) continue
    const key = itemKey(item)
    const prev = merged.get(key)
    if (prev) prev.quantity += item.quantity
    else merged.set(key, { ...item })
  }
  return [...merged.values()]
}
