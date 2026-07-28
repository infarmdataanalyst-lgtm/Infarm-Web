'use client'

// src/components/product/VariantChips.tsx
// Deretan chip pilihan varian (dipakai inline di desktop & di dalam bottom-sheet mobile).
// Membaca/menulis varian terpilih ke store bersama (variant-selection) agar sinkron di mana pun.

import { useEffect, useSyncExternalStore } from 'react'
import type { ProductVariant } from '@/types/variant'
import {
  subscribeVariant,
  getSelectedVariant,
  getServerSelectedVariant,
  setSelectedVariant,
  pickDefaultVariant,
  toSelectedVariant,
} from '@/lib/variant-selection'

// Menampilkan chip varian. Chip stok 0 → nonaktif + label "(Stok Habis)".
export default function VariantChips({
  productId,
  variants,
}: {
  productId: string
  variants: ProductVariant[]
}) {
  const selected = useSyncExternalStore(subscribeVariant, getSelectedVariant, getServerSelectedVariant)

  // Seed varian default ke store saat mount (bila belum ada untuk produk ini).
  useEffect(() => {
    const def = pickDefaultVariant(variants)
    if (def) setSelectedVariant(toSelectedVariant(productId, def))
  }, [productId, variants])

  const activeId =
    selected && selected.productId === productId ? selected.variantId : pickDefaultVariant(variants)?.id

  return (
    <div className="flex flex-wrap gap-2">
      {variants.map((v) => {
        const isActive = activeId === v.id
        const habis = v.stock <= 0
        return (
          <button
            key={v.id}
            type="button"
            disabled={habis}
            onClick={() => setSelectedVariant(toSelectedVariant(productId, v))}
            aria-pressed={isActive}
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
              habis
                ? 'cursor-not-allowed border-zinc-200 bg-zinc-50 text-zinc-300'
                : isActive
                  ? 'border-brand-primary bg-brand-surface text-brand-primary'
                  : 'border-zinc-300 bg-white text-zinc-700 hover:border-brand-primary'
            }`}
          >
            {v.name}
            {habis && <span className="ml-1 text-[11px] font-semibold text-red-400">(Stok Habis)</span>}
          </button>
        )
      })}
    </div>
  )
}
