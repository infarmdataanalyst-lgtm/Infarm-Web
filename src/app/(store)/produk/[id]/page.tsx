// src/app/(store)/produk/[id]/page.tsx
// Halaman Detail Produk dinamis. Header (AppBar) sudah disediakan oleh layout (store).
// Merakit: slider foto, info utama, kombo hemat, deskripsi, "baru dilihat", ulasan, dan bilah aksi bawah.
// Server Component — produk OMS dibaca dari Supabase; produk dummy lama dipakai sebagai fallback.

import { notFound } from 'next/navigation'
import { getProductDetail, getRecentlyViewed } from '@/lib/data/dummy-product-details'
import { getProductById, readProducts } from '@/lib/mock-db/products'
import { readCombos } from '@/lib/mock-db/combos'
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
// Galeri memakai kolom images (maks 9); fallback ke foto utama bila galeri kosong.
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
    images: p.images.length > 0 ? p.images.slice(0, 9) : [p.imageUrl],
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

  // Paket combo REAL (Supabase) yang aktif, memuat produk ini, & semua produknya masih ada stok.
  const [allCombos, allProducts] = await Promise.all([readCombos(), readProducts()])
  const stockById: Record<string, number> = {}
  const imageById: Record<string, string> = {}
  for (const p of allProducts) {
    stockById[p.id] = p.stock
    imageById[p.id] = p.imageUrl
  }
  const productCombos = allCombos.filter(
    (c) =>
      c.isActive &&
      c.items.some((it) => it.productId === product.id) &&
      c.items.every((it) => (stockById[it.productId] ?? 0) > 0),
  )

  const recentlyViewed = getRecentlyViewed(id)

  return (
    // pt-14: ruang untuk AppBar fixed (h-14). pb-24: ruang agar konten tak tertutup bilah aksi bawah.
    <main className="flex flex-1 flex-col bg-brand-surface pt-14 pb-24">
      {/* Container terpusat: full-bleed di mobile, dibatasi lebar di desktop */}
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 lg:gap-4 lg:px-6 lg:py-4">
        {/* Bagian atas: 2 kolom sejajar di desktop (foto kiri, info kanan),
            stack vertikal di mobile (foto+thumbnail di atas, info di bawah) */}
        <div className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
          {/* 2 — Slider foto produk (maks 9) + thumbnail + dots */}
          <div className="lg:sticky lg:top-16 lg:overflow-hidden lg:rounded-xl">
            <ProductImageSlider images={product.images} alt={product.name} />
          </div>

          {/* 3 — Informasi utama + deskripsi: mengisi kolom kanan di desktop */}
          <div className="flex flex-col gap-2">
            <div className="lg:overflow-hidden lg:rounded-xl">
              <ProductInfo product={product} />
            </div>
            {/* 5 — Deskripsi / spesifikasi produk (di bawah info, kolom kanan desktop) */}
            <div className="lg:overflow-hidden lg:rounded-xl">
              <ProductDescription description={product.description} />
            </div>
          </div>
        </div>

        {/* Bagian bawah: tetap tumpuk vertikal di semua ukuran layar */}
        <div className="flex flex-col gap-2 lg:gap-4">
          {/* 4 — Rekomendasi paket kombo hemat (real dari Supabase, clickable) */}
          <BundleOffer combos={productCombos} imageById={imageById} />

          {/* 6 — "Kamu Sempat Lihat Ini" */}
          <RecentlyViewed products={recentlyViewed} />

          {/* 7 — Ulasan pembeli: skor ringkas, filter, daftar komentar */}
          <ProductReviews
            rating={product.rating}
            reviewCount={product.reviewCount}
            reviews={product.reviews}
          />
        </div>
      </div>

      {/* 8 + 9 — Bilah aksi bawah (sticky) + logika simpan ke cookie keranjang */}
      <StickyBuyBar productId={product.id} price={product.promoPrice} />

      {/* Toast notifikasi sukses (dipicu via event dari StickyBuyBar & BundleOffer) */}
      <CartToast />
    </main>
  )
}
