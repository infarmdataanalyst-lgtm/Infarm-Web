// tests/e2e/helpers/checkout.ts
// Helper bersama untuk uji E2E halaman checkout. BUKAN berkas uji — Playwright hanya mengumpulkan
// `*.spec.ts`, jadi file ini tak pernah dijalankan sebagai test.

import { expect, type Page } from '@playwright/test'

// Cookie snapshot item checkout. Nilainya base64 dari JSON, mengikuti writeCookie() di
// src/lib/cart-client.ts — kalau format itu berubah, helper ini ikut harus diperbarui.
const CHECKOUT_COOKIE = 'infarm_checkout'

// Placeholder asli input pencarian alamat (AddressSearchCombobox). Dipakai sebagai lokator supaya
// uji tak bergantung pada id/class yang bisa berubah kapan saja.
export const ADDRESS_SEARCH_PLACEHOLDER = 'Cari kelurahan, kecamatan, atau kota…'

type CartItem = { productId: string; quantity: number; price: number }

function encodeCartCookie(items: CartItem[]): string {
  return Buffer.from(JSON.stringify(items), 'utf-8').toString('base64')
}

// Menyiapkan satu produk NYATA di cookie checkout supaya /checkout merender form alamat.
//
// Tanpa ini halaman menampilkan keadaan kosong ("Belum ada produk untuk dibayar") dan form tak
// pernah ada — ujinya gagal pada hal yang sama sekali bukan yang sedang diuji.
//
// Produk diambil dari API, tidak di-hardcode: item cookie hanya jadi baris ringkasan bila id-nya
// benar-benar ada. Id karangan tersaring habis dan hasilnya sama saja, keadaan kosong.
export async function seedCheckoutCookie(page: Page, baseURL: string): Promise<void> {
  const res = await page.request.get(`${baseURL}/api/products/list`)
  expect(res.ok(), 'GET /api/products/list harus berhasil').toBeTruthy()

  // `promoPrice` = harga jual, BUKAN `price` — endpoint mengembalikan `originalPrice` &
  // `promoPrice`, tak ada field bernama `price`. Salah nama membuat cookie berisi harga
  // `undefined` dan halaman jatuh ke keadaan kosong tanpa pesan apa pun.
  const body = (await res.json()) as {
    products?: { id: string; promoPrice: number; archived?: boolean; stock?: number }[]
  }
  const product = (body.products ?? []).find((p) => !p.archived && (p.stock ?? 0) > 0)
  expect(
    product,
    'butuh minimal satu produk aktif & berstok di database untuk menjalankan uji ini',
  ).toBeTruthy()

  const { hostname } = new URL(baseURL)
  await page.context().addCookies([
    {
      name: CHECKOUT_COOKIE,
      value: encodeCartCookie([{ productId: product!.id, quantity: 1, price: product!.promoPrice }]),
      domain: hostname,
      path: '/',
    },
  ])
}

// Membuka /checkout dengan keranjang sudah terisi, lalu memastikan form alamat benar-benar tampil.
export async function openCheckoutWithCart(page: Page, baseURL: string): Promise<void> {
  await seedCheckoutCookie(page, baseURL)
  await page.goto('/checkout')
  await expect(
    page.getByRole('heading', { name: 'Alamat Pengiriman' }),
    'form alamat tak muncul — cookie checkout kemungkinan gagal di-seed',
  ).toBeVisible()
}

// Section form alamat — dipakai sebagai bingkai screenshot supaya gambarnya fokus ke kolom wilayah,
// bukan seluruh halaman (bottom sheet ongkir menutupi separuh bawah layar begitu alamat dipilih).
export function addressSection(page: Page) {
  return page.locator('section', {
    has: page.getByRole('heading', { name: 'Alamat Pengiriman' }),
  })
}

// Mengisi kotak pencarian alamat dan MEMASTIKAN nilainya benar-benar menempel.
//
// ⚠️ Percobaan tunggal `fill()` tidak cukup dan gagal berselang-seling. Input-nya terkendali React;
// bila `fill` mendarat sebelum halaman selesai terhidrasi, React menimpa DOM dengan state awalnya
// yang kosong dan ketikan hilang tanpa jejak. Mengulang sampai nilainya bertahan jauh lebih murah
// daripada menebak kapan hidrasi selesai.
export async function fillAddressSearch(page: Page, keyword: string): Promise<void> {
  const search = page.getByPlaceholder(ADDRESS_SEARCH_PLACEHOLDER)
  await expect(search).toBeVisible()

  await expect(async () => {
    await search.fill(keyword)
    await expect(search).toHaveValue(keyword, { timeout: 1_000 })
  }).toPass({ timeout: 15_000 })
}
