// src/lib/mock-db/orders.ts
// Akses data pesanan (ditulis oleh checkout ecommerce, dibaca oleh OMS).
//
// ISOLASI: seluruh akses data pesanan HANYA lewat fungsi di file ini. Pemanggil
// (API Route & Server Component) tidak perlu tahu skema DB.
//
// SKEMA DB (Supabase): tabel `orders` (kolom Bahasa Indonesia + enum English) &
// `order_items` (satu baris per produk). Pemetaan DB<->app dilakukan di sini:
//   status_pembayaran: PENDING|PAID|FAILED   <-> Menunggu|Lunas|Gagal
//   order_status:      PENDING|PROCESSING|SHIPPED|COMPLETED|CANCELLED
//                      <-> Menunggu Pembayaran|Diproses|Dikirim|Selesai|Dibatalkan
//
// SERVER-ONLY: memakai createAdminClient() (service_role) yang menembus RLS. Tabel
// orders berisi data pribadi → semua baca/tulis WAJIB lewat server. Jangan diimpor
// dari komponen 'use client'.

import { createAdminClient } from '@/lib/supabase/server'
import type {
  Order,
  OrderItem,
  CreateOrderInput,
  OrderPaymentStatus,
  OrderFulfillmentStatus,
  BestSellingProduct,
} from '@/types/order'

// === Filter Options untuk query dinamis ===
export type OrderFilterOptions = {
  dari?: string
  sampai?: string
  kurir?: string
  pembayaran?: OrderPaymentStatus
  sortBy?: 'total' | 'tanggal'
  order?: 'asc' | 'desc'
}

// === Pemetaan enum DB <-> app ===

const DB_TO_PAYMENT: Record<string, OrderPaymentStatus> = {
  PENDING: 'Menunggu',
  PAID: 'Lunas',
  FAILED: 'Gagal',
}
const PAYMENT_TO_DB: Record<OrderPaymentStatus, string> = {
  Menunggu: 'PENDING',
  Lunas: 'PAID',
  Gagal: 'FAILED',
}
const DB_TO_STATUS: Record<string, OrderFulfillmentStatus> = {
  PENDING: 'Menunggu Pembayaran',
  PROCESSING: 'Diproses',
  SHIPPED: 'Dikirim',
  COMPLETED: 'Selesai',
  CANCELLED: 'Dibatalkan',
}
const STATUS_TO_DB: Record<OrderFulfillmentStatus, string> = {
  'Menunggu Pembayaran': 'PENDING',
  Diproses: 'PROCESSING',
  Dikirim: 'SHIPPED',
  Selesai: 'COMPLETED',
  Dibatalkan: 'CANCELLED',
}

// === Bentuk baris DB ===

type OrderRow = {
  id: string
  nomor_invoice: string
  email: string | null
  no_telepon: string | null
  nama_customer: string
  jumlah_total: number
  shipping_address: string | null
  provinsi: string | null
  kota: string | null
  kecamatan: string | null
  kelurahan: string | null
  kodepos: string | null
  nama_ekspedisi: string | null
  jenis_layanan: string | null
  no_tracking: string | null
  status_pembayaran: string
  id_transaksi: string | null
  order_status: string
  destination_id: string | null
  created_at: string
}

type OrderItemRow = {
  order_id: string
  product_id: string
  quantity: number
  price_at_purchase: number
  is_promo_item?: boolean // penanda produk gratis promo (kolom baru; opsional untuk baris warisan)
  promotion_id?: string | null // id promosi penyebab gratis (kolom baru)
  variant_id?: string | null // varian produk yang dipilih (kolom baru; null bila tak bervarian)
}

// === Error khusus stok tidak cukup (dilempar dari saveOrder) ===

// Dilempar bila stok salah satu produk tidak mencukupi saat checkout.
// Route menangkapnya untuk menampilkan pesan "Stok produk {nama} tidak mencukupi".
export class OrderStockError extends Error {
  productName: string
  constructor(productName: string) {
    super(`Stok produk ${productName} tidak mencukupi`)
    this.name = 'OrderStockError'
    this.productName = productName
  }
}

