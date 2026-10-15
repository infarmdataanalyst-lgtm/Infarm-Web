// src/lib/meta-pixel.ts
// Meta Pixel (Facebook/Instagram Ads) di sisi BROWSER: menerjemahkan event GA4 yang sudah dikirim
// storefront menjadi event standar Meta, lalu meneruskannya ke `fbq`.
//
// ── Kenapa menerjemahkan, bukan memanggil fbq langsung dari komponen ──
// Semua titik event storefront (detail produk, keranjang, checkout, pencarian) sudah memanggil
// helper di lib/analytics.ts dengan payload GA4. Meta memakai kosakata lain untuk data yang SAMA:
// GA4 bicara `items[].item_id`, Meta bicara `content_ids` + `contents[]`. Menerjemahkannya di satu
// tempat berarti komponen tak perlu tahu ada dua tujuan, dan platform ketiga (TikTok) nanti tinggal
// menambah penerjemah lain di samping yang ini.
//
// ── Purchase SENGAJA tidak ada di sini ──
// Pembayaran Xendit asinkron: VA/QRIS bisa dibayar berjam-jam kemudian dan pembeli belum tentu
// kembali ke halaman sukses. Purchase dikirim dari webhook lewat Conversions API (pekerjaan
// terpisah), dengan `event_id` = nomor invoice. Pemetaan di bawah tidak mengenal `purchase`, jadi
// kalaupun suatu hari browser mengirimnya, Meta tak akan menerimanya dua kali.
//
// ── eventID ──
// Tiap event browser membawa eventID unik. Meta memakainya untuk membuang duplikat bila event yang
// sama juga tiba dari server. Sekarang belum ada event ganda semacam itu, tapi menambahkannya
// belakangan berarti menebak ulang ID event yang sudah terlanjur terkirim — jadi dipasang sejak awal.

// Nama event standar Meta yang dipakai storefront. Hanya yang punya padanan GA4 di lib/analytics.ts.
export type MetaEventName = 'ViewContent' | 'AddToCart' | 'InitiateCheckout' | 'AddPaymentInfo' | 'Search'

export type MetaEvent = { name: MetaEventName; params: Record<string, unknown> }

// fbq disuntikkan oleh snippet Meta Pixel (MetaPixelGate); tipe minimal agar tak perlu `any`.
type FbqOptions = { eventID?: string }
declare global {
  interface Window {
    fbq?: (
      command: 'track' | 'trackCustom',
      eventName: string,
      params?: Record<string, unknown>,
      options?: FbqOptions,
    ) => void
  }
}

// Item GA4 seperti yang dibentuk lib/analytics.ts. Field lain diabaikan.
type GaItem = { item_id: string; item_name?: string; item_category?: string; price: number; quantity: number }

// Satu baris `contents` Meta. `item_price` = harga satuan, bukan subtotal baris.
type MetaContent = { id: string; quantity: number; item_price: number }

function toContents(items: GaItem[]): MetaContent[] {
  return items.map((it) => ({ id: it.item_id, quantity: it.quantity, item_price: it.price }))
}

// Bagian payload yang sama untuk semua event berisi produk.
function productParams(items: GaItem[], value: unknown) {
  return {
    content_type: 'product',
    content_ids: items.map((it) => it.item_id),
    contents: toContents(items),
    currency: 'IDR',
    value,
  }
}

// Terjemahkan satu event GA4 ke event Meta. `null` = tidak ada padanan, jangan kirim apa pun.
// Fungsi murni (tanpa window) supaya bisa diuji tanpa browser.
export function toMetaEvent(gaName: string, gaParams: Record<string, unknown>): MetaEvent | null {
  const items = (Array.isArray(gaParams.items) ? gaParams.items : []) as GaItem[]

  switch (gaName) {
    case 'view_item':
    case 'add_to_cart': {
      // Keduanya membawa SATU produk; Meta tetap menerima bentuk daftar. Nama & kategori dari item
      // pertama membantu laporan Meta menampilkan produknya tanpa katalog.
      const first = items[0]
      return {
        name: gaName === 'view_item' ? 'ViewContent' : 'AddToCart',
        params: {
          ...productParams(items, gaParams.value),
          content_name: first?.item_name ?? '',
          content_category: first?.item_category ?? '',
        },
      }
    }
    case 'begin_checkout':
    case 'add_shipping_info':
      // Meta tak punya event "info pengiriman"; AddPaymentInfo adalah langkah funnel setelah
      // InitiateCheckout, dan di toko ini memilih kurir memang langkah terakhir sebelum bayar.
      // `shipping_tier`/`shipping_cost` GA4 tidak ikut: keduanya tak dipakai Meta mengoptimalkan iklan.
      return {
        name: gaName === 'begin_checkout' ? 'InitiateCheckout' : 'AddPaymentInfo',
        params: {
          ...productParams(items, gaParams.value),
          num_items: items.reduce((sum, it) => sum + it.quantity, 0),
        },
      }
    case 'search':
      // `results_count` parameter TAMBAHAN (bukan standar Meta): yang ingin dijawab bukan hanya
      // "apa yang dicari", tapi "apa yang dicari dan TIDAK ketemu" — daftar permintaan produk nyata.
      return {
        name: 'Search',
        params: {
          search_string: gaParams.search_term,
          results_count: gaParams.results_count,
          content_type: 'product',
          content_ids: items.map((it) => it.item_id),
          contents: toContents(items),
        },
      }
    default:
      return null
  }
}

// ID unik per event untuk deduplikasi browser ↔ server. Tak perlu kriptografis — cukup tak bentrok
// di jendela deduplikasi Meta (48 jam) untuk satu pengunjung.
export function metaEventId(name: string): string {
  return `${name}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 10)}`
}

// Teruskan event ke fbq bila ada (client-only). No-op bila pixel tidak dimuat: OMS, maintenance,
// dev tanpa NEXT_PUBLIC_META_PIXEL_ID, atau pemblokir iklan yang mencegat fbevents.js.
export function sendMetaEvent(event: MetaEvent | null): void {
  if (!event) return
  if (typeof window === 'undefined' || typeof window.fbq !== 'function') return
  window.fbq('track', event.name, event.params, { eventID: metaEventId(event.name) })
}

// Pixel ID Meta = deretan angka. Nilainya dari env dan disisipkan ke <script> inline, jadi apa pun
// yang bukan angka DITOLAK — bukan sekadar dibersihkan — supaya salah konfigurasi terlihat, bukan
// diam-diam jadi pixel yang salah.
export function isValidMetaPixelId(id: string | undefined): id is string {
  return typeof id === 'string' && /^\d{5,20}$/.test(id)
}
