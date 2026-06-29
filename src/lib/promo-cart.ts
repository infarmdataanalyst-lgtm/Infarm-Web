// src/lib/promo-cart.ts
// Helper murni (tanpa I/O) untuk logika promo & combo di halaman keranjang:
// - progres tiap promo terhadap subtotal + agregasi hadiah yang tercapai
// - alokasi harga combo ke tiap produk
// - pemilihan combo paling relevan dengan isi keranjang
// Dipakai oleh halaman keranjang (client). Sumber data promo/combo tetap dari server (API).

import { type Promotion } from '@/types/promotion'
import { calcNormalPrice, type ComboItem } from '@/types/combo'
import { formatRupiah } from '@/lib/format'

// === Promo: progres & hadiah ===

export type PromoProgress = {
  promo: Promotion
  reached: boolean // subtotal sudah mencapai minimal pembelian
  remaining: number // sisa belanja menuju target (>= 0)
  percent: number // 0–100 untuk progress bar
  message: string // pesan progres ({sisa} diganti) ATAU pesan sukses bila tercapai
}

export type PromoRewards = {
  freeShipping: boolean // ada promo free_shipping tercapai → ongkir GRATIS
  nominalDiscount: number // total diskon nominal (Rp)
  percentDiscount: number // total diskon hasil persen × subtotal (Rp)
  totalDiscount: number // nominalDiscount + percentDiscount (≤ subtotal)
  freeProducts: { id: string; name: string }[] // produk hadiah dari free_product tercapai
  reachedPromoIds: string[]
}

// Label hadiah untuk pesan sukses, mis. "gratis ongkir" / "diskon Rp10.000" / "diskon 15%".
function rewardLabel(promo: Promotion): string {
  switch (promo.type) {
    case 'free_shipping':
      return 'gratis ongkir'
    case 'free_product':
      return promo.freeProductName ?? 'produk hadiah'
    case 'discount_nominal':
      return `diskon ${formatRupiah(promo.discountValue ?? 0)}`
    case 'discount_percent':
      return `diskon ${promo.discountValue ?? 0}%`
  }
}

// Hitung progres tiap promo terhadap subtotal keranjang.
export function computePromoProgress(promos: Promotion[], subtotal: number): PromoProgress[] {
  return promos.map((promo) => {
    const reached = subtotal >= promo.minPurchase
    const remaining = Math.max(0, promo.minPurchase - subtotal)
    const percent =
      promo.minPurchase > 0 ? Math.min(100, Math.round((subtotal / promo.minPurchase) * 100)) : 100
    const message = reached
      ? `🎉 Selamat! Kamu mendapatkan ${rewardLabel(promo)}`
      : promo.progressMessage.split('{sisa}').join(formatRupiah(remaining))
    return { promo, reached, remaining, percent, message }
  })
}

// Agregasi hadiah dari promo yang TERCAPAI (subtotal ≥ minimal pembelian).
export function computePromoRewards(promos: Promotion[], subtotal: number): PromoRewards {
  let freeShipping = false
  let nominalDiscount = 0
  let percentDiscount = 0
  const freeProducts: { id: string; name: string }[] = []
  const reachedPromoIds: string[] = []

  for (const promo of promos) {
    if (subtotal < promo.minPurchase) continue
    reachedPromoIds.push(promo.id)
    if (promo.type === 'free_shipping') {
      freeShipping = true
    } else if (promo.type === 'discount_nominal') {
      nominalDiscount += promo.discountValue ?? 0
    } else if (promo.type === 'discount_percent') {
      percentDiscount += Math.round((subtotal * (promo.discountValue ?? 0)) / 100)
    } else if (promo.type === 'free_product' && promo.freeProductId) {
      freeProducts.push({ id: promo.freeProductId, name: promo.freeProductName ?? 'Produk hadiah' })
    }
  }

  const totalDiscount = Math.min(subtotal, nominalDiscount + percentDiscount)
  return { freeShipping, nominalDiscount, percentDiscount, totalDiscount, freeProducts, reachedPromoIds }
}

// === Combo ===

// Alokasikan harga_combo ke tiap produk (proporsional terhadap harga normal) sehingga total
// harga item ≈ harga_combo. Item terakhir menampung sisa pembulatan agar jumlahnya pas.
// Dipakai saat menambahkan paket combo ke keranjang (mis. dari detail produk).
export function allocateComboPrices(
  items: ComboItem[],
  comboPrice: number,
): { productId: string; quantity: number; price: number }[] {
  const normalTotal = calcNormalPrice(items)
  let allocated = 0
  return items.map((item, idx) => {
    const itemNormal = item.unitPrice * item.quantity
    const isLast = idx === items.length - 1
    const itemTotal = isLast
      ? Math.max(0, comboPrice - allocated)
      : normalTotal > 0
        ? Math.round((comboPrice * itemNormal) / normalTotal)
        : Math.round(comboPrice / items.length)
    if (!isLast) allocated += itemTotal
    const price = item.quantity > 0 ? Math.max(0, Math.round(itemTotal / item.quantity)) : 0
    return { productId: item.productId, quantity: item.quantity, price }
  })
}
