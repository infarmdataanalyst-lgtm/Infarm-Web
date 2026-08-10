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
          <li key={`${item.id}-${item.isPromoItem ? 'promo' : 'buy'}`} className="flex gap-3">
            {/* Thumbnail persegi */}
            <div
              className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border bg-zinc-50 ${
                item.isPromoItem ? 'border-brand-light' : 'border-zinc-100'
              }`}
            >
              {/* unoptimized: placeholder sementara */}
              <Image src={item.imageUrl} alt={item.name} fill unoptimized sizes="64px" className="object-cover" />
            </div>

            {/* Detail produk */}
            <div className="flex min-w-0 flex-1 flex-col">
              {/* Item hadiah promo diberi badge "Bonus Promo" agar beda dari produk beli normal */}
              {item.isPromoItem && (
                <span className="mb-0.5 inline-flex w-fit items-center gap-1 rounded-full bg-brand-light/40 px-2 py-0.5 text-[11px] font-semibold text-brand-primary">
                  🎁 Bonus Promo
                </span>
              )}
              <h3 className="line-clamp-2 text-sm font-medium leading-snug text-zinc-800">
                {item.name}
              </h3>
              {/* Nama varian terpilih (produk bervarian) */}
              {item.variantName && (
                <p className="mt-0.5 text-xs font-medium text-brand-primary">Varian: {item.variantName}</p>
              )}
              {item.variant && (
                <p className="mt-0.5 text-xs text-zinc-500">Varian: {item.variant}</p>
              )}

              {/* Harga + kuantitas — item promo tertulis "Gratis" (bukan Rp0 polos) */}
              <div className="mt-auto flex items-center justify-between pt-1">
                {/* Harga selalu hijau brand — sama dengan kartu produk di beranda/katalog.
                    Item promo tetap terbedakan lewat badge "Bonus Promo" & teks "Gratis",
                    bukan lewat warna. */}
                <span className="text-sm font-bold text-brand-primary">
                  {item.isPromoItem ? 'Gratis' : formatRupiah(item.price)}
                </span>
                <span className="text-xs text-zinc-500">x{item.quantity}</span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
