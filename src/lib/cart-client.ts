// src/lib/cart-client.ts
// Helper SISI-KLIEN untuk membaca/menulis cookie keranjang (`infarm_cart`) langsung dari browser.
// Dipakai oleh interaksi tombol (mis. "+ Keranjang") yang berjalan di komponen 'use client'.
// Catatan: pembacaan keranjang dari Server Component nanti memakai cookies() di lib/cart.ts.

import type { CartItem } from '@/types/cart'

// === Konstanta cookie ===
const CART_COOKIE_NAME = 'infarm_cart'
const CART_COOKIE_MAX_AGE = 60 * 60 * 24 * 7 // 7 hari (dalam detik)

// Event global agar UI lain (mis. badge jumlah di navbar) bisa ikut update tanpa reload
export const CART_UPDATED_EVENT = 'infarm:cart-updated'

// Event khusus untuk memicu efek "pop/getar" pada ikon keranjang saat animasi terbang menyentuhnya
export const CART_BUMP_EVENT = 'infarm:cart-bump'

// Event untuk memunculkan toast notifikasi sukses ("Berhasil ditambahkan ke keranjang")
export const CART_TOAST_EVENT = 'infarm:cart-toast'

// Memunculkan toast sukses dari mana saja (StickyBuyBar, BundleOffer, dll). Pesan opsional.
export function showCartToast(message?: string): void {
  window.dispatchEvent(new CustomEvent(CART_TOAST_EVENT, { detail: { message } }))
}

// === Baca Cookie ===

// Membaca seluruh isi keranjang dari cookie browser. Mengembalikan array kosong bila belum ada/rusak.
export function getCart(): CartItem[] {
  if (typeof document === 'undefined') return [] // guard: jangan jalan saat SSR

  const raw = readRawCookie(CART_COOKIE_NAME)
  if (!raw) return []

  try {
    // Cookie di-encode base64 (lihat writeCart) — decode base64 → bytes → string UTF-8
    const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0))
    const json = new TextDecoder().decode(bytes)
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? (parsed as CartItem[]) : []
  } catch {
    // Cookie korup / format lama → anggap keranjang kosong agar tidak crash
    return []
  }
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
  // Encode ke base64 (string UTF-8 → bytes → biner → base64) agar nilai JSON
  // aman dari masalah parsing cookie di sebagian browser
  const bytes = new TextEncoder().encode(JSON.stringify(cart))
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('')
  const encoded = btoa(binary)
  document.cookie = `${CART_COOKIE_NAME}=${encoded}; path=/; max-age=${CART_COOKIE_MAX_AGE}; SameSite=Lax`

  // Beri tahu komponen lain (mis. badge navbar) bahwa keranjang berubah
  window.dispatchEvent(new CustomEvent(CART_UPDATED_EVENT))
}

// === Util ===

// Mengambil nilai mentah satu cookie berdasarkan nama, atau null bila tidak ada
function readRawCookie(name: string): string | null {
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`))
  return match ? match.split('=').slice(1).join('=') : null
}
