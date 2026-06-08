// src/components/checkout/CheckoutProductSummary.tsx
// Seksi ringkasan produk yang sedang dibeli: thumbnail, nama, varian, kuantitas, dan harga.

import Image from 'next/image'
import type { CheckoutItem } from '@/lib/data/dummy-checkout'
import { formatRupiah } from '@/lib/format'

// Menampilkan daftar produk dalam pesanan saat ini.
export default function CheckoutProductSummary({ items }: { items: CheckoutItem[] }) {
  return (
    <section className="bg-white px-4 py-4">
      <h2 className="mb-3 text-sm font-bold text-zinc-800">Produk Dibeli</h2>

      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id} className="flex gap-3">
            {/* Thumbnail persegi */}
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-zinc-100 bg-zinc-50">
              {/* unoptimized: placeholder sementara */}
              <Image src={item.imageUrl} alt={item.name} fill unoptimized sizes="64px" className="object-cover" />
            </div>

            {/* Detail produk */}
            <div className="flex min-w-0 flex-1 flex-col">
              <h3 className="line-clamp-2 text-sm font-medium leading-snug text-zinc-800">
                {item.name}
              </h3>
              {item.variant && (
                <p className="mt-0.5 text-xs text-zinc-500">Varian: {item.variant}</p>
              )}

              {/* Harga + kuantitas */}
              <div className="mt-auto flex items-center justify-between pt-1">
                <span className="text-sm font-bold text-red-500">{formatRupiah(item.price)}</span>
                <span className="text-xs text-zinc-500">x{item.quantity}</span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
