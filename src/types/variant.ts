// src/types/variant.ts
// Tipe data varian produk (1 dimensi, mis. ukuran/isi kemasan). Dipetakan dari public.product_variants.
// Varian OPSIONAL per produk: produk tanpa varian tetap pakai harga/stok dari tabel products.

export type ProductVariant = {
  id: string
  productId: string
  name: string // nama_varian, mis. "50 Biji"
  sku: string // unik (aturan sama dengan SKU produk)
  price: number // harga jual varian (rupiah, integer)
  stock: number // stok varian
  isDefault: boolean // terpilih otomatis saat halaman detail dibuka
  createdAt: string
}
