// tests/e2e/oms-quick-search.spec.ts
// Pencarian cepat header OMS: API GET /api/oms/search & /api/oms/orders/detail, serta panel
// mengambang QuickSearchPanel (cari, tempel daftar, Ctrl+K, detail, lintas halaman, geser).
//
// ── Data uji di-seed langsung ke Supabase, lalu dihapus lagi ──
// - TIGA akun admin_users sementara: admin-api, admin-ui (dipisah supaya jatah rate limit
//   OMS_SEARCH_ADMIN 40/menit tak saling habis), dan staff. Password acak 48 hex, hanya hidup di
//   memori proses uji; hash dibuat dengan format yang sama dengan hashPassword() di admins.ts.
// - TIGA pesanan TANPA order_items (tak menyentuh stok): dua milik pembeli X (nama & HP sama,
//   status berbeda), satu milik pembeli Y. Nama pembeli berupa huruf acak supaya pencarian nama
//   hanya mencocokkan data uji ini, bukan pelanggan sungguhan.
// Semua dihapus di afterAll, termasuk bila uji gagal di tengah jalan.
//
// ── Serial ──
// Menulis ke Supabase dan bergantung pada urutan (uji rate limit sengaja paling akhir).
//
// Tidak ada panggilan API berbayar: hanya Supabase + halaman/API lokal. Modal detail hanya DIBUKA
// dan ditutup — status tak pernah disimpan, jadi Mengantar & Xendit tak tersentuh.

import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { randomBytes, scryptSync } from 'node:crypto'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

// === Kredensial Supabase (pola sama dengan order-cancel-by-buyer.spec.ts) ===

function dariEnvLocal(kunci: string): string {
  try {
    const isi = readFileSync('.env.local', 'utf-8')
    const baris = isi.split('\n').find((l) => l.startsWith(`${kunci}=`))
    return baris ? baris.slice(kunci.length + 1).trim() : ''
  } catch {
    return ''
  }
}

function kredensialSupabase(): { url: string; key: string } {
  const dariEnv = (nama: string) => process.env[nama]?.trim() ?? ''
  return {
    url: dariEnv('E2E_SUPABASE_URL') || dariEnv('NEXT_PUBLIC_SUPABASE_URL') || dariEnvLocal('NEXT_PUBLIC_SUPABASE_URL'),
    key:
      dariEnv('E2E_SUPABASE_SERVICE_ROLE_KEY') ||
      dariEnv('SUPABASE_SERVICE_ROLE_KEY') ||
      dariEnvLocal('SUPABASE_SERVICE_ROLE_KEY'),
  }
}

// === Pembangkit data uji ===

// Huruf kecil acak — nama pembeli uji WAJIB tanpa angka supaya terbaca sebagai pencarian nama.
function hurufAcak(n: number): string {
  const abjad = 'abcdefghijklmnopqrstuvwxyz'
  return Array.from(randomBytes(n), (b) => abjad[b % abjad.length]).join('')
}

function nomorTelepon(): string {
  let n = '08'
  while (n.length < 12) n += Math.floor(Math.random() * 10)
  return n
}

function nomorInvoice(): string {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date())
    .replace(/-/g, '')
  return `INV-${ymd}-E2E${randomBytes(3).toString('hex').toUpperCase()}`
}

// Format sama dengan hashPassword() di src/lib/mock-db/admins.ts: scrypt keylen 64, salt 16 byte.
function hashPassword(password: string): string {
  const salt = randomBytes(16)
  return `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`
}

type Akun = { id: string; username: string; password: string }
type PesananUji = { invoice: string; resi: string | null }

let db: SupabaseClient
const invoiceDibuat: string[] = []
const akunDibuat: string[] = []

// Identitas pembeli uji — diacak per run.
const namaX = `Uji Cari ${hurufAcak(8)}`
const namaY = `Uji Lain ${hurufAcak(8)}`
const hpX = nomorTelepon()
const hpY = nomorTelepon()

