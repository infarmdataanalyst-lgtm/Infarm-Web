// src/types/combo.ts
// Tipe data paket/combo produk untuk fitur "Paket & Combo" di OMS.
// Dipetakan dari tabel public.product_combos + public.product_combo_items (Supabase).

// Satu produk di dalam sebuah combo. name & unitPrice adalah snapshot saat combo disusun.
export type ComboItem = {
  productId: string
  name: string
  unitPrice: number // harga satuan saat ditambahkan (rupiah)
  quantity: number // minimal 1
}

// Combo lengkap yang disimpan & ditampilkan di OMS.
// normalPrice TIDAK disimpan di DB — dihitung dari total (unitPrice × quantity) tiap item.
export type ProductCombo = {
  id: string
  name: string
  comboPrice: number // harga jual paket
  isActive: boolean
  items: ComboItem[]
  createdAt: string // ISO date, untuk urutan terbaru
}

// Payload dari form OMS untuk membuat / memperbarui combo (sebelum disimpan).
export type ComboInput = {
  name: string
  comboPrice: number
  isActive: boolean
  items: ComboItem[]
}

// Total harga normal sebuah combo: jumlah (harga satuan × quantity) semua item.
// Dipakai bersama oleh UI (ringkasan) & validasi server (combo harus lebih murah).
export function calcNormalPrice(items: ComboItem[]): number {
  return items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
}
