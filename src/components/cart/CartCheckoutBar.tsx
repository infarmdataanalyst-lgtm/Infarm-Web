'use client'

// src/components/cart/CartCheckoutBar.tsx
// Bilah aksi bawah (sticky): checkbox "Pilih Semua" + jumlah item, total harga dinamis,
// dan tombol "Checkout (X)" yang nonaktif bila tidak ada item tercentang. Presentational,
// selain mendaftarkan tingginya ke --sticky-bar-h (agar FloatingWhatsApp naik di atasnya).

import { Check } from 'lucide-react'
import { formatRupiah } from '@/lib/format'
import { useStickyBarHeight } from '@/hooks/use-sticky-bar-height'

// Menampilkan bilah checkout bawah dengan pilih-semua, total, dan tombol checkout.
export default function CartCheckoutBar({
  allSelected,
  selectedCount,
  selectedTotal,
  onToggleSelectAll,
  onCheckout,
  subtotal,
  minOrderAmount,
}: {
  allSelected: boolean
  selectedCount: number
  selectedTotal: number
  onToggleSelectAll: () => void
  onCheckout: () => void
  subtotal: number // subtotal BARANG tercentang (tanpa ongkir/diskon) — dasar minimum belanja
  minOrderAmount: number // batas minimum dari pengaturan toko (0 = tak ada batas)
}) {
  // Kekurangan agar mencapai minimum belanja. > 0 → checkout dikunci.
  const shortfall = Math.max(0, minOrderAmount - subtotal)
  const belowMinimum = selectedCount > 0 && shortfall > 0
  const disabled = selectedCount === 0 || belowMinimum
  const barRef = useStickyBarHeight<HTMLDivElement>()

  return (
    <div ref={barRef} className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white">
      {/* Pemberitahuan minimum belanja — muncul hanya bila ada item tercentang tapi belum cukup */}
      {belowMinimum && (
        <p className="mx-auto max-w-6xl px-4 pt-2 text-xs leading-snug text-orange-700">
          Minimal belanja {formatRupiah(minOrderAmount)}, tambah {formatRupiah(shortfall)} lagi untuk
          checkout.
        </p>
      )}
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        {/* Kiri: Pilih Semua */}
        <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm text-zinc-700">
          <span className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={onToggleSelectAll}
              aria-label="Pilih semua"
              className="peer h-5 w-5 cursor-pointer appearance-none rounded border border-zinc-300 bg-white checked:border-brand-primary checked:bg-brand-primary"
            />
            <Check className="pointer-events-none absolute h-3.5 w-3.5 text-white opacity-0 peer-checked:opacity-100" strokeWidth={3} />
          </span>
          <span>Item ({selectedCount})</span>
        </label>

        {/* Tengah: Total dinamis */}
        <div className="ml-auto text-right">
          <p className="text-xs text-zinc-500">Total</p>
          <p className="text-base font-bold text-zinc-900">{formatRupiah(selectedTotal)}</p>
        </div>

        {/* Kanan: Tombol checkout (mati bila tidak ada item tercentang) */}
        <button
          type="button"
          onClick={onCheckout}
          disabled={disabled}
          className="shrink-0 rounded-xl bg-brand-primary px-6 py-3 font-heading text-base font-bold text-white shadow-sm transition hover:brightness-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500"
        >
          Checkout ({selectedCount})
        </button>
      </div>
    </div>
  )
}
