// src/lib/combo-validation.ts
// Validasi payload combo di sisi SERVER (jangan percaya input client mentah-mentah).
// Dipakai bersama oleh POST /api/combos/create dan PATCH /api/combos/update.
// Aturan harus konsisten dengan validasi inline di ComboForm.

import { calcComboPrice, calcNormalPrice, type ComboInput, type ComboItem } from '@/types/combo'

export type ComboValidation =
  | { ok: true; value: ComboInput }
  | { ok: false; error: string }

// Memvalidasi & menormalkan body menjadi ComboInput, atau mengembalikan pesan error.
export function validateComboInput(body: unknown): ComboValidation {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Body bukan objek yang valid.' }
  }
  const b = body as Record<string, unknown>

  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (name.length < 3) {
    return { ok: false, error: 'Nama combo wajib diisi minimal 3 karakter.' }
  }
  if (name.length > 100) {
    return { ok: false, error: 'Nama combo maksimal 100 karakter.' }
  }

  if (!Array.isArray(b.items)) {
    return { ok: false, error: 'Daftar produk combo tidak valid.' }
  }

  const items: ComboItem[] = []
  for (const raw of b.items) {
    if (typeof raw !== 'object' || raw === null) {
      return { ok: false, error: 'Item produk tidak valid.' }
    }
    const it = raw as Record<string, unknown>
    if (
      typeof it.productId !== 'string' ||
      typeof it.name !== 'string' ||
      typeof it.unitPrice !== 'number' ||
      typeof it.quantity !== 'number'
    ) {
      return { ok: false, error: 'Data item produk tidak lengkap.' }
    }
    const quantity = Math.floor(it.quantity)
    if (quantity < 1) {
      return { ok: false, error: 'Quantity produk minimal 1.' }
    }
    // Harga paket per produk WAJIB ada sejak migration 20260918140000: harga paket adalah hasil
    // penjumlahannya, jadi satu baris tanpa harga membuat totalnya tak bisa dihitung.
    if (typeof it.dealPrice !== 'number' || !Number.isFinite(it.dealPrice) || it.dealPrice < 0) {
      return { ok: false, error: 'Harga paket tiap produk wajib diisi (minimal Rp 0).' }
    }
    items.push({
      productId: it.productId,
      name: it.name,
      unitPrice: Math.max(0, it.unitPrice),
      quantity,
      isPrimary: it.isPrimary === true,
      dealPrice: Math.floor(it.dealPrice),
    })
  }

  if (items.length < 2) {
    return { ok: false, error: 'Minimal 2 produk wajib ditambahkan ke combo.' }
  }

  // Tepat SATU produk utama — penentu paket ini tayang di halaman detail produk yang mana.
  // Index unik parsial di DB (migration 20260918120000) menahan hal yang sama; di sini pesannya
  // bisa dibaca manusia, bukan pelanggaran constraint.
  const primaryCount = items.filter((item) => item.isPrimary).length
  if (primaryCount === 0) {
    return { ok: false, error: 'Pilih satu produk utama untuk combo ini.' }
  }
  if (primaryCount > 1) {
    return { ok: false, error: 'Hanya boleh ada satu produk utama dalam satu combo.' }
  }

  // Tidak boleh ada produk yang sama dua kali
  const ids = new Set<string>()
  for (const item of items) {
    if (ids.has(item.productId)) {
      return { ok: false, error: 'Terdapat produk yang sama lebih dari sekali.' }
    }
    ids.add(item.productId)
  }

  // Harga paket TIDAK diambil dari body: ia dihitung dari harga per produk yang baru saja
  // divalidasi. `comboPrice` kiriman client sengaja diabaikan — dua angka yang bisa berbeda untuk
  // hal yang sama adalah cara paling mudah menerbitkan tagihan yang tak cocok dengan isinya.
  const comboPrice = calcComboPrice(items)
  if (comboPrice < 100) {
    return { ok: false, error: 'Total harga paket minimal Rp 100.' }
  }

  const normalPrice = calcNormalPrice(items)
  if (comboPrice >= normalPrice) {
    return { ok: false, error: 'Total harga paket harus lebih murah dari total harga normal.' }
  }

  const isActive = typeof b.isActive === 'boolean' ? b.isActive : true

  return { ok: true, value: { name, comboPrice, isActive, items } }
}
