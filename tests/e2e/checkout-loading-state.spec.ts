// tests/e2e/checkout-loading-state.spec.ts
// E2E: saat detail produk lambat dimuat, /checkout dan /keranjang menampilkan KERANGKA —
// bukan pesan "belum ada produk" / "keranjang masih kosong".
//
// ── Kenapa memperlambat API, bukan memakai throttling jaringan DevTools ──
// Throttling memperlambat SEMUANYA (HTML, JS, gambar) dengan besaran yang berubah-ubah, jadi
// jendela yang ingin diamati ikut bergeser dan ujinya jadi bergantung pada tebakan waktu.
// Menahan SATU endpoint selama sekian detik membuat jendelanya pasti dan ujinya deterministik:
// selama tarikan itu ditahan, halaman WAJIB berada di keadaan memuat.
//
// Ini juga menutup regresi yang paling mudah kembali: siapa pun yang kelak menyederhanakan
// `viewState` jadi "kalau kosong tampilkan empty" akan langsung membuat uji ini merah.
//
// ── Batas ──
// Murni membaca. Tak ada pesanan dibuat, tak ada stok dipotong.

import { test, expect, type Page } from '@playwright/test'
import { seedCheckoutCookie } from './helpers/checkout'

// Berapa lama tarikan detail produk ditahan. Cukup panjang untuk diamati dengan tenang, cukup
// pendek supaya uji tak lamban.
const TAHAN_MS = 3_000

// Teks yang TIDAK BOLEH muncul selagi data masih dimuat. Inilah bug yang sedang dijaga.
const PESAN_KOSONG_CHECKOUT = 'Belum ada produk untuk dibayar'
const PESAN_KOSONG_KERANJANG = 'Keranjang kamu masih kosong'

// Menahan `/api/products/by-ids` selama TAHAN_MS, lalu meneruskannya apa adanya.
//
// Dipasang SEBELUM halaman dibuka. Hanya endpoint resolve detail produk yang ditahan; sisanya
// (HTML, JS, pengaturan toko) berjalan normal — persis bentuk race yang nyata.
async function tahanResolveProduk(page: Page): Promise<void> {
  await page.route('**/api/products/by-ids**', async (route) => {
    await new Promise((r) => setTimeout(r, TAHAN_MS))
    await route.continue()
  })
}

// Cookie keranjang (`infarm_cart`) — dipakai uji halaman keranjang.
// Formatnya sama dengan cookie checkout: base64 dari JSON (lihat writeCookie di cart-client.ts).
async function seedCartCookie(page: Page, baseURL: string): Promise<void> {
  const res = await page.request.get(`${baseURL}/api/products/list`)
  expect(res.ok(), 'GET /api/products/list harus berhasil').toBeTruthy()
  const body = (await res.json()) as {
    products?: { id: string; promoPrice: number; archived?: boolean; stock?: number }[]
  }
  const produk = (body.products ?? []).find((p) => !p.archived && (p.stock ?? 0) > 0)
  expect(produk, 'butuh minimal satu produk aktif & berstok').toBeTruthy()

  const nilai = Buffer.from(
    JSON.stringify([{ productId: produk!.id, quantity: 1, price: produk!.promoPrice }]),
    'utf-8',
  ).toString('base64')

  await page.context().addCookies([
    { name: 'infarm_cart', value: nilai, domain: new URL(baseURL).hostname, path: '/' },
  ])
}

test.describe('Kerangka pemuatan — tak ada lagi kedipan "kosong"', () => {
  test('/checkout menampilkan kerangka, bukan "Belum ada produk untuk dibayar"', async ({
    page,
    baseURL,
  }) => {
    expect(baseURL, 'baseURL wajib ada').toBeTruthy()

    await seedCheckoutCookie(page, baseURL!)
    await tahanResolveProduk(page)
    await page.goto('/checkout')

    // === Selagi ditahan: kerangka ADA, pesan kosong TIDAK ===
    const kerangka = page.getByText('Memuat rincian pesanan…')
    await expect(kerangka, 'kerangka checkout tak muncul saat data lambat').toBeAttached({
      timeout: 15_000,
    })

    await expect(
      page.getByText(PESAN_KOSONG_CHECKOUT),
      `"${PESAN_KOSONG_CHECKOUT}" muncul padahal produk masih dimuat — inilah bug yang diperbaiki`,
    ).toHaveCount(0)

    // Form alamat juga belum boleh ada — kerangkanya yang berdiri di tempatnya.
    await expect(page.getByRole('heading', { name: 'Alamat Pengiriman' })).toHaveCount(0)

    // === Setelah tarikan diteruskan: halaman asli muncul ===
    await expect(
      page.getByRole('heading', { name: 'Alamat Pengiriman' }),
      'halaman checkout tak pernah selesai memuat',
    ).toBeVisible({ timeout: 30_000 })

    await expect(kerangka, 'kerangka masih tersisa setelah data tiba').toHaveCount(0)
    await expect(page.getByText(PESAN_KOSONG_CHECKOUT)).toHaveCount(0)
  })

  test('/keranjang menampilkan kerangka, bukan "Keranjang kamu masih kosong"', async ({
    page,
    baseURL,
  }) => {
    expect(baseURL, 'baseURL wajib ada').toBeTruthy()

    await seedCartCookie(page, baseURL!)
    await tahanResolveProduk(page)
    await page.goto('/keranjang')

    const kerangka = page.getByText('Memuat isi keranjang…')
    await expect(kerangka, 'kerangka keranjang tak muncul saat data lambat').toBeAttached({
      timeout: 15_000,
    })

    await expect(
      page.getByText(PESAN_KOSONG_KERANJANG),
      `"${PESAN_KOSONG_KERANJANG}" muncul padahal isinya sedang dimuat`,
    ).toHaveCount(0)

    await expect(kerangka, 'keranjang tak pernah selesai memuat').toHaveCount(0, {
      timeout: 30_000,
    })
    await expect(page.getByText(PESAN_KOSONG_KERANJANG)).toHaveCount(0)
  })

  test('/checkout tanpa produk terpilih LANGSUNG menampilkan keadaan kosong', async ({
    page,
    baseURL,
  }) => {
    expect(baseURL, 'baseURL wajib ada').toBeTruthy()

    // Tak ada cookie checkout, dan resolve produk tetap ditahan.
    //
    // Yang diuji: keadaan kosong TIDAK ikut menunggu jaringan. Cookie kosong sudah cukup untuk
    // memutuskan — tak ada apa pun yang perlu di-resolve. Menahannya di balik kerangka hanya
    // membuat orang yang membuka /checkout langsung menatap kotak abu tanpa alasan.
    await tahanResolveProduk(page)
    await page.goto('/checkout')

    await expect(
      page.getByRole('heading', { name: PESAN_KOSONG_CHECKOUT }),
      'keadaan kosong ikut tertahan menunggu API padahal tak ada yang perlu dimuat',
    ).toBeVisible({ timeout: 10_000 })

    // Dan tautan keluarnya tetap tersedia.
    await expect(page.getByRole('link', { name: 'Ke Keranjang' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Lacak Pesanan' })).toBeVisible()
  })
})
