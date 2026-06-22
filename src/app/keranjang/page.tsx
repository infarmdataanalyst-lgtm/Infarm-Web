'use client'

// src/app/keranjang/page.tsx
// Halaman Keranjang Belanja. Ditempatkan DI LUAR route group (store) agar tidak mewarisi
// AppBar global — halaman ini punya header hijau sendiri (CartHeader).
// Sumber data keranjang = cookie (lib/cart-client.ts), dibaca reaktif via useSyncExternalStore.

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { CartLineItem } from '@/types/cart'
import type { StoredProduct } from '@/types/product'
import { dummyProducts } from '@/lib/data/dummy-products'
import {
  updateQuantity,
  removeFromCart,
  subscribeCart,
  getCartSnapshot,
  getServerCartSnapshot,
  setCheckoutItems,
} from '@/lib/cart-client'
import CartHeader from '@/components/cart/CartHeader'
import GiftBanner from '@/components/cart/GiftBanner'
import CartItemRow from '@/components/cart/CartItemRow'
import ProtectionInfo from '@/components/cart/ProtectionInfo'
import CartRecentlyViewed from '@/components/cart/CartRecentlyViewed'
import CartCheckoutBar from '@/components/cart/CartCheckoutBar'

export default function CartPage() {
  const router = useRouter()

  // === Baca cookie keranjang secara reaktif (tanpa setState di effect) ===
  const cookieCart = useSyncExternalStore(subscribeCart, getCartSnapshot, getServerCartSnapshot)

  // Set ID produk yang TIDAK dicentang (default: semua tercentang). Hanya state UI, tak masuk cookie.
  const [excluded, setExcluded] = useState<Set<string>>(new Set())

  // Produk OMS dari Supabase (untuk me-resolve detail item keranjang yang ber-id UUID)
  const [omsProducts, setOmsProducts] = useState<StoredProduct[]>([])

  // === Ambil produk real dari API saat halaman dibuka ===
  useEffect(() => {
    fetch('/api/products/list')
      .then((res) => res.json())
      .then((data) => setOmsProducts(data.products ?? []))
      .catch(() => setOmsProducts([]))
  }, [])

  // === Gabungkan item cookie dengan detail produk (nama, foto, harga coret, badge) ===
  // Cari produk dari Supabase dulu, lalu fallback ke dummy (produk contoh lama).
  const items: CartLineItem[] = useMemo(() => {
    return cookieCart.flatMap((ci) => {
      const product =
        omsProducts.find((p) => p.id === ci.productId) ??
        dummyProducts.find((p) => p.id === ci.productId)
      if (!product) return []
      return [
        {
          productId: ci.productId,
          name: product.name,
          imageUrl: product.imageUrl,
          price: ci.price,
          originalPrice: product.originalPrice,
          quantity: ci.quantity,
          selected: !excluded.has(ci.productId),
          badge: product.badge,
        },
      ]
    })
  }, [cookieCart, excluded, omsProducts])

  // === Kalkulasi dinamis (item tercentang) ===
  const selectedItems = useMemo(() => items.filter((i) => i.selected), [items])

  // Total harga belanja dari item yang dicentang
  const selectedTotal = useMemo(
    () => selectedItems.reduce((sum, i) => sum + i.price * i.quantity, 0),
    [selectedItems],
  )

  // Jumlah barang (akumulasi quantity) yang dicentang — dipakai di "Item (X)" & "Checkout (X)"
  const selectedCount = useMemo(
    () => selectedItems.reduce((sum, i) => sum + i.quantity, 0),
    [selectedItems],
  )

  const allSelected = items.length > 0 && items.every((i) => i.selected)

  // === Aksi ===

  // Centang / lepas centang satu item (toggle keanggotaan di set "excluded")
  function toggleSelect(productId: string) {
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }

  // Pilih semua / lepas semua
  function toggleSelectAll() {
    setExcluded(allSelected ? new Set(items.map((i) => i.productId)) : new Set())
  }

  // Tambah jumlah satu item (+1) — tulis ke cookie, store memicu re-render
  function increment(productId: string) {
    const item = cookieCart.find((i) => i.productId === productId)
    if (item) updateQuantity(productId, item.quantity + 1)
  }

  // Kurangi jumlah satu item (-1). Jika mencapai 0, item dihapus dari keranjang.
  function decrement(productId: string) {
    const item = cookieCart.find((i) => i.productId === productId)
    if (item) updateQuantity(productId, item.quantity - 1) // <1 otomatis dihapus oleh helper
  }

  // Hapus item dari keranjang
  function remove(productId: string) {
    removeFromCart(productId)
  }

  // Lanjut ke checkout: simpan dulu item TERCENTANG ke cookie checkout agar dibaca di /checkout
  function handleCheckout() {
    const chosen = selectedItems.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
      price: i.price,
    }))
    setCheckoutItems(chosen)
    router.push('/checkout')
  }

  // Produk "baru dilihat" — ambil 2 produk berbadge promo sebagai contoh
  // TODO: ganti dengan riwayat asli setelah fitur tracking dibuat
  const recentlyViewed = dummyProducts.filter((p) => p.badge).slice(0, 2)

  return (
    <div className="flex min-h-screen flex-col bg-brand-surface text-zinc-900">
      {/* 1 — Header hijau dengan tombol kembali + judul */}
      <CartHeader />

      {/* 2 — Banner hadiah dinamis berdasarkan total item tercentang */}
      <GiftBanner selectedTotal={selectedTotal} />

      {/* pb-24: ruang agar konten tak tertutup bilah checkout bawah yang fixed */}
      <main className="flex-1 pb-24">
        {/* 3 — Daftar item keranjang */}
        {items.length > 0 ? (
          <div className="mt-3 divide-y divide-zinc-100">
            {items.map((item) => (
              <CartItemRow
                key={item.productId}
                item={item}
                onToggleSelect={toggleSelect}
                onIncrement={increment}
                onDecrement={decrement}
                onRemove={remove}
              />
            ))}
          </div>
        ) : (
          <p className="px-4 py-16 text-center text-sm text-zinc-400">Keranjang kamu masih kosong.</p>
        )}

        {/* 4 — Informasi perlindungan */}
        <ProtectionInfo />

        {/* 5 — Rekomendasi "Kamu sempat lihat ini" */}
        <CartRecentlyViewed products={recentlyViewed} />
      </main>

      {/* 6 — Bilah checkout bawah (sticky) dengan total & jumlah dinamis */}
      <CartCheckoutBar
        allSelected={allSelected}
        selectedCount={selectedCount}
        selectedTotal={selectedTotal}
        onToggleSelectAll={toggleSelectAll}
        onCheckout={handleCheckout}
      />
    </div>
  )
}
