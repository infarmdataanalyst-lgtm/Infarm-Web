// tests/e2e/checkout-edge-cases.spec.ts
// E2E: perilaku checkout di kondisi tepi — API mati, kurir tak dipilih, alamat di luar jangkauan,
// dua pembeli bersamaan, dan format nomor telepon yang dikirim ke server.
//
// ============================================================================
// ⚠️ BROWSER TIDAK PERNAH MEMANGGIL MENGANTAR LANGSUNG
// ============================================================================
// Brief meminta intercept "domain Mengantar". Itu tak akan pernah cocok: seluruh panggilan
// Mengantar dari sisi pembeli menempuh PROXY milik aplikasi ini —
//
//   search alamat  →  /api/mengantar/address/search   (Mengantar memblokir CORS)
//   cek ongkir     →  /api/mengantar/shipping/options
//
// Yang di-intercept karena itu proxy tersebut. Menargetkan `**/mengantar.com/**` dari
// `page.route()` menghasilkan nol kecocokan, dan ujinya akan hijau tanpa pernah menguji apa pun —
// kegagalan paling berbahaya untuk sebuah uji.
//
// Booking kurir (`POST /order` ke Mengantar) berjalan SEPENUHNYA DI SERVER setelah pembayaran
// sukses, jadi ia juga tak bisa dilihat maupun dicegat dari browser. Lihat catatan di TEST 5.
//
// ── Batas ──
// Tak satu pun uji di berkas ini menyelesaikan pembayaran. TEST 5 menangkap payload pembuatan
// pesanan lalu MEMBATALKAN permintaannya, jadi tak ada pesanan tercipta dan stok tak terpotong.

import { test, expect, type Page, type Request } from '@playwright/test'
import { addressSection, fillAddressSearch } from './helpers/checkout'

// Alur di berkas ini panjang (search alamat + cek ongkir sungguhan, kadang dua sesi sekaligus).
// Batas bawaan 30 detik terlampaui bukan karena macet, melainkan karena menunggu pihak ketiga.
test.describe.configure({ timeout: 120_000 })

// Proxy milik aplikasi ini — bukan domain Mengantar. Lihat catatan di atas.
//
// Yang di-intercept di berkas ini hanya proxy ONGKIR. Proxy search alamat (`/api/mengantar/
// address/search`) sengaja dibiarkan hidup: seluruh uji butuh memilih alamat sungguhan lebih dulu
// untuk sampai ke keadaan yang diuji. Ketahanan pencarian alamat sendiri sudah dicakup
// checkout-special-chars.spec.ts.
const PROXY_ONGKIR = '**/api/mengantar/shipping/options**'
const API_BUAT_ORDER = '**/api/orders/create'

const TELEPON = '081234567890' // 08xx, 12 digit — konvensi src/lib/phone.ts
const NAMA = 'E2E Edge Case'
const JALAN = 'Jl. Uji Kondisi Tepi No. 3'

// Batas kesabaran uji: dalam waktu ini UI wajib sudah berhenti memuat dan berkata sesuatu.
//
// SENGAJA lebih longgar dari batas waktu di ShippingOptions (10 detik). Menyamakan keduanya
// membuat uji balapan dengan komponen yang diujinya — pesan muncul tepat di detik yang sama
// dengan habisnya kesabaran, dan hasilnya merah-hijau bergantian tanpa ada yang berubah.
const BATAS_SABAR_MS = 20_000

// Pola pesan yang TERLALU GENERIK untuk berguna. Pembeli tak bisa berbuat apa pun dengannya.
const PESAN_GENERIK = /^(terjadi kesalahan|error|gagal)\.?$/i

function parseRupiah(text: string): number {
  const digits = text.replace(/\D/g, '')
  return digits ? Number(digits) : NaN
}

