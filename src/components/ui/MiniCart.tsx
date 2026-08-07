'use client'

// src/components/ui/MiniCart.tsx
// Panel mini cart (flyout) yang menempel di bawah ikon keranjang — KHUSUS desktop (≥640px);
// di mobile ikon keranjang tetap menavigasi ke /keranjang (lihat CartIconLink).
// Isi: daftar item (thumbnail, nama, qty, harga), subtotal, tombol "Lihat Keranjang" & "Checkout".
//
// Sumber data = cookie keranjang (reaktif via useSyncExternalStore), sama seperti halaman keranjang.
// Nama & foto produk TIDAK ada di cookie → di-resolve lewat GET /api/products/by-ids (cached 30s),
// dan hanya di-fetch saat panel dibuka agar tidak membebani setiap kunjungan halaman.

import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { ShoppingBag } from 'lucide-react'
import {
  subscribeCart,
  getCartSnapshot,
  getServerCartSnapshot,
  setCheckoutItems,
} from '@/lib/cart-client'
import { formatRupiah } from '@/lib/format'
import type { StoredProduct } from '@/types/product'

// Maksimal tinggi area daftar sebelum discroll (≈4 baris item)
const LIST_MAX_HEIGHT = 'max-h-72'

// Menampilkan isi keranjang ringkas. `open` mengatur visibilitas + animasi; komponen tetap
// ter-mount agar transisi muncul & hilang sama-sama halus.
export default function MiniCart({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const cart = useSyncExternalStore(subscribeCart, getCartSnapshot, getServerCartSnapshot)

  // Detail produk hasil resolve dari server (nama, foto)
  const [products, setProducts] = useState<StoredProduct[]>([])

  // Key stabil (diurut) supaya fetch hanya berulang saat kumpulan id benar-benar berubah
  const idsKey = useMemo(
    () => Array.from(new Set(cart.map((c) => c.productId))).sort().join(','),
    [cart],
  )

  // Fetch hanya saat panel terbuka & ada isi keranjang
  useEffect(() => {
    if (!open || !idsKey) return
    const controller = new AbortController()
    fetch(`/api/products/by-ids?ids=${encodeURIComponent(idsKey)}`, { signal: controller.signal })
      .then((res) => res.json())
      .then((data: { products?: StoredProduct[] }) => setProducts(data.products ?? []))
      .catch(() => {
        // Abort saat panel ditutup / id berubah — abaikan. Error lain → tampilkan data seadanya.
      })
    return () => controller.abort()
  }, [open, idsKey])

  // Gabungkan item cookie dengan detail produk. Baris = productId + variantId (varian = baris sendiri).
  const lines = useMemo(() => {
    return cart.map((item) => {
      const product = products.find((p) => p.id === item.productId)
      return {
        key: `${item.productId}::${item.variantId ?? ''}`,
        name: product?.name ?? 'Memuat…',
        imageUrl: product?.imageUrl ?? '/images/product-placeholder.png',
        variantName: item.variantName,
        quantity: item.quantity,
        price: item.price,
      }
    })
  }, [cart, products])

  const subtotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [cart],
  )

  // Checkout dari mini cart WAJIB menulis cookie `infarm_checkout` dulu — halaman /checkout
  // membaca cookie itu, bukan `infarm_cart` (lihat aturan sinkronisasi di CLAUDE.md).
  function handleCheckout() {
    setCheckoutItems(cart)
    onClose()
    router.push('/checkout')
  }

  return (
    <div
      role="dialog"
      aria-label="Ringkasan keranjang"
      className={`absolute right-0 top-full z-50 mt-2 w-80 origin-top-right overflow-hidden rounded-2xl border border-brand-light bg-white text-zinc-800 shadow-lg transition-all duration-200 ease-out ${
        open ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-1 opacity-0'
      }`}
    >
      {/* Kepala */}
      <div className="border-b border-brand-light/60 bg-brand-surface px-4 py-2.5">
        <p className="text-sm font-bold text-zinc-900">Keranjang</p>
        <p className="text-xs text-zinc-500">
          {cart.length > 0 ? `${cart.length} produk di keranjang` : 'Belum ada produk'}
        </p>
      </div>

      {cart.length === 0 ? (
        // === Keranjang kosong ===
        <div className="flex flex-col items-center px-4 py-8 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-light/30 text-brand-primary">
            <ShoppingBag className="h-7 w-7" />
          </span>
          <p className="mt-3 text-sm font-bold text-zinc-900">Keranjang kamu masih kosong</p>
          <p className="mt-1 text-xs text-zinc-500">Yuk, cari benih dan pupuk untuk kebunmu.</p>
          <Link
            href="/products"
            onClick={onClose}
            className="mt-4 rounded-xl bg-brand-primary px-5 py-2 text-sm font-bold text-white transition hover:brightness-90 active:scale-[0.99]"
          >
            Mulai Belanja
          </Link>
        </div>
      ) : (
        <>
          {/* === Daftar item (scroll bila lebih dari ±4 baris) === */}
          <ul className={`${LIST_MAX_HEIGHT} divide-y divide-zinc-100 overflow-y-auto`}>
            {lines.map((line) => (
              <li key={line.key} className="flex items-center gap-3 px-4 py-3">
                <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-brand-surface">
                  {/* unoptimized: URL Supabase Storage belum didaftarkan di remotePatterns
                      (pola sama dengan CartItemRow) */}
                  <Image src={line.imageUrl} alt={line.name} fill unoptimized sizes="48px" className="object-cover" />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-zinc-800">{line.name}</span>
                  {line.variantName && (
                    <span className="block truncate text-xs text-zinc-400">{line.variantName}</span>
                  )}
                  <span className="mt-0.5 block text-xs text-zinc-500">
                    {line.quantity} × {formatRupiah(line.price)}
                  </span>
                </span>

                <span className="shrink-0 text-sm font-bold text-brand-primary">
                  {formatRupiah(line.price * line.quantity)}
                </span>
              </li>
            ))}
          </ul>

          {/* === Subtotal & aksi === */}
          <div className="border-t border-zinc-100 p-3">
            <div className="mb-3 flex items-baseline justify-between px-1">
              <span className="text-sm text-zinc-500">Subtotal</span>
              <span className="text-base font-bold text-brand-primary">{formatRupiah(subtotal)}</span>
            </div>

            <div className="flex gap-2">
              <Link
                href="/keranjang"
                onClick={onClose}
                className="flex-1 rounded-xl border border-zinc-300 py-2 text-center text-sm font-bold text-zinc-700 transition hover:bg-zinc-50 active:scale-[0.99]"
              >
                Lihat Keranjang
              </Link>
              <button
                type="button"
                onClick={handleCheckout}
                className="flex-1 rounded-xl bg-brand-primary py-2 text-sm font-bold text-white transition hover:brightness-90 active:scale-[0.99]"
              >
                Checkout
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
