// tests/e2e/promotion-application.spec.ts
// Penerapan PROMOSI ujung ke ujung: dari baris `promotions` di Supabase, lewat tampilan keranjang,
// sampai kolom `diskon` / `ongkos_kirim_ditanggung` / `jumlah_total` di tabel `orders`.
//
// ── Kenapa uji ini ada ──
// Sampai 2026-09-07, TIGA dari empat tipe promo tidak pernah sampai ke pesanan: `free_shipping`,
// `discount_nominal`, dan `discount_percent` hanya hidup sebagai pesan di keranjang, sementara
// server memaku `discount = 0`. Pembeli melihat total yang sudah dipotong lalu ditagih penuh.
// Perbaikannya menyatukan tampilan & tagihan pada satu fungsi (`computeOrderPromos`), dan uji ini
// mengunci hasilnya supaya tak diam-diam terurai lagi.
//
// ── Batasan yang disengaja ──
// 1. `test.describe.serial` WAJIB. Promo adalah keadaan GLOBAL: satu baris `promotions` yang aktif
//    memengaruhi SETIAP pesanan yang dibuat selama ia hidup. Dua uji yang berjalan bersamaan akan
//    saling mengubah angka lawannya. playwright.config.ts menyalakan fullyParallel, jadi tanpa
//    serial berkas ini mustahil dipercaya.
// 2. Setiap uji MENYISIPKAN promonya sendiri lalu MENGHAPUSNYA di blok `finally` — termasuk saat
//    assert-nya gagal. Promo uji yang tertinggal aktif akan mendiskon pesanan pembeli sungguhan.
// 3. Subtotal seluruh skenario sengaja DIJAGA DI BAWAH Rp100.000. Toko ini sudah punya satu promo
//    `free_product` aktif ("Promo day", min_purchase 100.000); melewatinya berarti hadiah itu ikut
//    masuk ke pesanan dan setiap angka yang di-assert jadi meleset tanpa sebab yang kelihatan.
// 4. Pesanan dibuat lewat POST /api/orders/create langsung (kecuali E2E-011 yang memang menguji
//    jalur browser). Yang diuji berkas ini adalah ARITMATIKA promo di server, dan jalur UI-nya
//    sudah dikunci combo-purchase-flow.spec.ts. Panggilan /api/payments/** tak pernah tersentuh,
//    jadi tak ada invoice Xendit berbayar yang terbit (CLAUDE.md → Panggilan API Berbayar).
// 5. `ORDER_CREATE_IP` dibatasi 3 pesanan/menit/IP. Berkas ini membuat 4 pesanan, jadi ada
//    penjeda `tungguJatahOrder()` — tanpa itu uji keempat selalu 429 dan kegagalannya menyesatkan.

import {
  test,
  expect,
  type Page,
  type BrowserContext,
  type APIRequestContext,
} from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

// === Akses Supabase langsung (menyisipkan promo, assert hasil, membersihkan) ===
//
// Kredensial dibaca dari .env.local saat runtime — tidak di-hardcode, tidak ikut ter-commit.
// service_role dipakai karena uji perlu MENULIS ke `promotions` dan membaca `order_items`;
// keduanya tertutup rapat dari anon key.
function bacaEnv(nama: string): string {
  const berkas = path.join(process.cwd(), '.env.local')
  const isi = fs.readFileSync(berkas, 'utf-8')
  const cocok = isi.match(new RegExp(`^${nama}=(.*)$`, 'm'))
  const nilai = cocok?.[1]?.trim()
  if (!nilai) throw new Error(`${nama} tidak ada di .env.local — uji ini butuh akses Supabase`)
  return nilai
}

const SUPABASE_URL = bacaEnv('NEXT_PUBLIC_SUPABASE_URL')
const SERVICE_KEY = bacaEnv('SUPABASE_SERVICE_ROLE_KEY')

async function sb<T>(
  request: APIRequestContext,
  jalur: string,
  init: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; data?: unknown } = {},
): Promise<T> {
  const res = await request.fetch(`${SUPABASE_URL}/rest/v1/${jalur}`, {
    method: init.method ?? 'GET',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    ...(init.data ? { data: init.data } : {}),
  })
  const teks = await res.text()
  expect(res.ok(), `Supabase ${jalur} gagal: ${res.status()} ${teks.slice(0, 200)}`).toBeTruthy()
  return (teks ? JSON.parse(teks) : null) as T
}

// === Tipe & konstanta ===

type Produk = {
  id: string
  name: string
  promo_price: number
  stock: number
  berat: number | null
  min_order_qty: number | null
}

type BarisPesanan = {
  product_id: string
  quantity: number
  price_at_purchase: number
  is_promo_item: boolean | null
  promotion_id: string | null
}

