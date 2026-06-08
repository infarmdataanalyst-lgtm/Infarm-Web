// src/lib/data/categories.ts
// Sumber tunggal daftar kategori produk (slug + label tampilan).
// Dipakai bersama oleh grid kategori beranda, kapsul filter, dan judul katalog.

import type { ProductCategory } from '@/types/product'

export type CategoryOption = {
  slug: ProductCategory
  label: string
}

// Urutan kategori sesuai tampilan di beranda & kapsul filter
export const PRODUCT_CATEGORIES: CategoryOption[] = [
  { slug: 'benih-premium', label: 'Benih Premium' },
  { slug: 'pupuk-nutrisi', label: 'Pupuk Nutrisi' },
  { slug: 'peralatan-berkebun', label: 'Peralatan Berkebun' },
  { slug: 'pot-polybag', label: 'Pot Polybag' },
  { slug: 'media-tanam', label: 'Media Tanam' },
  { slug: 'paket-berkebun', label: 'Paket Berkebun' },
]

// Mencari label tampilan dari slug kategori (atau undefined bila slug tak dikenal)
export function getCategoryLabel(slug: string | null): string | undefined {
  return PRODUCT_CATEGORIES.find((c) => c.slug === slug)?.label
}
