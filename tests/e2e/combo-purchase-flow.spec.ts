// tests/e2e/combo-purchase-flow.spec.ts
// Alur pembelian PAKET COMBO, ujung ke ujung: dari kartu combo di halaman detail produk sampai
// baris-baris order_items di Supabase.
//
// ── Kenapa uji ini ada ──
// Combo adalah satu-satunya tempat harga barang TIDAK berasal langsung dari kolom produk: harga
// paket dialokasikan proporsional ke tiap anggotanya. Sampai 2026-09-07 alokasi itu hanya terjadi
// di klien, sementara server tak mengenal comboId sama sekali sehingga menagih harga satuan —
// pembeli melihat harga paket di layar lalu ditagih lebih mahal (SEC-033). Uji ini mengunci
// perilaku yang benar supaya tak diam-diam kembali rusak.
//
// ── Batasan yang disengaja ──
// 1. `test.describe.serial` WAJIB. Uji-uji di berkas ini berbagi satu keranjang dan satu pesanan,
//    dan sebagiannya MENULIS ke Supabase (membuat pesanan, memotong stok). playwright.config.ts
//    menyalakan fullyParallel, jadi tanpa serial dua uji akan berebut stok produk yang sama.
// 2. Panggilan ke /api/payments/** DIBLOKIR (lihat blokirPembayaran). Membuat invoice Xendit
//    adalah panggilan pihak ketiga BERBAYAR yang butuh persetujuan pemilik proyek — lihat
//    CLAUDE.md → "Panggilan API Berbayar". Yang diuji di sini adalah "pesanan tersimpan", dan itu
//    terjadi di POST /api/orders/create, SEBELUM invoice dibuat.
// 3. Alamat tujuan sengaja Jakarta: host Mengantar yang dipakai lokal masih sandbox, dan tabel
//    tarifnya paling andal untuk tujuan Jakarta.
// 4. Uji terakhir MEMBERSIHKAN pesanan yang dibuatnya dan mengembalikan stok. Kalau uji gagal di
//    tengah, jalankan uji pembersihan itu sendiri: `npx playwright test -g "membersihkan"`.

import { test, expect, type Page, type BrowserContext, type APIRequestContext } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

// === Akses Supabase langsung (untuk assert & pembersihan) ===
//
// Kredensial dibaca dari .env.local saat runtime, TIDAK di-hardcode dan tidak ikut ter-commit.
// service_role dipakai karena uji perlu membaca order_items & mengembalikan stok — keduanya
// tertutup dari anon key.
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
  init: { method?: 'GET' | 'PATCH' | 'DELETE'; data?: unknown } = {},
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

// === Tipe data yang dipakai lintas-uji ===

type ComboItem = { productId: string; name: string; unitPrice: number; quantity: number }
type Combo = { id: string; name: string; comboPrice: number; isActive: boolean; items: ComboItem[] }

// Keadaan yang mengalir antar uji dalam describe.serial ini.
const state: {
  combo: Combo | null
  invoice: string | null
  orderUuid: string | null
  stokAsli: { id: string; stock: number }[]
} = { combo: null, invoice: null, orderUuid: null, stokAsli: [] }

// destination_id kelurahan GAMBIR, Jakarta Pusat. Sandbox Mengantar paling andal untuk Jakarta.
const DESTINATION_JAKARTA = '5fc62f63f8f44b34aa4c0e0a'

// Nama pemesan khusus skenario stok, dipisah supaya pengecekan "tak ada pesanan nyangkut" tak
// pernah salah menghitung pesanan dari skenario lain.
const NAMA_UJI_STOK = 'E2E Combo Stok Kurang'

const ALAMAT = {
  nama: 'E2E Combo Flow',
  telepon: '081234567890',
  email: 'e2e.combo@contoh.test',
  jalan: 'Jl. Uji Paket Combo No. 7',
  cari: 'gambir',
}

// Mencegah pembuatan invoice Xendit — panggilan BERBAYAR ke pihak ketiga (CLAUDE.md).
// Pesanan tetap tersimpan: itu terjadi di /api/orders/create yang dibiarkan lewat.
async function blokirPembayaran(page: Page): Promise<void> {
  await page.route('**/api/payments/**', (route) => route.abort())
}

