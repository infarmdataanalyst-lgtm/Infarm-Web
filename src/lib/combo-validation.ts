// src/lib/combo-validation.ts
// Validasi payload combo di sisi SERVER (jangan percaya input client mentah-mentah).
// Dipakai bersama oleh POST /api/combos/create dan PATCH /api/combos/update.
// Aturan harus konsisten dengan validasi inline di ComboForm.

import { calcNormalPrice, type ComboInput, type ComboItem } from '@/types/combo'

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
    items.push({
      productId: it.productId,
      name: it.name,
      unitPrice: Math.max(0, it.unitPrice),
      quantity,
    })
  }

  if (items.length < 2) {
    return { ok: false, error: 'Minimal 2 produk wajib ditambahkan ke combo.' }
  }

  // Tidak boleh ada produk yang sama dua kali
  const ids = new Set<string>()
  for (const item of items) {
    if (ids.has(item.productId)) {
      return { ok: false, error: 'Terdapat produk yang sama lebih dari sekali.' }
    }
    ids.add(item.productId)
  }

  const comboPrice = typeof b.comboPrice === 'number' ? Math.floor(b.comboPrice) : NaN
  if (!Number.isFinite(comboPrice) || comboPrice <= 0) {
    return { ok: false, error: 'Harga combo wajib diisi dan harus lebih dari 0.' }
  }

  const normalPrice = calcNormalPrice(items)
  if (comboPrice >= normalPrice) {
    return { ok: false, error: 'Harga combo harus lebih murah dari total harga satuan.' }
  }

  const isActive = typeof b.isActive === 'boolean' ? b.isActive : true

  return { ok: true, value: { name, comboPrice, isActive, items } }
}
