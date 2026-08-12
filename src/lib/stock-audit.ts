// src/lib/stock-audit.ts
// Satu pintu untuk MENCATAT perubahan stok ke riwayat (tabel stock_mutations). SERVER ONLY.
//
// Kenapa ada lapisan ini di atas mock-db/stock-mutations.ts: baris riwayat butuh konteks yang
// tersebar di beberapa tabel (nama produk, nama varian, nama gudang, identitas admin dari cookie
// sesi). Kalau setiap pemanggil menyusunnya sendiri, riwayat akan tidak konsisten. Pemanggil
// di sini hanya menyebut "apa yang berubah", bukan "bagaimana mencatatnya".
//
// Semua fungsi BEST EFFORT — kegagalan mencatat tidak pernah dilempar ke pemanggil (lihat
// catatan di mock-db/stock-mutations.ts). Stok tetap benar; hanya riwayatnya yang bolong.

import { getProductById } from '@/lib/mock-db/products'
import { getVariantsByIds } from '@/lib/mock-db/variants'
import { getDefaultWarehouseRow, getWarehouseById, readStockRows } from '@/lib/mock-db/warehouses'
import { logStockMutations, type StockMutationInput } from '@/lib/mock-db/stock-mutations'
import { getAdminIdentity } from '@/lib/oms-guard'
import type { StockMutationReason } from '@/types/stock-mutation'

// === Identitas pelaku ===

// Admin yang sedang login (dari cookie sesi OMS). Kosong untuk perubahan yang dipicu pembeli
// dari storefront — di situ tak ada admin yang bertanggung jawab, dan kolomnya memang nullable.
async function getActor(): Promise<{ id?: string; name?: string }> {
  const identity = await getAdminIdentity()
  return identity ? { id: identity.id, name: identity.name } : {}
}

// === Perubahan dari OMS (admin) ===

// Satu sel yang diubah di halaman "Kelola Stok Gudang" (atau form produk).
export type ManualStockChange = {
  productId: string
  variantId?: string
  warehouseId: string
  stokBefore: number
  stokAfter: number
}

// Mencatat perubahan stok yang dilakukan admin. Nama produk/varian/gudang di-resolve di sini
// agar pemanggil (route handler) tak perlu ikut menyusun snapshot.
export async function recordAdminStockChanges(
  changes: ManualStockChange[],
  reason: Extract<StockMutationReason, 'manual_update' | 'product_form'>,
): Promise<void> {
  const relevant = changes.filter((c) => c.stokBefore !== c.stokAfter)
  if (relevant.length === 0) return

  const actor = await getActor()
  const variants = await getVariantsByIds(
    relevant.map((c) => c.variantId).filter((id): id is string => Boolean(id)),
  )

  // Cache nama per id: satu produk/gudang bisa muncul di beberapa sel sekaligus.
  const productNames = new Map<string, string>()
  const warehouseNames = new Map<string, string>()

  const inputs: StockMutationInput[] = []
  for (const change of relevant) {
    if (!productNames.has(change.productId)) {
      const product = await getProductById(change.productId)
      productNames.set(change.productId, product?.name ?? '(produk terhapus)')
    }
    if (!warehouseNames.has(change.warehouseId)) {
      const warehouse = await getWarehouseById(change.warehouseId)
      warehouseNames.set(change.warehouseId, warehouse?.nama ?? '(gudang terhapus)')
    }

    const input: StockMutationInput = {
      productId: change.productId,
      warehouseId: change.warehouseId,
      productName: productNames.get(change.productId) ?? '(produk terhapus)',
      warehouseName: warehouseNames.get(change.warehouseId) ?? '(gudang terhapus)',
      stokBefore: change.stokBefore,
      stokAfter: change.stokAfter,
      reason,
    }
    if (change.variantId) {
      input.variantId = change.variantId
      const variantName = variants.get(change.variantId)?.name
      if (variantName) input.variantName = variantName
    }
    if (actor.id) input.changedBy = actor.id
    if (actor.name) input.changedByName = actor.name
    inputs.push(input)
  }

  await logStockMutations(inputs)
}

// === Perubahan dari pesanan (pembeli) ===

// Item pesanan yang menggerakkan stok.
export type OrderStockItem = { productId: string; variantId?: string; quantity: number }

// Mencatat pergerakan stok akibat pesanan.
//
// `direction: 'out'` = stok berkurang karena pesanan masuk (dipanggil SETELAH RPC checkout sukses);
// `direction: 'in'`  = stok kembali karena pesanan dibatalkan (dipanggil SETELAH restoreStock).
//
// Nilai "sesudah" dibaca dari baris stok gudang (kondisi nyata setelah perubahan), lalu "sebelum"
// dihitung dari quantity. Urutan ini disengaja: yang paling penting benar adalah stok akhir, dan
// membacanya setelah perubahan menghindari kebutuhan mengunci baris hanya demi riwayat.
export async function recordOrderStockChanges(input: {
  items: OrderStockItem[]
  warehouseId?: string
  orderInvoice?: string
  orderId?: string
  direction: 'out' | 'in'
}): Promise<void> {
  const items = input.items.filter((i) => i.productId && i.quantity > 0)
  if (items.length === 0) return

  // Gudang pemenuh; kosong → gudang default (pesanan lama / RPC versi lama memakai default).
  const warehouse = input.warehouseId
    ? await getWarehouseById(input.warehouseId)
    : await getDefaultWarehouseRow()
  if (!warehouse) return // tabel gudang belum di-migrate → tak ada konteks yang bisa dicatat

  const rows = await readStockRows({
    productIds: [...new Set(items.map((i) => i.productId))],
    warehouseId: warehouse.id,
  })
  if (rows.length === 0) return // stok masih di kolom lama (products.stock) → tak ada baris gudang

  const variants = await getVariantsByIds(
    items.map((i) => i.variantId).filter((id): id is string => Boolean(id)),
  )

  const productNames = new Map<string, string>()
  const inputs: StockMutationInput[] = []

  for (const item of items) {
    const row = rows.find(
      (r) => r.productId === item.productId && (r.variantId ?? undefined) === item.variantId,
    )
    if (!row) continue // produk dummy / tak punya baris di gudang ini

    if (!productNames.has(item.productId)) {
      const product = await getProductById(item.productId)
      productNames.set(item.productId, product?.name ?? '(produk terhapus)')
    }

    const stokAfter = row.stok
    // 'out' → stok turun sebanyak quantity, jadi sebelumnya lebih besar; 'in' → sebaliknya.
    const stokBefore = input.direction === 'out' ? stokAfter + item.quantity : stokAfter - item.quantity

    const entry: StockMutationInput = {
      productId: item.productId,
      warehouseId: warehouse.id,
      productName: productNames.get(item.productId) ?? '(produk terhapus)',
      warehouseName: warehouse.nama,
      stokBefore,
      stokAfter,
      reason: input.direction === 'out' ? 'order' : 'order_cancelled',
    }
    if (item.variantId) {
      entry.variantId = item.variantId
      const variantName = variants.get(item.variantId)?.name
      if (variantName) entry.variantName = variantName
    }
    if (input.orderId) entry.orderId = input.orderId
    if (input.orderInvoice) entry.orderInvoice = input.orderInvoice
    inputs.push(entry)
  }

  await logStockMutations(inputs)
}