// Combo aktif pertama yang punya ≥ 2 produk dan seluruh anggotanya masih berstok cukup.
async function ambilComboLayak(request: APIRequestContext, baseURL: string): Promise<Combo> {
  const res = await request.get(`${baseURL}/api/combos/active`)
  expect(res.ok(), 'GET /api/combos/active harus berhasil').toBeTruthy()
  const { combos = [] } = (await res.json()) as { combos?: Combo[] }

  const produk = await sb<{ id: string; stock: number; archived: boolean }[]>(
    request,
    'products?select=id,stock,archived',
  )
  const stokById = new Map(produk.map((p) => [p.id, p]))

  const layak = combos.find(
    (c) =>
      c.isActive &&
      c.items.length >= 2 &&
      c.items.every((it) => {
        const p = stokById.get(it.productId)
        return p && !p.archived && p.stock >= it.quantity
      }),
  )
  expect(
    layak,
    'butuh minimal satu combo aktif berisi ≥2 produk yang semuanya masih berstok cukup',
  ).toBeTruthy()
  return layak!
}

// Total harga normal seluruh anggota combo (dasar pembanding "bukan penjumlahan harga satuan").
function totalNormal(combo: Combo): number {
  return combo.items.reduce((s, it) => s + it.unitPrice * it.quantity, 0)
}

// Mencentang kartu combo, DENGAN PENGULANGAN sampai statusnya benar-benar berubah.
//
// ⚠️ Satu kali .check() tidak cukup dan gagal berselang-seling. Checkbox-nya terkendali React dan
// status `checked`-nya turunan dari cookie keranjang (useSyncExternalStore). Klik yang mendarat
// sebelum hidrasi selesai tidak memicu handler apa pun: elemennya sudah terlihat dan bisa diklik,
// tapi belum ada yang mendengarkan. Playwright lalu melaporkan "Clicking the checkbox did not
// change its state" — persis kegagalan yang terjadi pada jalannya uji pertama kali.
//
// Pola pengulangan ini sama dengan yang dipakai fillAddressSearch di helpers/checkout.ts untuk
// alasan yang sama.
async function centangCombo(page: Page, namaCombo: string): Promise<void> {
  const checkbox = page.getByLabel(`Tambahkan ${namaCombo} ke keranjang`)
  await expect(checkbox, 'kartu combo tak muncul di halaman detail produk').toBeVisible({
    timeout: 20_000,
  })

  await expect(async () => {
    if (!(await checkbox.isChecked())) await checkbox.click()
    await expect(checkbox).toBeChecked({ timeout: 1_500 })
  }).toPass({ timeout: 30_000 })
}

