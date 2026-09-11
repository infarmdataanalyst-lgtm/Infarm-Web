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
import { readWarehouses } from '@/lib/mock-db/warehouses'
import { recordOrderStockChanges } from '@/lib/stock-audit'
import type { RevenueOrderRow } from '@/lib/dashboard-revenue'
import type {
  Order,
  OrderItem,
  CreateOrderInput,
  OrderPaymentStatus,
  OrderFulfillmentStatus,
  RefundWorkItem,
  BestSellingProduct,
} from '@/types/order'

// === Filter Options untuk query dinamis ===

// Nilai khusus filter gudang: hanya pesanan yang BELUM punya gudang pemenuh
// (orders.warehouse_id NULL — pesanan sebelum fitur multi-gudang ada). Dipakai agar pesanan lama
// tetap bisa ditemukan & diaudit, bukan hilang dari daftar.
export const WAREHOUSE_FILTER_NONE = 'none'

export type OrderFilterOptions = {
  dari?: string
  sampai?: string
  kurir?: string
  pembayaran?: OrderPaymentStatus
  status?: OrderFulfillmentStatus // status alur pesanan (tab di halaman OMS)
  // Gudang pemenuh — BANYAK nilai (filter multi-select di UI). Isi = id gudang dan/atau
  // WAREHOUSE_FILTER_NONE untuk warehouse_id NULL. Array kosong/undefined = tanpa filter gudang.
  gudang?: string[]
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
  // Tagihan Xendit yang masih berlaku (migration 20260908120000) — optional, alasan sama seperti
  // kolom baru lain di bawah. Dipakai agar satu pesanan tak menerbitkan tagihan berkali-kali.
  invoice_url?: string | null
  invoice_expires_at?: string | null
  // Hasil upaya mematikan tagihan saat pembatalan (migration 20260910120000) — optional, alasan
  // sama. `invoice_expire_error` terisi = pesanan batal tapi tagihannya MASIH BISA DIBAYAR.
  invoice_expired_at?: string | null
  invoice_expire_error?: string | null
  // Pengembalian dana (migration 20260910130000) — optional, alasan sama.
  refund_status?: string | null
  refund_amount?: number | null
  refund_note?: string | null
  refund_at?: string | null
  refund_by?: string | null
  refund_reference?: string | null
  // Kolom baru (migration 20260827120000). Optional di tipe ini supaya kode tetap jalan bila
  // migration belum di-apply — PostgREST tak mengembalikan kolom yang belum ada.
  ongkos_kirim?: number | null
  // Metode pembayaran dari callback Xendit (migration 20260828120000) — optional, alasan sama.
  metode_pembayaran?: string | null
  order_status: string
  destination_id: string | null
  warehouse_id?: string | null // gudang pemenuh (kolom baru; null untuk pesanan lama)
  // Hasil booking kurir (kolom baru; undefined bila migration shipment belum di-apply)
  shipment_status?: string | null
  shipment_error?: string | null
  shipment_booked_at?: string | null
  // Identitas pengiriman di sisi Mengantar (migration 20260909120000) — optional, alasan sama.
  // Dipakai untuk MEMBATALKAN penjemputan; DELETE /order tak menerima nomor resi.
  mengantar_order_object_id?: string | null
  mengantar_order_id?: string | null
  mengantar_batch_id?: string | null
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

// Membuat nomor invoice: INV-{YYYY}{MM}{DD}-{8 karakter acak}, mis. INV-20260601-K7QM4T2X.
//
// KENAPA 8 KARAKTER, BUKAN 4 DIGIT seperti sebelumnya: nomor invoice adalah satu-satunya kunci
// halaman /track — halaman itu tak memverifikasi kepemilikan apa pun (karena itu nama, telepon,
// dan detail jalan di sana sudah di-mask). Dengan 4 digit desimal hanya ada 9.000 kemungkinan per
// tanggal, jadi seluruh pesanan satu hari bisa dienumerasi dalam hitungan menit — dan sejak kartu
// produk ditambahkan, halaman itu juga menampilkan isi belanja beserta nominalnya.
// 8 karakter × 5 bit = 40 bit ≈ 1,1 × 10^12 kemungkinan per tanggal.
//
// Memakai crypto.randomUUID() sebagai sumber acak (bukan Math.random yang TIDAK aman secara
// kriptografis dan bisa diprediksi dari keluaran sebelumnya).
//
// Alfabet = Crockford base32: tanpa I, L, O, U sehingga tak ada pasangan huruf/angka yang mudah
// tertukar saat pembeli membacakan nomornya lewat telepon/WhatsApp. Panjangnya TEPAT 32 supaya
// pemetaan 5-bit → 1 karakter tidak berbias; alfabet yang bukan pangkat dua akan membuat sebagian
// karakter lebih sering muncul dan itu mengurangi entropi nyata.
const INVOICE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const INVOICE_RANDOM_LENGTH = 8 // 8 × 5 bit = 40 bit acak

function generateInvoiceNumber(): string {
  const d = new Date()
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  // randomUUID → 32 digit hex acak-aman; 10 digit pertama = 40 bit yang dipakai di bawah.
  // Dipecah dengan modulo/pembagian, BUKAN operator bit (`&`/`>>`): operator bit JavaScript
  // memotong operandnya ke 32 bit, sehingga 8 bit teratas akan hilang tanpa suara.
  // 2^40 masih jauh di bawah Number.MAX_SAFE_INTEGER, jadi aritmetikanya tetap eksak.
  let bits = parseInt(crypto.randomUUID().replace(/-/g, '').slice(0, 10), 16)
  let rand = ''
  for (let i = 0; i < INVOICE_RANDOM_LENGTH; i += 1) {
    rand = INVOICE_ALPHABET[bits % INVOICE_ALPHABET.length] + rand
    bits = Math.floor(bits / INVOICE_ALPHABET.length)
  }
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

// Peta id gudang → nama, untuk kolom "Gudang" di tabel Pesanan OMS.
// Membaca SELURUH gudang (termasuk yang nonaktif): pesanan lama bisa saja dipenuhi gudang yang
// kini dinonaktifkan, dan riwayatnya tetap harus terbaca. Jumlah gudang selalu sedikit (satuan),
// jadi satu query tanpa filter lebih murah daripada menyusun daftar id.
async function resolveWarehouseNames(rows: OrderRow[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  // Tak ada pesanan ber-gudang → jangan buang satu query pun.
  if (!rows.some((r) => r.warehouse_id)) return map
  for (const warehouse of await readWarehouses()) map.set(warehouse.id, warehouse.nama)
  return map
}

// Mengubah baris orders + item-nya menjadi Order (app-facing).
// `warehouseNames` opsional: hanya diisi pemanggil OMS yang butuh kolom Gudang.
function rowToOrder(row: OrderRow, items: OrderItem[], warehouseNames?: Map<string, string>): Order {
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
  // Status pengiriman. Hanya nilai yang dikenal app yang diteruskan; nilai lain (atau kolom yang
  // belum di-migrate) dibiarkan undefined agar UI menampilkannya sebagai "belum dibooking".
  //
  // Daftar ini WAJIB sejalan dengan constraint orders_shipment_status_check di database
  // (migration 20260909130000). Menambah nilai di satu sisi saja menghasilkan kegagalan yang sulit
  // dilacak: kalau hanya di sini, database menolak tulisannya (23514); kalau hanya di database,
  // nilainya tersimpan tapi hilang saat dibaca dan pesanan tampak "belum pernah dibooking".
  if (
    row.shipment_status === "BOOKED" ||
    row.shipment_status === "FAILED" ||
    row.shipment_status === "CANCELLED" ||
    row.shipment_status === "CANCEL_FAILED"
  ) {
    order.shipmentStatus = row.shipment_status
  }
  if (row.shipment_error) order.shipmentError = row.shipment_error
  if (row.shipment_booked_at) order.shipmentBookedAt = row.shipment_booked_at
  if (row.mengantar_order_object_id) order.mengantarObjectId = row.mengantar_order_object_id
  if (row.mengantar_order_id) order.mengantarOrderId = row.mengantar_order_id
  if (row.mengantar_batch_id) order.mengantarBatchId = row.mengantar_batch_id
  if (row.id_transaksi) order.transactionId = row.id_transaksi
  if (row.invoice_url) order.invoiceUrl = row.invoice_url
  if (row.invoice_expires_at) order.invoiceExpiresAt = row.invoice_expires_at
  if (row.invoice_expired_at) order.invoiceExpiredAt = row.invoice_expired_at
  if (row.invoice_expire_error) order.invoiceExpireError = row.invoice_expire_error
  // Nilai asing (atau kolom yang belum di-migrate) dibiarkan undefined — daftarnya WAJIB sejalan
  // dengan constraint orders_refund_status_check.
  if (
    row.refund_status === 'PERLU_REFUND' ||
    row.refund_status === 'SEDANG_DIPROSES' ||
    row.refund_status === 'SUDAH_REFUND' ||
    row.refund_status === 'TIDAK_PERLU'
  ) {
    order.refundStatus = row.refund_status
  }
  // `typeof number`, bukan truthy: refund Rp0 sah (mis. seluruhnya dipotong biaya) dan harus
  // tetap terbawa, bukan disamakan dengan "tak pernah dicatat".
  if (typeof row.refund_amount === 'number') order.refundAmount = row.refund_amount
  if (row.refund_note) order.refundNote = row.refund_note
  if (row.refund_at) order.refundAt = row.refund_at
  if (row.refund_by) order.refundBy = row.refund_by
  if (row.refund_reference) order.refundReference = row.refund_reference
  if (row.metode_pembayaran) order.paymentMethod = row.metode_pembayaran
  // `typeof number`, bukan truthy: ongkir 0 (promo gratis ongkir) sah dan harus tetap terbawa.
  // `if (row.ongkos_kirim)` akan membuangnya dan menyamakannya dengan "tak pernah dicatat".
  if (typeof row.ongkos_kirim === 'number') order.shippingCost = row.ongkos_kirim
  // Gudang pemenuh — dipakai saat pembatalan untuk mengembalikan stok ke gudang yang benar
  if (row.warehouse_id) {
    order.warehouseId = row.warehouse_id
    // Nama hanya terisi bila pemanggil memang menyediakan petanya (OMS). Gudang yang sudah dihapus
    // tak ada di peta → nama dibiarkan kosong, UI menampilkan "Belum ditentukan".
    const name = warehouseNames?.get(row.warehouse_id)
    if (name) order.warehouseName = name
  }
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

  // Filter status alur pesanan (tab di halaman OMS). Label Indonesia → enum DB.
  if (opts.status) {
    query = query.eq('order_status', STATUS_TO_DB[opts.status])
  }

  // Filter gudang pemenuh — BISA BEBERAPA sekaligus.
  // 'none' = pesanan lama yang belum punya gudang (warehouse_id NULL). NULL tak pernah cocok
  // dengan perbandingan biasa di SQL, jadi butuh `is.null`, bukan `eq`/`in`.
  //
  // Saat 'none' dipilih BERSAMA id gudang, keduanya WAJIB digabung dalam SATU .or(): merangkai
  // .in(...).is(...) akan menghasilkan AND ("warehouse_id ada di daftar DAN sekaligus NULL") yang
  // mustahil benar, sehingga tabel tampil kosong tanpa error apa pun.
  if (opts.gudang && opts.gudang.length > 0) {
    const ids = opts.gudang.filter((v) => v !== WAREHOUSE_FILTER_NONE)
    const includeNull = opts.gudang.includes(WAREHOUSE_FILTER_NONE)

    if (includeNull && ids.length > 0) {
      query = query.or(`warehouse_id.in.(${ids.join(',')}),warehouse_id.is.null`)
    } else if (includeNull) {
      query = query.is('warehouse_id', null)
    } else {
      query = query.in('warehouse_id', ids)
    }
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

  const warehouseNames = await resolveWarehouseNames(rows)
  return rows.map((r) => rowToOrder(r, itemsByOrder.get(r.id) ?? [], warehouseNames))
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

  const warehouseNames = await resolveWarehouseNames(rows)
  return rows.map((r) => rowToOrder(r, itemsByOrder.get(r.id) ?? [], warehouseNames))
}

// Membaca N pesanan terbaru untuk widget "Pesanan Terbaru" di Dashboard OMS.
//
// Item pesanan TIDAK diambil (widget hanya menampilkan invoice/nama/total/status pembayaran),
// jadi `items` selalu array kosong. readOrders() menarik SELURUH tabel beserta seluruh
// order_items-nya — memakai itu hanya untuk mengambil 5 baris teratas akan makin mahal seiring
// pesanan bertambah.
export async function getRecentOrders(limit = 5): Promise<Order[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('Gagal membaca pesanan terbaru dari Supabase:', error.message)
    return []
  }
  return ((data as OrderRow[]) ?? []).map((r) => rowToOrder(r, []))
}

// Membaca kolom minimum yang dibutuhkan Dashboard OMS untuk menghitung pendapatan pada satu
// rentang waktu. Sengaja tidak mengambil order_items maupun nama gudang: dashboard hanya
// menjumlahkan jumlah_total per status, dan menarik item ratusan pesanan hanya untuk dijumlahkan
// adalah pemborosan.
//
// `from` INKLUSIF, `to` EKSKLUSIF (memakai .lt, bukan .lte) — mengikuti batas periode di
// dashboard-period.ts, supaya pesanan tepat tengah malam tidak terhitung di dua periode
// berdampingan sekaligus (yang akan membuat delta pertumbuhan salah).
//
// Agregasi dilakukan di aplikasi (lihat dashboard-revenue.ts), bukan SQL, karena jumlah pesanan
// masih kecil dan logika kategorinya perlu identik dengan yang dipakai UI. Ambang pindah ke
// agregasi SQL/RPC: sekitar 10.000 pesanan per periode.
export async function readOrdersForRevenue(
  from: string,
  to: string,
): Promise<RevenueOrderRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('orders')
    .select('jumlah_total, status_pembayaran, order_status, created_at')
    .gte('created_at', from)
    .lt('created_at', to)

  if (error) {
    console.error('Gagal membaca pendapatan dari Supabase:', error.message)
    return []
  }

  type RevenueRow = Pick<
    OrderRow,
    'jumlah_total' | 'status_pembayaran' | 'order_status' | 'created_at'
  >
  return ((data as RevenueRow[]) ?? []).map((row) => {
    const status = DB_TO_STATUS[row.order_status]
    return {
      totalAmount: row.jumlah_total,
      paymentStatus: DB_TO_PAYMENT[row.status_pembayaran] ?? 'Menunggu',
      // order_status NULL pada baris warisan → status dibiarkan undefined (bukan ditebak),
      // sehingga kategorinya ditentukan oleh status pembayaran saja.
      ...(status ? { status } : {}),
      date: row.created_at,
    }
  })
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
  // Nama gudang ikut di-resolve: modal detail pesanan OMS memakai objek Order yang sama.
  const warehouseNames = await resolveWarehouseNames([row])

  return rowToOrder(
    row,
    itemRows.map((ir) => itemRowToItem(ir, info, variantInfo)),
    warehouseNames,
  )
}

// === Sinkronisasi status dari kurir ===

// Pesanan yang layak diperiksa ke API kurir. Sengaja RAMPING (tanpa item, tanpa alamat, tanpa nama
// gudang): sinkronisasi hanya butuh status + resi, dan halaman Pesanan OMS memanggilnya untuk 20
// baris sekaligus. Memakai getOrderByOrderId() di sini berarti 20× (query order + item + produk +
// varian + gudang) hanya untuk membaca tiga kolom.
export type TrackingSyncCandidate = {
  orderId: string // nomor_invoice
  status: OrderFulfillmentStatus
  trackingNumber: string
}

// Menyaring daftar invoice → hanya yang benar-benar layak diperiksa ke kurir.
//
// Tiga syarat, semuanya dijalankan sebagai filter DB (bukan di JS) supaya baris yang tak relevan
// tak pernah ikut terbaca:
//   1. `status_pembayaran = PAID` — pesanan belum dibayar TIDAK boleh terdorong maju oleh peristiwa
//      kurir apa pun. Ini pagar terpenting di sini.
//   2. `order_status ∈ (PROCESSING, SHIPPED)` — hanya yang masih bisa maju. COMPLETED & CANCELLED
//      sudah final; memeriksanya cuma membuang panggilan API.
//   3. punya `no_tracking` — tanpa resi tak ada yang bisa dilacak.
//
// Array kosong bila `invoices` kosong (jangan kirim query `.in()` dengan daftar kosong).
export async function readTrackingSyncCandidates(
  invoices: string[],
): Promise<TrackingSyncCandidate[]> {
  if (invoices.length === 0) return []

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('orders')
    .select('nomor_invoice, order_status, no_tracking')
    .in('nomor_invoice', invoices)
    .eq('status_pembayaran', PAYMENT_TO_DB['Lunas'])
    .in('order_status', [STATUS_TO_DB['Diproses'], STATUS_TO_DB['Dikirim']])
    .not('no_tracking', 'is', null)

  if (error) {
    console.error('Gagal membaca kandidat sinkronisasi tracking:', error.message)
    return []
  }

  const rows = (data as Pick<OrderRow, 'nomor_invoice' | 'order_status' | 'no_tracking'>[]) ?? []
  return rows.flatMap((row) => {
    const status = DB_TO_STATUS[row.order_status]
    const trackingNumber = row.no_tracking?.trim()
    // Baris tanpa invoice tak bisa dirujuk oleh updateOrderStatus (yang mencocokkan nomor_invoice),
    // dan status di luar peta = nilai DB yang tak dikenal app. Keduanya dilewati, bukan ditebak.
    if (!row.nomor_invoice || !status || !trackingNumber) return []
    return [{ orderId: row.nomor_invoice, status, trackingNumber }]
  })
}

// Invoice pesanan yang pembayarannya SUDAH LEWAT TENGGAT dan tak akan pernah masuk.
//
// Dipakai penyapu kedaluwarsa (/api/cron/expire-orders). Mengembalikan nomor invoice saja, bukan
// Order utuh: pemanggil hanya butuh tahu MANA yang perlu ditutup, lalu membaca detailnya satu per
// satu — jumlahnya sedikit (pesanan basi per hari), jadi N+1 di sini jauh lebih murah daripada
// memuat item + produk + varian untuk baris yang mungkin tak jadi disentuh.
//
// Tiga syarat, seluruhnya filter DB:
//   1. `status_pembayaran = PENDING` — yang sudah Lunas/Gagal tak ada urusannya di sini.
//   2. `order_status = PENDING` — SENGAJA hanya yang masih murni menunggu bayar. Pesanan yang
//      sudah didorong maju admin (mis. PENDING/PROCESSING) TIDAK disentuh: admin melakukannya
//      dengan sadar, dan membatalkannya otomatis akan menghapus keputusan manusia tanpa bertanya.
//      Baris seperti itu memang perlu perhatian, tapi lewat mata admin, bukan lewat penyapu.
//   3. `created_at < cutoff` — pemanggil yang menentukan tenggatnya (umur invoice + tenggang).
//   4. `warehouse_id` TERISI — pagar keselamatan, bukan detail teknis. Lihat di bawah.
//
// ── Kenapa pesanan tanpa gudang SENGAJA dilewati ──
// Pesanan warisan (sebelum sistem multi-gudang & audit stock_mutations) tak punya warehouse_id dan
// tak punya satu pun baris mutasi. Kita TIDAK BISA membuktikan stoknya pernah dipotong dari gudang
// mana pun. Kalau tetap disapu, restoreStock() akan mengkreditkannya ke gudang DEFAULT — menambah
// stok yang mungkin tak pernah dikurangi di sana.
//
// Arah kesalahannya penting: melewatkan pesanan warisan berarti stok tercatat lebih SEDIKIT
// daripada kenyataan (aman — paling banter kehilangan penjualan, dan ketahuan saat stok opname),
// sedangkan menyapunya berarti stok tercatat lebih BANYAK (berbahaya — oversell, pembeli membayar
// barang yang tak ada). Saat ragu, gagal ke arah yang aman.
//
// Baris warisan tetap perlu dibereskan, tapi oleh manusia yang bisa mencocokkan stok fisik —
// bukan oleh penyapu yang berjalan tengah malam tanpa ada yang melihat.
//
// Terlama dulu, supaya batas `limit` memangkas yang paling baru, bukan yang paling lama tertahan.
export async function readExpiredPendingInvoices(
  cutoffIso: string,
  limit = 100,
): Promise<string[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('orders')
    .select('nomor_invoice')
    .eq('status_pembayaran', PAYMENT_TO_DB['Menunggu'])
    .eq('order_status', STATUS_TO_DB['Menunggu Pembayaran'])
    .lt('created_at', cutoffIso)
    .not('warehouse_id', 'is', null)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) {
    console.error('Gagal membaca pesanan kedaluwarsa:', error.message)
    return []
  }

  const rows = (data as Pick<OrderRow, 'nomor_invoice'>[]) ?? []
  return rows.map((row) => row.nomor_invoice).filter((invoice): invoice is string => !!invoice)
}

// Pesanan yang SUDAH Dibatalkan tetapi status pembayarannya masih tertinggal di "Menunggu".
//
// Terjadi karena pembatalan manual lewat OMS hanya menyentuh `order_status` — hanya jalur otomatis
// (webhook / penyapu) yang mengubah KEDUA kolom. Akibatnya lencana pembayaran di OMS berbunyi
// "Menunggu" pada pesanan yang sudah mati, seolah uangnya masih mungkin masuk.
//
// TIDAK ADA STOK yang bergerak saat baris ini dibereskan — pesanannya sudah dibatalkan, jadi
// stoknya sudah dikembalikan saat itu. Yang diperbaiki murni pembukuan. Karena itu pula pesanan
// warisan tanpa `warehouse_id` ikut disertakan: pagar gudang pada readExpiredPendingInvoices ada
// untuk melindungi perhitungan stok, dan di sini tak ada perhitungan stok sama sekali.
//
// `created_at < cutoff` tetap dipakai supaya pesanan yang baru saja dibatalkan tidak diberi cap
// Gagal mendahului callback pembayaran yang mungkin masih dalam perjalanan.
export async function readCancelledWithPendingPayment(
  cutoffIso: string,
  limit = 100,
): Promise<string[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('orders')
    .select('nomor_invoice')
    .eq('status_pembayaran', PAYMENT_TO_DB['Menunggu'])
    .eq('order_status', STATUS_TO_DB['Dibatalkan'])
    .lt('created_at', cutoffIso)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) {
    console.error('Gagal membaca pesanan batal berstatus bayar tertinggal:', error.message)
    return []
  }

  const rows = (data as Pick<OrderRow, 'nomor_invoice'>[]) ?? []
  return rows.map((row) => row.nomor_invoice).filter((invoice): invoice is string => !!invoice)
}

