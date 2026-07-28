// src/lib/variant-selection.ts
// Store sisi-klien untuk VARIAN produk yang sedang dipilih di halaman detail. Dibagi antara
// area harga (ProductInfo/VariantSelector, atas) & bilah aksi (StickyBuyBar, bawah) yang berada
// di region DOM berbeda. Pola sama seperti cart-client: useSyncExternalStore + subscribe.
// Nilai bersifat per-halaman-produk (productId disertakan agar pemakai bisa cek relevansi).

import type { ProductVariant } from '@/types/variant'

// Varian terpilih beserta konteks produknya.
export type SelectedVariant = {
  productId: string
  variantId: string
  name: string
  price: number
  stock: number
}

let current: SelectedVariant | null = null
const listeners = new Set<() => void>()

// Berlangganan perubahan varian terpilih (untuk useSyncExternalStore).
export function subscribeVariant(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

// Snapshot varian terpilih (client). null bila belum ada / produk tak bervarian.
export function getSelectedVariant(): SelectedVariant | null {
  return current
}

// Snapshot server (SSR) — selalu null agar tidak mismatch saat hidrasi.
export function getServerSelectedVariant(): null {
  return null
}

// Menetapkan varian terpilih + memberi tahu pelanggan. No-op bila nilainya sama persis.
export function setSelectedVariant(v: SelectedVariant | null): void {
  if (
    current?.variantId === v?.variantId &&
    current?.productId === v?.productId &&
    current?.stock === v?.stock &&
    current?.price === v?.price
  ) {
    return
  }
  current = v
  listeners.forEach((l) => l())
}

// Varian default sebuah produk: yang is_default, atau varian pertama. null bila tak ada varian.
export function pickDefaultVariant(variants: ProductVariant[]): ProductVariant | null {
  if (variants.length === 0) return null
  return variants.find((v) => v.isDefault) ?? variants[0]
}

// Bentuk SelectedVariant dari ProductVariant + productId.
export function toSelectedVariant(productId: string, v: ProductVariant): SelectedVariant {
  return { productId, variantId: v.id, name: v.name, price: v.price, stock: v.stock }
}
