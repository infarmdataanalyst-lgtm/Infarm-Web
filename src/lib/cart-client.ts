// src/lib/cart-client.ts
// Helper SISI-KLIEN untuk membaca/menulis cookie keranjang (`infarm_cart`) langsung dari browser.
// Dipakai oleh interaksi tombol (mis. "+ Keranjang") yang berjalan di komponen 'use client'.
// Catatan: pembacaan keranjang dari Server Component nanti memakai cookies() di lib/cart.ts.

import type { CartItem, CheckoutPromoSnapshot } from '@/types/cart'

// === Konstanta cookie ===
const CART_COOKIE_NAME = 'infarm_cart'
// Snapshot item yang dipilih user di keranjang untuk dibawa ke halaman checkout
const CHECKOUT_COOKIE_NAME = 'infarm_checkout'
// Snapshot promo/combo tercapai yang dibawa ke checkout (untuk diteruskan ke order nanti)
const CHECKOUT_PROMO_COOKIE_NAME = 'infarm_checkout_promo'
const CART_COOKIE_MAX_AGE = 60 * 60 * 24 * 7 // 7 hari (dalam detik)

// Event global agar UI lain (mis. badge jumlah di navbar) bisa ikut update tanpa reload
export const CART_UPDATED_EVENT = 'infarm:cart-updated'

// Event khusus untuk memicu efek "pop/getar" pada ikon keranjang saat animasi terbang menyentuhnya
export const CART_BUMP_EVENT = 'infarm:cart-bump'

// Event untuk memunculkan toast notifikasi sukses ("Berhasil ditambahkan ke keranjang")
export const CART_TOAST_EVENT = 'infarm:cart-toast'

// Event saat item checkout (pilihan dari keranjang) diperbarui
export const CHECKOUT_UPDATED_EVENT = 'infarm:checkout-updated'

// Memunculkan toast sukses dari mana saja (StickyBuyBar, BundleOffer, dll). Pesan opsional.
export function showCartToast(message?: string): void {
  window.dispatchEvent(new CustomEvent(CART_TOAST_EVENT, { detail: { message } }))
}

// === Baca Cookie ===

// Membaca seluruh isi keranjang dari cookie browser. Mengembalikan array kosong bila belum ada/rusak.
export function getCart(): CartItem[] {
  if (typeof document === 'undefined') return [] // guard: jangan jalan saat SSR

  return decodeItems(readRawCookie(CART_COOKIE_NAME))
}

// Menghitung total jumlah item di keranjang (untuk badge angka di navbar)
export function getCartCount(): number {
  return getCart().reduce((total, item) => total + item.quantity, 0)
}

// === Store untuk useSyncExternalStore (React) ===
// Memungkinkan komponen membaca cookie keranjang secara reaktif tanpa setState di effect.

const EMPTY_CART: CartItem[] = [] // referensi stabil untuk snapshot SSR

// Cache snapshot agar getSnapshot mengembalikan referensi yang sama hingga keranjang berubah
// (syarat useSyncExternalStore — mencegah render berulang tanpa henti).
let snapshotCache: CartItem[] | null = null

// Snapshot keranjang di klien (dibuild dari cookie, lalu di-cache sampai ada perubahan)
export function getCartSnapshot(): CartItem[] {
  if (snapshotCache === null) snapshotCache = getCart()
  return snapshotCache
}

// Snapshot untuk SSR — selalu kosong karena cookie tak terbaca di server lewat path ini
export function getServerCartSnapshot(): CartItem[] {
  return EMPTY_CART
}

// Berlangganan perubahan keranjang; invalidasi cache lalu beri tahu React saat ada event.
export function subscribeCart(callback: () => void): () => void {
  const handler = () => {
    snapshotCache = null // paksa getCartSnapshot membangun referensi baru
    callback()
  }
  window.addEventListener(CART_UPDATED_EVENT, handler)
  return () => window.removeEventListener(CART_UPDATED_EVENT, handler)
}

// === Tulis Cookie ===

// Menambahkan produk ke keranjang lalu menyimpannya kembali ke cookie.
// Jika produk sudah ada, jumlahnya diakumulasi. Mengembalikan keranjang terbaru.
export function addToCart(item: CartItem): CartItem[] {
  const cart = getCart()
  const existing = cart.find((i) => i.productId === item.productId)

  if (existing) {
    existing.quantity += item.quantity
    existing.price = item.price // sinkronkan harga terbaru
  } else {
    cart.push(item)
  }

  writeCart(cart)
  return cart
}

// Menambahkan paket/combo ke keranjang. Untuk tiap produk combo:
// - bila belum ada di keranjang → ditambahkan dengan quantity & harga (alokasi) combo
// - bila sudah ada → quantity DISESUAIKAN dengan quantity combo (bukan diakumulasi) + harga combo
// Semua item ditandai comboId agar bisa dibedakan saat checkout. Mengembalikan keranjang terbaru.
export function addComboToCart(
  comboId: string,
  items: { productId: string; quantity: number; price: number }[],
): CartItem[] {
  const cart = getCart()
  for (const it of items) {
    const existing = cart.find((c) => c.productId === it.productId)
    if (existing) {
      existing.quantity = it.quantity
      existing.price = it.price
      existing.comboId = comboId
    } else {
      cart.push({ productId: it.productId, quantity: it.quantity, price: it.price, comboId })
    }
  }
  writeCart(cart)
  return cart
}