// Membaca SEMUA pesanan milik satu nomor telepon (untuk lacak/batalkan by no_telepon).
// phone di-cocokkan APA ADANYA (pemanggil wajib menormalkan dulu via normalizePhone).
// Terbaru dulu. Array kosong bila tak ada / error. Server-only.
export async function getOrdersByPhone(phone: string): Promise<Order[]> {
  return readOrdersByColumn('no_telepon', phone, 'by phone')
}

// Semua pesanan milik satu EMAIL, terbaru dulu. Dipakai Lacak Pesanan (/track-order).
//
// Kolomnya bernama `email`, BUKAN `customer_email`. Migration
// 20260624120000_add_orders_customer_email.sql menyebut nama yang kedua, tapi kolom itu tak pernah
// ada di database — `customer_email` membuat PostgREST membalas 42703 (undefined_column). Kolom
// `email` sudah ada sejak tabel dibuat dan itulah yang diisi RPC create_order_with_items lewat
// parameter p_email. Jangan "memperbaiki" nama ini mengikuti file migration tersebut.
//
// `email` yang masuk WAJIB sudah dinormalisasi (huruf kecil) oleh pemanggil — lihat lib/email.ts.
// Pencocokan di sini persis (case-sensitive), jadi email yang disimpan dan yang dicari harus
// melewati normalisasi yang sama.
export async function getOrdersByEmail(email: string): Promise<Order[]> {
  return readOrdersByColumn('email', email, 'by email')
}

