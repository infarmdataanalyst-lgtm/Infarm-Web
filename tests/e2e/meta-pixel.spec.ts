// tests/e2e/meta-pixel.spec.ts
// Memastikan Meta Pixel terpasang di halaman toko, event-nya terkirim di titik yang benar, dan
// TIDAK terpasang di /oms & /maintenance — TANPA pernah menghubungi Meta.
//
// ── Cara kerjanya ──
// Snippet Meta mendefinisikan `window.fbq` lebih dulu dan menaruh setiap panggilan ke
// `fbq.queue` sampai fbevents.js selesai dimuat. Semua request ke facebook.net/facebook.com
// diblokir di sini, jadi skrip itu tak pernah datang dan antrean berisi SELURUH panggilan yang
// dibuat kode kita — persis yang ingin diperiksa, tanpa satu byte pun ke Meta dan tanpa Pixel ID
// sungguhan.
//
// ── Prasyarat ──
// Dev server harus dijalankan dengan NEXT_PUBLIC_META_PIXEL_ID terisi (angka apa pun, mis.
// 123456789012345). Tanpa itu gate tak merender snippet dan seluruh berkas ini DILEWATI, bukan
// gagal — pixel memang opsional.
//
// Tidak menulis ke Supabase, tidak memanggil API berbayar. Boleh paralel.

import { expect, test, type Page } from '@playwright/test'

type FbqCall = [string, string, Record<string, unknown>?, { eventID?: string }?]

// Seluruh isi fbq.queue, atau null bila fbq tak ada di halaman.
async function fbqQueue(page: Page): Promise<FbqCall[] | null> {
  return page.evaluate(() => {
    const w = window as unknown as { fbq?: { queue?: ArrayLike<unknown>[] } }
    if (typeof w.fbq !== 'function' || !w.fbq.queue) return null
    return w.fbq.queue.map((a) => Array.from(a)) as FbqCall[]
  })
}

async function searchEvents(page: Page) {
  const q = (await fbqQueue(page)) ?? []
  return q.filter((c) => c[1] === 'Search').map((c) => c[2] as { search_string: string; results_count: number })
}

test.beforeEach(async ({ page }) => {
  await page.route(/facebook\.(net|com)/, (route) => route.abort())
});

// Lewati seluruh berkas bila pixel tidak dikonfigurasi di server yang diuji.
test.beforeEach(async ({ page }) => {
  await page.goto('/')
  // Snippet disuntik SETELAH hidrasi (afterInteractive), jadi tunggu — jangan periksa sekali lalu
  // menyimpulkan tak ada; di bawah beban paralel hidrasi bisa butuh beberapa detik.
  const ada = await page
    .locator('#meta-pixel')
    .waitFor({ state: 'attached', timeout: 10_000 })
    .then(() => true)
    .catch(() => false)
  test.skip(!ada, 'NEXT_PUBLIC_META_PIXEL_ID tidak di-set di dev server — pixel memang opsional')
  await page.waitForFunction(() => typeof (window as unknown as { fbq?: unknown }).fbq === 'function')
})

test('beranda: init + PageView dari snippet', async ({ page }) => {
  const q = (await fbqQueue(page))!
  expect(q[0][0]).toBe('init')
  expect(q[0][1]).toMatch(/^\d+$/)
  expect(q.map((c) => c[1])).toContain('PageView')
})

test('navigasi client ke produk: PageView kedua + ViewContent dengan eventID', async ({ page }) => {
  const href = (await page.locator('a[href^="/produk/"]').first().getAttribute('href'))!
  await page.locator(`a[href="${href}"]`).first().click()
  await page.waitForURL(`**${href}`)
  await expect.poll(async () => (await fbqQueue(page))!.filter((c) => c[1] === 'PageView').length).toBe(2)

  const view = (await fbqQueue(page))!.find((c) => c[1] === 'ViewContent')!
  expect(view).toBeTruthy()
  const params = view[2]!
  expect(params.content_type).toBe('product')
  expect(Array.isArray(params.content_ids)).toBe(true)
  expect((params.content_ids as string[]).length).toBe(1)
  expect(params.currency).toBe('IDR')
  expect(view[3]?.eventID).toMatch(/^ViewContent\./)
})

test.describe('pencarian: hanya kata kunci final', () => {
  test('berhenti mengetik → satu Search untuk kata utuh, bukan per ketukan', async ({ page }) => {
    const input = page.locator('input[aria-label="Cari produk"]:visible').first()
    await input.click()
    await input.pressSequentially('pupuk', { delay: 60 })
    await expect.poll(() => searchEvents(page), { timeout: 10_000 }).toHaveLength(1)
    const [ev] = await searchEvents(page)
    expect(ev.search_string).toBe('pupuk')
    expect(ev.results_count).toBeGreaterThan(0)
  })

  test('tanpa hasil + Enter → Search dengan results_count 0', async ({ page }) => {
    const input = page.locator('input[aria-label="Cari produk"]:visible').first()
    await input.click()
    await input.pressSequentially('zzqqxx', { delay: 40 })
    await page.getByText('Produk yang Anda cari tidak ditemukan.').waitFor()
    await input.press('Enter')
    await expect
      .poll(async () => (await searchEvents(page)).map((e) => [e.search_string, e.results_count]))
      .toEqual([['zzqqxx', 0]])
  })

  test('pilih saran → Search langsung, sebelum jeda diam', async ({ page }) => {
    const input = page.locator('input[aria-label="Cari produk"]:visible').first()
    await input.click()
    await input.pressSequentially('benih', { delay: 40 })
    await page.locator('[role="listbox"] [role="option"]').first().waitFor()
    await input.press('Enter')
    // Langsung — bukan setelah SEARCH_REPORT_IDLE (1,5 dtk)
    await expect.poll(() => searchEvents(page), { timeout: 800 }).toHaveLength(1)
    expect((await searchEvents(page))[0].search_string).toBe('benih')
  })

  test('Enter saat saran masih milik kata lama → kata baru TIDAK dilaporkan dengan saran lama', async ({ page }) => {
    const input = page.locator('input[aria-label="Cari produk"]:visible').first()
    await input.click()
    await input.pressSequentially('pupuk', { delay: 40 })
    await page.locator('[role="listbox"] [role="option"]').first().waitFor()

    // Tahan respons untuk kata baru, supaya saran "pupuk" masih tampil saat Enter ditekan
    let tertahan: (() => void) | undefined
    await page.route('**/api/products/search?q=qqzz*', (route) => {
      tertahan = () => route.abort()
    })
    await input.fill('qqzz')
    await page.waitForTimeout(600) // debounce lewat, fetch tertahan
    await input.press('Enter')
    await page.waitForTimeout(300)

    const events = await searchEvents(page)
    expect(events.map((e) => e.search_string)).not.toContain('qqzz')
    tertahan?.()
  })
})

test('area /oms dan /maintenance: pixel tidak dimuat', async ({ page }) => {
  for (const path of ['/oms/login', '/maintenance']) {
    await page.goto(path)
    expect(await page.locator('#meta-pixel').count(), path).toBe(0)
    expect(await fbqQueue(page), path).toBeNull()
  }
})
