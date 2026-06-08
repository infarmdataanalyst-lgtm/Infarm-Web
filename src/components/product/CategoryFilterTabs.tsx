'use client'

// src/components/product/CategoryFilterTabs.tsx
// Baris kapsul filter kategori yang bisa digeser horizontal. Status aktif dibaca dari URL
// (?category=...), dan klik kapsul mengubah URL via soft navigation (tanpa reload halaman).

import { useRouter, useSearchParams } from 'next/navigation'
import { PRODUCT_CATEGORIES } from '@/lib/data/categories'

// Daftar kapsul: "Semua" (slug kosong) + seluruh kategori produk
const TABS = [{ slug: '', label: 'Semua' }, ...PRODUCT_CATEGORIES]

// Menampilkan kapsul filter kategori dengan indikator aktif berdasarkan URL.
export default function CategoryFilterTabs() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Kategori aktif dari URL ('' = Semua). URL adalah satu-satunya sumber kebenaran status aktif.
  const active = searchParams.get('category') ?? ''

  // Pindah kategori: ubah query di URL tanpa scroll ke atas (soft navigation App Router).
  function selectCategory(slug: string) {
    const href = slug ? `/products?category=${slug}` : '/products'
    router.push(href, { scroll: false })
  }

  return (
    <div className="sticky top-14 z-30 border-b border-zinc-100 bg-white">
      <div className="mx-auto max-w-6xl overflow-x-auto scrollbar-hide px-4 sm:px-6 lg:px-8">
        <div className="flex gap-2 py-3">
          {TABS.map((tab) => {
            const isActive = active === tab.slug
            return (
              <button
                key={tab.slug || 'all'}
                type="button"
                onClick={() => selectCategory(tab.slug)}
                aria-pressed={isActive}
                className={`shrink-0 rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${
                  isActive
                    ? 'border-brand-primary bg-brand-primary text-white'
                    : 'border-brand-primary bg-white text-brand-primary hover:bg-brand-surface'
                }`}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