// Inti bersama getOrdersByPhone & getOrdersByEmail: baca pesanan yang cocok pada satu kolom,
// lalu lengkapi itemnya. Dipisah agar kedua jalur pencarian tak pernah menyimpang perilakunya —
// satu memuat nama varian dan yang lain tidak, misalnya.
async function readOrdersByColumn(
  column: 'no_telepon' | 'email',
  value: string,
  labelForLog: string,
): Promise<Order[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq(column, value)
    .order('created_at', { ascending: false })

  if (error) {
    console.error(`Gagal membaca pesanan (${labelForLog}) dari Supabase:`, error.message)
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

// Mengambil UUID internal pesanan dari nomor invoice. Dipakai untuk mengisi
// stock_mutations.order_id (FK ke orders.id) — di lapisan app pesanan diidentifikasi oleh
// nomor_invoice, sementara FK butuh id aslinya.
export async function getOrderUuidByInvoice(invoice: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('orders')
    .select('id')
    .eq('nomor_invoice', invoice)
    .maybeSingle()

  if (error) {
    console.error('Gagal membaca id pesanan:', error.message)
    return null
  }
  return (data as { id: string } | null)?.id ?? null
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
    // Paket asal baris ini. Tanpa ini identitas combo hilang di perbatasan RPC dan tak ada cara
    // melaporkan berapa paket terjual. Aman diabaikan RPC versi lama (kolomnya belum ada).
    combo_id: it.comboId ?? null,
  }))

  // Coba beberapa kali untuk mengatasi tabrakan nomor_invoice acak (unique violation)
  let lastError: { message?: string } | null = null
  // Jaring pengaman: bila migration gudang belum di-apply, RPC di DB masih versi lama (tanpa
  // p_warehouse_id) sehingga PostgREST menolak dengan PGRST202/42883 ("function not found").
  // Saat itu terjadi, param gudang dibuang dan pesanan tetap tersimpan seperti sebelumnya.
  let sendWarehouseParam = true
  // Jaring pengaman KEDUA, terpisah: migration promo (20260907130000) menambah p_diskon,
  // p_ongkos_kirim_ditanggung, dan p_promo_terpakai. Dipisah dari sendWarehouseParam supaya
  // database yang sudah punya kolom gudang & ongkir tapi belum punya kolom promo tidak ikut
  // kehilangan keduanya — penurunan bertahap, bukan sekaligus.
  let sendPromoParams = true
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
      // Gudang pemenuh pesanan (hasil resolveWarehouseForOrder). null → RPC memakai gudang default,
      // jadi pesanan tetap tercatat walau tabel warehouses belum di-seed.
      ...(sendWarehouseParam ? { p_warehouse_id: input.warehouseId ?? null } : {}),
      // Ongkir hasil verifikasi server → kolom orders.ongkos_kirim (migration 20260827120000).
      // Dibuang bersama param gudang saat RPC di DB masih versi lama: keduanya sama-sama membuat
      // signature tak cocok, dan lebih baik pesanan tersimpan tanpa rincian ongkir daripada
      // checkout gagal total karena migration belum sempat di-apply.
      ...(sendWarehouseParam ? { p_ongkos_kirim: input.shippingCost ?? null } : {}),
      // Angka promo (migration 20260907130000). ongkos_kirim di atas tetap tarif ASLI Mengantar;
      // subsidi gratis ongkir dicatat terpisah di sini supaya tagihan kurir tetap bisa
      // direkonsiliasi.
      ...(sendPromoParams
        ? {
            p_diskon: input.discount ?? 0,
            p_ongkos_kirim_ditanggung: input.shippingSubsidy ?? 0,
            p_promo_terpakai: input.appliedPromos ?? [],
          }
        : {}),
    })

    if (!error) {
      // Catat pergerakan stok akibat pesanan ini. Dijalankan SETELAH RPC sukses (stok sudah
      // berkurang di DB) supaya nilai "sesudah" yang dibaca adalah kondisi nyata. Best effort:
      // gagal mencatat riwayat tak boleh menggagalkan pesanan yang sudah tersimpan.
      const orderUuid = await getOrderUuidByInvoice(invoice)
      await recordOrderStockChanges({
        items: input.items.map((it) => ({
          productId: it.productId,
          ...(it.variantId ? { variantId: it.variantId } : {}),
          quantity: it.quantity,
        })),
        ...(input.warehouseId ? { warehouseId: input.warehouseId } : {}),
        orderInvoice: invoice,
        ...(orderUuid ? { orderId: orderUuid } : {}),
        direction: 'out',
      })

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
    //
    // Versi RPC yang sempat terpasang mengirim 'INSUFFICIENT_STOCK:<nama>:<sisa>', sementara
    // pengurai di sini hanya memotong pada token pertama — akibatnya pembeli membaca pesan
    // "Stok produk Bayam:3 tidak mencukupi". Angka sisa stok dibuang di sini (bukan cuma di RPC
    // baru) supaya database yang masih memakai RPC lama pun menghasilkan pesan yang benar.
    if (error.message?.includes('INSUFFICIENT_STOCK')) {
      const raw = error.message.split('INSUFFICIENT_STOCK:')[1]?.trim() ?? ''
      const name = raw.replace(/:\s*\d+\s*$/, '').trim() || 'produk'
      throw new OrderStockError(name)
    }
    // Tabrakan nomor invoice unik → coba lagi dengan nomor baru
    if (error.code === '23505') {
      lastError = error
      continue
    }
    // RPC versi lama → ulangi tanpa param gudang DAN tanpa param ongkir.
    //
    // Terjadi bila migration gudang (20260811120100) atau ongkir (20260827120000) belum di-apply.
    // Keduanya menambah parameter, jadi gejalanya identik dan penanganannya sama: buang keduanya,
    // pesanan tetap tersimpan dengan kolom yang memang belum ada dibiarkan kosong.
    // PGRST202 = fungsi dengan signature itu tak ditemukan; 42883 = undefined_function.
    //
    // Diturunkan BERTAHAP: param promo dibuang lebih dulu, baru param gudang & ongkir. Database
    // yang hanya ketinggalan migration promo dengan begitu tetap menyimpan warehouse_id dan
    // ongkos_kirim seperti biasa.
    if (error.code === 'PGRST202' || error.code === '42883') {
      if (sendPromoParams) {
        sendPromoParams = false
        lastError = error
        continue
      }
      if (sendWarehouseParam) {
        sendWarehouseParam = false
        lastError = error
        continue
      }
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
// Mengembalikan order terbaru (beserta item), atau null bila tidak ditemukan / status lamanya
// sudah bukan salah satu `expectedFrom`.
//
// === COMPARE-AND-SWAP lewat `expectedFrom` (menutup SEC-020) ===
//
// Tanpa argumen ini, UPDATE-nya hanya bersyarat nomor_invoice — jadi ia BERHASIL berapa kali pun
// dipanggil, termasuk ketika status pesanan sudah berubah sejak pemanggil terakhir memeriksanya.
// Pada pembatalan, akibatnya nyata: dua permintaan yang tiba nyaris bersamaan (double-click, retry
// jaringan, dua tab) sama-sama lolos pemeriksaan "status masih boleh dibatalkan", sama-sama
// menulis CANCELLED, lalu MASING-MASING mengembalikan stok. Stok menggelembung tanpa jejak.
//
// Jarak antara pemeriksaan dan penulisan itulah TOCTOU-nya, dan ia tak bisa ditutup di sisi
// aplikasi — hanya database yang bisa memutuskan siapa yang menang. Dengan `expectedFrom`, syarat
// status ikut masuk ke WHERE, sehingga hanya SATU dari dua permintaan yang benar-benar mengubah
// baris; yang kalah tidak mendapat baris apa pun kembali dan pemanggilnya berhenti sebelum
// menyentuh stok.
//
// Argumennya OPSIONAL dengan sengaja. Jalur OMS (update-status) dan sinkronisasi resi punya mesin
// status sendiri dan boleh menulis tanpa syarat; yang WAJIB memakainya adalah jalur yang diikuti
// efek samping tak bisa diulang — pembatalan, karena ia mengembalikan stok.
export async function updateOrderStatus(
  orderId: string,
  status: OrderFulfillmentStatus,
  logistics?: OrderLogisticsPatch,
  expectedFrom?: OrderFulfillmentStatus[],
): Promise<Order | null> {
  const supabase = createAdminClient()
  const patch: Record<string, string> = { order_status: STATUS_TO_DB[status] }
  if (logistics?.courier !== undefined) patch.nama_ekspedisi = logistics.courier
  if (logistics?.service !== undefined) patch.jenis_layanan = logistics.service
  if (logistics?.trackingNumber !== undefined) patch.no_tracking = logistics.trackingNumber

  let query = supabase.from('orders').update(patch).eq('nomor_invoice', orderId)
  if (expectedFrom && expectedFrom.length > 0) {
    query = query.in(
      'order_status',
      expectedFrom.map((s) => STATUS_TO_DB[s]),
    )
  }

  const { data, error } = await query.select('id').maybeSingle()

  if (error) {
    console.error('Gagal memperbarui status pesanan di Supabase:', error.message)
    return null
  }
  if (!data) return null

  return getOrderByOrderId(orderId)
}

// Memperbarui status PEMBAYARAN sebuah pesanan (dipakai webhook Xendit).
// Berbeda dari updateOrderStatus() yang mengurus status ALUR (fulfillment) — keduanya kolom
// terpisah di DB (`status_pembayaran` vs `order_status`) dan bisa bergerak tidak bersamaan.
//
// `orderStatus` opsional: webhook pembayaran memang ikut menggerakkan alur (lunas → Diproses,
// kedaluwarsa → Dibatalkan), tapi pemanggil lain boleh mengubah status bayar saja.
// `transactionId` hanya ditulis bila disertakan — jangan menimpa id transaksi yang sudah ada
// dengan nilai kosong.
//
// Mengembalikan order terbaru, atau null bila nomor invoice tak ditemukan.
export async function updatePaymentStatus(
  orderId: string,
  paymentStatus: OrderPaymentStatus,
  opts?: {
    orderStatus?: OrderFulfillmentStatus
    transactionId?: string
    // Metode/channel yang dipakai pembeli menurut callback Xendit → orders.metode_pembayaran.
    paymentMethod?: string
  },
): Promise<Order | null> {
  const supabase = createAdminClient()
  const patch: Record<string, string> = { status_pembayaran: PAYMENT_TO_DB[paymentStatus] }
  if (opts?.orderStatus) patch.order_status = STATUS_TO_DB[opts.orderStatus]
  if (opts?.transactionId) patch.id_transaksi = opts.transactionId
  // Hanya ditulis bila callback menyebutkannya. Callback EXPIRED/FAILED tak membawa metode apa pun
  // (tak ada yang pernah dibayar), dan urutan callback tak dijamin — menulis null akan menghapus
  // metode yang sudah tercatat dari callback sebelumnya.
  if (opts?.paymentMethod) patch.metode_pembayaran = opts.paymentMethod

  const attempt = (body: Record<string, string>) =>
    supabase.from('orders').update(body).eq('nomor_invoice', orderId).select('id').maybeSingle()

  let { data, error } = await attempt(patch)

  // Cadangan bila migration 20260828120000 belum di-apply. Migration dijalankan MANUAL lewat
  // Dashboard (CLI Supabase belum dipasang), jadi selalu ada jendela waktu kode-sudah/DB-belum.
  //
  // Tanpa cadangan ini satu kolom yang belum ada menggagalkan SELURUH update — termasuk
  // `status_pembayaran`. Webhook lalu membalas 500 dan pembeli yang SUDAH BAYAR tetap tercatat
  // Menunggu. Itu jauh lebih mahal daripada kehilangan catatan metode bayarnya.
  if (error && 'metode_pembayaran' in patch && isUnknownColumnError(error)) {
    console.warn(
      `Kolom metode_pembayaran belum di-migrate (${error.message}) — status disimpan tanpa metode bayar`,
    )
    delete patch.metode_pembayaran
    ;({ data, error } = await attempt(patch))
  }

  if (error) {
    console.error('Gagal memperbarui status pembayaran di Supabase:', error.message)
    return null
  }
  if (!data) return null

  return getOrderByOrderId(orderId)
}

// true bila galat ini berarti "kolomnya tidak ada".
//   PGRST204 — kolom tak ada di schema cache PostgREST (bentuk yang biasa muncul dari supabase-js)
//   42703    — undefined_column dari Postgres sendiri
function isUnknownColumnError(error: { code?: string; message?: string }): boolean {
  if (error.code === 'PGRST204' || error.code === '42703') return true
  const message = error.message ?? ''
  return /column/i.test(message) && /(does not exist|could not find)/i.test(message)
}

// Menyimpan id transaksi pembayaran (Xendit) TANPA menyentuh status pembayaran.
//
// Dipisah dari updatePaymentStatus karena urutannya berbeda: id transaksi terbit saat Virtual
// Account DIBUAT (pesanan masih Menunggu), sementara status baru berubah nanti ketika callback
// masuk. Memakai updatePaymentStatus di sini akan menulis ulang status_pembayaran dengan nilai
// yang belum tentu benar.
//
// true bila tersimpan; false bila nomor invoice tak ditemukan / gagal tulis.
export async function setOrderTransactionId(
  orderId: string,
  transactionId: string,
  // Tautan & masa berlaku tagihan. Opsional supaya pemanggil lama tetap bisa menyimpan id saja.
  invoice?: { url: string; expiresAt: string },
): Promise<boolean> {
  const supabase = createAdminClient()

  const patch: Record<string, string> = { id_transaksi: transactionId }
  if (invoice?.url) patch.invoice_url = invoice.url
  if (invoice?.expiresAt) patch.invoice_expires_at = invoice.expiresAt

  const attempt = (body: Record<string, string>) =>
    supabase.from('orders').update(body).eq('nomor_invoice', orderId).select('id').maybeSingle()

  let { data, error } = await attempt(patch)

  // Cadangan bila migration 20260908120000 belum di-apply. Migration dijalankan MANUAL lewat
  // Dashboard, jadi selalu ada jendela waktu kode-sudah/DB-belum.
  //
  // Tanpa cadangan ini, dua kolom yang belum ada menggagalkan SELURUH update — termasuk
  // `id_transaksi`, satu-satunya penghubung pesanan kita dengan objek pembayaran di dashboard
  // Xendit. Kehilangan pemakaian ulang tagihan jauh lebih murah daripada kehilangan jejak itu.
  if (error && 'invoice_url' in patch && isUnknownColumnError(error)) {
    console.warn(
      `Kolom invoice_url/invoice_expires_at belum di-migrate (${error.message}) — ` +
        'id transaksi disimpan tanpa tautan tagihan; pemakaian ulang tagihan TIDAK aktif',
    )
    delete patch.invoice_url
    delete patch.invoice_expires_at
    ;({ data, error } = await attempt(patch))
  }

  if (error) {
    console.error('Gagal menyimpan id transaksi di Supabase:', error.message)
    return false
  }
  return Boolean(data)
}

// === Hasil booking kurir (shipment) ===

// Menandai hasil booking kurir pada sebuah pesanan.
//
// `booked` memisahkan dua jalur yang efeknya sangat berbeda bagi admin:
//   - berhasil → resi + ekspedisi + layanan tersimpan, shipment_error DIKOSONGKAN (percobaan
//     sebelumnya yang gagal tak boleh terus tampil sebagai peringatan setelah berhasil).
//   - gagal    → shipment_status 'FAILED' + alasannya, dan resi TIDAK disentuh. Pembayaran sudah
//     masuk, jadi pesanannya tetap ada; yang ditandai adalah bahwa ia butuh tindakan manual.
//
// Status alur pesanan (`order_status`) TIDAK diubah di sini — itu wewenang updateOrderStatus.
// Booking berhasil tidak sama dengan barang sudah dikirim; kurir baru menjemput nanti.
//
// Ketiga identitas Mengantar OPSIONAL: booking yang berhasil tanpa salah satunya tetap disimpan,
// karena resinya sudah terbit dan paketnya tetap akan dijemput. Yang hilang hanya kemampuan
// membatalkan penjemputan TANPA pencarian balik dari resi.
export type ShipmentUpdate =
  | {
      booked: true
      trackingNumber: string
      courier: string
      service: string
      mengantarObjectId?: string // _id — dipakai DELETE /order
      mengantarOrderId?: string // ORDER_ID — alternatifnya
      mengantarBatchId?: string // batch_id — dipakai DELETE /batch
    }
  | { booked: false; error: string }

export async function updateShipment(
  orderId: string,
  update: ShipmentUpdate,
): Promise<Order | null> {
  const supabase = createAdminClient()
  const patch: Record<string, string | null> = {}

  if (update.booked) {
    patch.shipment_status = 'BOOKED'
    patch.shipment_error = null
    patch.shipment_booked_at = new Date().toISOString()
    patch.no_tracking = update.trackingNumber
    patch.nama_ekspedisi = update.courier
    patch.jenis_layanan = update.service
    // Identitas pembatalan Mengantar. Hanya ditulis bila ada — menulis null akan MENGHAPUS nilai
    // yang mungkin sudah diisi backfill, dan booking ulang atas pesanan yang sudah ber-resi memang
    // sudah dicegah di hulu (bookShipmentForPaidOrder), jadi tak ada alasan menimpanya dengan kosong.
    if (update.mengantarObjectId) patch.mengantar_order_object_id = update.mengantarObjectId
    if (update.mengantarOrderId) patch.mengantar_order_id = update.mengantarOrderId
    if (update.mengantarBatchId) patch.mengantar_batch_id = update.mengantarBatchId
  } else {
    patch.shipment_status = 'FAILED'
    // Dipotong agar satu respons pihak ketiga yang panjang tak membengkakkan baris pesanan.
    patch.shipment_error = update.error.slice(0, 500)
  }

  let { data, error } = await supabase
    .from('orders')
    .update(patch)
    .eq('nomor_invoice', orderId)
    .select('id')
    .maybeSingle()

  // Jaring pengaman bila kolom tambahan belum di-migrate: ulangi hanya dengan kolom inti supaya
  // resi tetap tersimpan (yang paling berguna bagi pembeli), bukan gagal total.
  // PGRST204 = kolom tak dikenal PostgREST; 42703 = kolom tak ada di Postgres.
  //
  // Dua rombongan kolom yang bisa belum ada, dan keduanya dibuang sekaligus karena PostgREST hanya
  // menyebut kolom PERTAMA yang tak dikenalnya — mencoba menebak rombongan mana yang bermasalah
  // berarti bisa dua kali gagal untuk satu booking:
  //   shipment_*      (status/error/booked_at)
  //   mengantar_*     (_id/ORDER_ID/batch_id — migration 20260909120000)
  if (error?.code === 'PGRST204' || error?.code === '42703') {
    console.error(
      `${'[orders]'} kolom shipment_*/mengantar_* belum di-migrate — status booking & identitas pembatalan ${orderId} tidak tercatat (${error.message})`,
    )
    const fallback = { ...patch }
    delete fallback.shipment_status
    delete fallback.shipment_error
    delete fallback.shipment_booked_at
    delete fallback.mengantar_order_object_id
    delete fallback.mengantar_order_id
    delete fallback.mengantar_batch_id
    if (Object.keys(fallback).length === 0) return getOrderByOrderId(orderId)
    ;({ data, error } = await supabase
      .from('orders')
      .update(fallback)
      .eq('nomor_invoice', orderId)
      .select('id')
      .maybeSingle())
  }

  if (error) {
    console.error('Gagal menyimpan hasil booking kurir:', error.message)
    return null
  }
  if (!data) return null

  return getOrderByOrderId(orderId)
}

// === Hasil pembatalan penjemputan ===

// Dipanggil SETELAH DELETE /order ke Mengantar, oleh alur pembatalan OMS.
//
// `cancelled: true` juga MENGOSONGKAN shipment_error: baris ini sudah selesai urusannya, dan pesan
// galat lama yang tertinggal akan membuat admin mengira masih ada yang perlu dikerjakan.
export type ShipmentCancellationUpdate =
  | { cancelled: true }
  | { cancelled: false; error: string }

export async function setShipmentCancellation(
  orderId: string,
  update: ShipmentCancellationUpdate,
): Promise<boolean> {
  const supabase = createAdminClient()
  const patch: Record<string, string | null> = update.cancelled
    ? { shipment_status: 'CANCELLED', shipment_error: null }
    : { shipment_status: 'CANCEL_FAILED', shipment_error: update.error.slice(0, 500) }

  const { data, error } = await supabase
    .from('orders')
    .update(patch)
    .eq('nomor_invoice', orderId)
    .select('id')
    .maybeSingle()

  if (error) {
    // 23514 = pelanggaran CHECK constraint → migration 20260909130000 belum dijalankan, sehingga
    // kolomnya masih hanya menerima BOOKED/FAILED. Dicetak sekeras mungkin karena akibatnya
    // TIDAK terlihat di UI: pembatalan pesanannya sendiri sudah berhasil, hanya jejak penghapusan
    // penjemputannya yang hilang — dan justru jejak itulah yang mencegah panggilan berulang.
    if (error.code === '23514') {
      console.error(
        `[orders] shipment_status "${patch.shipment_status}" DITOLAK constraint untuk ${orderId} — ` +
          'jalankan migration 20260909130000_shipment_status_cancelled.sql',
      )
    } else {
      console.error(`[orders] gagal menyimpan hasil pembatalan ${orderId}:`, error.message)
    }
    return false
  }
  return Boolean(data)
}

// === Pengembalian dana ===

// Menandai pesanan sebagai PERLU_REFUND. Dipanggil saat pesanan yang SUDAH LUNAS dibatalkan.
//
// ── Kenapa penandaan ini otomatis, bukan diserahkan ke admin ──
// Uang pembeli yang tertahan adalah keadaan yang paling mudah terlupakan: pesanannya tampak
// selesai (Dibatalkan), stoknya sudah rapi, penjemputannya sudah dihapus. Tak ada satu pun
// yang menyisakan pekerjaan terlihat, padahal ada. Mengandalkan admin mengingat sendiri berarti
// mengandalkan hal yang justru tak ada pengingatnya.
//
// TIDAK menimpa status yang sudah ada: pesanan yang sudah SUDAH_REFUND atau ditandai TIDAK_PERLU
// tak boleh kembali jadi PERLU_REFUND hanya karena pembatalannya diproses ulang.
export async function markRefundNeeded(orderId: string): Promise<boolean> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('orders')
    .update({ refund_status: 'PERLU_REFUND' })
    .eq('nomor_invoice', orderId)
    .is('refund_status', null)
    .select('id')
    .maybeSingle()

  if (error) {
    if (error.code === 'PGRST204' || error.code === '42703') {
      console.error(
        `[orders] kolom refund_* belum ada untuk ${orderId} — ` +
          'jalankan migration 20260910130000_orders_refund.sql',
      )
    } else {
      console.error(`[orders] gagal menandai perlu refund ${orderId}:`, error.message)
    }
    return false
  }
  // data null = tak ada baris tersentuh, yang di sini berarti statusnya SUDAH terisi. Itu keadaan
  // normal (pembatalan diproses ulang), bukan kegagalan.
  return Boolean(data)
}

// Pesanan yang menunggu pengembalian dana, terbaru dulu.
// Daftar kerja pengembalian dana.
//
// Memuat DUA keadaan, dan itu disengaja (SEC-049):
//   PERLU_REFUND    — belum dikirim; inilah yang punya tombol
//   SEDANG_DIPROSES — sudah dikirim ke Xendit, hasilnya belum dipastikan
//
// Versi pertama hanya memuat PERLU_REFUND. Akibatnya baris yang tertinggal di SEDANG_DIPROSES —
// karena callback-nya tak kunjung datang, atau karena permintaannya timeout sehingga klaimnya
// sengaja dipertahankan — menghilang dari SETIAP layar di OMS. Uang yang mungkin sudah keluar,
// pembeli yang menunggu, dan tak satu pun daftar yang menyebutkannya. Keadaan yang paling perlu
// dilihat orang justru menjadi yang paling tak terlihat.
//
// Menampilkannya di sini tak menambah wewenang apa pun: barisnya tetap tak bisa dikirim ulang
// (server menolak apa pun selain PERLU_REFUND). Yang berubah hanya satu — ia terlihat.
export async function readOrdersNeedingRefund(limit = 200): Promise<RefundWorkItem[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('orders')
    // `*` DIPERTAHANKAN dengan sengaja: sebagian kolom refund masih optional di skema (lihat
    // OrderRow), dan menyebut kolom yang belum ada membuat PostgREST menolak SELURUH query dengan
    // 42703. Penyempitannya dilakukan saat memetakan di bawah — yang menentukan kebocoran adalah
    // apa yang MENINGGALKAN server, bukan apa yang dibaca di dalamnya.
    .select('*')
    .in('refund_status', ['PERLU_REFUND', 'SEDANG_DIPROSES'])
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[orders] gagal membaca daftar perlu refund:', error.message)
    return []
  }

  // Item pesanan SENGAJA tidak ikut diambil. Yang dibutuhkan admin di daftar ini adalah siapa,
  // berapa, dibayar lewat apa, dan sejak kapan menunggu — bukan isi paketnya.
  return ((data as OrderRow[]) ?? []).map((r) => ({
    orderId: r.nomor_invoice,
    customerName: r.nama_customer,
    ...(r.no_telepon ? { customerPhone: r.no_telepon } : {}),
    ...(r.email ? { customerEmail: r.email } : {}),
    date: r.created_at,
    totalAmount: r.jumlah_total,
    ...(r.metode_pembayaran ? { paymentMethod: r.metode_pembayaran } : {}),
    ...(r.refund_status === 'PERLU_REFUND' || r.refund_status === 'SEDANG_DIPROSES'
      ? { refundStatus: r.refund_status }
      : {}),
    ...(r.refund_reference ? { refundReference: r.refund_reference } : {}),
    ...(r.refund_at ? { refundAt: r.refund_at } : {}),
    ...(r.refund_by ? { refundBy: r.refund_by } : {}),
  }))
}

