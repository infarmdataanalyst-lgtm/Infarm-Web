// src/lib/mock-db/notifications.ts
// Notifikasi OMS — DIHITUNG dari keadaan terkini (orders + stok + ulasan), BUKAN dari tabel
// notifikasi.
//
// HANYA PERINGATAN (keputusan pemilik 23 Sep 2026). Pesanan baru yang masuk normal TIDAK lagi
// menjadi notifikasi: ia sudah punya tempatnya di daftar Pesanan dan widget "Pesanan Terbaru" di
// dashboard, dan kalau kabar normal ikut berbunyi, admin belajar mengabaikan lonceng — termasuk
// saat isinya penjemputan kurir yang gagal dihapus. Yang tersisa di sini semuanya berarti ADA
// YANG HARUS DITINDAK: pesanan bermasalah (uang/kurir), stok habis, ulasan yang belum ditanggapi.
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
import { readOrderIssues } from '@/lib/mock-db/order-issues'
import { ORDER_ISSUE_META } from '@/lib/order-issues'
import { readPromotions } from '@/lib/mock-db/promotions'
import { readStockRows, readWarehouses } from '@/lib/mock-db/warehouses'
import { isMultiWarehouse } from '@/lib/warehouse'
import { isPromotionExpired, isPromotionScheduled } from '@/types/promotion'

export type NotificationType = 'stok_habis' | 'ulasan_baru' | 'pesanan_bermasalah' | 'stok_hadiah'

