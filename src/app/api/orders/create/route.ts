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
import { getEffectiveStock, resolveWarehouseForOrder, type StockRequirement } from '@/lib/warehouse'
import { getWarehouseById } from '@/lib/mock-db/warehouses'
import { MENGANTAR_ORIGIN_ID_REGEX } from '@/lib/warehouse-validation'
import {
  getCachedShippingOptions,
  resolveShippingOptions,
  shippingOptionsKey,
} from '@/lib/warehouse-shipping'
import { shippingWeightKg } from '@/lib/shipping-weight'
import type { Warehouse } from '@/types/warehouse'
import { formatRupiah } from '@/lib/format'
import { isPromotionExpired } from '@/types/promotion'
import type { CreateOrderInput, OrderItem, OrderShippingAddress } from '@/types/order'

// createAdminClient (Supabase) butuh runtime Node.js, bukan Edge
export const runtime = 'nodejs'

const LOG = '[orders-create]'

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

// Memverifikasi satu gudang: ada, aktif, dan stoknya CUKUP untuk seluruh kebutuhan pesanan.
// null bila tidak lolos — pemanggil lanjut ke kandidat berikutnya.
//
// Ini guard race condition: buyer bisa melihat ongkir gudang A, mengisi form beberapa menit,
// lalu stok A habis lebih dulu oleh pembeli lain. Pengecekan memakai data FRESH (getEffectiveStock
// membaca tabel stok per gudang langsung, bukan cache storefront).
async function pickVerifiedWarehouse(
  warehouseId: string | undefined,
  requirements: StockRequirement[],
): Promise<Warehouse | null> {
  if (!warehouseId) return null
  const warehouse = await getWarehouseById(warehouseId)
  if (!warehouse || !warehouse.isActive) return null

  for (const need of requirements) {
    const stock = await getEffectiveStock(need.productId, {
      variantId: need.variantId,
      warehouseId,
    })
    // null = produk belum punya baris stok per gudang (mis. data belum di-backfill). Jangan tolak
    // gudangnya karena itu — RPC checkout masih punya jalur fallback ke kolom stok lama.
    if (stock !== null && stock < need.quantity) return null
  }
  return warehouse
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

  // === Bentuk destination_id diperiksa SEBELUM menyentuh apa pun ===
  //
  // `isValidPayload` hanya memastikan field ini string tak kosong, jadi teks sembarang lolos dan
  // baru ketahuan jauh di bawah — itu pun HANYA bila Mengantar sempat menjawab. Penjaga
  // DESTINATION_UNSERVICEABLE bergantung pada `warehousesResponded > 0`; saat panggilan cek ongkir
  // habis waktu (4,5 dtk/origin) kita tak bisa membedakan "tujuan ngawur" dari "Mengantar sedang
  // down", lalu memilih meneruskan supaya checkout tak mati total. Akibatnya nyata dan sudah
  // terjadi: pesanan INV-20260827-PR6TP0T6 tersimpan dengan destination_id
  // "invalid-destination-xyz" dan stok terpotong 67 unit.
  //
  // Pemeriksaan bentuk menutup lubang itu tanpa bergantung pada jaringan sama sekali. Id Mengantar
  // selalu ObjectId 24 hex — pola yang sama dengan origin id gudang, karena keduanya memang jenis
  // id yang sama di sisi mereka.
  //
  // Yang TIDAK ditangkap di sini: id berbentuk benar tapi tak ada di indeks Mengantar. Itu tetap
  // urusan penjaga DESTINATION_UNSERVICEABLE di bawah.
  if (!MENGANTAR_ORIGIN_ID_REGEX.test(body.address.destinationId)) {
    console.warn(
      `${LOG} destination_id ditolak (bentuk tak sah): ${JSON.stringify(body.address.destinationId).slice(0, 80)}`,
    )
    return NextResponse.json(
      {
        error: 'Alamat pengiriman tidak valid. Silakan pilih ulang alamat dari hasil pencarian.',
        code: 'DESTINATION_INVALID',
      },
      { status: 422 },
    )
  }

  // === K-3: harga OTORITATIF dari server (jangan percaya harga/total dari client) ===
  // Ambil ulang harga tiap produk dari DB (promo_price), hitung subtotal & total di server.
  // Harga & totalAmount yang dikirim client diabaikan → cegah manipulasi (mis. bayar Rp1).
  // warehouseId datang dari hasil perbandingan ongkir di checkout dan diverifikasi ulang di
  // server (lihat pickVerifiedWarehouse), tidak dipercaya mentah.
  // Field `weight` masih diterima demi kompatibilitas klien lama, tapi SENGAJA DIABAIKAN — berat
  // kirim dihitung ulang dari berat produk di DB (lihat serverWeight di bawah).
  const extra = body as CreateOrderInput & {
    shippingCost?: unknown
    discount?: unknown
    warehouseId?: unknown
    weight?: unknown
  }
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

  // === Kebutuhan stok & berat kirim — DIHITUNG DI SINI, sebelum ongkir ===
  //
  // Dulu dua nilai ini dihitung setelah blok ongkir. Dipindah ke atas karena keduanya adalah bahan
  // KUNCI CACHE perbandingan ongkir, dan tanpa keduanya ongkir tak bisa diverifikasi.
  //
  // Berat diambil dari berat produk di DB, BUKAN dari `weight` yang dikirim client: berat palsu
  // yang kecil menghasilkan ongkir murah sementara kurir tetap menagih tarif berat sebenarnya.
  // Item hadiah promo ikut ditimbang — barangnya tetap dikirim fisik.
  const requirements = pricedItems.map((it) => ({
    productId: it.productId,
    variantId: it.variantId ?? undefined,
    quantity: it.quantity,
  }))

  const serverWeight = shippingWeightKg(
    pricedItems.map((it) => ({ quantity: it.quantity, berat: byId.get(it.productId)?.berat })),
  )

  // === Ongkir: DIVERIFIKASI ke tarif Mengantar, bukan diterima apa adanya ===
  //
  // Sebelumnya nilai ini diambil mentah dari body dan hanya di-clamp ≥ 0. Itu satu-satunya angka
  // berdampak-uang yang masih dipercaya dari client: `POST` dengan `shippingCost: 0` membuat
  // `jumlah_total` ikut nol-ongkir, dan karena tagihan Xendit dibaca dari kolom itu, pembeli
  // benar-benar membayar tanpa ongkir. Tarif kurirnya tetap ditagih ke toko.
  //
  // Cara verifikasi: cocokkan dengan daftar tarif yang server sendiri dapat dari Mengantar untuk
  // (tujuan + berat + isi keranjang) yang sama. Client hanya boleh memilih dari daftar itu.
  //
  // Cache dipakai bila ada; kalau tidak, dihitung ulang. Menghitung ulang aman: cek ongkir adalah
  // panggilan BACA yang gratis dan tanpa efek samping (CLAUDE.md → Panggilan API Berbayar).
  // Cache MISS itu hal biasa di Vercel — cache-nya in-memory per instance, dan permintaan cek
  // ongkir tadi bisa mendarat di instance yang berbeda. Jadi miss TIDAK boleh diperlakukan sebagai
  // kecurigaan.
  const clientShipping =
    typeof extra.shippingCost === 'number' && extra.shippingCost > 0
      ? Math.round(extra.shippingCost)
      : 0

  const optionsKey = shippingOptionsKey(body.address.destinationId, serverWeight, requirements)
  let quoted = getCachedShippingOptions(optionsKey)

  if (!quoted) {
    try {
      quoted = await resolveShippingOptions(requirements, body.address.destinationId, serverWeight)
    } catch (err) {
      console.error(`${LOG} gagal menghitung ulang ongkir untuk verifikasi:`, err)
      quoted = null
    }
  }

  const tarifSah = quoted ? quoted.options.map((o) => Math.round(o.price)) : []

  // `const`: nilainya tak pernah ditimpa. Cabang "tak cocok" MENOLAK permintaan (return), bukan
  // menimpa dengan tarif server — lihat alasannya di komentar cabang itu.
  const shippingCost = clientShipping

  // ⚠️ "Tak ada tarif" punya DUA sebab yang sama sekali berbeda, dan keduanya tak boleh
  // diperlakukan sama:
  //
  //   (a) Mengantar tak menjawab   → `warehousesResponded === 0` (atau panggilannya melempar).
  //       Kita tak tahu apa-apa tentang tujuannya. Menolak = checkout mati total tiap kali
  //       Mengantar bermasalah.
  //   (b) Mengantar MENJAWAB, tapi nol kurir → tujuannya memang tak terlayani: `destination_id`
  //       ngawur/tak dikenal, atau seluruh kurir tersaring daftar putih. Ini BUKAN gangguan
  //       sementara — pesanan ke alamat itu tak akan pernah bisa dikirim.
  //
  // Dulu keduanya jatuh ke satu cabang "terima saja, catat di log". Akibatnya `destination_id`
  // karangan tetap menghasilkan baris `orders` berstatus Menunggu Pembayaran yang tak mungkin
  // dipenuhi — pesanan hantu yang baru ketahuan saat admin mencoba membooking kurir.
  const mengantarMenjawab = quoted !== null && quoted.warehousesResponded > 0

  if (tarifSah.length === 0 && mengantarMenjawab) {
    // (b) Tujuan tak terlayani → TOLAK. Jangan buat pesanan yang mustahil dikirim.
    console.warn(
      `${LOG} tujuan tak terlayani: destination=${body.address.destinationId} ` +
        `weight=${serverWeight} gudangMenjawab=${quoted!.warehousesResponded}`,
    )
    return NextResponse.json(
      {
        error:
          'Alamat tujuan belum terjangkau kurir kami. Silakan pilih ulang alamat pengiriman.',
        code: 'DESTINATION_UNSERVICEABLE',
      },
      { status: 422 },
    )
  }

  if (tarifSah.length === 0) {
    // (a) Mengantar tak bisa dihubungi DAN cache kosong → tak ada dasar untuk membandingkan.
    //
    // Nilai client diterima, TAPI dicatat keras. Menolak di sini berarti seluruh checkout berhenti
    // setiap kali Mengantar bermasalah — kerugian yang jauh lebih besar dan lebih sering daripada
    // celah yang sedang ditutup. Ini satu-satunya jalan yang tersisa terbuka, dan ia butuh Mengantar
    // sedang down untuk bisa dipakai.
    console.error(
      `${LOG} ONGKIR TAK TERVERIFIKASI (Mengantar tak menjawab) — memakai nilai client ` +
        `Rp${clientShipping}. destination=${body.address.destinationId} weight=${serverWeight}`,
    )
  } else if (!tarifSah.includes(clientShipping)) {
    // Angka yang dikirim client bukan salah satu tarif yang benar-benar ditawarkan.
    //
    // DITOLAK, bukan diam-diam ditimpa dengan tarif server. Menimpanya berarti pembeli ditagih
    // angka yang berbeda dari yang ia lihat di layar — dan bila tarif server lebih mahal, ia
    // membayar lebih tanpa pernah menyetujuinya. Lebih baik ia menghitung ulang ongkir.
    //
    // Tarif juga bisa berubah wajar antara buyer melihat harga dan menekan bayar (cache 10 menit).
    // Karena itu pesannya diarahkan ke tindakan, bukan ke tuduhan.
    console.warn(
      `${LOG} ongkir ditolak: client=Rp${clientShipping} tak ada di tarif sah [${tarifSah.join(', ')}]`,
    )
    return NextResponse.json(
      {
        error:
          'Ongkos kirim sudah berubah. Silakan pilih ulang kurir pengiriman lalu coba lagi.',
        code: 'SHIPPING_MISMATCH',
      },
      { status: 409 },
    )
  }

  // Diskon (promo) — clamp 0..subtotal. Wiring promo→order masih roadmap; default 0.
  const discount =
    typeof extra.discount === 'number' && extra.discount > 0
      ? Math.min(Math.round(extra.discount), subtotal)
      : 0
  const totalAmount = Math.max(0, subtotal + shippingCost - discount)

  // === Gudang pemenuh pesanan ===
  // Gudang berasal dari kurir yang DIPILIH BUYER (hasil perbandingan ongkir riil antar gudang di
  // /api/mengantar/shipping/options). Client mengirim `warehouseId`, tapi TIDAK dipercaya:
  //   1. id-nya diverifikasi ada, aktif, dan stoknya masih cukup (guard race condition — stok bisa
  //      habis di antara buyer melihat ongkir dan menekan bayar),
  //   2. bila tak lolos, jatuh ke opsi ongkir termurah BERIKUTNYA dari hasil perbandingan yang
  //      masih tersimpan di server (tanpa memanggil Mengantar lagi),
  //   3. bila itu pun tak ada, resolveWarehouseForOrder memilih gudang ber-stok cukup / default.
  //
  // `requirements` & `serverWeight` sengaja TIDAK dihitung lagi di sini — keduanya sudah dibuat di
  // atas untuk memverifikasi ongkir. Menghitungnya dua kali pernah membuat kunci cache di blok ini
  // berbeda tipis dari kunci di blok ongkir, dan fallback gudang jadi selalu meleset tanpa gejala.
  const requestedWarehouseId =
    typeof extra.warehouseId === 'string' && extra.warehouseId ? extra.warehouseId : undefined

  let warehouse = await pickVerifiedWarehouse(requestedWarehouseId, requirements)

  if (!warehouse && quoted) {
    // Gudang pilihan buyer tak lolos verifikasi → coba opsi termurah berikutnya dari daftar tarif
    // yang SAMA dengan yang dipakai memverifikasi ongkir (`quoted`), bukan membaca cache ulang.
    // Urutannya sudah termurah → termahal.
    const tried = new Set<string>(requestedWarehouseId ? [requestedWarehouseId] : [])
    for (const option of quoted.options) {
      if (tried.has(option.warehouseId)) continue
      tried.add(option.warehouseId)
      const candidate = await pickVerifiedWarehouse(option.warehouseId, requirements)
      if (candidate) {
        warehouse = candidate
        break
      }
    }
  }

  // Masih belum dapat → jalur fallback lama (gudang ber-stok cukup, default didahulukan).
  if (!warehouse) warehouse = await resolveWarehouseForOrder(requirements)

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