// SEDANG_DIPROSES SENGAJA TIDAK ADA DI SINI (SEC-049). Keadaan itu hanya boleh ditulis oleh
// claimRefundForProcessing(), yang mewajibkan sebuah `reference`. Membiarkannya bisa ditulis lewat
// jalur ini berarti membuka kembali cara melahirkan baris "sedang diproses" tanpa nomor referensi —
// baris yang tak bisa dicocokkan callback mana pun, dan karenanya tak akan pernah tertutup.
export type RefundResolution =
  | { status: 'SUDAH_REFUND'; amount: number; note: string; by: string; reference?: string }
  | { status: 'TIDAK_PERLU'; note: string; by: string }

// Menutup satu baris daftar kerja refund.
//
// `by` dan `note` WAJIB untuk kedua cabang. Pengembalian dana jalur transfer bank dijalankan
// manusia di luar sistem ini, jadi satu-satunya bukti yang akan pernah ada adalah apa yang
// diketik di sini — nomor referensi transfer, atau alasan mengapa tak ada yang perlu dikembalikan.
export async function resolveRefund(
  orderId: string,
  resolution: RefundResolution,
): Promise<Order | null> {
  const supabase = createAdminClient()
  const patch: Record<string, string | number | null> = {
    refund_status: resolution.status,
    refund_note: resolution.note.slice(0, 1000),
    refund_at: new Date().toISOString(),
    refund_by: resolution.by.slice(0, 120),
    // TIDAK_PERLU tak memindahkan uang, jadi nominalnya dikosongkan alih-alih ditulis 0 — nol
    // berarti "dikembalikan, tapi habis dipotong biaya", makna yang sama sekali berbeda.
    refund_amount: resolution.status === 'TIDAK_PERLU' ? null : Math.round(resolution.amount),
    // Hanya terisi bila SISTEM yang mengembalikan (id refund/void Xendit). Pengembalian manual
    // meninggalkannya null — dan itu keadaan yang akan tetap umum, karena transfer bank tak bisa
    // dikembalikan lewat Xendit sama sekali.
    //
    // Pada SEDANG_DIPROSES nilainya JUSTRU paling penting: itulah satu-satunya cara mencocokkan
    // callback `refund.succeeded`/`refund.failed` yang datang belakangan dengan pesanan ini.
    refund_reference:
      resolution.status !== 'TIDAK_PERLU' && resolution.reference ? resolution.reference : null,
  }

  // Hanya baris yang BELUM selesai yang boleh ditutup. Ini compare-and-swap: dua admin yang
  // menekan tombol bersamaan tak boleh sama-sama berhasil, karena keduanya lalu mengira uangnya
  // sudah dikirim padahal hanya satu yang benar-benar mengirim.
  //
  // SEDANG_DIPROSES ikut boleh ditutup di sini, dan itu perlu: bila Xendit sudah menerima
  // permintaannya tapi hasilnya gagal tercatat (atau callback-nya tak pernah datang), penutupan
  // manual oleh admin yang sudah memeriksa dashboard adalah SATU-SATUNYA jalan keluar barisnya.
  // Menutup pintu itu akan membuat baris tersebut tertahan selamanya.
  const { data, error } = await supabase
    .from('orders')
    .update(patch)
    .eq('nomor_invoice', orderId)
    .in('refund_status', ['PERLU_REFUND', 'SEDANG_DIPROSES'])
    .select('id')
    .maybeSingle()

  if (error) {
    console.error(`[orders] gagal menutup refund ${orderId}:`, error.message)
    return null
  }
  if (!data) return null
  return getOrderByOrderId(orderId)
}

