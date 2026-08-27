// tests/e2e/checkout-order-data-integrity.spec.ts
// E2E: apa yang DILIHAT pembeli di layar = apa yang TERSIMPAN di tabel `orders`.
//
// Bukan menguji "checkout jalan" (itu spec lain), tapi menguji bahwa tak ada nilai yang berubah
// diam-diam di antara UI dan database: wilayah alamat, destination_id, kurir, jenis layanan, dan
// jumlah total. Selisih Rp1 pun dianggap gagal — pembulatan senyap pada nominal tagihan adalah
// jenis bug yang tak pernah terlihat sampai ada yang membandingkan pembukuan.
//
// ============================================================================
// ⛔ UJI INI MEMBUAT PESANAN NYATA. DILEWATI kecuali sengaja dinyalakan.
// ============================================================================
//     E2E_ALLOW_PAID=1 npx playwright test checkout-order-data-integrity --headed
//
// Yang terjadi tiap kali dijalankan:
//   - satu baris `orders` + `order_items` di Supabase  → DIHAPUS oleh cleanup
//   - STOK PRODUK BERKURANG                            → **TIDAK** dikembalikan (lihat di bawah)
//   - Xendit TIDAK dipanggil                           → lihat "Kenapa tagihan diblokir"
//   - kurir TIDAK dibooking, tak ada resi terbit
//
// ── Kenapa stok TIDAK dipulihkan otomatis ──
// RPC `create_order_with_items` memotong `warehouse_stock` lalu me-mirror-nya ke
// `products.stock` / `product_variants.stok` (migration 20260811120100). Memulihkannya dari uji
// berarti menulis ke tiga tempat sekaligus lewat REST — dan itu MELANGGAR aturan CLAUDE.md bahwa
// setiap titik tulis stok WAJIB lewat `src/lib/stock-audit.ts` supaya riwayat mutasi tak berbohong.
// Uji yang diam-diam mengoreksi inventaris jauh lebih berbahaya daripada uji yang melaporkannya.
// Karena itu cleanup MELAPORKAN dampak stoknya; koreksinya lewat OMS → Gudang → Kelola Stok.
//
// ── Kenapa penerbitan tagihan diblokir ──
// Alur normal: order tersimpan → `POST /api/payments/invoice` → redirect ke Xendit. Halaman sukses
// baru tercapai setelah membayar di sana.
//
// Uji ini memblokir endpoint tagihan, dan aplikasi memang punya jalur untuk itu: gagal menerbitkan
// tagihan → `router.replace('/checkout/success?invoice=…&pay_error=1')`. Jadi halaman sukses tetap
// tercapai lewat jalur aplikasi yang sah, tanpa menerbitkan objek invoice di dashboard Xendit yang
// tak akan pernah dibersihkan oleh cleanup mana pun. Pesanan di DB — satu-satunya yang diuji di
// sini — sudah lengkap sebelum tagihan dibuat.

import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { test, expect, type Page } from '@playwright/test'

const ALLOW_PAID = process.env.E2E_ALLOW_PAID === '1'

// Nama pembeli uji — penanda kalau cleanup gagal dan barisnya perlu dicari manual.
const BUYER = {
  name: 'E2E Data Integrity',
  phone: '081234567890', // 08xx, 12 digit (src/lib/phone.ts)
  street: 'Jl. Uji Integritas No. 1',
  addressKeyword: 'jakarta pusat', // WAJIB DKI Jakarta — sandbox Mengantar hanya Jakarta→Jakarta
}

// Nilai `jenis_layanan` yang dikirim halaman checkout sebelum booking kurir.
//
// ⚠️ BUKAN pilihan pembeli. Bottom sheet kurir hanya menampilkan nama ekspedisi, estimasi tiba,
// dan harga — tak ada pemilihan jenis layanan di UI mana pun. `src/app/checkout/page.tsx`
// mengirim `service: 'Reguler'` sebagai nilai tetap, yang kelak DITIMPA oleh SERVICE_CODE dari
// Mengantar saat booking berhasil. Jadi yang bisa ditegakkan di sini adalah nilai awal itu.
const JENIS_LAYANAN_AWAL = 'Reguler'

