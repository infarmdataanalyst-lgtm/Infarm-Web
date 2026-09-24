// src/components/cart/CartComboGroup.tsx
// Satu paket di keranjang: kepala paket (centang, nama, total, pengatur JUMLAH PAKET, hapus) lalu
// anggota-anggotanya di bawahnya. Presentational — semua aksi lewat callback dari halaman keranjang.
//
// Jumlah diatur di tingkat PAKET, bukan per produk. Paket hanya sah bila setiap anggotanya
// berjumlah (isi per paket × N) dengan N yang sama; memberi pembeli tombol +/− per anggota sama
// saja memberinya cara merusak paket (lalu pesanan ditolak di server). Dengan satu stepper, isi
// seperti 3-3-2 memang tak bisa dibentuk dari keranjang.

import { Check } from 'lucide-react'
import type { CartLineItem } from '@/types/cart'
import { formatRupiah } from '@/lib/format'
import CartItemRow from '@/components/cart/CartItemRow'

export type CartComboGroupView = {
  comboId: string
  name: string
  members: CartLineItem[]
  selected: boolean
  // Jumlah paket saat ini, atau null bila isi keranjang tak lagi cocok dengan definisi paket di
  // database (paket diubah/dinonaktifkan admin setelah masuk keranjang).
  count: number | null
  // Batas atas jumlah paket menurut stok; null = tak diketahui (tak dibatasi di keranjang,
  // penegakan tetap di server).
  maxCount: number | null
}

const noop = () => {}

export default function CartComboGroup({
  group,
  onToggleSelect,
  onSetCount,
  onRemove,
}: {
  group: CartComboGroupView
  onToggleSelect: (comboId: string) => void
  onSetCount: (comboId: string, count: number) => void
  onRemove: (comboId: string) => void
}) {
  const { comboId, name, members, selected, count, maxCount } = group
  const total = members.reduce((sum, m) => sum + m.price * m.quantity, 0)
  const rusak = count === null
  const mentok = maxCount !== null && count !== null && count >= maxCount
  const stokKurang = maxCount !== null && count !== null && count > maxCount

  return (
    <div className="bg-white">
      {/* Kepala paket */}
      <div className="flex items-center gap-3 border-b border-zinc-100 bg-brand-surface/60 px-4 py-3">
        <span className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(comboId)}
            aria-label={`Pilih ${name}`}
            className="peer h-5 w-5 cursor-pointer appearance-none rounded border border-zinc-300 bg-white checked:border-brand-primary checked:bg-brand-primary"
          />
          <Check className="pointer-events-none absolute h-3.5 w-3.5 text-white opacity-0 peer-checked:opacity-100" strokeWidth={3} />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-zinc-800">{name}</p>
          <p className="text-xs text-zinc-500">
            {count !== null && count > 1 ? `${count} paket · ` : ''}
            <span className="font-semibold text-brand-primary">{formatRupiah(total)}</span>
          </p>
        </div>

        {/* Pengatur jumlah PAKET. "−" di 1 paket dikunci: mengeluarkan paket lewat tombol hapus,
            sama seperti baris satuan yang berhenti di batas minimumnya. */}
        <div className={`flex items-center rounded-lg border border-zinc-300 bg-white ${rusak ? 'opacity-40' : ''}`}>
          <button
            type="button"
            onClick={() => count !== null && onSetCount(comboId, count - 1)}
            disabled={rusak || count <= 1}
            aria-label={`Kurangi jumlah ${name}`}
            className="px-3 py-1 text-lg leading-none text-zinc-600 transition active:scale-95 disabled:opacity-40"
          >
            −
          </button>
          <span
            aria-live="polite"
            className="min-w-[2.5rem] border-x border-zinc-300 py-1 text-center text-sm font-semibold text-zinc-800"
          >
            {count ?? '–'}
          </span>
          <button
            type="button"
            onClick={() => count !== null && onSetCount(comboId, count + 1)}
            disabled={rusak || mentok}
            aria-label={`Tambah jumlah ${name}`}
            className="px-3 py-1 text-lg leading-none text-zinc-600 transition active:scale-95 disabled:opacity-40"
          >
            +
          </button>
        </div>

        <button
          type="button"
          onClick={() => onRemove(comboId)}
          aria-label={`Hapus ${name}`}
          className="p-1 text-red-500 transition active:scale-95"
        >
          <TrashIcon />
        </button>
      </div>

      {/* Alasan paket tak bisa dilanjutkan — ditulis, bukan dibiarkan pembeli menebak */}
      {rusak && (
        <p className="bg-red-50 px-4 py-2 text-xs font-medium text-red-700">
          Isi paket ini sudah berubah atau paketnya tidak tersedia lagi. Hapus paket lalu tambahkan
          ulang dari halaman produk.
        </p>
      )}
      {stokKurang && (
        <p className="bg-red-50 px-4 py-2 text-xs font-medium text-red-700">
          Stok hanya cukup untuk {maxCount} paket, kurangi jumlahnya.
        </p>
      )}

      {/* Anggota paket — jumlahnya mengikuti paket, tanpa kontrol sendiri */}
      <div className="divide-y divide-zinc-100 pl-8">
        {members.map((m) => (
          <CartItemRow
            key={`${m.productId}::${m.variantId ?? ''}`}
            item={m}
            onToggleSelect={noop}
            onIncrement={noop}
            onDecrement={noop}
            onSetQuantity={noop}
            onRemove={noop}
          />
        ))}
      </div>
    </div>
  )
}

function TrashIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}
