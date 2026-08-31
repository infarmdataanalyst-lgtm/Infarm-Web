// tests/e2e/xendit-va-creation.spec.ts
// E2E: apa yang DITAGIHKAN Xendit = apa yang TERSIMPAN di tabel `orders`.
//
// Checkout → alamat Jakarta → kurir → bayar → halaman pembayaran Xendit, lalu membandingkan nominal
// di halaman Xendit dengan `orders.jumlah_total`, dan memastikan `jumlah_total` benar-benar =
// subtotal item + `ongkos_kirim` (tanpa selisih, tanpa pembulatan senyap), plus `id_transaksi` &
// `external_id` bisa ditelusuri balik ke `nomor_invoice`.
//
// ── Produknya DIPILIH, bukan diambil dari kartu pertama beranda ──
// Satu unit produk termurah yang harga satuannya sudah ≥ minimum total belanja dan ber-minOrderQty
// = 1. Alasannya di langkah 2: produk di bawah minimum (mis. polybag) membuat tombol bayar
// nonaktif, dan ujinya gagal karena keranjang yang belum memenuhi syarat — bukan karena hal yang
// sedang diuji. Ambang minimumnya dibaca dari API, tak pernah di-hardcode.
//
// ============================================================================
// ⛔ UJI INI MEMBUAT PESANAN NYATA & MENERBITKAN INVOICE DI XENDIT
// ============================================================================
//     E2E_ALLOW_PAID=1 npx playwright test xendit-va-creation --headed
//
// Tiap kali dijalankan:
//   - satu baris `orders` + `order_items` di Supabase           → DIHAPUS oleh cleanup
//   - STOK PRODUK BERKURANG                                     → **TIDAK** dipulihkan (lihat bawah)
//   - `POST api.xendit.co/v2/invoices` → invoice NYATA terbit    → **TIDAK bisa** dibersihkan cleanup
//   - kurir TIDAK dibooking, tak ada resi terbit                → karena pembayaran TIDAK diselesaikan
//
// Dengan kunci test (`xnd_development_…`) tak ada uang sungguhan berpindah. Dengan kunci LIVE,
// `xenditCredentials()` menolak panggilan di luar deployment produksi — tapi jangan pernah
// bergantung pada penjaga itu sebagai izin. CLAUDE.md → "Panggilan API Berbayar" mewajibkan
// persetujuan pemilik proyek sebelum menjalankan uji ini.
//
// ── Kenapa stok TIDAK dipulihkan otomatis ──
// Sama seperti checkout-order-data-integrity.spec.ts: RPC `create_order_with_items` memotong
// `product_stock_per_warehouse` lalu me-mirror ke `products.stock`. Memulihkannya dari uji berarti
// menulis stok tanpa lewat `src/lib/stock-audit.ts` — CLAUDE.md → Pergudangan melarangnya karena
// Riwayat Mutasi jadi berbohong. Cleanup MELAPORKAN dampaknya; koreksi lewat OMS → Gudang.
//
// ── Kenapa pembayaran TIDAK diselesaikan di halaman Xendit ──
// Menyelesaikannya memicu callback → `handlePaid()` → `bookShipmentForPaidOrder()` →
// `POST {host}/api/public/{KEY}/order` ke Mengantar: SALDO TERPOTONG dan RESI NYATA TERBIT, tak bisa
// dibatalkan dari sisi kita. Uji ini berhenti tepat sebelum garis itu.
//
// ============================================================================
// ⚠️ TIGA HAL YANG TIDAK BISA DIUJI DI SINI — DAN ALASANNYA
// ============================================================================
//
// 1. `metode_pembayaran` AKAN NULL, dan itu BENAR.
//    Kolom itu hanya diisi oleh callback pembayaran (`handlePaid`). Karena uji ini sengaja tidak
//    membayar (lihat di atas), tak akan pernah ada callback — dan di localhost, server Xendit
//    bahkan tak bisa menjangkau `http://localhost:3000` sama sekali. Jadi assertion "tersimpan,
//    bukan null" TIDAK dipaksakan: kalau kolomnya terisi (uji dijalankan terhadap deployment
//    ber-webhook DAN seseorang benar-benar membayar), nilainya diperiksa; kalau NULL, keadaannya
//    dicetak apa adanya. Memaksakannya berarti uji ini hanya bisa lulus dengan menerbitkan resi.
//
//    ⚠️ Nilai yang diharapkan BUKAN "VIRTUAL_ACCOUNT". `parseInvoiceCallback()` mendahulukan
//    `payment_channel` atas `payment_method`, jadi yang tersimpan adalah channel spesifik
//    ('BCA', 'OVO', 'QRIS') — kolom itu menjawab "dibayar pakai apa", bukan "lewat mekanisme apa".
//
// 2. `page.on('request')` TIDAK BISA melihat request ke `api.xendit.co`.
//    Request itu berangkat dari SERVER Next.js (`src/lib/xendit/invoice.ts`), bukan dari browser.
//    Yang terlihat browser hanyalah `POST /api/payments/invoice` dengan body `{ invoice }` — tanpa
//    nominal apa pun. Jadi kemurnian tipe `amount` diperiksa dari TIGA sisi yang benar-benar bisa
//    diamati:
//      (a) payload browser → `POST /api/orders/create` (`totalAmount`, `shippingCost`) — diintersep;
//      (b) tipe KOLOM di Postgres, dibaca dari spesifikasi OpenAPI PostgREST (`format: int32`
//          = integer; `numeric/decimal` akan tampil sebagai `format: numeric`);
//      (c) invoice dibaca ULANG dari Xendit (`GET /v2/invoices/{id}` — BACA, gratis, tak
//          menerbitkan apa pun) lalu `amount` & `external_id`-nya diperiksa.
//    (c) adalah pengganti terdekat untuk "inspeksi payload" yang diminta: ia memeriksa nilai yang
//    BENAR-BENAR diterima Xendit, bukan tebakan tentang apa yang dikirim.
//
// 3. Nomor VA & nama bank di halaman Xendit = BELUM PERNAH DIAMATI.
//    Jalur pembayaran project ini memakai **Invoice API** (halaman pembayaran Xendit yang memuat
//    SEMUA metode), bukan Payment Request/VA langsung — lihat `src/lib/xendit/invoice.ts` dan
//    catatan di ROADMAP. Artinya halaman yang dituju adalah PEMILIH METODE: nomor VA baru muncul
//    setelah sebuah bank dipilih di sana. Selektor untuk itu tak bisa diketahui tanpa lebih dulu
//    menerbitkan invoice sungguhan, jadi langkah 5 di bawah memakai pola "coba beberapa kandidat,
//    laporkan apa yang ditemukan, JANGAN gagalkan uji". Setelah sekali dijalankan, ganti kandidat
//    itu dengan selektor yang benar-benar terlihat — pola yang sama dipakai saat memetakan API
//    Mengantar dan terbukti menghemat waktu.

