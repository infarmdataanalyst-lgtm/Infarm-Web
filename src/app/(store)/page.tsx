// src/app/(store)/page.tsx
// Halaman utama (homepage) ecommerce infarm — SATU halaman berisi seluruh section secara berurutan.
// Semua section bersifat responsive (mobile → desktop).

import HeroSection from '@/components/home/HeroSection'
import ValuePropositionBanner from '@/components/home/ValuePropositionBanner'
import CategoryGrid from '@/components/home/CategoryGrid'
import BestSellingProducts from '@/components/home/BestSellingProducts'
import Footer from '@/components/home/Footer'
import { getBestSellingCatalogPage } from '@/lib/mock-db/cached-reads'

// Halaman di-cache & revalidasi tiap 60 detik (ISR). Data produk tak berubah tiap detik, jadi
// cukup segar per menit. Perubahan produk dari OMS memicu revalidatePath('/') → cache langsung fresh.
export const revalidate = 60

// Jumlah produk halaman pertama yang di-render server (selaras PAGE_SIZE di BestSellingProducts)
const FIRST_PAGE_SIZE = 10

// Homepage publik infarm — merakit Hero, value proposition, kategori, produk terlaris, dan footer
// menjadi satu halaman yang menyesuaikan diri di berbagai ukuran layar.
export default async function HomePage() {
  // Render halaman pertama "Katalog Terlaris" di SERVER (data cached) → jadi bagian HTML ISR.
  // Efeknya: kembali ke beranda menampilkan card seketika, tanpa skeleton/refetch client.
  const { products: initialProducts, hasMore: initialHasMore } = await getBestSellingCatalogPage(
    0,
    FIRST_PAGE_SIZE,
  )

  return (
    <main className="flex flex-1 flex-col">
      {/* Section 1 — Hero & Navigation (berisi kolom pencarian + autocomplete) */}
      <HeroSection />

      {/* Section 2 — Value Proposition Banner */}
      <ValuePropositionBanner />

      {/* Section 3 — Category Navigation Grid */}
      <CategoryGrid />

      {/* Section 4 — Best-Selling Products (halaman pertama dari server, sisanya infinite scroll) */}
      <BestSellingProducts initialProducts={initialProducts} initialHasMore={initialHasMore} />

      {/* Section 5 — Footer */}
      <Footer />
    </main>
  )
}
