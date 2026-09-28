// src/components/cart/PromoQuotaBadge.tsx
// Label sisa kuota sebuah promo ("Sisa 3 kuota"), dipakai keranjang & mini cart. Tak tampil untuk
// promo tanpa batas. Sisa sedikit (≤ 5) diberi warna mencolok supaya pembeli tahu promonya bisa
// habis sebelum ia membayar — tapi tetap jujur: angkanya sisa sungguhan saat promo dimuat.

import { remainingQuota, type Promotion } from '@/types/promotion'

export default function PromoQuotaBadge({
  promo,
  className = '',
}: {
  promo: Pick<Promotion, 'usageLimit' | 'usageCount'>
  className?: string
}) {
  const sisa = remainingQuota(promo)
  if (sisa === null || sisa <= 0) return null
  const menipis = sisa <= 5
  return (
    <span
      className={`inline-flex w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        menipis ? 'bg-red-50 text-red-600' : 'bg-brand-light/40 text-brand-primary'
      } ${className}`}
    >
      Sisa {sisa} kuota
    </span>
  )
}