type Pesanan = {
  id: string
  nomor_invoice: string
  jumlah_total: number
  ongkos_kirim: number
  diskon: number | null
  ongkos_kirim_ditanggung: number | null
  warehouse_id: string | null
}

// destination_id kelurahan GAMBIR, Jakarta Pusat — tujuan yang paling andal di sandbox Mengantar.
const DESTINATION_JAKARTA = '5fc62f63f8f44b34aa4c0e0a'

// Awalan nama pemesan untuk SELURUH pesanan uji di berkas ini. Pembersihan menyapu berdasarkan
// awalan ini, jadi run yang mati di tengah tetap bisa dirapikan run berikutnya.
const NAMA_UJI = 'E2E Promo'

const ALAMAT = {
  telepon: '081234567890',
  email: 'e2e.promo@contoh.test',
  jalan: 'Jl. Uji Promosi No. 9',
  cari: 'gambir',
  provinsi: 'DKI JAKARTA',
  kota: 'JAKARTA PUSAT',
  kecamatan: 'GAMBIR',
  kelurahan: 'GAMBIR',
  kodepos: '10110',
}

// Penanda unik di progress_message tiap promo uji. Toko sudah punya promo lain yang ikut tampil di
// keranjang; tanpa penanda, assert "pesan progres muncul" bisa lolos karena pesan promo ORANG LAIN.
const TANDA = {
  ongkir: 'E2E008 kurang {sisa} lagi untuk gratis ongkir',
  hadiah: 'E2E009 kurang {sisa} lagi untuk hadiah',
  persen: 'E2E010 kurang {sisa} lagi untuk diskon',
  abuse: 'E2E011 kurang {sisa} lagi untuk gratis ongkir',
}

// === Penjeda pembatas laju ===
//
// RATE_LIMITS.ORDER_CREATE_IP = 3 per menit per IP (lihat src/lib/rate-limit.ts). Seluruh uji di
// sini berbagi satu IP (localhost), jadi jatahnya dihitung bersama. Menunggu 1 detik lebih lama
// dari jendelanya menghindari balapan dengan pembulatan jam di sisi server.
const JENDELA_MS = 60_000
const JATAH = 3
const jejakOrder: number[] = []

async function tungguJatahOrder(): Promise<void> {
  for (;;) {
    const sekarang = Date.now()
    while (jejakOrder.length > 0 && sekarang - jejakOrder[0] > JENDELA_MS) jejakOrder.shift()
    if (jejakOrder.length < JATAH) {
      jejakOrder.push(sekarang)
      return
    }
    const tunggu = JENDELA_MS - (sekarang - jejakOrder[0]) + 1_000
    console.log(`[promo-e2e] jatah ORDER_CREATE_IP habis — menunggu ${Math.ceil(tunggu / 1000)} dtk`)
    await new Promise((r) => setTimeout(r, tunggu))
  }
}

// === Helper data ===

// Produk yang layak dipakai uji: punya berat (tanpa itu perhitungan ongkir tak jalan), tanpa
// minimum kuantitas khusus, dan stoknya lapang. Sengaja DICARI, bukan di-hardcode — id produk
// berubah antar database dan uji yang memaku id akan mati diam-diam saat datanya diganti.
async function ambilProdukLayak(request: APIRequestContext): Promise<Produk[]> {
  const rows = await sb<Produk[]>(
    request,
    'products?select=id,name,promo_price,stock,berat,min_order_qty&archived=eq.false&order=promo_price.asc',
  )
  const layak = rows.filter(
    (p) => (p.berat ?? 0) > 0 && (p.min_order_qty ?? 1) === 1 && p.stock >= 30 && p.promo_price > 0,
  )
  expect(
    layak.length,
    'butuh ≥2 produk aktif berberat, tanpa minimum kuantitas, dan berstok ≥30',
  ).toBeGreaterThanOrEqual(2)
  return layak
}

type PromoInput = {
  name: string
  type: 'free_shipping' | 'free_product' | 'discount_nominal' | 'discount_percent'
  min_purchase: number
  progress_message: string
  discount_value?: number
  free_product_id?: string
  free_product_name?: string
}

// Menyisipkan satu promo AKTIF yang periodenya mencakup waktu sekarang, lalu mengembalikan id-nya.
// start_at/end_at diisi eksplisit (bukan dibiarkan null) supaya uji ini benar-benar melewati
// penyaringan waktu di server, bukan cuma cabang "periode tak terbatas".
async function buatPromo(request: APIRequestContext, input: PromoInput): Promise<string> {
  const sekarang = Date.now()
  const [baris] = await sb<{ id: string }[]>(request, 'promotions', {
    method: 'POST',
    data: {
      ...input,
      start_at: new Date(sekarang - 60 * 60 * 1000).toISOString(), // 1 jam lalu
      end_at: new Date(sekarang + 24 * 60 * 60 * 1000).toISOString(), // 1 hari lagi
      is_active: true,
    },
  })
  expect(baris?.id, 'promo uji gagal disisipkan').toBeTruthy()
  return baris.id
}

