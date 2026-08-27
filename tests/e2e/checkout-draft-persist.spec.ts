// tests/e2e/checkout-draft-persist.spec.ts
// E2E: isian checkout bertahan melewati refresh, dan tak menyangkut setelah pesanan dibuat.
//
// Tiga skenario yang diminta:
//   1. isi sebagian → refresh → yang terisi tetap ada, yang kosong tetap kosong
//   2. isi lengkap sampai kurir → refresh → semuanya pulih, termasuk kurir
//   3. draf dibersihkan setelah checkout sukses
//
// ── Batas ──
// Skenario 1 & 2 murni membaca (cek ongkir & search alamat gratis). Skenario 3 TIDAK membuat
// pesanan sungguhan: ia memanggil `clearCheckoutDraft()` lewat jalur yang sama dengan yang dipakai
// `proceedPayment()`, lalu memastikan halaman kembali kosong. Menguji penghapusan draf tak perlu
// memotong stok — yang diuji adalah perilaku penyimpanan lokal, bukan pembuatan pesanan.

import { test, expect, type Page } from '@playwright/test'
import { addressSection, fillAddressSearch, openCheckoutWithCart } from './helpers/checkout'

const KEY_DRAF = 'checkout_draft'

const ISIAN = {
  nama: 'Budi Draf Uji',
  telepon: '081234567890', // 08xx, 12 digit — konvensi src/lib/phone.ts
  jalan: 'Jl. Draf Persist No. 7, Blok C',
  alamat: 'jakarta pusat', // WAJIB DKI Jakarta — sandbox Mengantar hanya Jakarta→Jakarta
}

// Membaca draf mentah dari localStorage halaman.
async function bacaDraf(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate((key) => {
    try {
      const raw = window.localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as Record<string, unknown>) : null
    } catch {
      return null
    }
  }, KEY_DRAF)
}

// Menunggu draf benar-benar tertulis. Penulisannya di-debounce 400ms, jadi refresh yang terlalu
// cepat setelah mengetik memang belum sempat tersimpan — itu perilaku yang benar, bukan bug, dan
// uji harus menghormatinya alih-alih menyembunyikannya dengan sleep tetap.
async function tungguDrafTersimpan(page: Page): Promise<void> {
  await expect
    .poll(async () => ((await bacaDraf(page)) ? 'ada' : 'belum'), {
      message: 'draf tak pernah tertulis ke localStorage',
      timeout: 10_000,
    })
    .toBe('ada')
}

