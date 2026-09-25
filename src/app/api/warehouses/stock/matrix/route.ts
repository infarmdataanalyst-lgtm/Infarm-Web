// src/app/api/warehouses/stock/matrix/route.ts
// Data matrix "Kelola Stok Gudang" (ADMIN ONLY): seluruh produk × gudang aktif, dalam SATU respons.
//
// Sengaja satu endpoint (bukan per produk): jumlah produk masih puluhan, dan matrix butuh semua
// baris sekaligus untuk menghitung kolom Total. Bila katalog tumbuh melewati ~200 produk, endpoint
// inilah yang dipaginasi — bentuk payload-nya sudah per-produk sehingga UI tak perlu berubah.
//
// Produk BERVARIAN dikirim beserta daftar variannya: stok produk bervarian tinggal di baris varian
// (variant_id terisi), jadi UI mengunci sel level-produk dan mengedit sel per varian.

import { NextResponse } from 'next/server'
import { getAdminIdentity } from '@/lib/oms-guard'
import { readProducts } from '@/lib/mock-db/products'
import { readAllVariants } from '@/lib/mock-db/variants'
import { readStockRows, readWarehouses } from '@/lib/mock-db/warehouses'
import { getWarehouseMode } from '@/lib/warehouse'

export const runtime = 'nodejs'

// Satu baris varian di matrix.
type VariantRowPayload = {
  id: string
  name: string
  sku: string
  cells: Record<string, number>
  total: number
}

// Satu baris produk di matrix.
type ProductRowPayload = {
  id: string
  name: string
  sku: string
  archived: boolean
  hasVariants: boolean
  cells: Record<string, number>
  total: number
  variants: VariantRowPayload[]
}

// GET → { mode, role, canEdit, warehouses, products }
//
// `canEdit` dikirim supaya UI tahu harus menampilkan tombol Edit atau tidak. Itu HANYA untuk
// tampilan — penjagaan sebenarnya ada di POST /api/warehouses/stock/set (requireStockEditor).
export async function GET() {
  // Membaca matrix boleh oleh semua peran (staff perlu melihat stok); yang dibatasi peran hanya tulis.
  const identity = await getAdminIdentity()
  if (!identity) {
    return NextResponse.json(
      { error: 'Tidak terautentikasi. Silakan login sebagai admin OMS.' },
      { status: 401 },
    )
  }

  const [mode, warehouses, products, variants, stockRows] = await Promise.all([
    getWarehouseMode(),
    // Gudang nonaktif tak ditampilkan: stok di gudang nonaktif tak dipakai memenuhi pesanan,
    // jadi mengeditnya di sini akan menyesatkan. Datanya TIDAK dihapus — cukup aktifkan kembali.
    readWarehouses(true),
    readProducts(),
    readAllVariants(),
    readStockRows(),
  ])

  // Peta stok: produk-level (variant_id NULL) dan per varian.
  const productCells = new Map<string, Record<string, number>>()
  const variantCells = new Map<string, Record<string, number>>()
  for (const row of stockRows) {
    const bucket = row.variantId ? variantCells : productCells
    const key = row.variantId ?? row.productId
    const cells = bucket.get(key) ?? {}
    cells[row.warehouseId] = row.stok
    bucket.set(key, cells)
  }

  const variantsByProduct = new Map<string, typeof variants>()
  for (const variant of variants) {
    const list = variantsByProduct.get(variant.productId) ?? []
    list.push(variant)
    variantsByProduct.set(variant.productId, list)
  }

  // Hanya gudang aktif yang boleh menyumbang Total, supaya angka Total sama dengan stok yang
  // benar-benar bisa dipakai memenuhi pesanan.
  const activeIds = new Set(warehouses.map((w) => w.id))
  const sumCells = (cells: Record<string, number>): number =>
    Object.entries(cells).reduce((total, [id, stok]) => (activeIds.has(id) ? total + stok : total), 0)

  const payload: ProductRowPayload[] = products.map((product) => {
    const ownCells = productCells.get(product.id) ?? {}
    const productVariants = variantsByProduct.get(product.id) ?? []

    const variantPayload: VariantRowPayload[] = productVariants.map((variant) => {
      const cells = variantCells.get(variant.id) ?? {}
      return { id: variant.id, name: variant.name, sku: variant.sku, cells, total: sumCells(cells) }
    })

    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      archived: product.archived ?? false,
      hasVariants: variantPayload.length > 0,
      cells: ownCells,
      // Produk bervarian: total = jumlah seluruh varian (baris produk-level tak dipakai).
      total:
        variantPayload.length > 0
          ? variantPayload.reduce((t, v) => t + v.total, 0)
          : sumCells(ownCells),
      variants: variantPayload,
    }
  })

  return NextResponse.json({
    mode,
    role: identity.role,
    canEdit: identity.role === 'admin',
    warehouses: warehouses.map((w) => ({ id: w.id, nama: w.nama, isDefault: w.isDefault })),
    products: payload,
  })
}
