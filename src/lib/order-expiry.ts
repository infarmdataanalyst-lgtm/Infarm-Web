// src/lib/order-expiry.ts
// Menutup pesanan yang pembayarannya tidak akan pernah masuk: tandai Gagal/Dibatalkan, lalu
// LEPASKAN kembali stok yang sudah dipotong saat checkout.
//
// ── Kenapa modul terpisah ──
// Ada DUA pemicu yang harus melakukan hal yang sama persis:
//   1. Callback "invoice expired" dari Xendit (webhooks/xendit) — cepat, tapi hanya tiba bila
//      event itu memang terdaftar di Dashboard Xendit, dan hanya sekali. Kalau meleset, hilang.
//   2. Penyapu terjadwal (cron/expire-orders) — lambat, tapi tak bergantung pada pihak luar.
//
// Keduanya WAJIB berperilaku identik. Kalau logikanya disalin dua kali, cepat atau lambat yang
// satu akan menyimpang dari yang lain — dan penyimpangan pada jalur pelepasan stok berarti stok
// bocor atau menggelembung tanpa ada yang menyadari. Satu fungsi, dua pemanggil.
//
// Stok dipotong saat pesanan DIBUAT (RPC create_order_with_items), bukan saat dibayar — pilihan
// sengaja untuk mencegah oversell. Konsekuensinya: setiap pesanan yang mati harus mengembalikan
// stoknya, kalau tidak barang tercatat habis padahal tak pernah terjual.

import { revalidatePath, revalidateTag } from 'next/cache'
import { getOrderUuidByInvoice, updatePaymentStatus } from '@/lib/mock-db/orders'
import { restoreStock } from '@/lib/mock-db/products'
import { recordOrderStockChanges } from '@/lib/stock-audit'
import type { Order } from '@/types/order'

const LOG = '[order-expiry]'

export type ExpireOutcome =
  | { ok: true; released: true }
  | { ok: true; released: false; reason: 'ALREADY_CANCELLED' | 'ALREADY_PAID' }
  | { ok: false; reason: 'SAVE_FAILED' }

// Menutup satu pesanan & mengembalikan stoknya. Idempoten lewat dua penjaga di depan.
//
// `actor` hanya untuk log — pelakunya selalu SISTEM, jadi `changed_by` pada riwayat mutasi
// sengaja dibiarkan kosong di kedua jalur.
export async function expireOrder(
  order: Order,
  invoice: string,
  actor: 'webhook' | 'cron',
  transactionId?: string,
): Promise<ExpireOutcome> {
  // Sudah dibatalkan sebelumnya (pembeli lewat /order-cancellation, admin lewat OMS, callback
  // duplikat, atau penyapu yang berjalan dua kali) → stok SUDAH dikembalikan. Mengembalikannya
  // lagi akan menggelembungkan stok, dan itu berujung oversell — kebalikan dari tujuan fitur ini.
  if (order.status === 'Dibatalkan') {
    console.log(`${LOG}:${actor} invoice=${invoice} sudah Dibatalkan — stok tak dikembalikan lagi`)
    return { ok: true, released: false, reason: 'ALREADY_CANCELLED' }
  }
  // Sudah lunas. Di jalur webhook ini terjadi karena urutan callback tak dijamin; di jalur cron
  // karena pembayaran masuk di antara pembacaan daftar dan pemrosesan baris ini.
  if (order.paymentStatus === 'Lunas') {
    console.warn(`${LOG}:${actor} invoice=${invoice} sudah Lunas — pembatalan diabaikan`)
    return { ok: true, released: false, reason: 'ALREADY_PAID' }
  }

  const updated = await updatePaymentStatus(invoice, 'Gagal', {
    orderStatus: 'Dibatalkan',
    ...(transactionId ? { transactionId } : {}),
  })
  if (!updated) {
    console.error(`${LOG}:${actor} invoice=${invoice} gagal menyimpan status Gagal`)
    return { ok: false, reason: 'SAVE_FAILED' }
  }

  // Status ditulis LEBIH DULU, stok dikembalikan sesudahnya. Urutan ini disengaja: bila proses
  // mati di tengah, yang tertinggal adalah pesanan batal yang stoknya belum kembali (kekurangan
  // stok tercatat — aman, ketahuan saat stok opname). Urutan sebaliknya meninggalkan stok yang
  // sudah kembali pada pesanan yang masih hidup — itu oversell diam-diam.
  await restoreStock(
    order.items.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
      variantId: i.variantId ?? undefined,
    })),
    order.warehouseId,
  )

  const orderUuid = await getOrderUuidByInvoice(invoice)
  await recordOrderStockChanges({
    items: order.items.map((i) => ({
      productId: i.productId,
      ...(i.variantId ? { variantId: i.variantId } : {}),
      quantity: i.quantity,
    })),
    ...(order.warehouseId ? { warehouseId: order.warehouseId } : {}),
    orderInvoice: invoice,
    ...(orderUuid ? { orderId: orderUuid } : {}),
    direction: 'in',
  })

  console.log(`${LOG}:${actor} invoice=${invoice} → Gagal / Dibatalkan, stok dikembalikan`)
  return { ok: true, released: true }
}

// Menyegarkan cache storefront setelah stok kembali.
//
// DIPISAH dari expireOrder dengan sengaja: penyapu yang menutup 20 pesanan sekaligus tak boleh
// memanggil revalidate 20 kali — cukup sekali di akhir, dengan gabungan produk yang tersentuh.
export function revalidateAfterExpiry(productIds: string[]): void {
  revalidatePath('/')
  revalidatePath('/products')
  for (const id of new Set(productIds)) revalidatePath(`/produk/${id}`)
  revalidateTag('products', 'max')
  revalidateTag('sales', 'max')
  revalidatePath('/oms/dashboard')
}