const INVOICE_PATTERN = /INV-\d{8}-[A-Z0-9]{8}/

// "Rp75.000" / "IDR 75.000" → 75000
function parseRupiah(text: string): number {
  const digits = text.replace(/\D/g, '')
  return digits ? Number(digits) : NaN
}

// Kredensial Supabase untuk uji.
//
// Urutan: env khusus uji lebih dulu, baru `.env.local` sebagai kemudahan lokal. Proses Playwright
// TIDAK mewarisi env dev server (`next dev` yang memuatnya), jadi tanpa salah satunya uji ini tak
// punya cara membaca database.
//
// TIDAK ADA nilai default yang di-hardcode di berkas ini — service_role key menembus RLS; satu
// baris ceroboh di sini berarti kunci itu ada selamanya di riwayat git.
function kredensialSupabase(): { url: string; key: string } {
  const dariEnv = (nama: string) => process.env[nama]?.trim() ?? ''

  const url = dariEnv('E2E_SUPABASE_URL') || dariEnv('NEXT_PUBLIC_SUPABASE_URL') || dariEnvLocal('NEXT_PUBLIC_SUPABASE_URL')
  const key =
    dariEnv('E2E_SUPABASE_SERVICE_ROLE_KEY') ||
    dariEnv('SUPABASE_SERVICE_ROLE_KEY') ||
    dariEnvLocal('SUPABASE_SERVICE_ROLE_KEY')

  return { url, key }
}

function dariEnvLocal(kunci: string): string {
  try {
    const isi = readFileSync('.env.local', 'utf-8')
    const baris = isi.split('\n').find((l) => l.startsWith(`${kunci}=`))
    return baris ? baris.slice(kunci.length + 1).trim() : ''
  } catch {
    return ''
  }
}

type OrderRow = {
  nomor_invoice: string
  provinsi: string | null
  kota: string | null
  kecamatan: string | null
  kelurahan: string | null
  kodepos: string | null
  destination_id: string | null
  nama_ekspedisi: string | null
  jenis_layanan: string | null
  jumlah_total: number | null
  order_status: string
  status_pembayaran: string
}

// Apa yang dibaca dari layar, untuk dibandingkan dengan isi database.
type DariUI = {
  hargaSatuan: number
  quantity: number
  provinsi: string
  kota: string
  kecamatan: string
  kelurahan: string
  kodepos: string
  kurir: string
  ongkir: number
}

test.use({ launchOptions: { slowMo: 0 } })
test.describe.configure({ mode: 'serial', timeout: 300_000 })

