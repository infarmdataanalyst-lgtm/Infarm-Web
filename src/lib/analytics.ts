// src/lib/analytics.ts
// Helper terpusat event analytics sisi klien untuk storefront.
// Payload ditulis SEKALI dalam skema GA4 ecommerce (currency/value/items), lalu `sendEvent`
// menyebarkannya ke dua tujuan: GA4 via window.gtag, dan Meta Pixel via terjemahan di
// lib/meta-pixel.ts. Komponen pemanggil tak perlu tahu ada berapa tujuan — menambah platform
// berarti menambah penerjemah di sendEvent, bukan menyentuh halaman.
//
// GA4 dipasang lewat <GoogleAnalytics> (@next/third-parties), Meta Pixel lewat <MetaPixelGate>;
// keduanya di root layout dan sama-sama tak dimuat di /oms & /maintenance.
//
// Catatan: aman dipanggil di mana pun — bila gtag/fbq belum ada (dev tanpa ID, atau halaman OMS
// yang tidak memuat skrip), fungsi diam saja (no-op).

import { sendMetaEvent, toMetaEvent } from '@/lib/meta-pixel'

// gtag disuntikkan oleh script GA4; tipe minimal agar tak perlu `any`.
declare global {
  interface Window {
    gtag?: (command: 'event', eventName: string, params?: Record<string, unknown>) => void
  }
}

// Data produk minimal yang dibutuhkan payload GA4. Harga = INTEGER rupiah (promoPrice) — apa adanya.
export type AnalyticsProduct = {
  id: string
  sku?: string // dipakai sebagai item_id bila ada; fallback ke id
  name: string
  category: string // sudah lowercase dari DB — kirim apa adanya
  price: number
}

// Bentuk satu item GA4 dari produk + quantity.
function toItem(p: AnalyticsProduct, quantity: number) {
  return {
    item_id: p.sku || p.id,
    item_name: p.name,
    item_category: p.category,
    price: p.price,
    quantity,
  }
}

// Kirim event ke SEMUA tujuan (client-only). Tiap tujuan memeriksa sendiri apakah skripnya ada,
// jadi GA4 tanpa Meta (atau sebaliknya) tetap jalan — pemblokir iklan sering menahan salah satunya saja.
function sendEvent(name: string, params: Record<string, unknown>): void {
  if (typeof window === 'undefined') return
  if (typeof window.gtag === 'function') window.gtag('event', name, params)
  sendMetaEvent(toMetaEvent(name, params))
}

// view_item — produk dilihat (dipanggil saat halaman detail mount).
export function trackViewItem(product: AnalyticsProduct): void {
  sendEvent('view_item', {
    currency: 'IDR',
    value: product.price,
    items: [toItem(product, 1)],
  })
}

// add_to_cart — produk ditambahkan ke keranjang (dipanggil SETELAH item masuk cookie keranjang).
export function trackAddToCart(product: AnalyticsProduct, quantity: number): void {
  sendEvent('add_to_cart', {
    currency: 'IDR',
    value: product.price * quantity,
    items: [toItem(product, quantity)],
  })
}

// Satu item combo untuk event GA4. Snapshot combo TIDAK punya kategori/SKU →
// item_category dikirim kosong, item_id fallback ke productId.
export type AnalyticsComboItem = {
  productId: string
  name: string
  price: number // harga per unit hasil alokasi harga combo
  quantity: number
}

// add_to_cart untuk PAKET COMBO — sesuai rekomendasi GA4: SATU event berisi semua item combo,
// value = harga paket (comboPrice). Dipanggil SETELAH combo masuk cookie keranjang.
export function trackComboAddToCart(comboPrice: number, items: AnalyticsComboItem[]): void {
  sendEvent('add_to_cart', {
    currency: 'IDR',
    value: comboPrice,
    items: items.map((it) => ({
      item_id: it.productId,
      item_name: it.name,
      item_category: '', // snapshot combo tak menyimpan kategori
      price: it.price,
      quantity: it.quantity,
    })),
  })
}

