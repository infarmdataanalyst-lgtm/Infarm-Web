// src/lib/oms-pii.ts
// Sensor data pribadi pembeli untuk akun OMS berperan 'staff' (keputusan pemilik 2026-10-13).
//
// Admin melihat data lengkap — butuh untuk menghubungi pembeli, refund, dan membetulkan alamat.
// Staff (mis. tim gudang) bekerja dengan nomor invoice & resi, jadi nama, nomor HP, email, dan
// detail jalan disamarkan; catatan refund (berisi rekening bank) dibuang seluruhnya.
//
// Sensor dilakukan di SERVER, sebelum JSON dikirim. Menyamarkan di tampilan saja tidak cukup:
// data asli tetap sampai ke browser dan terbaca di tab Network.
//
// Wilayah alamat (kelurahan s.d. provinsi) sengaja TIDAK disensor — dibutuhkan untuk memahami
// tujuan kirim, dan tak mengidentifikasi orang.

import { maskEmail, maskName, maskPhone, maskStreet } from '@/lib/mask'
import type { AdminRole } from '@/lib/mock-db/admins'
import type { Order, RefundWorkItem } from '@/types/order'

// Hanya 'admin' yang melihat data pembeli utuh. Peran lain mana pun — termasuk peran yang kelak
// ditambahkan — tersensor, supaya peran baru tak diam-diam mendapat akses penuh.
export function shouldMaskBuyerPii(role: AdminRole): boolean {
  return role !== 'admin'
}

export function maskOrder(order: Order): Order {
  const masked: Order = {
    ...order,
    customerName: maskName(order.customerName),
    customerPhone: order.customerPhone ? maskPhone(order.customerPhone) : order.customerPhone,
    customerEmail: order.customerEmail ? maskEmail(order.customerEmail) : order.customerEmail,
    address: order.address
      ? { ...order.address, shippingAddress: maskStreet(order.address.shippingAddress) }
      : order.address,
  }
  delete masked.refundNote
  return masked
}

export function maskOrderForRole(order: Order, role: AdminRole): Order {
  return shouldMaskBuyerPii(role) ? maskOrder(order) : order
}

export function maskOrdersForRole(orders: Order[], role: AdminRole): Order[] {
  return shouldMaskBuyerPii(role) ? orders.map(maskOrder) : orders
}

export function maskRefundItemsForRole(items: RefundWorkItem[], role: AdminRole): RefundWorkItem[] {
  if (!shouldMaskBuyerPii(role)) return items
  return items.map((it) => ({
    ...it,
    customerName: maskName(it.customerName),
    customerPhone: it.customerPhone ? maskPhone(it.customerPhone) : it.customerPhone,
    customerEmail: it.customerEmail ? maskEmail(it.customerEmail) : it.customerEmail,
  }))
}

// Nama saja — untuk hasil pencarian cepat, notifikasi, dan tabel dashboard.
export function maskNameForRole(name: string, role: AdminRole): string {
  return shouldMaskBuyerPii(role) ? maskName(name) : name
}