// === Helper ===

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Membuat nomor invoice: INV-{YYYY}{MM}{DD}-{4 digit acak}, mis. INV-20260601-4821.
function generateInvoiceNumber(): string {
  const d = new Date()
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const rand = String(Math.floor(1000 + Math.random() * 9000)) // selalu 4 digit
  return `INV-${ymd}-${rand}`
}

// Info produk yang di-resolve saat baca order (order_items hanya simpan id/harga/qty).
type ResolvedProduct = { name: string; imageUrl: string }

// Mengambil nama + foto produk untuk sekumpulan product_id (order_items tak menyimpannya).
// Hanya query id ber-format UUID (produk OMS); id dummy dilewati (fallback nama/foto generik).
async function resolveProductInfo(
  supabase: ReturnType<typeof createAdminClient>,
  productIds: string[],
): Promise<Map<string, ResolvedProduct>> {
  const ids = [...new Set(productIds)].filter((id) => UUID_RE.test(id))
  const map = new Map<string, ResolvedProduct>()
  if (ids.length === 0) return map
  const { data } = await supabase.from('products').select('id, name, image_url').in('id', ids)
  for (const p of (data as { id: string; name: string; image_url: string | null }[] | null) ?? []) {
    map.set(p.id, { name: p.name, imageUrl: p.image_url ?? '' })
  }
  return map
}

// Mengambil nama varian untuk sekumpulan variant_id (order_items hanya simpan id). Map id→nama_varian.
async function resolveVariantNames(
  supabase: ReturnType<typeof createAdminClient>,
  variantIds: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const ids = [...new Set(variantIds)].filter((id): id is string => Boolean(id) && UUID_RE.test(id as string))
  const map = new Map<string, string>()
  if (ids.length === 0) return map
  const { data } = await supabase.from('product_variants').select('id, nama_varian').in('id', ids)
  for (const v of (data as { id: string; nama_varian: string }[] | null) ?? []) {
    map.set(v.id, v.nama_varian)
  }
  return map
}

// Mengubah baris order_items → OrderItem (nama & foto di-resolve dari peta produk; nama varian dari peta varian).
function itemRowToItem(
  row: OrderItemRow,
  info: Map<string, ResolvedProduct>,
  variantInfo?: Map<string, string>,
): OrderItem {
  const resolved = info.get(row.product_id)
  const item: OrderItem = {
    productId: row.product_id,
    name: resolved?.name ?? 'Produk',
    quantity: row.quantity,
    price: row.price_at_purchase,
  }
  if (resolved?.imageUrl) item.imageUrl = resolved.imageUrl
  if (row.is_promo_item) item.isPromoItem = true
  if (row.promotion_id) item.promotionId = row.promotion_id
  if (row.variant_id) {
    item.variantId = row.variant_id
    const vname = variantInfo?.get(row.variant_id)
    if (vname) item.variantName = vname
  }
  return item
}

// Mengubah baris orders + item-nya menjadi Order (app-facing).
function rowToOrder(row: OrderRow, items: OrderItem[]): Order {
  const order: Order = {
    // Fallback ke id bila nomor_invoice kosong (baris warisan sebelum kolom nomor_invoice ada)
    orderId: row.nomor_invoice ?? row.id,
    customerName: row.nama_customer,
    date: row.created_at,
    items,
    totalAmount: row.jumlah_total,
    paymentStatus: DB_TO_PAYMENT[row.status_pembayaran] ?? 'Menunggu',
  }
  if (row.no_telepon) order.customerPhone = row.no_telepon
  if (row.email) order.customerEmail = row.email
  const status = DB_TO_STATUS[row.order_status]
  if (status) order.status = status
  if (row.nama_ekspedisi || row.jenis_layanan) {
    order.logistics = { courier: row.nama_ekspedisi ?? '', service: row.jenis_layanan ?? '' }
  }
  if (row.no_tracking) order.trackingNumber = row.no_tracking
  if (row.id_transaksi) order.transactionId = row.id_transaksi
  order.address = {
    shippingAddress: row.shipping_address ?? '',
    provinsi: row.provinsi ?? '',
    kota: row.kota ?? '',
    kecamatan: row.kecamatan ?? '',
    kelurahan: row.kelurahan ?? '',
    kodepos: row.kodepos ?? '',
    destinationId: row.destination_id ?? '',
  }
  return order
}