// Membuka /checkout dengan keranjang yang NILAINYA CUKUP untuk melewati minimum belanja toko.
//
// Helper bersama `seedCheckoutCookie` selalu menaruh 1 unit produk pertama yang berstok — dan di
// data ini produk itu seharga Rp300, jauh di bawah minimum Rp20.000. Akibatnya `canPay` tetap
// false dan tombol "Bayar Sekarang" tak pernah aktif; uji lalu gagal pada minimum belanja, bukan
// pada hal yang sedang diuji. Kuantitasnya karena itu dinaikkan sampai ambangnya terlewati.
async function bukaCheckout(page: Page, baseURL: string): Promise<void> {
  const resProduk = await page.request.get(`${baseURL}/api/products/list`)
  expect(resProduk.ok(), 'GET /api/products/list harus berhasil').toBeTruthy()
  const { products = [] } = (await resProduk.json()) as {
    products?: { id: string; promoPrice: number; stock?: number; archived?: boolean; minOrderQty?: number }[]
  }

  const resMin = await page.request.get(`${baseURL}/api/settings/min-order`)
  const { minOrderAmount = 0 } = resMin.ok()
    ? ((await resMin.json()) as { minOrderAmount?: number })
    : {}

  // Produk termahal yang berstok → kuantitas yang dibutuhkan paling kecil, jadi stok yang
  // "dipesan" saat uji menyentuh pembuatan order tetap sedikit.
  const kandidat = products
    .filter((p) => !p.archived && (p.stock ?? 0) > 0 && p.promoPrice > 0)
    .sort((a, b) => b.promoPrice - a.promoPrice)
  const produk = kandidat[0]
  expect(produk, 'butuh minimal satu produk aktif & berstok').toBeTruthy()

  const qty = Math.max(
    1,
    produk!.minOrderQty ?? 1,
    Math.ceil(minOrderAmount / produk!.promoPrice),
  )
  expect(
    qty <= (produk!.stock ?? 0),
    `stok produk termahal (${produk!.stock}) tak cukup untuk mencapai minimum belanja (butuh ${qty})`,
  ).toBeTruthy()

  const nilai = Buffer.from(
    JSON.stringify([{ productId: produk!.id, quantity: qty, price: produk!.promoPrice }]),
    'utf-8',
  ).toString('base64')

  await page.context().addCookies([
    { name: 'infarm_checkout', value: nilai, domain: new URL(baseURL).hostname, path: '/' },
  ])

  await page.goto('/checkout')

  // Timeout longgar, bukan 5 detik bawaan: halaman kini merender KERANGKA sampai detail produk
  // tiba (lihat CheckoutSkeleton), dan pada worker yang baru menyala dev server masih mengompilasi.
  await expect(
    page.getByRole('heading', { name: 'Alamat Pengiriman' }),
    'form alamat tak muncul — cookie checkout kemungkinan gagal di-seed',
  ).toBeVisible({ timeout: 45_000 })
}

async function isiTeguh(page: Page, label: string, value: string): Promise<void> {
  const field = page.getByLabel(label)
  await expect(field, `field "${label}" tak ditemukan`).toBeVisible()
  await expect(async () => {
    await field.fill(value)
    await expect(field).toHaveValue(value, { timeout: 1_000 })
  }).toPass({ timeout: 15_000 })
}

// Memilih alamat pertama dari hasil pencarian.
async function pilihAlamat(page: Page, keyword: string): Promise<void> {
  await fillAddressSearch(page, keyword)
  const opsi = page.getByRole('listbox').getByRole('option').first()
  await expect(opsi, `tak ada hasil alamat untuk "${keyword}"`).toBeVisible({ timeout: 30_000 })
  await opsi.click()
}

// Mengumpulkan galat JS tak tertangkap + galat konsol. Dipasang SEBELUM halaman dibuka.
function pantauGalat(page: Page): { pageErrors: string[]; consoleErrors: string[] } {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  return { pageErrors, consoleErrors }
}

