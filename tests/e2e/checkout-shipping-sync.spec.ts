// tests/e2e/checkout-shipping-sync.spec.ts
// E2E: ongkir & total pembayaran selalu mengikuti keadaan TERAKHIR, tak pernah tertinggal di nilai
// lama yang sudah tak relevan.
//
// Dua skenario:
//   A. Ganti alamat SETELAH kurir dipilih → ongkir ditarik ulang untuk tujuan baru.
//   B. Ganti-ganti kurir di bottom sheet → ringkasan checkout mengikuti konfirmasi terakhir.
//
// ── Batas ──
// Murni membaca. Berhenti jauh sebelum tombol bayar: tak ada pesanan, tak ada stok terpotong, tak
// ada invoice. Cek ongkir & search alamat adalah panggilan BACA yang gratis.
//
// ── Kenapa memeriksa JARINGAN, bukan sekadar angka di layar ──
// Dua tujuan yang sama-sama di DKI Jakarta bisa berharga PERSIS SAMA. Menegakkan "harganya
// berubah" karena itu akan merah secara acak — bukan karena kodenya salah, tapi karena tarifnya
// memang sama. Yang benar-benar dimaksud "re-fetch otomatis" adalah adanya permintaan BARU dengan
// destination_id BARU; itu yang diperiksa, dan itu deterministik.

import { test, expect, type Page } from '@playwright/test'
import { fillAddressSearch, openCheckoutWithCart } from './helpers/checkout'

// Dua tujuan berbeda, keduanya DKI Jakarta (sandbox Mengantar hanya melayani Jakarta→Jakarta).
const ALAMAT_1 = 'jakarta pusat'
const ALAMAT_2 = 'cengkareng'

// Endpoint perbandingan ongkir antar gudang yang dipanggil ShippingOptions.
const URL_ONGKIR = '**/api/mengantar/shipping/options'

test.setTimeout(180_000)

function parseRupiah(text: string): number {
  const digits = text.replace(/\D/g, '')
  return digits ? Number(digits) : NaN
}

// Baris trigger "Metode Pengiriman" di halaman checkout.
function barisKurir(page: Page) {
  return page.getByRole('button').filter({ hasText: 'Metode Pengiriman' }).first()
}

// Membuka bottom sheet kurir bila belum terbuka, lalu menunggu opsinya siap.
async function bukaSheetKurir(page: Page) {
  const daftar = page.getByRole('radiogroup', { name: 'Pilihan kurir' })
  if (!(await daftar.isVisible({ timeout: 3_000 }).catch(() => false))) {
    await barisKurir(page).click()
  }
  await expect(daftar, 'daftar kurir tak muncul').toBeVisible({ timeout: 45_000 })
  await expect(
    daftar.getByRole('radio').first(),
    'tak ada opsi kurir untuk tujuan Jakarta',
  ).toBeVisible({ timeout: 45_000 })
  return daftar
}

// Memilih opsi kurir ke-N lalu menekan Konfirmasi.
//
// Mengklik opsi HANYA menyetel draft di dalam sheet; `onSelect` ke halaman checkout baru dipanggil
// oleh `handleConfirm()` saat Konfirmasi ditekan (ShippingOptions.tsx). Tanpa langkah kedua ini,
// ringkasan tak pernah berubah dan ujinya salah menuduh sinkronisasinya rusak.
async function pilihKurir(page: Page, index: number): Promise<{ nama: string; harga: number }> {
  const daftar = await bukaSheetKurir(page)
  const opsi = daftar.getByRole('radio').nth(index)

  const teks = ((await opsi.textContent()) ?? '').replace(/\s+/g, ' ').trim()
  const cocok = teks.match(/Rp[\d.]+/)
  expect(cocok, `harga tak ditemukan pada opsi kurir ke-${index + 1}: "${teks}"`).toBeTruthy()

  await opsi.click()
  const konfirmasi = page.getByRole('button', { name: 'Konfirmasi' })
  await expect(konfirmasi, 'tombol Konfirmasi nonaktif').toBeEnabled({ timeout: 10_000 })
  await konfirmasi.click()

  return { nama: teks.split(/Estimasi/i)[0].trim(), harga: parseRupiah(cocok![0]) }
}