// === Baca ===

// Mengambil daftar unik kurir (nama_ekspedisi) untuk dropdown filter.
export async function getDistinctCouriers(): Promise<string[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('orders')
    .select('nama_ekspedisi')
    .not('nama_ekspedisi', 'is', null)
    .order('nama_ekspedisi', { ascending: true })

  if (error) {
    console.error('Gagal ambil kurir dari Supabase:', error.message)
    return []
  }

  const couriers = new Set<string>()
  for (const row of (data as { nama_ekspedisi: string | null }[]) ?? []) {
    if (row.nama_ekspedisi) couriers.add(row.nama_ekspedisi)
  }
  return Array.from(couriers)
}

// Membaca pesanan dengan filter (tanggal, kurir, status pembayaran) & sorting.
// Query dijalankan di Supabase (server-side), bukan fetch-all-then-filter.
export async function readOrdersFiltered(opts: OrderFilterOptions = {}): Promise<Order[]> {
  const supabase = createAdminClient()

  // Mulai dari base query
  let query = supabase.from('orders').select('*')

  // Filter range tanggal (created_at inclusive both ends)
  if (opts.dari) {
    query = query.gte('created_at', `${opts.dari}T00:00:00Z`)
  }
  if (opts.sampai) {
    query = query.lte('created_at', `${opts.sampai}T23:59:59Z`)
  }

  // Filter kurir (exact match)
  if (opts.kurir) {
    query = query.eq('nama_ekspedisi', opts.kurir)
  }

  // Filter status pembayaran
  if (opts.pembayaran) {
    query = query.eq('status_pembayaran', PAYMENT_TO_DB[opts.pembayaran])
  }

  // Sorting
  const sortColumn = opts.sortBy === 'total' ? 'jumlah_total' : 'created_at'
  const ascending = opts.order === 'asc'
  query = query.order(sortColumn, { ascending })

  const { data, error } = await query

  if (error) {
    console.error('Gagal membaca pesanan dari Supabase:', error.message)
    return []
  }

  const rows = (data as OrderRow[]) ?? []
  if (rows.length === 0) return []

  // Ambil items & resolve produk (sama seperti readOrders)
  const { data: itemData } = await supabase
    .from('order_items')
    .select('order_id, product_id, quantity, price_at_purchase, is_promo_item, promotion_id, variant_id')
    .in('order_id', rows.map((r) => r.id))
  const itemRows = (itemData as OrderItemRow[]) ?? []

  const info = await resolveProductInfo(supabase, itemRows.map((r) => r.product_id))
  const variantInfo = await resolveVariantNames(supabase, itemRows.map((r) => r.variant_id))
  const itemsByOrder = new Map<string, OrderItem[]>()
  for (const ir of itemRows) {
    const list = itemsByOrder.get(ir.order_id) ?? []
    list.push(itemRowToItem(ir, info, variantInfo))
    itemsByOrder.set(ir.order_id, list)
  }

  return rows.map((r) => rowToOrder(r, itemsByOrder.get(r.id) ?? []))
}

