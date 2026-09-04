// src/app/api/orders/cancel/route.ts
// API pembatalan pesanan oleh pembeli Guest.
//   GET   → validasi token + kembalikan detail pesanan (untuk ditampilkan di halaman pembatalan)
//   PATCH → jalankan pembatalan: ubah status → 'Dibatalkan' + kembalikan stok ke tersedia
// Keamanan: setiap akses WAJIB membawa token yang cocok dengan orderId (lihat lib/order-token.ts).

import { NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { getOrderByOrderId, getOrderUuidByInvoice, updateOrderStatus } from '@/lib/mock-db/orders'
import { restoreStock } from '@/lib/mock-db/products'
import { recordOrderStockChanges } from '@/lib/stock-audit'
import { verifyCancelToken } from '@/lib/order-token'
import type { Order, OrderFulfillmentStatus } from '@/types/order'

// createAdminClient (Supabase) butuh runtime Node.js, bukan Edge
export const runtime = 'nodejs'

// Status yang masih boleh dibatalkan mandiri oleh pembeli (kondisi "aman")
const CANCELLABLE_STATUSES: OrderFulfillmentStatus[] = ['Menunggu Pembayaran', 'Diproses']

// Bentuk order yang aman dikirim ke pembeli — tanpa data pribadi (nama/telepon/alamat).
function toPublicOrder(order: Order) {
  return {
    orderId: order.orderId,
    date: order.date,
    items: order.items,
    totalAmount: order.totalAmount,
    status: order.status ?? 'Diproses',
    paymentStatus: order.paymentStatus,
  }
}

// GET: verifikasi token lalu kembalikan detail pesanan untuk ditampilkan.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const orderId = searchParams.get('id') ?? searchParams.get('order_id')
  const token = searchParams.get('token')

  if (!orderId || !token) {
    return NextResponse.json({ error: 'Parameter id dan token wajib ada.' }, { status: 400 })
  }
  if (!verifyCancelToken(orderId, token)) {
    return NextResponse.json({ error: 'Token tidak valid atau tautan kedaluwarsa.' }, { status: 403 })
  }

  const order = await getOrderByOrderId(orderId)
  if (!order) {
    return NextResponse.json({ error: 'Pesanan tidak ditemukan.' }, { status: 404 })
  }

  return NextResponse.json({ order: toPublicOrder(order) })
}

// PATCH: batalkan pesanan setelah memverifikasi token & memastikan status masih bisa dibatalkan.
export async function PATCH(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  const orderId =
    typeof body.orderId === 'string'
      ? body.orderId
      : typeof body.id === 'string'
        ? body.id
        : null
  const token = typeof body.token === 'string' ? body.token : null

  if (!orderId || !token) {
    return NextResponse.json({ error: 'orderId dan token wajib ada.' }, { status: 400 })
  }
  if (!verifyCancelToken(orderId, token)) {
    return NextResponse.json({ error: 'Token tidak valid atau tautan kedaluwarsa.' }, { status: 403 })
  }

  const order = await getOrderByOrderId(orderId)
  if (!order) {
    return NextResponse.json({ error: 'Pesanan tidak ditemukan.' }, { status: 404 })
  }

  const current = order.status ?? 'Diproses'
  if (current === 'Dibatalkan') {
    return NextResponse.json(
      { error: 'Pesanan ini sudah dibatalkan sebelumnya.', order: toPublicOrder(order) },
      { status: 409 },
    )
  }
  // Validasi status di SERVER (jangan percaya UI): tolak bila sudah lewat tahap aman.
  if (!CANCELLABLE_STATUSES.includes(current)) {
    return NextResponse.json(
      {
        error: 'Pesanan tidak dapat dibatalkan karena sudah dalam proses pengemasan/pengiriman.',
        order: toPublicOrder(order),
      },
      { status: 409 },
    )
  }

  // COMPARE-AND-SWAP: status lama ikut menjadi syarat UPDATE (SEC-020). Pemeriksaan status di atas
  // hanya melihat keadaan pada SAAT ITU — dua permintaan kembar (double-click, retry jaringan, dua
  // tab, atau tautan pembatalan yang diklik dua kali) sama-sama bisa melewatinya. Hanya satu yang
  // akan mendapat baris kembali dari sini; sisanya berhenti sebelum stok dikembalikan dua kali.
  const updated = await updateOrderStatus(orderId, 'Dibatalkan', undefined, CANCELLABLE_STATUSES)
  if (!updated) {
    return NextResponse.json(
      {
        error: 'Pesanan ini sudah dibatalkan atau statusnya berubah. Muat ulang halaman.',
        order: toPublicOrder(order),
      },
      { status: 409 },
    )
  }

  // Lepaskan kembali stok yang dialokasikan untuk pesanan ini (produk OMS).
  // Stok dikembalikan ke GUDANG pemenuh pesanan (order.warehouseId); kosong → gudang default.
  await restoreStock(
    order.items.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
      variantId: i.variantId ?? undefined,
    })),
    order.warehouseId,
  )

  // Riwayat mutasi: stok kembali karena pembatalan. Pelakunya PEMBELI (bukan admin), jadi kolom
  // "diubah oleh" di riwayat dibiarkan kosong dan ditampilkan sebagai "Sistem (pembeli)".
  const orderUuid = await getOrderUuidByInvoice(order.orderId)
  await recordOrderStockChanges({
    items: order.items.map((i) => ({
      productId: i.productId,
      ...(i.variantId ? { variantId: i.variantId } : {}),
      quantity: i.quantity,
    })),
    ...(order.warehouseId ? { warehouseId: order.warehouseId } : {}),
    orderInvoice: order.orderId,
    ...(orderUuid ? { orderId: orderUuid } : {}),
    direction: 'in',
  })

  // Stok kembali → segarkan cache storefront agar stok tampil akurat.
  revalidatePath('/')
  revalidatePath('/products')
  for (const i of order.items) revalidatePath(`/produk/${i.productId}`)
  // Invalidasi cache baca storefront: stok (products) & jumlah terjual (sales) berubah
  revalidateTag('products', 'max')
  revalidateTag('sales', 'max')

  return NextResponse.json({ success: true, order: toPublicOrder(updated) })
}