async function hapusPromo(request: APIRequestContext, id: string | null): Promise<void> {
  if (!id) return
  await sb(request, `promotions?id=eq.${id}`, { method: 'DELETE' })
}

// Menulis isi keranjang langsung ke cookie, memakai penyandian yang SAMA PERSIS dengan
// writeCookie() di src/lib/cart-client.ts (JSON → UTF-8 → base64).
//
// Kenapa tidak lewat klik "Tambah ke Keranjang": jalur itu sudah dikunci uji lain, dan yang
// diperiksa di sini adalah reaksi promo terhadap SUBTOTAL. Menyetel subtotal langsung membuat
// uji ini cepat dan tak bergantung pada tata letak halaman produk.
async function pasangKeranjang(
  page: Page,
  baseURL: string,
  items: { productId: string; quantity: number; price: number }[],
): Promise<void> {
  await page.goto(`${baseURL}/keranjang`)
  await page.evaluate((isi) => {
    const json = JSON.stringify(isi)
    const bytes = new TextEncoder().encode(json)
    let binary = ''
    for (const b of bytes) binary += String.fromCharCode(b)
    document.cookie = `infarm_cart=${btoa(binary)}; path=/; max-age=604800; SameSite=Lax`
  }, items)
  await page.reload()
}

// Tarif ongkir yang SAH menurut server untuk isi keranjang tertentu.
//
// ⚠️ `items` WAJIB memuat produk hadiah bila promo free_product akan tercapai. Server menimbang
// ulang seluruh isi pesanan TERMASUK hadiahnya, lalu menolak `shippingCost` yang tak ada di daftar
// tarif untuk berat itu. Mengirim tarif hasil hitungan tanpa hadiah = pesanan ditolak, dan
// sebabnya tak akan kelihatan dari pesan errornya.
async function ambilTarifOngkir(
  request: APIRequestContext,
  baseURL: string,
  items: { productId: string; quantity: number }[],
): Promise<{ price: number; warehouseId: string }> {
  const res = await request.post(`${baseURL}/api/mengantar/shipping/options`, {
    data: { destinationId: DESTINATION_JAKARTA, weight: 1, items },
  })
  expect(res.ok(), 'perbandingan ongkir harus berhasil').toBeTruthy()
  const { options = [] } = (await res.json()) as { options?: { price: number; warehouseId: string }[] }
  expect(options.length, 'butuh minimal satu opsi ongkir dari Mengantar').toBeGreaterThan(0)
  return { price: Math.round(options[0].price), warehouseId: options[0].warehouseId }
}

type KirimOpts = {
  nama: string
  items: { productId: string; name: string; quantity: number; price: number }[]
  shippingCost: number
  warehouseId?: string
  extra?: Record<string, unknown>
}

// POST /api/orders/create — jalur otoritatif yang sama dengan yang dipakai tombol Bayar.
async function kirimPesanan(
  request: APIRequestContext,
  baseURL: string,
  opts: KirimOpts,
): Promise<{ status: number; body: Record<string, unknown> }> {
  await tungguJatahOrder()
  const res = await request.post(`${baseURL}/api/orders/create`, {
    data: {
      customerName: opts.nama,
      customerPhone: ALAMAT.telepon,
      customerEmail: ALAMAT.email,
      items: opts.items,
      totalAmount: 0, // diabaikan server — total dihitung ulang dari DB (SEC-013)
      address: {
        shippingAddress: ALAMAT.jalan,
        destinationId: DESTINATION_JAKARTA,
        provinsi: ALAMAT.provinsi,
        kota: ALAMAT.kota,
        kecamatan: ALAMAT.kecamatan,
        kelurahan: ALAMAT.kelurahan,
        kodepos: ALAMAT.kodepos,
      },
      logistics: { courier: 'J&T', service: 'Reguler' },
      shippingCost: opts.shippingCost,
      ...(opts.warehouseId ? { warehouseId: opts.warehouseId } : {}),
      ...(opts.extra ?? {}),
    },
  })
  const teks = await res.text()
  let body: Record<string, unknown> = {}
  try {
    body = teks ? (JSON.parse(teks) as Record<string, unknown>) : {}
  } catch {
    body = { raw: teks.slice(0, 200) }
  }
  return { status: res.status(), body }
}

async function ambilPesanan(request: APIRequestContext, invoice: string): Promise<Pesanan> {
  const rows = await sb<Pesanan[]>(
    request,
    `orders?select=id,nomor_invoice,jumlah_total,ongkos_kirim,diskon,ongkos_kirim_ditanggung,warehouse_id&nomor_invoice=eq.${invoice}`,
  )
  expect(rows.length, `pesanan ${invoice} tak ditemukan di database`).toBe(1)
  return rows[0]
}