// === Klaim pengembalian dana SEBELUM uang dikirim (SEC-045) ===

// Menandai satu baris sebagai SEDANG DIKERJAKAN, atomik, sebelum Xendit dipanggil.
//
// Kenapa ada: memeriksa `refundStatus` dari hasil query lalu memanggil Xendit adalah pola
// baca-lalu-bertindak. Di antara keduanya ada jeda jaringan, dan dua permintaan kembar — dua tab,
// dua admin, satu curl yang diulang — bisa sama-sama lolos pemeriksaan itu lalu sama-sama
// mengirim uang. Uang yang terkirim dua kali tak bisa ditarik kembali.
//
// `WHERE refund_status = 'PERLU_REFUND'` dijalankan DATABASE, jadi berapa pun permintaan yang tiba
// bersamaan, hanya satu yang memenangkannya. Yang kalah berhenti tanpa pernah menyentuh Xendit.
// Pola yang sama dengan CAS pembatalan pesanan (SEC-020) — bedanya, yang dilindungi di sini bukan
// stok yang bisa dikoreksi, melainkan transfer keluar yang permanen.
//
// `reference` diisi kunci idempotency milik KITA, bukan nomor dari Xendit: nomor itu belum ada
// pada titik ini, dan baris SEDANG_DIPROSES tanpa referensi apa pun tak bisa ditelusuri ke
// percobaan mana pun. Nomor asli Xendit menimpanya di finalizeClaimedRefund.
export async function claimRefundForProcessing(
  orderId: string,
  claim: { reference: string; by: string; amount: number; note: string },
): Promise<boolean> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('orders')
    .update({
      refund_status: 'SEDANG_DIPROSES',
      refund_reference: claim.reference,
      refund_by: claim.by.slice(0, 120),
      refund_amount: Math.round(claim.amount),
      refund_at: new Date().toISOString(),
      refund_note: claim.note.slice(0, 1000),
    })
    .eq('nomor_invoice', orderId)
    .eq('refund_status', 'PERLU_REFUND')
    .select('id')
    .maybeSingle()

  if (error) {
    console.error(`[orders] gagal mengklaim refund ${orderId}:`, error.message)
    return false
  }
  return Boolean(data)
}