test.describe('Checkout — draf isian bertahan melewati refresh', () => {
  test('1: isi sebagian → refresh → yang terisi pulih, yang kosong tetap kosong', async ({
    page,
    baseURL,
  }) => {
    expect(baseURL, 'baseURL wajib ada').toBeTruthy()
    await openCheckoutWithCart(page, baseURL!)

    // Hanya nama & telepon. Alamat sengaja DIBIARKAN kosong.
    await isiTeguh(page, 'Nama Lengkap Penerima', ISIAN.nama)
    await isiTeguh(page, 'Nomor Telepon Aktif', ISIAN.telepon)
    await tungguDrafTersimpan(page)

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Alamat Pengiriman' })).toBeVisible({
      timeout: 30_000,
    })

    // === Yang terisi harus kembali ===
    await expect(
      page.getByLabel('Nama Lengkap Penerima'),
      'nama hilang setelah refresh',
    ).toHaveValue(ISIAN.nama)

    // Telepon diperiksa dari kotaknya, bukan dari state internal: pernah terjadi nilainya tersimpan
    // di `form.phone` tapi `phoneInput` (yang tampil) tak ikut di-seed, sehingga kotaknya tampak
    // kosong padahal datanya ada — pengguna lalu mengetik ulang di atas nilai yang sudah benar.
    await expect(
      page.getByLabel('Nomor Telepon Aktif'),
      'nomor telepon tak tampil kembali di kotaknya setelah refresh',
    ).toHaveValue(ISIAN.telepon)

    // === Yang belum diisi harus TETAP kosong ===
    // Ini sisi lain dari "tidak korup": pemulihan tak boleh mengarang isi untuk field yang memang
    // belum pernah disentuh.
    await expect(
      page.getByPlaceholder('Cari kelurahan, kecamatan, atau kota…'),
      'kotak pencarian alamat terisi padahal belum pernah diisi',
    ).toHaveValue('')

    await expect(
      page.getByRole('button', { name: 'Ubah Alamat' }),
      'ringkasan alamat muncul padahal alamat belum dipilih',
    ).toHaveCount(0)
  })

  test('2: isi lengkap sampai kurir → refresh → semua pulih termasuk kurir', async ({
    page,
    baseURL,
  }) => {
    expect(baseURL, 'baseURL wajib ada').toBeTruthy()
    await openCheckoutWithCart(page, baseURL!)

    await isiTeguh(page, 'Nama Lengkap Penerima', ISIAN.nama)
    await isiTeguh(page, 'Nomor Telepon Aktif', ISIAN.telepon)
    await fillAddressSearch(page, ISIAN.alamat)

    const opsi = page.getByRole('listbox').getByRole('option').first()
    await expect(opsi, `tak ada hasil untuk "${ISIAN.alamat}"`).toBeVisible({ timeout: 30_000 })
    await opsi.click()

    const provinsi = await page.getByLabel('Provinsi').inputValue()
    const kota = await page.getByLabel('Kota/Kabupaten').inputValue()
    const kodepos = await page.getByLabel('Kode Pos').inputValue()

    await isiTeguh(page, 'Alamat Lengkap (Nama Jalan & Nomor Rumah)', ISIAN.jalan)

    // Kurir dipilih otomatis (opsi termurah) begitu ongkir selesai dihitung.
    const barisKurir = page.getByRole('button').filter({ hasText: 'Metode Pengiriman' }).first()
    await expect(barisKurir, 'kurir tak pernah terpilih').toContainText(/Rp[\d.]+/, {
      timeout: 45_000,
    })
    const kurirSebelum = ((await barisKurir.textContent()) ?? '').replace(/\s+/g, ' ').trim()

    await tungguDrafTersimpan(page)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Alamat Pengiriman' })).toBeVisible({
      timeout: 30_000,
    })

    await expect(page.getByLabel('Nama Lengkap Penerima')).toHaveValue(ISIAN.nama)
    await expect(page.getByLabel('Nomor Telepon Aktif')).toHaveValue(ISIAN.telepon)
    await expect(page.getByLabel('Alamat Lengkap (Nama Jalan & Nomor Rumah)')).toHaveValue(ISIAN.jalan)

    // Wilayah hasil auto-isi ikut pulih — tanpa perlu mencari alamatnya lagi.
    await expect(page.getByLabel('Provinsi')).toHaveValue(provinsi)
    await expect(page.getByLabel('Kota/Kabupaten')).toHaveValue(kota)
    await expect(page.getByLabel('Kode Pos')).toHaveValue(kodepos)
    await expect(
      page.getByRole('button', { name: 'Ubah Alamat' }),
      'alamat pulih tapi ringkasannya tak tampil — destination_id kemungkinan hilang',
    ).toBeVisible()

    // Kurir pulih. Dicocokkan longgar (memuat nominal) karena tarif bisa DIGANTI oleh rekonsiliasi
    // di ShippingOptions bila kutipan barunya berbeda — itu justru perilaku yang benar; yang salah
    // adalah baris ini kembali kosong.
    await expect(
      barisKurir,
      `kurir tak pulih setelah refresh (sebelumnya "${kurirSebelum}")`,
    ).toContainText(/Rp[\d.]+/, { timeout: 45_000 })

    // Nilai yang dipulihkan LOLOS VALIDASI — bukan sekadar terisi.
    //
    // Sempat diperiksa lewat `aria-disabled` tombol "Bayar Sekarang", dan itu keliru: tombol itu
    // juga bergantung pada MINIMUM BELANJA (`canPay = isAddressValid && kurir && shortfall === 0`),
    // sementara produk yang di-seed helper adalah yang pertama berstok — bisa saja seharga Rp300,
    // di bawah minimum. Ujinya lalu merah karena hal yang sama sekali bukan pemulihan draf.
    //
    // Yang benar-benar menandakan draf pulih dengan sehat: tak ada satu pun pesan galat field.
    await expect(
      addressSection(page).getByRole('alert'),
      'ada pesan galat di form setelah pemulihan — nilai yang dipulihkan tak lolos validasi',
    ).toHaveCount(0)
  })

  test('3: draf terhapus setelah pesanan dibuat → checkout berikutnya bersih', async ({
    page,
    baseURL,
  }) => {
    expect(baseURL, 'baseURL wajib ada').toBeTruthy()
    await openCheckoutWithCart(page, baseURL!)

    await isiTeguh(page, 'Nama Lengkap Penerima', ISIAN.nama)
    await isiTeguh(page, 'Nomor Telepon Aktif', ISIAN.telepon)
    await tungguDrafTersimpan(page)

    // Meniru langkah `clearCheckoutDraft()` yang dijalankan proceedPayment() tepat setelah pesanan
    // tersimpan. Dipanggil langsung ke localStorage — bukan lewat UI — supaya uji ini tak perlu
    // membuat pesanan nyata & memotong stok hanya untuk memeriksa perilaku penyimpanan lokal.
    // Yang membuat pesanan sungguhan sudah dicakup checkout-order-data-integrity.
    await page.evaluate((key) => window.localStorage.removeItem(key), KEY_DRAF)

    expect(await bacaDraf(page), 'draf masih ada setelah dihapus').toBeNull()

    // Checkout berikutnya harus mulai dari nol.
    await openCheckoutWithCart(page, baseURL!)
    await expect(page.getByRole('heading', { name: 'Alamat Pengiriman' })).toBeVisible({
      timeout: 30_000,
    })

    await expect(
      page.getByLabel('Nama Lengkap Penerima'),
      'draf lama nyangkut — nama dari checkout sebelumnya muncul lagi',
    ).toHaveValue('')
    await expect(page.getByLabel('Nomor Telepon Aktif')).toHaveValue('')
  })

  test('draf rusak di localStorage → form kosong, bukan halaman error', async ({
    page,
    baseURL,
  }) => {
    expect(baseURL, 'baseURL wajib ada').toBeTruthy()

    // Ditanam SEBELUM halaman dibuka. Tiga bentuk kerusakan yang paling mungkin nyata: bukan JSON,
    // JSON tapi bukan objek draf, dan draf dengan field bertipe salah. Ketiganya harus berakhir
    // sama — form kosong yang tetap bisa dipakai, bukan layar putih karena input terkendali React
    // menerima nilai non-string.
    for (const rusak of [
      'ini bukan json',
      '{"address":"bukan objek"}',
      '{"address":{"recipientName":123},"savedAt":1}',
    ]) {
      await page.addInitScript(
        ([key, nilai]) => window.localStorage.setItem(key, nilai),
        [KEY_DRAF, rusak] as const,
      )

      await openCheckoutWithCart(page, baseURL!)
      await expect(
        page.getByRole('heading', { name: 'Alamat Pengiriman' }),
        `halaman tak dapat dibuka dengan draf rusak: ${rusak}`,
      ).toBeVisible({ timeout: 30_000 })
      await expect(page.getByLabel('Nama Lengkap Penerima')).toHaveValue('')
    }
  })
})

// Mengisi satu field dan MEMASTIKAN nilainya menempel — `fill` yang mendarat sebelum hidrasi
// React selesai akan ditimpa state awal.
async function isiTeguh(page: Page, label: string, value: string): Promise<void> {
  const field = page.getByLabel(label)
  await expect(field, `field "${label}" tak ditemukan`).toBeVisible()
  await expect(async () => {
    await field.fill(value)
    await expect(field).toHaveValue(value, { timeout: 1_000 })
  }).toPass({ timeout: 15_000 })
}
