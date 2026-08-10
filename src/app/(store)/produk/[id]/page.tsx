// src/app/(store)/produk/[id]/page.tsx
// Halaman Detail Produk dinamis. Header (AppBar) sudah disediakan oleh layout (store).
// Merakit: slider foto, info utama, kombo hemat, deskripsi, "baru dilihat", ulasan, dan bilah aksi bawah.
// Server Component — produk OMS dibaca dari Supabase; produk dummy lama dipakai sebagai fallback.

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

// Halaman detail di-cache & revalidasi tiap 30 detik (ISR). Baca data lewat wrapper BER-CACHE
// (cached-reads) agar query Supabase tak lagi memaksa halaman jadi dynamic. Update produk/ulasan/
// combo/stok di OMS memicu revalidateTag(...) → cache langsung diperbarui tanpa tunggu 30 detik.
export const revalidate = 30
// Aktifkan ISR untuk route dinamis: tanpa ini Next 16 menandai [id] sebagai fully dynamic.
// Return [] = tidak ada halaman di-prebuild saat build; tiap id di-render on-demand lalu
// di-cache (ISR blocking) sesuai `revalidate`/`revalidateTag`.
export const dynamicParams = true
export function generateStaticParams(): { id: string }[] {
  return []
}
import { getProductDetail } from '@/lib/data/dummy-product-details'
import {
  getCachedProductById,
  getCachedProducts,
  getCachedCombos,
  getCachedReviewsByProduct,
  getCachedRatingSummary,
  getCachedSalesCountByProduct,
  getCachedVariantsByProduct,
} from '@/lib/mock-db/cached-reads'
import type { StoredProduct, ProductDetail, ProductReview } from '@/types/product'
import ProductImageSlider from '@/components/product/ProductImageSlider'
import ProductInfo from '@/components/product/ProductInfo'
import VariantSelector from '@/components/product/VariantSelector'
import BundleOffer from '@/components/product/BundleOffer'
import ProductDescription from '@/components/product/ProductDescription'
import RecentlyViewed from '@/components/product/RecentlyViewed'
import ProductReviews from '@/components/product/ProductReviews'
import StickyBuyBar from '@/components/product/StickyBuyBar'
import CartToast from '@/components/product/CartToast'
import TrackProductView from '@/components/product/TrackProductView'
import ProductAnalytics from '@/components/product/ProductAnalytics'

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
    minOrderQty: p.minOrderQty ?? 1,
    sku: p.sku,
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

// Judul halaman dinamis = nama produk, supaya laporan GA4 "Pages and screens"
// mengelompokkan per NAMA produk (bukan UUID di URL yang tak terbaca).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const stored = await getCachedProductById(id)
  const name = stored && !stored.archived ? stored.name : getProductDetail(id)?.name
  if (!name) return { title: 'Produk — infarm.id' }
  return {
    title: `${name} — infarm.id`,
    description: `Beli ${name} original di infarm.id.`,
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
  const stored = await getCachedProductById(id)
  let product: ProductDetail | null
  if (stored && !stored.archived) {
    // Ambil ulasan tampil & rating agregat untuk produk ini
    const [reviews, summary] = await Promise.all([
      getCachedReviewsByProduct(stored.id),
      getCachedRatingSummary(stored.id),
    ])
    product = toProductDetail(stored, reviews, summary)
  } else {
    product = getProductDetail(id)
  }
  if (!product) notFound()

  // Paket combo REAL (Supabase) yang aktif, memuat produk ini, & semua produknya masih ada stok.
  // Varian produk (opsional): kosong bila produk tak bervarian → tampil seperti biasa.
  const [allCombos, allProducts, salesCounts, variants] = await Promise.all([
    getCachedCombos(),
    getCachedProducts(),
    getCachedSalesCountByProduct(),
    getCachedVariantsByProduct(product.id),
  ])
  const hasVariants = variants.length > 0
  const soldCount = salesCounts[product.id] ?? 0
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

  return (
    // pt-14: ruang untuk AppBar fixed (h-14). pb-24: ruang agar konten tak tertutup bilah aksi
    // mengambang — hanya perlu di mobile; di desktop (lg+) bilah itu statis, jadi padding dikecilkan.
    <main className="flex flex-1 flex-col bg-brand-surface pt-14 pb-24 lg:pb-8">
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
              {/* Produk bervarian → harga disembunyikan di ProductInfo, ditampilkan VariantSelector */}
              <ProductInfo product={product} soldCount={soldCount} showPrice={!hasVariants} />
              {hasVariants && <VariantSelector productId={product.id} variants={variants} />}
            </div>

            {/* 5 — Deskripsi / spesifikasi produk (di bawah info, kolom kanan desktop) */}
            <div className="lg:overflow-hidden lg:rounded-xl">
              <ProductDescription description={product.description} />
            </div>

            {/* 8 + 9 — Tombol aksi + logika simpan ke cookie keranjang.
                Ditempatkan DI SINI (bukan di akhir halaman) supaya di desktop tombolnya tampil statis
                tepat di bawah section Deskripsi Produk. Di mobile komponennya `fixed` sehingga keluar
                dari alur dan tetap menempel di dasar layar — posisinya di markup tidak berpengaruh. */}
            <StickyBuyBar
              productId={product.id}
              price={product.promoPrice}
              name={product.name}
              category={product.category}
              sku={product.sku}
              minOrderQty={product.minOrderQty ?? 1}
              variants={variants}
            />
          </div>
        </div>

        {/* Bagian bawah: tetap tumpuk vertikal di semua ukuran layar */}
        <div className="flex flex-col gap-2 lg:gap-4">
          {/* 4 — Rekomendasi paket kombo hemat (real dari Supabase, clickable) */}
          <BundleOffer combos={productCombos} imageById={imageById} />

          {/* 6 — "Produk yang Pernah Anda Lihat" (dari localStorage real-time) */}
          <RecentlyViewed currentProductId={id} allProducts={allProducts} />

          {/* 7 — Ulasan pembeli: skor ringkas, filter, daftar komentar */}
          <ProductReviews
            rating={product.rating}
            reviewCount={product.reviewCount}
            reviews={product.reviews}
          />
        </div>
      </div>

      {/* Catat produk ini ke riwayat "pernah dilihat" (localStorage, sisi-klien) */}
      <TrackProductView productId={product.id} />

      {/* GA4 view_item (sekali per tampilan produk) */}
      <ProductAnalytics
        product={{
          id: product.id,
          sku: product.sku,
          name: product.name,
          category: product.category,
          price: product.promoPrice,
        }}
      />

      {/* Toast notifikasi sukses (dipicu via event dari StickyBuyBar & BundleOffer) */}
      <CartToast />
    </main>
  )
}