// Menutup klaim yang uangnya SUDAH dikirim.
//
// Dikunci pada `refund_reference` klaimnya, bukan hanya pada nomor invoice: bila baris itu sudah
// disentuh proses lain (mis. callback yang tiba lebih cepat daripada respons HTTP-nya), penulisan
// ini harus KALAH, bukan menimpa hasil yang lebih baru.
export async function finalizeClaimedRefund(
  orderId: string,
  claimReference: string,
  hasil: { status: 'SUDAH_REFUND' | 'SEDANG_DIPROSES'; note: string; reference?: string },
): Promise<Order | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('orders')
    .update({
      refund_status: hasil.status,
      refund_note: hasil.note.slice(0, 1000),
      refund_at: new Date().toISOString(),
      // Nomor dari Xendit menggantikan kunci klaim kita — itulah yang dicocokkan callback
      // refund.succeeded/refund.failed nanti. Bila Xendit tak memberi nomor, kunci klaim
      // DIPERTAHANKAN: apa pun lebih baik daripada null, yang membuat barisnya tak bisa dicocokkan
      // oleh siapa pun (SEC-049).
      refund_reference: hasil.reference || claimReference,
    })
    .eq('nomor_invoice', orderId)
    .eq('refund_reference', claimReference)
    .eq('refund_status', 'SEDANG_DIPROSES')
    .select('id')
    .maybeSingle()

  if (error) {
    console.error(`[orders] gagal menutup klaim refund ${orderId}:`, error.message)
    return null
  }
  if (!data) return null
  return getOrderByOrderId(orderId)
}

