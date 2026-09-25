// tests/e2e/_tmp-draf-lama.spec.ts
// SEMENTARA — reproduksi bug "Cannot read properties of undefined (reading 'trim')".
// Menanam draf checkout versi LAMA (tanpa kunci `email`) lalu membuka /checkout.

import { test, expect, type Page } from '@playwright/test'

// Persis bentuk draf yang ditulis versi aplikasi SEBELUM field email ada.
const DRAF_LAMA = {
  address: {
    recipientName: 'Budi Draf Lama',
    phone: '081234567890',
    destination_id: '5fc62f63f8f44b34aa4c0e0a',
    provinceName: 'DKI JAKARTA',
    cityName: 'JAKARTA PUSAT',
    districtName: 'GAMBIR',
    subdistrictName: 'GAMBIR',
    postalCode: '10110',
    street: 'Jl. Draf Versi Lama No. 1',
    // TIDAK ADA `email` — inilah pemicunya
  },
  courier: null,
  savedAt: Date.now(),
}

async function siapkanKeranjang(page: Page, baseURL: string) {
  const { products = [] } = (await (
    await page.request.get(`${baseURL}/api/products/list`)
  ).json()) as { products?: { id: string; promoPrice: number; stock?: number; archived?: boolean }[] }
  const produk = products
    .filter((p) => !p.archived && (p.stock ?? 0) > 0 && p.promoPrice > 0)
    .sort((a, b) => b.promoPrice - a.promoPrice)[0]
  const nilai = Buffer.from(
    JSON.stringify([{ productId: produk!.id, quantity: 1, price: produk!.promoPrice }]),
    'utf-8',
  ).toString('base64')
  await page.context().addCookies([
    { name: 'infarm_checkout', value: nilai, domain: new URL(baseURL).hostname, path: '/' },
  ])
}

test('draf checkout versi lama (tanpa email) tidak memutihkan halaman', async ({
  page,
  baseURL,
}) => {
  const errorRuntime: string[] = []
  page.on('pageerror', (e) => errorRuntime.push(e.message))

  await siapkanKeranjang(page, baseURL!)

  // Tanam draf lama SEBELUM /checkout dirender
  await page.addInitScript((draf) => {
    window.localStorage.setItem('checkout_draft', JSON.stringify(draf))
  }, DRAF_LAMA)

  await page.goto('/checkout')

  await expect(
    page.getByRole('heading', { name: 'Alamat Pengiriman' }),
    'halaman checkout tidak merender form — kemungkinan crash',
  ).toBeVisible({ timeout: 45_000 })

  console.log('\n=== ERROR RUNTIME DI HALAMAN ===')
  console.log(' ', errorRuntime.length === 0 ? '(tidak ada)' : errorRuntime.join('\n  '))
  expect(
    errorRuntime.filter((m) => m.includes('trim')),
    'masih ada TypeError .trim() dari draf lama',
  ).toHaveLength(0)

  console.log('\n=== FIELD DARI DRAF LAMA PULIH? ===')
  for (const [label, harapan] of [
    ['Nama Lengkap Penerima', DRAF_LAMA.address.recipientName],
    ['Nomor Telepon Aktif', DRAF_LAMA.address.phone],
    ['Alamat Lengkap (Nama Jalan & Nomor Rumah)', DRAF_LAMA.address.street],
  ] as const) {
    const nilai = await page.getByLabel(label).inputValue()
    console.log(`  ${label.padEnd(42)}: "${nilai}"`)
    expect(nilai, `${label} tak pulih dari draf lama`).toBe(harapan)
  }

  const email = await page.getByLabel('Email Aktif').inputValue()
  console.log(`  ${'Email Aktif (harus kosong)'.padEnd(42)}: "${email}"`)
  expect(email, 'email harus kosong, bukan undefined').toBe('')

  const bayar = page.getByRole('button', { name: 'Bayar Sekarang' }).first()
  console.log('\n  tombol bayar nonaktif (email masih kosong):', await bayar.isDisabled())
  expect(await bayar.isDisabled()).toBe(true)
})