// Membaca seluruh pesanan (terbaru dulu) beserta item-nya, untuk tabel & widget OMS.
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

  const rows = (data as OrderRow[]) ?? []
  if (rows.length === 0) return []

  // Ambil semua item untuk order-order ini dalam satu query, lalu kelompokkan
  const { data: itemData } = await supabase
    .from('order_items')
    .select('order_id, product_id, quantity, price_at_purchase, is_promo_item, promotion_id, variant_id')
    .in('order_id', rows.map((r) => r.id))
  const itemRows = (itemData as OrderItemRow[]) ?? []

  const info = await resolveProductInfo(supabase, itemRows.map((r) => r.product_id))
  const variantInfo = await resolveVariantNames(supabase, itemRows.map((r) => r.variant_id))
  const itemsByOrder = new Map<string, OrderItem[]>()
  for (const ir of itemRows) {
    const list = itemsByOrder.get(ir.order_id) ?? []
    list.push(itemRowToItem(ir, info, variantInfo))
    itemsByOrder.set(ir.order_id, list)
  }

  return rows.map((r) => rowToOrder(r, itemsByOrder.get(r.id) ?? []))
}

// Membaca satu pesanan berdasarkan nomor invoice. null bila tidak ditemukan.
export async function getOrderByOrderId(orderId: string): Promise<Order | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('nomor_invoice', orderId)
    .maybeSingle()

  if (error) {
    console.error('Gagal membaca pesanan dari Supabase:', error.message)
    return null
  }
  if (!data) return null

  const row = data as OrderRow
  const { data: itemData } = await supabase
    .from('order_items')
    .select('order_id, product_id, quantity, price_at_purchase, is_promo_item, promotion_id, variant_id')
    .eq('order_id', row.id)
  const itemRows = (itemData as OrderItemRow[]) ?? []
  const info = await resolveProductInfo(supabase, itemRows.map((r) => r.product_id))
  const variantInfo = await resolveVariantNames(supabase, itemRows.map((r) => r.variant_id))

  return rowToOrder(row, itemRows.map((ir) => itemRowToItem(ir, info, variantInfo)))
}

// Membaca SEMUA pesanan milik satu nomor telepon (untuk lacak/batalkan by no_telepon).
// phone di-cocokkan APA ADANYA (pemanggil wajib menormalkan dulu via normalizePhone).
// Terbaru dulu. Array kosong bila tak ada / error. Server-only.
export async function getOrdersByPhone(phone: string): Promise<Order[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('no_telepon', phone)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Gagal membaca pesanan (by phone) dari Supabase:', error.message)
    return []
  }
  const rows = (data as OrderRow[]) ?? []
  if (rows.length === 0) return []

  // Ambil item semua order tsekaligus lalu kelompokkan (sama pola readOrders)
  const { data: itemData } = await supabase
    .from('order_items')
    .select('order_id, product_id, quantity, price_at_purchase, is_promo_item, promotion_id, variant_id')
    .in('order_id', rows.map((r) => r.id))
  const itemRows = (itemData as OrderItemRow[]) ?? []
  const info = await resolveProductInfo(supabase, itemRows.map((r) => r.product_id))
  const variantInfo = await resolveVariantNames(supabase, itemRows.map((r) => r.variant_id))
  const itemsByOrder = new Map<string, OrderItem[]>()
  for (const ir of itemRows) {
    const list = itemsByOrder.get(ir.order_id) ?? []
    list.push(itemRowToItem(ir, info, variantInfo))
    itemsByOrder.set(ir.order_id, list)
  }

  return rows.map((r) => rowToOrder(r, itemsByOrder.get(r.id) ?? []))
}

// === Tulis ===

