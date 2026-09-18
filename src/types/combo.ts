// src/types/combo.ts
// Tipe data paket/combo produk untuk fitur "Paket & Combo" di OMS.
// Dipetakan dari tabel public.product_combos + public.product_combo_items (Supabase).

// Satu produk di dalam sebuah combo. name & unitPrice adalah snapshot saat combo disusun.
export type ComboItem = {
  productId: string
  name: string
  unitPrice: number // harga satuan saat ditambahkan (rupiah)
  quantity: number // minimal 1
  isPrimary: boolean // true = produk utama; paket hanya tayang di halaman detail produk ini
  // Harga SATUAN produk ini di dalam paket. null = paket lama yang harganya belum dipecah per
  // produk — harganya dibagi proporsional seperti dulu (lihat allocateComboPrices).
  dealPrice: number | null
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

// Apakah SELURUH anggota paket sudah punya harga paket sendiri.
// Paket campuran (sebagian saja) diperlakukan seperti paket lama — setengah harga eksplisit lebih
// menyesatkan daripada tidak ada sama sekali.
export function hasDealPrices(items: ComboItem[]): boolean {
  return items.length > 0 && items.every((item) => typeof item.dealPrice === 'number')
}

// Harga paket hasil penjumlahan harga per produk (harga satuan paket × quantity).
// Inilah yang disimpan ke product_combos.combo_price — admin tidak mengetik harga paket lagi.
// 0 bila ada anggota yang belum punya harga paket sendiri.
export function calcComboPrice(items: ComboItem[]): number {
  if (!hasDealPrices(items)) return 0
  return items.reduce((sum, item) => sum + (item.dealPrice ?? 0) * item.quantity, 0)
}

// Produk utama sebuah paket, atau undefined bila belum ditandai.
export function primaryItem(combo: ProductCombo): ComboItem | undefined {
  return combo.items.find((item) => item.isPrimary)
}

// Apakah paket ini layak tayang di halaman detail sebuah produk.
//
// Satu paket = satu pintu masuk: hanya halaman PRODUK UTAMA yang memajangnya. Sebelum penanda ini
// ada (migration 20260918120000), paket tayang di halaman setiap anggotanya — dan cross-sell jadi
// selalu dua arah, tak peduli margin produk pasangannya.
//
// Paket TANPA produk utama jatuh ke perilaku lama, bukan hilang dari etalase: paket lama yang belum
// sempat diisi penandanya (atau lingkungan yang migrationnya belum dijalankan) tetap terjual seperti
// biasa sampai pemilik toko menentukan produk utamanya lewat OMS.
export function comboShowsOnProduct(combo: ProductCombo, productId: string): boolean {
  const utama = primaryItem(combo)
  if (utama) return utama.productId === productId
  return combo.items.some((item) => item.productId === productId)
}