let adminApi: Akun
let adminUi: Akun
let staff: Akun
let pesananA: PesananUji // pembeli X, Diproses/Lunas, punya resi
let pesananB: PesananUji // pembeli X, Menunggu Pembayaran, tanpa resi
let pesananC: PesananUji // pembeli Y, Dikirim/Lunas, punya resi

let apiAdmin: APIRequestContext
let apiStaff: APIRequestContext
let apiAnon: APIRequestContext

async function buatAkun(role: 'admin' | 'staff', label: string): Promise<Akun> {
  const username = `e2e-quicksearch-${label}-${hurufAcak(6)}@contoh.test`
  const password = randomBytes(24).toString('hex')
  const { data, error } = await db
    .from('admin_users')
    .insert({ username, password_hash: hashPassword(password), name: `E2E ${label}`, is_active: true, role })
    .select('id')
    .single()
  if (error || !data) throw new Error(`Gagal membuat akun uji ${label}: ${error?.message}`)
  akunDibuat.push((data as { id: string }).id)
  return { id: (data as { id: string }).id, username, password }
}

async function seedPesanan(isi: {
  nama: string
  hp: string
  status: string
  bayar: string
  resi: boolean
  metode?: string
}): Promise<PesananUji> {
  const invoice = nomorInvoice()
  const resi = isi.resi ? `E2ERESI${randomBytes(4).toString('hex').toUpperCase()}` : null
  invoiceDibuat.push(invoice)
  const { error } = await db.from('orders').insert({
    nomor_invoice: invoice,
    email: `e2e-quicksearch-${hurufAcak(6)}@contoh.test`,
    no_telepon: isi.hp,
    nama_customer: isi.nama,
    jumlah_total: 75_000,
    order_status: isi.status,
    status_pembayaran: isi.bayar,
    no_tracking: resi,
    nama_ekspedisi: resi ? 'J&T' : null,
    ...(isi.metode ? { metode_pembayaran: isi.metode } : {}),
  })
  if (error) throw new Error(`Gagal menyisipkan pesanan uji: ${error.message} (${error.code})`)
  return { invoice, resi }
}

// Login lewat API resmi; cookie sesi tersimpan di konteks yang dipakai.
async function loginApi(ctx: APIRequestContext, akun: Akun): Promise<void> {
  const res = await ctx.post('/api/oms/login', { data: { username: akun.username, password: akun.password } })
  expect(res.status(), `login ${akun.username} harus berhasil`).toBe(200)
}

async function cari(ctx: APIRequestContext, q: string) {
  return ctx.get(`/api/oms/search?q=${encodeURIComponent(q)}`)
}

// === Helper UI ===

function searchBar(page: Page) {
  return page.getByRole('searchbox', { name: 'Cari pesanan' })
}

function panel(page: Page) {
  return page.getByRole('region', { name: 'Hasil pencarian cepat' })
}

function pegangan(page: Page) {
  return page.getByTitle('Geser untuk memindahkan · klik dua kali untuk kembali ke posisi awal')
}

async function loginUi(page: Page, akun: Akun, tujuan = '/oms/dashboard/orders'): Promise<void> {
  const res = await page.request.post('/api/oms/login', { data: { username: akun.username, password: akun.password } })
  expect(res.status()).toBe(200)
  await page.goto(tujuan)
  await expect(searchBar(page)).toBeVisible()
}

// Mengetik lalu Enter, dengan pengulangan bila React belum terhidrasi dan ketikan hilang.
async function ketikDanCari(page: Page, teks: string): Promise<void> {
  const input = searchBar(page)
  await expect(async () => {
    await input.fill(teks)
    await expect(input).toHaveValue(teks)
  }).toPass({ timeout: 15_000 })
  await input.press('Enter')
}

