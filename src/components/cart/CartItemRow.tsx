// src/components/cart/CartItemRow.tsx
// Satu baris item keranjang: checkbox pilih, foto, nama, harga jual+coret, tombol hapus, dan
// pengatur jumlah (- qty +). Presentational — semua aksi dikirim lewat callback dari parent.

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import type { CartLineItem } from '@/types/cart'
import { formatRupiah } from '@/lib/format'

// Menampilkan satu item keranjang beserta kontrol pilih/hapus/atur jumlah.
export default function CartItemRow({
  item,
  onToggleSelect,
  onIncrement,
  onDecrement,
  onSetQuantity,
  onRemove,
}: {
  item: CartLineItem
  onToggleSelect: (productId: string, variantId?: string) => void
  onIncrement: (productId: string, variantId?: string) => void
  onDecrement: (productId: string, variantId?: string) => void
  onSetQuantity: (productId: string, quantity: number, variantId?: string) => void
  onRemove: (productId: string, variantId?: string) => void
}) {
  const { productId, name, imageUrl, price, originalPrice, quantity, selected, variantId, variantName } = item

  // State teks lokal agar user bisa mengetik bebas (mis. mengosongkan field lalu ketik "10").
  // Disinkronkan bila quantity dari cookie berubah (mis. tombol +/-).
  const [draft, setDraft] = useState(String(quantity))
  useEffect(() => {
    setDraft(String(quantity))
  }, [quantity])

  // Commit nilai ketikan → set jumlah. Kosong/0/invalid → kembalikan ke 1 (jangan hapus item).
  function commitDraft() {
    const parsed = parseInt(draft, 10)
    const next = Number.isNaN(parsed) || parsed < 1 ? 1 : parsed
    setDraft(String(next))
    if (next !== quantity) onSetQuantity(productId, next, variantId)
  }

  return (
    <div className="flex gap-3 bg-white px-4 py-4">
      {/* Checkbox pilih item */}
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggleSelect(productId, variantId)}
        aria-label={`Pilih ${name}`}
        className="mt-1 h-5 w-5 shrink-0 accent-brand-primary"
      />

      {/* Foto produk — klik menuju halaman detail produk */}
      <Link
        href={`/produk/${productId}`}
        aria-label={`Lihat detail produk ${name}`}
        className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-zinc-100 bg-zinc-50 transition hover:opacity-80"
      >
        {/* unoptimized: placeholder SVG sementara */}
        <Image src={imageUrl} alt={name} fill unoptimized sizes="96px" className="object-cover" />
      </Link>

      {/* Detail & kontrol */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Nama produk — klik menuju halaman detail produk */}
        <Link
          href={`/produk/${productId}`}
          aria-label={`Lihat detail produk ${name}`}
          className="w-fit transition hover:text-brand-primary"
        >
          <h3 className="line-clamp-2 text-sm leading-snug text-zinc-800">{name}</h3>
        </Link>

        {/* Nama varian terpilih (bila produk bervarian) */}
        {variantName && (
          <span className="mt-1 w-fit rounded bg-brand-surface px-2 py-0.5 text-xs font-medium text-brand-primary">
            Varian: {variantName}
          </span>
        )}

        {/* Harga jual (merah) + harga coret */}
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-base font-bold text-red-500">{formatRupiah(price)}</span>
          {originalPrice > price && (
            <span className="text-xs text-zinc-400 line-through">{formatRupiah(originalPrice)}</span>
          )}
        </div>

        {/* Baris bawah: tombol hapus (kiri) + pengatur jumlah (kanan) */}
        <div className="mt-auto flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={() => onRemove(productId, variantId)}
            aria-label={`Hapus ${name}`}
            className="p-1 text-red-500 transition active:scale-95"
          >
            <TrashIcon />
          </button>

          {/* Pengatur jumlah: - qty + */}
          <div className="flex items-center rounded-lg border border-zinc-300">
            <button
              type="button"
              onClick={() => onDecrement(productId, variantId)}
              aria-label="Kurangi jumlah"
              className="px-3 py-1 text-lg leading-none text-zinc-600 transition active:scale-95 disabled:opacity-40"
            >
              −
            </button>
            {/* Input jumlah — bisa diketik langsung. inputMode=numeric → keyboard angka di mobile. */}
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={draft}
              onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
              onFocus={(e) => e.target.select()}
              onBlur={commitDraft}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
              aria-label={`Jumlah ${name}`}
              className="min-w-[2.5rem] w-12 border-x border-zinc-300 bg-transparent py-1 text-center text-sm font-semibold text-zinc-800 focus:outline-none focus:bg-brand-surface"
            />
            <button
              type="button"
              onClick={() => onIncrement(productId, variantId)}
              aria-label="Tambah jumlah"
              className="px-3 py-1 text-lg leading-none text-zinc-600 transition active:scale-95"
            >
              +
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function TrashIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}
