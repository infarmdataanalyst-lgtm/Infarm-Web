// src/lib/data/dummy-products.ts
// Dummy data produk sementara untuk homepage. Nanti diganti dengan query Supabase.
// Catatan: imageUrl masih memakai placeholder. Ganti dengan foto produk asli di /public/images/products/.

import type { Product } from '@/types/product'

// Placeholder image yang dipakai semua produk sementara (TODO: ganti foto produk asli)
const PLACEHOLDER_IMAGE = '/images/product-placeholder.svg'

// 10 produk dummy meniru katalog terlaris pada desain
// TODO: ganti dengan query Supabase setelah OMS selesai
export const dummyProducts: Product[] = [
  {
    id: 'prod-001',
    name: 'Paket Pupuk Organik Lengkap — Tanaman Sehat, Tanah Subur',
    originalPrice: 100000,
    promoPrice: 75000,
    imageUrl: PLACEHOLDER_IMAGE,
    badge: 'Barang Murah',
  },
  {
    id: 'prod-002',
    name: 'Media Tanam Organik Infarm Siap Pakai 5 Liter',
    originalPrice: 100000,
    promoPrice: 75000,
    imageUrl: PLACEHOLDER_IMAGE,
  },
  {
    id: 'prod-003',
    name: 'Perisai Cabai 500ml — Imun Booster Pencegah Keriting & Daun Kuning',
    originalPrice: 100000,
    promoPrice: 75000,
    imageUrl: PLACEHOLDER_IMAGE,
  },
  {
    id: 'prod-004',
    name: 'Pupuk Organik Rumput Nutrisi 500g — Lebih Hijau & Tumbuh Merata',
    originalPrice: 100000,
    promoPrice: 75000,
    imageUrl: PLACEHOLDER_IMAGE,
    badge: 'Barang Murah',
  },
  {
    id: 'prod-005',
    name: 'Paket Lengkap Pupuk Anggrek Perawatan Premium — Rajin Berbunga',
    originalPrice: 120000,
    promoPrice: 89000,
    imageUrl: PLACEHOLDER_IMAGE,
  },
  {
    id: 'prod-006',
    name: 'Pupuk NPK Padat Infarm 1kg — Tanah Lebih Gembur dan Subur',
    originalPrice: 100000,
    promoPrice: 75000,
    imageUrl: PLACEHOLDER_IMAGE,
  },
  {
    id: 'prod-007',
    name: 'Pupuk Organik Cair (POC) Buah & Sayuran Daun Infarm',
    originalPrice: 100000,
    promoPrice: 75000,
    imageUrl: PLACEHOLDER_IMAGE,
    badge: 'Barang Murah',
  },
  {
    id: 'prod-008',
    name: 'Miracle Powder Infarm — Penyubur & Pemacu Pertumbuhan Tanaman',
    originalPrice: 90000,
    promoPrice: 69000,
    imageUrl: PLACEHOLDER_IMAGE,
  },
  {
    id: 'prod-009',
    name: 'Benih Premium Cabai Rawit Unggul — Daya Tumbuh Tinggi',
    originalPrice: 35000,
    promoPrice: 25000,
    imageUrl: PLACEHOLDER_IMAGE,
  },
  {
    id: 'prod-010',
    name: 'Paket Berkebun Pemula Lengkap — Dari Benih Sampai Panen',
    originalPrice: 250000,
    promoPrice: 199000,
    imageUrl: PLACEHOLDER_IMAGE,
    badge: 'Barang Murah',
  },
]
