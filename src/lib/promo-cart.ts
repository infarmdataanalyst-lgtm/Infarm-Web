// src/lib/promo-cart.ts
// Helper murni (tanpa I/O) untuk logika promo & combo di halaman keranjang:
// - progres tiap promo terhadap subtotal + agregasi hadiah yang tercapai
// - alokasi harga combo ke tiap produk
// - pemilihan combo paling relevan dengan isi keranjang
// Dipakai oleh halaman keranjang (client). Sumber data promo/combo tetap dari server (API).

import { type Promotion, type PromotionType } from '@/types/promotion'
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

// === Promo: perhitungan uang OTORITATIF ===
//
// ⚠️ INI SATU-SATUNYA tempat nilai rupiah promo boleh dihitung. computePromoRewards di atas kini
// HANYA untuk pesan progres di keranjang; angka uangnya diambil dari sini.
//
// Kenapa dipisah begitu: sampai 2026-09-07 keranjang mengurangi totalnya sendiri
// (`finalTotal = selectedTotal - totalDiscount`) sementara checkout dan server sama sekali tak
// mengenal diskon (`const discount = 0`). Pembeli melihat satu angka lalu ditagih angka lain.
// Selama tampilan dan server memanggil FUNGSI YANG SAMA dengan subtotal yang sama, keduanya
// mustahil berbeda lagi — pola yang sudah terbukti pada allocateComboPrices saat menutup SEC-033.

// Satu promo yang benar-benar diterapkan pada sebuah pesanan (disimpan sebagai snapshot jsonb di
// orders.promo_terpakai, supaya menghapus promo tak menghapus jejak pesanan yang memakainya).
export type AppliedPromo = {
  id: string
  name: string
  type: PromotionType
  // Rupiah yang disumbangkan promo ini SEBELUM plafon & lantai gateway diterapkan — ia mencatat
  // MAKSUD promonya, bukan hasil akhir. Yang otoritatif untuk penagihan adalah `discount` dan
  // `shippingSubsidy` di OrderPromoResult; jangan menjumlahkan field ini untuk mendapatkan total.
  value: number
}

export type OrderPromoResult = {
  discount: number // total potongan harga barang (rupiah)
  shippingSubsidy: number // ongkir yang ditanggung promo (rupiah)
  appliedPromos: AppliedPromo[]
  clampedByCap: boolean // diskon dipotong plafon maksimum
  clampedByMinTotal: boolean // diskon dipotong agar total tak jatuh di bawah batas gateway
}

export type PromoLimits = {
  maxDiscountPercent: number // plafon diskon terhadap subtotal (mis. 50)
  minTotal: number // total terkecil yang masih bisa ditagihkan (XENDIT_MIN_AMOUNT)
}

// Apakah sebuah promo berlaku untuk subtotal & waktu tertentu.
//
// Penyaringan waktu WAJIB diulang di server. /api/promotions/active menyaringnya untuk klien, tapi
// endpoint order bersifat publik — promo kedaluwarsa bisa saja datang dari pemanggil yang tak lewat
// halaman keranjang sama sekali.
export function isPromoEligible(promo: Promotion, subtotal: number, nowMs: number): boolean {
  if (!promo.isActive) return false
  if (promo.startAt && new Date(promo.startAt).getTime() > nowMs) return false
  if (promo.endAt && new Date(promo.endAt).getTime() < nowMs) return false
  return subtotal >= promo.minPurchase
}

