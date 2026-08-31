// tests/e2e/checkout-weight-shipping.spec.ts
// E2E: apakah ongkir berubah saat berat belanjaan berubah, dengan tujuan yang SAMA PERSIS.
//
// Jawabannya ada dua, dan keduanya benar — itulah yang diuji di sini:
//
//   A. Berat jauh berbeda  → ongkir BERBEDA, sebanding dengan beratnya.
//   B. Berat sedikit berbeda tapi keduanya di bawah 1 kg → ongkir SAMA PERSIS.
//
// Kasus B bukan bug. `toShippingWeightKg` di src/lib/shipping-weight.ts menjepit berat kirim ke
// MINIMUM 1 kg (`Math.max(MIN_SHIPPING_WEIGHT_KG, kg)`), karena Mengantar sendiri menagih minimal
// 1 kg dan `weight: 0` membuat sebagian kurir membalas harga 0 — pilihan ongkir palsu. Jadi
// belanjaan 100 g dan 700 g sama-sama dikirim sebagai 1 kg dan ditagih sama. Tanpa uji yang
// menyatakannya terang-terangan, perilaku ini terlihat seperti "berat tidak berpengaruh".
//
// ── Yang diamati, bukan dihitung ulang ──
// Berat yang benar-benar dikirim dibaca dari BODY permintaan ke /api/mengantar/shipping/options.
// Menghitungnya ulang di dalam uji berarti menyalin logika yang sedang diuji — kalau rumusnya
// salah, salinannya salah dengan cara yang sama dan ujinya tetap hijau.
//
// ── Batas ──
// Murni membaca. Berhenti di sheet kurir; tak ada pesanan, tak ada stok terpotong.

import { test, expect, type Page } from '@playwright/test'
import { fillAddressSearch } from './helpers/checkout'

const PROXY_ONGKIR = '**/api/mengantar/shipping/options**'

// Satu tujuan untuk SELURUH skenario. Kalau tujuannya ikut berbeda, perbedaan ongkir tak bisa lagi
// dikaitkan ke berat — dan itu justru satu-satunya variabel yang sedang diuji.
const TUJUAN = 'jakarta pusat'

const NAMA = 'E2E Berat Kirim'
const TELEPON = '081234567890'
const EMAIL = 'weight.shipping@contoh.test' // WAJIB sejak email dikembalikan ke form

// Ambang "1 kg" dari src/lib/shipping-weight.ts. Ditulis ulang di sini HANYA sebagai nilai yang
// diharapkan pada assertion, bukan sebagai perhitungan.
const MIN_KG = 1

type Produk = {
  id: string
  name: string
  promoPrice: number
  berat?: number | null
  stock?: number
  archived?: boolean
  minOrderQty?: number
}

type Keranjang = { produk: Produk; qty: number; gram: number }

function parseRupiah(text: string): number {
  const digits = text.replace(/\D/g, '')
  return digits ? Number(digits) : NaN
}

// Katalog + minimum belanja toko.
async function ambilKatalog(page: Page, baseURL: string) {
  const resP = await page.request.get(`${baseURL}/api/products/list`)
  expect(resP.ok(), 'GET /api/products/list harus berhasil').toBeTruthy()
  const { products = [] } = (await resP.json()) as { products?: Produk[] }

  const resM = await page.request.get(`${baseURL}/api/settings/min-order`)
  const { minOrderAmount = 0 } = resM.ok()
    ? ((await resM.json()) as { minOrderAmount?: number })
    : {}

  const aktif = products.filter(
    (p) => !p.archived && (p.stock ?? 0) > 0 && p.promoPrice > 0 && typeof p.berat === 'number',
  )
  return { aktif, minOrderAmount }
}

// Menyusun keranjang dari satu produk: kuantitas dinaikkan sampai memenuhi minimum belanja DAN
// (bila diminta) mencapai berat minimal tertentu.
//
// Minimum belanja ikut menentukan berat — inilah jebakan halus skenario ini: menaikkan kuantitas
// demi mencapai Rp20.000 juga menaikkan beratnya, dan tanpa disadari kedua keranjang bisa berakhir
// di kelas berat yang sama.
function susunKeranjang(
  produk: Produk,
  minOrderAmount: number,
  minGram = 0,
): Keranjang {
  const qty = Math.max(
    1,
    produk.minOrderQty ?? 1,
    Math.ceil(minOrderAmount / produk.promoPrice),
    minGram ? Math.ceil(minGram / (produk.berat as number)) : 0,
  )
  return { produk, qty, gram: (produk.berat as number) * qty }
}