// Melepas klaim yang ternyata TAK JADI mengirim uang, mengembalikan barisnya menjadi pekerjaan.
//
// ⚠️ HANYA untuk penolakan yang PASTI — Xendit menjawab dengan kode error yang jelas, jadi kita
// tahu tak ada uang yang keluar. Timeout dan respons tak terbaca TIDAK BOLEH dilepas: pada kedua
// kasus itu permintaannya bisa saja sampai dan diproses setelah kita berhenti menunggu. Melepasnya
// berarti mengundang pengiriman kedua untuk uang yang mungkin sudah keluar — persis kerusakan yang
// klaim ini dibangun untuk mencegah.
export async function releaseRefundClaim(
  orderId: string,
  claimReference: string,
  alasan: string,
): Promise<boolean> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('orders')
    .update({
      refund_status: 'PERLU_REFUND',
      refund_reference: null,
      refund_at: null,
      refund_by: null,
      refund_amount: null,
      refund_note: `Percobaan pengembalian ditolak Xendit: ${alasan}`.slice(0, 1000),
    })
    .eq('nomor_invoice', orderId)
    .eq('refund_reference', claimReference)
    .eq('refund_status', 'SEDANG_DIPROSES')

  if (error) {
    console.error(`[orders] gagal melepas klaim refund ${orderId}:`, error.message)
    return false
  }
  return true
}

