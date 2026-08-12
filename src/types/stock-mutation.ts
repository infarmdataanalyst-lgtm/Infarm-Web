// src/types/stock-mutation.ts
// Tipe riwayat mutasi stok (tabel public.stock_mutations,
// migration supabase/migrations/20260813120000_init_stock_mutations.sql).

// Alasan perubahan stok. Nilainya dijaga CHECK constraint di DB — menambah nilai baru di sini
// WAJIB disertai perubahan constraint tersebut, kalau tidak insert-nya akan ditolak.
export type StockMutationReason = 'manual_update' | 'product_form' | 'order' | 'order_cancelled'

// Satu baris riwayat. Field id (product/variant/warehouse/order) bisa null karena FK-nya
// ON DELETE SET NULL; nama & invoice adalah snapshot teks yang selalu ada untuk ditampilkan.
export type StockMutation = {
  id: string
  productId?: string
  variantId?: string
  warehouseId?: string
  productName: string
  variantName?: string
  warehouseName: string
  changedBy?: string
  changedByName?: string
  stokBefore: number
  stokAfter: number
  reason: StockMutationReason
  orderId?: string
  orderInvoice?: string
  createdAt: string
}

// Label Indonesia untuk kolom "alasan" di halaman Riwayat Mutasi.
export const STOCK_MUTATION_REASON_LABELS: Record<StockMutationReason, string> = {
  manual_update: 'Diubah manual',
  product_form: 'Form produk',
  order: 'Pesanan masuk',
  order_cancelled: 'Pesanan dibatalkan',
}
