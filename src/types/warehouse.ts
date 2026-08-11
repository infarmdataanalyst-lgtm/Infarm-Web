// src/types/warehouse.ts
// Tipe pergudangan: gudang (warehouse) dan stok per gudang.
// Dipetakan dari tabel public.warehouses & public.product_stock_per_warehouse
// (migration supabase/migrations/20260811120000_init_warehouses.sql).

// Mode operasi pergudangan, dibaca dari env WAREHOUSE_MODE.
// 'multi' = gudang cabang dengan pemilihan terdekat — MODE RESMI sistem (default).
// 'single' = turunkan ke satu gudang; hanya tuas rollback darurat, bukan kondisi normal.
export type WarehouseMode = 'single' | 'multi'

// Satu gudang. `mengantarOriginId` dipakai sebagai origin_id saat cek ongkir / booking kurir.
// latitude/longitude opsional — hanya dibutuhkan mode multi untuk hitung jarak (Haversine).
export type Warehouse = {
  id: string
  nama: string
  alamat?: string
  mengantarOriginId?: string
  latitude?: number
  longitude?: number
  isDefault: boolean
  isActive: boolean
  createdAt: string
}

// Satu baris stok: kombinasi produk (atau varian) di satu gudang.
// variantId undefined = stok produk tanpa varian.
export type WarehouseStock = {
  id: string
  productId: string
  variantId?: string
  warehouseId: string
  stok: number
}

// Kunci identitas stok tanpa gudang — dipakai saat menulis/membaca stok satu produk/varian.
export type StockTarget = {
  productId: string
  variantId?: string
}