export type OmsNotification = {
  // id stabil lintas request (`issue:<jenis>:<invoice>` / `stock:<productId>` / `review:<id>`)
  // supaya React punya key yang tidak berubah tiap polling.
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
// ribuan baris ke memori hanya untuk ditampilkan 10 teratas.
const SOURCE_LIMIT = 200

// Rupiah tanpa Intl: fungsi ini jalan di server dan hasilnya masuk ke pesan notifikasi,
// jadi tak boleh bergantung pada locale mesin yang menjalankannya.
function rupiah(value: number): string {
  return `Rp${Math.round(value).toLocaleString('id-ID')}`
}

// Sumber "pesanan baru yang menunggu diproses" DIHAPUS 23 Sep 2026 (lihat catatan di atas).
// Jangan dihidupkan lagi tanpa keputusan pemilik: satu-satunya fungsinya adalah mengubur
// peringatan yang benar-benar penting di bawah kabar rutin.

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

// === Sumber 3: ulasan yang belum ditanggapi admin (menutup SEC-042) ===
//
// Ulasan TAYANG SEKETIKA: kolom reviews.visible berdefault true dan createReview sengaja tidak
// mengirim kolom itu, jadi setiap ulasan yang lolos verifikasi kepemilikan langsung terlihat di
// halaman produk tanpa persetujuan siapa pun. Untuk toko sebesar ini, "terbitkan dulu, moderasi
// belakangan" adalah pilihan yang wajar — ASALKAN disengaja. Yang benar-benar kurang bukan
// mekanisme persetujuannya, melainkan cara admin MENGETAHUI ada ulasan baru yang perlu dilihat:
// sebelum ini tak ada antrean, tak ada pemberitahuan, tak ada apa pun. Konten tidak pantas bisa
// tayang berhari-hari sampai kebetulan ada yang membuka halaman Ulasan di OMS.
//
// Yang dianggap "butuh perhatian" adalah ulasan yang MASIH TAYANG dan BELUM DIBALAS admin. Dua
// syarat itu dipilih supaya notifikasinya ikut aturan main berkas ini: notifikasi di sini adalah
// KEADAAN, bukan peristiwa, jadi ia harus bisa hilang sendiri ketika admin menanganinya. Membalas
// ulasan ATAU menyembunyikannya sama-sama membuat notifikasinya lenyap — dua-duanya bentuk
// "sudah ditangani". Kalau syaratnya sekadar "ulasan ada", lencananya tak akan pernah bisa nol.
type PendingReviewRow = {
  id: string
  author_name: string | null
  rating: number | null
  comment: string | null
  created_at: string
  products: { name: string | null } | null
}

// Potong komentar untuk pratinjau di panel notifikasi — panel ini sempit, dan komentar boleh
// sampai REVIEW_COMMENT_MAX karakter.
function previewComment(comment: string | null): string {
  const text = (comment ?? '').trim().replace(/\s+/g, ' ')
  if (!text) return 'tanpa komentar'
  return text.length > 80 ? `${text.slice(0, 80)}…` : text
}

async function buildReviewNotifications(): Promise<OmsNotification[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('reviews')
    .select('id, author_name, rating, comment, created_at, products!reviews_product_id_fkey(name)')
    .eq('visible', true)
    .is('reply', null)
    .order('created_at', { ascending: false })
    .limit(SOURCE_LIMIT)

  if (error) {
    console.error('Gagal membaca notifikasi ulasan:', error.message)
    return []
  }

  return ((data as unknown as PendingReviewRow[]) ?? []).map((row) => {
    const product = row.products?.name?.trim() || '(produk dihapus)'
    const author = row.author_name?.trim() || 'Pembeli'
    const stars = '★'.repeat(Math.max(0, Math.min(5, row.rating ?? 0)))
    return {
      id: `review:${row.id}`,
      type: 'ulasan_baru' as const,
      title: `Ulasan baru ${stars} untuk ${product}`,
      message: `dari ${author} — ${previewComment(row.comment)}`,
      href: '/oms/dashboard/reviews',
      createdAt: row.created_at,
      unread: false, // diisi pemanggil setelah lastSeen diketahui
    }
  })
}

// === Sumber 4: pesanan yang perlu tindakan manusia (lihat src/lib/order-issues.ts) ===
//
// Berbeda dari tiga sumber di atas yang bersifat "ada pekerjaan rutin", ini adalah KEGAGALAN yang
// tercatat di kolom pesanan tapi sampai 23 Sep 2026 tak pernah dikumpulkan di mana pun: penjemputan
// kurir yang gagal dihapus (MGT-66), booking yang gagal setelah bayar, tagihan batal yang masih
// hidup, refund yang tertunda. Semuanya menyangkut uang atau kurir, dan semuanya sunyi.
//
// Ikut aturan berkas ini: KEADAAN, bukan peristiwa — lenyap sendiri begitu kolomnya berubah.
async function buildIssueNotifications(): Promise<OmsNotification[]> {
  const issues = await readOrderIssues()
  return issues.map((it) => {
    const meta = ORDER_ISSUE_META[it.kind]
    return {
      id: `issue:${it.kind}:${it.invoice}`,
      type: 'pesanan_bermasalah' as const,
      title: `${meta.label}: ${it.invoice}`,
      message: `${it.customer} — ${rupiah(it.total)}`,
      href: meta.href,
      createdAt: it.since,
      unread: false, // diisi pemanggil setelah lastSeen diketahui
    }
  })
}

// === Sumber 5: stok hadiah promo habis di salah satu gudang ===
//
// Pesanan dikirim dari SATU gudang, dan hadiah promo ikut menentukan gudangnya (keputusan pemilik
// 25 Sep 2026). Gudang yang tak punya stok hadiah tak bisa dipilih untuk pesanan yang mendapat
// hadiah: ongkir pembeli bisa naik (dikirim dari gudang lain), atau — bila tak ada gudang yang
// punya barang pesanan sekaligus hadiahnya — hadiahnya dilewati. Peringatan ini supaya admin
// mengisi stok hadiah di SETIAP gudang aktif selama promo berjalan.
//
// Hanya mode multi-gudang, hanya promo hadiah yang aktif & belum kedaluwarsa (termasuk yang
// terjadwal — lebih baik diisi sebelum promonya mulai). Ikut aturan berkas ini: KEADAAN, bukan
// peristiwa — lenyap sendiri begitu stoknya diisi atau promonya berakhir.
async function buildGiftStockNotifications(): Promise<OmsNotification[]> {
  if (!(await isMultiWarehouse())) return []

  const nowMs = Date.now()
  const [promotions, warehouses] = await Promise.all([readPromotions(), readWarehouses(true)])
  const running = promotions.filter(
    (p) =>
      p.type === 'free_product' &&
      p.isActive &&
      p.freeProductId &&
      !isPromotionExpired(p.endAt, nowMs),
  )
  if (running.length === 0 || warehouses.length === 0) return []

  const giftIds = [...new Set(running.map((p) => p.freeProductId as string))]
  const rows = await readStockRows({ productIds: giftIds })
  // Tak ada satu baris stok pun → tabel belum ada / gangguan baca / hadiah belum pernah distok di
  // gudang mana pun. Kasus terakhir sudah ditangkap notifikasi "stok habis" (stok 0 seluruh
  // gudang); membunyikan N peringatan per gudang di atas itu hanya menambah bising.
  if (rows.length === 0) return []

  const stockAt = new Map<string, number>()
  for (const row of rows) {
    if (row.variantId) continue // hadiah promo tak mengenal varian
    stockAt.set(`${row.productId}::${row.warehouseId}`, row.stok)
  }

  // Kapan stok hadiah di gudang itu terakhir menyentuh 0 — waktu notifikasi (lihat
  // readStockOutTimestamps untuk alasan yang sama).
  const supabase = createAdminClient()
  const { data: mutations } = await supabase
    .from('stock_mutations')
    .select('product_id, warehouse_id, created_at')
    .in('product_id', giftIds)
    .eq('stok_after', 0)
    .order('created_at', { ascending: false })
    .limit(SOURCE_LIMIT)
  const habisSejak = new Map<string, string>()
  for (const m of (mutations ?? []) as {
    product_id: string | null
    warehouse_id: string | null
    created_at: string
  }[]) {
    const key = `${m.product_id}::${m.warehouse_id}`
    if (!habisSejak.has(key)) habisSejak.set(key, m.created_at)
  }

  const out: OmsNotification[] = []
  for (const promo of running) {
    const giftId = promo.freeProductId as string
    const giftName = promo.freeProductName ?? 'Produk hadiah'
    const terjadwal = isPromotionScheduled(promo.startAt, nowMs)
    for (const w of warehouses) {
      const key = `${giftId}::${w.id}`
      if ((stockAt.get(key) ?? 0) > 0) continue
      out.push({
        id: `gift:${promo.id}:${w.id}`,
        type: 'stok_hadiah' as const,
        title: `Stok hadiah promo habis di ${w.nama}`,
        message: `${giftName} — promo "${promo.name}"${terjadwal ? ' (terjadwal)' : ''}`,
        href: '/oms/dashboard/gudang/stok',
        createdAt: habisSejak.get(key) ?? null,
        unread: false, // diisi pemanggil setelah lastSeen diketahui
      })
    }
  }
  return out
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

// Pesanan bermasalah SELALU di atas, baru sisanya terbaru dulu.
//
// Sejak kotak "Perlu tindakan" di dashboard dicabut (keputusan pemilik 23 Sep 2026), lonceng
// adalah SATU-SATUNYA tempat kegagalan uang/kurir terlihat. Panelnya hanya memuat 10 baris; kalau
// diurutkan murni menurut waktu, tiga pesanan baru sudah cukup untuk mendorong "penjemputan kurir
// belum dihapus" keluar dari pandangan — persis kesunyian yang ingin ditutup.
function sortIssuesFirst(a: OmsNotification, b: OmsNotification): number {
  const ia = a.type === 'pesanan_bermasalah' ? 0 : 1
  const ib = b.type === 'pesanan_bermasalah' ? 0 : 1
  if (ia !== ib) return ia - ib
  return sortNewestFirst(a, b)
}

// Daftar notifikasi OMS terurut terbaru dulu, sudah dipotong sesuai limit/offset.
// `lastSeen` null (admin belum pernah membuka panel) → SEMUA dianggap belum dibaca.
export async function getOmsNotifications(options: {
  lastSeen: string | null
  limit?: number
  offset?: number
}): Promise<NotificationPage> {
  const { lastSeen, limit = 10, offset = 0 } = options

  const [stock, reviews, issues, giftStock] = await Promise.all([
    buildStockNotifications(),
    buildReviewNotifications(),
    buildIssueNotifications(),
    buildGiftStockNotifications(),
  ])

  const all = [...stock, ...reviews, ...issues, ...giftStock]
    .map((n) => ({
      ...n,
      // Notifikasi tanpa waktu dihitung belum dibaca HANYA sebelum admin pernah membuka panel.
      // Kalau selamanya dianggap belum dibaca, lencana merahnya tak akan pernah bisa hilang dan
      // admin berhenti mempercayainya.
      unread: lastSeen === null ? true : n.createdAt !== null && n.createdAt > lastSeen,
    }))
    .sort(sortIssuesFirst)

  return {
    items: all.slice(offset, offset + limit),
    total: all.length,
    unreadCount: all.filter((n) => n.unread).length,
  }
}
