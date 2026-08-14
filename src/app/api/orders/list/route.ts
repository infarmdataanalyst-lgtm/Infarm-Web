// src/app/api/orders/list/route.ts
// API membaca pesanan dari mock database dengan support filter & sorting server-side.
// Dipanggil GET dari Dashboard OMS untuk mengisi tabel pesanan admin.
// Query params: dari, sampai, kurir, pembayaran, status, gudang, sortBy, order
//
// SEMUA penyaringan dilakukan di query Supabase (bukan fetch-all-lalu-filter-di-client) supaya
// tetap efisien saat jumlah pesanan membesar.

import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/oms-guard'
import {
  readOrders,
  readOrdersFiltered,
  getDistinctCouriers,
  WAREHOUSE_FILTER_NONE,
  type OrderFilterOptions,
} from '@/lib/mock-db/orders'
import { readWarehouses } from '@/lib/mock-db/warehouses'
import type { OrderFulfillmentStatus, OrderPaymentStatus } from '@/types/order'

// Status alur pesanan yang sah. Nilai di luar daftar ini diabaikan (bukan error) agar URL lama /
// bookmark dengan nilai usang tetap menampilkan data, hanya tanpa filter itu.
const VALID_STATUSES: OrderFulfillmentStatus[] = [
  'Menunggu Pembayaran',
  'Diproses',
  'Dikirim',
  'Selesai',
  'Dibatalkan',
]

// Format id gudang (UUID). Selain itu hanya WAREHOUSE_FILTER_NONE yang diterima — mencegah nilai
// liar masuk ke query.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Validasi format tanggal ISO (YYYY-MM-DD)
function validateDate(dateStr: string | null | undefined): string | undefined {
  if (!dateStr) return undefined
  const regex = /^\d{4}-\d{2}-\d{2}$/
  return regex.test(dateStr) ? dateStr : undefined
}

// 'fs' butuh runtime Node.js (bukan Edge)
export const runtime = 'nodejs'

// Selalu baca file terbaru, jangan di-cache (data berubah saat ada checkout baru)
export const dynamic = 'force-dynamic'

// Mengembalikan daftar pesanan (dengan filter & sorting optional) untuk OMS
export async function GET(request: NextRequest) {
  // Guard: endpoint OMS — mencegah dump PII pesanan tanpa auth (K-2)
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  // Parse query parameters
  const { searchParams } = new URL(request.url)
  const dari = validateDate(searchParams.get('dari'))
  const sampai = validateDate(searchParams.get('sampai'))
  const kurir = searchParams.get('kurir') || undefined
  const pembayaran = (searchParams.get('pembayaran') as OrderPaymentStatus | null) || undefined
  const sortBy = (searchParams.get('sortBy') as 'total' | 'tanggal' | null) || undefined
  const order = (searchParams.get('order') as 'asc' | 'desc' | null) || undefined

  // Status alur pesanan (tab di halaman OMS). Sebelumnya param ini DIKIRIM halaman tapi tak pernah
  // dibaca di sini, sehingga tab status tak menyaring apa pun.
  const rawStatus = searchParams.get('status')
  const status = VALID_STATUSES.find((s) => s === rawStatus)

  // Gudang pemenuh — MULTI-SELECT, dikirim sebagai daftar berkoma (`gudang=id1,id2,none`),
  // pola sama dengan `?category=a,b` di katalog storefront. Isi valid: UUID gudang atau 'none'
  // (pesanan lama yang warehouse_id-nya NULL).
  //
  // Nilai tak valid DIBUANG per-item, bukan menggagalkan request: URL/bookmark lama harus tetap
  // menampilkan data (aturan yang sama sudah dipakai untuk filter gudang versi single-select).
  // Setelah penyaringan tak ada yang tersisa → undefined = tanpa filter gudang.
  const rawGudang = (searchParams.get('gudang') ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v === WAREHOUSE_FILTER_NONE || UUID_REGEX.test(v))
  // Dedupe: id yang sama dua kali di URL tak boleh membengkakkan klausa IN.
  const gudangList = Array.from(new Set(rawGudang))
  const gudang = gudangList.length > 0 ? gudangList : undefined

  // Validasi: jika kedua tanggal ada, pastikan dari <= sampai
  if (dari && sampai && dari > sampai) {
    return NextResponse.json(
      { error: 'Tanggal dari harus kurang dari atau sama dengan tanggal sampai' },
      { status: 400 },
    )
  }

  // Build filter options
  const filterOpts: OrderFilterOptions = {
    dari,
    sampai,
    kurir,
    pembayaran,
    status,
    gudang,
    sortBy,
    order,
  }

  // Fetch pesanan dengan filter (atau tanpa filter jika semua null)
  const hasFilters = Object.values(filterOpts).some((v) => v !== undefined)
  const orders = hasFilters ? await readOrdersFiltered(filterOpts) : await readOrders()

  // Opsi dropdown filter di UI: kurir unik + gudang AKTIF.
  // Gudang nonaktif tak ditawarkan sebagai pilihan filter (tak lagi menerima pesanan baru), tapi
  // namanya tetap tampil di kolom Gudang untuk pesanan lama — lihat resolveWarehouseNames.
  const [couriers, warehouses] = await Promise.all([getDistinctCouriers(), readWarehouses(true)])

  return NextResponse.json({
    orders,
    count: orders.length,
    couriers,
    warehouses: warehouses.map((w) => ({ id: w.id, nama: w.nama })),
  })
}
