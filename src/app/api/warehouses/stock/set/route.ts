// src/app/api/warehouses/stock/set/route.ts
// Menyimpan perubahan stok dari matrix "Kelola Stok Gudang".
//
// OTORISASI: `requireStockEditor()` — sesi admin valid DAN peran 'admin'. Peran 'staff' boleh
// melihat stok tapi ditolak `403` di sini. Jangan turunkan ke `requireAdmin()`: UI menyembunyikan
// tombol Edit untuk staff, tapi UI bukan penjagaan.
//
// SATU REQUEST = SATU KUMPULAN PERUBAHAN (biasanya satu baris produk, beberapa gudang sekaligus).
// Bentuk ini dipilih setelah autosave-per-sel diganti mode edit eksplisit: admin menekan "Simpan"
// sekali untuk seluruh baris, jadi satu perjalanan ke server + SATU insert riwayat (bukan N).
//
// Yang dikerjakan, berurutan:
//   1. validasi tiap perubahan (integer 0–999.999; batas sama dengan validasi form produk)
//   2. baca nilai LAMA semua produk terkait (untuk stok_before di riwayat)
//   3. tulis stok gudang satu per satu
//   4. selaraskan kolom lama product_variants.stok untuk varian yang tersentuh
//   5. catat riwayat ke stock_mutations (satu insert)
//   6. invalidasi cache storefront (stok berubah = tampilan pembeli berubah)
//
// Konvensi project: penulisan lewat ROUTE HANDLER, bukan Server Action (lihat CLAUDE.md).

import { NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { requireStockEditor } from '@/lib/oms-guard'
import { readStockRows, setWarehouseStock } from '@/lib/mock-db/warehouses'
import { syncVariantLegacyStock } from '@/lib/mock-db/variants'
import { recordAdminStockChanges, type ManualStockChange } from '@/lib/stock-audit'
import { validateStock } from '@/lib/product-validation'

export const runtime = 'nodejs'

// Batas jumlah sel per request. Satu baris produk = jumlah gudang (satuan), varian pun tak banyak;
// batas ini murni pagar terhadap payload liar.
const MAX_CHANGES = 100

type ParsedChange = {
  productId: string
  variantId?: string
  warehouseId: string
  stok: number
}

// Memvalidasi satu entri perubahan. Mengembalikan pesan error atau entri yang sudah bersih.
function parseChange(raw: unknown): { change?: ParsedChange; error?: string } {
  if (typeof raw !== 'object' || raw === null) return { error: 'Format perubahan tidak valid.' }
  const item = raw as Record<string, unknown>

  const productId = typeof item.productId === 'string' ? item.productId.trim() : ''
  const warehouseId = typeof item.warehouseId === 'string' ? item.warehouseId.trim() : ''
  const variantId =
    typeof item.variantId === 'string' && item.variantId.trim() ? item.variantId.trim() : undefined

  if (!productId || !warehouseId) return { error: 'productId & warehouseId wajib disertakan.' }
  if (typeof item.stok !== 'number') return { error: 'Stok harus berupa angka.' }

  // Stok = INTEGER. Desimal & negatif ditolak di SERVER, bukan hanya disaring di input.
  const stockError = validateStock(item.stok)
  if (stockError) return { error: stockError }

  return { change: { productId, warehouseId, stok: item.stok, ...(variantId ? { variantId } : {}) } }
}

export async function POST(request: Request) {
  const denied = await requireStockEditor()
  if (denied) return denied

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  if (!Array.isArray(body.changes) || body.changes.length === 0) {
    return NextResponse.json(
      { error: 'changes wajib berupa array dan tidak boleh kosong.' },
      { status: 400 },
    )
  }
  if (body.changes.length > MAX_CHANGES) {
    return NextResponse.json(
      { error: `Maksimal ${MAX_CHANGES} perubahan per permintaan.` },
      { status: 422 },
    )
  }

  // SELURUH payload divalidasi lebih dulu. Kalau ada satu entri cacat, TIDAK ADA yang ditulis —
  // supaya tak pernah ada kondisi "sebagian baris tersimpan, sebagian ditolak" yang sulit dibaca admin.
  const changes: ParsedChange[] = []
  for (const raw of body.changes) {
    const { change, error } = parseChange(raw)
    if (error || !change) return NextResponse.json({ error: error ?? 'Perubahan tidak valid.' }, { status: 422 })
    changes.push(change)
  }

  // Nilai lama dibaca SEBELUM ditulis — inilah stok_before di riwayat. Baris belum ada → 0.
  const productIds = [...new Set(changes.map((c) => c.productId))]
  const previousRows = await readStockRows({ productIds })
  const previousOf = (change: ParsedChange): number =>
    previousRows.find(
      (r) =>
        r.productId === change.productId &&
        r.warehouseId === change.warehouseId &&
        (r.variantId ?? undefined) === change.variantId,
    )?.stok ?? 0

  const audit: ManualStockChange[] = []
  const failed: string[] = []

  for (const change of changes) {
    const stokBefore = previousOf(change)
    const written = await setWarehouseStock({
      productId: change.productId,
      ...(change.variantId ? { variantId: change.variantId } : {}),
      warehouseId: change.warehouseId,
      stok: change.stok,
    })
    if (!written) {
      failed.push(change.warehouseId)
      continue
    }
    audit.push({
      productId: change.productId,
      ...(change.variantId ? { variantId: change.variantId } : {}),
      warehouseId: change.warehouseId,
      stokBefore,
      stokAfter: change.stok,
    })
  }

  // Varian: kolom lama product_variants.stok diselaraskan ke TOTAL semua gudang, sebagai jaring
  // pengaman untuk jalur baca yang belum memakai overlay stok gudang.
  const touchedVariants = [...new Set(audit.map((a) => a.variantId).filter((id): id is string => Boolean(id)))]
  if (touchedVariants.length > 0) {
    const rows = await readStockRows({ productIds })
    for (const variantId of touchedVariants) {
      const total = rows.filter((r) => r.variantId === variantId).reduce((sum, r) => sum + r.stok, 0)
      await syncVariantLegacyStock(variantId, total)
    }
  }

  // Riwayat: best effort, tak pernah menggagalkan penyimpanan stok yang sudah berhasil di atas.
  await recordAdminStockChanges(audit, 'manual_update')

  if (audit.length > 0) {
    revalidatePath('/')
    revalidatePath('/products')
    for (const productId of productIds) revalidatePath(`/produk/${productId}`)
    revalidateTag('products', 'max')
  }

  // Sebagian gagal ditulis → beri tahu, tapi jangan sembunyikan yang berhasil (UI perlu tahu
  // angka mana yang sudah benar agar tampilannya tidak berbohong).
  if (failed.length > 0) {
    return NextResponse.json(
      {
        error: 'Sebagian stok gagal disimpan. Muat ulang halaman untuk melihat kondisi terkini.',
        savedCount: audit.length,
        failedCount: failed.length,
      },
      { status: 500 },
    )
  }

  return NextResponse.json({
    success: true,
    savedCount: audit.length,
    // Nilai lama dikembalikan agar UI bisa menawarkan "Batalkan" (undo) tanpa menebak.
    previous: audit.map((a) => ({
      productId: a.productId,
      ...(a.variantId ? { variantId: a.variantId } : {}),
      warehouseId: a.warehouseId,
      stok: a.stokBefore,
    })),
  })
}