// === Event yang membawa BANYAK produk sekaligus ===
//
// view_item & add_to_cart di atas selalu bicara tentang SATU produk, jadi kuantitasnya cukup
// dioper sebagai argumen terpisah. Event checkout tidak begitu: tiap baris punya kuantitasnya
// sendiri, jadi kuantitas ikut menempel di tiap item.
export type AnalyticsLineItem = AnalyticsProduct & { quantity: number }

function toItems(lines: AnalyticsLineItem[]) {
  return lines.map((line) => toItem(line, line.quantity))
}

// begin_checkout — halaman checkout terbuka dengan isi keranjang yang sudah lengkap.
//
// `value` = SUBTOTAL BARANG, bukan total bayar. Saat event ini dikirim pembeli belum memilih
// kurir, jadi ongkirnya memang belum ada. Mengirim total yang ongkirnya masih nol membuat nilai
// begin_checkout tak sebanding dengan purchase, dan selisihnya akan terbaca sebagai "pembeli
// menambah belanjaan di tengah jalan" — padahal cuma ongkir yang menyusul.
export function trackBeginCheckout(subtotal: number, lines: AnalyticsLineItem[]): void {
  sendEvent('begin_checkout', {
    currency: 'IDR',
    value: subtotal,
    items: toItems(lines),
  })
}

// add_shipping_info — kurir dan tarifnya sudah terpilih di checkout.
//
// `shipping_tier` parameter GA4 standar (nama layanan kurir). `shipping_cost` parameter TAMBAHAN
// milik kita: ongkir dalam rupiah. Ia ada karena pertanyaan yang ingin dijawab toko ini bukan
// "kurir mana yang dipilih" melainkan "pada angka berapa pembeli berhenti" — satu rute yang sama
// bisa berongkos Rp4.080 atau Rp66.720 tergantung gudang pemenuhnya (lihat MGT-64).
//
// ⚠️ `shipping_cost` harus didaftarkan sebagai custom metric di GA4 (Admin → Custom definitions,
// scope Event, unit Standard) sebelum bisa dipakai di laporan. Event-nya tetap terkirim tanpa
// pendaftaran itu, tapi parameternya tak akan muncul di Explore.
export function trackAddShippingInfo(
  subtotal: number,
  shippingTier: string,
  shippingCost: number,
  lines: AnalyticsLineItem[],
): void {
  sendEvent('add_shipping_info', {
    currency: 'IDR',
    value: subtotal,
    shipping_tier: shippingTier,
    shipping_cost: shippingCost,
    items: toItems(lines),
  })
}

// === Pencarian ===

// Hasil pencarian seperti yang dikembalikan /api/products/search: kartu ringan TANPA sku, jadi
// item_id-nya selalu id produk. Untuk event pencarian itu tak masalah — yang dianalisis kata
// kuncinya, bukan funnel per produk.
export type AnalyticsSearchResult = { id: string; name: string; category: string; price: number }

// search — pembeli selesai mencari satu kata kunci (bukan tiap ketukan; lihat HeaderSearch).
//
// `search_term` parameter GA4 standar. `results_count` parameter TAMBAHAN milik kita: jumlah saran
// yang muncul. Nol berarti "dicari tapi tidak ketemu" — daftar permintaan produk yang nyata,
// dan itulah laporan yang ingin dibuat dari event ini.
//
// ⚠️ `results_count` harus didaftarkan sebagai custom metric di GA4 (Admin → Custom definitions,
// scope Event) sebelum muncul di laporan — kasusnya sama dengan `shipping_cost` di atas.
export function trackSearch(term: string, results: AnalyticsSearchResult[]): void {
  sendEvent('search', {
    search_term: term,
    results_count: results.length,
    items: results.map((r) => toItem({ id: r.id, name: r.name, category: r.category, price: r.price }, 1)),
  })
}