// Menghitung potongan harga & subsidi ongkir dari seluruh promo yang berlaku.
//
// ── Aturan penumpukan (keputusan pemilik proyek, 2026-09-07) ──
//   discount_percent → AMBIL YANG TERTINGGI, tidak dijumlah. Dua promo 30% menjadi 30%, bukan 60%.
//     Menumpuk persen hampir tidak pernah disengaja dan paling cepat menggerus margin.
//   discount_nominal → DIJUMLAH.
//   free_shipping    → cukup satu tercapai; ongkir disubsidi penuh. Boleh digabung dengan diskon.
//
// ── Dua pengaman, berurutan ──
//   1. Plafon: diskon tak boleh melebihi maxDiscountPercent% dari subtotal.
//   2. Lantai gateway: bila total masih di bawah minTotal, diskon dikurangi lagi seperlunya; kalau
//      itu belum cukup, subsidi ongkir ikut dikurangi. Pesanan yang mustahil ditagihkan jauh lebih
//      buruk daripada diskon yang sedikit berkurang.
//
// Fungsi MURNI: tak menyentuh DB, tak membaca env, tak melihat jam sistem (nowMs disuntikkan).
export function computeOrderPromos(
  promos: Promotion[],
  subtotal: number,
  shippingCost: number,
  nowMs: number,
  limits: PromoLimits,
): OrderPromoResult {
  const eligible = promos.filter((p) => isPromoEligible(p, subtotal, nowMs))
  const applied: AppliedPromo[] = []

  // Diskon nominal — dijumlah.
  let nominal = 0
  for (const p of eligible) {
    if (p.type !== 'discount_nominal') continue
    const v = Math.max(0, Math.round(p.discountValue ?? 0))
    if (v <= 0) continue
    nominal += v
    applied.push({ id: p.id, name: p.name, type: p.type, value: v })
  }

  // Diskon persen — hanya yang TERTINGGI yang dipakai.
  let bestPercent: { promo: Promotion; value: number } | null = null
  for (const p of eligible) {
    if (p.type !== 'discount_percent') continue
    const pct = Math.max(0, Math.min(100, Math.round(p.discountValue ?? 0)))
    if (pct <= 0) continue
    const value = Math.round((subtotal * pct) / 100)
    if (!bestPercent || value > bestPercent.value) bestPercent = { promo: p, value }
  }
  if (bestPercent) {
    nominal += bestPercent.value
    applied.push({
      id: bestPercent.promo.id,
      name: bestPercent.promo.name,
      type: bestPercent.promo.type,
      value: bestPercent.value,
    })
  }

  // Gratis ongkir — satu tercapai sudah cukup.
  const freeShippingPromo = eligible.find((p) => p.type === 'free_shipping')
  let shippingSubsidy = freeShippingPromo ? Math.max(0, Math.round(shippingCost)) : 0

  // Pengaman 1: plafon terhadap subtotal.
  const cap = Math.floor((subtotal * Math.max(0, limits.maxDiscountPercent)) / 100)
  const rawDiscount = nominal
  let discount = Math.min(rawDiscount, cap, subtotal)
  const clampedByCap = discount < rawDiscount

  // Pengaman 2: lantai nominal gateway.
  let clampedByMinTotal = false
  const totalOf = (d: number, s: number) => subtotal + shippingCost - d - s
  if (totalOf(discount, shippingSubsidy) < limits.minTotal) {
    clampedByMinTotal = true
    const kurang = limits.minTotal - totalOf(discount, shippingSubsidy)
    const potongDiskon = Math.min(discount, kurang)
    discount -= potongDiskon
    // Masih di bawah lantai → subsidi ongkir ikut dikurangi. Terjadi hanya bila subtotal sendiri
    // sudah sangat kecil; minimum belanja toko biasanya sudah mencegahnya lebih dulu.
    const sisa = limits.minTotal - totalOf(discount, shippingSubsidy)
    if (sisa > 0) shippingSubsidy = Math.max(0, shippingSubsidy - sisa)
  }

  if (shippingSubsidy > 0 && freeShippingPromo) {
    applied.push({
      id: freeShippingPromo.id,
      name: freeShippingPromo.name,
      type: freeShippingPromo.type,
      value: shippingSubsidy,
    })
  }

  return { discount, shippingSubsidy, appliedPromos: applied, clampedByCap, clampedByMinTotal }
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
