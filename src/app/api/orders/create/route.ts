// src/app/api/orders/create/route.ts
// API menulis pesanan baru ke Supabase (orders + order_items + kurangi stok, atomik via RPC).
// Dipanggil POST dari halaman checkout ecommerce saat "Bayar Sekarang".
//
// Perlindungan: rate limit per-IP (lihat @/lib/rate-limit) untuk mencegah order spam dari bot.
// Batas dipilih longgar untuk manusia (checkout normal = 1 submit; retry setelah error stok masih muat).

import { NextResponse } from 'next/server'
import { RATE_LIMITS, enforceRateLimit, getClientIp } from '@/lib/rate-limit'
import { revalidatePath, revalidateTag } from 'next/cache'
import { saveOrder, OrderStockError } from '@/lib/mock-db/orders'
import { readProducts } from '@/lib/mock-db/products'
import { readPromotions } from '@/lib/mock-db/promotions'
import { getVariantsByIds } from '@/lib/mock-db/variants'
import { getMinOrderAmount } from '@/lib/mock-db/settings'
import { resolveWarehouseForOrder } from '@/lib/warehouse'
import { formatRupiah } from '@/lib/format'
import { isPromotionExpired } from '@/types/promotion'
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
    b.items.every((item) => {
      const it = item as OrderItem
      return (
        typeof it.productId === 'string' &&
        typeof it.quantity === 'number' &&
        it.quantity >= 1 &&
        typeof it.price === 'number' &&
        (it.variantId === undefined || it.variantId === null || typeof it.variantId === 'string')
      )
    })

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
  // Rate limit per-IP: cegah bot membanjiri pembuatan order (dicek sebelum pekerjaan DB apa pun)
  const limited = enforceRateLimit(
    `orders-create:ip:${getClientIp(request)}`,
    RATE_LIMITS.ORDER_CREATE_IP,
  )
  if (limited) return limited

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

  // Varian yang dipilih (fresh, bukan cache) — untuk harga & validasi otoritatif produk bervarian.
  const variantIds = body.items
    .map((it) => (it as OrderItem).variantId)
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
  const variantMap = await getVariantsByIds(variantIds)

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

    // === Minimum pembelian per produk (otoritatif dari DB, bukan dari payload) ===
    // Berlaku PER BARIS keranjang (produk+varian) — konsisten dengan tombol +/− di keranjang.
    const minQty = prod.minOrderQty ?? 1
    if (minQty > 1 && it.quantity < minQty) {
      return NextResponse.json(
        {
          error: `Minimal pembelian ${prod.name} adalah ${minQty} pcs.`,
          code: 'MIN_ORDER_QTY',
          productId: it.productId,
          minOrderQty: minQty,
        },
        { status: 422 },
      )
    }

    if (it.variantId) {
      // === Produk BERVARIAN: harga OTORITATIF dari varian (bukan dari payload) ===
      const variant = variantMap.get(it.variantId)
      // Varian wajib ada & benar-benar milik produk ini → cegah manipulasi (harga/varian palsu).
      if (!variant || variant.productId !== it.productId) {
        return NextResponse.json(
          { error: 'Varian produk tidak valid. Muat ulang halaman lalu coba lagi.' },
          { status: 422 },
        )
      }
      subtotal += variant.price * it.quantity
      pricedItems.push({
        productId: it.productId,
        name: prod.name,
        quantity: it.quantity,
        price: variant.price, // snapshot harga VARIAN dari DB
        variantId: it.variantId,
      })
    } else {
      subtotal += prod.promoPrice * it.quantity
      pricedItems.push({
        productId: it.productId,
        name: prod.name,
        quantity: it.quantity,
        price: prod.promoPrice, // snapshot harga jual dari DB
      })
    }
  }

  // === Minimum TOTAL belanja (store_settings.min_order_amount) — OTORITATIF di server ===
  // Dibandingkan dengan `subtotal` hasil hitung server (harga dari DB), BUKAN angka dari client.
  // Dasar perbandingan = subtotal BARANG saja, bukan subtotal+ongkir, karena itulah angka yang
  // dilihat pembeli di keranjang sebelum memilih alamat/kurir — pesan "kurang Rp X lagi" jadi
  // konsisten antara keranjang, checkout, dan penolakan di server ini.
  // Dicek SEBELUM pembuatan invoice payment gateway agar tak membuang API call untuk transaksi
  // yang pasti ditolak (batas minimum Xendit ±Rp10.000).
  const minOrderAmount = await getMinOrderAmount()
  if (subtotal < minOrderAmount) {
    return NextResponse.json(
      {
        error: `Minimal belanja ${formatRupiah(minOrderAmount)}. Tambah ${formatRupiah(minOrderAmount - subtotal)} lagi untuk checkout.`,
        code: 'MIN_ORDER_AMOUNT',
        minOrderAmount,
        subtotal,
      },
      { status: 422 },
    )
  }

  // === Produk gratis promo (type='free_product') — OTORITATIF di server ===
  // Client TIDAK dipercaya soal produk gratis. Server evaluasi ulang promo aktif berdasar `subtotal`
  // hasil hitung sendiri (harga DB). Hanya promo yang benar-benar memenuhi syarat yang menambahkan
  // produk gratis → cegah manipulasi dapat barang gratis tanpa memenuhi min_purchase.
  // subtotal dihitung SEBELUM blok ini (item gratis harga 0 → tak mengubah subtotal).
  const promotions = await readPromotions()
  const nowMs = Date.now()
  const addedFreeIds = new Set<string>()
  for (const promo of promotions) {
    if (promo.type !== 'free_product' || !promo.isActive || !promo.freeProductId) continue
    if (isPromotionExpired(promo.endAt, nowMs)) continue // sudah kedaluwarsa
    if (promo.startAt && new Date(promo.startAt).getTime() > nowMs) continue // belum mulai
    if (subtotal < promo.minPurchase) continue // syarat belanja belum terpenuhi
    if (addedFreeIds.has(promo.freeProductId)) continue // hindari duplikat produk gratis
    const prod = byId.get(promo.freeProductId)
    if (!prod || prod.archived || prod.stock <= 0) continue // hadiah tak tersedia → lewati diam-diam
    addedFreeIds.add(promo.freeProductId)
    pricedItems.push({
      productId: promo.freeProductId,
      name: prod.name,
      quantity: 1, // aturan promo: 1 produk hadiah
      price: 0, // GRATIS — tak menambah subtotal
      isPromoItem: true,
      promotionId: promo.id,
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

  // === Gudang pemenuh pesanan ===
  // Mode single → langsung gudang default (tanpa query stok/jarak). Mode multi → gudang aktif
  // terdekat yang stoknya cukup untuk SELURUH item. Di-resolve SETELAH item final (termasuk
  // produk hadiah promo) agar gudang yang dipilih benar-benar bisa memenuhi seluruh pesanan.
  // null (mis. tabel gudang belum di-migrate) → RPC memakai gudang default / perilaku lama.
  const warehouse = await resolveWarehouseForOrder(
    pricedItems.map((it) => ({
      productId: it.productId,
      variantId: it.variantId ?? undefined,
      quantity: it.quantity,
    })),
    body.address.destinationId,
  )

  try {
    // Kirim item & total hasil hitung server (bukan dari client)
    const saved = await saveOrder({
      ...body,
      items: pricedItems,
      totalAmount,
      warehouseId: warehouse?.id,
    })

    // Stok produk berkurang → segarkan cache storefront agar stok tampil akurat.
    // Revalidasi halaman detail tiap produk yang dipesan + beranda + katalog.
    revalidatePath('/')
    revalidatePath('/products')
    for (const it of pricedItems) revalidatePath(`/produk/${it.productId}`)
    // Invalidasi cache baca storefront: stok (products) & jumlah terjual (sales) berubah
    revalidateTag('products', 'max')
    revalidateTag('sales', 'max')

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
