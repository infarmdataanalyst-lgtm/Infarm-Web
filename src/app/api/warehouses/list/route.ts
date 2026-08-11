// src/app/api/warehouses/list/route.ts
// Daftar gudang untuk halaman OMS "Kelola Gudang".
//
// ADMIN ONLY. Berbeda dengan /api/products/list yang publik: baris gudang memuat
// mengantar_origin_id (alamat asal kirim) dan koordinat gudang — data operasional yang tak perlu
// diketahui pembeli. Storefront tidak pernah membaca endpoint ini; ia hanya melihat hasil akhirnya
// (ongkir & stok) lewat lapisan src/lib/warehouse.ts.

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/oms-guard'
import { getWarehouseUsage, readWarehouses } from '@/lib/mock-db/warehouses'
import { getWarehouseMode } from '@/lib/warehouse'

export const runtime = 'nodejs'

// GET: seluruh gudang + jumlah keterikatan data (untuk menentukan boleh dihapus atau tidak).
export async function GET() {
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  const warehouses = await readWarehouses()
  // Usage dipakai UI untuk memilih aksi "Hapus" vs "Nonaktifkan". Jumlah gudang selalu sedikit
  // (satuan), jadi query per gudang di sini tidak menimbulkan masalah N+1 yang berarti.
  const usage = await Promise.all(warehouses.map((w) => getWarehouseUsage(w.id)))

  return NextResponse.json({
    mode: getWarehouseMode(), // UI memberi tahu admin mode yang sedang aktif
    warehouses: warehouses.map((w, i) => ({ ...w, usage: usage[i] })),
  })
}
