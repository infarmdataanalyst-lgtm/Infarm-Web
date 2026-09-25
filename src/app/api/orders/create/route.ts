// src/app/api/orders/create/route.ts
// API menulis pesanan baru ke Supabase (orders + order_items + kurangi stok, atomik via RPC).
// Dipanggil POST dari halaman checkout ecommerce saat "Bayar Sekarang".
//
// Perlindungan: rate limit per-IP (lihat @/lib/rate-limit) untuk mencegah order spam dari bot.
// Batas dipilih longgar untuk manusia (checkout normal = 1 submit; retry setelah error stok masih muat).

import { NextResponse } from 'next/server'
import { RATE_LIMITS, enforceRateLimit, getClientIp } from '@/lib/rate-limit'
import { revalidatePath, revalidateTag } from 'next/cache'
import {
  saveOrder,
  OrderStockError,
  attachGaIdentifiers,
  attachDeliveryEstimate,
} from '@/lib/mock-db/orders'
import { readProductsByIds } from '@/lib/mock-db/products'
import { readPromotions } from '@/lib/mock-db/promotions'
import { getComboById } from '@/lib/mock-db/combos'
import { allocateComboPrices, computeOrderPromos } from '@/lib/promo-cart'
import { comboMultiplier } from '@/lib/cart-lines'
import { XENDIT_MIN_AMOUNT } from '@/lib/payment-limits'
import { getVariantsByIds } from '@/lib/mock-db/variants'
import { getMinOrderAmount, getMaxDiscountPercent } from '@/lib/mock-db/settings'
import {
  getEffectiveStock,
  getQuoteOriginId,
  mergeRequirements,
  resolveWarehouseForOrder,
  type StockRequirement,
} from '@/lib/warehouse'
import { getWarehouseById } from '@/lib/mock-db/warehouses'
import { MENGANTAR_ORIGIN_ID_REGEX } from '@/lib/warehouse-validation'
import {
  getCachedShippingOptions,
  resolveShippingOptions,
  shippingOptionsKey,
  type WarehouseShippingOption,
} from '@/lib/warehouse-shipping'
import { shippingWeightKg } from '@/lib/shipping-weight'
import type { Warehouse } from '@/types/warehouse'
import { formatRupiah } from '@/lib/format'
import { isValidPhone } from '@/lib/phone'
import { isValidEmail } from '@/lib/email'
import { isPromotionExpired } from '@/types/promotion'
import type {
  CreateOrderInput,
  OrderItem,
  OrderLogistics,
  OrderShippingAddress,
} from '@/types/order'

// createAdminClient (Supabase) butuh runtime Node.js, bukan Edge
export const runtime = 'nodejs'
// Cek ongkir ke Mengantar bisa makan 2 × 8 detik (timeout + satu coba ulang, lib/warehouse-shipping).
// Tanpa ini fungsi Vercel dimatikan di batas bawaan 10 detik sebelum sempat menjawab.
export const maxDuration = 30

const LOG = '[orders-create]'

// Item keranjang seperti yang DIKIRIM klien. `comboId` hanya ada di payload masuk, tidak di
// OrderItem yang disimpan — order_items tak punya kolomnya, dan harga hasil alokasi combo sudah
// tersimpan di kolom price tiap baris.
type IncomingItem = OrderItem & { comboId?: string }

// Membaca comboId sebuah item dengan aman (payload klien tak bisa dipercaya bentuknya).
function comboIdOf(item: OrderItem): string | undefined {
  const raw = (item as IncomingItem).comboId
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}

// Bagian alamat yang tak diperiksa isValidPayload (provinsi, kota, …). Nilai bukan-string dijadikan
// kosong alih-alih diteruskan apa adanya ke RPC, dan panjangnya dibatasi supaya satu permintaan tak
// bisa menyimpan teks raksasa ke kolom yang ikut tampil di OMS dan label kurir.
const ALAMAT_MAX = 200
function teksAlamat(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().slice(0, ALAMAT_MAX) : ''
}