// Mengubah jumlah (quantity) satu produk di keranjang. Jumlah < 1 akan menghapus item.
// Mengembalikan keranjang terbaru.
export function updateQuantity(productId: string, quantity: number): CartItem[] {
  let cart = getCart()
  if (quantity < 1) {
    cart = cart.filter((i) => i.productId !== productId)
  } else {
    const item = cart.find((i) => i.productId === productId)
    if (item) item.quantity = quantity
  }
  writeCart(cart)
  return cart
}

// Menghapus satu produk dari keranjang. Mengembalikan keranjang terbaru.
export function removeFromCart(productId: string): CartItem[] {
  const cart = getCart().filter((i) => i.productId !== productId)
  writeCart(cart)
  return cart
}

// Menyimpan array keranjang ke cookie (base64) dan memberi tahu UI lain lewat custom event.
function writeCart(cart: CartItem[]): void {
  writeCookie(CART_COOKIE_NAME, cart)

  // Beri tahu komponen lain (mis. badge navbar) bahwa keranjang berubah
  window.dispatchEvent(new CustomEvent(CART_UPDATED_EVENT))
}

// === Item Checkout (snapshot pilihan dari keranjang) ===

// Menyimpan item yang dipilih user di keranjang ke cookie checkout, dipakai halaman /checkout.
export function setCheckoutItems(items: CartItem[]): void {
  if (typeof document === 'undefined') return
  writeCookie(CHECKOUT_COOKIE_NAME, items)
  checkoutSnapshotCache = null // invalidasi snapshot
  window.dispatchEvent(new CustomEvent(CHECKOUT_UPDATED_EVENT))
}

// Membaca item pilihan untuk checkout. Kosong bila user belum lewat halaman keranjang.
export function getCheckoutItems(): CartItem[] {
  if (typeof document === 'undefined') return []
  return decodeItems(readRawCookie(CHECKOUT_COOKIE_NAME))
}

// === Snapshot promo/combo untuk checkout ===

// Menyimpan ringkasan promo/combo yang tercapai saat menuju checkout (untuk diteruskan ke order nanti).
export function setCheckoutPromo(snapshot: CheckoutPromoSnapshot): void {
  if (typeof document === 'undefined') return
  writeCookie(CHECKOUT_PROMO_COOKIE_NAME, snapshot)
}

// Membaca snapshot promo checkout. null bila belum ada.
export function getCheckoutPromo(): CheckoutPromoSnapshot | null {
  if (typeof document === 'undefined') return null
  const raw = readRawCookie(CHECKOUT_PROMO_COOKIE_NAME)
  if (!raw) return null
  try {
    const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes)) as CheckoutPromoSnapshot
  } catch {
    return null
  }
}

// Store useSyncExternalStore untuk item checkout (dibaca reaktif di halaman /checkout)
let checkoutSnapshotCache: CartItem[] | null = null

export function getCheckoutSnapshot(): CartItem[] {
  if (checkoutSnapshotCache === null) checkoutSnapshotCache = getCheckoutItems()
  return checkoutSnapshotCache
}

export function getServerCheckoutSnapshot(): CartItem[] {
  return EMPTY_CART
}

export function subscribeCheckout(callback: () => void): () => void {
  const handler = () => {
    checkoutSnapshotCache = null
    callback()
  }
  window.addEventListener(CHECKOUT_UPDATED_EVENT, handler)
  return () => window.removeEventListener(CHECKOUT_UPDATED_EVENT, handler)
}

// === Util ===

// Mengambil nilai mentah satu cookie berdasarkan nama, atau null bila tidak ada
function readRawCookie(name: string): string | null {
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`))
  return match ? match.split('=').slice(1).join('=') : null
}

// Menulis nilai JSON ke cookie sebagai base64 (string UTF-8 → bytes → biner → base64)
// agar nilai JSON aman dari masalah parsing cookie di sebagian browser.
function writeCookie(name: string, value: unknown): void {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('')
  document.cookie = `${name}=${btoa(binary)}; path=/; max-age=${CART_COOKIE_MAX_AGE}; SameSite=Lax`
}

// Mendekode nilai cookie base64 menjadi array CartItem; array kosong bila tidak ada/rusak.
function decodeItems(raw: string | null): CartItem[] {
  if (!raw) return []
  try {
    const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0))
    const parsed = JSON.parse(new TextDecoder().decode(bytes))
    return Array.isArray(parsed) ? (parsed as CartItem[]) : []
  } catch {
    // Cookie korup / format lama → anggap kosong agar tidak crash
    return []
  }
}
