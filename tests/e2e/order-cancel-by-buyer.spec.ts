// tests/e2e/order-cancel-by-buyer.spec.ts
// Pembatalan pesanan oleh pembeli lewat /cancel-order — alur DUA IDENTITAS:
// cari pakai EMAIL (langkah 1), lalu konfirmasi pakai NO_TELEPON (langkah 2).
//
// Tiga skenario:
//   1. NEGATIF — no_telepon salah → pembatalan ditolak, order_status di DB TIDAK berubah.
//   2. POSITIF — no_telepon benar → pembatalan berhasil, order_status di DB jadi CANCELLED.
//   3. ISOLASI — pesanan milik email A tak bisa ditemukan lewat email B.
//
// ── Kenapa pesanan di-seed langsung ke Supabase, bukan lewat checkout UI ──
// Checkout memotong stok, menembak cek ongkir ke Mengantar, dan (bila pembayaran diaktifkan)
// menerbitkan invoice Xendit. Yang diuji di sini cuma alur pembatalan, jadi seluruh biaya dan
// efek samping itu tak ada gunanya ditanggung. Insert langsung juga membuat kondisi awalnya
// pasti: status persis yang dibutuhkan, tanpa bergantung pada apa yang kebetulan ada di database.
//
// ── Kenapa pesanan uji TANPA order_items ──
// Pembatalan memanggil `restoreStock`, yang MENAMBAH stok produk sungguhan. Pesanan tanpa item
// membuat uji ini nol efek samping di luar barisnya sendiri — `restoreStock([])` dan
// `recordOrderStockChanges` dengan daftar kosong keduanya berhenti lebih awal tanpa menyentuh
// apa pun. Konsekuensinya panel "Pesanan dipilih" tak menampilkan daftar produk, jadi asersi
// "detail tampil benar" bersandar pada nomor invoice + status + tanggal, bukan pada isi produk.
//
// ── Kenapa identitas diacak tiap kali dijalankan ──
// Rate limit aplikasi ini in-memory dan hidup selama proses dev server (lihat CLAUDE.md → Rate
// Limiting). Dev server dipakai ulang antar-run Playwright (`reuseExistingServer`), jadi email
// atau nomor yang SAMA akan menumpuk hitungannya sampai uji mulai dijawab 429 — gagal yang
// terlihat seperti bug padahal cuma jejak run sebelumnya. Token acak per run memutus itu.
// Yang tetap konsisten adalah PASANGANNYA: email & no_telepon yang di-seed persis yang dipakai
// mencari dan mengonfirmasi.
//
// ── Serial, bukan paralel ──
// Uji ini MENULIS ke Supabase. `fullyParallel` di playwright.config.ts aman untuk pembacaan saja;
// aturan di tests/e2e/README.md mewajibkan uji penulis dibungkus `describe.serial`.
//
// Tidak ada panggilan API berbayar di berkas ini: hanya Supabase + halaman lokal.

import { test, expect, type Page } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

// Status DB dipakai APA ADANYA (English). Aplikasi memetakannya ke label Indonesia saat menampilkan
// — lihat DB_TO_STATUS di src/lib/mock-db/orders.ts. Menulis 'Diproses' ke kolom ini akan ditolak
// CHECK constraint orders_order_status_check.
const STATUS_AWAL_DB = 'PROCESSING' // ← tampil sebagai "Diproses", salah satu status yang boleh dibatalkan
const STATUS_AWAL_LABEL = 'Diproses'
const STATUS_BATAL_DB = 'CANCELLED'

// === Kredensial Supabase ===
// Urutan: env khusus uji lebih dulu, baru `.env.local` sebagai kemudahan lokal. Proses Playwright
// TIDAK mewarisi env dev server, jadi tanpa salah satunya uji ini tak punya cara membaca database.
// TIDAK ADA nilai default yang di-hardcode — service_role key menembus RLS.
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
  const url =
    dariEnv('E2E_SUPABASE_URL') ||
    dariEnv('NEXT_PUBLIC_SUPABASE_URL') ||
    dariEnvLocal('NEXT_PUBLIC_SUPABASE_URL')
  const key =
    dariEnv('E2E_SUPABASE_SERVICE_ROLE_KEY') ||
    dariEnv('SUPABASE_SERVICE_ROLE_KEY') ||
    dariEnvLocal('SUPABASE_SERVICE_ROLE_KEY')
  return { url, key }
}