// `logistics` dari klien hanya nilai awal nama ekspedisi & jenis layanan (ditulis ulang oleh booking
// kurir setelah bayar). Diterima hanya bila kedua field berupa string; selain itu diabaikan, dan
// kolomnya kosong seperti pesanan yang dibuat tanpa field ini.
const LOGISTIK_MAX = 60
function logistikDariBody(raw: unknown): OrderLogistics | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const { courier, service } = raw as Record<string, unknown>
  if (typeof courier !== 'string' || typeof service !== 'string') return undefined
  const c = courier.trim().slice(0, LOGISTIK_MAX)
  const s = service.trim().slice(0, LOGISTIK_MAX)
  return c && s ? { courier: c, service: s } : undefined
}

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
        (it.variantId === undefined || it.variantId === null || typeof it.variantId === 'string') &&
        // comboId opsional. Nilainya TIDAK dipercaya sebagai harga — ia hanya petunjuk paket mana
        // yang harus dicari ke DB (lihat blok "Harga paket/combo" di bawah).
        ((item as IncomingItem).comboId === undefined ||
          typeof (item as IncomingItem).comboId === 'string')
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

  // Kebutuhan produk/varian yang sama DIJUMLAHKAN dulu. Satu produk kini sah muncul di beberapa
  // baris (A di dalam paket + A satuan); diperiksa per baris, stok 2 tampak cukup untuk dua baris
  // yang masing-masing butuh 2 padahal totalnya 4. Perbandingan ongkir (warehouse-shipping) sudah
  // lama menjumlahkan — pemeriksaan ulang di sini ikut aturan yang sama.
  const needs = mergeRequirements(requirements)

  // Stok tiap kebutuhan diperiksa BERSAMAAN, bukan bergiliran. Dulu satu putaran `for await`:
  // keranjang 5 item = 5 perjalanan berurutan ke database, dan fungsi ini sendiri bisa dipanggil
  // beberapa kali (gudang yang diminta, lalu kandidat lain). Semuanya pembacaan murni tanpa efek
  // samping, jadi menjalankannya serempak tak mengubah hasil — hanya menghilangkan antreannya.
  //
  // Konsekuensi yang disengaja: tak ada lagi keluar lebih awal saat kebutuhan pertama sudah gagal.
  // Menjalankan sisa pembacaan yang hasilnya tak terpakai jauh lebih murah daripada menunggu
  // giliran satu per satu.
  const stocks = await Promise.all(
    needs.map((need) =>
      getEffectiveStock(need.productId, { variantId: need.variantId, warehouseId }),
    ),
  )
  for (const [index, need] of needs.entries()) {
    // null = produk belum punya baris stok per gudang (mis. data belum di-backfill). Jangan tolak
    // gudangnya karena itu — RPC checkout masih punya jalur fallback ke kolom stok lama.
    const stock = stocks[index]
    if (stock !== null && stock !== undefined && stock < need.quantity) return null
  }
  return warehouse
}

// Gudang termurah dari daftar tarif yang aktif & stoknya cukup, BESERTA tarifnya. `options` sudah
// urut termurah → termahal, jadi yang pertama lolos pasti yang termurah. Gudang di `skip` dilewati.
async function pickQuotedWarehouseWithStock(
  options: WarehouseShippingOption[],
  requirements: StockRequirement[],
  skip: Set<string>,
): Promise<{ warehouse: Warehouse; price: number } | null> {
  const tried = new Set(skip)
  for (const option of options) {
    if (tried.has(option.warehouseId)) continue
    tried.add(option.warehouseId)
    const warehouse = await pickVerifiedWarehouse(option.warehouseId, requirements)
    if (warehouse) return { warehouse, price: Math.round(option.price) }
  }
  return null
}

