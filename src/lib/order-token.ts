// src/lib/order-token.ts
// Token keamanan untuk tautan pembatalan pesanan Guest.
// Karena tidak ada login, tautan pembatalan diamankan dengan token HMAC yang diturunkan dari
// orderId + secret server. Hanya pemegang tautan resmi (mis. dari halaman Order Confirmed) yang
// bisa membuka & membatalkan pesanannya — orderId saja tidak cukup.
//
// SERVER-ONLY: memakai node:crypto & secret. Jangan diimpor dari komponen 'use client'.

import { createHmac, timingSafeEqual } from 'node:crypto'

// Secret penandatangan token. Pakai env bila ada; fallback konstanta untuk mode prototipe.
// TODO: set ORDER_CANCEL_SECRET di environment production.
const SECRET = process.env.ORDER_CANCEL_SECRET ?? 'infarm-dev-cancel-secret'

// Membuat token pembatalan deterministik untuk sebuah orderId (dipakai saat menyusun tautan).
export function generateCancelToken(orderId: string): string {
  return createHmac('sha256', SECRET).update(orderId).digest('hex').slice(0, 32)
}

// Memverifikasi token terhadap orderId. Memakai perbandingan waktu-konstan agar aman dari timing attack.
export function verifyCancelToken(orderId: string, token: string): boolean {
  const expected = generateCancelToken(orderId)
  if (token.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  } catch {
    return false
  }
}