import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { test, expect, type Page, type Route } from '@playwright/test'

const ALLOW_PAID = process.env.E2E_ALLOW_PAID === '1'

// Pembeli uji — namanya penanda kalau cleanup gagal dan barisnya perlu dicari manual.
const BUYER = {
  name: 'E2E Xendit VA',
  phone: '081234567890', // 08xx, 12 digit (src/lib/phone.ts)
  email: 'e2e.xendit.va@contoh.test', // WAJIB sejak email dikembalikan ke form (src/lib/email.ts)
  street: 'Jl. Uji Xendit No. 1',
  addressKeyword: 'jakarta pusat', // WAJIB DKI Jakarta — sandbox Mengantar hanya Jakarta→Jakarta
}

const INVOICE_PATTERN = /INV-\d{8}-[A-Z0-9]{8}/

// Domain halaman pembayaran Xendit. `checkout-staging` untuk kunci test, `checkout` untuk live —
// keduanya diterima supaya uji tetap sah bila dijalankan terhadap deployment produksi.
const XENDIT_CHECKOUT_HOST = /checkout(-staging)?\.xendit\.co/

// "Rp75.000" / "IDR 75.000" / "75,000.00" → 75000
//
// ⚠️ Membuang SEMUA non-digit. Untuk IDR itu benar (Xendit tak memakai sen untuk IDR — lihat
// catatan "Nominal" di src/lib/xendit/invoice.ts), tapi kalau kelak ada mata uang bersen, fungsi
// ini akan membaca "75.000,50" sebagai 7500050 dan HARUS diganti.
function parseRupiah(text: string): number {
  const digits = text.replace(/\D/g, '')
  return digits ? Number(digits) : NaN
}

// === Kredensial ===

// Proses Playwright TIDAK mewarisi env dev server (`next dev` yang memuat .env.local), jadi nilainya
// dibaca sendiri. TIDAK ADA default yang di-hardcode: service_role key menembus RLS, dan satu baris
// ceroboh di sini berarti kunci itu ada selamanya di riwayat git.
function dariEnvLocal(kunci: string): string {
  try {
    const isi = readFileSync('.env.local', 'utf-8')
    const baris = isi.split('\n').find((l) => l.startsWith(`${kunci}=`))
    return baris ? baris.slice(kunci.length + 1).trim().replace(/^"|"$/g, '') : ''
  } catch {
    return ''
  }
}

function dariEnv(nama: string): string {
  return process.env[nama]?.trim() ?? ''
}

function kredensialSupabase(): { url: string; key: string } {
  return {
    url:
      dariEnv('E2E_SUPABASE_URL') ||
      dariEnv('NEXT_PUBLIC_SUPABASE_URL') ||
      dariEnvLocal('NEXT_PUBLIC_SUPABASE_URL'),
    key:
      dariEnv('E2E_SUPABASE_SERVICE_ROLE_KEY') ||
      dariEnv('SUPABASE_SERVICE_ROLE_KEY') ||
      dariEnvLocal('SUPABASE_SERVICE_ROLE_KEY'),
  }
}

// Kunci Xendit untuk MEMBACA invoice kembali.
//
// ⛔ HANYA kunci test yang dipakai. Kunci LIVE dikembalikan sebagai kosong sehingga langkah baca-ulang
// dilewati: uji tak boleh menyentuh akun produksi bahkan untuk operasi baca — pola prefix yang sama
// dipakai `isLiveKey()` di src/lib/xendit/config.ts.
function kunciXenditTest(): string {
  const key = dariEnv('XENDIT_SECRET_KEY') || dariEnvLocal('XENDIT_SECRET_KEY')
  return /^xnd_(public_)?development/i.test(key) ? key : ''
}

// === Tipe baris ===

type OrderRow = {
  id: string
  nomor_invoice: string
  jumlah_total: number | null
  ongkos_kirim: number | null
  id_transaksi: string | null
  metode_pembayaran: string | null
  nama_ekspedisi: string | null
  status_pembayaran: string
  order_status: string
}

type OrderItemRow = { quantity: number; price_at_purchase: number }

// Apa yang dibaca dari layar aplikasi kita.
type DariUI = { ongkir: number; kurir: string; totalDiLayar: number }

// Apa yang diintersep dari lalu lintas browser.
type Intersep = {
  createPayload?: Record<string, unknown>
  invoiceId?: string
  invoiceUrl?: string
}

// Apa yang dibaca dari halaman Xendit.
type DariXendit = { nominal?: number; nomorVa?: string; bank?: string }

test.describe.configure({ mode: 'serial', timeout: 300_000 })

