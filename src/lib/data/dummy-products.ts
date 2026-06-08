// src/lib/data/dummy-products.ts
// Dummy data produk sementara untuk homepage & katalog. Nanti diganti dengan query Supabase.
// Catatan: imageUrl masih memakai placeholder. Ganti dengan foto produk asli di /public/images/products/.

import type { Product } from '@/types/product'

// Placeholder image yang dipakai semua produk sementara (TODO: ganti foto produk asli)
const PLACEHOLDER_IMAGE = '/images/product-placeholder.png'

// Daftar produk dummy. Tiap produk punya `category` (internal) untuk penyaringan di /products.
// TODO: ganti dengan query Supabase setelah OMS selesai
export const dummyProducts: Product[] = [
  {
    id: 'prod-001',
    name: 'Paket Pupuk Organik Lengkap — Tanaman Sehat, Tanah Subur',
    originalPrice: 100000,
    promoPrice: 75000,
    imageUrl: PLACEHOLDER_IMAGE,
    category: 'pupuk-nutrisi',
    badge: 'Barang Murah',
  },
  {
    id: 'prod-002',
    name: 'Media Tanam Organik Infarm Siap Pakai 5 Liter',
    originalPrice: 100000,
    promoPrice: 75000,
    imageUrl: PLACEHOLDER_IMAGE,
    category: 'media-tanam',
  },
  {
    id: 'prod-003',
    name: 'Perisai Cabai 500ml — Imun Booster Pencegah Keriting & Daun Kuning',
    originalPrice: 100000,
    promoPrice: 75000,
    imageUrl: PLACEHOLDER_IMAGE,
    category: 'pupuk-nutrisi',
  },
  {
    id: 'prod-004',
    name: 'Pupuk Organik Rumput Nutrisi 500g — Lebih Hijau & Tumbuh Merata',
    originalPrice: 100000,
    promoPrice: 75000,
    imageUrl: PLACEHOLDER_IMAGE,
    category: 'pupuk-nutrisi',
    badge: 'Barang Murah',
  },
  {
    id: 'prod-005',
    name: 'Paket Lengkap Pupuk Anggrek Perawatan Premium — Rajin Berbunga',
    originalPrice: 120000,
    promoPrice: 89000,
    imageUrl: PLACEHOLDER_IMAGE,
    category: 'paket-berkebun',
  },
  {
    id: 'prod-006',
    name: 'Pupuk NPK Padat Infarm 1kg — Tanah Lebih Gembur dan Subur',
    originalPrice: 100000,
    promoPrice: 75000,
    imageUrl: PLACEHOLDER_IMAGE,
    category: 'pupuk-nutrisi',
  },
  {
    id: 'prod-007',
    name: 'Pupuk Organik Cair (POC) Buah & Sayuran Daun Infarm',
    originalPrice: 100000,
    promoPrice: 75000,
    imageUrl: PLACEHOLDER_IMAGE,
    category: 'pupuk-nutrisi',
    badge: 'Barang Murah',
  },
  {
    id: 'prod-008',
    name: 'Miracle Powder Infarm — Penyubur & Pemacu Pertumbuhan Tanaman',
    originalPrice: 90000,
    promoPrice: 69000,
    imageUrl: PLACEHOLDER_IMAGE,
    category: 'pupuk-nutrisi',
  },
  {
    id: 'prod-009',
    name: 'Benih Premium Cabai Rawit Unggul — Daya Tumbuh Tinggi',
    originalPrice: 35000,
    promoPrice: 25000,
    imageUrl: PLACEHOLDER_IMAGE,
    category: 'benih-premium',
  },
  {
    id: 'prod-010',
    name: 'Paket Berkebun Pemula Lengkap — Dari Benih Sampai Panen',
    originalPrice: 250000,
    promoPrice: 199000,
    imageUrl: PLACEHOLDER_IMAGE,
    category: 'paket-berkebun',
    badge: 'Barang Murah',
  },

  // === Produk tambahan agar setiap kategori punya isi (untuk demo filter /products) ===
  {
    id: 'prod-011',
    name: 'Benih Premium Tomat Servo F1 — Buah Lebat & Tahan Penyakit',
    originalPrice: 40000,
    promoPrice: 30000,
    imageUrl: PLACEHOLDER_IMAGE,
    category: 'benih-premium',
  },
  {
    id: 'prod-012',
    name: 'Benih Premium Pakcoy Nauli F1 — Cepat Panen, Daun Renyah',
    originalPrice: 30000,
    promoPrice: 22000,
    imageUrl: PLACEHOLDER_IMAGE,
    category: 'benih-premium',
    badge: 'Barang Murah',
  },
  {
    id: 'prod-013',
    name: 'Set Alat Berkebun Stainless 3 in 1 — Sekop, Garpu, Cangkul Mini',
    originalPrice: 95000,
    promoPrice: 65000,
    imageUrl: PLACEHOLDER_IMAGE,
    category: 'peralatan-berkebun',
  },
  {
    id: 'prod-014',
    name: 'Sprayer Tekanan 2 Liter — Penyemprot Pupuk & Pestisida Serbaguna',
    originalPrice: 85000,
    promoPrice: 59000,
    imageUrl: PLACEHOLDER_IMAGE,
    category: 'peralatan-berkebun',
    badge: 'Barang Murah',
  },
  {
    id: 'prod-015',
    name: 'Pot Plastik Tanaman Set 10 pcs — Ringan & Tahan Pecah',
    originalPrice: 60000,
    promoPrice: 45000,
    imageUrl: PLACEHOLDER_IMAGE,
    category: 'pot-polybag',
  },
  {
    id: 'prod-016',
    name: 'Polybag Hitam 20x20 cm Isi 100 Lembar — Tebal & Awet',
    originalPrice: 50000,
    promoPrice: 35000,
    imageUrl: PLACEHOLDER_IMAGE,
    category: 'pot-polybag',
    badge: 'Barang Murah',
  },
  {
    id: 'prod-017',
    name: 'Media Tanam Sekam Bakar Infarm 10 Liter — Drainase Optimal',
    originalPrice: 45000,
    promoPrice: 33000,
    imageUrl: PLACEHOLDER_IMAGE,
    category: 'media-tanam',
  },
]
