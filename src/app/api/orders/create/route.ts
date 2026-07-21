// src/app/api/orders/create/route.ts
// API menulis pesanan baru ke Supabase (orders + order_items + kurangi stok, atomik via RPC).
// Dipanggil POST dari halaman checkout ecommerce saat "Bayar Sekarang".

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { saveOrder, OrderStockError } from '@/lib/mock-db/orders'
import { readProducts } from '@/lib/mock-db/products'
import type { CreateOrderInput, OrderItem, OrderShippingAddress } from '@/types/order'

// createAdminClient (Supabase) butuh runtime Node.js, bukan Edge
export const runtime = 'nodejs'

// Validasi payload di server (jangan percaya input client mentah-mentah)
function isValidPayload(body: unknown): body is CreateOrderInput {
  if (typeof body !== 'object' || body === null) return false
  const b = body as Record<string, unknown>

  const addr = b.address as Partial<OrderShippingAddress> | undefined
  const addressOk =
    typeof addr === 'object' &&
    addr !== null &&
    typeof addr.shippingAddress === 'string' &&
    typeof addr.destinationId === 'string' &&
    addr.destinationId.length > 0

  const itemsOk =
    Array.isArray(b.items) &&
    b.items.length > 0 &&
    b.items.every(
      (item) =>
        typeof (item as OrderItem).productId === 'string' &&
        typeof (item as OrderItem).quantity === 'number' &&
        (item as OrderItem).quantity >= 1 &&
        typeof (item as OrderItem).price === 'number',
    )

  return (
    typeof b.customerName === 'string' &&
    b.customerName.trim().length > 0 &&
    (b.customerEmail === undefined || typeof b.customerEmail === 'string') &&
    (b.customerPhone === undefined || typeof b.customerPhone === 'string') &&
    typeof b.totalAmount === 'number' &&
    b.totalAmount >= 0 &&
    itemsOk &&
    addressOk
  )
}

// Menyimpan pesanan baru dari checkout
export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  if (!isValidPayload(body)) {
    return NextResponse.json(
      { error: 'Data pesanan tidak lengkap atau tipe data salah.' },
      { status: 422 },
    )
  }

  // === K-3: harga OTORITATIF dari server (jangan percaya harga/total dari client) ===
  // Ambil ulang harga tiap produk dari DB (promo_price), hitung subtotal & total di server.
  // Harga & totalAmount yang dikirim client diabaikan → cegah manipulasi (mis. bayar Rp1).
  const extra = body as CreateOrderInput & { shippingCost?: unknown; discount?: unknown }
  const products = await readProducts()
  const byId = new Map(products.map((p) => [p.id, p]))

  let subtotal = 0
  const pricedItems: OrderItem[] = []
  for (const it of body.items) {
    const prod = byId.get(it.productId)
    // Produk wajib ada & tidak diarsipkan; harga diambil dari DB, bukan dari payload.
    if (!prod || prod.archived) {
      return NextResponse.json(
        { error: 'Salah satu produk tidak tersedia. Muat ulang keranjang lalu coba lagi.' },
        { status: 422 },
      )
    }
    subtotal += prod.promoPrice * it.quantity
    pricedItems.push({
      productId: it.productId,
      name: prod.name,
      quantity: it.quantity,
      price: prod.promoPrice, // snapshot harga jual dari DB
    })
  }

  // Ongkir dari client (hasil cek ongkir Mengantar sisi-klien) — clamp ≥ 0.
  // TODO: verifikasi ongkir server-side via Mengantar (origin+destination+weight) — roadmap.
  const shippingCost =
    typeof extra.shippingCost === 'number' && extra.shippingCost > 0 ? Math.round(extra.shippingCost) : 0
  // Diskon (promo) — clamp 0..subtotal. Wiring promo→order masih roadmap; default 0.
  const discount =
    typeof extra.discount === 'number' && extra.discount > 0
      ? Math.min(Math.round(extra.discount), subtotal)
      : 0
  const totalAmount = Math.max(0, subtotal + shippingCost - discount)

  try {
    // Kirim item & total hasil hitung server (bukan dari client)
    const saved = await saveOrder({ ...body, items: pricedItems, totalAmount })

    // Stok produk berkurang → segarkan cache storefront agar stok tampil akurat.
    // Revalidasi halaman detail tiap produk yang dipesan + beranda + katalog.
    revalidatePath('/')
    revalidatePath('/products')
    for (const it of pricedItems) revalidatePath(`/produk/${it.productId}`)

    // invoice dikembalikan agar checkout bisa redirect ke ?invoice=...
    return NextResponse.json({ success: true, invoice: saved.orderId, order: saved }, { status: 201 })
  } catch (e) {
    // Stok tidak cukup → transaksi sudah di-rollback DB; beri tahu buyer produk mana
    if (e instanceof OrderStockError) {
      return NextResponse.json({ error: `Stok produk ${e.productName} tidak mencukupi` }, { status: 409 })
    }
    console.error('Gagal membuat pesanan:', e)
    return NextResponse.json({ error: 'Gagal memproses pesanan. Silakan coba lagi.' }, { status: 500 })
  }
}