// ─────────────────────────────────────────────────────────────────────────────
test.describe('Checkout — kondisi tepi', () => {
  // ===========================================================================
  test('1: cek ongkir menggantung → UI menyerah dengan pesan, bukan berputar selamanya', async ({
    page,
    baseURL,
  }) => {
    expect(baseURL).toBeTruthy()
    const galat = pantauGalat(page)

    // Permintaan ongkir ditahan 60 detik — jauh melewati batas kesabaran mana pun.
    // Ini meniru Mengantar yang hidup tapi tak menjawab: kasus paling jahat, karena tak ada
    // error yang terlempar untuk ditangkap siapa pun.
    await page.route(PROXY_ONGKIR, async (route) => {
      await new Promise((r) => setTimeout(r, 60_000))
      await route.abort('timedout')
    })

    await bukaCheckout(page, baseURL!)
    await isiTeguh(page, 'Nama Lengkap Penerima', NAMA)
    await isiTeguh(page, 'Nomor Telepon Aktif', TELEPON)
    await pilihAlamat(page, 'jakarta pusat')

    // Sheet kurir dibuka SENGAJA.
    //
    // Memilih alamat memang memicu cek ongkir, tapi TIDAK membuka sheet-nya. Seluruh keadaan
    // memuat/galat ongkir dirender DI DALAM sheet itu, jadi selama tertutup pembeli tak melihat
    // apa pun — baris trigger cuma tetap berbunyi "Pilih Kurir Pengiriman".
    //
    // Uji ini sempat gagal justru karena lupa membukanya: pesan galat sudah benar-benar ada di DOM
    // (BottomSheet tetap ter-mount saat tertutup, digeser lewat transform), sehingga assertion
    // "pesan terlihat" LOLOS padahal tak ada manusia yang bisa membacanya. Membuka sheet membuat
    // yang diperiksa sama dengan yang dilihat pembeli.
    await page.getByRole('button').filter({ hasText: 'Metode Pengiriman' }).first().click()

    // Yang diuji: apakah kerangka "Menghitung ongkos kirim…" PERNAH berhenti.
    // Dicocokkan ke PARAGRAF pesannya, bukan pola longgar "coba lagi": pola itu juga mengenai
    // tombol "Coba Lagi" di bawahnya, dan Playwright menolak lokator yang cocok ke dua elemen.
    const pesanApaPun = page.getByText(
      /gagal memuat ongkos kirim|tidak melayani pengiriman|belum ada kurir tersedia/i,
    )

    const tombolCobaLagi = page.getByRole('button', { name: 'Coba Lagi' })

    // Keduanya diperiksa sebagai SATU keadaan, bukan berurutan.
    //
    // Memeriksa pesan dulu lalu tombol beberapa detik kemudian sempat gagal: efek ongkir bisa
    // berjalan ulang (berat kirim dihitung ulang saat detail produk tiba), sheet kembali ke
    // kerangka, dan tombol yang tadi ada lenyap saat giliran diperiksa. Yang ingin ditegakkan
    // memang "pada suatu saat, keduanya tampil bersamaan" — bukan "pernah tampil sendiri-sendiri".
    //
    // Pesan saja tak cukup: kegagalan ini sifatnya sementara, jadi pembeli harus punya jalan
    // keluar tanpa mengulang seluruh form.
    await expect(
      async () => {
        await expect(pesanApaPun.first()).toBeVisible({ timeout: 2_000 })
        await expect(tombolCobaLagi).toBeVisible({ timeout: 2_000 })
      },
      `Setelah ${BATAS_SABAR_MS / 1000} detik UI tak pernah menampilkan pesan galat + tombol coba ` +
        `lagi secara bersamaan. Bila yang hilang adalah PESANNYA, artinya tarikan cek ongkir tak ` +
        `punya batas waktu di sisi klien dan pembeli menatap kerangka selamanya — perbaikannya ` +
        `BATAS_KLIEN_MS di ShippingOptions.tsx.`,
    ).toPass({ timeout: BATAS_SABAR_MS })

    // Pesannya juga harus berguna, bukan sekadar ada.
    const teks = ((await pesanApaPun.first().textContent()) ?? '').trim()
    expect(teks, `pesan terlalu generik: "${teks}"`).not.toMatch(PESAN_GENERIK)

    expect(galat.pageErrors, 'ada exception JavaScript tak tertangkap').toEqual([])
    console.log(`\n  TEST 1 — pesan yang muncul: "${teks}" (+ tombol Coba Lagi)\n`)
  })

  // ===========================================================================
  test('2: bayar tanpa kurir terpilih → ditolak, tak ada request buat pesanan', async ({
    page,
    baseURL,
  }) => {
    expect(baseURL).toBeTruthy()

    // ⚠️ "Jangan buka bottom sheet" TIDAK cukup untuk mencapai keadaan tanpa kurir.
    //
    // ShippingOptions AUTO-MEMILIH opsi termurah begitu tarif tiba, selama pembeli belum memilih
    // apa pun (efek di ShippingOptions.tsx). Jadi lewat UI biasa keadaan "alamat valid tapi kurir
    // kosong" tak pernah tercapai — uji yang hanya menghindari sheet akan hijau tanpa pernah
    // menyentuh guard yang dimaksud.
    //
    // Untuk benar-benar mengujinya, tarif dibuat KOSONG: tak ada yang bisa dipilih otomatis.
    // Itu juga keadaan nyata — alamat yang tak dilayani J&T (lihat TEST 3).
    await page.route(PROXY_ONGKIR, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ options: [], reason: 'NO_JT_SERVICE' }),
      }),
    )

    // Setiap permintaan pembuatan pesanan dicatat. Harus tetap nol sampai akhir.
    const permintaanBuatOrder: string[] = []
    page.on('request', (req: Request) => {
      if (req.url().includes('/api/orders/create')) permintaanBuatOrder.push(req.method())
    })

    await bukaCheckout(page, baseURL!)
    await isiTeguh(page, 'Nama Lengkap Penerima', NAMA)
    await isiTeguh(page, 'Nomor Telepon Aktif', TELEPON)
    await pilihAlamat(page, 'jakarta pusat')
    await isiTeguh(page, 'Alamat Lengkap (Nama Jalan & Nomor Rumah)', JALAN)

    const urlSebelum = page.url()

    // `force: true` WAJIB di sini.
    //
    // Tombolnya memang dirancang tetap bisa ditekan walau redup — `disabled` tak dipasang, hanya
    // `aria-disabled`, supaya guard di handlePay() sempat memberi pesan alih-alih tombol yang diam
    // tak bereaksi (lihat komentar `canPay` di CheckoutBottomBar.tsx).
    //
    // Tapi Playwright memperlakukan `aria-disabled="true"` sebagai "belum enabled" dan MENUNGGU
    // sampai timeout, bukan mengklik. Tanpa `force`, uji ini gagal karena batasan alat — bukan
    // karena aplikasinya salah.
    await page.getByRole('button', { name: 'Bayar Sekarang' }).first().click({ force: true })

    // === Ditolak dengan pesan yang menyebut APA yang kurang ===
    await expect(
      page.getByText(/pilih kurir pengiriman terlebih dahulu/i),
      'tak ada pesan validasi yang menyebut kurir belum dipilih',
    ).toBeVisible({ timeout: 10_000 })

    // === Tak berpindah halaman ===
    expect(page.url(), 'halaman berpindah padahal submit seharusnya ditolak').toBe(urlSebelum)

    // === Popup konfirmasi TIDAK muncul ===
    // Guard ada di handlePay(), SEBELUM modal dibuka. Kalau modal sempat terbuka, artinya guard
    // dilewati dan pembeli tinggal satu klik dari pesanan tanpa kurir.
    await expect(
      page.getByRole('dialog'),
      'popup konfirmasi terbuka padahal kurir belum dipilih',
    ).toHaveCount(0)

    // === Nol permintaan ke server ===
    expect(
      permintaanBuatOrder,
      `ada ${permintaanBuatOrder.length} permintaan /api/orders/create padahal submit ditolak`,
    ).toEqual([])
  })

  // ===========================================================================
  test('3: alamat di luar jangkauan → pesan spesifik, bukan "terjadi kesalahan"', async ({
    page,
    baseURL,
  }) => {
    expect(baseURL).toBeTruthy()

    // ⚠️ Premis "sandbox hanya melayani Jakarta→Jakarta" TERBANTAH oleh pengujian.
    //
    // Alamat luar Jawa yang NYATA tetap dikutip tarif oleh sandbox — Denpasar menghasilkan opsi
    // kurir seperti biasa, dan uji ongkir sebelumnya mencatat Makassar Rp29.760. Yang benar-benar
    // menghasilkan daftar kosong adalah `destination_id` yang tak dikenal (dibalas HTTP 200
    // `{"success":true,"data":{}}`), bukan jarak.
    //
    // Jadi keadaan "di luar jangkauan" tak bisa dipicu lewat alamat sungguhan di sandbox. Yang
    // diuji di sini adalah CARA UI MENJELASKANNYA — respons `NO_JT_SERVICE` dari proxy kita
    // sendiri distub, persis seperti yang dikirim server saat gudang menjawab tapi J&T tak
    // melayani rutenya (lihat api/mengantar/shipping/options/route.ts).
    await page.route(PROXY_ONGKIR, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ options: [], reason: 'NO_JT_SERVICE' }),
      }),
    )

    await bukaCheckout(page, baseURL!)

    await isiTeguh(page, 'Nama Lengkap Penerima', NAMA)
    await isiTeguh(page, 'Nomor Telepon Aktif', TELEPON)

    // Denpasar — luar Jawa. Dipakai agar alamat yang tampil konsisten dengan skenarionya.
    await pilihAlamat(page, 'denpasar')

    // Yang diharapkan: pesan yang MENYEBUT KURIRNYA dan menyarankan tindakan.
    // API membedakan dua sebab lewat `reason` (NO_JT_SERVICE vs ESTIMATE_UNAVAILABLE) supaya UI
    // tak menyuruh "coba lagi" pada alamat yang memang tak akan pernah dilayani.
    const pesanTakDilayani = page.getByText(/tidak melayani pengiriman ke alamat ini/i)
    const pesanGagalMuat = page.getByText(/gagal memuat ongkos kirim/i)

    await expect(
      pesanTakDilayani.or(pesanGagalMuat),
      'tak ada pesan apa pun setelah cek ongkir untuk alamat di luar jangkauan',
    ).toBeVisible({ timeout: 45_000 })

    const spesifik = await pesanTakDilayani.isVisible()
    const teks = (
      (await (spesifik ? pesanTakDilayani : pesanGagalMuat).textContent()) ?? ''
    ).trim()

    console.log(`\n  TEST 3 — pesan: "${teks}"\n`)

    expect(teks, `pesan terlalu generik untuk ditindaklanjuti: "${teks}"`).not.toMatch(PESAN_GENERIK)
    expect(
      teks.length,
      'pesan terlalu pendek untuk menjelaskan apa pun kepada pembeli',
    ).toBeGreaterThan(20)

    // Yang paling berguna adalah pesan "J&T tak melayani" — ia memberi tahu alamatnya yang
    // bermasalah, bukan menyuruh mencoba ulang tanpa guna. Kalau yang muncul justru "gagal
    // memuat", itu dicatat sebagai anotasi: bukan salah, tapi kurang menolong.
    if (!spesifik) {
      const catatan =
        'Yang muncul "gagal memuat ongkos kirim" (ESTIMATE_UNAVAILABLE), bukan pesan ' +
        '"J&T tidak melayani". Artinya gudang tak menjawab, bukan rute yang ditolak — pembeli ' +
        'disuruh mencoba lagi untuk alamat yang sebenarnya memang di luar jangkauan.'
      test.info().annotations.push({ type: 'catatan', description: catatan })
      console.log(`  ⚠ ${catatan}\n`)
    }

    await addressSection(page).screenshot({
      path: 'tests/e2e/screenshots/edge-case-outside-coverage.png',
    })
    // Sheet kurir memuat pesannya; diambil terpisah supaya bukti kedua-duanya tersimpan.
    await page.screenshot({ path: 'tests/e2e/screenshots/edge-case-outside-coverage-full.png' })
  })

  // ===========================================================================
  test('4: dua pembeli bersamaan → ongkir tak tertukar antar sesi', async ({ browser, baseURL }) => {
    expect(baseURL).toBeTruthy()

    // ⚠️ Brief meminta ALAMAT YANG SAMA PERSIS di kedua konteks. Dengan alamat identik, jawaban
    // yang benar dan jawaban yang tertukar TERLIHAT SAMA — tak ada yang bisa gagal, jadi ujinya
    // tak membuktikan apa pun.
    //
    // Dipakai dua alamat BERBEDA. Yang ditegakkan: permintaan dari konteks A hanya pernah membawa
    // destination_id milik A, dan begitu pula B. Itu tepat menguji apa yang dimaksud — apakah ada
    // state bersama di server yang bocor antar sesi (cache ongkir di warehouse-shipping.ts adalah
    // Map tingkat modul; kalau kuncinya salah, inilah yang menangkapnya).
    const SESI = [
      { label: 'A', keyword: 'jakarta pusat' },
      { label: 'B', keyword: 'cengkareng' },
    ]

    const konteks = await Promise.all(SESI.map(() => browser.newContext()))

    try {
      const hasil = await Promise.all(
        SESI.map(async (sesi, i) => {
          const page = await konteks[i].newPage()

          // Permintaan ongkir per konteks dicatat terpisah.
          const tujuanDiminta: string[] = []
          await page.route(PROXY_ONGKIR, async (route) => {
            try {
              const body = route.request().postDataJSON() as { destinationId?: string }
              if (body?.destinationId) tujuanDiminta.push(body.destinationId)
            } catch {
              // body tak terbaca — permintaannya tetap diteruskan
            }
            await route.continue()
          })

          await bukaCheckout(page, baseURL!)

          await isiTeguh(page, 'Nama Lengkap Penerima', `${NAMA} ${sesi.label}`)
          await isiTeguh(page, 'Nomor Telepon Aktif', TELEPON)
          await pilihAlamat(page, sesi.keyword)

          const kota = await page.getByLabel('Kota/Kabupaten').inputValue()
          const kelurahan = await page.getByLabel('Kelurahan').inputValue()

          const barisKurir = page.getByRole('button').filter({ hasText: 'Metode Pengiriman' }).first()
          await expect(barisKurir, `kurir tak muncul di sesi ${sesi.label}`).toContainText(
            /Rp[\d.]+/,
            { timeout: 45_000 },
          )
          const ongkir = parseRupiah(((await barisKurir.textContent()) ?? '').match(/Rp[\d.]+/)![0])

          return { ...sesi, kota, kelurahan, ongkir, tujuanDiminta, page }
        }),
      )

      const [a, b] = hasil
      console.log(
        `\n  TEST 4\n` +
          `    sesi A: ${a.kelurahan}, ${a.kota} → Rp${a.ongkir.toLocaleString('id-ID')} (dest ${a.tujuanDiminta.join('|')})\n` +
          `    sesi B: ${b.kelurahan}, ${b.kota} → Rp${b.ongkir.toLocaleString('id-ID')} (dest ${b.tujuanDiminta.join('|')})\n`,
      )

      // === Tiap sesi hanya pernah meminta tujuannya sendiri ===
      expect(a.tujuanDiminta.length, 'sesi A tak pernah meminta ongkir').toBeGreaterThan(0)
      expect(b.tujuanDiminta.length, 'sesi B tak pernah meminta ongkir').toBeGreaterThan(0)

      const destA = new Set(a.tujuanDiminta)
      const destB = new Set(b.tujuanDiminta)
      expect(
        [...destA].some((d) => destB.has(d)),
        `Kedua sesi memakai destination_id yang sama — alamat berbeda seharusnya menghasilkan ` +
          `tujuan berbeda.\n    A: ${[...destA].join(', ')}\n    B: ${[...destB].join(', ')}`,
      ).toBe(false)

      // === Alamat yang tampil tetap milik sesinya sendiri ===
      expect(a.kelurahan, 'sesi A menampilkan kelurahan milik sesi B').not.toBe(b.kelurahan)

      // === Ongkir keduanya sah ===
      // Harganya BOLEH sama — dua tujuan Jakarta memang bisa bertarif identik. Yang tak boleh
      // adalah nol atau tak terbaca, yang menandakan respons ketukar/kosong.
      for (const s of hasil) {
        expect(
          Number.isFinite(s.ongkir) && s.ongkir > 0,
          `ongkir sesi ${s.label} tak sah: ${s.ongkir}`,
        ).toBeTruthy()
      }
    } finally {
      await Promise.all(konteks.map((c) => c.close()))
    }
  })

  // ===========================================================================
  test('5: format nomor telepon pada payload pembuatan pesanan (LAPORAN, bukan assertion)', async ({
    page,
    baseURL,
  }) => {
    expect(baseURL).toBeTruthy()

    // ⚠️ Payload booking Mengantar TIDAK BISA dilihat dari browser.
    //
    // `POST {host}/api/public/{KEY}/order` dijalankan DI SERVER oleh shipment-booking.ts, dipicu
    // webhook Xendit setelah pembayaran sukses. Tak ada satu pun byte-nya melewati browser, jadi
    // `page.route()` tak akan pernah melihatnya.
    //
    // Yang bisa ditangkap di sini adalah payload yang dikirim HALAMAN CHECKOUT ke API kita sendiri.
    // Transformasi setelahnya dibaca dari kode, dan dilaporkan bersama di bawah.
    let payload: Record<string, unknown> | null = null

    await page.route(API_BUAT_ORDER, async (route) => {
      try {
        payload = route.request().postDataJSON() as Record<string, unknown>
      } catch {
        payload = null
      }
      // DIBATALKAN, bukan diteruskan.
      //
      // Payload-nya sudah tertangkap utuh — meneruskannya hanya menambah satu pesanan nyata &
      // memotong stok tanpa menghasilkan informasi baru sedikit pun. Alur penuh sampai pesanan
      // tersimpan sudah dicakup checkout-order-data-integrity.spec.ts.
      await route.abort('failed')
    })

    await bukaCheckout(page, baseURL!)
    await isiTeguh(page, 'Nama Lengkap Penerima', NAMA)
    await isiTeguh(page, 'Nomor Telepon Aktif', TELEPON)
    await pilihAlamat(page, 'jakarta pusat')
    await isiTeguh(page, 'Alamat Lengkap (Nama Jalan & Nomor Rumah)', JALAN)

    const barisKurir = page.getByRole('button').filter({ hasText: 'Metode Pengiriman' }).first()
    await expect(barisKurir, 'kurir tak terpilih').toContainText(/Rp[\d.]+/, { timeout: 45_000 })

    await page.getByRole('button', { name: 'Bayar Sekarang' }).first().click()
    const modal = page.getByRole('dialog')
    await expect(
      modal.getByRole('heading', { name: 'Pastikan data yang Anda masukkan benar' }),
    ).toBeVisible({ timeout: 15_000 })
    await modal.getByRole('button', { name: 'Lanjutkan Checkout' }).click()

    await expect
      .poll(() => (payload ? 'ada' : 'belum'), {
        message: 'payload pembuatan pesanan tak pernah tertangkap',
        timeout: 30_000,
      })
      .toBe('ada')

    const p = payload as unknown as Record<string, unknown>
    const teleponDikirim = p.customerPhone

    console.log(
      [
        '',
        '  ══════════════════════════════════════════════════════════',
        '  TEST 5 — FORMAT NOMOR TELEPON (untuk dibandingkan manual)',
        '  ══════════════════════════════════════════════════════════',
        `  diketik pembeli di form      : "${TELEPON}"`,
        `  dikirim ke /api/orders/create : ${JSON.stringify(teleponDikirim)}`,
        `  tipe                          : ${typeof teleponDikirim}`,
        '',
        '  Perjalanan berikutnya (dibaca dari kode, tak terlihat dari browser):',
        '',
        '    orders.no_telepon',
        '      = nilai di atas, apa adanya (mock-db/orders.ts)',
        '',
        '    Mengantar POST /order → orders[].customerPhone',
        '      = order.customerPhone VERBATIM (lib/mengantar-shipment.ts:194)',
        '      → tetap "08…", TIDAK diubah ke 62…',
        '',
        '    Xendit invoice → customer.mobile_number',
        '      = toE164Phone(order.customerPhone) (lib/xendit/invoice.ts:132)',
        '      → diubah ke +62…, hanya untuk Xendit',
        '',
        '  Jadi Mengantar menerima format 08…, Xendit menerima +62….',
        '  Bandingkan yang pertama dengan dokumentasi resmi Mengantar.',
        '',
        `  payload lengkap: ${JSON.stringify(p, null, 2).slice(0, 900)}`,
        '  ══════════════════════════════════════════════════════════',
        '',
      ].join('\n'),
    )

    // Sengaja TANPA assertion lolos/gagal atas formatnya — ini laporan, sesuai permintaan.
    // Satu-satunya yang ditegakkan: nomornya benar-benar terkirim, bukan hilang.
    expect(teleponDikirim, 'customerPhone tak ada di payload').toBeTruthy()

    test.info().annotations.push({
      type: 'format telepon',
      description: `form "${TELEPON}" → API ${JSON.stringify(teleponDikirim)} → Mengantar verbatim (08…), Xendit +62…`,
    })
  })
})