// Menaruh keranjang ke cookie checkout lalu membuka halaman.
async function bukaDengan(page: Page, baseURL: string, k: Keranjang) {
  const nilai = Buffer.from(
    JSON.stringify([{ productId: k.produk.id, quantity: k.qty, price: k.produk.promoPrice }]),
    'utf-8',
  ).toString('base64')

  const { hostname } = new URL(baseURL)

  // ⚠️ localStorage HARUS ikut dibersihkan, bukan hanya cookie.
  //
  // Sejak draf checkout diperkenalkan (src/lib/checkout-draft.ts), alamat yang sudah diisi
  // dipulihkan otomatis saat halaman dibuka lagi. Pada pengukuran KEDUA di uji ini, pemulihan itu
  // membuat form langsung menampilkan ringkasan alamat + tombol "Ubah Alamat" — kotak pencarian
  // tak pernah ada, dan uji gagal pada langkah yang sama sekali bukan yang sedang diuji.
  //
  // `clearCookies()` tak menyentuh localStorage, jadi keduanya perlu dibersihkan. Kunjungan ke
  // beranda dulu hanya untuk mendapatkan origin yang sah bagi `localStorage.clear()`.
  await page.goto('/')
  await page.evaluate(() => {
    try {
      window.localStorage.clear()
    } catch {
      // mode privat / disabled — tak ada draf yang perlu dibersihkan
    }
  })

  await page.context().clearCookies()
  await page.context().addCookies([
    { name: 'infarm_checkout', value: nilai, domain: hostname, path: '/' },
  ])

  await page.goto('/checkout')
  await expect(
    page.getByRole('heading', { name: 'Alamat Pengiriman' }),
    'form alamat tak muncul',
  ).toBeVisible({ timeout: 45_000 })
}

async function isiTeguh(page: Page, label: string, value: string) {
  const field = page.getByLabel(label)
  await expect(field, `field "${label}" tak ditemukan`).toBeVisible()
  await expect(async () => {
    await field.fill(value)
    await expect(field).toHaveValue(value, { timeout: 1_000 })
  }).toPass({ timeout: 15_000 })
}

// Menjalankan satu keranjang sampai ongkir terlihat, lalu mengembalikan berat yang DIKIRIM ke
// server dan ongkir yang ditawarkan.
async function ukurOngkir(
  page: Page,
  baseURL: string,
  k: Keranjang,
): Promise<{ beratDikirim: number; ongkir: number; kurir: string }> {
  const beratTerkirim: number[] = []
  await page.route(PROXY_ONGKIR, async (route) => {
    try {
      const body = route.request().postDataJSON() as { weight?: number }
      if (typeof body?.weight === 'number') beratTerkirim.push(body.weight)
    } catch {
      // body tak terbaca — permintaannya tetap diteruskan
    }
    await route.continue()
  })

  await bukaDengan(page, baseURL, k)
  await isiTeguh(page, 'Nama Lengkap Penerima', NAMA)
  await isiTeguh(page, 'Nomor Telepon Aktif', TELEPON)
  await isiTeguh(page, 'Email Aktif', EMAIL)

  await fillAddressSearch(page, TUJUAN)
  const opsi = page.getByRole('listbox').getByRole('option').first()
  await expect(opsi, `tak ada hasil alamat untuk "${TUJUAN}"`).toBeVisible({ timeout: 30_000 })
  await opsi.click()

  const barisKurir = page.getByRole('button').filter({ hasText: 'Metode Pengiriman' }).first()
  await expect(barisKurir, 'ongkir tak pernah muncul').toContainText(/Rp[\d.]+/, { timeout: 45_000 })

  const teks = ((await barisKurir.textContent()) ?? '').replace(/\s+/g, ' ').trim()
  const ongkir = parseRupiah(teks.match(/Rp[\d.]+/)![0])

  expect(
    beratTerkirim.length,
    'permintaan ongkir tak pernah terlihat — proxy mungkin berganti alamat',
  ).toBeGreaterThan(0)

  await page.unroute(PROXY_ONGKIR)

  return {
    beratDikirim: beratTerkirim[beratTerkirim.length - 1],
    ongkir,
    kurir: teks.split(/—/)[0].replace(/Metode Pengiriman/i, '').trim(),
  }
}

