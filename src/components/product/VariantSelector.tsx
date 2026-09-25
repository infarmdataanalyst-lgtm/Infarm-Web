'use client'

// src/components/product/VariantSelector.tsx
// Blok varian di halaman detail: harga+stok varian terpilih (reaktif) + chip pilihan.
// Chip INLINE hanya tampil di desktop (lg+). Di mobile chip disembunyikan → pilihan varian muncul
// lewat bottom-sheet saat menekan "+ Keranjang"/"Beli Langsung" (lihat StickyBuyBar). Harga tetap tampil.

import { useSyncExternalStore } from 'react'
import type { ProductVariant } from '@/types/variant'
import { formatRupiah } from '@/lib/format'
import VariantChips from '@/components/product/VariantChips'
import {
  subscribeVariant,
  getSelectedVariant,
  getServerSelectedVariant,
  pickDefaultVariant,
  toSelectedVariant,
} from '@/lib/variant-selection'

// Menampilkan harga+stok varian terpilih dan (di desktop) chip varian. Kosong bila produk tak bervarian.
export default function VariantSelector({
  productId,
  variants,
}: {
  productId: string
  variants: ProductVariant[]
}) {
  const selected = useSyncExternalStore(subscribeVariant, getSelectedVariant, getServerSelectedVariant)

  if (variants.length === 0) return null

  // Varian aktif = dari store (bila cocok produk ini), fallback ke default.
  const active =
    selected && selected.productId === productId
      ? selected
      : (() => {
          const def = pickDefaultVariant(variants)
          return def ? toSelectedVariant(productId, def) : null
        })()

  const outOfStock = !active || active.stock <= 0

  return (
    <section className="bg-white px-4 pb-4">
      {/* Harga + stok varian terpilih (reaktif) — tampil di semua ukuran layar */}
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-2xl font-bold text-brand-primary">
          {active ? formatRupiah(active.price) : '-'}
        </span>
        {active && (
          <span className={`text-sm ${outOfStock ? 'text-red-500' : 'text-zinc-500'}`}>
            {outOfStock ? 'Stok habis' : `Stok: ${active.stock}`}
          </span>
        )}
      </div>

      {/* Chip pilihan varian — INLINE hanya desktop. Mobile pilih lewat bottom-sheet. */}
      <div className="hidden lg:block">
        <p className="mb-2 text-sm font-semibold text-zinc-700">Pilih Varian</p>
        <VariantChips productId={productId} variants={variants} />
      </div>

      {/* Petunjuk ringkas di mobile */}
      <p className="text-sm text-zinc-500 lg:hidden">
        Varian: <span className="font-semibold text-zinc-700">{active?.name ?? '-'}</span>
        <span className="text-zinc-400"> · pilih saat menambah ke keranjang</span>
      </p>
    </section>
  )
}