test.describe('Checkout — integritas data UI vs database', () => {
  test.skip(
    !ALLOW_PAID,
    'Uji ini membuat pesanan nyata & memotong stok. Jalankan dengan E2E_ALLOW_PAID=1.',
  )

  // Diisi selama uji supaya cleanup tetap punya sasaran walau assertion gagal di tengah.
  let invoiceDibuat = ''
  let dampakStok = ''
  let db: SupabaseClient | null = null

  test.afterAll(async () => {
    // === Cleanup ===
    // Berjalan APA PUN hasil ujinya. Tanpa ini setiap kali uji diulang meninggalkan satu pesanan
    // sampah, dan angka penjualan di dashboard OMS ikut tercemar.
    if (!invoiceDibuat || !db) {
      if (invoiceDibuat) {
        console.log(`\n  ⚠ Cleanup DILEWATI — klien Supabase tak tersedia.`)
        console.log(`    Hapus manual: delete from orders where nomor_invoice = '${invoiceDibuat}';\n`)
      }
      return
    }

    const { data: order } = await db
      .from('orders')
      .select('id')
      .eq('nomor_invoice', invoiceDibuat)
      .maybeSingle()

    if (!order) {
      console.log(`\n  cleanup: pesanan ${invoiceDibuat} sudah tidak ada.\n`)
      return
    }

    // order_items dihapus lebih dulu. Kalau foreign key-nya ON DELETE CASCADE ini mubazir tapi
    // tak merusak; kalau tidak, tanpa langkah ini penghapusan order gagal dan sampahnya tetap ada.
    await db.from('order_items').delete().eq('order_id', (order as { id: string }).id)
    const { error } = await db.from('orders').delete().eq('nomor_invoice', invoiceDibuat)

    if (error) {
      console.log(`\n  ⚠ Cleanup GAGAL untuk ${invoiceDibuat}: ${error.message}`)
      console.log(`    Hapus manual lewat Supabase Table Editor.\n`)
      return
    }

    console.log(`\n  cleanup: pesanan ${invoiceDibuat} dihapus (orders + order_items).`)
    if (dampakStok) {
      console.log(
        `  ⚠ STOK TIDAK DIPULIHKAN: ${dampakStok}\n` +
          `    Menulis stok dari uji akan melewati src/lib/stock-audit.ts dan membuat Riwayat\n` +
          `    Mutasi berbohong (CLAUDE.md → Pergudangan). Koreksi lewat OMS → Gudang → Kelola Stok.\n`,
      )
    }
  })

  test('nilai di layar tersimpan apa adanya di tabel orders', async ({ page, baseURL }) => {
    expect(baseURL, 'baseURL wajib ada (lihat playwright.config.ts)').toBeTruthy()

    const { url, key } = kredensialSupabase()
    expect(
      url && key,
      'Kredensial Supabase tak ditemukan. Set E2E_SUPABASE_URL & E2E_SUPABASE_SERVICE_ROLE_KEY, ' +
        'atau sediakan .env.local. Uji ini tak bisa memverifikasi apa pun tanpanya.',
    ).toBeTruthy()
    db = createClient(url, key, { auth: { persistSession: false } })

    const ui = {} as DariUI

    // ================================================================
    // 1 — Beranda → produk → catat harga & kuantitas DARI LAYAR
    // ================================================================
    await page.goto('/')
    const kartu = page.locator('a[href^="/produk/"]').first()
    await expect(kartu, 'tak ada kartu produk di beranda').toBeVisible({ timeout: 30_000 })
    await page.waitForLoadState('load').catch(() => {})

    // Klik diulang sampai URL berpindah: gambar yang mendarat belakangan menggeser tata letak dan
    // klik tunggal bisa jatuh ke ruang kosong tanpa error (terbukti di deployment Vercel).
    await expect(async () => {
      await kartu.click()
      await expect(page).toHaveURL(/\/produk\//, { timeout: 5_000 })
    }).toPass({ timeout: 60_000 })

    const namaProduk = ((await page.getByRole('heading').first().textContent()) ?? '').trim()

    // Harga diambil dari halaman detail — harga JUAL berwarna hijau (text-brand-primary), bukan
    // harga coret. Mengambil "angka rupiah pertama di halaman" akan tertukar dengan harga coret
    // pada produk berdiskon.
    const hargaTeks = ((await page.locator('.text-brand-primary').filter({ hasText: /^Rp[\d.]+$/ }).first().textContent()) ?? '').trim()
    ui.hargaSatuan = parseRupiah(hargaTeks)
    expect(
      Number.isFinite(ui.hargaSatuan) && ui.hargaSatuan > 0,
      `harga produk tak terbaca dari halaman detail, dapat "${hargaTeks}"`,
    ).toBeTruthy()

    const beli = page.getByRole('button', { name: 'Beli Langsung' }).first()
    await expect(beli).toBeVisible({ timeout: 30_000 })
    const konfirmasiVarian = page.getByRole('button', { name: 'Beli Sekarang' })

    await expect(async () => {
      if (!/\/checkout$/.test(page.url())) {
        if (await konfirmasiVarian.isVisible({ timeout: 1_000 }).catch(() => false)) {
          await konfirmasiVarian.click()
        } else {
          await beli.click()
        }
      }
      await expect(page).toHaveURL(/\/checkout$/, { timeout: 5_000 })
    }).toPass({ timeout: 60_000 })

    await expect(page.getByRole('heading', { name: 'Alamat Pengiriman' })).toBeVisible({
      timeout: 30_000,
    })

    // Kuantitas dibaca dari ringkasan checkout, bukan diasumsikan 1: produk ber-minOrderQty masuk
    // dengan jumlah lebih dari satu, dan menganggapnya 1 membuat perbandingan total salah.
    const ringkasanTeks = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    ui.quantity = Number(ringkasanTeks.match(/x\s*(\d+)/i)?.[1] ?? '1')
    expect(ui.quantity, 'kuantitas tak masuk akal').toBeGreaterThan(0)

    console.log(`\n  produk : ${namaProduk}`)
    console.log(`  harga  : Rp${ui.hargaSatuan.toLocaleString('id-ID')} × ${ui.quantity}`)

    // ================================================================
    // 2 — Alamat (DKI Jakarta) → catat kelima kolom wilayah DARI FORM
    // ================================================================
    await isiTeguh(page, 'Nama Lengkap Penerima', BUYER.name)
    await isiTeguh(page, 'Nomor Telepon Aktif', BUYER.phone)

    // ⚠️ TIDAK ADA FIELD EMAIL di form checkout. Sudah dihapus (CLAUDE.md → Guest Checkout):
    // identitas guest kini murni nomor telepon, selaras dengan lacak/batalkan/review by phone.
    // Order baru selalu mengirim `customerEmail: undefined`.

    await isiTeguh(page, 'Cari Alamat (Kelurahan / Kecamatan / Kota)', BUYER.addressKeyword)

    // Ditunggu OPSI pertama, bukan kotak listbox — panel sempat merender listbox kosong.
    const opsi = page.getByRole('listbox').getByRole('option').first()
    await expect(opsi, `tak ada hasil alamat untuk "${BUYER.addressKeyword}"`).toBeVisible({
      timeout: 30_000,
    })
    await opsi.click()

    // Dibaca dari INPUT-nya, bukan dari teks opsi dropdown. Yang harus cocok dengan database adalah
    // apa yang benar-benar terpampang di form — kalau ada normalisasi (Title Case) di antara
    // keduanya, perbandingan lewat teks opsi akan melewatkannya.
    ui.provinsi = await page.getByLabel('Provinsi').inputValue()
    ui.kota = await page.getByLabel('Kota/Kabupaten').inputValue()
    ui.kecamatan = await page.getByLabel('Kecamatan').inputValue()
    ui.kelurahan = await page.getByLabel('Kelurahan').inputValue()
    ui.kodepos = await page.getByLabel('Kode Pos').inputValue()

    expect(
      ui.provinsi,
      `tujuan harus DKI Jakarta (sandbox Mengantar hanya Jakarta→Jakarta), dapat "${ui.provinsi}"`,
    ).toMatch(/jakarta/i)
    expect(ui.kodepos, 'kode pos tak terisi — auto-isi gagal separuh').toMatch(/^\d{5}$/)

    await isiTeguh(page, 'Alamat Lengkap (Nama Jalan & Nomor Rumah)', BUYER.street)
    console.log(`  alamat : ${ui.kelurahan}, ${ui.kecamatan}, ${ui.kota}, ${ui.provinsi} ${ui.kodepos}`)

    // ================================================================
    // 3 — Kurir: catat nama & ongkir DARI BOTTOM SHEET
    // ================================================================
    const daftarKurir = page.getByRole('radiogroup', { name: 'Pilihan kurir' })
    if (!(await daftarKurir.isVisible({ timeout: 5_000 }).catch(() => false))) {
      await page.getByRole('button').filter({ hasText: 'Metode Pengiriman' }).first().click()
    }
    await expect(daftarKurir, 'daftar kurir tak muncul').toBeVisible({ timeout: 45_000 })

    const opsiKurir = daftarKurir.getByRole('radio').first()
    await expect(opsiKurir, 'tak ada opsi kurir untuk tujuan Jakarta').toBeVisible({ timeout: 45_000 })

    const teksKurir = ((await opsiKurir.textContent()) ?? '').replace(/\s+/g, ' ').trim()

    // Nama ekspedisi = baris pertama kartu, sebelum "Estimasi tiba".
    ui.kurir = teksKurir.split(/Estimasi/i)[0].trim()
    expect(ui.kurir.length, `nama kurir tak terbaca dari "${teksKurir}"`).toBeGreaterThan(0)

    const ongkirCocok = teksKurir.match(/Rp[\d.]+/)
    expect(ongkirCocok, `harga tak ditemukan pada opsi kurir: "${teksKurir}"`).toBeTruthy()
    ui.ongkir = parseRupiah(ongkirCocok![0])
    expect(ui.ongkir, 'ongkir harus lebih dari 0').toBeGreaterThan(0)

    await opsiKurir.click()

    // Mengklik opsi hanya menyetel DRAFT — onSelect baru jalan saat "Konfirmasi" ditekan
    // (handleConfirm di ShippingOptions.tsx). Tanpa ini kurir tak pernah tersimpan.
    const konfirmasi = page.getByRole('button', { name: 'Konfirmasi' })
    await expect(konfirmasi, 'tombol Konfirmasi nonaktif — kurir belum terpilih').toBeEnabled({
      timeout: 10_000,
    })
    await konfirmasi.click()

    console.log(`  kurir  : ${ui.kurir} — ongkir Rp${ui.ongkir.toLocaleString('id-ID')}`)

    // ================================================================
    // 4 — Blokir penerbitan tagihan, lalu selesaikan checkout
    // ================================================================
    // Lihat "Kenapa penerbitan tagihan diblokir" di kepala berkas. Aplikasi menangani kegagalan ini
    // dengan mengarahkan ke /checkout/success?...&pay_error=1 — jalur sah, bukan akal-akalan uji.
    await page.route('**/api/payments/invoice', (route) => route.abort())

    // Total yang DITAGIHKAN, dibaca dari bilah bayar — bukan dihitung ulang oleh uji. Menghitung
    // ulang di sini berarti menyalin logika yang sedang diuji.
    const totalTeks =
      (await page
        .getByText('Total Pembayaran')
        .first()
        .locator('xpath=following-sibling::p[1]')
        .textContent()) ?? ''
    const totalDiLayar = parseRupiah(totalTeks)

    await page.getByRole('button', { name: 'Bayar Sekarang' }).first().click()

    const modal = page.getByRole('dialog')
    await expect(
      modal.getByRole('heading', { name: 'Pastikan data yang Anda masukkan benar' }),
    ).toBeVisible({ timeout: 15_000 })

    console.log('\n  ⛔ pesanan nyata dibuat mulai detik ini\n')
    await modal.getByRole('button', { name: 'Lanjutkan Checkout' }).click()

    // ================================================================
    // 5 — Halaman sukses → nomor invoice
    // ================================================================
    await page.waitForURL(/\/checkout\/success/, { timeout: 60_000 })

    const isiSukses = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    const invoiceCocok = isiSukses.match(INVOICE_PATTERN)
    expect(
      invoiceCocok,
      `nomor invoice tak ditemukan di halaman sukses. Isi: "${isiSukses.slice(0, 300)}…"`,
    ).toBeTruthy()

    invoiceDibuat = invoiceCocok![0] // ← dicatat untuk cleanup, sebelum assertion apa pun
    dampakStok = `${namaProduk} berkurang ${ui.quantity} unit`
    console.log(`  INVOICE: ${invoiceDibuat}\n`)

    // ================================================================
    // 6 — Baca langsung dari Supabase
    // ================================================================
    const { data, error } = await db
      .from('orders')
      .select(
        'nomor_invoice,provinsi,kota,kecamatan,kelurahan,kodepos,destination_id,' +
          'nama_ekspedisi,jenis_layanan,jumlah_total,order_status,status_pembayaran',
      )
      .eq('nomor_invoice', invoiceDibuat)
      .maybeSingle()

    expect(error, `query Supabase gagal: ${error?.message}`).toBeNull()
    expect(data, `pesanan ${invoiceDibuat} tak ditemukan di tabel orders`).toBeTruthy()
    // `as unknown as` diperlukan: tanpa tipe Database yang di-generate, supabase-js menyimpulkan
    // hasil select string sebagai GenericStringError dan menolak konversi langsung. Bentuk baris
    // sudah dipastikan oleh assertion `data` di atas.
    const row = data as unknown as OrderRow

    // ================================================================
    // 7 — Bandingkan satu per satu
    // ================================================================
    const bandingkan = (label: string, diLayar: string, diDB: string | null) => {
      expect(
        diDB,
        `${label} berbeda antara layar dan database.\n` +
          `    layar    : "${diLayar}"\n` +
          `    database : "${diDB ?? 'NULL'}"`,
      ).toBe(diLayar)
    }

    bandingkan('Provinsi', ui.provinsi, row.provinsi)
    bandingkan('Kota/Kabupaten', ui.kota, row.kota)
    bandingkan('Kecamatan', ui.kecamatan, row.kecamatan)
    bandingkan('Kelurahan', ui.kelurahan, row.kelurahan)
    bandingkan('Kode Pos', ui.kodepos, row.kodepos)

    expect(
      row.destination_id,
      'destination_id kosong — ongkir & booking kurir tak akan punya tujuan',
    ).toBeTruthy()

    bandingkan('Nama ekspedisi', ui.kurir, row.nama_ekspedisi)

    // Jenis layanan: nilai TETAP dari halaman checkout, bukan pilihan pembeli (lihat konstanta).
    expect(
      row.jenis_layanan,
      `jenis_layanan seharusnya "${JENIS_LAYANAN_AWAL}" (nilai awal sebelum booking kurir ` +
        `menimpanya dengan SERVICE_CODE Mengantar), dapat "${row.jenis_layanan}"`,
    ).toBe(JENIS_LAYANAN_AWAL)

    // ================================================================
    // 8 — Total: SAMA PERSIS, bukan mendekati
    // ================================================================
    const totalDiharapkan = ui.hargaSatuan * ui.quantity + ui.ongkir
    const selisih = (row.jumlah_total ?? 0) - totalDiharapkan

    const rincian =
      `    harga produk : Rp${ui.hargaSatuan.toLocaleString('id-ID')} × ${ui.quantity} = ` +
      `Rp${(ui.hargaSatuan * ui.quantity).toLocaleString('id-ID')}\n` +
      `    ongkir       : Rp${ui.ongkir.toLocaleString('id-ID')}\n` +
      `    ─────────────────────────────────\n` +
      `    diharapkan   : Rp${totalDiharapkan.toLocaleString('id-ID')}\n` +
      `    di layar     : Rp${totalDiLayar.toLocaleString('id-ID')}\n` +
      `    di database  : Rp${(row.jumlah_total ?? 0).toLocaleString('id-ID')}\n` +
      `    SELISIH      : Rp${selisih.toLocaleString('id-ID')}`

    expect(
      row.jumlah_total,
      `jumlah_total di database TIDAK SAMA dengan (harga × qty) + ongkir.\n${rincian}\n` +
        `    Server menghitung ulang total dari harga DB (bukan dari client), jadi selisih di sini\n` +
        `    berarti harga yang DILIHAT pembeli berbeda dari harga yang DITAGIHKAN.`,
    ).toBe(totalDiharapkan)

    console.log(`  total  : cocok — Rp${totalDiharapkan.toLocaleString('id-ID')}`)
    console.log(`  status : ${row.order_status} / ${row.status_pembayaran}`)
  })
})

// Mengisi satu field dan MEMASTIKAN nilainya menempel.
//
// `fill` yang mendarat sebelum hidrasi React selesai akan ditimpa state awal yang kosong;
// mengulang sampai bertahan jauh lebih murah daripada menebak kapan hidrasi selesai.
async function isiTeguh(page: Page, label: string, value: string): Promise<void> {
  const field = page.getByLabel(label)
  await expect(field, `field "${label}" tak ditemukan`).toBeVisible()
  await expect(async () => {
    await field.fill(value)
    await expect(field).toHaveValue(value, { timeout: 1_000 })
  }).toPass({ timeout: 15_000 })
}