test.describe('Xendit — nominal tagihan & jejaknya di tabel orders', () => {
  test.skip(
    !ALLOW_PAID,
    'Uji ini membuat pesanan nyata, memotong stok, dan menerbitkan invoice Xendit. ' +
      'Jalankan dengan E2E_ALLOW_PAID=1.',
  )

  // Diisi selama uji supaya cleanup tetap punya sasaran walau assertion gagal di tengah.
  let invoiceDibuat = ''
  let dampakStok = ''
  let invoiceXendit = ''
  let db: SupabaseClient | null = null

  test.afterAll(async () => {
    // === Cleanup ===
    // Berjalan APA PUN hasil ujinya. Tanpa ini setiap pengulangan meninggalkan pesanan sampah dan
    // angka penjualan di dashboard OMS ikut tercemar.
    if (!invoiceDibuat) return

    if (!db) {
      console.log(`\n  ⚠ Cleanup DILEWATI — klien Supabase tak tersedia.`)
      console.log(`    Hapus manual: delete from orders where nomor_invoice = '${invoiceDibuat}';\n`)
      return
    }

    const { data: order } = await db
      .from('orders')
      .select('id')
      .eq('nomor_invoice', invoiceDibuat)
      .maybeSingle()

    if (!order) {
      console.log(`\n  cleanup: pesanan ${invoiceDibuat} sudah tidak ada.\n`)
    } else {
      // order_items dihapus lebih dulu. Bila FK-nya ON DELETE CASCADE ini mubazir tapi tak merusak;
      // bila tidak, tanpa langkah ini penghapusan order gagal dan sampahnya tetap ada.
      await db.from('order_items').delete().eq('order_id', (order as { id: string }).id)
      const { error } = await db.from('orders').delete().eq('nomor_invoice', invoiceDibuat)

      if (error) {
        console.log(`\n  ⚠ Cleanup GAGAL untuk ${invoiceDibuat}: ${error.message}`)
        console.log(`    Hapus manual lewat Supabase Table Editor.\n`)
      } else {
        console.log(`\n  cleanup: pesanan ${invoiceDibuat} dihapus (orders + order_items).`)
      }
    }

    if (dampakStok) {
      console.log(
        `  ⚠ STOK TIDAK DIPULIHKAN: ${dampakStok}\n` +
          `    Menulis stok dari uji akan melewati src/lib/stock-audit.ts dan membuat Riwayat\n` +
          `    Mutasi berbohong (CLAUDE.md → Pergudangan). Koreksi lewat OMS → Gudang → Kelola Stok.`,
      )
    }

    if (invoiceXendit) {
      // Invoice Xendit TIDAK bisa dihapus — hanya bisa dibiarkan kedaluwarsa atau di-expire manual
      // (`POST /v2/invoices/{id}/expire!`, sebuah TULIS ke Xendit → butuh persetujuan pemilik
      // proyek, jadi TIDAK dilakukan dari sini).
      //
      // Membiarkannya aman: saat kedaluwarsa (24 jam, INVOICE_DURATION_SECONDS), Xendit mengirim
      // callback EXPIRED, dan karena pesanannya sudah dihapus webhook menjawab ORDER_NOT_FOUND
      // tanpa efek samping. Yang perlu diingat: selama 24 jam itu invoice-nya masih bisa DIBAYAR.
      console.log(
        `  ⚠ INVOICE XENDIT TERTINGGAL: ${invoiceXendit}\n` +
          `    Tak bisa dihapus lewat API. Biarkan kedaluwarsa (24 jam) atau expire manual dari\n` +
          `    Dashboard Xendit. JANGAN dibayar — pesanannya sudah tak ada di DB.\n`,
      )
    }
  })

  test('nominal di Xendit = jumlah_total = subtotal + ongkos_kirim, dan jejaknya tersimpan', async ({
    page,
    baseURL,
  }) => {
    expect(baseURL, 'baseURL wajib ada (lihat playwright.config.ts)').toBeTruthy()

    const { url: supabaseUrl, key: supabaseKey } = kredensialSupabase()
    expect(
      supabaseUrl && supabaseKey,
      'Kredensial Supabase tak ditemukan. Set E2E_SUPABASE_URL & E2E_SUPABASE_SERVICE_ROLE_KEY, ' +
        'atau sediakan .env.local. Uji ini tak bisa memverifikasi apa pun tanpanya.',
    ).toBeTruthy()
    db = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })

    const ui = {} as DariUI
    const intersep: Intersep = {}

    // ================================================================
    // 0 — Tipe KOLOM di Postgres, sebelum menyentuh apa pun
    // ================================================================
    // Dilakukan lebih dulu supaya skema yang salah menggagalkan uji SEBELUM ia membuat pesanan
    // nyata. `format: int32` = `integer`; `numeric`/`decimal` akan tampil sebagai `format: numeric`
    // dan berarti nominal rupiah bisa membawa desimal — jenis bug yang baru terlihat saat
    // pembukuan dibandingkan.
    const spekRes = await fetch(`${supabaseUrl}/rest/v1/`, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
    })
    expect(spekRes.ok, 'gagal membaca spesifikasi OpenAPI PostgREST').toBeTruthy()
    const spek = (await spekRes.json()) as {
      definitions?: { orders?: { properties?: Record<string, { type?: string; format?: string }> } }
    }
    const kolom = spek.definitions?.orders?.properties ?? {}

    for (const nama of ['jumlah_total', 'ongkos_kirim'] as const) {
      expect(kolom[nama], `kolom orders.${nama} tak ada di skema — migration belum di-apply`).toBeTruthy()
      expect(
        kolom[nama]?.format,
        `orders.${nama} harus INTEGER (format int32), bukan "${kolom[nama]?.format}". ` +
          'Konvensi project: rupiah selalu integer, tanpa desimal (CLAUDE.md).',
      ).toBe('int32')
    }
    expect(
      kolom.metode_pembayaran,
      'kolom orders.metode_pembayaran tak ada — apply migration ' +
        '20260828120000_add_orders_metode_pembayaran.sql lebih dulu',
    ).toBeTruthy()
    expect(kolom.id_transaksi, 'kolom orders.id_transaksi tak ada').toBeTruthy()

    console.log(
      `\n  skema  : jumlah_total=${kolom.jumlah_total?.format} ongkos_kirim=${kolom.ongkos_kirim?.format} ` +
        `id_transaksi=${kolom.id_transaksi?.format} metode_pembayaran=${kolom.metode_pembayaran?.format}`,
    )

    // ================================================================
    // 1 — Intersep lalu lintas browser (dipasang SEBELUM aksi apa pun)
    // ================================================================
    // Payload `POST /api/orders/create` — satu-satunya request berisi nominal yang benar-benar
    // berangkat dari BROWSER, jadi satu-satunya yang bisa diintersep dari sini.
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/api/orders/create')) {
        try {
          intersep.createPayload = req.postDataJSON() as Record<string, unknown>
        } catch {
          // Body bukan JSON — dibiarkan undefined, assertion di langkah 7 yang melaporkannya.
        }
      }
    })

    // Respons `POST /api/payments/invoice` dibaca lewat `route`, BUKAN `page.on('response')`:
    // aplikasi memanggil `window.location.replace(invoiceUrl)` segera setelah respons tiba, dan
    // membaca body setelah navigasi dimulai sering gagal dengan "Response body is unavailable".
    await page.route('**/api/payments/invoice', async (route: Route) => {
      const res = await route.fetch()
      const body = await res.text()
      try {
        const parsed = JSON.parse(body) as { invoiceId?: string; invoiceUrl?: string }
        if (parsed.invoiceId) intersep.invoiceId = parsed.invoiceId
        if (parsed.invoiceUrl) intersep.invoiceUrl = parsed.invoiceUrl
      } catch {
        // Bukan JSON (mis. galat HTML) — dilaporkan lewat assertion, bukan dilempar di sini.
      }
      await route.fulfill({ response: res, body })
    })

    // ================================================================
    // 2 — Pilih produk yang LOLOS minimum belanja (bukan kartu pertama beranda)
    // ================================================================
    // Kartu pertama di beranda bisa saja produk murah (mis. polybag) yang harganya DI BAWAH minimum
    // total belanja. Checkout-nya akan tertahan dan ujinya gagal pada hal yang sama sekali bukan
    // yang sedang diuji — bukan bug nominal Xendit, cuma keranjang yang belum memenuhi syarat.
    //
    // Ambangnya DIBACA dari `GET /api/settings/min-order` (baris `store_settings`), TIDAK
    // di-hardcode: admin bisa mengubahnya dari OMS kapan saja tanpa deploy, dan angka mati di sini
    // akan membuat uji ini mulai gagal secara misterius pada hari nilainya diubah.
    const minRes = await page.request.get('/api/settings/min-order')
    expect(minRes.ok(), 'GET /api/settings/min-order harus berhasil').toBeTruthy()
    const { minOrderAmount } = (await minRes.json()) as { minOrderAmount: number }
    expect(minOrderAmount, 'minOrderAmount tak terbaca').toBeGreaterThan(0)

    type ProdukList = {
      id: string
      name: string
      promoPrice: number
      stock?: number
      archived?: boolean
      minOrderQty?: number
    }

    const listRes = await page.request.get('/api/products/list')
    expect(listRes.ok(), 'GET /api/products/list harus berhasil').toBeTruthy()
    const { products } = (await listRes.json()) as { products?: ProdukList[] }

    // `minOrderQty === 1` ikut disyaratkan: produk ber-minOrderQty lebih besar masuk keranjang
    // dengan jumlah >1, dan tugasnya di sini cuma satu unit.
    const kandidat = (products ?? [])
      .filter(
        (p) =>
          !p.archived &&
          (p.stock ?? 0) > 0 &&
          (p.minOrderQty ?? 1) === 1 &&
          p.promoPrice >= minOrderAmount,
      )
      // Termurah yang memenuhi syarat. Uji ini memotong stok nyata dan menerbitkan tagihan nyata;
      // memilih produk termahal tak menambah apa pun yang diuji, hanya memperbesar dampaknya.
      .sort((a, b) => a.promoPrice - b.promoPrice)

    const produk = kandidat[0]
    expect(
      produk,
      `tak ada produk aktif & berstok yang harga satuannya ≥ minimum belanja ` +
        `(Rp${minOrderAmount.toLocaleString('id-ID')}) dengan minOrderQty = 1. ` +
        'Uji ini butuh satu unit yang sudah lolos minimum; tambahkan produk seperti itu di OMS.',
    ).toBeTruthy()

    const namaProduk = produk!.name
    console.log(
      `  minimum: Rp${minOrderAmount.toLocaleString('id-ID')} — dipilih "${namaProduk}" ` +
        `@ Rp${produk!.promoPrice.toLocaleString('id-ID')} × 1`,
    )

    // Langsung ke halaman detailnya. Tak melewati beranda/katalog: yang diuji berkas ini adalah
    // nominal tagihan, bukan navigasi — dan mengklik kartu di beranda tak menjamin produk INI.
    await page.goto(`/produk/${produk!.id}`)
    await page.waitForLoadState('load').catch(() => {})

    const beli = page.getByRole('button', { name: 'Beli Langsung' }).first()
    await expect(beli).toBeVisible({ timeout: 30_000 })
    const konfirmasiVarian = page.getByRole('button', { name: 'Beli Sekarang' })

    await expect(async () => {
      if (!/\/checkout$/.test(page.url())) {
        if (await konfirmasiVarian.isVisible({ timeout: 1_000 }).catch(() => false)) {
          await konfirmasiVarian.click()
        } else {
          await beli.click()
        }
      }
      await expect(page).toHaveURL(/\/checkout$/, { timeout: 5_000 })
    }).toPass({ timeout: 60_000 })

    await expect(page.getByRole('heading', { name: 'Alamat Pengiriman' })).toBeVisible({
      timeout: 30_000,
    })

    // Keranjang checkout harus berisi TEPAT satu baris berjumlah 1 — dasar seluruh perbandingan
    // nominal di bawah. Kalau "Beli Langsung" menambah lebih dari satu (mis. produk ternyata
    // ber-minOrderQty > 1 padahal API melaporkan 1), lebih baik diketahui di sini daripada muncul
    // sebagai "selisih total" yang membingungkan di langkah 9.
    const ringkasan = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    const qtyDiLayar = Number(ringkasan.match(/x\s*(\d+)/i)?.[1] ?? '1')
    expect(
      qtyDiLayar,
      `ringkasan checkout menunjukkan ${qtyDiLayar} unit, seharusnya 1`,
    ).toBe(1)

    // ================================================================
    // 3 — Alamat DKI Jakarta
    // ================================================================
    await isiTeguh(page, 'Nama Lengkap Penerima', BUYER.name)
    await isiTeguh(page, 'Nomor Telepon Aktif', BUYER.phone)
    await isiTeguh(page, 'Email Aktif', BUYER.email)

    // ⚠️ TIDAK ADA FIELD EMAIL di form checkout — sudah dihapus (CLAUDE.md → Guest Checkout).
    // Identitas guest murni nomor telepon; order baru selalu mengirim `customerEmail: undefined`.

    await isiTeguh(page, 'Cari Alamat (Kelurahan / Kecamatan / Kota)', BUYER.addressKeyword)

    // Ditunggu OPSI pertama, bukan kotak listbox — panel sempat merender listbox kosong.
    const opsi = page.getByRole('listbox').getByRole('option').first()
    await expect(opsi, `tak ada hasil alamat untuk "${BUYER.addressKeyword}"`).toBeVisible({
      timeout: 30_000,
    })
    await opsi.click()

    const provinsi = await page.getByLabel('Provinsi').inputValue()
    expect(
      provinsi,
      `tujuan harus DKI Jakarta (sandbox Mengantar hanya Jakarta→Jakarta), dapat "${provinsi}"`,
    ).toMatch(/jakarta/i)

    await isiTeguh(page, 'Alamat Lengkap (Nama Jalan & Nomor Rumah)', BUYER.street)

    // ================================================================
    // 4 — Kurir: catat ongkir DARI BOTTOM SHEET (bukan dihitung ulang)
    // ================================================================
    const daftarKurir = page.getByRole('radiogroup', { name: 'Pilihan kurir' })
    if (!(await daftarKurir.isVisible({ timeout: 5_000 }).catch(() => false))) {
      await page.getByRole('button').filter({ hasText: 'Metode Pengiriman' }).first().click()
    }
    await expect(daftarKurir, 'daftar kurir tak muncul').toBeVisible({ timeout: 45_000 })

    const opsiKurir = daftarKurir.getByRole('radio').first()
    await expect(opsiKurir, 'tak ada opsi kurir untuk tujuan Jakarta').toBeVisible({
      timeout: 45_000,
    })

    const teksKurir = ((await opsiKurir.textContent()) ?? '').replace(/\s+/g, ' ').trim()
    ui.kurir = teksKurir.split(/Estimasi/i)[0].trim()

    const ongkirCocok = teksKurir.match(/Rp[\d.]+/)
    expect(ongkirCocok, `harga tak ditemukan pada opsi kurir: "${teksKurir}"`).toBeTruthy()
    ui.ongkir = parseRupiah(ongkirCocok![0])
    expect(ui.ongkir, 'ongkir harus lebih dari 0').toBeGreaterThan(0)

    await opsiKurir.click()

    // Mengklik opsi hanya menyetel DRAFT — onSelect baru jalan saat "Konfirmasi" ditekan
    // (handleConfirm di ShippingOptions.tsx). Tanpa ini kurir tak pernah tersimpan.
    const konfirmasi = page.getByRole('button', { name: 'Konfirmasi' })
    await expect(konfirmasi, 'tombol Konfirmasi nonaktif — kurir belum terpilih').toBeEnabled({
      timeout: 10_000,
    })
    await konfirmasi.click()

    // Total yang DITAGIHKAN menurut layar. Dibaca, bukan dihitung ulang: menghitungnya di sini
    // berarti menyalin logika yang sedang diuji.
    const totalTeks =
      (await page
        .getByText('Total Pembayaran')
        .first()
        .locator('xpath=following-sibling::p[1]')
        .textContent()) ?? ''
    ui.totalDiLayar = parseRupiah(totalTeks)

    console.log(`  kurir  : ${ui.kurir} — ongkir Rp${ui.ongkir.toLocaleString('id-ID')}`)
    console.log(`  total  : Rp${ui.totalDiLayar.toLocaleString('id-ID')} (di layar)`)

    // ================================================================
    // 5 — Bayar → pesanan nyata + invoice Xendit + redirect
    // ================================================================
    const tombolBayar = page.getByRole('button', { name: 'Bayar Sekarang' }).first()

    // Diperiksa AKTIF lebih dulu. Tombol ini nonaktif bila alamat belum lengkap ATAU total belanja
    // masih di bawah minimum — dan klik ke tombol nonaktif gagal dengan pesan timeout Playwright
    // yang tak menyebut sebab aslinya. Produk sudah dipilih ≥ minimum di langkah 2, jadi kalau ini
    // gagal, sebabnya di tempat lain (validasi alamat / ongkir belum terpilih).
    await expect(
      tombolBayar,
      `tombol "Bayar Sekarang" nonaktif. Total belanja harus ≥ Rp${minOrderAmount.toLocaleString('id-ID')} ` +
        'dan semua field alamat valid (lib/checkout-validation.ts).',
    ).toBeEnabled({ timeout: 30_000 })
    await tombolBayar.click()

    const modal = page.getByRole('dialog')
    await expect(
      modal.getByRole('heading', { name: 'Pastikan data yang Anda masukkan benar' }),
    ).toBeVisible({ timeout: 15_000 })

    console.log('\n  ⛔ pesanan nyata + invoice Xendit dibuat mulai detik ini\n')
    await modal.getByRole('button', { name: 'Lanjutkan Checkout' }).click()

    // Redirect ke Xendit adalah `window.location.replace` ke domain luar.
    //
    // Bila penerbitan tagihan GAGAL, aplikasi mengarahkan ke /checkout/success?...&pay_error=1 —
    // jalur sah yang sengaja ada (lihat src/app/checkout/page.tsx). Uji ini menunggu SALAH SATU,
    // lalu memutuskan: pesanan mungkin sudah tersimpan meski tagihannya gagal, dan nomor
    // invoice-nya WAJIB dicatat lebih dulu supaya cleanup tetap punya sasaran.
    await page.waitForURL(
      (u) => XENDIT_CHECKOUT_HOST.test(u.href) || /\/checkout\/success/.test(u.href),
      { timeout: 90_000 },
    )

    const diHalamanXendit = XENDIT_CHECKOUT_HOST.test(page.url())

    if (!diHalamanXendit) {
      // Tercatat sebelum gagal, supaya afterAll bisa membersihkan pesanannya.
      const isiSukses = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
      const cocok = isiSukses.match(INVOICE_PATTERN)
      if (cocok) {
        invoiceDibuat = cocok[0]
        dampakStok = `${namaProduk} berkurang (jumlah lihat order_items)`
      }
      expect(
        diHalamanXendit,
        `Tidak mendarat di halaman Xendit — aplikasi jatuh ke halaman sukses dengan pay_error.\n` +
          `    URL: ${page.url()}\n` +
          `    Artinya POST /api/payments/invoice gagal. Cek log server ([xendit-invoice]):\n` +
          `    penyebab tersering = XENDIT_SECRET_KEY belum di-set, atau kunci LIVE dipakai di luar\n` +
          `    deployment produksi (penjaga lingkungan di lib/xendit/config.ts).`,
      ).toBeTruthy()
    }

    // Nomor invoice kita: dari respons yang diintersep (paling andal) atau dari URL Xendit.
    const dariUrl = page.url().match(INVOICE_PATTERN)?.[0] ?? ''
    invoiceDibuat = dariUrl || invoiceDibuat

    // Kalau URL Xendit tak memuatnya, cari lewat pesanan terbaru milik nomor telepon uji.
    if (!invoiceDibuat) {
      const { data } = await db
        .from('orders')
        .select('nomor_invoice')
        .eq('no_telepon', BUYER.phone)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      invoiceDibuat = (data as { nomor_invoice?: string } | null)?.nomor_invoice ?? ''
    }

    expect(
      invoiceDibuat,
      'nomor invoice tak bisa ditentukan — cleanup tak punya sasaran. Cari manual di tabel orders ' +
        `dengan no_telepon = '${BUYER.phone}'.`,
    ).toMatch(INVOICE_PATTERN)

    dampakStok = `${namaProduk} berkurang (jumlah lihat order_items ${invoiceDibuat})`
    invoiceXendit = intersep.invoiceId ?? ''
    console.log(`  INVOICE: ${invoiceDibuat}`)
    console.log(`  XENDIT : ${page.url()}`)

    // ================================================================
    // 6 — Halaman Xendit: nominal, nomor VA, bank
    // ================================================================
    const xendit: DariXendit = {}
    await page.waitForLoadState('domcontentloaded').catch(() => {})

    // Halaman Xendit dirender client-side; teksnya belum tentu ada saat DOM siap. Ditunggu sampai
    // ada angka rupiah, bukan `waitForTimeout` — menunggu waktu tetap selalu terlalu cepat atau
    // terlalu lambat.
    let isiXendit = ''
    await expect(async () => {
      isiXendit = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
      expect(isiXendit.length, 'halaman Xendit masih kosong').toBeGreaterThan(50)
      expect(isiXendit, 'belum ada nominal di halaman Xendit').toMatch(/(Rp|IDR)\s?[\d.,]+/i)
    }).toPass({ timeout: 60_000 })

    // Nominal DIBACA dari halaman, bukan diasumsikan. Diambil nilai TERBESAR di antara semua angka
    // rupiah: halaman pemilih metode juga memuat angka lain (biaya admin per channel, potongan
    // promo Xendit), dan mengambil "yang pertama" bisa memilih salah satu dari itu.
    const semuaNominal = [...isiXendit.matchAll(/(?:Rp|IDR)\s?([\d.,]+)/gi)]
      .map((m) => parseRupiah(m[1]))
      .filter((n) => Number.isFinite(n) && n > 0)
    if (semuaNominal.length > 0) xendit.nominal = Math.max(...semuaNominal)

    // ⚠️ SELEKTOR BELUM PERNAH DIAMATI — lihat catatan 3 di kepala berkas.
    // Nomor VA: 8–20 digit beruntun. Nama bank: dari daftar channel yang didukung akun kita
    // (VA_CHANNEL_CODES di src/lib/xendit/payment-request.ts).
    //
    // Jalur Invoice = halaman PEMILIH metode, jadi biasanya nomor VA BELUM ada di sini. Tidak
    // ditemukan → dicatat, BUKAN digagalkan; kalau ini digagalkan, uji jadi tak pernah bisa lulus
    // karena alasan yang sama sekali bukan yang sedang diuji.
    xendit.nomorVa = isiXendit.match(/\b\d{8,20}\b/)?.[0]
    xendit.bank = isiXendit.match(/\b(BCA|BNI|BRI|MANDIRI|PERMATA|BSI|CIMB)\b/i)?.[0]

    console.log(
      `  xendit : nominal=${xendit.nominal ?? '—'} bank=${xendit.bank ?? '—'} va=${xendit.nomorVa ?? '—'}`,
    )
    if (!xendit.nomorVa || !xendit.bank) {
      console.log(
        `  ⓘ Nomor VA / bank belum tampil — halaman Xendit ini PEMILIH METODE (jalur Invoice API).\n` +
          `    Nomor VA baru muncul setelah sebuah bank dipilih di sana. Setelah kamu lihat sendiri\n` +
          `    halamannya, ganti regex kandidat di langkah 6 dengan selektor yang sebenarnya.\n` +
          `    Cuplikan halaman: "${isiXendit.slice(0, 200)}…"`,
      )
    }

    // ================================================================
    // 7 — Kemurnian tipe pada payload yang BISA diintersep
    // ================================================================
    // Lihat catatan 2 di kepala berkas: request ke api.xendit.co berangkat dari SERVER, jadi yang
    // bisa diperiksa dari browser adalah payload ke API kita sendiri.
    expect(
      intersep.createPayload,
      'payload POST /api/orders/create tak terintersep — tanpanya tipe nominal tak bisa diperiksa',
    ).toBeTruthy()

    const periksaIntegerMurni = (label: string, nilai: unknown) => {
      expect(
        typeof nilai,
        `${label} harus number, dapat ${typeof nilai} (${JSON.stringify(nilai)}). ` +
          'String seperti "75820" akan lolos JSON tapi merusak aritmetika di server.',
      ).toBe('number')
      expect(
        Number.isInteger(nilai),
        `${label} harus INTEGER murni, dapat ${JSON.stringify(nilai)}. Rupiah tak berdesimal — ` +
          '75820.00 berarti ada pembagian/pembulatan yang tak seharusnya ada.',
      ).toBeTruthy()
    }

    periksaIntegerMurni('payload.totalAmount', intersep.createPayload!.totalAmount)
    periksaIntegerMurni('payload.shippingCost', intersep.createPayload!.shippingCost)

    // ================================================================
    // 8 — Baca pesanan + itemnya dari Supabase
    // ================================================================
    const { data: orderData, error: orderErr } = await db
      .from('orders')
      .select(
        'id,nomor_invoice,jumlah_total,ongkos_kirim,id_transaksi,metode_pembayaran,' +
          'nama_ekspedisi,status_pembayaran,order_status',
      )
      .eq('nomor_invoice', invoiceDibuat)
      .maybeSingle()

    expect(orderErr, `query orders gagal: ${orderErr?.message}`).toBeNull()
    expect(orderData, `pesanan ${invoiceDibuat} tak ditemukan di tabel orders`).toBeTruthy()
    // `as unknown as` diperlukan: tanpa tipe Database yang di-generate, supabase-js menyimpulkan
    // hasil select string sebagai GenericStringError dan menolak konversi langsung.
    const row = orderData as unknown as OrderRow

    const { data: itemData, error: itemErr } = await db
      .from('order_items')
      .select('quantity,price_at_purchase')
      .eq('order_id', row.id)

    expect(itemErr, `query order_items gagal: ${itemErr?.message}`).toBeNull()
    const items = (itemData ?? []) as unknown as OrderItemRow[]
    expect(items.length, 'pesanan tersimpan tanpa satu pun order_items').toBeGreaterThan(0)

    // Satu baris, satu unit — sesuai produk yang dipilih di langkah 2.
    expect(items.length, `pesanan berisi ${items.length} baris item, seharusnya 1`).toBe(1)
    expect(
      items[0].quantity,
      `quantity tersimpan ${items[0].quantity}, seharusnya 1`,
    ).toBe(1)

    // ================================================================
    // 9 — ongkos_kirim: integer, sesuai pilihan, dan benar-benar bagian dari total
    // ================================================================
    expect(
      row.ongkos_kirim,
      'ongkos_kirim NULL — pesanan baru wajib mencatatnya. NULL hanya sah untuk pesanan yang ' +
        'dibuat sebelum migration 20260827120000.',
    ).not.toBeNull()
    expect(
      Number.isInteger(row.ongkos_kirim),
      `ongkos_kirim harus integer, dapat ${JSON.stringify(row.ongkos_kirim)}`,
    ).toBeTruthy()
    expect(
      row.ongkos_kirim,
      `ongkos_kirim di database (${row.ongkos_kirim}) berbeda dari ongkir yang DIPILIH pembeli ` +
        `di layar (${ui.ongkir}). Server memverifikasi ulang tarif Mengantar, jadi selisih di sini ` +
        'berarti tarif yang dikutip ke pembeli bukan tarif yang ditagihkan.',
    ).toBe(ui.ongkir)

    // Subtotal dari order_items — angka OTORITATIF (snapshot harga saat beli), bukan harga produk
    // sekarang dan bukan hasil pembacaan layar.
    const subtotal = items.reduce((t, i) => t + i.price_at_purchase * i.quantity, 0)
    const totalDiharapkan = subtotal + (row.ongkos_kirim ?? 0)

    const rincian =
      `    subtotal item : Rp${subtotal.toLocaleString('id-ID')} (${items.length} baris)\n` +
      `    ongkos_kirim  : Rp${(row.ongkos_kirim ?? 0).toLocaleString('id-ID')}\n` +
      `    ─────────────────────────────────\n` +
      `    diharapkan    : Rp${totalDiharapkan.toLocaleString('id-ID')}\n` +
      `    jumlah_total  : Rp${(row.jumlah_total ?? 0).toLocaleString('id-ID')}\n` +
      `    di layar      : Rp${ui.totalDiLayar.toLocaleString('id-ID')}\n` +
      `    di Xendit     : Rp${(xendit.nominal ?? 0).toLocaleString('id-ID')}\n` +
      `    SELISIH       : Rp${((row.jumlah_total ?? 0) - totalDiharapkan).toLocaleString('id-ID')}`

    expect(
      row.jumlah_total,
      `jumlah_total ≠ subtotal item + ongkos_kirim.\n${rincian}\n` +
        '    Diskon masih selalu 0 di project ini (wiring promo→order belum selesai), jadi ' +
        'persamaan ini\n    seharusnya pas. Selisih = ada biaya yang masuk tagihan tanpa kolomnya sendiri.',
    ).toBe(totalDiharapkan)

    expect(
      Number.isInteger(row.jumlah_total),
      `jumlah_total harus integer, dapat ${JSON.stringify(row.jumlah_total)}`,
    ).toBeTruthy()

    // ================================================================
    // 10 — Nominal di halaman Xendit = jumlah_total, dibandingkan sebagai INTEGER
    // ================================================================
    expect(
      xendit.nominal,
      `nominal tak terbaca dari halaman Xendit. Cuplikan: "${isiXendit.slice(0, 300)}…"`,
    ).toBeTruthy()
    expect(
      Number.isInteger(xendit.nominal),
      `nominal dari halaman Xendit bukan integer: ${JSON.stringify(xendit.nominal)}`,
    ).toBeTruthy()
    expect(
      xendit.nominal,
      `nominal yang DITAGIHKAN Xendit ≠ jumlah_total pesanan.\n${rincian}\n` +
        '    Xendit menerima `amount` = orders.jumlah_total apa adanya (tanpa ×100 — IDR tak ' +
        'bersen).\n    Selisih di sini berarti pembeli ditagih angka yang bukan total pesanannya.',
    ).toBe(row.jumlah_total)

    // ================================================================
    // 11 — id_transaksi = id invoice Xendit
    // ================================================================
    expect(
      row.id_transaksi,
      'id_transaksi kosong — tanpanya pembayaran bermasalah tak bisa dilacak balik ke pesanannya. ' +
        'Cek log [payments-invoice]: penyimpanan gagal TIDAK membatalkan respons, jadi kegagalannya ' +
        'hanya muncul di log.',
    ).toBeTruthy()

    if (intersep.invoiceId) {
      expect(
        row.id_transaksi,
        `id_transaksi di database ("${row.id_transaksi}") ≠ invoiceId yang dikembalikan Xendit ` +
          `("${intersep.invoiceId}").`,
      ).toBe(intersep.invoiceId)
    } else {
      console.log('  ⓘ invoiceId tak terintersep dari /api/payments/invoice — perbandingan dilewati.')
    }

    // ================================================================
    // 12 — external_id yang DITERIMA Xendit = nomor_invoice kita
    // ================================================================
    // Dibaca ULANG dari Xendit (`GET /v2/invoices/{id}`) — operasi BACA: gratis, tak menerbitkan
    // apa pun, tak memindahkan uang. Inilah satu-satunya cara memeriksa apa yang BENAR-BENAR
    // diterima Xendit; payload POST-nya berangkat dari server dan tak terlihat dari browser.
    //
    // Wajib cocok: webhook mencari pesanan lewat `getOrderByOrderId(external_id)` →
    // `.eq('nomor_invoice', …)`. Kalau external_id bukan nomor_invoice, SETIAP callback gagal
    // menemukan pesanannya dan pembayaran tak pernah tercatat meski uangnya masuk.
    const kunciXendit = kunciXenditTest()
    if (kunciXendit && row.id_transaksi) {
      const auth = `Basic ${Buffer.from(`${kunciXendit}:`).toString('base64')}`
      const res = await fetch(`https://api.xendit.co/v2/invoices/${row.id_transaksi}`, {
        headers: { Authorization: auth },
      })
      expect(res.ok, `GET /v2/invoices/${row.id_transaksi} gagal: HTTP ${res.status}`).toBeTruthy()

      const inv = (await res.json()) as { external_id?: unknown; amount?: unknown; status?: unknown }

      expect(
        inv.external_id,
        `external_id di Xendit ("${String(inv.external_id)}") tak cocok dengan nomor_invoice ` +
          `("${invoiceDibuat}"). Webhook mencocokkan lewat field ini — kalau berbeda, callback ` +
          'pembayaran tak akan pernah menemukan pesanannya.',
      ).toBe(invoiceDibuat)

      periksaIntegerMurni('amount yang diterima Xendit', inv.amount)
      expect(
        inv.amount,
        `amount di Xendit (${String(inv.amount)}) ≠ jumlah_total (${row.jumlah_total}).`,
      ).toBe(row.jumlah_total)

      console.log(
        `  xendit : external_id=${String(inv.external_id)} amount=${String(inv.amount)} status=${String(inv.status)}`,
      )
    } else {
      console.log(
        '  ⓘ Baca-ulang invoice DILEWATI — XENDIT_SECRET_KEY tak ada atau bukan kunci test\n' +
          '    (xnd_development_…). Uji tidak menyentuh akun Xendit produksi, bahkan untuk membaca.\n' +
          '    Konsekuensi: external_id tak diverifikasi dari sisi Xendit.',
      )
    }

    // ================================================================
    // 13 — metode_pembayaran: HANYA bila callback benar-benar tiba
    // ================================================================
    // Lihat catatan 1 di kepala berkas. Ringkas: kolom ini diisi `handlePaid()`, dan uji ini sengaja
    // tidak membayar. Di localhost webhook Xendit bahkan tak bisa menjangkau kita.
    if (row.metode_pembayaran) {
      expect(
        row.metode_pembayaran.trim().length,
        'metode_pembayaran berisi string kosong — seharusnya mustahil (constraint DB), ' +
          'tapi kalau terjadi berarti constraint-nya belum di-apply.',
      ).toBeGreaterThan(0)
      console.log(`  metode : ${row.metode_pembayaran} (callback pembayaran SUDAH tiba)`)
    } else {
      console.log(
        `  metode : NULL — BENAR untuk uji ini.\n` +
          `    Kolom metode_pembayaran hanya diisi callback pembayaran (handlePaid), dan uji ini\n` +
          `    sengaja TIDAK menyelesaikan pembayaran karena itu memicu booking kurir Mengantar\n` +
          `    (saldo terpotong + resi nyata terbit). Di localhost webhook Xendit juga tak bisa\n` +
          `    menjangkau http://localhost:3000 sama sekali.\n` +
          `    ⚠️ Saat kelak terisi, nilainya CHANNEL ('BCA', 'OVO', 'QRIS') — BUKAN\n` +
          `    'VIRTUAL_ACCOUNT': parseInvoiceCallback() mendahulukan payment_channel.`,
      )
    }

    console.log(`  status : ${row.order_status} / ${row.status_pembayaran}`)
    console.log(`  kurir  : ${row.nama_ekspedisi}\n`)
  })
})

// Mengisi satu field dan MEMASTIKAN nilainya menempel.
//
// `fill` yang mendarat sebelum hidrasi React selesai akan ditimpa state awal yang kosong;
// mengulang sampai bertahan jauh lebih murah daripada menebak kapan hidrasi selesai.
async function isiTeguh(page: Page, label: string, value: string): Promise<void> {
  const field = page.getByLabel(label)
  await expect(field, `field "${label}" tak ditemukan`).toBeVisible()
  await expect(async () => {
    await field.fill(value)
    await expect(field).toHaveValue(value, { timeout: 1_000 })
  }).toPass({ timeout: 15_000 })
}
