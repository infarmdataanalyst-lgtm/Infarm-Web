// src/lib/mock-db/orders.ts
// Mock database pesanan berbasis file JSON lokal (rapid prototyping, pengganti Supabase sementara).
//
// ISOLASI: seluruh akses data pesanan HANYA lewat fungsi di file ini.
// Untuk migrasi ke Supabase nanti, cukup ganti isi readOrders() & saveOrder()
// dengan query Supabase — signature fungsi tetap sama, pemanggil tidak perlu diubah.
//
// CATATAN: modul ini memakai Node 'fs' → hanya boleh dipanggil di server
// (API Route / Server Component / Server Action), tidak di komponen client.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Order, CreateOrderInput } from '@/types/order'

// Lokasi file mock database. process.cwd() = root project saat runtime.
const ORDERS_FILE = path.join(process.cwd(), 'src', 'data', 'orders.json')

// === Baca ===

// Membaca seluruh pesanan dari orders.json sebagai array bertipe.
// Mengembalikan array kosong bila file belum ada atau isinya tidak valid (anti-crash).
export async function readOrders(): Promise<Order[]> {
  try {
    const raw = await fs.readFile(ORDERS_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    // Pastikan bentuknya array; kalau bukan, anggap kosong agar tidak merusak konsumen.
    return Array.isArray(parsed) ? (parsed as Order[]) : []
  } catch {
    return []
  }
}

// === Tulis ===

// Menambahkan satu pesanan baru ke orders.json (append) lalu mengembalikan pesanan tersimpan.
// paymentStatus default 'Lunas' karena dipanggil setelah pembayaran sukses.
export async function saveOrder(newOrder: CreateOrderInput): Promise<Order> {
  const orders = await readOrders()

  const paymentStatus = newOrder.paymentStatus ?? 'Lunas'

  const order: Order = {
    ...newOrder,
    paymentStatus,
    // Default alur: sudah bayar → langsung 'Diproses', belum bayar → 'Menunggu Pembayaran'
    status: newOrder.status ?? (paymentStatus === 'Lunas' ? 'Diproses' : 'Menunggu Pembayaran'),
  }

  // Pesanan terbaru diletakkan di depan agar OMS menampilkannya paling atas.
  orders.unshift(order)

  await fs.writeFile(ORDERS_FILE, JSON.stringify(orders, null, 2), 'utf-8')
  return order
}
