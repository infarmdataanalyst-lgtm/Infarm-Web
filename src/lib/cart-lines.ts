// src/lib/cart-lines.ts
// Aturan MURNI isi keranjang: kapan dua item dianggap satu baris, dan bagaimana paket disusun.
// Tanpa cookie, tanpa DOM — cart-client.ts yang membungkusnya dengan baca/tulis cookie, dan
// /api/orders/create memakai `comboMultiplier` yang sama untuk memverifikasi paket.
//
// Kenapa dipisah: dulu baris keranjang dibedakan HANYA per produk + varian. Produk A dari paket dan
// produk A yang dibeli satuan dianggap barang yang sama lalu digabung ke satu baris:
//
//   paket dulu, lalu A satuan → baris A paket jadi ×2 (masih bertanda paket, harga tertimpa harga
//                               normal) → server melihat paket berisi A×2 → pesanan DITOLAK.
//   A satuan dulu, lalu paket → baris A satuan DITIMPA jadi A×1 bertanda paket → A satuan milik
//                               pembeli hilang diam-diam.
//
// Sekarang identitas baris = produk + varian + paket. A paket dan A satuan hidup berdampingan
// sebagai dua baris dengan harga masing-masing, dan tak ada lagi yang perlu ditebak.

import type { CartItem } from '@/types/cart'

// Satu anggota paket seperti yang didefinisikan database: produk + jumlahnya dalam SATU paket.
export type ComboUnit = { productId: string; quantity: number }

// Dua item menunjuk baris keranjang yang sama bila produk, varian, DAN paketnya sama.
// `undefined` dan string kosong disamakan: cookie lama bisa menyimpan salah satunya.
export function sameLine(
  a: Pick<CartItem, 'productId' | 'variantId' | 'comboId'>,
  b: Pick<CartItem, 'productId' | 'variantId' | 'comboId'>,
): boolean {
  return (
    a.productId === b.productId &&
    (a.variantId || undefined) === (b.variantId || undefined) &&
    (a.comboId || undefined) === (b.comboId || undefined)
  )
}

// Kunci string satu baris (untuk React key, set centang, dsb). Sejalan dengan `sameLine`.
export function cartLineKey(item: Pick<CartItem, 'productId' | 'variantId' | 'comboId'>): string {
  return `${item.productId}::${item.variantId ?? ''}::${item.comboId ?? ''}`
}

// Menambahkan produk SATUAN. Hanya menyatu dengan baris satuan produk+varian yang sama — baris
// paket tak pernah disentuh. `comboId` pada item masukan diabaikan: paket masuk lewat `addCombo`.
export function addLooseItem(cart: CartItem[], item: CartItem): CartItem[] {
  const loose: CartItem = { ...item }
  delete loose.comboId
  const next = cart.map((c) => ({ ...c }))
  const existing = next.find((c) => sameLine(c, loose))
  if (existing) {
    existing.quantity += loose.quantity
    existing.price = loose.price // sinkronkan harga terbaru
    if (loose.variantName) existing.variantName = loose.variantName
  } else {
    next.push(loose)
  }
  return next
}

// Memasukkan SATU paket (N = 1). Baris lama paket yang sama diganti utuh — memasukkan paket yang
// sama dua kali lewat checkbox tak boleh menghasilkan anggota yang separuh ×1 separuh ×2. Baris
// satuan produk yang sama TIDAK disentuh.
export function addCombo(
  cart: CartItem[],
  comboId: string,
  items: { productId: string; quantity: number; price: number }[],
): CartItem[] {
  const next = cart.filter((c) => c.comboId !== comboId).map((c) => ({ ...c }))
  for (const it of items) {
    next.push({ productId: it.productId, quantity: it.quantity, price: it.price, comboId })
  }
  return next
}

// Mengubah jumlah paket menjadi `count`. Setiap anggota = jumlahnya dalam satu paket × count, jadi
// isi paket tak mungkin keluar dari kelipatan yang sama. count < 1 mengeluarkan seluruh paket.
export function setComboCount(
  cart: CartItem[],
  comboId: string,
  units: ComboUnit[],
  count: number,
): CartItem[] {
  if (!Number.isInteger(count) || count < 1) return cart.filter((c) => c.comboId !== comboId)
  const perPaket = new Map(units.map((u) => [u.productId, u.quantity]))
  return cart.map((c) => {
    if (c.comboId !== comboId) return { ...c }
    const unit = perPaket.get(c.productId)
    return unit === undefined ? { ...c } : { ...c, quantity: unit * count }
  })
}

// Mengubah jumlah baris SATUAN. < 1 menghapus barisnya. Baris paket tak pernah cocok di sini —
// jumlah anggota paket hanya boleh berubah lewat `setComboCount`.
export function updateLooseQuantity(
  cart: CartItem[],
  productId: string,
  quantity: number,
  variantId?: string,
): CartItem[] {
  const target = { productId, variantId }
  if (quantity < 1) return cart.filter((c) => !sameLine(c, target))
  return cart.map((c) => (sameLine(c, target) ? { ...c, quantity } : { ...c }))
}

// Menghapus baris SATUAN produk+varian tertentu. Anggota paket dihapus lewat removeComboFromCart.
export function removeLooseLine(cart: CartItem[], productId: string, variantId?: string): CartItem[] {
  return cart.filter((c) => !sameLine(c, { productId, variantId }))
}

// Berapa paket (N) yang diwakili baris-baris ini, atau null bila bentuknya tidak sah.
//
// Sah bila: setiap anggota paket muncul TEPAT satu kali, tak ada produk asing, tak ada varian, dan
// semua jumlah = jumlah per paket × N dengan N bulat ≥ 1 yang SAMA. Jadi paket 1-1-1 boleh
// 3-3-3 tapi tidak 3-3-2; paket A2-B1 boleh 6-3 tapi tidak 3-3.
//
// Dipakai DUA pihak dengan fungsi yang sama persis: keranjang (menampilkan N, menandai paket basi)
// dan /api/orders/create (menolak paket rusak). Kalau keduanya punya aturan sendiri, keranjang bisa
// menyatakan sah sesuatu yang lalu ditolak server — persis bug yang sedang ditutup ini.
export function comboMultiplier(
  units: ComboUnit[],
  lines: { productId: string; quantity: number; variantId?: string | null }[],
): number | null {
  if (units.length === 0 || lines.length !== units.length) return null
  if (lines.some((l) => l.variantId)) return null

  const perPaket = new Map(units.map((u) => [u.productId, u.quantity]))
  if (perPaket.size !== units.length) return null // definisi paket sendiri berisi produk ganda

  const seen = new Set<string>()
  let n: number | null = null
  for (const line of lines) {
    const unit = perPaket.get(line.productId)
    if (unit === undefined || unit < 1 || seen.has(line.productId)) return null
    seen.add(line.productId)
    if (!Number.isInteger(line.quantity) || line.quantity < unit || line.quantity % unit !== 0) {
      return null
    }
    const lineN = line.quantity / unit
    if (n === null) n = lineN
    else if (n !== lineN) return null
  }
  return n
}
