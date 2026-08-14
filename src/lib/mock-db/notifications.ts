// src/lib/mock-db/notifications.ts
// Notifikasi OMS — DIHITUNG dari keadaan terkini (orders + stok), BUKAN dari tabel notifikasi.
//
// Kenapa computed, bukan tabel persisten:
//   1. Nol titik tulis baru. Tabel persisten harus diisi di SETIAP tempat yang mengubah stok
//      (RPC checkout, /warehouses/stock/set, tiga jalur pembatalan, form produk) — kewajiban
//      fan-out yang sama seperti stock-audit.ts, dan satu titik yang lupa = notifikasi bohong.
//   2. Data lama langsung terlihat. Tabel baru mulai dari kosong; pesanan & produk yang sudah ada
//      tak akan pernah memunculkan notifikasi.
//   3. Tak bisa basi. "Stok habis" itu KEADAAN, bukan peristiwa: baris tersimpan akan tetap
//      berteriak "habis" setelah produknya di-restock.
// Konsekuensi yang diterima: status "sudah dibaca" tak bisa per-notifikasi. Yang disimpan hanya
// SATU timestamp per admin (store_settings, lihat getNotifLastSeen) — notifikasi lebih baru dari
// timestamp itu = belum dibaca.
//
// SERVER-ONLY: memakai createAdminClient() (service_role). Jangan diimpor dari komponen 'use client'.

import { createAdminClient } from '@/lib/supabase/server'
import { readProducts } from '@/lib/mock-db/products'

export type NotificationType = 'pesanan_baru' | 'stok_habis'

export type OmsNotification = {
  // id stabil lintas request (`order:<invoice>` / `stock:<productId>`) supaya React punya key
  // yang tidak berubah tiap polling.
  id: string
  type: NotificationType
  title: string
  message: string
  // Tujuan navigasi saat notifikasi diklik
  href: string
  // ISO. null = waktunya tak diketahui (produk habis tanpa jejak di stock_mutations)
  createdAt: string | null
  unread: boolean
}

export type NotificationPage = {
  items: OmsNotification[]
  total: number
  unreadCount: number
}

// Batas pengambilan per sumber. Bukan paginasi — hanya pagar agar backlog besar tak menarik
// ribuan baris ke memori hanya untuk ditampilkan 10 teratas. Ambang naikkan bila pesanan
// menunggu proses rutin melewati angka ini.
const SOURCE_LIMIT = 200

// Status pesanan yang dianggap "butuh perhatian admin". order_status NULL (18 baris warisan)
// sengaja TIDAK ikut: .in() memang tak pernah cocok dengan NULL, dan baris itu tak punya status
// yang bisa dipercaya sehingga memunculkannya sebagai "pesanan baru" akan menyesatkan.
const PENDING_DB_STATUSES = ['PENDING', 'PROCESSING'] as const

type PendingOrderRow = {
  nomor_invoice: string | null
  nama_customer: string | null
  jumlah_total: number | null
  order_status: string | null
  created_at: string
}

// Rupiah tanpa Intl: fungsi ini jalan di server dan hasilnya masuk ke pesan notifikasi,
// jadi tak boleh bergantung pada locale mesin yang menjalankannya.
function rupiah(value: number): string {
  return `Rp${Math.round(value).toLocaleString('id-ID')}`
}

// === Sumber 1: pesanan yang menunggu diproses ===

async function buildOrderNotifications(): Promise<OmsNotification[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('orders')
    .select('nomor_invoice, nama_customer, jumlah_total, order_status, created_at')
    .in('order_status', PENDING_DB_STATUSES)
    .order('created_at', { ascending: false })
    .limit(SOURCE_LIMIT)

  if (error) {
    console.error('Gagal membaca notifikasi pesanan:', error.message)
    return []
  }

  return ((data as PendingOrderRow[]) ?? []).map((row) => {
    const invoice = row.nomor_invoice ?? '(tanpa invoice)'
    const customer = row.nama_customer?.trim() || 'Pembeli'
    const total = rupiah(row.jumlah_total ?? 0)
    // Halaman Pesanan tidak punya pencarian per-invoice, jadi tautan mengarah ke daftar yang
    // sudah tersaring ke status pesanan tersebut — itu tempat terdekat yang benar-benar ada.
    const statusLabel = row.order_status === 'PROCESSING' ? 'Diproses' : 'Menunggu Pembayaran'
    return {
      id: `order:${invoice}`,
      type: 'pesanan_baru' as const,
      title: `Pesanan baru ${invoice}`,
      message: `dari ${customer} — ${total}`,
      href: `/oms/dashboard/orders?status=${encodeURIComponent(statusLabel)}`,
      createdAt: row.created_at,
      unread: false, // diisi pemanggil setelah lastSeen diketahui
    }
  })
}

