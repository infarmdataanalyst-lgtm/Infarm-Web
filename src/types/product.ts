// src/types/product.ts
// Tipe data produk untuk digunakan di seluruh project (katalog, kartu produk, dll)

// Slug kategori produk. Dipakai untuk filter di URL (?category=...) — bukan untuk ditampilkan.
export type ProductCategory =
  | 'benih-premium'
  | 'pupuk-nutrisi'
  | 'peralatan-berkebun'
  | 'pot-polybag'
  | 'media-tanam'
  | 'paket-berkebun'

export type Product = {
  id: string
  name: string
  originalPrice: number
  promoPrice: number
  imageUrl: string
  category: ProductCategory // kategori internal untuk penyaringan (tidak ditampilkan ke user)
  badge?: string
}

// Produk yang disimpan via OMS ke mock database (superset Product + data gudang).
// Tetap kompatibel dengan Product agar bisa langsung dipakai kartu produk ecommerce.
export type StoredProduct = Product & {
  sku: string
  stock: number
  description?: string
  archived?: boolean // true = tetap tersimpan di OMS tapi disembunyikan dari ecommerce
  createdAt: string // ISO date, untuk urutan terbaru
}

// Payload dari form upload produk OMS (sebelum disimpan).
// Opsi harga sederhana: satu harga jual (originalPrice = promoPrice = price).
export type CreateProductInput = {
  name: string
  sku: string
  category: ProductCategory
  price: number
  stock: number
  description?: string
  imageUrl?: string
}

// Satu ulasan pembeli untuk halaman detail produk
export type ProductReview = {
  id: string
  authorName: string
  rating: number // 1–5
  date: string // ISO date, mis. '2026-05-20'
  comment: string
  category: string // kategori filter ulasan, mis. 'Kualitas' | 'Pengiriman'
  imageUrls?: string[] // foto ulasan (opsional)
}

// Produk lengkap untuk Halaman Detail Produk — memperluas Product dengan galeri foto,
// rating agregat, deskripsi, dan daftar ulasan. promoPrice = harga jual efektif (setelah diskon).
export type ProductDetail = Product & {
  images: string[] // galeri foto produk (maksimal 9, dipakai slider)
  rating: number // rata-rata rating, mis. 5.0
  reviewCount: number // jumlah ulasan
  description: string // penjelasan / spesifikasi detail produk
  reviews: ProductReview[]
}
