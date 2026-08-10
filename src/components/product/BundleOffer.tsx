'use client'

// src/components/product/BundleOffer.tsx
// Seksi "Beli Kombo Lebih Hemat" di halaman detail produk. Menampilkan paket/combo REAL dari
// Supabase yang memuat produk ini (data disiapkan server di page.tsx).
// Checkbox di pojok kiri atas tiap kartu: dicentang = seluruh produk combo masuk keranjang
// (harga combo, ditandai comboId); di-uncheck = seluruh produk combo dihapus dari keranjang.
// Status checked disinkron reaktif dengan isi keranjang (via useSyncExternalStore) → tetap sinkron
// setelah reload halaman.

import Image from 'next/image'
import { useSyncExternalStore } from 'react'
import { calcNormalPrice, type ProductCombo } from '@/types/combo'
import { formatRupiah } from '@/lib/format'
import {
  addComboToCart,
  removeComboFromCart,
  showCartToast,
  CART_BUMP_EVENT,
  subscribeCart,
  getCartSnapshot,
  getServerCartSnapshot,
} from '@/lib/cart-client'
import { allocateComboPrices } from '@/lib/promo-cart'
import { trackComboAddToCart } from '@/lib/analytics'
import type { CartItem } from '@/types/cart'

const PLACEHOLDER = '/images/product-placeholder.png'

// Sebuah combo dianggap "ada di keranjang" bila SEMUA produknya ada di keranjang & ditandai comboId ini.
function isComboInCart(combo: ProductCombo, cart: CartItem[]): boolean {
  return combo.items.every((it) =>
    cart.some((c) => c.productId === it.productId && c.comboId === combo.id),
  )
}

// Menampilkan daftar kartu combo hemat; centang checkbox = tambah seluruh produk combo ke keranjang.
export default function BundleOffer({
  combos,
  imageById,
}: {
  combos: ProductCombo[]
  imageById: Record<string, string>
}) {
  // Baca keranjang secara reaktif dari cookie (snapshot server kosong agar tidak mismatch saat hidrasi).
  const cart = useSyncExternalStore(subscribeCart, getCartSnapshot, getServerCartSnapshot)

  if (combos.length === 0) return null

  // Centang: tambahkan seluruh produk combo (harga combo dialokasikan per produk) + toast.
  // Uncheck: hapus seluruh produk combo dari keranjang.
  function toggleCombo(combo: ProductCombo, checked: boolean) {
    if (checked) {
      const allocated = allocateComboPrices(combo.items, combo.comboPrice)
      addComboToCart(combo.id, allocated)
      // GA4 add_to_cart: SATU event berisi semua item combo (nama dari snapshot, harga hasil alokasi).
      // Dikirim SETELAH item masuk cookie keranjang (konsisten dengan jalur produk tunggal).
      trackComboAddToCart(
        combo.comboPrice,
        allocated.map((a) => ({
          productId: a.productId,
          name: combo.items.find((it) => it.productId === a.productId)?.name ?? '',
          price: a.price,
          quantity: a.quantity,
        })),
      )
      window.dispatchEvent(new CustomEvent(CART_BUMP_EVENT))
      showCartToast('Paket kombo berhasil ditambahkan ke keranjang!')
    } else {
      removeComboFromCart(combo.id)
    }
  }

  return (
    <section className="bg-white px-4 py-4">
      <h2 className="mb-2 text-sm font-bold text-zinc-800">Beli Kombo Lebih Hemat</h2>

      <div className="space-y-2">
        {combos.map((combo) => {
          const normal = calcNormalPrice(combo.items)
          const savings = Math.max(0, normal - combo.comboPrice)
          const checked = isComboInCart(combo, cart)

          return (
            <div
              key={combo.id}
              className={`relative flex items-center gap-3 rounded-xl border bg-brand-surface p-3 pl-9 transition ${
                checked ? 'border-brand-primary' : 'border-brand-light'
              }`}
            >
              {/* Checkbox pojok kiri atas — kontrol utama tambah/hapus combo */}
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => toggleCombo(combo, e.target.checked)}
                aria-label={`Tambahkan ${combo.name} ke keranjang`}
                className="absolute left-3 top-3 h-4 w-4 shrink-0 cursor-pointer accent-brand-primary"
              />

              {/* Foto produk-produk combo, dipisah ikon plus (maks 3) */}
              <div className="flex shrink-0 items-center gap-1">
                {combo.items.slice(0, 3).map((item, idx) => (
                  <div key={item.productId} className="flex items-center gap-1">
                    {idx > 0 && <span className="text-lg font-bold text-brand-primary">+</span>}
                    <ComboThumb src={imageById[item.productId] ?? PLACEHOLDER} alt={item.name} />
                  </div>
                ))}
              </div>

              {/* Info harga hemat + rincian produk (collapsible) */}
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-xs text-zinc-600">
                  Beli bareng <span className="font-semibold">{combo.name}</span>
                </p>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
                  <span className="text-base font-bold text-brand-primary">{formatRupiah(combo.comboPrice)}</span>
                  {savings > 0 && (
                    <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold text-red-500">
                      Hemat {formatRupiah(savings)}
                    </span>
                  )}
                </div>

                {/* Rincian isi combo — collapsible agar kartu tetap ringkas (default tertutup) */}
                <details className="mt-1 text-xs text-zinc-500">
                  <summary className="cursor-pointer list-none font-medium text-brand-primary marker:hidden">
                    Lihat isi paket ({combo.items.length} produk)
                  </summary>
                  <ul className="mt-1 space-y-0.5">
                    {combo.items.map((item) => (
                      <li key={item.productId} className="truncate">
                        {item.name} <span className="text-zinc-400">x{item.quantity}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              </div>

              {/* Tanda centang penanda status: hijau bila paket sudah di keranjang, abu bila belum */}
              <CheckIcon className={`shrink-0 ${checked ? 'text-brand-primary' : 'text-zinc-400'}`} />
            </div>
          )
        })}
      </div>
    </section>
  )
}

// === Sub-komponen ===

// Thumbnail kecil 1 produk di dalam kartu kombo
function ComboThumb({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="relative h-14 w-14 overflow-hidden rounded-lg border border-zinc-100 bg-white">
      <Image src={src} alt={alt} fill unoptimized sizes="56px" className="object-cover" />
    </div>
  )
}

function CheckIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
