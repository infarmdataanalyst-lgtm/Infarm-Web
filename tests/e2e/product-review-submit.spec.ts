// tests/e2e/product-review-submit.spec.ts
// Kirim ulasan produk lewat /review — alur SATU IDENTITAS: cari pakai EMAIL, langsung isi ulasan.
//
// ── Temuan pemeriksaan kode (langkah 1 permintaan) ──
// Submit ulasan MEMANG terikat ke pesanan yang sudah dibeli. `POST /api/reviews/create-by-email`
// memverifikasi empat hal ke database, semuanya di server:
//   1. pesanan dengan `orderInvoice` itu ada,
//   2. `email` yang dikirim cocok dengan `orders.email` pesanan tersebut,
//   3. pesanannya tidak berstatus Dibatalkan,
//   4. `productId` benar-benar salah satu item pesanan itu (`order_items`).
// Karena itu setup di bawah menyisipkan `orders` DAN `order_items` — tanpa baris item, produknya
// tak akan pernah muncul di daftar "bisa diulas" dan submit-nya ditolak 422.
//
// ── Kenapa memakai produk SUNGGUHAN dari tabel products ──
// `reviews.product_id` punya foreign key ke `products(id)`, jadi id karangan akan ditolak saat
// insert. Produknya diambil saat uji berjalan (bukan di-hardcode) supaya spec ini tak mati begitu
// katalog berubah. Aman: alur ulasan tak menyentuh stok sama sekali — yang mengembalikan stok
// adalah pembatalan, dan itu diuji di berkas lain.
//
// ── Kenapa identitas diacak tiap run ──
// Sama seperti order-cancel-by-buyer.spec.ts: rate limit aplikasi in-memory dan hidup selama proses
// dev server yang dipakai ulang antar-run, jadi email yang sama akan menumpuk hitungannya sampai
// uji dijawab 429. Token acak per run memutus itu; yang tetap konsisten adalah pasangan
// email-yang-di-seed dengan email-yang-dipakai-mencari.
//
// ── Serial, bukan paralel ──
// Uji ini MENULIS ke Supabase (orders, order_items, reviews). Aturan di tests/e2e/README.md
// mewajibkan uji penulis dibungkus `describe.serial`.
//
// Tidak ada panggilan API berbayar di berkas ini: hanya Supabase + halaman lokal.

import { test, expect, type Page } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

// Status DB dipakai APA ADANYA (English) — lihat DB_TO_STATUS di src/lib/mock-db/orders.ts.
// 'PROCESSING' (tampil "Diproses") dipilih karena yang penting hanya BUKAN 'CANCELLED':
// pesanan yang dibatalkan sengaja tak bisa diulas.
const STATUS_PESANAN_DB = 'PROCESSING'

const RATING_UJI = 5
const KOMENTAR_UJI = 'Ulasan otomatis dari uji E2E. Sayurnya segar dan pengiriman cepat.'
// Nama ini di-seed ke orders.nama_customer. Server yang menyalinnya ke reviews.author_name —
// halaman ulasan tak punya input nama sama sekali, jadi kecocokannya membuktikan pengisian itu
// memang datang dari server, bukan dari klien.
const NAMA_PEMESAN = 'Pembeli Uji E2E Review'

// === Kredensial Supabase ===
// Urutan: env khusus uji lebih dulu, baru `.env.local` sebagai kemudahan lokal. Proses Playwright
// TIDAK mewarisi env dev server. TIDAK ADA nilai default yang di-hardcode di berkas ini —
// service_role key menembus RLS.
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

function token(): string {
  return randomBytes(4).toString('hex')
}

// Nomor invoice INV-{YYYYMMDD}-{4 digit acak}, tanggal WIB.
// `en-CA` + timeZone Asia/Jakarta menghasilkan YYYY-MM-DD; `toISOString()` (UTC) akan menulis
// nomor mundur sehari bila uji dijalankan sebelum pukul 07.00 WIB.
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

// '08' + 10 digit acak = 12 digit. Di-seed hanya supaya barisnya realistis; alur ulasan tak
// pernah membacanya — justru itu yang dipastikan oleh asersi "tanpa verifikasi telepon".
function nomorTelepon(): string {
  let n = '08'
  while (n.length < 12) n += Math.floor(Math.random() * 10)
  return n
}

type Produk = { id: string; name: string; promo_price: number }
type PesananUji = { invoice: string; email: string; produk: Produk }

let db: SupabaseClient
let produkUji: Produk
// Semua invoice yang dibuat berkas ini. Diisi SEBELUM insert dikirim supaya baris yang terlanjur
// masuk tapi responsnya gagal tetap ikut terhapus saat pembersihan.
const invoiceDibuat: string[] = []