// === Sumber 2: produk yang stoknya habis ===

// Kapan tiap produk terakhir menyentuh stok 0, dibaca dari riwayat mutasi. Dipakai sebagai
// timestamp notifikasi "stok habis" — tabel products tidak punya kolom updated_at, jadi tanpa ini
// notifikasi stok tak punya waktu sama sekali dan tak bisa diurutkan bersama pesanan.
async function readStockOutTimestamps(): Promise<Record<string, string>> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('stock_mutations')
    .select('product_id, created_at')
    .eq('stok_after', 0)
    .order('created_at', { ascending: false })
    .limit(SOURCE_LIMIT)

  const out: Record<string, string> = {}
  // Tabel belum di-migrate (PGRST205) atau gangguan lain → notifikasi stok tetap tampil,
  // hanya tanpa waktu. Riwayat yang hilang tak boleh menyembunyikan produk yang habis.
  if (error || !data) return out

  for (const row of data as { product_id: string | null; created_at: string }[]) {
    // Sudah urut terbaru dulu → entri pertama per produk adalah yang paling akhir.
    if (row.product_id && !out[row.product_id]) out[row.product_id] = row.created_at
  }
  return out
}

async function buildStockNotifications(): Promise<OmsNotification[]> {
  // readProducts() sudah menimpa `stock` dengan stok efektif seluruh gudang, jadi angka di sini
  // sama persis dengan yang dilihat pembeli dan yang dipakai halaman Produk.
  const [products, stockOutAt] = await Promise.all([readProducts(), readStockOutTimestamps()])

  return products
    .filter((p) => !p.archived && p.stock === 0)
    .map((p) => ({
      id: `stock:${p.id}`,
      type: 'stok_habis' as const,
      title: `${p.name} kehabisan stok`,
      message: `SKU ${p.sku} — stok 0 di seluruh gudang`,
      href: '/oms/dashboard/products?stok=habis',
      createdAt: stockOutAt[p.id] ?? null,
      unread: false,
    }))
}

// === Gabungan ===

// Mengurutkan terbaru dulu. Notifikasi tanpa waktu (produk habis tanpa jejak mutasi) ditaruh
// paling akhir — bukan dianggap paling lama, tapi memang tak bisa diurutkan.
function sortNewestFirst(a: OmsNotification, b: OmsNotification): number {
  if (!a.createdAt && !b.createdAt) return 0
  if (!a.createdAt) return 1
  if (!b.createdAt) return -1
  return b.createdAt.localeCompare(a.createdAt)
}

// Daftar notifikasi OMS terurut terbaru dulu, sudah dipotong sesuai limit/offset.
// `lastSeen` null (admin belum pernah membuka panel) → SEMUA dianggap belum dibaca.
export async function getOmsNotifications(options: {
  lastSeen: string | null
  limit?: number
  offset?: number
}): Promise<NotificationPage> {
  const { lastSeen, limit = 10, offset = 0 } = options

  const [orders, stock] = await Promise.all([buildOrderNotifications(), buildStockNotifications()])

  const all = [...orders, ...stock]
    .map((n) => ({
      ...n,
      // Notifikasi tanpa waktu dihitung belum dibaca HANYA sebelum admin pernah membuka panel.
      // Kalau selamanya dianggap belum dibaca, lencana merahnya tak akan pernah bisa hilang dan
      // admin berhenti mempercayainya.
      unread: lastSeen === null ? true : n.createdAt !== null && n.createdAt > lastSeen,
    }))
    .sort(sortNewestFirst)

  return {
    items: all.slice(offset, offset + limit),
    total: all.length,
    unreadCount: all.filter((n) => n.unread).length,
  }
}