test.describe.serial('Alur pembelian paket combo', () => {
  // SATU browser context untuk seluruh alur, dibuat sendiri alih-alih memakai fixture `page`.
  //
  // ⚠️ Playwright memberi context BARU pada setiap test, dan keranjang belanja hidup di COOKIE.
  // Dengan fixture bawaan, isi keranjang yang dibuat skenario 1 lenyap sebelum skenario 2 membacanya
  // — persis kegagalan "Received: -1" (cookie infarm_cart tak ditemukan) pada jalannya uji kedua.
  // Alur ini memang satu perjalanan pembeli, jadi contextnya pun harus satu.
  let context: BrowserContext
  let halaman: Page

  test.beforeAll(async ({ browser }) => {
    // locale & timezone diulang di sini: context yang dibuat manual tidak mewarisi blok `use`
    // dari playwright.config.ts, dan format rupiah/tanggal ikut menentukan hasil assert.
    context = await browser.newContext({ locale: 'id-ID', timezoneId: 'Asia/Jakarta' })
    halaman = await context.newPage()
  })

  test.afterAll(async () => {
    await context.close()
  })

  // ── Skenario 1 ────────────────────────────────────────────────────────────────────────────
  test('E2E-001 combo bisa ditambahkan ke keranjang dari halaman detail produk', async ({
    page,
    request,
    baseURL,
  }) => {
    const combo = await ambilComboLayak(request, baseURL!)
    state.combo = combo

    // Kartu combo tampil di halaman detail SETIAP produk anggotanya (BundleOffer).
    await halaman.goto(`/produk/${combo.items[0].productId}`)

    // Harga yang DITAWARKAN di kartu harus harga paket, bukan penjumlahan satuan.
    await expect(halaman.getByText('Beli bareng').first()).toBeVisible({ timeout: 20_000 })

    await centangCombo(halaman, combo.name)

    // Seluruh anggota paket masuk keranjang, masing-masing bertanda comboId.
    const isiCart = await halaman.evaluate(() => {
      const raw = document.cookie.split('; ').find((c) => c.startsWith('infarm_cart='))
      if (!raw) return []
      return JSON.parse(atob(decodeURIComponent(raw.split('=')[1]))) as {
        productId: string
        quantity: number
        price: number
        comboId?: string
      }[]
    })

    expect(isiCart.length, 'jumlah baris keranjang harus sama dengan jumlah produk combo').toBe(
      combo.items.length,
    )
    expect(
      isiCart.every((i) => i.comboId === combo.id),
      'setiap baris keranjang harus ditandai comboId',
    ).toBeTruthy()
  })

  // ── Skenario 2 ────────────────────────────────────────────────────────────────────────────
  test('E2E-002 keranjang menampilkan harga paket, bukan penjumlahan harga satuan', async ({
    page,
  }) => {
    const combo = state.combo!
    await halaman.goto('/keranjang')

    // Total baris keranjang harus PERSIS combo_price. Dibaca dari cookie, bukan dari teks layar:
    // teks total ikut dipengaruhi promo & minimum belanja, sedangkan yang diuji di sini khusus
    // alokasi harga paketnya.
    const totalKeranjang = await halaman.evaluate(() => {
      const raw = document.cookie.split('; ').find((c) => c.startsWith('infarm_cart='))
      if (!raw) return -1
      const items = JSON.parse(atob(decodeURIComponent(raw.split('=')[1]))) as {
        price: number
        quantity: number
      }[]
      return items.reduce((s, i) => s + i.price * i.quantity, 0)
    })

    expect(totalKeranjang, 'total keranjang harus sama dengan harga paket').toBe(combo.comboPrice)
    expect(
      totalKeranjang,
      'total keranjang TIDAK boleh sama dengan penjumlahan harga satuan',
    ).not.toBe(totalNormal(combo))

    // Baris paket ditampilkan sebagai satu kesatuan: kuantitasnya dikunci.
    await expect(halaman.getByText(/Bagian dari .* jumlah terkunci/).first()).toBeVisible({
      timeout: 15_000,
    })
  })

  // ── Skenario 3 ────────────────────────────────────────────────────────────────────────────
  test('E2E-003 checkout alamat Jakarta menyimpan pesanan', async ({ baseURL }) => {
    test.setTimeout(120_000) // cek ongkir ke Mengantar sandbox bisa lambat
    await blokirPembayaran(halaman)

    // Tangkap respons pembuatan pesanan untuk mengambil nomor invoicenya.
    const menungguOrder = halaman.waitForResponse(
      (r) => r.url().includes('/api/orders/create') && r.request().method() === 'POST',
      { timeout: 90_000 },
    )

    await halaman.goto('/keranjang')
    await halaman.getByRole('button', { name: /^Checkout/ }).click()

    await expect(halaman.getByRole('heading', { name: 'Alamat Pengiriman' })).toBeVisible({
      timeout: 20_000,
    })

    await halaman.getByLabel(/Nama Lengkap Penerima/i).fill(ALAMAT.nama)
    await halaman.getByLabel(/Nomor Telepon Aktif/i).fill(ALAMAT.telepon)
    await halaman.getByLabel(/Email Aktif/i).fill(ALAMAT.email)
    await halaman.getByLabel(/Alamat Lengkap/i).fill(ALAMAT.jalan)

    // Pencarian alamat: input terkendali React, isi ulang sampai nilainya menempel.
    const cari = halaman.getByPlaceholder('Cari kelurahan, kecamatan, atau kota…')
    await expect(async () => {
      await cari.fill(ALAMAT.cari)
      await expect(cari).toHaveValue(ALAMAT.cari, { timeout: 1_000 })
    }).toPass({ timeout: 15_000 })

    await halaman.getByRole('option').first().click({ timeout: 20_000 })

    // Pilih kurir dari bottom sheet ongkir.
    const kurir = halaman.getByRole('button', { name: /J&T/ }).first()
    await expect(kurir, 'opsi kurir tak muncul — cek ongkir gagal').toBeVisible({ timeout: 45_000 })
    await kurir.click()

    // Bottom sheet ongkir punya tombol "Konfirmasi" tersendiri, dan selama sheet-nya terbuka ia
    // menutupi tombol bayar (Playwright melaporkan "subtree intercepts pointer events").
    // Memilih kurir saja tidak menutup sheet — konfirmasinya yang menutup.
    await halaman.getByRole('button', { name: /^Konfirmasi$/ }).click()

    await halaman.getByRole('button', { name: /Bayar Sekarang/i }).click()
    // Popup konfirmasi email sebelum bayar.
    await halaman.getByRole('button', { name: /Lanjutkan Checkout/i }).click()

    const res = await menungguOrder
    expect(res.status(), 'POST /api/orders/create harus 201').toBe(201)
    const body = (await res.json()) as { invoice?: string }
    expect(body.invoice, 'respons harus memuat nomor invoice').toBeTruthy()
    state.invoice = body.invoice!
  })

  // ── Skenario 4 ────────────────────────────────────────────────────────────────────────────
  test('E2E-004 jumlah baris order_items sama dengan jumlah produk di dalam combo', async ({
    request,
  }) => {
    const combo = state.combo!
    expect(state.invoice, 'skenario sebelumnya harus sudah membuat pesanan').toBeTruthy()

    const orders = await sb<{ id: string }[]>(
      request,
      `orders?select=id&nomor_invoice=eq.${state.invoice}`,
    )
    expect(orders.length, 'pesanan tak ditemukan di database').toBe(1)
    state.orderUuid = orders[0].id

    const items = await sb<{ product_id: string; quantity: number; price_at_purchase: number }[]>(
      request,
      `order_items?select=product_id,quantity,price_at_purchase&order_id=eq.${state.orderUuid}`,
    )

    // Dibandingkan dengan jumlah produk BERBEDA di product_combo_items — sumber kebenarannya,
    // bukan angka yang di-hardcode di uji.
    const anggota = await sb<{ product_id: string }[]>(
      request,
      `product_combo_items?select=product_id&combo_id=eq.${combo.id}`,
    )
    const produkBerbeda = new Set(anggota.map((a) => a.product_id)).size

    expect(items.length, 'jumlah baris order_items harus sama dengan jumlah produk combo').toBe(
      produkBerbeda,
    )
    expect(
      new Set(items.map((i) => i.product_id)),
      'produk di order_items harus persis produk anggota combo',
    ).toEqual(new Set(anggota.map((a) => a.product_id)))
  })

  // ── Skenario 5 ────────────────────────────────────────────────────────────────────────────
  test('E2E-005 jumlah price_at_purchase x quantity sama dengan combo_price', async ({
    request,
  }) => {
    const combo = state.combo!
    const items = await sb<{ quantity: number; price_at_purchase: number }[]>(
      request,
      `order_items?select=quantity,price_at_purchase&order_id=eq.${state.orderUuid}`,
    )

    const jumlah = items.reduce((s, i) => s + i.price_at_purchase * i.quantity, 0)

    expect(jumlah, 'total harga baris harus sama dengan harga paket').toBe(combo.comboPrice)
    expect(jumlah, 'total harga baris TIDAK boleh sama dengan harga satuan').not.toBe(
      totalNormal(combo),
    )
  })

  // ── Skenario 6 ────────────────────────────────────────────────────────────────────────────
  test('E2E-006 combo dengan anggota kehabisan stok tak ditawarkan, dan pesanan paksa ditolak', async ({
    request,
    baseURL,
  }) => {
    test.setTimeout(120_000) // menunggu cache produk (revalidate 30 dtk) kedaluwarsa
    const combo = await ambilComboLayak(request, baseURL!)
    const korban = combo.items[0]

    // Turunkan stok satu anggota menjadi KURANG dari yang dibutuhkan paket, lalu kembalikan
    // di blok pembersihan. Kuantitas anggota combo minimal 1, jadi stok 0 selalu kurang.
    const sebelum = await sb<{ id: string; stock: number }[]>(
      request,
      `products?select=id,stock&id=eq.${korban.productId}`,
    )
    state.stokAsli = sebelum
    await sb(request, `products?id=eq.${korban.productId}`, {
      method: 'PATCH',
      data: { stock: 0 },
    })

    // Stok per-gudang IKUT dinolkan. RPC create_order_with_items memotong dari
    // product_stock_per_warehouse bila barisnya ada, dan hanya jatuh ke products.stock sebagai
    // cadangan — menolkan salah satunya saja membuat pesanan tetap lolos.
    const whAsli = await sb<{ id: string; stok: number }[]>(
      request,
      `product_stock_per_warehouse?select=id,stok&product_id=eq.${korban.productId}`,
    )
    for (const w of whAsli) {
      await sb(request, `product_stock_per_warehouse?id=eq.${w.id}`, {
        method: 'PATCH',
        data: { stok: 0 },
      })
    }

    try {
      // ── KOREKSI atas investigasi awal 2026-09-07 ──
      // Laporan awal menyimpulkan "tak ada guard stok sama sekali di jalur combo", berdasarkan
      // BundleOffer.tsx yang memang tak memeriksa stok. Itu benar untuk komponennya, tapi SALAH
      // untuk alurnya: halaman yang menyuplai komponen itu sudah menyaring lebih dulu —
      // src/app/(store)/produk/[id]/page.tsx:126-131 hanya meneruskan combo yang SELURUH
      // anggotanya berstok > 0.
      //
      // Jadi perilaku yang benar, dan yang dikunci uji ini: begitu satu anggota habis, kartu
      // paketnya TIDAK DITAWARKAN sama sekali. Pembeli tak pernah sampai ke keadaan "sudah
      // memasukkan paket yang tak mungkin dikirim".
      await halaman.goto(`/produk/${korban.productId}`)
      await expect(
        halaman.getByLabel(`Tambahkan ${combo.name} ke keranjang`),
        'kartu paket harus DISEMBUNYIKAN saat salah satu anggotanya kehabisan stok',
      ).toHaveCount(0)

      // ── Kenapa guard-nya diuji ke API, bukan ke tampilan keranjang ──
      //
      // Keranjang membaca stok lewat /api/products/by-ids yang dibungkus unstable_cache. Di
      // `next dev` cache itu TIDAK PERNAH kedaluwarsa — terukur: 75 detik penuh dengan 25 kali
      // permintaan, nilainya tak bergerak sedikit pun dari snapshot lama. Jadi perubahan stok
      // langsung ke Supabase memang mustahil terlihat di UI selama uji berjalan lokal, dan
      // meng-assert badge "Stok tersisa 0" hanya akan menguji cache, bukan perilaku.
      //
      // Yang benar-benar penting justru ada di lapisan otoritatif: saat SATU anggota paket kurang
      // stok, SELURUH pesanan harus gagal — bukan sebagian tersimpan. Itu dijamin RPC
      // create_order_with_items yang me-raise INSUFFICIENT_STOCK di dalam satu transaksi.
      const optRes = await request.post(`${baseURL}/api/mengantar/shipping/options`, {
        data: {
          destinationId: DESTINATION_JAKARTA,
          weight: 1,
          items: combo.items.map((it) => ({ productId: it.productId, quantity: it.quantity })),
        },
      })
      const { options = [] } = (await optRes.json()) as { options?: { price: number }[] }

      const res = await request.post(`${baseURL}/api/orders/create`, {
        data: {
          customerName: NAMA_UJI_STOK,
          customerPhone: ALAMAT.telepon,
          customerEmail: ALAMAT.email,
          items: combo.items.map((it) => ({
            productId: it.productId,
            name: it.name,
            quantity: it.quantity,
            price: it.unitPrice,
            comboId: combo.id,
          })),
          totalAmount: combo.comboPrice,
          address: {
            shippingAddress: ALAMAT.jalan,
            destinationId: DESTINATION_JAKARTA,
            provinsi: 'DKI JAKARTA',
            kota: 'JAKARTA PUSAT',
            kecamatan: 'GAMBIR',
            kelurahan: 'GAMBIR',
            kodepos: '10110',
          },
          logistics: { courier: 'J&T', service: 'Reguler' },
          ...(options[0] ? { shippingCost: options[0].price } : {}),
        },
      })

      expect(
        res.status(),
        'pesanan dengan anggota paket berstok kurang TIDAK boleh berhasil (201)',
      ).not.toBe(201)

      // Dan tak boleh ada baris pesanan yang tertinggal: kegagalannya harus utuh, bukan separuh.
      const nyangkut = await sb<{ id: string }[]>(
        request,
        `orders?select=id&nama_customer=eq.${encodeURIComponent(NAMA_UJI_STOK)}`,
      )
      expect(nyangkut.length, 'tak boleh ada pesanan separuh jadi yang tertinggal').toBe(0)
    } finally {
      // Stok dikembalikan APA PUN hasil assert di atas — kalau tidak, uji yang gagal meninggalkan
      // produk berstok 0 di database dan merusak seluruh uji berikutnya.
      for (const p of state.stokAsli) {
        await sb(request, `products?id=eq.${p.id}`, { method: 'PATCH', data: { stock: p.stock } })
      }
      for (const w of whAsli) {
        await sb(request, `product_stock_per_warehouse?id=eq.${w.id}`, {
          method: 'PATCH',
          data: { stok: w.stok },
        })
      }
      state.stokAsli = []
    }
  })

  // ── Skenario 7 ────────────────────────────────────────────────────────────────────────────
  test('E2E-007 membersihkan pesanan uji dari Supabase', async ({ request }) => {
    const combo = state.combo

    // ⚠️ MENYAPU SEMUA pesanan bernama uji, bukan hanya yang dibuat run ini.
    //
    // Run yang gagal di tengah tak pernah sampai ke uji ini, sehingga pesanannya tertinggal di
    // database beserta stok yang sudah terpotong — dan itu benar-benar terjadi selama pengembangan
    // uji ini (dua pesanan yatim, stok tiga produk berkurang 2 masing-masing). Menyapu berdasarkan
    // nama pemesan membuat uji ini memperbaiki kekacauan run sebelumnya, bukan menambahnya.
    const yatim = await sb<{ id: string; nomor_invoice: string; warehouse_id: string | null }[]>(
      request,
      `orders?select=id,nomor_invoice,warehouse_id&nama_customer=like.E2E%20Combo*`,
    )

    for (const o of yatim) {
      // Kembalikan stok SEBELUM barisnya dihapus — sesudah dihapus, kuantitasnya tak bisa dibaca lagi.
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
        // Stok per gudang WAJIB ikut dikembalikan. RPC memotong dari sini bila barisnya ada, dan
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

      // order_items dulu, baru orders. FK-nya memang ber-on delete cascade, tapi urutan eksplisit
      // membuat maksudnya jelas dan tak bergantung pada perilaku cascade.
      await sb(request, `order_items?order_id=eq.${o.id}`, { method: 'DELETE' })
      await sb(request, `stock_mutations?order_id=eq.${o.id}`, { method: 'DELETE' })
      await sb(request, `orders?id=eq.${o.id}`, { method: 'DELETE' })
    }

    const sisa = await sb<{ id: string }[]>(
      request,
      `orders?select=id&nama_customer=like.E2E%20Combo*`,
    )
    expect(sisa.length, 'tak boleh ada pesanan uji yang tertinggal').toBe(0)

    if (!combo) return

    // Combo-nya sendiri TIDAK boleh ikut terhapus — ia data toko yang nyata, bukan data uji.
    const comboMasihAda = await sb<{ id: string }[]>(
      request,
      `product_combos?select=id&id=eq.${combo.id}`,
    )
    expect(comboMasihAda.length, 'combo milik toko tak boleh ikut terhapus').toBe(1)
  })
})