// Menyisipkan pesanan + satu baris order_items berisi produk uji.
//
// Kolom WAJIB (NOT NULL tanpa default): orders → nama_customer, jumlah_total;
// order_items → order_id, quantity, price_at_purchase. `nomor_invoice` unik, jadi tabrakan
// 4 digit acak dicoba ulang alih-alih menggagalkan uji karena kesialan.
async function seedPesananDenganItem(email: string): Promise<PesananUji> {
  for (let percobaan = 0; percobaan < 5; percobaan++) {
    const invoice = nomorInvoice()
    invoiceDibuat.push(invoice)

    const { data, error } = await db
      .from('orders')
      .insert({
        nomor_invoice: invoice,
        email,
        no_telepon: nomorTelepon(),
        nama_customer: NAMA_PEMESAN,
        jumlah_total: produkUji.promo_price,
        order_status: STATUS_PESANAN_DB,
        status_pembayaran: 'PAID',
      })
      .select('id')
      .single()

    if (error) {
      invoiceDibuat.pop()
      // 23505 = unique_violation → nomor acaknya bentrok, coba nomor lain.
      if (error.code !== '23505') {
        throw new Error(`Gagal menyisipkan pesanan uji: ${error.message} (${error.code})`)
      }
      continue
    }

    const orderId = (data as { id: string }).id
    const { error: errItem } = await db.from('order_items').insert({
      order_id: orderId,
      product_id: produkUji.id,
      quantity: 1,
      price_at_purchase: produkUji.promo_price,
    })
    if (errItem) {
      throw new Error(`Gagal menyisipkan order_items uji: ${errItem.message} (${errItem.code})`)
    }

    return { invoice, email, produk: produkUji }
  }
  throw new Error('Gagal mendapat nomor invoice unik setelah 5 percobaan.')
}

// Membaca ulasan yang tersimpan untuk sebuah pesanan. null bila belum ada.
async function ulasanDiDb(invoice: string) {
  const { data, error } = await db
    .from('reviews')
    .select('id, product_id, author_name, rating, comment, visible, order_invoice')
    .eq('order_invoice', invoice)
    .maybeSingle()
  if (error) throw new Error(`Gagal membaca ulasan: ${error.message}`)
  return data as {
    id: string
    product_id: string
    author_name: string
    rating: number
    comment: string
    visible: boolean
    order_invoice: string
  } | null
}

// Memastikan TIDAK ADA jejak langkah verifikasi telepon di halaman.
//
// Inilah asersi yang menjaga perbedaan perlakuan antara dua alur tetap disengaja: /cancel-order
// meminta no_telepon sebagai faktor kedua karena aksinya merusak; /review tidak, karena memberi
// ulasan tak merusak apa pun. Diperiksa lewat EMPAT penanda berbeda supaya tak lolos hanya karena
// satu label diubah — bila suatu saat langkah pembatalan ter-copy ke sini, salah satunya pasti
// tersangkut.
async function pastikanTanpaVerifikasiTelepon(page: Page, tahap: string) {
  await expect(page.getByRole('heading', { name: 'Konfirmasi Kepemilikan' }), tahap).toHaveCount(0)
  await expect(page.getByLabel('Nomor Telepon'), tahap).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Verifikasi Nomor' }), tahap).toHaveCount(0)
  await expect(page.locator('input[type="tel"]'), tahap).toHaveCount(0)
}

