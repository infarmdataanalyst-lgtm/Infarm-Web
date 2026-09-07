// src/app/api/promotions/active/route.ts
// API publik (storefront): daftar promo yang AKTIF & belum kedaluwarsa, untuk halaman keranjang.
// Filter dilakukan di server (query Supabase tetap server-only via mock-db) sehingga promo
// nonaktif/kedaluwarsa tidak ikut terkirim ke client. Diurutkan dari minimal pembelian terkecil.
//
// Selain daftar promonya, endpoint ini juga mengirim dua hal yang dibutuhkan keranjang untuk
// menampilkan angka yang SAMA dengan yang nanti ditagih server:
//   • freeProductAvailable — apakah produk hadiah promo free_product benar-benar masih ada stoknya.
//     Tanpa ini keranjang menjanjikan hadiah yang tak akan pernah dikirim (dulu dilewati diam-diam
//     di dua tempat sekaligus: keranjang dan orders/create).
//   • maxDiscountPercent — plafon diskon yang sama dengan yang dipakai server saat menghitung
//     tagihan. Dititipkan di sini, bukan di endpoint sendiri, supaya keranjang tak perlu satu
//     round-trip tambahan hanya untuk satu angka.

import { NextResponse } from 'next/server'
import { readPromotions } from '@/lib/mock-db/promotions'
import { readProducts } from '@/lib/mock-db/products'
import { getMaxDiscountPercent } from '@/lib/mock-db/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic' // selalu pakai data promo terbaru

export async function GET() {
  const now = Date.now()
  const [all, products, maxDiscountPercent] = await Promise.all([
    readPromotions(),
    readProducts(),
    getMaxDiscountPercent(),
  ])

  // Peta ketersediaan produk hadiah. Produk diarsipkan atau stok habis → hadiahnya tak bisa
  // dikirim, dan keranjang harus mengatakannya alih-alih menampilkan pesan sukses.
  const productById = new Map(products.map((p) => [p.id, p]))

  const promotions = all
    .filter((p) => {
      if (!p.isActive) return false
      // start_at null ATAU sudah lewat; end_at null ATAU belum lewat
      if (p.startAt && new Date(p.startAt).getTime() > now) return false
      if (p.endAt && new Date(p.endAt).getTime() < now) return false
      return true
    })
    .map((p) => {
      if (p.type !== 'free_product' || !p.freeProductId) return { ...p, freeProductAvailable: true }
      const prod = productById.get(p.freeProductId)
      const available = Boolean(prod && !prod.archived && prod.stock > 0)
      return { ...p, freeProductAvailable: available }
    })
    .sort((a, b) => a.minPurchase - b.minPurchase)

  return NextResponse.json({ promotions, maxDiscountPercent })
}
