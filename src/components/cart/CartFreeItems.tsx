// src/components/cart/CartFreeItems.tsx
// Menampilkan produk GRATIS hadiah promo (type='free_product') di keranjang sebagai item terpisah.
// Item ini TURUNAN dari evaluasi promo (bukan dari cookie): muncul otomatis saat subtotal mencapai
// min_purchase & hilang saat turun di bawahnya. Harga Rp0, qty terkunci, tanpa checkbox/hapus/atur qty.

import Image from 'next/image'
import { Gift } from 'lucide-react'

// Satu produk gratis yang siap ditampilkan (detail sudah di-resolve dari data produk).
export type FreeItemView = {
  productId: string
  name: string
  imageUrl: string
  quantity: number
}

// Menampilkan daftar produk gratis hadiah promo. Kosong → tak render apa pun.
export default function CartFreeItems({ items }: { items: FreeItemView[] }) {
  if (items.length === 0) return null

  return (
    <div className="divide-y divide-zinc-100">
      {items.map((item) => (
        <div key={`free-${item.productId}`} className="flex gap-3 bg-brand-surface/60 px-4 py-4">
          {/* Foto produk (tanpa link/kontrol — item hadiah tak bisa diubah) */}
          <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-brand-light bg-white">
            <Image
              src={item.imageUrl || '/images/product-placeholder.png'}
              alt={item.name}
              fill
              unoptimized
              sizes="96px"
              className="object-cover"
            />
            {/* Pita "Gratis" penanda item hadiah */}
            <span className="absolute left-0 top-2 rounded-r-md bg-brand-primary px-2 py-0.5 text-[10px] font-bold text-white shadow">
              Gratis
            </span>
          </div>

          {/* Detail */}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Badge "Bonus Promo" agar beda jelas dari item beli normal */}
            <span className="mb-1 inline-flex w-fit items-center gap-1 rounded-full bg-brand-light/40 px-2 py-0.5 text-[11px] font-semibold text-brand-primary">
              <Gift className="h-3 w-3" /> Bonus Promo
            </span>
            <h3 className="line-clamp-2 text-sm leading-snug text-zinc-800">{item.name}</h3>

            {/* Harga: "Gratis" (bukan Rp0 polos) + qty terkunci */}
            <div className="mt-auto flex items-center justify-between pt-2">
              <span className="text-base font-bold text-brand-primary">Gratis</span>
              <span className="rounded-lg border border-zinc-200 px-3 py-1 text-sm font-semibold text-zinc-500">
                {item.quantity}× hadiah
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
