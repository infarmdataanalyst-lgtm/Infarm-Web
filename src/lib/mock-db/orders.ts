// src/lib/mock-db/orders.ts
// Akses data pesanan (ditulis oleh checkout ecommerce, dibaca oleh OMS).
//
// ISOLASI: seluruh akses data pesanan HANYA lewat fungsi di file ini, sehingga
// pemanggil (API Route & Server Component OMS) tidak perlu tahu sumber datanya.
// Sebelumnya file JSON lokal; kini di-back oleh Supabase (tabel public.orders).
//
// SERVER-ONLY: memakai createAdminClient() (service_role) yang menembus RLS.
// Tabel orders dikunci dari akses publik (berisi data pribadi pelanggan),
// jadi semua baca/tulis WAJIB lewat server. Jangan diimpor dari komponen 'use client'.

import { createAdminClient } from '@/lib/supabase/server'
import type {
  Order,
  OrderItem,
  CreateOrderInput,
  OrderPaymentStatus,
  OrderFulfillmentStatus,
  BestSellingProduct,
} from '@/types/order'

// === Pemetaan baris DB <-> Order ===

// Bentuk satu baris tabel orders (snake_case sesuai kolom Postgres).
type OrderRow = {
  id: string
  order_id: string
  customer_name: string
  customer_phone: string | null
  customer_email: string | null
  order_date: string
  items: OrderItem[] // kolom jsonb
  total_amount: number
  payment_status: OrderPaymentStatus
  status: OrderFulfillmentStatus | null
  courier: string | null
  service: string | null
  tracking_number: string | null
  created_at: string
}

// Mengubah baris DB menjadi Order (camelCase) yang dipakai aplikasi.
// Field opsional hanya diisi bila ada nilainya (tetap undefined bila kosong).
function rowToOrder(row: OrderRow): Order {
  const order: Order = {
    orderId: row.order_id,
    customerName: row.customer_name,
    date: row.order_date,
    items: row.items ?? [],
    totalAmount: row.total_amount,
    paymentStatus: row.payment_status,
  }
  if (row.customer_phone) order.customerPhone = row.customer_phone
  if (row.customer_email) order.customerEmail = row.customer_email
  if (row.status) order.status = row.status
  if (row.courier || row.service) {
    order.logistics = { courier: row.courier ?? '', service: row.service ?? '' }
  }
  if (row.tracking_number) order.trackingNumber = row.tracking_number
  return order
}

// === Baca ===

// Membaca seluruh pesanan, terbaru di depan (untuk tabel & widget OMS).
// Array kosong bila terjadi error agar UI tidak crash.
export async function readOrders(): Promise<Order[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Gagal membaca pesanan dari Supabase:', error.message)
    return []
  }

  return (data as OrderRow[]).map(rowToOrder)
}

// Membaca satu pesanan berdasarkan nomor pesanan (order_id). null bila tidak ditemukan.
export async function getOrderByOrderId(orderId: string): Promise<Order | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('order_id', orderId)
    .maybeSingle()

  if (error) {
    console.error('Gagal membaca pesanan dari Supabase:', error.message)
    return null
  }

  return data ? rowToOrder(data as OrderRow) : null
}

// Opsi filter agregasi penjualan. from/to = ISO date string (inklusif).
// Tanpa from/to = sepanjang waktu.
export type SalesRangeOptions = {
  from?: string // batas bawah order_date (ISO), inklusif
  to?: string // batas atas order_date (ISO), inklusif
}

// Mengagregasi unit terjual & pendapatan per productId dari pesanan.
// Hanya menghitung penjualan riil: paymentStatus 'Lunas' dan status BUKAN 'Dibatalkan'
// (order batal/refund tidak dihitung). Filter rentang tanggal didorong ke query DB.
// Dipakai bersama oleh getBestSellingProducts & getSalesCountByProduct.
async function aggregateSales(
  opts: SalesRangeOptions = {},
): Promise<Map<string, BestSellingProduct>> {
  const supabase = createAdminClient()
  // Ambil hanya kolom yang dibutuhkan untuk agregasi (hemat payload).
  let query = supabase.from('orders').select('items, payment_status, status, order_date')
  if (opts.from) query = query.gte('order_date', opts.from)
  if (opts.to) query = query.lte('order_date', opts.to)

  const { data, error } = await query
  if (error) {
    console.error('Gagal menghitung penjualan dari Supabase:', error.message)
    return new Map()
  }

  type SalesRow = Pick<OrderRow, 'items' | 'payment_status' | 'status' | 'order_date'>

  // Akumulasi unit terjual & pendapatan per productId
  const totals = new Map<string, BestSellingProduct>()
  for (const row of (data as SalesRow[]) ?? []) {
    // Lewati order batal atau belum lunas — bukan penjualan riil
    if (row.payment_status !== 'Lunas' || row.status === 'Dibatalkan') continue
    for (const item of row.items ?? []) {
      const prev = totals.get(item.productId)
      if (prev) {
        prev.totalSold += item.quantity
        prev.totalRevenue += item.quantity * item.price
      } else {
        totals.set(item.productId, {
          productId: item.productId,
          name: item.name,
          totalSold: item.quantity,
          totalRevenue: item.quantity * item.price,
        })
      }
    }
  }
  return totals
}

