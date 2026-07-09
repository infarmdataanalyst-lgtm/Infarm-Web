'use client'

// src/components/product/BundleOffer.tsx
// Seksi "Beli Kombo Lebih Hemat" di halaman detail produk. Menampilkan paket/combo REAL dari
// Supabase yang memuat produk ini (data disiapkan server di page.tsx). Klik kartu = tambahkan
// seluruh produk combo ke keranjang dengan harga combo (alokasi per produk) + tandai comboId.

import Image from 'next/image'
import { calcNormalPrice, type ProductCombo } from '@/types/combo'
import { formatRupiah } from '@/lib/format'
import { addComboToCart, showCartToast, CART_BUMP_EVENT } from '@/lib/cart-client'
import { allocateComboPrices } from '@/lib/promo-cart'

const PLACEHOLDER = '/images/product-placeholder.png'

// Menampilkan kartu combo hemat yang clickable; klik = tambahkan seluruh produk combo ke keranjang.
export default function BundleOffer({
  combos,
  imageById,
}: {
  combos: ProductCombo[]
  imageById: Record<string, string>
}) {
  if (combos.length === 0) return null

  // Tambahkan satu paket combo ke keranjang (harga combo dialokasikan ke tiap produk), lalu pop + toast.
  function handleAddCombo(combo: ProductCombo) {
    const allocated = allocateComboPrices(combo.items, combo.comboPrice)
    addComboToCart(combo.id, allocated)
    window.dispatchEvent(new CustomEvent(CART_BUMP_EVENT))
    showCartToast('Paket kombo berhasil ditambahkan ke keranjang!')
  }

  return (
    <section className="bg-white px-4 py-4">
      <h2 className="mb-2 text-sm font-bold text-zinc-800">Beli Kombo Lebih Hemat</h2>

      <div className="space-y-2">
        {combos.map((combo) => {
          const normal = calcNormalPrice(combo.items)
          const savings = Math.max(0, normal - combo.comboPrice)

          return (
            <button
              key={combo.id}
              type="button"
              onClick={() => handleAddCombo(combo)}
              className="flex w-full items-center gap-3 rounded-xl border border-brand-light bg-brand-surface p-3 text-left transition hover:brightness-95 active:scale-[0.99]"
            >
              {/* Foto produk-produk combo, dipisah ikon plus (maks 3) */}
              <div className="flex shrink-0 items-center gap-1">
                {combo.items.slice(0, 3).map((item, idx) => (
                  <div key={item.productId} className="flex items-center gap-1">
                    {idx > 0 && <span className="text-lg font-bold text-brand-primary">+</span>}
                    <ComboThumb src={imageById[item.productId] ?? PLACEHOLDER} alt={item.name} />
                  </div>
                ))}
              </div>

              {/* Info harga hemat */}
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-xs text-zinc-600">
                  Beli bareng <span className="font-semibold">{combo.name}</span>
                </p>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
                  <span className="text-base font-bold text-red-500">{formatRupiah(combo.comboPrice)}</span>
                  {savings > 0 && (
                    <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold text-red-500">
                      Hemat {formatRupiah(savings)}
                    </span>
                  )}
                </div>
              </div>

              {/* Tanda centang penanda paket dapat dipilih */}
              <CheckIcon className="shrink-0 text-zinc-400" />
            </button>
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