async function ambilBaris(request: APIRequestContext, orderId: string): Promise<BarisPesanan[]> {
  return sb<BarisPesanan[]>(
    request,
    `order_items?select=product_id,quantity,price_at_purchase,is_promo_item,promotion_id&order_id=eq.${orderId}`,
  )
}

async function stokProduk(request: APIRequestContext, productId: string): Promise<number> {
  const [p] = await sb<{ stock: number }[]>(
    request,
    `products?select=stock&id=eq.${productId}`,
  )
  return p?.stock ?? -1
}

// Menyapu SELURUH pesanan uji berkas ini dan mengembalikan stoknya — pola yang sama dengan
// combo-purchase-flow.spec.ts. Sengaja menyapu berdasarkan AWALAN NAMA, bukan hanya pesanan run
// ini: run yang gagal di tengah tak pernah sampai ke pembersihan, dan pesanan yatimnya menahan
// stok sampai ada yang membereskannya.
async function bersihkanPesananUji(request: APIRequestContext): Promise<number> {
  const yatim = await sb<{ id: string; warehouse_id: string | null }[]>(
    request,
    `orders?select=id,warehouse_id&nama_customer=like.${encodeURIComponent(NAMA_UJI)}*`,
  )

  for (const o of yatim) {
    const items = await sb<{ product_id: string; quantity: number }[]>(
      request,
      `order_items?select=product_id,quantity&order_id=eq.${o.id}`,
    )
    for (const it of items) {
      const [p] = await sb<{ id: string; stock: number }[]>(
        request,
        `products?select=id,stock&id=eq.${it.product_id}`,
      )
      if (p) {
        await sb(request, `products?id=eq.${p.id}`, {
          method: 'PATCH',
          data: { stock: p.stock + it.quantity },
        })
      }
      // Stok per gudang WAJIB ikut dipulihkan: RPC memotong dari sini bila barisnya ada, dan
      // memulihkan products.stock saja meninggalkan kedua tabel tak sinkron secara diam-diam.
      if (o.warehouse_id) {
        const [w] = await sb<{ id: string; stok: number }[]>(
          request,
          `product_stock_per_warehouse?select=id,stok&product_id=eq.${it.product_id}&warehouse_id=eq.${o.warehouse_id}`,
        )
        if (w) {
          await sb(request, `product_stock_per_warehouse?id=eq.${w.id}`, {
            method: 'PATCH',
            data: { stok: w.stok + it.quantity },
          })
        }
      }
    }
    await sb(request, `order_items?order_id=eq.${o.id}`, { method: 'DELETE' })
    await sb(request, `stock_mutations?order_id=eq.${o.id}`, { method: 'DELETE' })
    await sb(request, `orders?id=eq.${o.id}`, { method: 'DELETE' })
  }
  return yatim.length
}