// Menghitung produk terlaris (paling banyak terjual), diurut terbanyak dulu.
// opts.limit membatasi jumlah produk (default 5); opts.from/to memfilter rentang tanggal.
export async function getBestSellingProducts(
  opts: SalesRangeOptions & { limit?: number } = {},
): Promise<BestSellingProduct[]> {
  const totals = await aggregateSales(opts)
  return Array.from(totals.values())
    .sort((a, b) => b.totalSold - a.totalSold)
    .slice(0, opts.limit ?? 5)
}

// Mengembalikan peta productId → total unit terjual dalam rentang waktu.
// Dipakai untuk kolom "Terjual" di tabel produk OMS & pengurutan storefront.
export async function getSalesCountByProduct(
  opts: SalesRangeOptions = {},
): Promise<Record<string, number>> {
  const totals = await aggregateSales(opts)
  const counts: Record<string, number> = {}
  for (const [productId, agg] of totals) counts[productId] = agg.totalSold
  return counts
}

// === Tulis ===

// Menyimpan satu pesanan baru lalu mengembalikan pesanan tersimpan.
// paymentStatus default 'Lunas' karena dipanggil setelah pembayaran sukses.
export async function saveOrder(newOrder: CreateOrderInput): Promise<Order> {
  const paymentStatus = newOrder.paymentStatus ?? 'Lunas'
  // Default alur: sudah bayar -> 'Diproses', belum bayar -> 'Menunggu Pembayaran'
  const status =
    newOrder.status ?? (paymentStatus === 'Lunas' ? 'Diproses' : 'Menunggu Pembayaran')

  const supabase = createAdminClient()
  const row = {
    order_id: newOrder.orderId,
    customer_name: newOrder.customerName,
    customer_phone: newOrder.customerPhone ?? null,
    customer_email: newOrder.customerEmail ?? null,
    order_date: newOrder.date,
    items: newOrder.items,
    total_amount: newOrder.totalAmount,
    payment_status: paymentStatus,
    status,
    courier: newOrder.logistics?.courier ?? null,
    service: newOrder.logistics?.service ?? null,
    tracking_number: newOrder.trackingNumber ?? null,
  }

  let { data, error } = await supabase.from('orders').insert(row).select('*').single()

  // Jaring pengaman: bila kolom customer_email belum ada (migration belum dijalankan),
  // simpan ulang tanpa email agar checkout tetap jalan. Email tersimpan setelah migration diterapkan.
  // PostgREST melaporkan kolom hilang sebagai 'PGRST204'; '42703' = error kolom level Postgres.
  // TODO: hapus fallback ini setelah migration add_orders_customer_email diterapkan ke DB.
  if (error?.code === 'PGRST204' || error?.code === '42703') {
    const rowWithoutEmail: Record<string, unknown> = { ...row }
    delete rowWithoutEmail.customer_email
    ;({ data, error } = await supabase.from('orders').insert(rowWithoutEmail).select('*').single())
  }

  if (error || !data) {
    throw new Error(`Gagal menyimpan pesanan: ${error?.message ?? 'tidak diketahui'}`)
  }

  return rowToOrder(data as OrderRow)
}

// === Ubah status ===

// Memperbarui status alur pesanan (mis. menjadi 'Dibatalkan' saat pembeli membatalkan).
// Mengembalikan order terbaru, atau null bila order tidak ditemukan.
export async function updateOrderStatus(
  orderId: string,
  status: OrderFulfillmentStatus,
): Promise<Order | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('orders')
    .update({ status })
    .eq('order_id', orderId)
    .select('*')
    .maybeSingle()

  if (error) {
    console.error('Gagal memperbarui status pesanan di Supabase:', error.message)
    return null
  }

  return data ? rowToOrder(data as OrderRow) : null
}