// Menyimpan pesanan baru + item + kurangi stok, ATOMIK lewat Postgres RPC
// create_order_with_items (lihat supabase/migrations). Mengembalikan Order tersimpan.
// Melempar OrderStockError bila stok salah satu produk tidak cukup (transaksi di-rollback DB).
export async function saveOrder(input: CreateOrderInput): Promise<Order> {
  const supabase = createAdminClient()
  const paymentDb = PAYMENT_TO_DB[input.paymentStatus ?? 'Menunggu']
  const statusDb = STATUS_TO_DB[input.status ?? 'Menunggu Pembayaran']
  const itemsPayload = input.items.map((it) => ({
    product_id: it.productId,
    quantity: it.quantity,
    price_at_purchase: it.price,
    // Penanda produk gratis promo (RPC menyimpan bila kolom sudah di-migrate; aman diabaikan bila belum)
    is_promo_item: it.isPromoItem ?? false,
    promotion_id: it.promotionId ?? null,
    // Varian produk yang dipilih (null bila tak bervarian). RPC pakai ini untuk stok & simpan variant_id.
    variant_id: it.variantId ?? null,
  }))

  // Coba beberapa kali untuk mengatasi tabrakan nomor_invoice acak (unique violation)
  let lastError: { message?: string } | null = null
  for (let attempt = 0; attempt < 5; attempt++) {
    const invoice = generateInvoiceNumber()
    const { error } = await supabase.rpc('create_order_with_items', {
      p_nomor_invoice: invoice,
      p_email: input.customerEmail ?? null,
      p_no_telepon: input.customerPhone ?? null,
      p_nama_customer: input.customerName,
      p_jumlah_total: input.totalAmount,
      p_shipping_address: input.address.shippingAddress,
      p_provinsi: input.address.provinsi,
      p_kota: input.address.kota,
      p_kecamatan: input.address.kecamatan,
      p_kelurahan: input.address.kelurahan,
      p_kodepos: input.address.kodepos,
      p_nama_ekspedisi: input.logistics?.courier ?? null,
      p_jenis_layanan: input.logistics?.service ?? null,
      p_status_pembayaran: paymentDb,
      p_order_status: statusDb,
      p_destination_id: input.address.destinationId,
      p_items: itemsPayload,
    })

    if (!error) {
      const order = await getOrderByOrderId(invoice)
      if (order) return order
      // Fallback bila re-fetch gagal: kembalikan bentuk minimal dari input
      return {
        orderId: invoice,
        customerName: input.customerName,
        date: new Date().toISOString(),
        items: input.items,
        totalAmount: input.totalAmount,
        paymentStatus: input.paymentStatus ?? 'Menunggu',
        status: input.status ?? 'Menunggu Pembayaran',
      }
    }

    // Stok kurang → RPC me-raise 'INSUFFICIENT_STOCK:<nama>'. Jangan retry.
    if (error.message?.includes('INSUFFICIENT_STOCK')) {
      const name = error.message.split('INSUFFICIENT_STOCK:')[1]?.trim() || 'produk'
      throw new OrderStockError(name)
    }
    // Tabrakan nomor invoice unik → coba lagi dengan nomor baru
    if (error.code === '23505') {
      lastError = error
      continue
    }
    // Error lain → hentikan
    throw new Error(`Gagal menyimpan pesanan: ${error.message}`)
  }

  throw new Error(
    `Gagal menyimpan pesanan: ${lastError?.message ?? 'nomor invoice selalu bentrok'}`,
  )
}

// === Ubah status ===

// Field logistik opsional yang ikut diperbarui saat status berubah (mis. saat 'Dikirim').
export type OrderLogisticsPatch = {
  courier?: string // → nama_ekspedisi
  service?: string // → jenis_layanan
  trackingNumber?: string // → no_tracking
}

// Memperbarui status alur pesanan (mis. 'Dibatalkan' saat pembeli membatalkan, atau 'Dikirim'
// dari OMS dengan mengisi ekspedisi + no resi). Field logistik hanya ditulis bila disertakan.
// Mengembalikan order terbaru (beserta item), atau null bila tidak ditemukan.
export async function updateOrderStatus(
  orderId: string,
  status: OrderFulfillmentStatus,
  logistics?: OrderLogisticsPatch,
): Promise<Order | null> {
  const supabase = createAdminClient()
  const patch: Record<string, string> = { order_status: STATUS_TO_DB[status] }
  if (logistics?.courier !== undefined) patch.nama_ekspedisi = logistics.courier
  if (logistics?.service !== undefined) patch.jenis_layanan = logistics.service
  if (logistics?.trackingNumber !== undefined) patch.no_tracking = logistics.trackingNumber

  const { data, error } = await supabase
    .from('orders')
    .update(patch)
    .eq('nomor_invoice', orderId)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('Gagal memperbarui status pesanan di Supabase:', error.message)
    return null
  }
  if (!data) return null

  return getOrderByOrderId(orderId)
}