// Membaca satu baris angka dari kartu Ringkasan Pesanan (Subtotal / Ongkos Kirim / Total).
async function nilaiRingkasan(page: Page, label: string): Promise<number> {
  const baris = page.locator('div', { has: page.getByText(label, { exact: true }) }).last()
  const teks = ((await baris.textContent()) ?? '').replace(/\s+/g, ' ')
  const angka = teks.match(/Rp[\d.]+/g)
  expect(angka, `baris "${label}" tak memuat nominal: "${teks}"`).toBeTruthy()
  // Baris memuat label lalu nominalnya — ambil yang terakhir supaya tak tertukar label bernominal.
  return parseRupiah(angka![angka!.length - 1])
}

test.describe('Checkout — ongkir & total selalu mengikuti pilihan terakhir', () => {
  test('A: ganti alamat setelah kurir dipilih → ongkir ditarik ulang untuk tujuan baru', async ({
    page,
    baseURL,
  }) => {
    expect(baseURL, 'baseURL wajib ada').toBeTruthy()

    // Setiap permintaan ongkir dicatat beserta destination_id-nya. Inilah bukti "re-fetch", bukan
    // tebakan dari angka di layar.
    const tujuanDiminta: string[] = []
    await page.route(URL_ONGKIR, async (route) => {
      try {
        const body = route.request().postDataJSON() as { destinationId?: string }
        if (body?.destinationId) tujuanDiminta.push(body.destinationId)
      } catch {
        // body tak terbaca — biarkan, permintaannya tetap diteruskan
      }
      await route.continue()
    })

    await openCheckoutWithCart(page, baseURL!)

    // === Alamat pertama + kurir ===
    await fillAddressSearch(page, ALAMAT_1)
    const opsi1 = page.getByRole('listbox').getByRole('option').first()
    await expect(opsi1, `tak ada hasil untuk "${ALAMAT_1}"`).toBeVisible({ timeout: 30_000 })
    await opsi1.click()

    const kurir1 = await pilihKurir(page, 0)
    await expect(barisKurir(page), 'kurir pertama tak tersimpan').toContainText(/Rp[\d.]+/)

    const jumlahPermintaanAwal = tujuanDiminta.length
    expect(jumlahPermintaanAwal, 'ongkir tak pernah diminta untuk alamat pertama').toBeGreaterThan(0)
    const tujuan1 = tujuanDiminta[tujuanDiminta.length - 1]
    console.log(`\n  alamat 1 → ${kurir1.nama} Rp${kurir1.harga.toLocaleString('id-ID')} (dest ${tujuan1})`)

    // === Ganti alamat ===
    await page.getByRole('button', { name: 'Ubah Alamat' }).click()
    await fillAddressSearch(page, ALAMAT_2)
    const opsi2 = page.getByRole('listbox').getByRole('option').first()
    await expect(opsi2, `tak ada hasil untuk "${ALAMAT_2}"`).toBeVisible({ timeout: 30_000 })
    await opsi2.click()

    // === Bukti 1: permintaan BARU dengan tujuan BARU ===
    await expect
      .poll(() => tujuanDiminta.length, {
        message:
          'tak ada permintaan ongkir baru setelah alamat diganti — checkout memakai tarif tujuan lama',
        timeout: 45_000,
      })
      .toBeGreaterThan(jumlahPermintaanAwal)

    const tujuan2 = tujuanDiminta[tujuanDiminta.length - 1]
    expect(
      tujuan2,
      `permintaan ongkir baru masih memakai destination_id LAMA (${tujuan1}) — alamat baru tak ikut terkirim`,
    ).not.toBe(tujuan1)
    console.log(`  alamat 2 → dest ${tujuan2}`)

    // === Bukti 2: tarif lama tak nyangkut di ringkasan ===
    // Setelah tujuan berganti, halaman me-reset pilihan kurir (handleAddressChange) lalu memilih
    // ulang opsi termurah dari kutipan BARU. Yang ditegakkan: ongkir di ringkasan sama dengan
    // ongkir kurir yang kini terpilih — bukan angka dari tujuan sebelumnya.
    await expect(barisKurir(page), 'kurir tak terpilih ulang setelah ganti alamat').toContainText(
      /Rp[\d.]+/,
      { timeout: 45_000 },
    )

    const teksKurirBaru = ((await barisKurir(page).textContent()) ?? '').replace(/\s+/g, ' ')
    const ongkirTerpilih = parseRupiah(teksKurirBaru.match(/Rp[\d.]+/)![0])
    const ongkirRingkasan = await nilaiRingkasan(page, 'Ongkos Kirim')

    expect(
      ongkirRingkasan,
      `Ongkir di ringkasan (Rp${ongkirRingkasan.toLocaleString('id-ID')}) tidak sama dengan ongkir ` +
        `kurir terpilih (Rp${ongkirTerpilih.toLocaleString('id-ID')}) setelah alamat diganti.`,
    ).toBe(ongkirTerpilih)

    // === Bukti 3: total = subtotal + ongkir, tanpa sisa nilai lama ===
    const subtotal = await nilaiRingkasan(page, 'Subtotal')
    const total = await nilaiRingkasan(page, 'Total')
    expect(
      total,
      `Total (Rp${total.toLocaleString('id-ID')}) ≠ subtotal Rp${subtotal.toLocaleString('id-ID')} ` +
        `+ ongkir Rp${ongkirRingkasan.toLocaleString('id-ID')}`,
    ).toBe(subtotal + ongkirRingkasan)

    console.log(`  ringkasan cocok: ${subtotal} + ${ongkirRingkasan} = ${total}`)
  })

  test('B: ganti-ganti kurir → ringkasan mengikuti konfirmasi terakhir', async ({
    page,
    baseURL,
  }) => {
    expect(baseURL, 'baseURL wajib ada').toBeTruthy()
    await openCheckoutWithCart(page, baseURL!)

    await fillAddressSearch(page, ALAMAT_1)
    const opsi = page.getByRole('listbox').getByRole('option').first()
    await expect(opsi, `tak ada hasil untuk "${ALAMAT_1}"`).toBeVisible({ timeout: 30_000 })
    await opsi.click()

    const daftar = await bukaSheetKurir(page)
    const jumlahOpsi = await daftar.getByRole('radio').count()
    const subtotal = await nilaiRingkasan(page, 'Subtotal')

    // Konfirmasi pertama
    const pertama = await pilihKurir(page, 0)
    expect(
      await nilaiRingkasan(page, 'Total'),
      `Total tak mengikuti kurir pertama (${pertama.nama} Rp${pertama.harga})`,
    ).toBe(subtotal + pertama.harga)

    if (jumlahOpsi >= 2) {
      // === Bolak-balik: opsi 2 → opsi 1 → opsi 2 ===
      for (const index of [1, 0, 1]) {
        const dipilih = await pilihKurir(page, index)
        expect(
          await nilaiRingkasan(page, 'Total'),
          `Total tak sinkron setelah beralih ke opsi ke-${index + 1} ` +
            `(${dipilih.nama} Rp${dipilih.harga.toLocaleString('id-ID')})`,
        ).toBe(subtotal + dipilih.harga)
        console.log(`  opsi ${index + 1}: ${dipilih.nama} → total cocok`)
      }
    } else {
      // Hanya satu kurir tersedia — bukan kekurangan uji, tapi konsekuensi daftar putih kurir
      // (`ALLOWED_COURIER_IDS` di src/lib/mengantar-estimate.ts saat ini hanya 'JT'). Dicatat
      // terbuka, bukan di-skip diam-diam, supaya terlihat bahwa cabang ini menunggu kurir kedua.
      const catatan =
        `Hanya ${jumlahOpsi} opsi kurir tersedia — perpindahan antar kurir tak bisa diuji. ` +
        `Daftar putih saat ini hanya J&T (ALLOWED_COURIER_IDS). Cabang ini aktif sendiri begitu ` +
        `kurir kedua diizinkan.`
      test.info().annotations.push({ type: 'sebagian dilewati', description: catatan })
      console.log(`  ⚠ ${catatan}`)
    }

    // === Draft dibuang saat sheet ditutup tanpa Konfirmasi ===
    // Berlaku berapa pun jumlah opsinya. Mengklik opsi hanya menyetel draft; menutup lewat X harus
    // meninggalkan pilihan yang sudah dikonfirmasi apa adanya. Kalau draft ikut tersimpan, pembeli
    // bisa ditagih kurir yang tak pernah ia setujui.
    const totalSebelum = await nilaiRingkasan(page, 'Total')

    await barisKurir(page).click()
    const daftarLagi = page.getByRole('radiogroup', { name: 'Pilihan kurir' })
    await expect(daftarLagi).toBeVisible({ timeout: 15_000 })
    await daftarLagi.getByRole('radio').nth(jumlahOpsi >= 2 ? 0 : 0).click() // ubah draft
    await page.getByRole('button', { name: 'Tutup' }).last().click()

    expect(
      await nilaiRingkasan(page, 'Total'),
      'Total berubah padahal sheet ditutup tanpa Konfirmasi — draft bocor jadi pilihan resmi',
    ).toBe(totalSebelum)

    console.log(`  draft dibuang saat sheet ditutup: total tetap Rp${totalSebelum.toLocaleString('id-ID')}`)
  })

  test('C: perpindahan antar DUA kurir (respons ongkir distub) → total selalu ikut', async ({
    page,
    baseURL,
  }) => {
    expect(baseURL, 'baseURL wajib ada').toBeTruthy()

    // === Kenapa distub ===
    // Skenario "ganti kurir bolak-balik" tak bisa dijalankan terhadap data nyata: daftar putih
    // kurir saat ini hanya J&T (`ALLOWED_COURIER_IDS` di src/lib/mengantar-estimate.ts), jadi
    // Mengantar hanya pernah mengembalikan SATU opsi. Uji B di atas membuktikannya.
    //
    // Yang diuji di sini murni logika sinkronisasi SISI KLIEN — draft → konfirmasi → total —
    // dan logika itu tak peduli tarifnya dari mana. Menstub responsnya memberi kurir kedua tanpa
    // menyentuh daftar putih produksi (melebarkannya akan mengubah pilihan yang dilihat pembeli
    // sungguhan, keputusan bisnis yang bukan milik sebuah uji).
    //
    // Konsekuensi yang disengaja: uji ini TIDAK memvalidasi integrasi Mengantar. Itu tugas uji A & B.
    const OPSI_STUB = [
      {
        id: 'JT',
        name: 'J&T',
        price: 4080,
        estimatedDate: '2-4 hari',
        unsupported: false,
        warehouseId: 'stub-gudang',
        warehouseName: 'Gudang Uji',
      },
      {
        id: 'JT2',
        name: 'J&T Express Kedua',
        price: 17500,
        estimatedDate: '1-2 hari',
        unsupported: false,
        warehouseId: 'stub-gudang',
        warehouseName: 'Gudang Uji',
      },
    ]

    await page.route(URL_ONGKIR, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ options: OPSI_STUB }),
      }),
    )

    await openCheckoutWithCart(page, baseURL!)

    await fillAddressSearch(page, ALAMAT_1)
    const opsi = page.getByRole('listbox').getByRole('option').first()
    await expect(opsi, `tak ada hasil untuk "${ALAMAT_1}"`).toBeVisible({ timeout: 30_000 })
    await opsi.click()

    const daftar = await bukaSheetKurir(page)
    expect(
      await daftar.getByRole('radio').count(),
      'stub tak sampai ke UI — dua opsi seharusnya tampil',
    ).toBe(2)

    const subtotal = await nilaiRingkasan(page, 'Subtotal')

    // Bolak-balik: mahal → murah → mahal. Urutan sengaja tak monoton supaya bug "hanya maju" atau
    // "hanya mengambil yang termurah" ikut tertangkap.
    for (const index of [1, 0, 1, 0]) {
      const dipilih = await pilihKurir(page, index)
      const total = await nilaiRingkasan(page, 'Total')
      expect(
        total,
        `Total tak sinkron setelah memilih "${dipilih.nama}".\n` +
          `    subtotal : Rp${subtotal.toLocaleString('id-ID')}\n` +
          `    ongkir   : Rp${dipilih.harga.toLocaleString('id-ID')}\n` +
          `    harusnya : Rp${(subtotal + dipilih.harga).toLocaleString('id-ID')}\n` +
          `    di layar : Rp${total.toLocaleString('id-ID')}`,
      ).toBe(subtotal + dipilih.harga)

      // Baris trigger juga harus ikut, bukan hanya angka totalnya.
      await expect(
        barisKurir(page),
        `baris "Metode Pengiriman" masih menampilkan kurir lama, bukan "${dipilih.nama}"`,
      ).toContainText(dipilih.nama)

      console.log(`  ${dipilih.nama} → total Rp${total.toLocaleString('id-ID')} ✓`)
    }
  })
})
