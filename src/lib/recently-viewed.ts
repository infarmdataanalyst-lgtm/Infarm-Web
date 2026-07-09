// src/lib/recently-viewed.ts
// Riwayat "produk yang pernah dilihat" (guest, sisi-klien) di localStorage.
// Key terpisah (recently_viewed_products) agar tak bentrok dengan data lain.
// Struktur: array { product_id, viewed_at }, terbaru di depan, maksimal 10.
// Semua akses dibungkus try/catch → aman saat localStorage penuh/disabled (private browsing).

const KEY = 'recently_viewed_products'
const MAX = 10

type RecentEntry = { product_id: string; viewed_at: number }

// Baca & validasi isi localStorage. Array kosong bila tak ada/rusak/tak tersedia.
function read(): RecentEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((e) => e && typeof e.product_id === 'string')
      : []
  } catch {
    return []
  }
}

// Mencatat satu produk sebagai baru dilihat (dipanggil saat buka halaman detail produk).
// Bila sudah pernah dilihat → dipindah ke posisi terbaru (bukan entry duplikat). Maks 10.
export function trackProductView(productId: string): void {
  if (typeof window === 'undefined' || !productId) return
  try {
    const list = read().filter((e) => e.product_id !== productId) // buang duplikat lama
    list.unshift({ product_id: productId, viewed_at: Date.now() }) // terbaru paling depan
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)))
  } catch {
    // localStorage penuh/disabled → abaikan, fitur non-kritis
  }
}

// Daftar product_id yang pernah dilihat, urut terbaru → terlama.
export function getRecentlyViewedIds(): string[] {
  return read().map((e) => e.product_id)
}
