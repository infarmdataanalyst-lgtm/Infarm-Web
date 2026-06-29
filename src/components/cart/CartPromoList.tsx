// src/components/cart/CartPromoList.tsx
// Daftar promo aktif di keranjang: progress bar + pesan untuk tiap promo (atau pesan sukses bila
// tercapai). Presentational — progres & pesan dihitung di parent (lib/promo-cart). Section
// disembunyikan bila tidak ada promo. Saat loading menampilkan skeleton ringan.

import { Gift, CheckCircle2 } from 'lucide-react'
import type { PromoProgress } from '@/lib/promo-cart'

export default function CartPromoList({
  promos,
  loading,
}: {
  promos: PromoProgress[]
  loading: boolean
}) {
  if (loading) {
    return <div className="mx-3 mt-3 h-16 animate-pulse rounded-lg bg-zinc-100" />
  }
  if (promos.length === 0) return null

  return (
    <div className="mx-3 mt-3 space-y-2">
      {promos.map(({ promo, reached, percent, message }) => (
        <div key={promo.id} className="rounded-lg bg-white p-3 shadow-sm">
          <div className="flex items-start gap-2 text-sm">
            {reached ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-brand-primary" />
            ) : (
              <Gift className="mt-0.5 h-4 w-4 flex-none text-brand-primary" />
            )}
            <p className={reached ? 'font-semibold text-brand-primary' : 'text-zinc-700'}>{message}</p>
          </div>

          {/* Progress bar hanya saat belum tercapai */}
          {!reached && (
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-brand-light/40">
              <div
                className="h-full rounded-full bg-brand-primary transition-all"
                style={{ width: `${percent}%` }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
