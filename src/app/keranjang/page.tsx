'use client'

// src/app/keranjang/page.tsx
// Halaman Keranjang Belanja. Di LUAR route group (store) → punya header hijau sendiri (CartHeader).
// Sumber data keranjang = cookie (lib/cart-client.ts), dibaca reaktif via useSyncExternalStore.
// Promo aktif diambil REAL dari Supabase lewat API server-only (/api/promotions/active).
// (Rekomendasi paket combo tampil di halaman detail produk, bukan di keranjang.)

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { CartLineItem } from '@/types/cart'
import type { StoredProduct } from '@/types/product'
import type { Promotion } from '@/types/promotion'
import { dummyProducts } from '@/lib/data/dummy-products'
import {
  updateQuantity,
  removeFromCart,
  subscribeCart,
  getCartSnapshot,
  getServerCartSnapshot,
  setCheckoutItems,
  setCheckoutPromo,
} from '@/lib/cart-client'
import { computePromoProgress, computePromoRewards } from '@/lib/promo-cart'
import CartHeader from '@/components/cart/CartHeader'
import CartPromoList from '@/components/cart/CartPromoList'
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

  // Promo aktif real dari Supabase (via API server-only)
  const [promos, setPromos] = useState<Promotion[]>([])
  const [loadingPromos, setLoadingPromos] = useState(true)

  // === Ambil produk real dari API saat halaman dibuka ===
  useEffect(() => {
    fetch('/api/products/list')
      .then((res) => res.json())
      .then((data) => setOmsProducts(data.products ?? []))
      .catch(() => setOmsProducts([]))
  }, [])

  // === Ambil promo aktif (server-side filter). Gagal fetch → section promo kosong, halaman aman. ===
  useEffect(() => {
    let active = true
    fetch('/api/promotions/active')
      .then((res) => res.json())
      .then((data: { promotions?: Promotion[] }) => {
        if (active) setPromos(data.promotions ?? [])
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingPromos(false)
      })
    return () => {
      active = false
    }
  }, [])

  // === Gabungkan item cookie dengan detail produk (nama, foto, harga coret, badge) ===
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

  const selectedTotal = useMemo(
    () => selectedItems.reduce((sum, i) => sum + i.price * i.quantity, 0),
    [selectedItems],
  )

  const selectedCount = useMemo(
    () => selectedItems.reduce((sum, i) => sum + i.quantity, 0),
    [selectedItems],
  )

  const allSelected = items.length > 0 && items.every((i) => i.selected)

  // === Promo: progres tiap promo + agregasi hadiah yang tercapai (berdasar item tercentang) ===
  const promoProgress = useMemo(() => computePromoProgress(promos, selectedTotal), [promos, selectedTotal])
  const promoRewards = useMemo(() => computePromoRewards(promos, selectedTotal), [promos, selectedTotal])
  const finalTotal = Math.max(0, selectedTotal - promoRewards.totalDiscount)

  // === Aksi ===

  function toggleSelect(productId: string) {
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }

  function toggleSelectAll() {
    setExcluded(allSelected ? new Set(items.map((i) => i.productId)) : new Set())
  }

  function increment(productId: string) {
    const item = cookieCart.find((i) => i.productId === productId)
    if (item) updateQuantity(productId, item.quantity + 1)
  }

  function decrement(productId: string) {
    const item = cookieCart.find((i) => i.productId === productId)
    if (item) updateQuantity(productId, item.quantity - 1)
  }

  function remove(productId: string) {
    removeFromCart(productId)
  }

  // Lanjut ke checkout: simpan item TERCENTANG + snapshot promo/combo yang tercapai.
  function handleCheckout() {
    const chosen = selectedItems.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
      price: i.price,
    }))
    setCheckoutItems(chosen)

    // Snapshot promo/combo agar bisa diteruskan ke order nanti
    const selectedIdSet = new Set(selectedItems.map((i) => i.productId))
    const comboIds = Array.from(
      new Set(
        cookieCart
          .filter((c) => selectedIdSet.has(c.productId) && c.comboId)
          .map((c) => c.comboId as string),
      ),
    )
    setCheckoutPromo({
      promoIds: promoRewards.reachedPromoIds,
      freeShipping: promoRewards.freeShipping,
      discountTotal: promoRewards.totalDiscount,
      freeProductIds: promoRewards.freeProducts.map((f) => f.id),
      comboIds,
    })

    router.push('/checkout')
  }

  // Produk "baru dilihat" — contoh; TODO ganti riwayat asli
  const recentlyViewed = dummyProducts.filter((p) => p.badge).slice(0, 2)

  return (
    <div className="flex min-h-screen flex-col bg-brand-surface text-zinc-900">
      {/* 1 — Header hijau dengan tombol kembali + judul */}
      <CartHeader />

      {/* 2 — Promo aktif (real dari Supabase): progress bar / pesan sukses per promo */}
      <CartPromoList promos={promoProgress} loading={loadingPromos} />

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

      {/* 6 — Bilah checkout bawah (sticky); total sudah dikurangi diskon promo */}
      <CartCheckoutBar
        allSelected={allSelected}
        selectedCount={selectedCount}
        selectedTotal={finalTotal}
        onToggleSelectAll={toggleSelectAll}
        onCheckout={handleCheckout}
      />
    </div>
  )
}