// === Pembangkit data uji ===

// Token acak per pemanggilan — dasar email & nomor supaya tiap pesanan uji punya identitas sendiri.
function token(): string {
  return randomBytes(4).toString('hex')
}

// Nomor invoice berformat INV-{YYYYMMDD}-{4 digit acak}, memakai tanggal WIB.
//
// Tanggalnya sengaja diambil lewat `en-CA` + timeZone Asia/Jakarta (menghasilkan YYYY-MM-DD),
// bukan `toISOString()` yang memakai UTC: dijalankan pukul 06.00 WIB, UTC masih di tanggal
// sebelumnya dan nomor invoice akan tertulis mundur sehari.
function nomorInvoice(): string {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date())
    .replace(/-/g, '')
  const acak = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
  return `INV-${ymd}-${acak}`
}

// Nomor telepon uji: '08' + 10 digit acak = 12 digit, memenuhi isValidPhone (08…, 10–12 digit).
function nomorTelepon(): string {
  let n = '08'
  while (n.length < 12) n += Math.floor(Math.random() * 10)
  return n
}

type PesananUji = {
  invoice: string
  email: string
  phone: string
}

let db: SupabaseClient
// Semua invoice yang dibuat berkas ini, untuk dibersihkan di akhir. Diisi SEBELUM insert dikirim
// supaya baris yang terlanjur masuk tapi responsnya gagal tetap ikut terhapus.
const invoiceDibuat: string[] = []

// Menyisipkan satu pesanan uji langsung ke tabel orders.
//
// Kolom yang WAJIB diisi (NOT NULL, tanpa default): nama_customer, jumlah_total. Sisanya dibiarkan
// default/null — pembatalan tak membacanya. `nomor_invoice` unik, jadi tabrakan 4 digit acak
// dicoba ulang beberapa kali alih-alih menggagalkan uji karena kesialan.
async function seedPesanan(email: string, phone: string): Promise<PesananUji> {
  for (let percobaan = 0; percobaan < 5; percobaan++) {
    const invoice = nomorInvoice()
    invoiceDibuat.push(invoice)
    const { error } = await db.from('orders').insert({
      nomor_invoice: invoice,
      email,
      no_telepon: phone,
      nama_customer: 'Pembeli Uji E2E',
      jumlah_total: 75_000,
      order_status: STATUS_AWAL_DB,
      status_pembayaran: 'PENDING',
    })
    if (!error) return { invoice, email, phone }

    // 23505 = unique_violation → nomor acaknya bentrok, coba nomor lain.
    invoiceDibuat.pop()
    if (error.code !== '23505') {
      throw new Error(`Gagal menyisipkan pesanan uji: ${error.message} (${error.code})`)
    }
  }
  throw new Error('Gagal mendapat nomor invoice unik setelah 5 percobaan.')
}

// Membaca order_status APA ADANYA dari DB (nilai English, bukan label tampilan).
async function statusDiDb(invoice: string): Promise<string | null> {
  const { data, error } = await db
    .from('orders')
    .select('order_status')
    .eq('nomor_invoice', invoice)
    .maybeSingle()
  if (error) throw new Error(`Gagal membaca status pesanan: ${error.message}`)
  return (data as { order_status: string } | null)?.order_status ?? null
}

// LANGKAH 1 — buka halaman, cari pesanan dengan email.
//
// Cookie dibersihkan lebih dulu: bila `infarm_email` ada, halaman melewati form dan langsung
// mencari email dari cookie itu — bukan email yang hendak diuji.
async function cariDenganEmail(page: Page, email: string) {
  await page.context().clearCookies()
  await page.goto('/cancel-order')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Cari Pesanan' }).click()
}