// 409 SHIPPING_CHANGED: gudang pilihan pembeli tak bisa lagi memenuhi pesanan, dan ongkir dari
// gudang penggantinya belum ia setujui. Checkout memuat ulang ongkir dan menampilkan pesan menetap.
//
// Pesannya sengaja TIDAK menyebut nama gudang — pembeli tak pernah memilih gudang, ia memilih
// kurir & harga. `newShippingCost` hanya perkiraan server; angka yang ditampilkan ke pembeli tetap
// hasil muat ulang opsi ongkir di checkout.
function shippingChangedResponse(previousShippingCost: number, newShippingCost?: number) {
  console.warn(
    `${LOG} ongkir berubah karena stok gudang pilihan habis: ` +
      `Rp${previousShippingCost} → ${newShippingCost !== undefined ? `Rp${newShippingCost}` : '(belum dikutip)'}`,
  )
  return NextResponse.json(
    {
      error:
        'Stok dari lokasi pengiriman terdekat baru saja habis, sehingga ongkos kirim berubah. ' +
        'Periksa kembali ongkos kirim dan total pembayaran, lalu coba lagi.',
      code: 'SHIPPING_CHANGED',
      previousShippingCost,
      ...(newShippingCost !== undefined ? { newShippingCost } : {}),
    },
    { status: 409 },
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

  // === Identitas pembeli divalidasi BENTUKNYA di server (menutup SEC-022) ===
  //
  // isValidPayload hanya memastikan kedua field ini bertipe string. Client memang memblokir format
  // yang salah, tetapi endpoint ini publik dan bisa dipanggil langsung dengan string apa pun.
  //
  // Kenapa ini bukan sekadar kebersihan data: no_telepon dan email adalah SATU-SATUNYA pegangan
  // pembeli tamu atas pesanannya. Kelima endpoint by-phone/by-email menuntut format yang sah
  // sebelum mencari, jadi pesanan yang tersimpan dengan nilai malformed tidak akan pernah bisa
  // dilacak, dibatalkan, maupun diulas oleh pemiliknya sendiri. Itu bug diam yang baru ketahuan
  // saat pelanggan mengeluh, dan pada saat itu pesanannya sudah telanjur memotong stok.
  //
  // Keduanya tetap OPSIONAL seperti sebelumnya — yang ditolak hanya nilai yang DIISI tapi tak
  // berbentuk sah. 422 dipilih agar seragam dengan penolakan payload di atas.
  const phoneInput = body.customerPhone?.trim() ?? ''
  if (phoneInput && !isValidPhone(phoneInput)) {
    return NextResponse.json(
      { error: 'Nomor telepon tidak valid. Contoh: 08123456789.' },
      { status: 422 },
    )
  }
  const emailInput = body.customerEmail?.trim() ?? ''
  if (emailInput && !isValidEmail(emailInput)) {
    return NextResponse.json(
      { error: 'Email tidak valid. Contoh: nama@gmail.com' },
      { status: 422 },
    )
  }

  // === Diskon: TIDAK PERNAH diterima dari client (menutup SEC-013) ===
  //
  // Berkas ini dulu menerima `discount` mentah dari body dan hanya melakukan clamp
  // Math.min(Math.round(discount), subtotal) — tanpa sekali pun menyentuh tabel promotions untuk
  // memastikan promonya is_active, belum melewati end_at, sudah melewati start_at, subtotal
  // mencapai min_purchase, atau nilai yang diklaim benar-benar sama dengan discount_value yang
  // tersimpan. UI checkout memang tak pernah mengirim field ini, jadi lewat browser normal ia tak
  // ter-eksploitasi; tetapi endpoint ini publik, dan satu permintaan curl berisi
  // `discount: <subtotal>` sudah cukup untuk membayar nyaris nol tanpa promo apa pun tercapai.
  //
  // Sikap yang diambil: nilai nominal dari client DITOLAK, bukan diperbaiki diam-diam. Diam-diam
  // menolnya membuat pemanggil mengira diskonnya masuk; menolak terang-terangan memberi tahu
  // pemanggil bahwa angka uang bukan miliknya untuk ditentukan. Sikapnya sama dengan `shippingCost`
  // dan harga item di bawah: setiap angka berdampak-uang berasal dari server.
  //
  // DITARUH DI SINI, bukan di dekat perhitungan totalnya, dengan sengaja: di bawah sana ia berada
  // SESUDAH verifikasi ongkir, yang memanggil API Mengantar BERBAYAR. Permintaan yang sudah pasti
  // ditolak tak boleh menghabiskan kuota panggilan berbayar lebih dulu — dan sebagai efeknya,
  // penolakan ini kini bisa diuji tanpa memanggil Mengantar sama sekali.
  //
  // Kenapa tidak sekalian menghitung diskonnya dari tabel promotions: promo bertipe
  // discount_nominal / discount_percent memang BELUM di-wire ke pesanan sama sekali (lihat
  // computePromoRewards di @/lib/promo-cart yang saat ini hanya dipakai untuk TAMPILAN keranjang).
  // Menyalakannya sebagai efek samping penutupan temuan keamanan berarti mengubah jumlah yang
  // benar-benar ditagih ke pembeli — keputusan bisnis, bukan perbaikan keamanan. Yang wajib
  // sekarang adalah menutup jalur kepercayaannya; perhitungan otoritatifnya menyusul bersama
  // wiring promonya, dan tempatnya adalah di dekat perhitungan total di bawah.
  const claimedDiscount = (body as { discount?: unknown }).discount
  if (typeof claimedDiscount === 'number' && claimedDiscount > 0) {
    console.warn(
      `${LOG} Permintaan menyertakan discount=${claimedDiscount} — ditolak (SEC-013): nilai diskon ` +
        `hanya boleh ditentukan server dari tabel promotions.`,
    )
    return NextResponse.json(
      { error: 'Diskon tidak dapat ditentukan dari sisi klien.', code: 'DISCOUNT_NOT_ACCEPTED' },
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
    gaClientId?: unknown
    gaSessionId?: unknown
  }

  // Penanda GA4 titipan checkout. Dipakai HANYA untuk pelaporan (lihat analytics-server.ts) —
  // tak pernah menyentuh harga, stok, atau status pesanan, jadi field publik ini tak menambah
  // permukaan serang yang berarti.
  //
  // Tetap disaring bentuknya, persis seperti yang ditulis GA4: client_id = dua angka dipisah
  // titik, session_id = satu angka (stempel waktu unix). Nilai lain dibuang diam-diam. Tanpa
  // penyaringan ini kedua kolom jadi tempat menitipkan teks sembarang dari internet, dan isinya
  // kelak ikut terkirim ke Google atas nama toko ini.
  const gaClientId =
    typeof extra.gaClientId === 'string' && /^\d+\.\d+$/.test(extra.gaClientId)
      ? extra.gaClientId
      : undefined
  const gaSessionId =
    typeof extra.gaSessionId === 'string' && /^\d{1,20}$/.test(extra.gaSessionId)
      ? extra.gaSessionId
      : undefined
  // Varian yang dipilih (fresh, bukan cache) — untuk harga & validasi otoritatif produk bervarian.
  const variantIds = body.items
    .map((it) => (it as OrderItem).variantId)
    .filter((v): v is string => typeof v === 'string' && v.length > 0)

  const claimedComboIds = [...new Set(body.items.map(comboIdOf).filter((v) => v !== undefined))]

  // === SATU GELOMBANG PEMBACAAN, bukan enam giliran ===
  //
  // Keenam pembacaan di bawah hanya bergantung pada `body` — tak satu pun menunggu hasil yang lain.
  // Dulu dipanggil berurutan di sepanjang berkas ini, jadi ongkosnya dijumlahkan: pada fungsi yang
  // berjarak dari database, sepuluh giliran berurutan ≈ dua detik hanya untuk perjalanan pulang
  // pergi, sebelum satu baris pun ditulis (diukur 2026-09-21; lihat catatan region di CLAUDE.md).
  //
  // ⚠️ Yang berubah hanya KAPAN data diambil. URUTAN PEMERIKSAAN di bawah tidak boleh bergeser:
  // minimal belanja tetap diperiksa sebelum ongkir, paket sebelum harga, dan seterusnya. Menarik
  // pembacaan ke depan aman karena semuanya BACA; memindahkan pemeriksaannya tidak.
  const [products, variantMap, claimedCombos, minOrderAmount, promotions, maxDiscountPercent] =
    await Promise.all([
      // Hanya produk yang ada di keranjang — bukan seluruh tabel. Produk hadiah promo (yang
      // mungkin tak ada di keranjang) diambil menyusul, lihat blok di bawah.
      readProductsByIds(body.items.map((it) => it.productId)),
      getVariantsByIds(variantIds),
      Promise.all(claimedComboIds.map((id) => getComboById(id))),
      getMinOrderAmount(),
      readPromotions(),
      getMaxDiscountPercent(),
    ])

  const byId = new Map(products.map((p) => [p.id, p]))

  // Produk HADIAH promo belum tentu ada di keranjang, jadi belum tentu ikut terambil di atas.
  // Diambil menyusul dalam SATU pembacaan tambahan, dan hanya bila memang ada promo hadiah yang
  // produknya belum dikenal — bukan dengan menarik seluruh katalog seperti sebelumnya.
  const freeProductIds = promotions
    .filter((p) => p.type === 'free_product' && p.isActive && p.freeProductId)
    .map((p) => p.freeProductId as string)
    .filter((id) => !byId.has(id))
  if (freeProductIds.length > 0) {
    for (const prod of await readProductsByIds(freeProductIds)) byId.set(prod.id, prod)
  }

  // === Harga paket/combo — OTORITATIF dari DB (SEC-033) ===
  //
  // Sebelum ini server tak mengenal `comboId` sama sekali, sehingga tiap anggota paket jatuh ke
  // `prod.promoPrice` di cabang terakhir. Akibatnya pembeli melihat harga paket di layar lalu
  // DITAGIH harga satuan — arah kerugiannya terbalik dari kebanyakan temuan: yang dirugikan
  // pembeli, bukan toko.
  //
  // Polanya menyalin dua cabang yang sudah terbukti di bawah (promo_price produk & harga varian):
  // ambil baris otoritatif dari DB, pastikan anak benar-benar milik induknya, baru tetapkan harga.
  const comboUnitPrice = new Map<string, number>() // kunci: `${comboId}::${productId}`

  // Paket yang diklaim tapi TIDAK lolos verifikasi kini DITOLAK 422, bukan diam-diam dihargai
  // satuan seperti sebelumnya (SEC-033 lanjutan).
  //
  // Kenapa berubah sikap: keranjang dulu membiarkan pembeli menghapus satu anggota paket, dan sisa
  // itemnya tetap membawa comboId sambil MENAMPILKAN harga alokasi paket (mis. 11.392). Server
  // menolak pencocokan lalu menagih harga satuan (15.000) — pembeli membayar lebih tanpa
  // diberi tahu. Sejak keranjang memperlakukan paket sebagai satu kesatuan (stepper dikunci,
  // menghapus satu anggota mengeluarkan seluruh paket), klien yang sah TIDAK MUNGKIN lagi
  // mengirim paket rusak. Jadi kalau tetap terjadi, itu cookie basi atau manipulasi — dan
  // menolak terang-terangan jauh lebih baik daripada menagih lebih diam-diam.
  const comboRejected = (nama: string) =>
    NextResponse.json(
      {
        error: `Paket ${nama} sudah berubah atau tidak lengkap. Muat ulang keranjang lalu coba lagi.`,
        code: 'COMBO_INVALID',
      },
      { status: 422 },
    )

  for (const [index, comboId] of claimedComboIds.entries()) {
    // Sudah diambil bersama pembacaan lain di atas; urutannya sama dengan claimedComboIds.
    const combo = claimedCombos[index]
    if (!combo || !combo.isActive) return comboRejected('yang dipilih') // dihapus/dinonaktifkan

    const lines = body.items.filter((it) => comboIdOf(it) === comboId)

    // Isi paket harus berupa KELIPATAN SERAGAM dari definisinya di DB: paket 1-1-1 boleh 3-3-3
    // (tiga paket) tapi tidak 3-3-2; setiap anggota tepat satu baris, tanpa varian, tanpa produk
    // asing. Aturannya satu fungsi yang juga dipakai keranjang (lib/cart-lines.ts) — keranjang
    // tak bisa lagi menyatakan sah sesuatu yang ditolak di sini.
    //
    // Sebelumnya hanya N = 1 yang diterima, dan pemeriksaannya bolong: paket A-B yang dikirim
    // sebagai [A, A] lolos karena jumlah barisnya kebetulan sama dan setiap A cocok.
    if (comboMultiplier(combo.items, lines) === null) return comboRejected(combo.name)

    // Harga dialokasikan ulang di server dengan fungsi yang SAMA PERSIS dengan yang dipakai klien
    // saat menyusun keranjang (allocateComboPrices), memakai comboPrice dari DB. Fungsi yang sama
    // = pembulatan yang sama = total server identik dengan yang dilihat pembeli. Harga di sini
    // harga SATUAN per produk, jadi N paket otomatis bernilai N × harga paket di loop bawah.
    for (const alloc of allocateComboPrices(combo.items, combo.comboPrice)) {
      comboUnitPrice.set(`${comboId}::${alloc.productId}`, alloc.price)
    }
  }

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

    // Paket yang lolos verifikasi di atas dihargai lebih dulu. Yang TIDAK lolos sengaja jatuh ke
    // cabang berikutnya dengan harga satuan, BUKAN ditolak 422: pembeli yang menambah kuantitas
    // setelah memasukkan paket memang sudah keluar dari paket itu, dan menggagalkan checkout-nya
    // lebih merugikan daripada menagih harga satuan yang memang benar untuk isi keranjangnya.
    const comboPrice = comboIdOf(it)
      ? comboUnitPrice.get(`${comboIdOf(it)}::${it.productId}`)
      : undefined

    if (comboPrice !== undefined) {
      subtotal += comboPrice * it.quantity
      pricedItems.push({
        productId: it.productId,
        name: prod.name,
        quantity: it.quantity,
        price: comboPrice, // snapshot harga PAKET hasil alokasi server
        comboId: comboIdOf(it), // → order_items.combo_id, dasar laporan penjualan paket
      })
    } else if (it.variantId) {
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
  const nowMs = Date.now()
  const addedFreeIds = new Set<string>()
  // Peringatan yang ikut dikirim ke pembeli bersama respons sukses (bukan error — pesanannya tetap
  // dibuat). Lihat blok hadiah tak tersedia di bawah.
  const freeProductWarnings: { code: string; promotionId: string; productName: string }[] = []
  // Promo hadiah yang benar-benar diberikan, untuk orders.promo_terpakai. `value` = harga jual
  // hadiah SAAT pesanan dibuat — biaya promo bagi toko. Dulu hadiah tak tercatat di sana sama sekali
  // (hanya order_items.promotion_id, harga 0), sehingga laporan biaya promo hadiah selalu kosong.
  const freeProductPromos: { id: string; name: string; type: string; value: number }[] = []
  for (const promo of promotions) {
    if (promo.type !== 'free_product' || !promo.isActive || !promo.freeProductId) continue
    if (isPromotionExpired(promo.endAt, nowMs)) continue // sudah kedaluwarsa
    if (promo.startAt && new Date(promo.startAt).getTime() > nowMs) continue // belum mulai
    if (subtotal < promo.minPurchase) continue // syarat belanja belum terpenuhi
    if (addedFreeIds.has(promo.freeProductId)) continue // hindari duplikat produk gratis
    const prod = byId.get(promo.freeProductId)
    // Hadiah tak tersedia. Dulu dilewati DIAM-DIAM: pembeli sudah memenuhi syarat, sudah melihat
    // janji hadiah di keranjang, lalu tak menerimanya tanpa satu pun pesan. Kini dicatat sebagai
    // peringatan yang ikut dikirim di respons dan ditampilkan di halaman sukses.
    //
    // Checkout SENGAJA tidak diblokir: menggagalkan pembelian gara-gara bonus yang kebetulan habis
    // jauh lebih merugikan pembeli daripada memberitahunya dengan jujur.
    if (!prod || prod.archived || prod.stock <= 0) {
      freeProductWarnings.push({
        code: 'FREE_PRODUCT_UNAVAILABLE',
        promotionId: promo.id,
        productName: prod?.name ?? promo.freeProductName ?? 'Produk hadiah',
      })
      continue
    }
    addedFreeIds.add(promo.freeProductId)
    freeProductPromos.push({ id: promo.id, name: promo.name, type: promo.type, value: prod.promoPrice })
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
    // DITOLAK. Sampai 2026-09-01 cabang ini justru MENERIMA nilai client dan hanya mencatatnya ke
    // log, dengan alasan menolak akan mematikan checkout tiap kali Mengantar bermasalah. Alasan itu
    // tak bertahan saat diperiksa ulang, dan inilah lubang terakhir temuan SEC-008:
    //
    //   1. Pembeli sah praktis TAK BISA sampai ke sini saat Mengantar mati. Tanpa tarif, bottom
    //      sheet tak punya kurir untuk dipilih, dan tombol bayar tetap terkunci — sudah terbukti
    //      lewat uji "bayar tanpa kurir terpilih → nol request /api/orders/create".
    //   2. Pembeli yang tarifnya baru saja tampil hampir pasti masih tertolong cache 10 menit, jadi
    //      ia tak jatuh ke cabang ini.
    //   3. Yang tersisa di cabang ini karena itu didominasi permintaan yang disusun langsung —
    //      dan menerima angka berdampak-uang dari sana persis kerentanan yang sedang ditutup.
    //      `shippingCost: 0` membuat tagihan Xendit ikut nol-ongkir sementara tarif kurir tetap
    //      ditagih ke toko: Rp4.000–30.000 per pesanan, tanpa jejak.
    //
    // 503, bukan 4xx: sebabnya memang di hulu (Mengantar tak menjawab), bukan kesalahan pembeli,
    // dan status ini memberi tahu klien bahwa mencoba lagi memang masuk akal.
    console.error(
      `${LOG} ongkir TAK BISA DIVERIFIKASI (Mengantar tak menjawab) — permintaan DITOLAK. ` +
        `client=Rp${clientShipping} destination=${body.address.destinationId} weight=${serverWeight}`,
    )
    return NextResponse.json(
      {
        error:
          'Ongkos kirim sedang tidak bisa dipastikan. Silakan pilih ulang kurir pengiriman lalu coba lagi sebentar.',
        code: 'SHIPPING_UNVERIFIED',
      },
      { status: 503 },
    )
  }

  const requestedWarehouseId =
    typeof extra.warehouseId === 'string' && extra.warehouseId ? extra.warehouseId : undefined

  // Yang dicocokkan adalah PASANGAN (gudang, harga), bukan harga saja.
  //
  // Sampai MGT-67 (uji lokal 22 Sep 2026) yang diperiksa hanya "harga ini ada di daftar tarif".
  // Sejak tiap gudang dikutip dari origin-nya sendiri, harga Gudang Jakarta (Rp4.080) lolos
  // pemeriksaan itu walau pesanannya berakhir di Gudang Utama (Rp66.720) — pembeli membayar ongkir
  // rute yang tak pernah dipakai, dan selisihnya dipotong dari saldo Mengantar toko.
  //
  // Tanpa `warehouseId` (klien lama) jatuh ke pencocokan harga saja, seperti perilaku sebelumnya.
  const chosen = quoted!.options.find(
    (o) =>
      Math.round(o.price) === clientShipping &&
      (!requestedWarehouseId || o.warehouseId === requestedWarehouseId),
  )

  if (!chosen) {
    // Angka yang dikirim client bukan tarif yang benar-benar ditawarkan untuk gudang itu.
    //
    // DITOLAK, bukan diam-diam ditimpa dengan tarif server. Menimpanya berarti pembeli ditagih
    // angka yang berbeda dari yang ia lihat di layar — dan bila tarif server lebih mahal, ia
    // membayar lebih tanpa pernah menyetujuinya. Lebih baik ia menghitung ulang ongkir.
    //
    // Tarif juga bisa berubah wajar antara buyer melihat harga dan menekan bayar (cache 10 menit).
    // Karena itu pesannya diarahkan ke tindakan, bukan ke tuduhan.
    console.warn(
      `${LOG} ongkir ditolak: client=Rp${clientShipping} gudang=${requestedWarehouseId ?? '-'} ` +
        `tak ada di tarif sah [${tarifSah.join(', ')}]`,
    )
    return NextResponse.json(
      {
        error:
          'Ongkos kirim sudah berubah. Silakan periksa kembali ongkos kirim lalu coba lagi.',
        code: 'SHIPPING_MISMATCH',
        previousShippingCost: clientShipping,
      },
      { status: 409 },
    )
  }

  // === Gudang pemenuh pesanan — DITENTUKAN SEBELUM ongkir dibekukan ===
  //
  // Urutan ini inti perbaikan MGT-67. Dulu ongkir dikunci lebih dulu (harga pilihan pembeli), promo
  // & total dihitung darinya, BARU gudang dipilih — dan bila gudang pilihan kehabisan stok, gudang
  // penggantinya dipakai dengan ongkir gudang lama. Sekarang gudang final dipilih dulu, lalu
  // ongkir mengikuti gudang itu:
  //
  //   1. Gudang pilihan pembeli masih aktif & stoknya cukup → pakai, dengan harga pilihannya.
  //   2. Tidak → opsi termurah berikutnya dari daftar tarif yang SAMA (`quoted`) yang stoknya cukup:
  //        tarifnya ≤ yang disetujui pembeli → diterima, dan `shippingCost` = tarif gudang itu,
  //                                           supaya ongkos_kirim tetap tarif Mengantar yang asli;
  //        tarifnya > yang disetujui pembeli → DITOLAK (SHIPPING_CHANGED). Pembeli tak boleh
  //                                           ditagih lebih mahal tanpa melihat angkanya.
  //   3. Tak satu pun gudang di daftar tarif punya stok → resolveWarehouseForOrder. Bila gudang itu
  //      ternyata punya stok, tarifnya belum pernah dikutip (daftar `quoted` basi) — diterima hanya
  //      bila origin kutipannya sama dengan gudang pilihan (tarifnya pasti identik, mis. selama
  //      MENGANTAR_PICKUP_ORIGIN_ID terpasang); selain itu SHIPPING_CHANGED. Bila tak punya stok,
  //      biarkan RPC yang menolak dengan pesan stok per produk.
  //
  // `requirements` & `serverWeight` sengaja TIDAK dihitung lagi di sini — keduanya sudah dibuat di
  // atas untuk memverifikasi ongkir. Menghitungnya dua kali pernah membuat kunci cache di blok ini
  // berbeda tipis dari kunci di blok ongkir, dan fallback gudang jadi selalu meleset tanpa gejala.
  let shippingCost = clientShipping
  let warehouse = await pickVerifiedWarehouse(chosen.warehouseId, requirements)

  if (!warehouse) {
    const pengganti = await pickQuotedWarehouseWithStock(
      quoted!.options,
      requirements,
      new Set([chosen.warehouseId]),
    )
    if (pengganti) {
      if (pengganti.price > clientShipping) {
        return shippingChangedResponse(clientShipping, pengganti.price)
      }
      warehouse = pengganti.warehouse
      shippingCost = pengganti.price
    }
  }

  if (!warehouse) {
    const cadangan = await resolveWarehouseForOrder(requirements)
    const cadanganPunyaStok =
      cadangan !== null && (await pickVerifiedWarehouse(cadangan.id, requirements)) !== null
    if (cadangan && cadanganPunyaStok) {
      const [originCadangan, originPilihan] = await Promise.all([
        getQuoteOriginId(cadangan.id),
        getQuoteOriginId(chosen.warehouseId),
      ])
      if (!originCadangan || originCadangan !== originPilihan) {
        return shippingChangedResponse(clientShipping)
      }
    }
    warehouse = cadangan
  }

  // === Promo: dihitung SERVER, tak pernah diterima dari client ===
  //
  // Nilai nominal dari client sudah ditolak jauh di atas (blok SEC-013). Di sini nilainya dihitung
  // sendiri dari tabel promotions, memakai fungsi yang SAMA PERSIS dengan yang dipakai keranjang
  // untuk menampilkan angkanya (computeOrderPromos di @/lib/promo-cart). Satu fungsi, dua
  // pemanggil — selama subtotalnya sama, tampilan dan tagihan mustahil berbeda lagi.
  //
  // Sebelum ini `discount` dipaku 0 sementara keranjang sudah mengurangi totalnya sendiri, sehingga
  // pembeli melihat satu angka lalu ditagih angka yang lebih besar.
  const promoResult = computeOrderPromos(promotions, subtotal, shippingCost, nowMs, {
    maxDiscountPercent,
    minTotal: XENDIT_MIN_AMOUNT,
  })

  if (promoResult.clampedByCap) {
    console.warn(
      `${LOG} diskon dipotong plafon ${maxDiscountPercent}% (subtotal=${subtotal}, diskon=${promoResult.discount})`,
    )
  }
  if (promoResult.clampedByMinTotal) {
    // Bukan kesalahan, tapi WAJIB terlihat: pembeli menerima diskon lebih kecil dari yang
    // dijanjikan promo, dan alasannya ada di batas gateway — bukan di kesalahan hitung.
    console.warn(
      `${LOG} diskon dikurangi agar total tak di bawah batas gateway Rp${XENDIT_MIN_AMOUNT} ` +
        `(subtotal=${subtotal}, ongkir=${shippingCost})`,
    )
  }

  const discount = promoResult.discount
  const shippingSubsidy = promoResult.shippingSubsidy
  const totalAmount = Math.max(0, subtotal + shippingCost - discount - shippingSubsidy)

  const logistics = logistikDariBody((body as { logistics?: unknown }).logistics)

  try {
    // Kirim item & total hasil hitung server (bukan dari client)
    // Field EKSPLISIT, bukan `{ ...body }` (SEC-056).
    //
    // Versi lama menyebar seluruh body permintaan ke saveOrder. CreateOrderInput punya
    // `paymentStatus` dan `status`, dan isValidPayload tak memeriksa keduanya — jadi satu permintaan
    // publik berisi `"paymentStatus": "Lunas"` menyimpan pesanan PAID tanpa pembayaran apa pun, dan
    // `"status": "Selesai"` membuatnya langsung layak diulas sebagai pembeli terverifikasi. Status
    // pesanan baru SELALU nilai bawaan saveOrder (Menunggu / Menunggu Pembayaran); hanya webhook
    // Xendit yang terverifikasi dan OMS yang boleh memindahkannya.
    //
    // Menambah field ke pesanan = tambahkan di sini SETELAH divalidasi. Jangan kembali ke penyebaran
    // body: ia diam-diam menerima setiap field yang kelak ditambahkan ke CreateOrderInput.
    const saved = await saveOrder({
      customerName: body.customerName,
      ...(body.customerPhone !== undefined ? { customerPhone: body.customerPhone } : {}),
      ...(body.customerEmail !== undefined ? { customerEmail: body.customerEmail } : {}),
      address: {
        shippingAddress: body.address.shippingAddress,
        provinsi: teksAlamat(body.address.provinsi),
        kota: teksAlamat(body.address.kota),
        kecamatan: teksAlamat(body.address.kecamatan),
        kelurahan: teksAlamat(body.address.kelurahan),
        kodepos: teksAlamat(body.address.kodepos),
        destinationId: body.address.destinationId,
      },
      ...(logistics ? { logistics } : {}),
      items: pricedItems,
      totalAmount,
      // Ongkir yang SUDAH lolos verifikasi ke tarif Mengantar (lihat blok verifikasi di atas),
      // bukan `extra.shippingCost` mentah dari client. Disimpan ke kolomnya sendiri supaya
      // `jumlah_total` tak lagi jadi satu-satunya jejak — tanpa itu, begitu diskon aktif, ongkir
      // tak bisa dipisahkan lagi dari total.
      shippingCost,
      warehouseId: warehouse?.id,
      // Angka promo hasil hitung server. shippingCost di atas SENGAJA tetap tarif asli Mengantar —
      // subsidinya dicatat terpisah supaya tagihan kurir tetap bisa direkonsiliasi.
      discount,
      shippingSubsidy,
      // Promo diskon & gratis ongkir (mengurangi tagihan) + promo hadiah (tak mengurangi tagihan,
      // dicatat untuk laporan biaya). promo_terpakai hanya disimpan, tak dipakai menghitung total.
      appliedPromos: [...promoResult.appliedPromos, ...freeProductPromos],
    })

    // Penanda GA4 dititipkan ke barisnya SETELAH pesanan tersimpan (UPDATE terpisah, bukan
    // parameter RPC — alasannya di attachGaIdentifiers). Hasilnya tak diperiksa: pesanannya sudah
    // nyata, dan kegagalan mencatat atribusi tak boleh mengubah apa pun yang dilihat pembeli.
    if (gaClientId || gaSessionId) {
      await attachGaIdentifiers(saved.orderId, { clientId: gaClientId, sessionId: gaSessionId })
    }

    // Estimasi lama pengiriman untuk halaman sukses — diambil dari daftar tarif yang SERVER
    // sendiri terima dari Mengantar (`quoted`), untuk gudang yang BENAR-BENAR memenuhi pesanan
    // dan tarif yang BENAR-BENAR dibayar. Bukan dari kiriman browser, dan bukan dari pilihan awal
    // pembeli: kalau gudangnya berganti (MGT-67), estimasinya harus ikut rute yang baru.
    const tarifTerpakai = quoted?.options.find(
      (o) => o.warehouseId === warehouse?.id && Math.round(o.price) === shippingCost,
    )
    if (tarifTerpakai?.estimatedDate) {
      await attachDeliveryEstimate(saved.orderId, tarifTerpakai.estimatedDate)
    }

    // Stok produk berkurang → segarkan cache storefront agar stok tampil akurat.
    // Revalidasi halaman detail tiap produk yang dipesan + beranda + katalog.
    revalidatePath('/')
    revalidatePath('/products')
    for (const it of pricedItems) revalidatePath(`/produk/${it.productId}`)
    // Invalidasi cache baca storefront: stok (products) & jumlah terjual (sales) berubah
    revalidateTag('products', 'max')
    revalidateTag('sales', 'max')

    // invoice dikembalikan agar checkout bisa redirect ke ?invoice=...
    return NextResponse.json(
      {
        success: true,
        invoice: saved.orderId,
        order: saved,
        // Kosong pada alur normal. Terisi bila ada hadiah promo yang tak bisa disertakan —
        // halaman sukses menampilkannya supaya pembeli tak merasa dijanjikan lalu diabaikan.
        ...(freeProductWarnings.length > 0 ? { warnings: freeProductWarnings } : {}),
      },
      { status: 201 },
    )
  } catch (e) {
    // Stok tidak cukup → transaksi sudah di-rollback DB; beri tahu buyer produk mana
    if (e instanceof OrderStockError) {
      // Kalah balapan di RPC: pemeriksaan stok di atas lolos, tapi pembeli lain mengunci & menghabiskan
      // stok gudang ini lebih dulu. Bila gudang LAIN masih sanggup memenuhi pesanan, pembeli tak perlu
      // disuruh menyerah — ongkirnya saja yang harus dihitung ulang dari gudang itu.
      const lain = quoted
        ? await pickQuotedWarehouseWithStock(
            quoted.options,
            requirements,
            new Set(warehouse ? [warehouse.id] : []),
          )
        : null
      if (lain) return shippingChangedResponse(clientShipping, lain.price)
      return NextResponse.json({ error: `Stok produk ${e.productName} tidak mencukupi` }, { status: 409 })
    }
    console.error('Gagal membuat pesanan:', e)
    return NextResponse.json({ error: 'Gagal memproses pesanan. Silakan coba lagi.' }, { status: 500 })
  }
}