test.describe.configure({ timeout: 180_000 })

test.describe('Checkout — pengaruh berat terhadap ongkir (tujuan sama)', () => {
  test('berat jauh berbeda → ongkir berbeda, sebanding dengan beratnya', async ({
    page,
    baseURL,
  }) => {
    expect(baseURL).toBeTruthy()
    const { aktif, minOrderAmount } = await ambilKatalog(page, baseURL!)

    // RINGAN: satu produk yang totalnya tetap di bawah 1 kg setelah memenuhi minimum belanja.
    // Diambil yang termahal supaya kuantitas (dan beratnya) sekecil mungkin.
    const kandidatRingan = aktif
      .filter((p) => (p.berat as number) < 1000)
      .sort((a, b) => b.promoPrice - a.promoPrice)
      .map((p) => susunKeranjang(p, minOrderAmount))
      .filter((k) => k.gram < 1000 && k.qty <= (k.produk.stock ?? 0))

    // BERAT: minimal 4 kg supaya jaraknya dari 1 kg tak mungkin tertutup pembulatan apa pun.
    const kandidatBerat = aktif
      .map((p) => susunKeranjang(p, minOrderAmount, 4000))
      .filter((k) => k.gram >= 4000 && k.qty <= (k.produk.stock ?? 0))
      .sort((a, b) => a.qty - b.qty)

    expect(kandidatRingan[0], 'tak ada produk yang totalnya < 1 kg sekaligus memenuhi minimum belanja').toBeTruthy()
    expect(kandidatBerat[0], 'tak ada produk yang bisa mencapai 4 kg dengan stok yang tersedia').toBeTruthy()

    const ringan = kandidatRingan[0]
    const berat = kandidatBerat[0]

    const hasilRingan = await ukurOngkir(page, baseURL!, ringan)
    const hasilBerat = await ukurOngkir(page, baseURL!, berat)

    const laporan = [
      '',
      `  RINGAN : ${ringan.produk.name.slice(0, 45)}`,
      `           ${ringan.produk.berat} g × ${ringan.qty} = ${ringan.gram} g`,
      `           dikirim sebagai ${hasilRingan.beratDikirim} kg → Rp${hasilRingan.ongkir.toLocaleString('id-ID')}`,
      `  BERAT  : ${berat.produk.name.slice(0, 45)}`,
      `           ${berat.produk.berat} g × ${berat.qty} = ${berat.gram} g`,
      `           dikirim sebagai ${hasilBerat.beratDikirim} kg → Rp${hasilBerat.ongkir.toLocaleString('id-ID')}`,
      `  tujuan : ${TUJUAN} (sama untuk keduanya)`,
      '',
    ].join('\n')
    console.log(laporan)

    // === Berat yang dikirim memang berbeda ===
    // Diperiksa lebih dulu: kalau beratnya saja sudah sama, perbandingan ongkir tak bermakna.
    expect(
      hasilBerat.beratDikirim,
      `Berat yang dikirim ke server SAMA untuk kedua keranjang.\n${laporan}` +
        `  Perhitungan berat tak sampai ke permintaan ongkir.`,
    ).toBeGreaterThan(hasilRingan.beratDikirim)

    // === Ringan dijepit ke minimum 1 kg ===
    expect(
      hasilRingan.beratDikirim,
      `Belanjaan ${ringan.gram} g seharusnya dijepit ke ${MIN_KG} kg ` +
        `(MIN_SHIPPING_WEIGHT_KG di shipping-weight.ts), dapat ${hasilRingan.beratDikirim}`,
    ).toBe(MIN_KG)

    // === Yang lebih berat HARUS lebih mahal ===
    expect(
      hasilBerat.ongkir,
      `Ongkir tidak naik meski berat naik ${hasilRingan.beratDikirim} kg → ` +
        `${hasilBerat.beratDikirim} kg ke tujuan yang sama.\n${laporan}` +
        `  Periksa apakah parameter "weight" benar-benar terkirim, atau tersangkut nilai lama di cache.`,
    ).toBeGreaterThan(hasilRingan.ongkir)

    // === Kenaikannya masuk akal, bukan sekadar berbeda ===
    // Rasio ongkir dibandingkan rasio berat. Toleransi lebar (0,5×–2×) karena tarif kurir tak
    // pernah linear sempurna: ada komponen tetap, dan produksi membulatkan ceil(kg − 0,3).
    const rasioBerat = hasilBerat.beratDikirim / hasilRingan.beratDikirim
    const rasioOngkir = hasilBerat.ongkir / hasilRingan.ongkir
    console.log(
      `  rasio berat ${rasioBerat.toFixed(2)}× vs rasio ongkir ${rasioOngkir.toFixed(2)}×\n`,
    )

    expect(
      rasioOngkir,
      `Ongkir naik ${rasioOngkir.toFixed(2)}× padahal beratnya naik ${rasioBerat.toFixed(2)}× — ` +
        `terlalu jauh untuk dijelaskan oleh tarif kurir mana pun.\n${laporan}`,
    ).toBeGreaterThan(rasioBerat * 0.5)
    expect(rasioOngkir, `idem (terlalu mahal)\n${laporan}`).toBeLessThan(rasioBerat * 2)
  })

  test('dua berat berbeda yang sama-sama di bawah 1 kg → ongkir SAMA (dijepit minimum)', async ({
    page,
    baseURL,
  }) => {
    expect(baseURL).toBeTruthy()
    const { aktif, minOrderAmount } = await ambilKatalog(page, baseURL!)

    // Dua produk berbeda yang keranjangnya sama-sama berakhir di bawah 1 kg.
    const dibawahSekilo = aktif
      .sort((a, b) => b.promoPrice - a.promoPrice)
      .map((p) => susunKeranjang(p, minOrderAmount))
      .filter((k) => k.gram < 1000 && k.qty <= (k.produk.stock ?? 0))

    // Butuh dua yang beratnya BEDA — kalau gramnya kebetulan sama, tak ada yang dibuktikan.
    const pertama = dibawahSekilo[0]
    const kedua = dibawahSekilo.find((k) => k.gram !== pertama?.gram)

    if (!pertama || !kedua) {
      const catatan =
        'Butuh dua keranjang di bawah 1 kg dengan gram BERBEDA; katalog saat ini tak menyediakannya ' +
        'setelah memenuhi minimum belanja. Perilaku penjepitan minimum tetap ditegakkan oleh uji pertama.'
      test.info().annotations.push({ type: 'dilewati', description: catatan })
      console.log(`\n  ⚠ ${catatan}\n`)
      test.skip()
      return
    }

    const hasil1 = await ukurOngkir(page, baseURL!, pertama)
    const hasil2 = await ukurOngkir(page, baseURL!, kedua)

    const laporan = [
      '',
      `  A: ${pertama.produk.name.slice(0, 40)} — ${pertama.gram} g`,
      `     dikirim ${hasil1.beratDikirim} kg → Rp${hasil1.ongkir.toLocaleString('id-ID')}`,
      `  B: ${kedua.produk.name.slice(0, 40)} — ${kedua.gram} g`,
      `     dikirim ${hasil2.beratDikirim} kg → Rp${hasil2.ongkir.toLocaleString('id-ID')}`,
      '',
    ].join('\n')
    console.log(laporan)

    // Keduanya dijepit ke 1 kg…
    expect(hasil1.beratDikirim, `keranjang A (${pertama.gram} g) tak dijepit ke 1 kg`).toBe(MIN_KG)
    expect(hasil2.beratDikirim, `keranjang B (${kedua.gram} g) tak dijepit ke 1 kg`).toBe(MIN_KG)

    // …karena itu ongkirnya WAJIB sama persis.
    //
    // Ini yang menjawab pertanyaan "apakah ongkir sama atau beda": untuk belanjaan ringan, SAMA —
    // dan itu memang benar, bukan berat yang diabaikan. Kalau assertion ini merah, artinya ada
    // sumber perbedaan lain yang tak seharusnya ada (mis. gudang asal berpindah antar permintaan).
    expect(
      hasil2.ongkir,
      `Dua belanjaan yang sama-sama dikirim sebagai 1 kg ke tujuan yang sama berongkir BERBEDA.\n` +
        `${laporan}  Berat bukan penyebabnya — periksa gudang asal atau cache ongkir.`,
    ).toBe(hasil1.ongkir)
  })
})