// === Agregasi produk terlaris ===

// Opsi filter agregasi penjualan. from/to = ISO date string (inklusif) atas created_at.
export type SalesRangeOptions = {
  from?: string
  to?: string
}

// Mengagregasi unit terjual & pendapatan per productId dari order_items.
// Hanya menghitung penjualan riil: status_pembayaran PAID dan order_status BUKAN CANCELLED.
async function aggregateSales(
  opts: SalesRangeOptions = {},
): Promise<Map<string, BestSellingProduct>> {
  const supabase = createAdminClient()

  // 1. Ambil id order yang dihitung sebagai penjualan dalam rentang waktu.
  // Selama Xendit belum ada, checkout langsung memotong stok (order PENDING = sudah commit),
  // jadi hitung semua order yang BUKAN Dibatalkan (abaikan status bayar).
  // TODO: setelah Xendit terpasang, ganti jadi .eq('status_pembayaran','PAID').
  let query = supabase
    .from('orders')
    .select('id')
    .neq('order_status', 'CANCELLED')
  if (opts.from) query = query.gte('created_at', opts.from)
  if (opts.to) query = query.lte('created_at', opts.to)

  const { data: orderData, error: orderErr } = await query
  if (orderErr) {
    console.error('Gagal menghitung penjualan (orders) dari Supabase:', orderErr.message)
    return new Map()
  }
  const orderIds = ((orderData as { id: string }[]) ?? []).map((o) => o.id)
  if (orderIds.length === 0) return new Map()

  // 2. Ambil item dari order-order tersebut
  const { data: itemData, error: itemErr } = await supabase
    .from('order_items')
    .select('product_id, quantity, price_at_purchase')
    .in('order_id', orderIds)
  if (itemErr) {
    console.error('Gagal menghitung penjualan (items) dari Supabase:', itemErr.message)
    return new Map()
  }
  const itemRows = (itemData as Pick<OrderItemRow, 'product_id' | 'quantity' | 'price_at_purchase'>[]) ?? []

  // 3. Resolve nama produk lalu akumulasi per productId
  const info = await resolveProductInfo(supabase, itemRows.map((r) => r.product_id))
  const totals = new Map<string, BestSellingProduct>()
  for (const it of itemRows) {
    const prev = totals.get(it.product_id)
    if (prev) {
      prev.totalSold += it.quantity
      prev.totalRevenue += it.quantity * it.price_at_purchase
    } else {
      totals.set(it.product_id, {
        productId: it.product_id,
        name: info.get(it.product_id)?.name ?? 'Produk',
        totalSold: it.quantity,
        totalRevenue: it.quantity * it.price_at_purchase,
      })
    }
  }
  return totals
}

// Produk terlaris (paling banyak terjual), diurut terbanyak dulu.
// opts.limit membatasi jumlah (default 5); opts.from/to memfilter rentang tanggal.
export async function getBestSellingProducts(
  opts: SalesRangeOptions & { limit?: number } = {},
): Promise<BestSellingProduct[]> {
  const totals = await aggregateSales(opts)
  return Array.from(totals.values())
    .sort((a, b) => b.totalSold - a.totalSold)
    .slice(0, opts.limit ?? 5)
}

// Peta productId → total unit terjual dalam rentang waktu (kolom "Terjual" OMS & sort storefront).
export async function getSalesCountByProduct(
  opts: SalesRangeOptions = {},
): Promise<Record<string, number>> {
  const totals = await aggregateSales(opts)
  const counts: Record<string, number> = {}
  for (const [productId, agg] of totals) counts[productId] = agg.totalSold
  return counts
}