test.describe.serial('Kirim ulasan produk (cari via email, tanpa verifikasi telepon)', () => {
  test.beforeAll(async () => {
    const { url, key } = kredensialSupabase()
    if (!url || !key) {
      throw new Error(
        'Kredensial Supabase tak ditemukan. Set E2E_SUPABASE_URL & E2E_SUPABASE_SERVICE_ROLE_KEY, ' +
          'atau pastikan .env.local berisi NEXT_PUBLIC_SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY.',
      )
    }
    db = createClient(url, key, { auth: { persistSession: false } })

    // Produk sungguhan dari katalog — `reviews.product_id` punya FK ke products(id).
    const { data, error } = await db
      .from('products')
      .select('id, name, promo_price')
      .eq('archived', false)
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(`Gagal membaca produk untuk uji: ${error.message}`)
    if (!data) throw new Error('Tak ada produk aktif di katalog — uji ini butuh minimal satu.')
    produkUji = data as Produk
  })

  // Bersihkan ulasan lebih dulu, baru pesanannya. `order_items` ikut terhapus sendiri lewat
  // `on delete cascade` pada FK order_id. Dijalankan walau ada uji yang gagal — justru saat itulah
  // baris sampah paling mungkin tertinggal.
  test.afterAll(async () => {
    if (!db || invoiceDibuat.length === 0) return
    const { error: errUlasan } = await db
      .from('reviews')
      .delete()
      .in('order_invoice', invoiceDibuat)
    if (errUlasan) {
      console.warn(`[cleanup] Gagal menghapus ulasan uji: ${errUlasan.message}`)
    }
    const { error: errPesanan } = await db
      .from('orders')
      .delete()
      .in('nomor_invoice', invoiceDibuat)
    if (errPesanan) {
      console.warn(
        `[cleanup] Gagal menghapus pesanan uji (${invoiceDibuat.join(', ')}): ${errPesanan.message}`,
      )
    }
  })

  test('mengirim ulasan dan menyimpannya ke tabel reviews dengan visible = true', async ({
    page,
  }) => {
    const pesanan = await seedPesananDenganItem(`e2e-review-${token()}@contoh.test`)

    // Belum ada ulasan untuk pesanan ini — kondisi awal.
    expect(await ulasanDiDb(pesanan.invoice)).toBeNull()

    // — LANGKAH 3: buka halaman, cari HANYA dengan email —
    //
    // Cookie dibersihkan lebih dulu: bila `infarm_email` ada, halaman melewati form dan langsung
    // mencari email dari cookie itu, bukan email yang hendak diuji.
    await page.context().clearCookies()
    await page.goto('/review')
    await page.getByLabel('Email').fill(pesanan.email)
    await page.getByRole('button', { name: 'Cari Produk' }).click()

    // Produk dari pesanan itu muncul dan bisa diulas. Emailnya unik per run, jadi hasilnya
    // dijamin persis satu produk — yang dibuktikan jumlah tombol "Beri Review".
    await expect(page.getByText(pesanan.produk.name)).toBeVisible()
    await expect(page.getByText(`Pesanan #${pesanan.invoice}`)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Beri Review' })).toHaveCount(1)

    // — LANGKAH 6 (a): tak ada verifikasi telepon setelah pencarian —
    await pastikanTanpaVerifikasiTelepon(page, 'setelah pencarian email')

    // — LANGKAH 4: buka form, isi rating + komentar, kirim —
    await page.getByRole('button', { name: 'Beri Review' }).click()

    // Form ulasan langsung terbuka — tanpa gerbang apa pun di antaranya.
    await expect(page.getByRole('button', { name: `${RATING_UJI} bintang` })).toBeVisible()
    // — LANGKAH 6 (b): tetap tak ada verifikasi telepon di dalam form —
    await pastikanTanpaVerifikasiTelepon(page, 'di dalam form ulasan')

    // Nama penulis diisi server, jadi form ini memang tak boleh punya input nama.
    await expect(page.getByLabel('Nama Tampilan')).toHaveCount(0)

    await page.getByRole('button', { name: `${RATING_UJI} bintang` }).click()
    await page.getByLabel('Komentar').fill(KOMENTAR_UJI)
    await page.getByRole('button', { name: 'Kirim Ulasan' }).click()

    // Konfirmasi di UI: toast sukses, lalu produknya hilang dari daftar (tak bisa diulas dua kali).
    await expect(page.getByText('Ulasan berhasil dikirim. Terima kasih!')).toBeVisible()
    await expect(page.getByText('Tidak ada produk yang bisa diulas.')).toBeVisible()

    // — LANGKAH 6 (c): tak ada verifikasi telepon sampai alur selesai —
    await pastikanTanpaVerifikasiTelepon(page, 'setelah ulasan terkirim')

    // — LANGKAH 5: yang menentukan — barisnya benar-benar ada di tabel reviews —
    const ulasan = await ulasanDiDb(pesanan.invoice)
    expect(ulasan).not.toBeNull()
    expect(ulasan).toMatchObject({
      product_id: pesanan.produk.id,
      rating: RATING_UJI,
      comment: KOMENTAR_UJI,
      order_invoice: pesanan.invoice,
      // Default kolom `visible` di migration 20260622110000 adalah `true`, dan createReview
      // sengaja TIDAK mengirim kolom ini — ulasan baru langsung tampil di storefront sampai
      // admin menyembunyikannya lewat OMS.
      visible: true,
      // Diisi SERVER dari orders.nama_customer. Halaman ulasan tak punya input nama sama sekali,
      // jadi nilai ini tak mungkin datang dari klien.
      author_name: NAMA_PEMESAN,
    })
  })
})
