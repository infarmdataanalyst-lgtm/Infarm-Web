// src/lib/data/dummy-review.ts
// Dummy data pesanan untuk halaman input ulasan. Minimal 2 produk agar layout multi-produk terlihat.
// TODO: ganti dengan data order asli (dari Supabase) setelah OMS selesai.

export type ReviewProduct = {
  id: string
  name: string
  variant: string
  imageUrl: string
  // Harga satuan produk saat di-checkout (untuk ditampilkan di kartu produk)
  price: number
}

export type MockOrder = {
  orderId: string
  products: ReviewProduct[]
}

const PLACEHOLDER_IMAGE = '/images/product-placeholder.png'

export const dummyReviewOrder: MockOrder = {
  orderId: 'INF20240601',
  products: [
    {
      id: 'prod-007',
      name: 'Pupuk Organik Cair (POC) Buah & Sayuran Daun Infarm',
      variant: 'Pack 500ml',
      imageUrl: PLACEHOLDER_IMAGE,
      price: 25000,
    },
    {
      id: 'prod-009',
      name: 'Benih Premium Cabai Rawit Unggul',
      variant: 'Isi 50 butir',
      imageUrl: PLACEHOLDER_IMAGE,
      price: 15000,
    },
  ],
}
