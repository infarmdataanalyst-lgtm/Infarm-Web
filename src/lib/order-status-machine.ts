// src/lib/order-status-machine.ts
// State machine transisi status pesanan (murni, tanpa I/O) — dipakai bersama oleh
// modal OMS (batasi opsi dropdown) DAN route handler (validasi ulang di server).
// Aman diimpor dari komponen 'use client' (tidak menyentuh Supabase/env).

import type { OrderFulfillmentStatus } from '@/types/order'

// Transisi yang diizinkan dari tiap status. Array kosong = status final (tak bisa berubah lagi).
export const ALLOWED_TRANSITIONS: Record<OrderFulfillmentStatus, OrderFulfillmentStatus[]> = {
  'Menunggu Pembayaran': ['Diproses', 'Dibatalkan'],
  Diproses: ['Dikirim', 'Dibatalkan'],
  Dikirim: ['Selesai'],
  Selesai: [],
  Dibatalkan: [],
}

// Daftar status yang boleh dipilih dari status saat ini (untuk mengisi dropdown modal).
export function nextStatuses(current: OrderFulfillmentStatus): OrderFulfillmentStatus[] {
  return ALLOWED_TRANSITIONS[current] ?? []
}

// Apakah transisi from → to valid menurut state machine.
export function canTransition(from: OrderFulfillmentStatus, to: OrderFulfillmentStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}

// Apakah status sudah final (tak ada transisi lanjutan) → dropdown read-only.
export function isFinalStatus(status: OrderFulfillmentStatus): boolean {
  return (ALLOWED_TRANSITIONS[status]?.length ?? 0) === 0
}