test.describe.serial('Batalkan pesanan oleh pembeli (cari via email, konfirmasi via telepon)', () => {
  test.beforeAll(() => {
    const { url, key } = kredensialSupabase()
    if (!url || !key) {
      throw new Error(
        'Kredensial Supabase tak ditemukan. Set E2E_SUPABASE_URL & E2E_SUPABASE_SERVICE_ROLE_KEY, ' +
          'atau pastikan .env.local berisi NEXT_PUBLIC_SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY.',
      )
    }
    db = createClient(url, key, { auth: { persistSession: false } })
  })

  // Bersihkan SEMUA pesanan yang dibuat berkas ini, berhasil maupun gagal di tengah jalan.
  // Dijalankan walau ada uji yang gagal — itu justru saat baris sampah paling mungkin tertinggal.
  test.afterAll(async () => {
    if (!db || invoiceDibuat.length === 0) return
    const { error } = await db.from('orders').delete().in('nomor_invoice', invoiceDibuat)
    if (error) {
      // Jangan menggagalkan run karena pembersihan — laporkan supaya bisa dibereskan manual.
      console.warn(
        `[cleanup] Gagal menghapus pesanan uji (${invoiceDibuat.join(', ')}): ${error.message}`,
      )
    }
  })

  test('menolak pembatalan saat no_telepon konfirmasi salah, dan status di DB tak berubah', async ({
    page,
    request,
  }) => {
    const t = token()
    const pesanan = await seedPesanan(`e2e-batal-neg-${t}@contoh.test`, nomorTelepon())

    // Nomor yang SALAH — dipastikan berbeda dari yang terdaftar, bukan sekadar diacak lagi.
    let teleponSalah = nomorTelepon()
    while (teleponSalah === pesanan.phone) teleponSalah = nomorTelepon()

    // — LANGKAH 1: cari dengan email —
    await cariDenganEmail(page, pesanan.email)

    // — LANGKAH 3 (asersi): detail pesanan tampil —
    //
    // Diperiksa per-elemen, bukan lewat container kartu. Emailnya unik per run sehingga hasil
    // pencarian dijamin PERSIS SATU pesanan — jumlah tombol "Pilih & Batalkan" di bawah yang
    // membuktikannya — jadi tak perlu mengikat asersi ke bentuk DOM kartu yang gampang berubah
    // begitu tata letaknya disentuh.
    await expect(page.getByText(`#${pesanan.invoice}`)).toBeVisible()
    await expect(page.getByText(STATUS_AWAL_LABEL)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Pilih & Batalkan' })).toHaveCount(1)

    // — LANGKAH 4: pilih pesanan untuk dibatalkan —
    await page.getByRole('button', { name: 'Pilih & Batalkan' }).click()

    // — LANGKAH 5 (asersi): muncul langkah verifikasi TAMBAHAN yang meminta no_telepon —
    await expect(page.getByRole('heading', { name: 'Konfirmasi Kepemilikan' })).toBeVisible()
    const isianTelepon = page.getByLabel('Nomor Telepon')
    await expect(isianTelepon).toBeVisible()
    // Kosong, bukan di-prefill: kalau di-isi otomatis, konfirmasinya berhenti mengonfirmasi apa pun.
    await expect(isianTelepon).toHaveValue('')
    // Panel konfirmasi tetap menampilkan pesanan mana yang sedang dipilih.
    await expect(page.getByText('Pesanan dipilih')).toBeVisible()
    await expect(page.getByText(`#${pesanan.invoice}`)).toBeVisible()

    // — LANGKAH 6: isi nomor SALAH lalu verifikasi —
    await isianTelepon.fill(teleponSalah)
    await page.getByRole('button', { name: 'Verifikasi Nomor' }).click()

    // Ditolak dengan pesan yang jelas…
    await expect(
      page.getByText('Nomor telepon tidak cocok dengan pesanan ini. Periksa kembali.'),
    ).toBeVisible()
    // …dan tombol pembatalan TIDAK pernah muncul.
    await expect(page.getByRole('button', { name: 'Ya, Batalkan Pesanan' })).toHaveCount(0)

    // Status di DB tak tersentuh.
    expect(await statusDiDb(pesanan.invoice)).toBe(STATUS_AWAL_DB)

    // Verifikasi bahwa penolakan itu dari SERVER, bukan cuma penjagaan di UI.
    //
    // Klik-klik di halaman tak bisa membuktikannya: penyerang tak memakai halaman kita. Karena itu
    // endpoint eksekusinya dipanggil langsung, melewati seluruh langkah UI, dengan nomor salah.
    // Inilah asersi yang benar-benar menjawab "validasi no_telepon wajib di server".
    const langsung = await request.post('/api/orders/cancel-by-phone', {
      data: { orderId: pesanan.invoice, phone: teleponSalah },
    })
    expect(langsung.status()).toBe(403)
    expect(await langsung.json()).toMatchObject({
      error: 'Nomor telepon tidak cocok dengan pesanan ini.',
    })

    // Tetap tak berubah setelah percobaan langsung itu.
    expect(await statusDiDb(pesanan.invoice)).toBe(STATUS_AWAL_DB)
  })

  test('membatalkan pesanan saat no_telepon konfirmasi benar, dan status di DB jadi CANCELLED', async ({
    page,
  }) => {
    // Pesanan BARU — pesanan uji sebelumnya sudah dipakai skenario negatif, dan memakainya lagi
    // membuat hasil uji ini bergantung pada urutan eksekusi.
    const t = token()
    const pesanan = await seedPesanan(`e2e-batal-pos-${t}@contoh.test`, nomorTelepon())

    expect(await statusDiDb(pesanan.invoice)).toBe(STATUS_AWAL_DB) // kondisi awal

    // — LANGKAH 2: cari dengan email —
    await cariDenganEmail(page, pesanan.email)

    // — LANGKAH 3: detail tampil —
    await expect(page.getByText(`#${pesanan.invoice}`)).toBeVisible()
    await expect(page.getByText(STATUS_AWAL_LABEL)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Pilih & Batalkan' })).toHaveCount(1)

    // — LANGKAH 4 & 5: pilih → form konfirmasi telepon muncul —
    await page.getByRole('button', { name: 'Pilih & Batalkan' }).click()
    await expect(page.getByRole('heading', { name: 'Konfirmasi Kepemilikan' })).toBeVisible()

    // — LANGKAH 7: isi nomor BENAR —
    await page.getByLabel('Nomor Telepon').fill(pesanan.phone)
    await page.getByRole('button', { name: 'Verifikasi Nomor' }).click()
    await expect(page.getByText('Nomor cocok. Pesanan dapat dibatalkan.')).toBeVisible()

    // Pembatalan tetap butuh klik eksplisit — verifikasi yang cocok TIDAK langsung membatalkan.
    expect(await statusDiDb(pesanan.invoice)).toBe(STATUS_AWAL_DB)

    await page.getByRole('button', { name: 'Ya, Batalkan Pesanan' }).click()

    await expect(page.getByRole('heading', { name: 'Pesanan Dibatalkan' })).toBeVisible()
    await expect(page.getByText(`Pesanan #${pesanan.invoice} berhasil dibatalkan.`)).toBeVisible()

    // Yang menentukan: status di DB, bukan tampilan halaman.
    expect(await statusDiDb(pesanan.invoice)).toBe(STATUS_BATAL_DB)
  })

  test('pesanan milik email lain tidak bisa ditemukan', async ({ page }) => {
    const t = token()
    const pesanan = await seedPesanan(`e2e-batal-pemilik-${t}@contoh.test`, nomorTelepon())
    const emailLain = `e2e-batal-orang-lain-${token()}@contoh.test`

    await cariDenganEmail(page, emailLain)

    // Tak ditemukan — dan yang lebih penting, nomor invoice orang lain tak bocor ke halaman.
    await expect(page.getByText('Tidak ada pesanan untuk email ini.')).toBeVisible()
    await expect(page.getByText(`#${pesanan.invoice}`)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Pilih & Batalkan' })).toHaveCount(0)

    // Pesanannya sendiri tetap utuh.
    expect(await statusDiDb(pesanan.invoice)).toBe(STATUS_AWAL_DB)
  })
})