test.describe.serial('Penerapan promosi', () => {
  // Satu context untuk seluruh berkas: keranjang hidup di COOKIE, dan fixture `page` bawaan
  // memberi context baru tiap uji sehingga isinya lenyap di antara skenario.
  let context: BrowserContext
  let halaman: Page
  let produk: Produk[]

  test.beforeAll(async ({ browser, request }) => {
    context = await browser.newContext({ locale: 'id-ID', timezoneId: 'Asia/Jakarta' })
    halaman = await context.newPage()
    produk = await ambilProdukLayak(request)
    // Bereskan sisa run sebelumnya SEBELUM mengukur apa pun — stok yang masih tertahan pesanan
    // yatim membuat assert stok di E2E-009 meleset tanpa sebab yang kelihatan.
    await bersihkanPesananUji(request)
  })

  test.afterAll(async ({ request }) => {
    await bersihkanPesananUji(request)
    // Jaring pengaman terakhir: promo uji yang lolos dari blok finally mana pun harus mati di sini.
    // Promo uji yang tertinggal AKTIF akan mendiskon pesanan pembeli sungguhan.
    await sb(request, `promotions?name=like.${encodeURIComponent(NAMA_UJI)}*`, { method: 'DELETE' })
    await context.close()
  })

  // ── E2E-008 ───────────────────────────────────────────────────────────────────────────────
  test('E2E-008 free_shipping: pesan progres lalu ongkir ditanggung penuh', async ({
    request,
    baseURL,
  }) => {
    test.setTimeout(180_000)
    const utama = produk[0]
    const minBelanja = utama.promo_price * 7 // tercapai tepat di 7 unit
    let promoId: string | null = null

    try {
      promoId = await buatPromo(request, {
        name: `${NAMA_UJI} Gratis Ongkir`,
        type: 'free_shipping',
        min_purchase: minBelanja,
        progress_message: TANDA.ongkir,
      })

      // ── (a) BELUM memenuhi syarat → pesan progres tampil, bukan pesan sukses ──
      await pasangKeranjang(halaman, baseURL!, [
        { productId: utama.id, quantity: 2, price: utama.promo_price },
      ])
      // Pesan progres memuat token {sisa} yang diganti nominal rupiah, jadi yang dicocokkan
      // hanya bagian tetapnya.
      await expect(
        halaman.getByText(/E2E008 kurang .* lagi untuk gratis ongkir/),
        'pesan progres promo harus tampil saat subtotal belum mencapai minimal',
      ).toBeVisible({ timeout: 20_000 })

      // ── (b) SUDAH memenuhi syarat → pesan sukses menggantikan pesan progres ──
      await pasangKeranjang(halaman, baseURL!, [
        { productId: utama.id, quantity: 7, price: utama.promo_price },
      ])
      await expect(
        halaman.getByText('🎉 Selamat! Kamu mendapatkan gratis ongkir'),
        'pesan sukses gratis ongkir harus tampil saat subtotal mencapai minimal',
      ).toBeVisible({ timeout: 20_000 })
      await expect(
        halaman.getByText(/E2E008 kurang .* lagi untuk gratis ongkir/),
        'pesan progres harus HILANG setelah syaratnya terpenuhi',
      ).toHaveCount(0)

      // ── (c) Selesaikan checkout, lalu periksa angkanya di database ──
      const items = [{ productId: utama.id, quantity: 7 }]
      const tarif = await ambilTarifOngkir(request, baseURL!, items)
      expect(tarif.price, 'tarif ongkir harus > 0 agar subsidinya bermakna').toBeGreaterThan(0)

      const { status, body } = await kirimPesanan(request, baseURL!, {
        nama: `${NAMA_UJI} Ongkir`,
        items: [
          { productId: utama.id, name: utama.name, quantity: 7, price: utama.promo_price },
        ],
        shippingCost: tarif.price,
        warehouseId: tarif.warehouseId,
      })
      expect(status, `pesanan harus 201, dapat ${status}: ${JSON.stringify(body)}`).toBe(201)

      const pesanan = await ambilPesanan(request, String(body.invoice))
      const subtotal = utama.promo_price * 7

      // Ongkir ASLI tetap tercatat — kolom itu dipakai merekonsiliasi tagihan kurir. Yang
      // menghapus bebannya dari pembeli adalah kolom subsidi, bukan menolkan tarifnya.
      expect(pesanan.ongkos_kirim, 'ongkos_kirim harus tetap berisi tarif kurir sebenarnya').toBe(
        tarif.price,
      )
      expect(
        pesanan.ongkos_kirim_ditanggung,
        'subsidi ongkir harus sebesar tarif penuh',
      ).toBe(tarif.price)
      expect(
        pesanan.jumlah_total,
        'jumlah_total TIDAK boleh memasukkan ongkir saat gratis ongkir tercapai',
      ).toBe(subtotal)
      expect(pesanan.diskon ?? 0, 'promo gratis ongkir tak boleh ikut memotong harga barang').toBe(0)
    } finally {
      // URUTANNYA MENGIKAT: pesanan dulu, promo belakangan. order_items.promotion_id punya
      // foreign key ON DELETE NO ACTION, jadi promo yang sudah dirujuk sebuah pesanan MENOLAK
      // dihapus (23503) selama baris pesanannya masih ada. Membalik urutan ini membuat blok
      // pembersihan sendiri yang menggagalkan uji — persis yang terjadi pada jalannya uji pertama.
      await bersihkanPesananUji(request)
      await hapusPromo(request, promoId)
    }
  })

  // ── E2E-009 ───────────────────────────────────────────────────────────────────────────────
  test('E2E-009 free_product: hadiah masuk keranjang, tersimpan Rp0, dan stoknya berkurang', async ({
    request,
    baseURL,
  }) => {
    test.setTimeout(180_000)
    const utama = produk[0]
    // Hadiah = produk TERRINGAN selain produk utama. Berat hadiah ikut ditimbang server, jadi
    // memilih yang paling ringan menjaga tarif ongkirnya tetap sederhana.
    const hadiah = produk
      .filter((p) => p.id !== utama.id)
      .sort((a, b) => (a.berat ?? 0) - (b.berat ?? 0))[0]
    const minBelanja = utama.promo_price * 3
    let promoId: string | null = null

    try {
      promoId = await buatPromo(request, {
        name: `${NAMA_UJI} Hadiah`,
        type: 'free_product',
        min_purchase: minBelanja,
        progress_message: TANDA.hadiah,
        free_product_id: hadiah.id,
        free_product_name: hadiah.name,
      })

      const stokHadiahAwal = await stokProduk(request, hadiah.id)

      // ── (a) Syarat terpenuhi → hadiah muncul di keranjang tanpa ditambahkan pembeli ──
      await pasangKeranjang(halaman, baseURL!, [
        { productId: utama.id, quantity: 4, price: utama.promo_price },
      ])
      await expect(
        halaman.getByText('🎉 Selamat! Kamu mendapatkan ' + hadiah.name),
        'pesan sukses hadiah harus tampil setelah syarat terpenuhi',
      ).toBeVisible({ timeout: 20_000 })
      // Kartu hadiah punya pita "Gratis" dan harga "Gratis" — bukan Rp0 polos.
      await expect(
        halaman.getByText('Gratis').first(),
        'kartu produk hadiah harus muncul di keranjang',
      ).toBeVisible({ timeout: 20_000 })

      // ── (b) Pesanan menyimpan hadiah sebagai baris Rp0 ──
      // Hadiah IKUT dimasukkan ke perhitungan ongkir: server menimbang seluruh isi pesanan,
      // termasuk hadiahnya, lalu menolak shippingCost yang tak cocok dengan berat itu.
      const tarif = await ambilTarifOngkir(request, baseURL!, [
        { productId: utama.id, quantity: 4 },
        { productId: hadiah.id, quantity: 1 },
      ])

      const { status, body } = await kirimPesanan(request, baseURL!, {
        nama: `${NAMA_UJI} Hadiah`,
        // Hadiahnya SENGAJA tidak dikirim client — server yang wajib menambahkannya sendiri.
        items: [{ productId: utama.id, name: utama.name, quantity: 4, price: utama.promo_price }],
        shippingCost: tarif.price,
        warehouseId: tarif.warehouseId,
      })
      expect(status, `pesanan harus 201, dapat ${status}: ${JSON.stringify(body)}`).toBe(201)

      const pesanan = await ambilPesanan(request, String(body.invoice))
      const baris = await ambilBaris(request, pesanan.id)

      const barisHadiah = baris.find((b) => b.product_id === hadiah.id)
      expect(barisHadiah, 'baris produk hadiah harus ada di order_items').toBeTruthy()
      expect(barisHadiah!.price_at_purchase, 'harga hadiah harus 0').toBe(0)
      expect(barisHadiah!.quantity, 'hadiah diberikan 1 unit').toBe(1)
      expect(barisHadiah!.is_promo_item, 'baris hadiah harus ditandai is_promo_item').toBe(true)
      expect(barisHadiah!.promotion_id, 'baris hadiah harus menunjuk promo asalnya').toBe(promoId)

      // Hadiah tak boleh menambah tagihan sepeser pun.
      expect(pesanan.jumlah_total, 'total = subtotal barang + ongkir, hadiah tak menambah').toBe(
        utama.promo_price * 4 + tarif.price,
      )

      // ── (c) Hadiah adalah barang fisik: stoknya WAJIB ikut berkurang ──
      const stokHadiahAkhir = await stokProduk(request, hadiah.id)
      expect(
        stokHadiahAkhir,
        'stok produk hadiah harus berkurang 1 — hadiah tetap barang yang dikirim',
      ).toBe(stokHadiahAwal - 1)
    } finally {
      // URUTANNYA MENGIKAT: pesanan dulu, promo belakangan. order_items.promotion_id punya
      // foreign key ON DELETE NO ACTION, jadi promo yang sudah dirujuk sebuah pesanan MENOLAK
      // dihapus (23503) selama baris pesanannya masih ada. Membalik urutan ini membuat blok
      // pembersihan sendiri yang menggagalkan uji — persis yang terjadi pada jalannya uji pertama.
      await bersihkanPesananUji(request)
      await hapusPromo(request, promoId)
    }
  })

  // ── E2E-010 ───────────────────────────────────────────────────────────────────────────────
  test('E2E-010 discount_percent: hasil desimal dibulatkan, jumlah_total tetap bilangan bulat', async ({
    request,
    baseURL,
  }) => {
    test.setTimeout(180_000)
    const utama = produk[0]
    let promoId: string | null = null

    // Seluruh harga produk di toko ini kelipatan 100, sehingga subtotal × persen ÷ 100 SELALU
    // bilangan bulat dan pembulatannya tak pernah benar-benar diuji. Supaya skenario ini bermakna,
    // harga produk uji diubah sementara ke angka yang tidak bulat, lalu DIKEMBALIKAN di `finally`.
    // Pola yang sama dipakai E2E-006 pada stok.
    const hargaAsli = utama.promo_price
    const hargaUji = 6_333 // sengaja bukan kelipatan 100
    const qty = 5
    const persen = 7
    const subtotal = hargaUji * qty // 31.665
    const diskonTepat = (subtotal * persen) / 100 // 2.216,55 → HARUS dibulatkan
    const diskonHarap = Math.round(diskonTepat) // 2.217

    try {
      expect(
        Number.isInteger(diskonTepat),
        'prasyarat skenario: perhitungan manualnya HARUS desimal, kalau bulat uji ini tak menguji apa pun',
      ).toBe(false)

      await sb(request, `products?id=eq.${utama.id}`, {
        method: 'PATCH',
        data: { promo_price: hargaUji },
      })

      promoId = await buatPromo(request, {
        name: `${NAMA_UJI} Persen`,
        type: 'discount_percent',
        min_purchase: 10_000,
        progress_message: TANDA.persen,
        discount_value: persen,
      })

      const tarif = await ambilTarifOngkir(request, baseURL!, [{ productId: utama.id, quantity: qty }])

      const { status, body } = await kirimPesanan(request, baseURL!, {
        nama: `${NAMA_UJI} Persen`,
        items: [{ productId: utama.id, name: utama.name, quantity: qty, price: hargaUji }],
        shippingCost: tarif.price,
        warehouseId: tarif.warehouseId,
      })
      expect(status, `pesanan harus 201, dapat ${status}: ${JSON.stringify(body)}`).toBe(201)

      const pesanan = await ambilPesanan(request, String(body.invoice))

      expect(pesanan.diskon, 'diskon harus hasil pembulatan, bukan angka desimal').toBe(diskonHarap)
      expect(
        Number.isInteger(pesanan.diskon),
        'kolom diskon WAJIB bilangan bulat murni',
      ).toBe(true)
      expect(
        Number.isInteger(pesanan.jumlah_total),
        'kolom jumlah_total WAJIB bilangan bulat murni — rupiah tak mengenal pecahan',
      ).toBe(true)
      expect(pesanan.jumlah_total, 'total = subtotal + ongkir − diskon').toBe(
        subtotal + tarif.price - diskonHarap,
      )
    } finally {
      // Harga produk toko DIKEMBALIKAN apa pun hasil assert di atas. Kalau tidak, satu uji yang
      // gagal meninggalkan harga palsu di katalog yang dilihat pembeli sungguhan.
      await sb(request, `products?id=eq.${utama.id}`, {
        method: 'PATCH',
        data: { promo_price: hargaAsli },
      })
      // URUTANNYA MENGIKAT: pesanan dulu, promo belakangan. order_items.promotion_id punya
      // foreign key ON DELETE NO ACTION, jadi promo yang sudah dirujuk sebuah pesanan MENOLAK
      // dihapus (23503) selama baris pesanannya masih ada. Membalik urutan ini membuat blok
      // pembersihan sendiri yang menggagalkan uji — persis yang terjadi pada jalannya uji pertama.
      await bersihkanPesananUji(request)
      await hapusPromo(request, promoId)
    }
  })

  // ── E2E-011 ───────────────────────────────────────────────────────────────────────────────
  test('E2E-011 manipulasi klien: diskon & ongkir palsu dari browser ditolak server', async ({
    request,
    baseURL,
  }) => {
    test.setTimeout(180_000)
    const utama = produk[0]
    // min_purchase sengaja JAUH DI ATAS subtotal keranjang: promonya ADA dan aktif, tapi syaratnya
    // TIDAK terpenuhi. Itulah inti skenario — klien mengklaim hadiah yang belum ia dapatkan.
    const subtotal = utama.promo_price * 3
    let promoId: string | null = null
    const temuan: string[] = []

    try {
      promoId = await buatPromo(request, {
        name: `${NAMA_UJI} Abuse`,
        type: 'free_shipping',
        min_purchase: subtotal * 10,
        progress_message: TANDA.abuse,
      })

      const items = [{ productId: utama.id, quantity: 3 }]
      const tarif = await ambilTarifOngkir(request, baseURL!, items)

      // ── (a) Payload disunting DI TENGAH JALAN lewat page.route() ──
      // Ini meniru penyerang yang mengubah permintaan sesudah halaman menyusunnya: bukan sekadar
      // curl dari luar, melainkan browser sungguhan yang membawa cookie & header aslinya.
      await halaman.route('**/api/orders/create', async (route) => {
        const asli = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>
        await route.continue({
          postData: JSON.stringify({
            ...asli,
            discount: subtotal, // klaim diskon sebesar seluruh belanja
            shippingCost: 0, // klaim gratis ongkir padahal syaratnya tak terpenuhi
            totalAmount: 0,
          }),
        })
      })

      await tungguJatahOrder()
      const hasil = await halaman.evaluate(
        async ({ payload, url }) => {
          const r = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          return { status: r.status, body: await r.text() }
        },
        {
          url: `${baseURL}/api/orders/create`,
          payload: {
            customerName: `${NAMA_UJI} Abuse`,
            customerPhone: ALAMAT.telepon,
            customerEmail: ALAMAT.email,
            items: [
              { productId: utama.id, name: utama.name, quantity: 3, price: utama.promo_price },
            ],
            totalAmount: subtotal + tarif.price,
            address: {
              shippingAddress: ALAMAT.jalan,
              destinationId: DESTINATION_JAKARTA,
              provinsi: ALAMAT.provinsi,
              kota: ALAMAT.kota,
              kecamatan: ALAMAT.kecamatan,
              kelurahan: ALAMAT.kelurahan,
              kodepos: ALAMAT.kodepos,
            },
            logistics: { courier: 'J&T', service: 'Reguler' },
            shippingCost: tarif.price,
          },
        },
      )
      await halaman.unroute('**/api/orders/create')

      let body: Record<string, unknown> = {}
      try {
        body = JSON.parse(hasil.body) as Record<string, unknown>
      } catch {
        body = { raw: hasil.body.slice(0, 200) }
      }

      // ── (b) Vonis ──
      //
      // Perilaku yang BENAR: server menolak mentah-mentah nilai uang dari klien. Sejak SEC-013,
      // `discount` bukan lagi di-clamp melainkan DITOLAK dengan 422 `DISCOUNT_NOT_ACCEPTED` —
      // clamp lama (`Math.min(discount, subtotal)`) masih meloloskan pembayaran nyaris nol.
      if (hasil.status === 201) {
        // Pesanan TERBENTUK meski payloadnya dipalsukan → periksa apakah uangnya ikut palsu.
        const pesanan = await ambilPesanan(request, String(body.invoice))
        if ((pesanan.diskon ?? 0) > 0) {
          temuan.push(
            `server MENERIMA diskon dari klien: kolom diskon terisi ${pesanan.diskon} padahal ` +
              'tak satu pun promo diskon memenuhi syarat',
          )
        }
        if ((pesanan.ongkos_kirim_ditanggung ?? 0) > 0) {
          temuan.push(
            `server MENERIMA klaim gratis ongkir: ongkos_kirim_ditanggung terisi ` +
              `${pesanan.ongkos_kirim_ditanggung} padahal min_purchase promo tak tercapai`,
          )
        }
        if (pesanan.jumlah_total < subtotal) {
          temuan.push(
            `jumlah_total ${pesanan.jumlah_total} LEBIH KECIL dari subtotal barang ${subtotal} — ` +
              'pembeli membayar kurang dari harga barangnya',
          )
        }
      }

      if (temuan.length > 0) {
        // Dicetak ke keluaran uji supaya terbaca tanpa membuka database. Pesan assert-nya dibuat
        // panjang dan eksplisit: temuan sekelas ini tak boleh terlewat saat membaca log CI.
        console.error(
          '\n===== TEMUAN KRITIS — server tidak memvalidasi ulang nilai uang dari klien =====\n' +
            temuan.map((t) => ` • ${t}`).join('\n') +
            '\n PERLU DIBUAT SEC-XXX BARU (Critical) di database Audit Security.\n' +
            '================================================================================\n',
        )
      }

      expect(
        temuan,
        'TEMUAN KRITIS: server mengikuti nilai uang yang dikirim klien tanpa menghitung ulang',
      ).toEqual([])

      // Penolakannya harus eksplisit, bukan kebetulan gagal karena sebab lain.
      expect(
        hasil.status,
        `permintaan ber-discount palsu harus DITOLAK, bukan 201. Respons: ${hasil.body.slice(0, 200)}`,
      ).not.toBe(201)
      expect(
        body.code,
        `penolakan harus eksplisit DISCOUNT_NOT_ACCEPTED (SEC-013), dapat: ${hasil.body.slice(0, 200)}`,
      ).toBe('DISCOUNT_NOT_ACCEPTED')

      // Dan tak boleh ada pesanan separuh jadi yang tertinggal dari percobaan itu.
      const nyangkut = await sb<{ id: string }[]>(
        request,
        `orders?select=id&nama_customer=eq.${encodeURIComponent(`${NAMA_UJI} Abuse`)}`,
      )
      expect(nyangkut.length, 'percobaan manipulasi tak boleh menyisakan pesanan').toBe(0)
    } finally {
      // URUTANNYA MENGIKAT: pesanan dulu, promo belakangan. order_items.promotion_id punya
      // foreign key ON DELETE NO ACTION, jadi promo yang sudah dirujuk sebuah pesanan MENOLAK
      // dihapus (23503) selama baris pesanannya masih ada. Membalik urutan ini membuat blok
      // pembersihan sendiri yang menggagalkan uji — persis yang terjadi pada jalannya uji pertama.
      await bersihkanPesananUji(request)
      await hapusPromo(request, promoId)
    }
  })
})
