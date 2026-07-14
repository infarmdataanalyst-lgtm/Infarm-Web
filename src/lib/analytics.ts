// src/lib/analytics.ts
// Helper terpusat event Google Analytics 4 (GA4) untuk storefront.
// GA4 dipasang lewat <GoogleAnalytics> (@next/third-parties) di root layout — helper ini
// hanya MENGIRIM event via window.gtag. Format payload mengikuti skema GA4 ecommerce
// (currency/value/items) agar konsisten & mudah ditambah event lain (begin_checkout, purchase).
//
// Catatan: aman dipanggil di mana pun — bila gtag belum ada (dev tanpa GA_ID, atau halaman OMS
// yang tidak memuat GA), fungsi diam saja (no-op).

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

// Kirim event ke GA4 bila gtag tersedia (client-only). No-op bila tidak.
function sendEvent(name: string, params: Record<string, unknown>): void {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return
  window.gtag('event', name, params)
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
