// src/app/(store)/produk/[id]/page.tsx
// Halaman Detail Produk dinamis. Header (AppBar) sudah disediakan oleh layout (store).
// Merakit: slider foto, info utama, kombo hemat, deskripsi, "baru dilihat", ulasan, dan bilah aksi bawah.
// Server Component — produk OMS dibaca dari Supabase; produk dummy lama dipakai sebagai fallback.

import { notFound } from 'next/navigation'
import {
  getProductDetail,
  getBundleSuggestion,
  getRecentlyViewed,
} from '@/lib/data/dummy-product-details'
import { getProductById } from '@/lib/mock-db/products'
import { getReviewsByProduct, getProductRatingSummary } from '@/lib/mock-db/reviews'
import type { StoredProduct, ProductDetail, ProductReview } from '@/types/product'
import ProductImageSlider from '@/components/product/ProductImageSlider'
import ProductInfo from '@/components/product/ProductInfo'
import BundleOffer from '@/components/product/BundleOffer'
import ProductDescription from '@/components/product/ProductDescription'
import RecentlyViewed from '@/components/product/RecentlyViewed'
import ProductReviews from '@/components/product/ProductReviews'
import StickyBuyBar from '@/components/product/StickyBuyBar'
import CartToast from '@/components/product/CartToast'

// Membangun ProductDetail dari produk Supabase (StoredProduct) + ulasan & rating real.
// Galeri memakai satu foto produk (multi-foto menyusul saat ada Supabase Storage).
function toProductDetail(
  p: StoredProduct,
  reviews: ProductReview[],
  summary: { rating: number; reviewCount: number },
): ProductDetail {
  return {
    id: p.id,
    name: p.name,
    originalPrice: p.originalPrice,
    promoPrice: p.promoPrice,
    imageUrl: p.imageUrl,
    category: p.category,
    badge: p.badge,
    images: [p.imageUrl],
    rating: summary.rating,
    reviewCount: summary.reviewCount,
    description: p.description?.trim() || 'Belum ada deskripsi untuk produk ini.',
    reviews,
  }
}

// Halaman detail satu produk berdasarkan id pada URL (/produk/[id]).
// Di Next.js 16, `params` berupa Promise sehingga perlu di-await.
export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  // Sumber utama: produk OMS dari Supabase (sembunyikan yang diarsipkan dari storefront).
  // Fallback: produk dummy lama agar halaman contoh tetap bisa dibuka.
  const stored = await getProductById(id)
  let product: ProductDetail | null
  if (stored && !stored.archived) {
    // Ambil ulasan tampil & rating agregat untuk produk ini
    const [reviews, summary] = await Promise.all([
      getReviewsByProduct(stored.id),
      getProductRatingSummary(stored.id),
    ])
    product = toProductDetail(stored, reviews, summary)
  } else {
    product = getProductDetail(id)
  }
  if (!product) notFound()

  const bundle = getBundleSuggestion(product)
  const recentlyViewed = getRecentlyViewed(id)

  return (
    // pt-14: ruang untuk AppBar fixed (h-14). pb-24: ruang agar konten tak tertutup bilah aksi bawah.
    <main className="flex flex-1 flex-col gap-2 bg-brand-surface pt-14 pb-24">
      {/* 2 — Slider foto produk (maks 9) + indikator dots */}
      <ProductImageSlider images={product.images} alt={product.name} />

      {/* 3 — Informasi utama: nama, harga, rating */}
      <ProductInfo product={product} />

      {/* 4 — Rekomendasi paket kombo hemat (clickable) */}
      {bundle && <BundleOffer bundle={bundle} />}

      {/* 5 — Deskripsi / spesifikasi produk */}
      <ProductDescription description={product.description} />

      {/* 6 — "Kamu Sempat Lihat Ini" */}
      <RecentlyViewed products={recentlyViewed} />

      {/* 7 — Ulasan pembeli: skor ringkas, filter, daftar komentar */}
      <ProductReviews
        rating={product.rating}
        reviewCount={product.reviewCount}
        reviews={product.reviews}
      />

      {/* 8 + 9 — Bilah aksi bawah (sticky) + logika simpan ke cookie keranjang */}
      <StickyBuyBar productId={product.id} price={product.promoPrice} />

      {/* Toast notifikasi sukses (dipicu via event dari StickyBuyBar & BundleOffer) */}
      <CartToast />
    </main>
  )
}
