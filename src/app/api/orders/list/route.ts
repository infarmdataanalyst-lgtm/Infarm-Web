// src/app/api/orders/list/route.ts
// API membaca pesanan dari mock database dengan support filter & sorting server-side.
// Dipanggil GET dari Dashboard OMS untuk mengisi tabel pesanan admin.
// Query params: dari, sampai, kurir, pembayaran, status, gudang, sortBy, order
//
// SEMUA penyaringan dilakukan di query Supabase (bukan fetch-all-lalu-filter-di-client) supaya
// tetap efisien saat jumlah pesanan membesar.

import { NextResponse, type NextRequest } from 'next/server'
import { getAdminIdentity, requireAdmin } from '@/lib/oms-guard'
import { maskOrdersForRole, shouldMaskBuyerPii } from '@/lib/oms-pii'
import {
  readOrders,
  readOrdersFiltered,
  WAREHOUSE_FILTER_NONE,
  type OrderFilterOptions,
} from '@/lib/mock-db/orders'
import { courierDisplayName, OFFERED_COURIER_IDS } from '@/lib/mengantar-estimate'
import { readWarehouses } from '@/lib/mock-db/warehouses'
import { isOrderIssueKind } from '@/lib/order-issues'
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

// Pilihan filter kurir = kurir yang DITAWARKAN ke pembeli, dalam bentuk yang tersimpan di
// orders.nama_ekspedisi ('J&T', 'Shopee Express'). Dulu daftar ini diambil dari nama kurir unik di
// tabel pesanan, sehingga kurir dari pesanan uji lama (SiCepat, JNE, dll.) ikut muncul padahal tak
// pernah ditawarkan (keputusan pemilik 2026-10-14). Kurir baru di OFFERED_COURIER_IDS otomatis ikut.
const FILTER_COURIERS: string[] = OFFERED_COURIER_IDS.map(courierDisplayName)

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
  // Hanya kurir yang ditawarkan ke pembeli (J&T, Shopee Express). Nilai lain dari URL lama
  // diabaikan, aturan yang sama dengan `status`.
  const rawKurir = searchParams.get('kurir')
  const kurir = FILTER_COURIERS.find((c) => c === rawKurir)
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

  // Pesanan bermasalah (tautan dari kotak "Perlu tindakan" & notifikasi). Nilai tak dikenal
  // diabaikan, aturan yang sama dengan `status`.
  const rawMasalah = searchParams.get('masalah')
  const masalah = isOrderIssueKind(rawMasalah) ? rawMasalah : undefined

  // Paket menunggu kurir tanpa jadwal jemput tercatat (tombol kuning kartu penjemputan).
  const tanpaJadwal = searchParams.get('jadwal') === 'belum' ? true : undefined

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
    masalah,
    tanpaJadwal,
  }

  // Fetch pesanan dengan filter (atau tanpa filter jika semua null)
  const hasFilters = Object.values(filterOpts).some((v) => v !== undefined)
  const orders = hasFilters ? await readOrdersFiltered(filterOpts) : await readOrders()

  // Opsi dropdown filter di UI: kurir yang ditawarkan + gudang AKTIF.
  // Gudang nonaktif tak ditawarkan sebagai pilihan filter (tak lagi menerima pesanan baru), tapi
  // namanya tetap tampil di kolom Gudang untuk pesanan lama — lihat resolveWarehouseNames.
  const couriers = FILTER_COURIERS
  const warehouses = await readWarehouses(true)

  // Peran 'staff' menerima data pembeli tersensor (lib/oms-pii.ts). Identitas tak terbaca →
  // anggap staff: lebih baik admin sesekali melihat data tersamar daripada staff melihat utuh.
  const role = (await getAdminIdentity())?.role ?? 'staff'

  return NextResponse.json({
    orders: maskOrdersForRole(orders, role),
    // Dibaca halaman Pesanan untuk membuang kolom nama & telepon dari ekspor CSV.
    buyerPiiMasked: shouldMaskBuyerPii(role),
    count: orders.length,
    couriers,
    warehouses: warehouses.map((w) => ({ id: w.id, nama: w.nama })),
  })
}
