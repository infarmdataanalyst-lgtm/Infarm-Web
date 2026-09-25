// tests/e2e/checkout-ongkir-flow.spec.ts
// E2E: ongkir dari Mengantar masuk akal secara relatif — tujuan LUAR PULAU harus lebih mahal
// daripada tujuan SEKOTA dengan gudang asal.
//
// Yang diuji perbandingan, bukan nominal absolut. Tarif kurir berubah kapan saja; yang tak boleh
// berubah adalah urutannya. Ongkir Makassar yang lebih murah dari ongkir sekota berarti origin
// salah, berat salah, atau respons ketukar — dan semuanya keluar dari saldo Mengantar tanpa
// terlihat di UI.
//
// ── Kota asal ──
// `MENGANTAR_PICKUP_ORIGIN_ID` di .env.local = 5fc62f5ff8f44b34aa4c0dbc =
// CENGKARENG BARAT, Cengkareng, JAKARTA BARAT (diverifikasi lewat address/search).
//
// PENTING: itu BUKAN `NEXT_PUBLIC_MENGANTAR_ORIGIN_ID`. Selama env pickup terisi,
// `getQuoteOriginId()` di src/lib/warehouse.ts memakainya untuk SELURUH kutipan ongkir dan
// mengabaikan origin per gudang maupun env public itu. Jadi "sekota dengan toko" di sini =
// Jakarta Barat.
//
// ── Batas ──
// Berhenti sebelum pembayaran. Cek ongkir adalah panggilan BACA (gratis, tak memotong saldo);
// tak ada pesanan dibuat, tak ada booking kurir.

import { readFileSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'

// Host Mengantar yang sedang dipakai server.
//
// Dibaca langsung dari .env.local karena proses Playwright TIDAK mewarisi env dev server
// (`next dev` yang memuatnya, bukan runner uji). Tak ketemu → dianggap produksi, sisi aman:
// perbandingan tarif tetap ditegakkan.
function mengantarHost(): string {
  try {
    const env = readFileSync('.env.local', 'utf-8')
    const line = env.split('\n').find((l) => l.startsWith('MENGANTAR_BASE_URL='))
    return line ? line.slice('MENGANTAR_BASE_URL='.length).trim() : ''
  } catch {
    return ''
  }
}

const IS_SANDBOX = /sandbox\./i.test(mengantarHost())

// slowMo supaya prosesnya terlihat saat dijalankan dengan --headed.
test.use({ launchOptions: { slowMo: 250 } })

// Alur ini panjang: beranda → detail produk → checkout → cek ongkir, dua kali, dengan slowMo.
test.setTimeout(240_000)

type Skenario = {
  label: string
  keyword: string
  screenshot: string
}

// Sekota: kelurahan di Jakarta Barat, sama dengan kota gudang asal.
const SEKOTA: Skenario = {
  label: 'sekota (Jakarta Barat)',
  keyword: 'cengkareng',
  screenshot: 'tests/e2e/screenshots/ongkir-1-sekota.png',
}

// Jauh: luar Pulau Jawa.
const JAUH: Skenario = {
  label: 'luar pulau (Makassar)',
  keyword: 'makassar',
  screenshot: 'tests/e2e/screenshots/ongkir-2-jauh.png',
}

// "Rp4.080" → 4080. Pemisah ribuan Indonesia titik; semua non-digit dibuang.
function parseRupiah(text: string): number {
  const digits = text.replace(/\D/g, '')
  return digits ? Number(digits) : NaN
}

// Beranda → detail produk pertama → "Beli Langsung" → /checkout.
//
// Lewat UI sungguhan, bukan menyemai cookie: yang diuji termasuk apakah alur belanja normal
// benar-benar sampai ke checkout dengan isi yang benar.
async function belanjaDariBeranda(page: Page): Promise<void> {
  await page.goto('/')

  // Kartu produk = tautan ke /produk/{id}. Yang pertama sudah cukup — uji ini tak peduli produk
  // mana, hanya butuh satu barang berstok di keranjang.
  const kartuProduk = page.locator('a[href^="/produk/"]').first()
  await expect(kartuProduk, 'tak ada kartu produk di beranda').toBeVisible({ timeout: 20_000 })
  await kartuProduk.click()

  await expect(page).toHaveURL(/\/produk\//)

  const beliLangsung = page.getByRole('button', { name: 'Beli Langsung' }).first()
  await expect(beliLangsung).toBeVisible({ timeout: 20_000 })
  await beliLangsung.click()

  // Produk BERVARIAN membuka bottom-sheet "Pilih Varian" lebih dulu; produk biasa langsung
  // meluncur ke checkout. Ditangani dua-duanya supaya uji tak bergantung pada produk mana yang
  // kebetulan tampil pertama di beranda.
  const konfirmasiVarian = page.getByRole('button', { name: 'Beli Sekarang' })
  if (await konfirmasiVarian.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await konfirmasiVarian.click()
  }

  await expect(page).toHaveURL(/\/checkout$/, { timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'Alamat Pengiriman' })).toBeVisible()
}

// Mengisi pencarian alamat & memilih hasil pertama.
//
// Pengisian diulang sampai menempel: `fill` yang mendarat sebelum hidrasi React selesai akan
// ditimpa state awal yang kosong.
async function pilihAlamat(page: Page, keyword: string): Promise<string> {
  const search = page.getByPlaceholder('Cari kelurahan, kecamatan, atau kota…')
  await expect(search).toBeVisible()

  await expect(async () => {
    await search.fill(keyword)
    await expect(search).toHaveValue(keyword, { timeout: 1_000 })
  }).toPass({ timeout: 15_000 })

  // Ditunggu OPSI pertama, bukan kotak listbox: panel sempat merender listbox kosong sebelum
  // hasil datang.
  const opsi = page.getByRole('listbox').getByRole('option').first()
  await expect(opsi, `tak ada hasil alamat untuk "${keyword}"`).toBeVisible({ timeout: 20_000 })

  const teks = ((await opsi.textContent()) ?? '').trim()
  await opsi.click()
  return teks
}

// Membuka sheet kurir (bila belum terbuka) lalu mengembalikan harga kurir termurah.
async function ambilOngkirTermurah(page: Page, skenario: Skenario): Promise<number> {
  const daftarKurir = page.getByRole('radiogroup', { name: 'Pilihan kurir' })

  // Memilih alamat biasanya sudah membuka sheet-nya sendiri. Kalau tidak, dibuka lewat baris
  // "Metode Pengiriman" — jangan berasumsi salah satu, keduanya sah.
  if (!(await daftarKurir.isVisible({ timeout: 3_000 }).catch(() => false))) {
    await page.getByRole('button').filter({ hasText: 'Metode Pengiriman' }).first().click()
  }

  // Perhitungan ongkir memanggil Mengantar untuk tiap gudang berstok — beri waktu longgar.
  await expect(
    daftarKurir,
    `daftar kurir tak muncul untuk tujuan ${skenario.label}`,
  ).toBeVisible({ timeout: 30_000 })

  const opsiKurir = daftarKurir.getByRole('radio')
  await expect(
    opsiKurir.first(),
    `tak ada satu pun opsi kurir untuk tujuan ${skenario.label}`,
  ).toBeVisible({ timeout: 30_000 })

  const jumlah = await opsiKurir.count()
  expect(jumlah, `minimal 1 opsi kurir untuk ${skenario.label}`).toBeGreaterThan(0)

  // Harga tiap opsi dibaca dari DOM apa adanya, lalu diambil yang termurah — sama dengan yang
  // ditawarkan sistem ke pembeli (daftar sudah diurutkan termurah, tapi Math.min tak bergantung
  // pada urutan itu).
  const hargaSemua: number[] = []
  for (let i = 0; i < jumlah; i++) {
    const teks = ((await opsiKurir.nth(i).textContent()) ?? '').trim()
    const cocok = teks.match(/Rp[\d.]+/)
    expect(cocok, `harga tak ditemukan pada opsi kurir ke-${i + 1} (${skenario.label})`).toBeTruthy()
    const harga = parseRupiah(cocok![0])
    expect(
      Number.isFinite(harga) && harga > 0,
      `ongkir ${skenario.label} harus lebih dari 0, dapat "${cocok![0]}"`,
    ).toBeTruthy()
    hargaSemua.push(harga)
  }

  await page.screenshot({ path: skenario.screenshot })

  const termurah = Math.min(...hargaSemua)
  console.log(`  ${skenario.label}: ${jumlah} opsi, termurah Rp${termurah.toLocaleString('id-ID')}`)
  return termurah
}

test.describe('Checkout — ongkir sekota vs luar pulau', () => {
  test('ongkir tujuan luar pulau lebih mahal daripada tujuan sekota dengan gudang', async ({
    page,
  }) => {
    // === Skenario 1: sekota ===
    await belanjaDariBeranda(page)
    const alamatSekota = await pilihAlamat(page, SEKOTA.keyword)
    const ongkirSekota = await ambilOngkirTermurah(page, SEKOTA)

    // === Skenario 2: luar pulau ===
    // Diulang dari NOL: cookie dibersihkan supaya keranjang, snapshot checkout, dan nomor telepon
    // dari sesi pertama tak terbawa. Tanpa ini, /checkout memakai isi lama dan skenario kedua
    // sebenarnya menguji keadaan yang sama.
    await page.context().clearCookies()
    await belanjaDariBeranda(page)
    const alamatJauh = await pilihAlamat(page, JAUH.keyword)
    const ongkirJauh = await ambilOngkirTermurah(page, JAUH)

    const ringkasan = [
      `  sekota     : Rp${ongkirSekota.toLocaleString('id-ID')} → ${alamatSekota}`,
      `  luar pulau : Rp${ongkirJauh.toLocaleString('id-ID')} → ${alamatJauh}`,
      '  Asal kutipan: CENGKARENG BARAT, Jakarta Barat (MENGANTAR_PICKUP_ORIGIN_ID).',
    ].join('\n')

    // === Berlaku di host mana pun: tujuan berbeda harus berharga berbeda ===
    //
    // Ini penjaga terhadap kegagalan yang paling sunyi: origin/destination tak benar-benar sampai
    // ke Mengantar (mis. destination_id kosong, origin tersangkut nilai lama), sehingga tiap
    // tujuan dikutip angka yang sama persis. Tarif dummy sekalipun tetap membedakan jarak.
    expect(
      ongkirJauh,
      `Ongkir SEKOTA dan LUAR PULAU sama persis — tujuan kemungkinan tak ikut terkirim ke Mengantar.\n${ringkasan}`,
    ).not.toBe(ongkirSekota)

    // === Hanya di host PRODUKSI: yang jauh harus lebih mahal ===
    //
    // Tarif sandbox Mengantar adalah data dummy dan urutannya memang tak masuk akal — CLAUDE.md
    // mencatatnya: "intra-Surabaya justru LEBIH MAHAL daripada Surabaya→Jakarta, yang mustahil
    // pada tarif nyata". Menegakkan perbandingan ini di sandbox berarti uji merah abadi karena
    // data pihak ketiga, bukan karena kode kita.
    //
    // Sengaja TIDAK di-skip diam-diam: hasilnya tetap dicetak & dicatat sebagai anotasi supaya
    // terlihat bahwa pemeriksaan ini tertunda, bukan hilang.
    if (IS_SANDBOX) {
      const catatan = `Perbandingan tarif DILEWATI — host sandbox (tarifnya dummy).\n${ringkasan}`
      test.info().annotations.push({ type: 'dilewati', description: catatan })
      console.log(`  ⚠ ${catatan}`)
      return
    }

    expect(
      ongkirJauh,
      `Ongkir tujuan JAUH tidak lebih mahal daripada tujuan SEKOTA.\n${ringkasan}\n  Periksa origin_id, berat kirim (gram vs kg), atau pemetaan respons Mengantar.`,
    ).toBeGreaterThan(ongkirSekota)
  })
})