// Menyelesaikan pengembalian dana yang tadinya SEDANG_DIPROSES, berdasarkan callback Xendit.
//
// Pencocokannya lewat `refund_reference` — nomor yang Xendit berikan saat pengembalian dimulai dan
// yang ia sebut kembali di callback-nya. Bukan lewat nomor invoice: callback refund TIDAK memuat
// `external_id` kita, jadi nomor inilah satu-satunya benang penghubungnya.
//
// `berhasil: false` mengembalikan barisnya ke PERLU_REFUND, bukan menandainya gagal permanen —
// dananya memang belum kembali ke pembeli, jadi ia harus MUNCUL LAGI sebagai pekerjaan. Alasannya
// ditambahkan ke catatan supaya admin tahu percobaan sebelumnya sudah pernah dilakukan.
export async function settleRefundByReference(
  reference: string,
  berhasil: boolean,
  detail: string,
): Promise<{ orderId: string } | null> {
  const supabase = createAdminClient()

  const { data: rows, error: readError } = await supabase
    .from('orders')
    .select('nomor_invoice, refund_note')
    .eq('refund_reference', reference)
    .eq('refund_status', 'SEDANG_DIPROSES')
    .limit(1)

  if (readError) {
    console.error(`[orders] gagal mencari refund ref ${reference}:`, readError.message)
    return null
  }
  const row = (rows as { nomor_invoice: string; refund_note: string | null }[] | null)?.[0]
  // Tak ketemu = callback untuk pengembalian yang bukan milik kita, ATAU sudah diselesaikan
  // callback kembar sebelumnya. Keduanya bukan kesalahan — Xendit mengulang kirim callback.
  if (!row) return null

  const catatanLama = row.refund_note ?? ''
  const patch: Record<string, string | null> = berhasil
    ? {
        refund_status: 'SUDAH_REFUND',
        refund_at: new Date().toISOString(),
        refund_note: `${catatanLama} — dikonfirmasi Xendit: ${detail}`.trim().slice(0, 1000),
      }
    : {
        refund_status: 'PERLU_REFUND',
        // Waktu & pelaku dikosongkan: tak ada pengembalian yang benar-benar terjadi, dan
        // meninggalkannya akan membuat baris ini terbaca seolah pernah selesai.
        refund_at: null,
        refund_by: null,
        refund_amount: null,
        refund_reference: null,
        refund_note: `${catatanLama} — GAGAL menurut Xendit: ${detail}. Perlu diulang.`
          .trim()
          .slice(0, 1000),
      }

  const { error } = await supabase
    .from('orders')
    .update(patch)
    .eq('nomor_invoice', row.nomor_invoice)
    .eq('refund_status', 'SEDANG_DIPROSES')

  if (error) {
    console.error(`[orders] gagal menutup refund ${row.nomor_invoice}:`, error.message)
    return null
  }
  return { orderId: row.nomor_invoice }
}

// === Hasil mematikan tagihan Xendit ===

// Dipanggil SETELAH POST /invoices/{id}/expire, oleh alur pembatalan pesanan.
//
// `expired: true` juga MENGOSONGKAN invoice_expire_error: percobaan sebelumnya yang gagal sudah
// tak relevan begitu tagihannya benar-benar mati, dan pesan lama yang tertinggal akan membuat
// admin mengejar sesuatu yang sudah beres.
export type InvoiceExpiryUpdate = { expired: true } | { expired: false; error: string }

export async function setInvoiceExpiry(
  orderId: string,
  update: InvoiceExpiryUpdate,
): Promise<boolean> {
  const supabase = createAdminClient()
  const patch: Record<string, string | null> = update.expired
    ? { invoice_expired_at: new Date().toISOString(), invoice_expire_error: null }
    : { invoice_expire_error: update.error.slice(0, 500) }

  const { data, error } = await supabase
    .from('orders')
    .update(patch)
    .eq('nomor_invoice', orderId)
    .select('id')
    .maybeSingle()

  if (error) {
    // PGRST204/42703 = migration 20260910120000 belum dijalankan. Dicetak dengan nama filenya
    // karena akibatnya TIDAK terlihat di UI: pembatalan pesanannya sendiri tetap berhasil, hanya
    // jejak tagihannya yang hilang — dan justru jejak itu yang menjadi daftar kerja admin.
    if (error.code === 'PGRST204' || error.code === '42703') {
      console.error(
        `[orders] kolom invoice_expire* belum ada untuk ${orderId} — ` +
          'jalankan migration 20260910120000_orders_invoice_expire.sql',
      )
    } else {
      console.error(`[orders] gagal menyimpan hasil mematikan tagihan ${orderId}:`, error.message)
    }
    return false
  }
  return Boolean(data)
}

// === Pemulihan identitas Mengantar (backfill) ===
//
// Pesanan yang dibooking SEBELUM migration 20260909120000 hanya menyimpan nomor resi, sementara
// pembatalan penjemputan menuntut `_id`/`ORDER_ID`. Kedua fungsi di bawah dipakai endpoint backfill
// untuk mengisinya kembali dari resi. Setelah semua pesanan lama terisi, keduanya tak terpakai lagi
// — tapi TIDAK dihapus: booking yang responsnya tak memuat identitas (lihat peringatan di
// mengantar-shipment.ts) tetap butuh jalur pemulihan ini.

export type OrderMissingMengantarIds = { orderId: string; trackingNumber: string }

// Pesanan yang PUNYA resi tapi BELUM punya `_id` Mengantar.
//
// Yang diperiksa hanya `mengantar_order_object_id`: itulah nilai yang dipakai DELETE /order.
// Baris yang punya ORDER_ID tapi tak punya _id tetap dianggap perlu dilengkapi — memakai
// `orderIds` sebagai jalur utama berarti bergantung pada cabang API yang belum pernah kita buktikan.
export async function readOrdersMissingMengantarIds(
  limit = 100,
): Promise<OrderMissingMengantarIds[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('orders')
    .select('nomor_invoice, no_tracking')
    .not('no_tracking', 'is', null)
    .is('mengantar_order_object_id', null)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) {
    console.error('[orders] gagal membaca pesanan tanpa identitas Mengantar:', error.message)
    return []
  }

  return ((data as Pick<OrderRow, 'nomor_invoice' | 'no_tracking'>[]) ?? [])
    .filter((row) => Boolean(row.no_tracking?.trim()))
    .map((row) => ({ orderId: row.nomor_invoice, trackingNumber: row.no_tracking!.trim() }))
}

export type MengantarIds = {
  mengantarObjectId?: string
  mengantarOrderId?: string
  mengantarBatchId?: string
}

// Menulis identitas Mengantar pada satu pesanan. true bila ada baris yang tersentuh.
//
// Field kosong DILEWATI, bukan ditulis null: respons Mengantar bisa memuat sebagian saja, dan
// menimpa nilai yang sudah benar dengan null akan membuat backfill kedua justru MERUSAK hasil
// backfill pertama. Tak ada satu pun field terisi → tak ada UPDATE sama sekali.
export async function setMengantarIds(orderId: string, ids: MengantarIds): Promise<boolean> {
  const patch: Record<string, string> = {}
  if (ids.mengantarObjectId) patch.mengantar_order_object_id = ids.mengantarObjectId
  if (ids.mengantarOrderId) patch.mengantar_order_id = ids.mengantarOrderId
  if (ids.mengantarBatchId) patch.mengantar_batch_id = ids.mengantarBatchId
  if (Object.keys(patch).length === 0) return false

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('orders')
    .update(patch)
    .eq('nomor_invoice', orderId)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error(`[orders] gagal menyimpan identitas Mengantar ${orderId}:`, error.message)
    return false
  }
  return Boolean(data)
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