test.describe.serial('Pencarian cepat header OMS', () => {
  test.beforeAll(async () => {
    const { url, key } = kredensialSupabase()
    if (!url || !key) throw new Error('Kredensial Supabase tak ditemukan (.env.local / E2E_SUPABASE_*).')
    db = createClient(url, key, { auth: { persistSession: false } })

    adminApi = await buatAkun('admin', 'admin-api')
    adminUi = await buatAkun('admin', 'admin-ui')
    staff = await buatAkun('staff', 'staff')

    pesananA = await seedPesanan({ nama: namaX, hp: hpX, status: 'PROCESSING', bayar: 'PAID', resi: true, metode: 'BCA' })
    pesananB = await seedPesanan({ nama: namaX, hp: hpX, status: 'PENDING', bayar: 'PENDING', resi: false })
    pesananC = await seedPesanan({ nama: namaY, hp: hpY, status: 'SHIPPED', bayar: 'PAID', resi: true, metode: 'SHOPEEPAY' })

    apiAdmin = await playwrightRequest.newContext({ baseURL: BASE_URL })
    apiStaff = await playwrightRequest.newContext({ baseURL: BASE_URL })
    apiAnon = await playwrightRequest.newContext({ baseURL: BASE_URL })
    await loginApi(apiAdmin, adminApi)
    await loginApi(apiStaff, staff)
  })

  test.afterAll(async () => {
    await Promise.all([apiAdmin?.dispose(), apiStaff?.dispose(), apiAnon?.dispose()])
    if (!db) return
    if (invoiceDibuat.length > 0) {
      const { error } = await db.from('orders').delete().in('nomor_invoice', invoiceDibuat)
      if (error) console.warn(`[cleanup] Gagal menghapus pesanan uji (${invoiceDibuat.join(', ')}): ${error.message}`)
    }
    if (akunDibuat.length > 0) {
      const { error } = await db.from('admin_users').delete().in('id', akunDibuat)
      if (error) console.warn(`[cleanup] Gagal menghapus akun uji (${akunDibuat.join(', ')}): ${error.message}`)
    }
  })

  // ===================================================================
  // API — keamanan & hak akses
  // ===================================================================

  test('API: tanpa login → 401 untuk search dan detail', async () => {
    const s = await cari(apiAnon, pesananA.invoice)
    expect(s.status()).toBe(401)
    const d = await apiAnon.get(`/api/oms/orders/detail?invoice=${pesananA.invoice}`)
    expect(d.status()).toBe(401)
  })

  test('API: permintaan lintas situs ditolak 403 walau sesi valid', async () => {
    const res = await apiAdmin.get(`/api/oms/search?q=${pesananA.invoice}`, {
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    })
    expect(res.status()).toBe(403)
    expect((await res.json()).code).toBe('CROSS_SITE_DENIED')
  })

  test('API: staff boleh cari invoice, tapi nama & nomor HP ditolak 403 FORBIDDEN_ROLE', async () => {
    const inv = await cari(apiStaff, pesananA.invoice)
    expect(inv.status()).toBe(200)
    expect((await inv.json()).results).toHaveLength(1)

    for (const q of [namaX, hpX]) {
      const res = await cari(apiStaff, q)
      expect(res.status(), `staff mencari "${q === hpX ? 'nomor HP' : 'nama'}"`).toBe(403)
      const body = await res.json()
      expect(body.code).toBe('FORBIDDEN_ROLE')
      expect(body.results, 'respons 403 tak boleh membawa hasil').toBeUndefined()
    }
  })

  test('API: hasil ramping — tanpa nomor HP, email, alamat, atau item', async () => {
    const res = await cari(apiAdmin, pesananA.invoice)
    const hasil = (await res.json()).results[0] as Record<string, unknown>
    for (const kunci of ['customerPhone', 'customerEmail', 'address', 'items', 'no_telepon', 'email']) {
      expect(hasil, `field ${kunci} tak boleh ada`).not.toHaveProperty(kunci)
    }
    expect(hasil).toMatchObject({
      orderId: pesananA.invoice,
      customerName: namaX,
      status: 'Diproses',
      paymentStatus: 'Lunas',
      paymentMethodLabel: 'BCA · Transfer Bank',
      trackingNumber: pesananA.resi,
      totalAmount: 75_000,
      matchedBy: 'invoice',
    })
  })

  // ===================================================================
  // API — pencarian nomor pesanan / resi
  // ===================================================================

  test('API: invoice huruf kecil dan berawalan # tetap ditemukan', async () => {
    for (const q of [pesananA.invoice.toLowerCase(), `#${pesananA.invoice}`]) {
      const body = await (await cari(apiAdmin, q)).json()
      expect(body.results.map((r: { orderId: string }) => r.orderId), `q="${q}"`).toEqual([pesananA.invoice])
    }
  })

  test('API: daftar campuran invoice + resi + nomor asing → urutan dipertahankan & notFound benar', async () => {
    const asing = 'INV-19990101-TIDAKADA'
    const q = `${pesananC.resi}\n${pesananB.invoice}, ${asing}; ${pesananA.invoice}`
    const body = await (await cari(apiAdmin, q)).json()
    expect(body.mode).toBe('orders')
    expect(body.results.map((r: { orderId: string; matchedBy: string }) => [r.orderId, r.matchedBy])).toEqual([
      [pesananC.invoice, 'resi'],
      [pesananB.invoice, 'invoice'],
      [pesananA.invoice, 'invoice'],
    ])
    expect(body.notFound).toEqual([asing])
  })

  test('API: lebih dari 20 nomor sekaligus → 400', async () => {
    const q = Array.from({ length: 21 }, (_, i) => `INV-X-${i}`).join(' ')
    const res = await cari(apiAdmin, q)
    expect(res.status()).toBe(400)
    expect((await res.json()).code).toBe('INVALID_QUERY')
  })

  // ===================================================================
  // API — pencarian nomor HP & nama (admin)
  // ===================================================================

  test('API: nomor HP berbagai format menemukan kedua pesanan pembeli X', async () => {
    const lokalBerspasi = `${hpX.slice(0, 4)} ${hpX.slice(4, 8)} ${hpX.slice(8)}`
    const internasional = `+62 ${hpX.slice(1, 4)}-${hpX.slice(4, 8)}-${hpX.slice(8)}`
    for (const q of [hpX, lokalBerspasi, internasional]) {
      const body = await (await cari(apiAdmin, q)).json()
      expect(body.mode, `q="${q}"`).toBe('phone')
      expect(new Set(body.results.map((r: { orderId: string }) => r.orderId))).toEqual(
        new Set([pesananA.invoice, pesananB.invoice]),
      )
      expect(body.results.every((r: { matchedBy: string }) => r.matchedBy === 'phone')).toBe(true)
    }
  })

  test('API: nama sebagian tanpa beda huruf besar/kecil → hanya pesanan pembeli X', async () => {
    const q = namaX.split(' ').slice(1).join(' ').toUpperCase() // "CARI XXXXXXXX"
    const body = await (await cari(apiAdmin, q)).json()
    expect(body.mode).toBe('name')
    const ids = body.results.map((r: { orderId: string }) => r.orderId)
    expect(new Set(ids)).toEqual(new Set([pesananA.invoice, pesananB.invoice]))
    expect(ids).not.toContain(pesananC.invoice)
  })

  test('API: masukan tak sah ditolak 400 (nama < 3 huruf, wildcard %, karakter HTML)', async () => {
    for (const q of ['Bu', '%', 'abc<script>', '   ']) {
      const res = await cari(apiAdmin, q)
      expect(res.status(), `q="${q}"`).toBe(400)
    }
  })

  // ===================================================================
  // API — detail pesanan
  // ===================================================================

  test('API detail: admin mendapat Order utuh; invoice asing 404; format rusak 400', async () => {
    const ok = await apiAdmin.get(`/api/oms/orders/detail?invoice=${pesananA.invoice}`)
    expect(ok.status()).toBe(200)
    const { order } = await ok.json()
    expect(order.orderId).toBe(pesananA.invoice)
    expect(order.customerPhone).toBe(hpX)

    const asing = await apiAdmin.get('/api/oms/orders/detail?invoice=INV-19990101-TIDAKADA')
    expect(asing.status()).toBe(404)

    const rusak = await apiAdmin.get(`/api/oms/orders/detail?invoice=${encodeURIComponent('INV 1\nbaris')}`)
    expect(rusak.status()).toBe(400)
  })

  // ===================================================================
  // UI — panel mengambang
  // ===================================================================

  test('UI: Enter mencari invoice → kartu tampil lengkap, detail membuka modal pesanan', async ({ page }) => {
    await loginUi(page, adminUi)
    await ketikDanCari(page, pesananA.invoice)

    const p = panel(page)
    await expect(p).toBeVisible()
    await expect(p.getByText(pesananA.invoice, { exact: true })).toBeVisible()
    await expect(p.getByText('Diproses', { exact: true })).toBeVisible()
    await expect(p.getByText('Bayar: Lunas')).toBeVisible()
    await expect(p.getByText(pesananA.resi!)).toBeVisible()
    await expect(p.getByText('cocok: invoice')).toBeVisible()

    await p.getByRole('button', { name: 'Detail & ubah status' }).click()
    const modal = page.getByRole('button', { name: 'Tutup', exact: true })
    await expect(modal).toBeVisible()
    await expect(page.getByText(`#${pesananA.invoice}`).first()).toBeVisible()
    await modal.click() // TIDAK menyimpan apa pun
    await expect(modal).toBeHidden()
    await expect(p, 'panel tetap ada setelah modal ditutup').toBeVisible()
  })

  test('UI: menempel daftar nomor langsung mencari tanpa Enter, nomor asing ditandai', async ({ page }) => {
    await loginUi(page, adminUi)
    const input = searchBar(page)
    await input.click()
    const teks = `${pesananA.invoice}\n${pesananC.resi}\nINV-19990101-TIDAKADA`
    await expect(async () => {
      await input.evaluate((el, t) => {
        const dt = new DataTransfer()
        dt.setData('text/plain', t)
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
      }, teks)
      await expect(panel(page)).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 15_000 })

    const p = panel(page)
    await expect(p.getByText(pesananA.invoice, { exact: true })).toBeVisible()
    await expect(p.getByText(pesananC.invoice, { exact: true })).toBeVisible()
    await expect(p.getByText('cocok: resi')).toBeVisible()
    await expect(p.getByText('Tidak ditemukan sebagai nomor pesanan atau resi (1)')).toBeVisible()
  })

  test('UI: satu kata kunci tak ditemukan → tautan ke Produk & Kelola Stok', async ({ page }) => {
    await loginUi(page, adminUi)
    await ketikDanCari(page, 'SKU-E2E-TIDAKADA')
    const p = panel(page)
    await expect(p.getByRole('link', { name: 'Cari di Produk →' })).toHaveAttribute(
      'href',
      '/oms/dashboard/products?q=SKU-E2E-TIDAKADA',
    )
    await expect(p.getByRole('link', { name: 'Cari di Kelola Stok →' })).toHaveAttribute(
      'href',
      '/oms/dashboard/gudang/stok?search=SKU-E2E-TIDAKADA',
    )
  })

  test('UI: Ctrl+K memfokuskan search bar', async ({ page }) => {
    await loginUi(page, adminUi)
    await page.locator('main, body').first().click({ position: { x: 5, y: 5 } }).catch(() => {})
    await expect(searchBar(page)).not.toBeFocused()
    await page.keyboard.press('Control+K')
    await expect(searchBar(page)).toBeFocused()
  })

  test('UI: panel tetap terbuka saat pindah halaman lewat sidebar', async ({ page }) => {
    await loginUi(page, adminUi)
    await ketikDanCari(page, pesananA.invoice)
    await expect(panel(page).getByText(pesananA.invoice, { exact: true })).toBeVisible()

    await page.getByRole('link', { name: 'Produk', exact: true }).click()
    await expect(page).toHaveURL(/\/oms\/dashboard\/products/)
    await expect(panel(page).getByText(pesananA.invoice, { exact: true })).toBeVisible()
    await expect(searchBar(page), 'kolom menunjukkan pencarian yang sedang tampil').toHaveValue(pesananA.invoice)
  })

  test('UI: panel bisa digeser, dijepit di dalam layar, dobel klik kembali ke posisi awal', async ({ page }) => {
    await loginUi(page, adminUi)
    await ketikDanCari(page, pesananA.invoice)
    const p = panel(page)
    await expect(p.getByText(pesananA.invoice, { exact: true })).toBeVisible()

    const viewport = page.viewportSize()!
    const awal = (await p.boundingBox())!
    // Posisi bawaan: pojok kanan bawah (bottom-4 right-4 = 16px).
    expect(Math.round(viewport.width - (awal.x + awal.width))).toBe(16)
    expect(Math.round(viewport.height - (awal.y + awal.height))).toBe(16)

    // Pegang di sisi kiri kepala panel (area ikon grip, jauh dari tombol perkecil/tutup).
    const h = (await pegangan(page).boundingBox())!
    const mulai = { x: h.x + 20, y: h.y + h.height / 2 }
    await page.mouse.move(mulai.x, mulai.y)
    await page.mouse.down()
    await page.mouse.move(mulai.x - 300, mulai.y - 200, { steps: 10 })
    await page.mouse.up()
    const digeser = (await p.boundingBox())!
    expect(Math.round(awal.x - digeser.x)).toBe(300)
    expect(Math.round(awal.y - digeser.y)).toBe(200)

    // Tarik jauh melewati pojok kiri atas → dijepit 8px dari tepi.
    const h2 = (await pegangan(page).boundingBox())!
    await page.mouse.move(h2.x + 20, h2.y + h2.height / 2)
    await page.mouse.down()
    await page.mouse.move(-2000, -2000, { steps: 10 })
    await page.mouse.up()
    const dijepit = (await p.boundingBox())!
    expect(Math.round(dijepit.x)).toBe(8)
    expect(Math.round(dijepit.y)).toBe(8)

    // Dobel klik kepala panel → kembali ke pojok kanan bawah.
    const h3 = (await pegangan(page).boundingBox())!
    await page.mouse.dblclick(h3.x + 20, h3.y + h3.height / 2)
    const kembali = (await p.boundingBox())!
    expect(Math.round(kembali.x)).toBe(Math.round(awal.x))
    expect(Math.round(kembali.y)).toBe(Math.round(awal.y))
  })

  test('UI: tombol di kepala panel tidak ikut menggeser; perkecil/buka & Esc menutup', async ({ page }) => {
    await loginUi(page, adminUi)
    await ketikDanCari(page, pesananA.invoice)
    const p = panel(page)
    await expect(p.getByText(pesananA.invoice, { exact: true })).toBeVisible()
    const awal = (await p.boundingBox())!

    await p.getByRole('button', { name: 'Perkecil panel' }).click()
    await expect(p.getByText(pesananA.invoice, { exact: true })).toBeHidden()
    const kecil = (await p.boundingBox())!
    expect(kecil.height).toBeLessThan(awal.height)
    expect(Math.round(page.viewportSize()!.width - (kecil.x + kecil.width)), 'klik tombol tak menggeser panel').toBe(16)

    await p.getByRole('button', { name: 'Buka panel' }).click()
    await expect(p.getByText(pesananA.invoice, { exact: true })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(p).toBeHidden()
  })

  test('UI: staff mencari nama → pesan khusus admin tampil di panel, tanpa hasil', async ({ page }) => {
    await loginUi(page, staff)
    await ketikDanCari(page, namaX)
    const p = panel(page)
    await expect(p.getByText('hanya untuk akun admin', { exact: false })).toBeVisible()
    await expect(p.getByText(pesananA.invoice)).toHaveCount(0)
  })

  // ===================================================================
  // API — rate limit (PALING AKHIR: menghabiskan jatah akun staff)
  // ===================================================================

  test('API: rate limit per akun → 429 setelah melewati 40 pencarian/menit', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 45; i++) {
      statuses.push((await cari(apiStaff, pesananA.invoice)).status())
    }
    expect(statuses, 'harus ada 429').toContain(429)
    expect(statuses.filter((s) => s !== 200 && s !== 429), 'hanya 200 atau 429').toHaveLength(0)

    // Jatah per AKUN, bukan global: admin lain tetap bisa mencari.
    const adminLain = await cari(apiAdmin, pesananA.invoice)
    expect(adminLain.status()).toBe(200)
  })
})
