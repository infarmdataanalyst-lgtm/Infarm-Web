// src/app/(store)/page.tsx
// Halaman utama (homepage) ecommerce infarm — SATU halaman berisi seluruh section secara berurutan.
// Semua section bersifat responsive (mobile → desktop).

import HeroSection from '@/components/home/HeroSection'
import ValuePropositionBanner from '@/components/home/ValuePropositionBanner'
import CategoryGrid from '@/components/home/CategoryGrid'
import BestSellingProducts from '@/components/home/BestSellingProducts'
import Footer from '@/components/home/Footer'

// Halaman di-cache & revalidasi tiap 60 detik (ISR). Data produk tak berubah tiap detik, jadi
// cukup segar per menit. Perubahan produk dari OMS memicu revalidatePath('/') → cache langsung fresh.
export const revalidate = 60

// Homepage publik infarm — merakit Hero, value proposition, kategori, produk terlaris, dan footer
// menjadi satu halaman yang menyesuaikan diri di berbagai ukuran layar.
export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      {/* Section 1 — Hero & Navigation (berisi kolom pencarian + autocomplete) */}
      <HeroSection />

      {/* Section 2 — Value Proposition Banner */}
      <ValuePropositionBanner />

      {/* Section 3 — Category Navigation Grid */}
      <CategoryGrid />

      {/* Section 4 — Best-Selling Products */}
      <BestSellingProducts />

      {/* Section 5 — Footer */}
      <Footer />
    </main>
  )
}
